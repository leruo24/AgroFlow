using System;
using System.Collections.Generic;
using System.Linq;
using AgroFlow.Business.Agronomy;
using AgroFlow.Business.Agronomy.RuleBook;
using Xunit;

namespace AgroFlow.Domain.Tests;

// Part 2: the rule book, table-driven over every crop × soil × stage - the
// combinations docs/engine/rule-book.md's "Should I water today?" table stands for
// ("any soil, any stage") - at the boundaries: exactly at RAW, rain exactly
// equal to the need. ETo 5 mm/day, a 1.5 m² zone on 1.5 L/min.
public class RuleBookMatrixTests
{
    private const double Eto = 5.0;
    private const double Area = 1.5;
    private const double Flow = 1.5;

    private static readonly string[] Soils = { "sandy", "loam", "clay" };
    private static readonly SeasonStage[] Stages =
        { SeasonStage.Establishing, SeasonStage.Growing, SeasonStage.PeakGrowth, SeasonStage.NearingHarvest };

    /// A day inside each stage: the first day of it (Table 11 stage lengths).
    private static int DayIn(Fao56EngineCrop c, SeasonStage stage) => stage switch
    {
        SeasonStage.Establishing => 1,
        SeasonStage.Growing => c.LIniDays + 1,
        SeasonStage.PeakGrowth => c.LIniDays + c.LDevDays + 1,
        _ => c.LIniDays + c.LDevDays + c.LMidDays + 1,
    };

    public static IEnumerable<object[]> Matrix() =>
        from crop in Fao56EngineReference.AllCrops
        from soil in Soils
        from stage in Stages
        select new object[] { crop.Key, soil, stage };

    private static (double Etc, double Raw, double Taw) Need(Fao56EngineCrop crop, string soil, SeasonStage stage)
    {
        var day = DayIn(crop, stage);
        var holding = SoilRules.WaterHoldingFor(soil);
        var etc = CropRules.KcFor(crop, day) * Eto;
        var p = SoilWaterBalance.AdjustP(crop.DepletionFractionP, SoilRules.DepletionFactorAdjust(soil), etc);
        var taw = SoilRules.TotalAvailableWaterMm(holding, crop.RootDepthM);
        return (etc, SoilWaterBalance.ReadilyAvailableWaterMm(p, taw), taw);
    }

    [Theory]
    [MemberData(nameof(Matrix))]
    public void Every_crop_soil_and_stage_waters_at_RAW_and_skips_when_rain_covers_the_need(string cropKey, string soil, SeasonStage stage)
    {
        var crop = Fao56EngineReference.TryResolveCrop(cropKey)!;
        Assert.Equal(stage, CropRules.StageFor(crop, DayIn(crop, stage)).Stage);

        var (etc, raw, taw) = Need(crop, soil, stage);
        Assert.InRange(raw, 0.1 * taw - 1e-9, 0.8 * taw + 1e-9);      // p held within 0.1-0.8 (p. 162)

        // FAO-56 p. 171: water before or at the moment RAW is used up.
        Assert.True(WaterRules.ShouldWaterToday(raw, raw));
        Assert.False(WaterRules.ShouldWaterToday(raw - 0.01, raw));

        // DATA RULE: rain equal to the day's need replaces watering; a hair less does not.
        Assert.True(WaterRules.SkipForRain(etc, etc));
        Assert.False(WaterRules.SkipForRain(etc - 0.01, etc));

        // Never more than the dryness (p. 171); 1 mm on 1 m² is 1 L (Ch. 1 p. 3); rounded up.
        Assert.Equal((int)Math.Ceiling(raw * Area / Flow), WaterRules.MinutesToRun(raw, Area, Flow));
    }

    public static IEnumerable<object[]> CropStages() =>
        from crop in Fao56EngineReference.AllCrops
        from stage in Stages
        select new object[] { crop.Key, stage };

    [Theory]
    [MemberData(nameof(CropStages))]
    public void Sand_holds_less_than_loam_and_loam_less_than_clay(string cropKey, SeasonStage stage)
    {
        // Table 19 (p. 144): what the soil changes is how much it holds, so in
        // sand RAW comes sooner and each watering is smaller.
        var crop = Fao56EngineReference.TryResolveCrop(cropKey)!;
        var sand = Need(crop, "sandy", stage).Raw;
        var loam = Need(crop, "loam", stage).Raw;
        var clay = Need(crop, "clay", stage).Raw;
        Assert.True(sand < loam, $"{cropKey} {stage}: sand {sand} vs loam {loam}");
        Assert.True(loam < clay, $"{cropKey} {stage}: loam {loam} vs clay {clay}");
    }

    [Fact]
    public void The_rule_book_example_row_for_loam_is_what_the_rules_give()
    {
        // The table's loam example: 20.5 of 21.5 mm → no; 21.5 → water.
        Assert.False(WaterRules.ShouldWaterToday(20.5, 21.5));
        Assert.True(WaterRules.ShouldWaterToday(21.5, 21.5));
        Assert.False(WaterRules.SkipForRain(4.9, 5));
        Assert.True(WaterRules.SkipForRain(5, 5));
        Assert.True(WaterRules.SkipForRain(12, 5));
    }

    [Theory]
    [InlineData(12.0, 10.0, WateringVerdict.AboutRight)]  // ratio exactly 1.2
    [InlineData(12.000001, 10.0, WateringVerdict.TooMuch)]
    [InlineData(8.0, 10.0, WateringVerdict.AboutRight)]   // ratio exactly 0.8
    [InlineData(7.999999, 10.0, WateringVerdict.TooLittle)]
    public void Verdict_ratio_boundaries_are_exact(double applied, double needed, WateringVerdict expected)
    {
        Assert.Equal(expected, VerdictRules.For(applied, needed));
    }

    [Fact]
    public void Kit_quiet_is_said_in_SAST_and_never_ISO()
    {
        Assert.Equal("your kit hasn't sent any data yet", ConfidenceRules.KitQuiet(null));
        // 23:30 UTC on 16 Sep is 01:30 on 17 Sep in SAST.
        Assert.Equal("your kit hasn't sent data since 17 Sep",
            ConfidenceRules.KitQuiet(new DateTime(2026, 9, 16, 23, 30, 0, DateTimeKind.Utc)));
        Assert.Equal("your kit hasn't sent data since 16 Sep",
            ConfidenceRules.KitQuiet(new DateTime(2026, 9, 16, 21, 59, 0, DateTimeKind.Utc)));
    }

    [Theory]
    [InlineData(null, null, false, false, "Low")]
    [InlineData(5.0, "the last 30 days", false, false, "High")]
    [InlineData(5.0, "the forecast", false, false, "Medium")]
    [InlineData(5.0, "the last 30 days", true, false, "Medium")]
    [InlineData(5.0, "the last 30 days", false, true, "Medium")]
    public void Recommendation_confidence(double? eto, string? basis, bool stageAssumed, bool soilAssumed, string level)
    {
        var r = new Recommendation { MeanEtoMm = eto, EtoBasis = basis, StageAssumed = stageAssumed, SoilAssumed = soilAssumed };
        Assert.Equal(level, RecommendationRules.ConfidenceFor(r).Level.ToString());
    }

    [Fact]
    public void Every_RuleBook_method_is_called_by_a_test()
    {
        // A guard for the next rule someone adds: its name must appear in a
        // test file. Explanations.For is exercised for every insight type
        // through ZoneInsightBuilder (ExplanationTests.TheScenarios_CoverEveryInsightType).
        var testsDir = System.IO.Path.Combine(FindRepoRoot(), "backend", "AgroFlow.Domain.Tests");
        var tests = string.Join("\n", System.IO.Directory.GetFiles(testsDir, "*.cs").Select(System.IO.File.ReadAllText));

        var ruleTypes = typeof(WaterRules).Assembly.GetTypes()
            .Where(t => t.Namespace == typeof(WaterRules).Namespace && t.IsAbstract && t.IsSealed)   // static classes
            .ToList();
        Assert.True(ruleTypes.Count >= 9, $"found only {ruleTypes.Count} rule classes");   // not vacuous
        var missing = new List<string>();
        foreach (var t in ruleTypes)
        {
            foreach (var m in t.GetMethods(System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.Static)
                         .Select(m => m.Name).Distinct())
            {
                if (t.Name == "Explanations" && m == "For") continue;
                if (!tests.Contains($"{t.Name}.{m}(", StringComparison.Ordinal)) missing.Add($"{t.Name}.{m}");
            }
        }
        Assert.Empty(missing);
    }

    private static string FindRepoRoot()
    {
        var dir = new System.IO.DirectoryInfo(AppContext.BaseDirectory);
        while (dir != null && !System.IO.Directory.Exists(System.IO.Path.Combine(dir.FullName, "backend"))) dir = dir.Parent;
        return dir!.FullName;
    }
}
