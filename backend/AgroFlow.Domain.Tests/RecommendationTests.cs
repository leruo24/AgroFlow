using System;
using System.Collections.Generic;
using AgroFlow.Api.Endpoints;
using AgroFlow.Api.Reports;
using AgroFlow.Business.Agronomy;
using AgroFlow.Business.Agronomy.RuleBook;
using Microsoft.AspNetCore.Http;
using Xunit;

namespace AgroFlow.Domain.Tests;

// Item 6b: "Recommended for you", and the farmer changing the crop.
public class RecommendationTests
{
    private static readonly DateOnly October = new DateOnly(2026, 10, 6);

    private static Recommendation Potato(double? eto = 5, string? basis = "the last 30 days", string? soil = "loam",
        int? day = null, double? depthLimit = null) =>
        RecommendationRules.For("potato", soil, day, eto, basis, 0.2, 1.5, depthLimit, "Mafikeng", October)!;

    [Fact]
    public void The_card_numbers_are_the_rule_book_calculation_for_fixed_inputs()
    {
        // potato, loam, 0.2 m², 1.5 L/min, ETo 5 mm/day, stage unknown.
        var crop = Fao56EngineReference.TryResolveCrop("potato")!;
        var loam = Fao56EngineReference.TryResolveSoil("loam")!;

        var pr = Math.Clamp(crop.DepletionFractionP * loam.PFactor, 0.1, 0.8);
        var kc = Math.Max(crop.KcMid, Math.Max(crop.KcIni, crop.KcEnd));
        var etc = kc * 5;
        var pAdj = SoilWaterBalance.AdjustP(crop.DepletionFractionP, loam.PFactor, etc);
        var taw = 1000 * (loam.ThetaFieldCapacity - loam.ThetaWiltingPoint) * crop.RootDepthM;
        var raw = pAdj * taw;

        var r = Potato();
        Assert.Equal((int)Math.Round((1 - pr) * 100, MidpointRounding.AwayFromZero), r.ThresholdPercent);
        Assert.Equal(100, r.StopPercent);
        Assert.Equal(raw, r.RawMm, 6);
        Assert.Equal((int)Math.Floor(raw / etc), r.IntervalDaysLow);
        Assert.Equal((int)Math.Ceiling(raw / etc), r.IntervalDaysHigh);
        Assert.Equal((int)Math.Ceiling(raw * 0.2 / 1.5), r.Minutes);
        Assert.True(r.StageAssumed);

        Assert.StartsWith("Based on your climate in Mafikeng and since you want to grow potato on loam soil, we recommend:", r.Text);
        Assert.Contains($"water when the soil reaches about {r.ThresholdPercent}% (relative), stop at 100%", r.Text);
        Assert.Contains($"in October, about {r.Minutes} minutes each time for this 0.2 m² irrigation zone.", r.Text);
        Assert.DoesNotContain("tub", r.Text, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void The_threshold_is_exactly_what_Use_these_settings_saves()
    {
        // RecommendedThreshold on a 100-to-0 span is the relative percentage.
        var crop = Fao56EngineReference.TryResolveCrop("potato")!;
        foreach (var soil in new[] { "sandy", "loam", "clay" })
        {
            var pf = SoilRules.DepletionFactorAdjust(soil);
            var saved = WaterRules.RecommendedThreshold(crop.DepletionFractionP, pf, 100, 0);
            Assert.Equal((int)Math.Round(saved, MidpointRounding.AwayFromZero), Potato(soil: soil).ThresholdPercent);
        }
    }

    [Fact]
    public void A_shallow_root_zone_holds_less_and_is_watered_more_often()
    {
        var open = Potato();
        var shallow = Potato(depthLimit: 0.2);
        Assert.Equal(0.2, shallow.RootDepthM);
        Assert.True(shallow.TawMm < open.TawMm);
        Assert.True(shallow.IntervalDaysHigh <= open.IntervalDaysHigh);
    }

    [Fact]
    public void A_known_stage_uses_that_stage_Kc_and_drops_the_assumption()
    {
        var crop = Fao56EngineReference.TryResolveCrop("potato")!;
        var r = Potato(day: 5);
        Assert.False(r.StageAssumed);
        Assert.Equal(CropRules.KcFor(crop, 5), r.Kc, 6);
        Assert.Equal(ConfidenceLevel.High, r.Confidence.Level);
    }

    [Fact]
    public void Missing_inputs_use_the_defaults_and_say_so()
    {
        var noWeather = Potato(eto: null, basis: null);
        Assert.Null(noWeather.IntervalDaysLow);
        Assert.Equal(ConfidenceLevel.Low, noWeather.Confidence.Level);
        Assert.Contains("How often to water will show once the farm's weather has been collected.", noWeather.Text);
        // Minutes still work: RAW on Table 22's own ETc basis (p. 163).
        Assert.NotNull(noWeather.Minutes);

        var noSoil = Potato(soil: null, day: 5);
        Assert.True(noSoil.SoilAssumed);
        Assert.Equal(ConfidenceLevel.Medium, noSoil.Confidence.Level);
        Assert.Contains("loam, assumed", noSoil.Text);

        var stageUnknown = Potato();
        Assert.Equal(ConfidenceLevel.Medium, stageUnknown.Confidence.Level);
        Assert.Contains("planting date is missing", stageUnknown.Confidence.Reason);

        Assert.Null(RecommendationRules.For("dragonfruit", "loam", null, 5, "the last 30 days", 1, 1, null, null, October));
    }

    [Theory]
    [InlineData(20, 4.0, 6.0, 4.0, "the last 30 days")]
    [InlineData(13, 4.0, 6.0, 6.0, "the forecast")]
    [InlineData(5, 4.0, null, 4.0, "the last 5 days")]
    [InlineData(0, null, null, null, null)]
    public void Climate_comes_from_history_then_forecast(long days, double? history, double? forecast, double? expected, string? basis)
    {
        var (eto, b) = RecommendationRules.PickEto(days, history, forecast);
        Assert.Equal(expected, eto);
        Assert.Equal(basis, b);
    }

    [Fact]
    public void Crop_changes_are_checked()
    {
        Assert.Null(RecommendationEndpoints.CheckCropChange(new CropChangeBody("potato", October.AddDays(-10)), October));
        Assert.Null(RecommendationEndpoints.CheckCropChange(new CropChangeBody("Dry beans", null), October));
        Assert.NotNull(RecommendationEndpoints.CheckCropChange(new CropChangeBody("dragonfruit", null), October));
        Assert.NotNull(RecommendationEndpoints.CheckCropChange(new CropChangeBody(null, null), October));
        Assert.NotNull(RecommendationEndpoints.CheckCropChange(new CropChangeBody("potato", October.AddDays(1)), October));
    }

    [Fact]
    public void Past_reports_keep_the_crop_that_was_growing_then()
    {
        // Citrus until 6 Oct 09:00 SAST, potato since.
        var changes = new List<CropChange>
        {
            new(new DateTimeOffset(2026, 10, 6, 9, 0, 0, TimeSpan.FromHours(2)), "citrus", new DateOnly(2025, 3, 1)),
        };

        Assert.Equal(("citrus", (DateOnly?)new DateOnly(2025, 3, 1)),
            CropHistory.AsOf("potato", new DateOnly(2026, 10, 6), changes, new DateOnly(2026, 10, 5)));
        Assert.Equal(("potato", (DateOnly?)new DateOnly(2026, 10, 6)),
            CropHistory.AsOf("potato", new DateOnly(2026, 10, 6), changes, new DateOnly(2026, 10, 6)));
        Assert.Equal(("potato", (DateOnly?)null), CropHistory.AsOf("potato", null, new List<CropChange>(), new DateOnly(2020, 1, 1)));

        // Two changes: the first one after the day wins.
        changes.Add(new(new DateTimeOffset(2026, 10, 8, 9, 0, 0, TimeSpan.FromHours(2)), "potato", null));
        Assert.Equal("citrus", CropHistory.AsOf("maize", null, changes, new DateOnly(2026, 10, 1)).Crop);
        Assert.Equal("potato", CropHistory.AsOf("maize", null, changes, new DateOnly(2026, 10, 7)).Crop);

        var parsed = CropHistory.Parse(DateTimeOffset.UnixEpoch, "{\"from\":\"citrus\",\"fromPlanting\":\"2025-03-01\",\"to\":\"potato\"}");
        Assert.Equal("citrus", parsed.From);
        Assert.Equal(new DateOnly(2025, 3, 1), parsed.FromPlanting);
    }

    [Fact]
    public void The_activity_reads_Crop_changed_from_Citrus_to_Potato_by_the_farmer()
    {
        var sentence = AuditLogEndpoints.Summarise("Thandi", "zone.crop_changed", "zone", "11", "Alpha Farm",
            "{\"from\":\"citrus\",\"to\":\"potato\",\"fromLabel\":\"Citrus\",\"toLabel\":\"Potato\",\"actorRole\":\"farm_user\"}");
        Assert.Equal("Crop changed from Citrus to Potato by Thandi at Alpha Farm", sentence);

        Assert.Equal("Planting date changed to 2026-09-01 by Thandi",
            AuditLogEndpoints.Summarise("Thandi", "zone.crop_changed", "zone", "11", null,
                "{\"fromLabel\":\"Potato\",\"toLabel\":\"Potato\",\"toPlanting\":\"2026-09-01\"}"));
    }

    [Fact]
    public void Changing_another_farmers_zone_is_refused_with_403()
    {
        Assert.Equal(StatusCodes.Status403Forbidden,
            ((IStatusCodeHttpResult)RecommendationEndpoints.Refusal(zoneExists: true, canAccess: false)!).StatusCode);
        Assert.Equal(StatusCodes.Status404NotFound,
            ((IStatusCodeHttpResult)RecommendationEndpoints.Refusal(zoneExists: false, canAccess: false)!).StatusCode);
        Assert.Null(RecommendationEndpoints.Refusal(zoneExists: true, canAccess: true));
    }
}
