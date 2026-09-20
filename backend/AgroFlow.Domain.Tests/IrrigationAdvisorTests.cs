using AgroFlow.Business.Agronomy;

namespace AgroFlow.Domain.Tests;

// End-to-end behaviour of the advice engine, on fabricated inputs only.
// Nothing here touches a database, a network or a clock.
public class IrrigationAdvisorTests
{
    // A realistic Western Cape zone: Cape Town latitude, maize planted in
    // spring, mid-season, soil drying out, rain coming.
    private static ZoneAdviceInput RealisticMaizeZone()
    {
        var today = new DateOnly(2026, 1, 20);

        return new ZoneAdviceInput
        {
            ZoneName = "North Field",
            CropType = "Maize",
            PlantingDate = new DateOnly(2025, 10, 1), // 111 days before -> mid-season
            AsOf = today,
            SoilMoisturePercent = 26,
            MoistureThresholdPercent = 30,
            FarmLatitudeDegrees = -33.9,
            LatestWeather = new DailyWeather(today, 14.0, 31.0, 0.0, isForecast: false),
            Forecast = new[]
            {
                new DailyWeather(today.AddDays(1), 15, 30, 0.0, true),
                new DailyWeather(today.AddDays(2), 16, 29, 0.0, true),
                new DailyWeather(today.AddDays(3), 14, 24, 8.0, true), // Friday rain
            },
        };
    }

    [Fact]
    public void RealisticZone_ProducesStageAwareAdviceWithEveryNumberSourced()
    {
        var advice = IrrigationAdvisor.Advise(RealisticMaizeZone());

        Assert.Equal(AdviceAction.IrrigateNow, advice.Action);
        Assert.NotNull(advice.Stage);
        Assert.Equal(GrowthStage.MidSeason, advice.Stage!.Stage);
        Assert.Equal(111, advice.Stage.DaysAfterPlanting);
        Assert.Equal(150, advice.Stage.SeasonLengthDays);
        Assert.Equal(1.20, advice.Stage.Kc, precision: 4); // Kc_mid for maize, Table 12 p. 111

        Assert.NotNull(advice.Et0MmPerDay);
        Assert.NotNull(advice.EtcMmPerDay);

        // ETc must be exactly Kc * ET0 - no fudge factor anywhere.
        Assert.Equal(advice.Stage.Kc * advice.Et0MmPerDay!.Value, advice.EtcMmPerDay!.Value, precision: 9);

        // Every reported quantity carries a non-empty provenance string.
        Assert.NotEmpty(advice.Facts);
        Assert.All(advice.Facts, f => Assert.False(string.IsNullOrWhiteSpace(f.Source)));

        // And the headline reads like the brief's example.
        Assert.Contains("North Field", advice.Summary);
        Assert.Contains("Mid-season", advice.Summary);
        Assert.Contains("Irrigate today", advice.Summary);
    }

    [Fact]
    public void MidSeasonAdvice_SaysDemandIsAtItsPeak_AndCitesFao56()
    {
        var advice = IrrigationAdvisor.Advise(RealisticMaizeZone());

        Assert.Contains(advice.Insights, i => i.Contains("peak") && i.Contains("FAO-56"));
        Assert.All(advice.Insights, i => Assert.Contains("FAO-56", i));
    }

    [Fact]
    public void ForecastRain_IsOfferedAgainstTodaysEtc()
    {
        var advice = IrrigationAdvisor.Advise(RealisticMaizeZone());
        Assert.Contains(advice.Reasoning, r => r.Contains("8 mm forecast") || r.Contains("days of demand"));
        Assert.Contains("may cover the next cycle", advice.Summary);
    }

    // ---- 3c: null planting date must degrade, not guess and not fail --------

    [Fact]
    public void NullPlantingDate_FallsBackToMoistureOnly_AndSaysSoPlainly()
    {
        var input = RealisticMaizeZone();
        input.PlantingDate = null;

        var advice = IrrigationAdvisor.Advise(input);

        // Still gives usable advice...
        Assert.Equal(AdviceAction.IrrigateNow, advice.Action);
        Assert.NotEmpty(advice.Summary);

        // ...but no invented stage, and no invented Kc or ETc.
        Assert.Null(advice.Stage);
        Assert.Null(advice.EtcMmPerDay);

        // ...and says exactly why, in words a farmer can act on.
        Assert.Contains(advice.Limitations, l => l.Contains("planting date"));
    }

    [Fact]
    public void UnknownCrop_DegradesWithoutSubstitutingAnotherCropsCurve()
    {
        var input = RealisticMaizeZone();
        input.CropType = "Grapes"; // in the admin crop list, not in FAO-56's six here

        var advice = IrrigationAdvisor.Advise(input);

        Assert.Null(advice.Stage);
        Assert.Null(advice.EtcMmPerDay);
        Assert.Contains(advice.Limitations, l => l.Contains("No substitute crop was used"));
        Assert.Equal(AdviceAction.IrrigateNow, advice.Action); // moisture trigger still works
    }

    [Fact]
    public void NoWeatherRow_StillGivesStageAndKcButNoEtc()
    {
        var input = RealisticMaizeZone();
        input.LatestWeather = null;

        var advice = IrrigationAdvisor.Advise(input);

        Assert.NotNull(advice.Stage);
        Assert.Equal(1.20, advice.Stage!.Kc, precision: 4);
        Assert.Null(advice.Et0MmPerDay);
        Assert.Null(advice.EtcMmPerDay);
        Assert.Contains(advice.Limitations, l => l.Contains("No weather row"));
    }

    [Fact]
    public void NoFarmCoordinates_ReportsWhyEt0IsMissing()
    {
        var input = RealisticMaizeZone();
        input.FarmLatitudeDegrees = null;

        var advice = IrrigationAdvisor.Advise(input);

        Assert.Null(advice.Et0MmPerDay);
        Assert.Contains(advice.Limitations, l => l.Contains("latitude"));
    }

    [Fact]
    public void NoMoistureReading_RefusesToRecommendRatherThanGuessing()
    {
        var input = RealisticMaizeZone();
        input.SoilMoisturePercent = null;

        var advice = IrrigationAdvisor.Advise(input);

        Assert.Equal(AdviceAction.InsufficientData, advice.Action);
        Assert.Contains(advice.Limitations, l => l.Contains("No soil moisture reading"));
    }

    [Fact]
    public void MoistureAboveThreshold_RecommendsNoAction()
    {
        var input = RealisticMaizeZone();
        input.SoilMoisturePercent = 45;

        var advice = IrrigationAdvisor.Advise(input);

        Assert.Equal(AdviceAction.NoActionNeeded, advice.Action);
        Assert.Contains("No irrigation needed today", advice.Summary);
    }

    [Fact]
    public void BadWeatherRow_WithTmaxBelowTmin_IsRejectedNotComputed()
    {
        var input = RealisticMaizeZone();
        input.LatestWeather = new DailyWeather(input.AsOf, 30.0, 12.0, 0.0, false);

        var advice = IrrigationAdvisor.Advise(input);

        Assert.Null(advice.Et0MmPerDay);
        Assert.Contains(advice.Limitations, l => l.Contains("Tmax below Tmin"));
    }

    // ---- Stage-specific insights -------------------------------------------

    [Fact]
    public void ApproachingMidSeason_WarnsThatDemandWillRise()
    {
        var input = RealisticMaizeZone();
        // 5 days short of maize mid-season (which opens at dap 70).
        input.PlantingDate = input.AsOf.AddDays(-65);

        var advice = IrrigationAdvisor.Advise(input);

        Assert.Equal(GrowthStage.Development, advice.Stage!.Stage);
        Assert.Contains(advice.Insights, i => i.Contains("Entering mid-season in about 5 day"));
    }

    [Fact]
    public void MaizeLateSeason_OffersFao56DryDownAlternative()
    {
        var input = RealisticMaizeZone();
        input.PlantingDate = input.AsOf.AddDays(-130); // late season (opens at dap 120)

        var advice = IrrigationAdvisor.Advise(input);

        Assert.Equal(GrowthStage.LateSeason, advice.Stage!.Stage);
        Assert.Contains(advice.Insights, i => i.Contains("field drying") || i.Contains("dry this crop down"));
    }

    [Fact]
    public void LeafyVegLateSeason_SaysDryDownIsNotAppropriate()
    {
        var input = RealisticMaizeZone();
        input.CropType = "Lettuce";
        input.PlantingDate = input.AsOf.AddDays(-70); // lettuce late season opens at dap 65

        var advice = IrrigationAdvisor.Advise(input);

        Assert.Equal(GrowthStage.LateSeason, advice.Stage!.Stage);
        Assert.Contains(advice.Insights, i => i.Contains("not appropriate"));
    }

    [Fact]
    public void TomatoLateSeason_DisclosesThatKcEndIsAMidpointOfAPublishedRange()
    {
        var input = RealisticMaizeZone();
        input.CropType = "Tomato";
        input.PlantingDate = input.AsOf.AddDays(-120); // tomato late season opens at dap 115

        var advice = IrrigationAdvisor.Advise(input);

        Assert.Equal(GrowthStage.LateSeason, advice.Stage!.Stage);
        Assert.Contains(advice.Insights, i => i.Contains("0.70 to 0.90"));
    }

    [Fact]
    public void Citrus_CarriesTheKcShapeWarningSoTheInvertedCurveIsNotReadAsABug()
    {
        var input = RealisticMaizeZone();
        input.CropType = "Citrus";
        input.PlantingDate = input.AsOf.AddDays(-200);

        var advice = IrrigationAdvisor.Advise(input);

        Assert.Contains(advice.Insights, i => i.Contains("LOWER than its Kc_ini"));
    }

    [Fact]
    public void DepletionFractionContext_IsReportedButNeverUsedAsTheTrigger()
    {
        var advice = IrrigationAdvisor.Advise(RealisticMaizeZone());

        Assert.Contains(advice.Insights, i => i.Contains("depletion fraction p"));
        Assert.Contains(advice.Limitations, l => l.Contains("context only"));
    }

    [Fact]
    public void Advice_IsDeterministic()
    {
        // The whole selling point: same inputs, same words, every time. No LLM,
        // no sampling, no clock read inside the engine.
        var a = IrrigationAdvisor.Advise(RealisticMaizeZone());
        var b = IrrigationAdvisor.Advise(RealisticMaizeZone());

        Assert.Equal(a.Summary, b.Summary);
        Assert.Equal(a.Insights, b.Insights);
        Assert.Equal(a.Reasoning, b.Reasoning);
    }

    [Theory]
    [InlineData("Maize")]
    [InlineData("Potatoes")]
    [InlineData("Tomato")]
    [InlineData("Citrus")]
    [InlineData("Lettuce")]
    [InlineData("Dry Beans")]
    public void EverySupportedCrop_ProducesAdviceAtEveryStageWithoutThrowing(string cropType)
    {
        var crop = Fao56Knowledge.TryResolve(cropType)!;

        for (var dap = 0; dap <= crop.StageLengths.TotalDays; dap += 5)
        {
            var input = RealisticMaizeZone();
            input.CropType = cropType;
            input.PlantingDate = input.AsOf.AddDays(-dap);

            var advice = IrrigationAdvisor.Advise(input);

            Assert.NotEmpty(advice.Summary);
            Assert.All(advice.Facts, f => Assert.False(string.IsNullOrWhiteSpace(f.Source)));
        }
    }
}

public class WaterUsageEstimatorTests
{
    [Fact]
    public void EventLitres_IsRuntimeTimesFlowRate()
    {
        // 30 minutes at 20 L/min = 600 L.
        var estimate = WaterUsageEstimator.EstimateEventLitres(1800, 20.0);

        Assert.NotNull(estimate);
        Assert.Equal(600.0, estimate!.Litres, precision: 6);
        Assert.True(estimate.IsEstimate);
        Assert.Contains("no flow meter", estimate.Basis);
    }

    [Fact]
    public void NoFlowRateConfigured_ReturnsNullRatherThanGuessingARate()
    {
        Assert.Null(WaterUsageEstimator.EstimateEventLitres(1800, null));
    }

    [Fact]
    public void NegativeRuntime_Throws()
    {
        Assert.Throws<ArgumentOutOfRangeException>(
            () => WaterUsageEstimator.EstimateEventLitres(-1, 20.0));
    }

    [Fact]
    public void NegativeFlowRate_Throws()
    {
        Assert.Throws<ArgumentOutOfRangeException>(
            () => WaterUsageEstimator.EstimateEventLitres(60, -5.0));
    }

    [Theory]
    [InlineData(0, true)]
    [InlineData(1800, true)]
    [InlineData(21600, true)]   // exactly 6 hours
    [InlineData(21601, false)]  // absurd: a stuck valve, not a cycle
    [InlineData(-1, false)]
    public void RuntimePlausibilityBound(int seconds, bool expected)
    {
        Assert.Equal(expected, WaterUsageEstimator.IsPlausibleRuntime(seconds));
    }

    [Fact]
    public void OneMillimetreOverOneHectare_IsTenThousandLitres()
    {
        Assert.Equal(10000.0, WaterUsageEstimator.MillimetresToLitres(1.0, 1.0), precision: 6);
        Assert.Equal(27000.0, WaterUsageEstimator.MillimetresToLitres(5.4, 0.5), precision: 6);
    }
}
