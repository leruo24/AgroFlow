using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using System.Text.RegularExpressions;
using AgroFlow.Business.Agronomy;
using AgroFlow.Business.Agronomy.RuleBook;
using Xunit;
using Xunit.Abstractions;

namespace AgroFlow.Domain.Tests;

// Item 2c: every insight type carries a "Why am I seeing this?" built from
// the same inputs, in plain words.
public class ExplanationTests
{
    private readonly ITestOutputHelper _out;
    public ExplanationTests(ITestOutputHelper output) { _out = output; }

    private static readonly DateOnly Today = new DateOnly(2026, 2, 10);
    private static readonly DateTime ReadingAt = DateTime.SpecifyKind(Today.ToDateTime(new TimeOnly(6, 0)), DateTimeKind.Utc);

    // Words a farmer should never meet outside the technical section.
    private static readonly Regex Jargon = new Regex(
        @"\b(ETc|ETo|ET0|Eq\.|Tmin|Tmax|Kc|Ks|RAW|TAW|Dr|moisture_threshold|calibration_wet|calibration_dry|depletion)\b|\d{4}-\d{2}-\d{2}",
        RegexOptions.Compiled);

    private static ZoneEngineInput Zone(Action<ZoneEngineInput>? change = null)
    {
        var input = new ZoneEngineInput
        {
            ZoneId = 1, ZoneName = "Tub 1", CropType = "maize", PlantingDate = Today.AddDays(-60),
            SoilType = "loam", AreaM2 = 1.5, FlowRateLpm = 1.5, RootDepthLimitM = 0.3,
            CalibrationWet = 1200, CalibrationDry = 3000, MoistureThreshold = 2000, DesiredMoisture = 1500,
            FarmLatitudeDegrees = -33.93, Today = Today, NowUtc = ReadingAt.AddHours(2),
        };
        for (var i = 9; i >= 0; i--)
        {
            input.Weather.Add(new ZoneWeatherDay
            {
                Date = Today.AddDays(-i), TMinC = 14, TMaxC = 28, RainMm = 0, RhMinPct = 40, RhMaxPct = 80, WindMs = 2.5, WindHeightM = 10,
            });
        }
        for (var i = 1; i <= 3; i++)
        {
            input.Weather.Add(new ZoneWeatherDay
            {
                Date = Today.AddDays(i), TMinC = 20, TMaxC = 38, RainMm = 0, RhMinPct = 15, RhMaxPct = 50, WindMs = 4, WindHeightM = 10, IsForecast = true,
            });
        }
        input.Readings.Add(new ZoneMoistureReading { RecordedAtUtc = ReadingAt, RawValue = 2100 });
        change?.Invoke(input);
        return input;
    }

    private static List<(string Scenario, ZoneEngineInput Input, ZoneEngineResult Result, ZoneInsight Insight)> AllScenarios()
    {
        var runs = new List<(string, ZoneEngineInput, ZoneFaultSignals)>
        {
            ("dry zone", Zone(i => i.Readings[0].RawValue = 2950), new ZoneFaultSignals()),
            ("rain today", Zone(i => { i.Readings[0].RawValue = 2950; i.Weather.First(w => w.Date == Today).RainMm = 25; }), new ZoneFaultSignals()),
            ("wet zone, forecast", Zone(i => { i.Readings[0].RawValue = 1250; i.Weather.Where(w => w.Date < Today).ToList().ForEach(w => w.RainMm = 15); }), new ZoneFaultSignals { TrailingSevenDayMeanEto = 2.0 }),
            ("water soon", Zone(i =>
            {
                i.CalibrationWet = null; i.CalibrationDry = null; i.Readings.Clear();
                i.Weather.Where(w => w.Date < Today).ToList().ForEach(w => w.RainMm = 6);
            }), new ZoneFaultSignals()),
            ("no planting date", Zone(i => i.PlantingDate = null), new ZoneFaultSignals()),
            ("unsafe threshold", Zone(i => i.MoistureThreshold = 2900), new ZoneFaultSignals()),
            ("data gap", Zone(i => { var d = i.Weather.First(w => w.Date == Today.AddDays(-3)); d.TMinC = null; d.TMaxC = null; }), new ZoneFaultSignals()),
            ("early season", Zone(i => i.PlantingDate = Today.AddDays(-20)), new ZoneFaultSignals()),
            ("peak", Zone(i => i.PlantingDate = Today.AddDays(-70)), new ZoneFaultSignals()),
            ("harvest soon", Zone(i => i.PlantingDate = Today.AddDays(-130)), new ZoneFaultSignals()),
            ("season over", Zone(i => i.PlantingDate = Today.AddDays(-160)), new ZoneFaultSignals()),
            ("every fault", Zone(), new ZoneFaultSignals
            {
                SinceLastReading = TimeSpan.FromHours(5), IdenticalReadingFor = TimeSpan.FromHours(9),
                WateringAppearedToFail = true, FailedRunAtUtc = ReadingAt, DhtOffline = true, DhtOfflineSinceUtc = ReadingAt.AddHours(-3),
                SevenDayMinimumReading = 1900, SevenDayIrrigationMm = 400,
            }),
        };

        var all = new List<(string, ZoneEngineInput, ZoneEngineResult, ZoneInsight)>();
        foreach (var (name, input, signals) in runs)
        {
            var result = Fao56Engine.Run(input);
            foreach (var insight in ZoneInsightBuilder.Build(input, result, signals))
            {
                all.Add((name, input, result, insight));
            }
        }
        return all;
    }

    private static IEnumerable<string> AllInsightTypes() =>
        typeof(InsightType).GetFields(BindingFlags.Public | BindingFlags.Static)
            .Where(f => f.IsLiteral).Select(f => (string)f.GetRawConstantValue()!);

    [Fact]
    public void TheScenarios_CoverEveryInsightType()
    {
        var seen = AllScenarios().Select(s => s.Insight.InsightType).ToHashSet();
        var missing = AllInsightTypes().Where(t => !seen.Contains(t)).ToList();
        Assert.True(missing.Count == 0, "No scenario produced: " + string.Join(", ", missing));
    }

    [Fact]
    public void EveryInsight_HasACompleteExplanation()
    {
        foreach (var (scenario, _, _, insight) in AllScenarios())
        {
            var e = insight.Explanation;
            Assert.True(e != null, $"{insight.InsightType} ({scenario}) has no explanation");
            Assert.False(string.IsNullOrWhiteSpace(e!.Summary), $"{insight.InsightType}: empty summary");
            Assert.False(string.IsNullOrWhiteSpace(e.Rule), $"{insight.InsightType}: empty rule");
            Assert.False(string.IsNullOrWhiteSpace(e.Confidence), $"{insight.InsightType}: empty confidence");
            Assert.False(string.IsNullOrWhiteSpace(e.WhatWouldChangeIt), $"{insight.InsightType}: empty what-would-change-it");
            Assert.False(string.IsNullOrWhiteSpace(e.Technical), $"{insight.InsightType}: empty technical");
            Assert.True(e.Facts.Count > 0, $"{insight.InsightType} ({scenario}) has no facts");
            Assert.All(e.Facts, f =>
            {
                Assert.False(string.IsNullOrWhiteSpace(f.Label));
                Assert.False(string.IsNullOrWhiteSpace(f.Value));
                Assert.False(string.IsNullOrWhiteSpace(f.Source));
            });
        }
    }

    [Fact]
    public void NoJargon_OutsideTheTechnicalSection()
    {
        foreach (var (scenario, _, _, insight) in AllScenarios())
        {
            var e = insight.Explanation!;
            var plain = new[] { e.Summary, e.Rule, e.Confidence, e.WhatWouldChangeIt ?? "" }
                .Concat(e.Facts.SelectMany(f => new[] { f.Label, f.Value, f.Source }));
            foreach (var text in plain)
            {
                var m = Jargon.Match(text);
                Assert.False(m.Success, $"{insight.InsightType} ({scenario}): jargon \"{m.Value}\" in \"{text}\"");
            }
        }
    }

    [Fact]
    public void WaterNow_FactsAreTheInputsItUsed()
    {
        var s = AllScenarios().First(x => x.Scenario == "dry zone" && x.Insight.InsightType == InsightType.WaterNow);
        var e = s.Insight.Explanation!;
        _out.WriteLine(e.Summary);
        foreach (var f in e.Facts) _out.WriteLine($"  {f.Label}: {f.Value} ({f.Source})");
        _out.WriteLine("  Rule: " + e.Rule);

        Assert.Contains(e.Facts, f => f.Label == "Crop" && f.Value == "Maize");
        Assert.Contains(e.Facts, f => f.Label == "Soil" && f.Value.StartsWith("Loam"));
        Assert.Contains(e.Facts, f => f.Label == "Rain expected today" && f.Value == "0 mm");
        Assert.Contains(e.Facts, f => f.Label == "How dry the soil is" && f.Value.Contains(Math.Round(s.Result.DepletionMm!.Value, 1).ToString("0.#", System.Globalization.CultureInfo.InvariantCulture)));
        Assert.Contains(e.Facts, f => f.Label == "How much" && f.Value.Contains(s.Result.RecommendedMinutes!.Value + " min"));
        // The rule quotes the share of soil water actually used for this crop and soil today.
        Assert.Contains(Math.Round(s.Result.AdjustedP!.Value * 100).ToString(System.Globalization.CultureInfo.InvariantCulture) + "%", e.Rule);
    }

    [Fact]
    public void SkipRain_QuotesTheRainAndTheNeed()
    {
        var s = AllScenarios().First(x => x.Insight.InsightType == InsightType.SkipRain);
        var e = s.Insight.Explanation!;
        Assert.Contains(e.Facts, f => f.Label == "Rain expected today" && f.Value == "25 mm");
        Assert.Contains("25 mm", e.Summary);
    }

    [Fact]
    public void KitProblems_QuoteTheirOwnThresholdsAndValues()
    {
        var fault = AllScenarios().Where(x => x.Scenario == "every fault").ToDictionary(x => x.Insight.InsightType, x => x.Insight.Explanation!);

        Assert.Contains("5 hours", fault[InsightType.ZoneOffline].Summary);
        Assert.Contains($"{KitRules.ZoneOfflineHours} hours", fault[InsightType.ZoneOffline].Rule);
        Assert.Contains("9 hours", fault[InsightType.SensorStuck].Summary);
        Assert.Contains($"{KitRules.SensorStuckHours} hours", fault[InsightType.SensorStuck].Rule);
        Assert.Contains(fault[InsightType.SensorDrift].Facts, f => f.Value == "1900");
    }

    [Fact]
    public void UncalibratedReading_IsNeverAPercentageInAnExplanation()
    {
        var input = Zone(i => { i.CalibrationWet = null; i.CalibrationDry = null; i.MoistureThreshold = 30; });
        var result = Fao56Engine.Run(input);
        foreach (var insight in ZoneInsightBuilder.Build(input, result, new ZoneFaultSignals()))
        {
            var reading = insight.Explanation!.Facts.FirstOrDefault(f => f.Label == "Soil sensor");
            if (reading != null)
            {
                Assert.Contains("not yet set up", reading.Value);
                Assert.DoesNotContain("%", reading.Value);
            }
        }
    }

    [Fact]
    public void AssumedStage_IsLabelledInTheExplanation()
    {
        var s = AllScenarios().First(x => x.Scenario == "no planting date" && x.Insight.InsightType == InsightType.GrowthStatus);
        Assert.Contains(s.Insight.Explanation!.Facts, f => f.Label == "Planting date" && f.Value == "not set yet");
        Assert.Contains("assume", s.Insight.Explanation.Summary);
    }
}
