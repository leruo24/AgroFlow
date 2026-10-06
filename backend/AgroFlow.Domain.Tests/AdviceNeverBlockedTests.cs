using System;
using System.Linq;
using AgroFlow.Api.Endpoints;
using AgroFlow.Business.Agronomy;
using AgroFlow.Business.Agronomy.RuleBook;
using Xunit;
using Xunit.Abstractions;

namespace AgroFlow.Domain.Tests;

// Item 2: advice is never blocked by a half-finished setup. Each missing input
// lowers the confidence and names one next step instead of switching the
// advice off.
//
// In memory only - nothing touches a database.
public class AdviceNeverBlockedTests
{
    private readonly ITestOutputHelper _out;

    public AdviceNeverBlockedTests(ITestOutputHelper output)
    {
        _out = output;
    }

    private static readonly DateOnly Today = new DateOnly(2026, 2, 10);
    private static readonly DateTime ReadingAt =
        DateTime.SpecifyKind(Today.ToDateTime(new TimeOnly(6, 0)), DateTimeKind.Utc);

    // Fully set up, with a fresh reading. Tests take things away from it.
    private static ZoneEngineInput FullZone()
    {
        var input = new ZoneEngineInput
        {
            ZoneId = 1,
            ZoneName = "Tub 1",
            CropType = "maize",
            PlantingDate = Today.AddDays(-60),
            SoilType = "loam",
            AreaM2 = 1.5,
            FlowRateLpm = 1.5,
            RootDepthLimitM = 0.3,
            CalibrationWet = 1200,
            CalibrationDry = 3000,
            MoistureThreshold = 30,
            DesiredMoisture = 60,
            FarmLatitudeDegrees = -33.93,
            Today = Today,
            NowUtc = ReadingAt.AddHours(2),
        };

        for (var i = 9; i >= 0; i--)
        {
            input.Weather.Add(new ZoneWeatherDay
            {
                Date = Today.AddDays(-i),
                TMinC = 14.0,
                TMaxC = 28.0,
                RainMm = 0.0,
                RhMinPct = 40,
                RhMaxPct = 80,
                WindMs = 2.5,
                WindHeightM = 10.0,
            });
        }

        input.Readings.Add(new ZoneMoistureReading { RecordedAtUtc = ReadingAt, RawValue = 2400 });
        return input;
    }

    // Crop and weather only: the minimum the item says must still give advice.
    private static ZoneEngineInput CropAndWeatherOnly()
    {
        var input = FullZone();
        input.PlantingDate = null;
        input.SoilType = null;
        input.AreaM2 = null;
        input.FlowRateLpm = null;
        input.CalibrationWet = null;
        input.CalibrationDry = null;
        input.Readings.Clear();
        return input;
    }

    [Fact]
    public void CropAndWeatherOnly_StillGivesAdvice_WithLowConfidenceAndOneNextStep()
    {
        var result = Fao56Engine.Run(CropAndWeatherOnly());

        Assert.True(result.BalanceRan);
        Assert.NotNull(result.DepletionMm);
        Assert.NotNull(result.RecommendedDepthMm);

        // Five inputs missing: past MaxMissingForMedium, so Low.
        Assert.Equal(ConfidenceLevel.Low, result.Confidence.Level);
        Assert.Equal("planting_date", result.NextStep!.Field);
        _out.WriteLine($"     {result.Confidence.Reason} Next: {result.NextStep.Ask}");
    }

    [Fact]
    public void NoPlantingDate_UsesTheAssumedPeakStage_AndSaysSo()
    {
        var input = FullZone();
        input.PlantingDate = null;

        var result = Fao56Engine.Run(input);
        var maize = Fao56EngineReference.TryResolveCrop("maize")!;

        Assert.True(result.BalanceRan);
        Assert.True(result.StageAssumed);
        Assert.Null(result.DayOfSeason);
        Assert.Equal(CropRules.KcWhenStageUnknown(maize), result.KcToday);
        Assert.Equal(maize.KcMid, result.KcToday);
        Assert.Equal(ConfidenceLevel.Medium, result.Confidence.Level);
        Assert.Equal("planting_date", result.NextStep!.Field);

        var insights = ZoneInsightBuilder.Build(input, result, new ZoneFaultSignals());
        Assert.Contains(insights, i => i.InsightType == InsightType.GrowthStatus
                                       && i.Message.Contains(CropRules.AssumedStageLabel));

        // Nothing that needs a real date.
        Assert.DoesNotContain(insights, i => i.InsightType == InsightType.StageChange);
        Assert.DoesNotContain(insights, i => i.InsightType == InsightType.HarvestSoon);
        Assert.DoesNotContain(insights, i => i.InsightType == InsightType.PeakGrowth);

        // setup_missing is ONE ask, and a heads-up, not a blocking act_now.
        var setup = insights.Single(i => i.InsightType == InsightType.SetupMissing);
        Assert.Equal(InsightSeverity.HeadsUp, setup.Severity);
        Assert.Equal(result.NextStep.Ask, setup.Message);
    }

    [Fact]
    public void Citrus_WithNoPlantingDate_TakesItsHighestFactor_NotMidSeason()
    {
        // Citrus is the one crop whose mid-season Kc (0.65) is below its
        // initial one (0.70) - FAO-56 Table 12 p. 113.
        var citrus = Fao56EngineReference.TryResolveCrop("citrus")!;
        Assert.True(citrus.KcMid < citrus.KcIni);
        Assert.Equal(citrus.KcIni, CropRules.KcWhenStageUnknown(citrus));
    }

    [Fact]
    public void FullSetup_WithAFreshReading_IsHigh_AndHasNoNextStep()
    {
        var result = Fao56Engine.Run(FullZone());

        Assert.Equal(ConfidenceLevel.High, result.Confidence.Level);
        Assert.Null(result.NextStep);
    }

    [Fact]
    public void StaleReading_LowersConfidence_AndAdviceComesFromTheWeather()
    {
        var input = FullZone();
        input.NowUtc = ReadingAt.AddHours(ConfidenceRules.FreshReadingHours + 6);

        var result = Fao56Engine.Run(input);

        Assert.True(result.ReadingStale);
        Assert.True(result.BalanceRan);
        Assert.Equal(ConfidenceLevel.Medium, result.Confidence.Level);
        // 06:00 UTC is 08:00 SAST on 10 Feb.
        Assert.Contains("hasn't sent data since 10 Feb", result.Confidence.Reason);
        Assert.Equal("kit", result.NextStep!.Field);

        // The stale reading did not start the balance: the dryness is exactly
        // what the weather alone gives, as if there were no reading at all.
        Assert.Contains(result.Facts, f => f.Label == "How dry the soil is now" && f.Source.Contains("full profile"));

        var weatherOnly = FullZone();
        weatherOnly.Readings.Clear();
        Assert.Equal(Fao56Engine.Run(weatherOnly).DepletionMm, result.DepletionMm);
    }

    [Fact]
    public void StaleDryReading_DoesNotOnItsOwnSayWaterNow()
    {
        var input = FullZone();
        input.Readings[0].RawValue = 2950; // very dry, but a day and a half old
        // Rain every day until yesterday kept the soil wet; today is dry, so
        // neither "skip, it's raining" nor the balance says water.
        input.Weather.ForEach(w => w.RainMm = w.Date < Today ? 20.0 : 0.0);
        input.NowUtc = ReadingAt.AddHours(36);

        var result = Fao56Engine.Run(input);
        var insights = ZoneInsightBuilder.Build(input, result, new ZoneFaultSignals());

        Assert.True(result.DepletionMm < result.RawMm);
        Assert.DoesNotContain(insights, i => i.InsightType == InsightType.WaterNow);
        Assert.DoesNotContain(insights, i => i.InsightType == InsightType.SkipRain);
    }

    [Fact]
    public void NoArea_GivesMinutesPerSquareMetre()
    {
        var input = FullZone();
        input.AreaM2 = null;
        input.CalibrationWet = null;
        input.CalibrationDry = null; // so ten dry days drive the balance past RAW

        var result = Fao56Engine.Run(input);
        var insights = ZoneInsightBuilder.Build(input, result, new ZoneFaultSignals());
        var water = insights.Single(i => i.InsightType == InsightType.WaterNow);

        Assert.Null(result.RecommendedLitres);
        Assert.Equal(Math.Round(result.DepletionMm!.Value / 1.5, 1), result.RecommendedMinutesPerSquareMetre);
        Assert.Contains("per m²", water.Message);
        Assert.Contains("mm", water.Message);
        _out.WriteLine("     " + water.Message);
    }

    [Fact]
    public void NoAreaAndNoFlow_GivesADepth()
    {
        var input = FullZone();
        input.AreaM2 = null;
        input.FlowRateLpm = null;
        input.CalibrationWet = null;
        input.CalibrationDry = null;

        var result = Fao56Engine.Run(input);
        var water = ZoneInsightBuilder.Build(input, result, new ZoneFaultSignals())
            .Single(i => i.InsightType == InsightType.WaterNow);

        Assert.Null(result.RecommendedMinutesPerSquareMetre);
        Assert.Contains("mm", water.Message);
        Assert.Contains("L per m²", water.Message);
        _out.WriteLine("     " + water.Message);
    }

    [Fact]
    public void Uncalibrated_NoInsightOrFactShowsTheReadingAsAPercentage()
    {
        var input = FullZone();
        input.CalibrationWet = null;
        input.CalibrationDry = null;

        var result = Fao56Engine.Run(input);
        var insights = ZoneInsightBuilder.Build(input, result, new ZoneFaultSignals());

        Assert.Null(result.RelativeMoisturePercent);
        Assert.DoesNotContain(insights, i => i.Message.Contains('%'));
        Assert.DoesNotContain(result.Facts, f => f.Value.Contains('%'));
    }

    [Fact]
    public void UnmeasurableWatering_ResetsTheBalance_WhenItWasARealWatering()
    {
        var input = FullZone();
        input.AreaM2 = null;
        input.FlowRateLpm = null;
        input.CalibrationWet = null;
        input.CalibrationDry = null;
        input.LongestRunSecondsByDay[Today] = WaterRules.FullWateringMinimumSeconds;

        var result = Fao56Engine.Run(input);

        Assert.True(result.BalanceResetByWatering);
        Assert.Equal(0.0, result.DepletionMm);
    }

    [Fact]
    public void UnmeasurableWatering_ShorterThanTwoMinutes_IsNotAWatering()
    {
        var input = FullZone();
        input.AreaM2 = null;
        input.FlowRateLpm = null;
        input.CalibrationWet = null;
        input.CalibrationDry = null;
        input.LongestRunSecondsByDay[Today] = WaterRules.FullWateringMinimumSeconds - 1;

        var result = Fao56Engine.Run(input);

        Assert.False(result.BalanceResetByWatering);
        Assert.True(result.DepletionMm > 0.0);
    }

    [Fact]
    public void MeasurableWatering_IsNeverAlsoAReset()
    {
        // With flow and area the run is already in IrrigationMmByDay; it must
        // not ALSO wipe the balance to full.
        Assert.False(WaterRules.WateringResetsBalance(600, depthMeasurable: true));
    }

    [Fact]
    public void Advisor_FollowsTheBalance_InsteadOfInsufficientData()
    {
        var engineInput = FullZone();
        engineInput.CalibrationWet = null;
        engineInput.CalibrationDry = null;

        var advice = IrrigationAdvisor.Advise(new ZoneAdviceInput
        {
            ZoneName = "Tub 1",
            CropType = "maize",
            PlantingDate = engineInput.PlantingDate,
            AsOf = Today,
            SoilMoisturePercent = null, // uncalibrated: no percentage
            MoistureThresholdPercent = 30,
            FarmLatitudeDegrees = -33.93,
            LatestWeather = new DailyWeather(Today, 14, 28, 0, false),
            WaterBalance = engineInput,
        });

        Assert.Equal(AdviceAction.IrrigateNow, advice.Action);
        Assert.DoesNotContain("No recommendation possible", advice.Summary);
        Assert.DoesNotContain(advice.Reasoning, r => r.StartsWith("Cannot decide:"));
        Assert.NotNull(advice.Confidence);
    }

    [Fact]
    public void Advisor_WithNothingAtAll_NeverSaysNoRecommendationPossible()
    {
        var advice = IrrigationAdvisor.Advise(new ZoneAdviceInput
        {
            ZoneName = "Tub 1",
            AsOf = Today,
        });

        Assert.Equal(AdviceAction.InsufficientData, advice.Action);
        Assert.DoesNotContain("No recommendation possible", advice.Summary);
    }

    [Fact]
    public void ConfidenceRules_NoCrop_IsLow_AndTheNextStepIsTheCrop()
    {
        var state = new ZoneSetupState { WeatherAvailable = true };

        Assert.Equal(ConfidenceLevel.Low, ConfidenceRules.For(state).Level);
        Assert.Equal("crop", ConfidenceRules.NextStep(state)!.Field);
    }

    [Fact]
    public void ConfidenceRules_TwoMissing_IsMedium_ThreeMissing_IsLow()
    {
        var two = new ZoneSetupState
        {
            CropKnown = true, WeatherAvailable = true, PlantingDateKnown = true,
            SoilSet = true, FlowRateSet = true, AreaSet = false, Calibrated = false,
        };
        var three = new ZoneSetupState
        {
            CropKnown = true, WeatherAvailable = true, PlantingDateKnown = true,
            SoilSet = false, FlowRateSet = true, AreaSet = false, Calibrated = false,
        };

        Assert.Equal(ConfidenceLevel.Medium, ConfidenceRules.For(two).Level);
        Assert.Equal(ConfidenceLevel.Low, ConfidenceRules.For(three).Level);
        Assert.Equal("area", ConfidenceRules.NextStep(two)!.Field);
    }

    [Fact]
    public void WaterRules_MinutesPerSquareMetre()
    {
        // 6 mm on 1 m² is 6 L; at 1.5 L/min that is 4 minutes.
        Assert.Equal(4.0, WaterRules.MinutesPerSquareMetre(6.0, 1.5));
        Assert.Null(WaterRules.MinutesPerSquareMetre(6.0, null));
        Assert.Equal(6.0, WaterRules.LitresPerSquareMetre(6.0));
    }

    [Fact]
    public void ReportReadingLabel_Uncalibrated_IsASensorReading_NeverAPercentage()
    {
        var label = ReportEndpoints.ReadingLabel(612, ReadingAt, relativePct: null, fresh: true);

        Assert.Contains("sensor reading", label, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("not yet set up", label);
        Assert.DoesNotContain("%", label);
    }

    [Fact]
    public void ReportReadingLabel_Stale_SaysWhenTheKitLastReported()
    {
        var label = ReportEndpoints.ReadingLabel(40, ReadingAt, relativePct: 40, fresh: false);

        Assert.Contains("40%", label);
        Assert.Contains("Based on the weather", label);
        Assert.Contains("since 10 Feb", label);
    }
}
