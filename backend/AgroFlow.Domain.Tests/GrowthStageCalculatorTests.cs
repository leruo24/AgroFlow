using AgroFlow.Business.Agronomy;

namespace AgroFlow.Domain.Tests;

// Stage determination and Kc interpolation for all six crops.
//
// The expected values below are NOT copied out of the code under test - they
// are worked out from the FAO-56 tables by hand and written as literals, so a
// change to the knowledge JSON or to the interpolation breaks a test instead of
// quietly agreeing with itself.
//
// Day convention under test: planting day is day-after-planting 0, and a stage
// boundary belongs to the stage it OPENS.
public class GrowthStageCalculatorTests
{
    private static readonly DateOnly Planting = new DateOnly(2026, 1, 1);

    private static StageAssessment AssessAt(string cropKey, int daysAfterPlanting)
    {
        var crop = Fao56Knowledge.Crops[cropKey];
        return GrowthStageCalculator.Assess(crop, Planting, Planting.AddDays(daysAfterPlanting));
    }

    // ---- The knowledge base loads at all ------------------------------------

    [Fact]
    public void KnowledgeBase_ContainsExactlyTheSixAgroFlowCrops()
    {
        Assert.Equal(
            new[] { "citrus", "dry_beans", "leafy_veg", "maize", "potato", "tomato" },
            Fao56Knowledge.Crops.Keys.OrderBy(k => k, StringComparer.Ordinal).ToArray());
    }

    [Theory]
    // Stage lengths as selected in fao56-crop-knowledge.json, read off FAO-56 Table 11.
    [InlineData("maize", 30, 40, 50, 30, 150)]      // Table 11 p. 106, April, Spain/Calif.
    [InlineData("potato", 30, 35, 50, 25, 140)]     // Table 11 p. 105, Dec, Calif. Desert
    [InlineData("tomato", 30, 40, 45, 30, 145)]     // Table 11 p. 104, April/May, Mediterranean
    [InlineData("dry_beans", 20, 30, 40, 20, 110)]  // Table 11 p. 105, May/June, Continental
    [InlineData("leafy_veg", 20, 30, 15, 10, 75)]   // Table 11 p. 104, April, Mediterranean (Lettuce)
    [InlineData("citrus", 60, 90, 120, 95, 365)]    // Table 11 p. 107, Jan, Mediterranean
    public void StageLengths_MatchTheSelectedTable11Row(
        string cropKey, int lIni, int lDev, int lMid, int lLate, int total)
    {
        var lengths = Fao56Knowledge.Crops[cropKey].StageLengths;
        Assert.Equal(lIni, lengths.InitialDays);
        Assert.Equal(lDev, lengths.DevelopmentDays);
        Assert.Equal(lMid, lengths.MidSeasonDays);
        Assert.Equal(lLate, lengths.LateSeasonDays);
        Assert.Equal(total, lengths.TotalDays);
    }

    [Theory]
    // Kc values as read off FAO-56 Table 12.
    [InlineData("maize", 0.30, 1.20, 0.60)]      // p. 111; Kc_ini from the "i. Cereals" group row
    [InlineData("potato", 0.50, 1.15, 0.75)]     // p. 110; Kc_ini from the "d. Roots and Tubers" group row
    [InlineData("tomato", 0.60, 1.15, 0.80)]     // p. 110; Kc_end 0.80 = midpoint of the published 0.70-0.90
    [InlineData("dry_beans", 0.40, 1.15, 0.35)]  // p. 111
    [InlineData("leafy_veg", 0.70, 1.00, 0.95)]  // p. 110; Kc_ini from the "a. Small Vegetables" group row
    [InlineData("citrus", 0.70, 0.65, 0.70)]     // p. 113; note Kc_mid < Kc_ini
    public void KcValues_MatchTable12(string cropKey, double kcIni, double kcMid, double kcEnd)
    {
        var kc = Fao56Knowledge.Crops[cropKey].Kc;
        Assert.Equal(kcIni, kc.Initial, precision: 4);
        Assert.Equal(kcMid, kc.MidSeason, precision: 4);
        Assert.Equal(kcEnd, kc.End, precision: 4);
    }

    [Theory]
    // Depletion fraction p and rooting depth, FAO-56 Table 22.
    [InlineData("maize", 0.55, 1.0, 1.7)]      // p. 164
    [InlineData("potato", 0.35, 0.4, 0.6)]     // p. 163
    [InlineData("tomato", 0.40, 0.7, 1.5)]     // p. 163
    [InlineData("dry_beans", 0.45, 0.6, 0.9)]  // p. 164
    [InlineData("leafy_veg", 0.30, 0.3, 0.5)]  // p. 163 (Lettuce)
    [InlineData("citrus", 0.50, 1.2, 1.5)]     // p. 165 (70% canopy)
    public void SoilValues_MatchTable22(string cropKey, double p, double zrMin, double zrMax)
    {
        var soil = Fao56Knowledge.Crops[cropKey].Soil;
        Assert.Equal(p, soil.DepletionFractionP, precision: 4);
        Assert.Equal(zrMin, soil.RootDepthMinM, precision: 4);
        Assert.Equal(zrMax, soil.RootDepthMaxM, precision: 4);
    }

    // ---- Stage boundaries, exactly on the edge ------------------------------

    [Theory]
    // maize: L_ini 30, L_dev 40, L_mid 50, L_late 30 (total 150).
    [InlineData(0, GrowthStage.Initial)]
    [InlineData(29, GrowthStage.Initial)]       // last day of initial
    [InlineData(30, GrowthStage.Development)]   // BOUNDARY: first day of development
    [InlineData(69, GrowthStage.Development)]   // last day of development
    [InlineData(70, GrowthStage.MidSeason)]     // BOUNDARY: first day of mid-season
    [InlineData(119, GrowthStage.MidSeason)]    // last day of mid-season
    [InlineData(120, GrowthStage.LateSeason)]   // BOUNDARY: first day of late season
    [InlineData(149, GrowthStage.LateSeason)]   // last day of the season
    [InlineData(150, GrowthStage.PastSeasonEnd)] // BOUNDARY: one past the end
    public void Maize_StageBoundaries(int dap, GrowthStage expected)
    {
        Assert.Equal(expected, AssessAt("maize", dap).Stage);
    }

    [Theory]
    // leafy veg (lettuce) is the shortest season of the six: 20/30/15/10 = 75.
    [InlineData(0, GrowthStage.Initial)]
    [InlineData(19, GrowthStage.Initial)]
    [InlineData(20, GrowthStage.Development)]
    [InlineData(49, GrowthStage.Development)]
    [InlineData(50, GrowthStage.MidSeason)]
    [InlineData(64, GrowthStage.MidSeason)]
    [InlineData(65, GrowthStage.LateSeason)]
    [InlineData(74, GrowthStage.LateSeason)]
    [InlineData(75, GrowthStage.PastSeasonEnd)]
    public void LeafyVeg_StageBoundaries(int dap, GrowthStage expected)
    {
        Assert.Equal(expected, AssessAt("leafy_veg", dap).Stage);
    }

    [Theory]
    // citrus is the longest: 60/90/120/95 = 365.
    [InlineData(0, GrowthStage.Initial)]
    [InlineData(60, GrowthStage.Development)]
    [InlineData(150, GrowthStage.MidSeason)]
    [InlineData(270, GrowthStage.LateSeason)]
    [InlineData(365, GrowthStage.PastSeasonEnd)]
    public void Citrus_StageBoundaries(int dap, GrowthStage expected)
    {
        Assert.Equal(expected, AssessAt("citrus", dap).Stage);
    }

    [Theory]
    [InlineData("potato", 30, GrowthStage.Development)]     // L_ini 30
    [InlineData("potato", 65, GrowthStage.MidSeason)]       // 30+35
    [InlineData("potato", 115, GrowthStage.LateSeason)]     // 30+35+50
    [InlineData("tomato", 30, GrowthStage.Development)]     // L_ini 30
    [InlineData("tomato", 70, GrowthStage.MidSeason)]       // 30+40
    [InlineData("tomato", 115, GrowthStage.LateSeason)]     // 30+40+45
    [InlineData("dry_beans", 20, GrowthStage.Development)]  // L_ini 20
    [InlineData("dry_beans", 50, GrowthStage.MidSeason)]    // 20+30
    [InlineData("dry_beans", 90, GrowthStage.LateSeason)]   // 20+30+40
    public void RemainingCrops_OpenEachStageOnTheBoundaryDay(string cropKey, int dap, GrowthStage expected)
    {
        Assert.Equal(expected, AssessAt(cropKey, dap).Stage);
    }

    // ---- Kc is flat where FAO-56 says it is flat ----------------------------

    [Theory]
    [InlineData("maize", 0, 0.30)]
    [InlineData("maize", 15, 0.30)]
    [InlineData("maize", 29, 0.30)]
    [InlineData("potato", 12, 0.50)]
    [InlineData("citrus", 40, 0.70)]
    public void KcIsConstantThroughInitialStage(string cropKey, int dap, double expectedKc)
    {
        var assessment = AssessAt(cropKey, dap);
        Assert.Equal(GrowthStage.Initial, assessment.Stage);
        Assert.Equal(expectedKc, assessment.Kc, precision: 4);
    }

    [Theory]
    [InlineData("maize", 70, 1.20)]
    [InlineData("maize", 95, 1.20)]
    [InlineData("maize", 119, 1.20)]
    [InlineData("tomato", 100, 1.15)]
    [InlineData("citrus", 200, 0.65)]
    public void KcIsConstantThroughMidSeason(string cropKey, int dap, double expectedKc)
    {
        var assessment = AssessAt(cropKey, dap);
        Assert.Equal(GrowthStage.MidSeason, assessment.Stage);
        Assert.Equal(expectedKc, assessment.Kc, precision: 4);
    }

    // ---- Interpolation correctness -----------------------------------------

    [Fact]
    public void Maize_KcInterpolatesLinearlyThroughDevelopment()
    {
        // L_ini 30, L_dev 40. Kc_ini 0.30 -> Kc_mid 1.20, a span of 0.90.
        // At the first day of development (dap 30) the fraction is 0, so Kc is
        // still Kc_ini; halfway (dap 50, 20/40) it is 0.30 + 0.90*0.5 = 0.75.
        Assert.Equal(0.30, AssessAt("maize", 30).Kc, precision: 4);
        Assert.Equal(0.525, AssessAt("maize", 40).Kc, precision: 4);  // 10/40 -> 0.30 + 0.225
        Assert.Equal(0.75, AssessAt("maize", 50).Kc, precision: 4);   // 20/40 -> halfway
        Assert.Equal(0.975, AssessAt("maize", 60).Kc, precision: 4);  // 30/40
        Assert.Equal(1.1775, AssessAt("maize", 69).Kc, precision: 4); // 39/40, just short of Kc_mid
        Assert.Equal(1.20, AssessAt("maize", 70).Kc, precision: 4);   // mid-season proper
    }

    [Fact]
    public void Maize_KcInterpolatesLinearlyThroughLateSeason()
    {
        // Late season starts at dap 120, runs 30 days. Kc_mid 1.20 -> Kc_end 0.60.
        Assert.Equal(1.20, AssessAt("maize", 120).Kc, precision: 4);  // 0/30
        Assert.Equal(0.90, AssessAt("maize", 135).Kc, precision: 4);  // 15/30 -> halfway down
        Assert.Equal(0.62, AssessAt("maize", 149).Kc, precision: 4);  // 29/30, just short of Kc_end
    }

    [Fact]
    public void Citrus_KcInterpolatesDOWNWARDThroughDevelopment()
    {
        // Citrus is the odd one out: Kc_mid (0.65) is BELOW Kc_ini (0.70),
        // because of stomatal closure during peak ET (FAO-56 Table 12 fn 21,
        // p. 113). The same linear interpolation must therefore run downward.
        // L_ini 60, L_dev 90, span -0.05.
        Assert.Equal(0.70, AssessAt("citrus", 60).Kc, precision: 4);    // 0/90
        Assert.Equal(0.675, AssessAt("citrus", 105).Kc, precision: 4);  // 45/90 -> halfway down
        Assert.Equal(0.65, AssessAt("citrus", 150).Kc, precision: 4);   // mid-season

        // ...and back UP through the late season, Kc_mid 0.65 -> Kc_end 0.70.
        Assert.Equal(0.65, AssessAt("citrus", 270).Kc, precision: 4);   // 0/95
        Assert.True(AssessAt("citrus", 320).Kc > 0.65);
    }

    [Fact]
    public void Interpolation_IsMonotonicAcrossEveryCropsWholeSeason()
    {
        // Kc must never jump: across a whole season the day-to-day change is
        // bounded by the largest single-day step the table implies. This is the
        // test that catches an off-by-one in a stage boundary, which would show
        // up as a discontinuity rather than as a wrong single value.
        foreach (var (key, crop) in Fao56Knowledge.Crops)
        {
            var previous = GrowthStageCalculator.Assess(crop, Planting, Planting).Kc;

            for (var dap = 1; dap < crop.StageLengths.TotalDays; dap++)
            {
                var kc = GrowthStageCalculator.Assess(crop, Planting, Planting.AddDays(dap)).Kc;
                var step = Math.Abs(kc - previous);

                var largestSpan = Math.Max(
                    Math.Abs(crop.Kc.MidSeason - crop.Kc.Initial) / crop.StageLengths.DevelopmentDays,
                    Math.Abs(crop.Kc.End - crop.Kc.MidSeason) / crop.StageLengths.LateSeasonDays);

                Assert.True(step <= largestSpan + 1e-9,
                    $"{key}: Kc jumped by {step:F4} between day {dap - 1} and {dap} (max legal step {largestSpan:F4})");

                previous = kc;
            }
        }
    }

    [Theory]
    [InlineData("maize")]
    [InlineData("potato")]
    [InlineData("tomato")]
    [InlineData("dry_beans")]
    [InlineData("leafy_veg")]
    [InlineData("citrus")]
    public void KcNeverLeavesTheRangeTheTablesDefine(string cropKey)
    {
        var crop = Fao56Knowledge.Crops[cropKey];
        var lowest = Math.Min(crop.Kc.Initial, Math.Min(crop.Kc.MidSeason, crop.Kc.End));
        var highest = Math.Max(crop.Kc.Initial, Math.Max(crop.Kc.MidSeason, crop.Kc.End));

        for (var dap = 0; dap < crop.StageLengths.TotalDays; dap++)
        {
            var kc = GrowthStageCalculator.Assess(crop, Planting, Planting.AddDays(dap)).Kc;
            Assert.InRange(kc, lowest - 1e-9, highest + 1e-9);
        }
    }

    // ---- Days remaining, and the transition lookahead -----------------------

    [Fact]
    public void DaysRemainingInStage_CountsDownToTheBoundary()
    {
        Assert.Equal(30, AssessAt("maize", 0).DaysRemainingInStage);   // 30-day initial, day 0
        Assert.Equal(1, AssessAt("maize", 29).DaysRemainingInStage);   // last day of initial
        Assert.Equal(40, AssessAt("maize", 30).DaysRemainingInStage);  // first day of a 40-day development
        Assert.Equal(50, AssessAt("maize", 70).DaysRemainingInStage);  // first day of a 50-day mid-season
    }

    [Fact]
    public void NextTransition_AnnouncesMidSeasonFromLateDevelopment()
    {
        var crop = Fao56Knowledge.Crops["maize"];
        var assessment = AssessAt("maize", 65); // 5 days short of mid-season
        var transition = GrowthStageCalculator.NextTransition(crop, assessment);

        Assert.NotNull(transition);
        Assert.Equal(GrowthStage.MidSeason, transition!.NextStage);
        Assert.Equal(5, transition.DaysUntil);
    }

    [Fact]
    public void NextTransition_IsNullInLateSeason()
    {
        // Late season ends at harvest, not at another stage.
        var crop = Fao56Knowledge.Crops["maize"];
        Assert.Null(GrowthStageCalculator.NextTransition(crop, AssessAt("maize", 130)));
    }

    // ---- Out-of-season handling ---------------------------------------------

    [Fact]
    public void PlantingDateInTheFuture_ReportsNotYetPlanted_AndDoesNotThrow()
    {
        var crop = Fao56Knowledge.Crops["maize"];
        var assessment = GrowthStageCalculator.Assess(crop, Planting, Planting.AddDays(-10));

        Assert.Equal(GrowthStage.NotYetPlanted, assessment.Stage);
        Assert.Equal(-10, assessment.DaysAfterPlanting);
        Assert.False(assessment.IsWithinSeason);
    }

    [Fact]
    public void PastSeasonEnd_HoldsKcAtKcEndRatherThanExtrapolating()
    {
        var assessment = AssessAt("maize", 400);
        Assert.Equal(GrowthStage.PastSeasonEnd, assessment.Stage);
        Assert.Equal(0.60, assessment.Kc, precision: 4); // Kc_end, not a value off the end of the curve
        Assert.False(assessment.IsWithinSeason);
    }

    // ---- Crop name resolution -----------------------------------------------

    [Theory]
    [InlineData("Maize", "maize")]
    [InlineData("maize", "maize")]
    [InlineData("  MAIZE  ", "maize")]
    [InlineData("Potatoes", "potato")]
    [InlineData("Tomatoes", "tomato")]
    [InlineData("Citrus", "citrus")]
    [InlineData("Lettuce", "leafy_veg")]
    [InlineData("Leafy Veg", "leafy_veg")]
    [InlineData("Dry Beans", "dry_beans")]
    public void CropAliases_ResolveToTheRightKnowledgeEntry(string input, string expectedKey)
    {
        var crop = Fao56Knowledge.TryResolve(input);
        Assert.NotNull(crop);
        Assert.Equal(expectedKey, crop!.Key);
    }

    [Theory]
    // These three are in the admin dashboard's crop list but NOT in FAO-56's
    // six here. Resolving to null is the correct behaviour: the advisor then
    // degrades to moisture-only rather than substituting another crop's curve.
    [InlineData("Grapes")]
    [InlineData("Wheat")]
    [InlineData("Apples")]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData(null)]
    public void UnknownCrop_ResolvesToNullRatherThanASubstitute(string? cropType)
    {
        Assert.Null(Fao56Knowledge.TryResolve(cropType));
    }

    // ---- The depletion-fraction adjustment ----------------------------------

    [Fact]
    public void DepletionFraction_TightensAsEtcRises()
    {
        // FAO-56 p. 162: p = p_Table22 + 0.04 (5 - ETc), bounded to [0.1, 0.8].
        // Maize tabulates p = 0.55 at ETc ~ 5 mm/day.
        Assert.Equal(0.55, Fao56Knowledge.AdjustDepletionFractionForEtc(0.55, 5.0), precision: 4);
        Assert.Equal(0.43, Fao56Knowledge.AdjustDepletionFractionForEtc(0.55, 8.0), precision: 4);  // hot: tolerates less
        Assert.Equal(0.63, Fao56Knowledge.AdjustDepletionFractionForEtc(0.55, 3.0), precision: 4);  // mild: tolerates more
    }

    [Fact]
    public void DepletionFraction_RespectsThePublishedBounds()
    {
        Assert.Equal(0.8, Fao56Knowledge.AdjustDepletionFractionForEtc(0.55, -10.0), precision: 4);
        Assert.Equal(0.1, Fao56Knowledge.AdjustDepletionFractionForEtc(0.30, 20.0), precision: 4);
    }
}
