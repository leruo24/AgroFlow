using System;
using System.Collections.Generic;
using System.Linq;
using AgroFlow.Business.Agronomy;
using Xunit;
using Xunit.Abstractions;

namespace AgroFlow.Domain.Tests;

// Section 12.7 (data handling rules) and section 8b (DHT11 fault fallback) of the
// engine spec, plus the copy rules from section 7.
//
// Everything here runs in memory. Nothing is seeded into any database - the live
// database is read-only for this work.
public class Fao56EngineDataRulesTests
{
    private readonly ITestOutputHelper _out;

    public Fao56EngineDataRulesTests(ITestOutputHelper output)
    {
        _out = output;
    }

    private static readonly DateOnly Today = new DateOnly(2026, 2, 10);

    // A zone with everything set up, so each test can remove exactly one thing.
    private static ZoneEngineInput CompleteZone()
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
                IsForecast = false,
            });
        }

        input.Readings.Add(new ZoneMoistureReading
        {
            RecordedAtUtc = DateTime.SpecifyKind(Today.ToDateTime(new TimeOnly(6, 0)), DateTimeKind.Utc),
            RawValue = 2400,
        });

        return input;
    }

    // --------------------------------------------------------------------
    // 12.7  An invalid soil reading is excluded from calculations, but kept.
    // --------------------------------------------------------------------
    [Fact]
    public void InvalidReading_IsExcludedFromCalculationsButTheRowIsKept()
    {
        var input = CompleteZone();

        // 9999 is outside the 0-4095 ADC range.
        var bad = new ZoneMoistureReading
        {
            RecordedAtUtc = DateTime.SpecifyKind(Today.ToDateTime(new TimeOnly(7, 0)), DateTimeKind.Utc),
            RawValue = 9999,
        };
        input.Readings.Add(bad);

        var result = Fao56Engine.Run(input);

        // The bad reading is still in the input list - nothing dropped it.
        Assert.Contains(bad, input.Readings);
        Assert.False(Fao56Engine.IsPlausibleReading(9999, 1200, 3000));

        // And the engine used the last GOOD reading (2400), not 9999.
        Assert.Equal(2400, result.LatestRawReading);
        _out.WriteLine($"     invalid reading 9999 kept in the row list, calculations used {result.LatestRawReading}");
    }

    [Theory]
    [InlineData(-1, false)]      // below the ADC range
    [InlineData(4096, false)]    // above the ADC range
    [InlineData(0, true)]
    [InlineData(4095, true)]
    [InlineData(double.NaN, false)]
    public void ReadingPlausibility_UsesTheAdcRange(double raw, bool expected)
    {
        Assert.Equal(expected, Fao56Engine.IsPlausibleReading(raw, null, null));
    }

    [Fact]
    public void ReadingBeyondCalibrationByMoreThanTenPercent_IsImplausible()
    {
        // wet 1200, dry 3000 -> span 1800, tolerance 180.
        Assert.True(Fao56Engine.IsPlausibleReading(1020, 1200, 3000));   // exactly at the tolerance
        Assert.False(Fao56Engine.IsPlausibleReading(1019, 1200, 3000));  // just past it
        Assert.True(Fao56Engine.IsPlausibleReading(3180, 1200, 3000));
        Assert.False(Fao56Engine.IsPlausibleReading(3181, 1200, 3000));
    }

    // --------------------------------------------------------------------
    // 12.7  A day with no observed weather row falls back to dht_daily, and the
    //       source says dht11_fallback.
    // --------------------------------------------------------------------
    [Fact]
    public void MissingWeatherTemperature_FallsBackToDhtWithTheRightSource()
    {
        var result = DailyEtoResolver.Resolve(new DailyEtoInputs
        {
            Date = Today,
            LatitudeDegrees = -33.93,
            WeatherTMinC = null,
            WeatherTMaxC = null,
            DhtTMinC = 16.0,
            DhtTMaxC = 30.0,
            DhtRhMeanPct = 55,
        });

        Assert.NotNull(result.EtoMm);
        Assert.Equal(EtoSources.Dht11Fallback, result.EtoSource);
        Assert.Equal(EtoSources.Dht11Fallback, result.TemperatureSource);
        Assert.True(result.Incomplete);
        Assert.Contains(result.Limitations, l => l.Contains("temperature sensor readings were used instead"));

        _out .WriteLine($"     ETo {result.EtoMm:F2} mm from the tub sensor, source {result.EtoSource}");
    }

    [Fact]
    public void WeatherTemperaturePresent_IsPreferredOverDht()
    {
        var result = DailyEtoResolver.Resolve(new DailyEtoInputs
        {
            Date = Today,
            LatitudeDegrees = -33.93,
            WeatherTMinC = 14.0,
            WeatherTMaxC = 28.0,
            DhtTMinC = 25.0,
            DhtTMaxC = 45.0,
            WeatherIsForecast = false,
        });

        Assert.Equal(EtoSources.WeatherApp, result.TemperatureSource);
        Assert.Equal(14.0, result.TMinC);
        Assert.Equal(28.0, result.TMaxC);
    }

    // --------------------------------------------------------------------
    // 12.7  With no temperature from either source, no ETo and a data_gap.
    // --------------------------------------------------------------------
    [Fact]
    public void NoTemperatureFromEitherSource_GivesNoEtoAndADataGapInsight()
    {
        var input = CompleteZone();

        // Blank out the temperature on yesterday's row entirely.
        var yesterday = input.Weather.First(w => w.Date == Today.AddDays(-1));
        yesterday.TMinC = null;
        yesterday.TMaxC = null;
        yesterday.DhtTMinC = null;
        yesterday.DhtTMaxC = null;

        var result = Fao56Engine.Run(input);
        var insights = ZoneInsightBuilder.Build(input, result, new ZoneFaultSignals());

        var gapDay = result.Days.First(d => d.Day == Today.AddDays(-1));
        Assert.Null(gapDay.EtoMm);
        Assert.Equal(EtoSources.None, gapDay.EtoSource);

        var dataGap = insights.FirstOrDefault(i => i.InsightType == InsightType.DataGap);
        Assert.NotNull(dataGap);
        Assert.Equal(InsightSeverity.HeadsUp, dataGap!.Severity);
        _out.WriteLine($"     data_gap: \"{dataGap.Message}\"");
    }

    [Fact]
    public void MoreThanOneMissingWeatherDay_StopsTheBalance()
    {
        var input = CompleteZone();

        foreach (var day in new[] { Today.AddDays(-3), Today.AddDays(-2) })
        {
            var row = input.Weather.First(w => w.Date == day);
            row.TMinC = null;
            row.TMaxC = null;
        }

        var result = Fao56Engine.Run(input);

        Assert.False(result.BalanceRan);
        Assert.Contains(result.Limitations, l => l.Contains("paused for this zone"));
        _out.WriteLine("     two consecutive missing days stopped the balance, as specified");
    }

    // --------------------------------------------------------------------
    // 12.7  Estimated litres are null when flow_rate_lpm is null.
    // --------------------------------------------------------------------
    [Fact]
    public void NoFlowRate_MeansNoMinutes_AndNoArea_MeansNoLitres()
    {
        var noFlow = CompleteZone();
        noFlow.FlowRateLpm = null;
        var noFlowResult = Fao56Engine.Run(noFlow);
        Assert.Null(noFlowResult.RecommendedMinutes);
        Assert.Contains(noFlowResult.MissingSetup, m => m.Contains("flow rate"));

        var noArea = CompleteZone();
        noArea.AreaM2 = null;
        var noAreaResult = Fao56Engine.Run(noArea);
        Assert.Null(noAreaResult.RecommendedLitres);
        Assert.Null(noAreaResult.RecommendedMinutes);
        Assert.Contains(noAreaResult.MissingSetup, m => m.Contains("area"));
    }

    // --------------------------------------------------------------------
    // Uncalibrated zones still get watering advice (spec section 8).
    // --------------------------------------------------------------------
    [Fact]
    public void UncalibratedZone_StillGetsAWaterBalanceAndAdvice()
    {
        var input = CompleteZone();
        input.CalibrationWet = null;
        input.CalibrationDry = null;

        var result = Fao56Engine.Run(input);

        Assert.True(result.BalanceRan);
        Assert.NotNull(result.TawMm);
        Assert.NotNull(result.RawMm);
        Assert.NotNull(result.DepletionMm);

        // No percentage can be shown without calibration, and it says so.
        Assert.Null(result.RelativeMoisturePercent);
        Assert.Contains(result.MissingSetup, m => m.Contains("wet/dry"));

        _out.WriteLine($"     uncalibrated zone: TAW {result.TawMm:F0} mm, Dr {result.DepletionMm:F1} mm, advice still produced");
    }

    // --------------------------------------------------------------------
    // Section 8b: the DHT11 fault rules, in memory.
    // --------------------------------------------------------------------
    [Fact]
    public void DhtOffline_ProducesExactlyOneDhtOfflineInsightForTheDay()
    {
        var input = CompleteZone();
        var result = Fao56Engine.Run(input);

        var signals = new ZoneFaultSignals
        {
            DhtOffline = true,
            DhtOfflineSinceUtc = DateTime.SpecifyKind(Today.ToDateTime(new TimeOnly(4, 0)), DateTimeKind.Utc),
        };

        var insights = ZoneInsightBuilder.Build(input, result, signals);
        var dht = insights.Where(i => i.InsightType == InsightType.DhtOffline).ToList();

        Assert.Single(dht);
        Assert.Equal(InsightSeverity.ActNow, dht[0].Severity);
        Assert.Equal(Today, dht[0].ValidFor);
        Assert.Contains("temperature sensor isn't working", dht[0].Message);
        _out.WriteLine($"     dht_offline: \"{dht[0].Message}\"");
    }

    [Fact]
    public void DhtBackOnline_WritesNoDhtOfflineInsight()
    {
        var input = CompleteZone();
        var result = Fao56Engine.Run(input);

        var insights = ZoneInsightBuilder.Build(input, result, new ZoneFaultSignals { DhtOffline = false });

        Assert.DoesNotContain(insights, i => i.InsightType == InsightType.DhtOffline);
    }

    [Theory]
    [InlineData("Temperature", 25.0, true)]
    [InlineData("Temperature", -11.0, false)]   // below -10 C
    [InlineData("Temperature", 61.0, false)]    // above 60 C
    [InlineData("Temperature", double.NaN, false)]
    [InlineData("Humidity", 55.0, true)]
    [InlineData("Humidity", 101.0, false)]
    [InlineData("Humidity", -1.0, false)]
    [InlineData("SoilMoisture", 50.0, false)]   // not a DHT11 type
    public void DhtValuePlausibility_FollowsSection3b(string sensorType, double value, bool expected)
    {
        Assert.Equal(expected, AgroFlow.Data.Fao56EngineXDB.IsValidDhtValue(sensorType, value));
    }

    // --------------------------------------------------------------------
    // Section 7 copy rules, enforced rather than trusted.
    // --------------------------------------------------------------------
    private static readonly string[] BannedWords =
    {
        "Kc", "ETo", "ETc", "TAW", "RAW", "Ks", "depletion", "evapotranspiration",
        "FAO", "coefficient", "mm",
    };

    [Fact]
    public void NoFarmerMessageContainsJargon()
    {
        var messages = AllGeneratedMessages();
        Assert.NotEmpty(messages);

        foreach (var message in messages)
        {
            foreach (var banned in BannedWords)
            {
                Assert.False(
                    message.Contains(banned, StringComparison.Ordinal),
                    $"Farmer message contains the banned term \"{banned}\": {message}");
            }
        }

        _out.WriteLine($"     checked {messages.Count} generated messages for jargon");
    }

    [Fact]
    public void NoFarmerMessageIsLongerThanTheCopyLimit()
    {
        foreach (var message in AllGeneratedMessages())
        {
            Assert.True(
                message.Length <= ZoneInsightBuilder.MaxMessageLength,
                $"Message is {message.Length} characters, over the {ZoneInsightBuilder.MaxMessageLength} limit: {message}");
        }
    }

    [Fact]
    public void EveryInsightCarriesATypeSeveritySourceAndDay()
    {
        foreach (var insight in AllGeneratedInsights())
        {
            Assert.False(string.IsNullOrWhiteSpace(insight.InsightType));
            Assert.False(string.IsNullOrWhiteSpace(insight.Message));
            Assert.False(string.IsNullOrWhiteSpace(insight.Source));
            Assert.Contains(insight.Severity,
                new[] { InsightSeverity.ActNow, InsightSeverity.HeadsUp, InsightSeverity.Info });
            Assert.NotEqual(default, insight.ValidFor);
        }
    }

    // One row per zone, per type, per day. Checked per engine run - which is what
    // the unique index on (zone_id, insight_type, valid_for) enforces - rather
    // than across the unrelated scenarios AllGeneratedInsights() sweeps through.
    [Fact]
    public void OnlyOneInsightPerZonePerTypePerDay()
    {
        var runs = 0;

        void Check(Action<ZoneEngineInput> mutate, ZoneFaultSignals signals)
        {
            var input = CompleteZone();
            mutate(input);
            var result = Fao56Engine.Run(input);
            var insights = ZoneInsightBuilder.Build(input, result, signals);

            foreach (var group in insights.GroupBy(i => new { i.ZoneId, i.InsightType, i.ValidFor }))
            {
                Assert.Single(group);
            }

            runs++;
        }

        Check(i => i.Readings[0].RawValue = 2950, new ZoneFaultSignals());
        Check(i => i.Readings[0].RawValue = 1250, new ZoneFaultSignals());
        Check(i => i.PlantingDate = Today.AddDays(-20), new ZoneFaultSignals());
        Check(i => i.PlantingDate = Today.AddDays(-200), new ZoneFaultSignals());
        Check(i => { }, new ZoneFaultSignals
        {
            SinceLastReading = TimeSpan.FromHours(5),
            IdenticalReadingFor = TimeSpan.FromHours(9),
            WateringAppearedToFail = true,
            DhtOffline = true,
            SevenDayMinimumReading = 1900,
            SevenDayIrrigationMm = 400,
            TrailingSevenDayMeanEto = 2.0,
        });

        _out.WriteLine($"     checked uniqueness across {runs} engine runs");
    }

    // Drives the builder through several zone states so the copy checks above see
    // a wide spread of real messages rather than one happy path.
    private static List<ZoneInsight> AllGeneratedInsights()
    {
        var all = new List<ZoneInsight>();

        void Run(Action<ZoneEngineInput> mutate, ZoneFaultSignals signals)
        {
            var input = CompleteZone();
            mutate(input);
            var result = Fao56Engine.Run(input);
            all.AddRange(ZoneInsightBuilder.Build(input, result, signals));
        }

        // Dry zone, due for water.
        Run(i => i.Readings[0].RawValue = 2950, new ZoneFaultSignals());

        // Wet zone.
        Run(i => i.Readings[0].RawValue = 1250, new ZoneFaultSignals());

        // Rain forecast today, watering due.
        Run(i =>
        {
            i.Readings[0].RawValue = 2950;
            i.Weather.First(w => w.Date == Today).RainMm = 25.0;
        }, new ZoneFaultSignals());

        // Nothing set up.
        Run(i =>
        {
            i.CropType = null;
            i.PlantingDate = null;
            i.AreaM2 = null;
            i.FlowRateLpm = null;
            i.SoilType = null;
            i.CalibrationWet = null;
            i.CalibrationDry = null;
            i.FarmLatitudeDegrees = null;
        }, new ZoneFaultSignals());

        // Every fault signal at once.
        Run(i => { }, new ZoneFaultSignals
        {
            SinceLastReading = TimeSpan.FromHours(5),
            IdenticalReadingFor = TimeSpan.FromHours(9),
            WateringAppearedToFail = true,
            FailedRunAtUtc = DateTime.UtcNow,
            DhtOffline = true,
            DhtOfflineSinceUtc = DateTime.UtcNow.AddHours(-3),
            SevenDayMinimumReading = 1900,
            SevenDayIrrigationMm = 400,
            TrailingSevenDayMeanEto = 2.0,
        });

        // Early season, so stage_change and peak_growth fire.
        Run(i => i.PlantingDate = Today.AddDays(-20), new ZoneFaultSignals());
        Run(i => i.PlantingDate = Today.AddDays(-64), new ZoneFaultSignals());

        // Nearly harvested, and past harvest.
        Run(i => i.PlantingDate = Today.AddDays(-130), new ZoneFaultSignals());
        Run(i => i.PlantingDate = Today.AddDays(-200), new ZoneFaultSignals());

        // A long zone name, to prove the length limit is enforced and not assumed.
        Run(i => i.ZoneName = "The very long north-western demonstration tub beside the greenhouse",
            new ZoneFaultSignals());

        // A forecast, so water_soon and hot_days can fire.
        Run(i =>
        {
            for (var d = 1; d <= 7; d++)
            {
                i.Weather.Add(new ZoneWeatherDay
                {
                    Date = Today.AddDays(d),
                    TMinC = 20.0, TMaxC = 38.0, RainMm = 0.0,
                    RhMinPct = 15, RhMaxPct = 40, WindMs = 4.0, WindHeightM = 10.0,
                    IsForecast = true,
                });
            }
            i.Readings[0].RawValue = 2700;
        }, new ZoneFaultSignals { TrailingSevenDayMeanEto = 2.0 });

        return all;
    }

    private static List<string> AllGeneratedMessages()
    {
        return AllGeneratedInsights().Select(i => i.Message).Distinct().ToList();
    }

    // --------------------------------------------------------------------
    // water_now and skip_rain are mutually exclusive on the same day.
    // --------------------------------------------------------------------
    [Fact]
    public void RainExpected_ReplacesWaterNowRatherThanContradictingIt()
    {
        var input = CompleteZone();
        input.Readings[0].RawValue = 2950;                                  // dry
        input.Weather.First(w => w.Date == Today).RainMm = 30.0;            // heavy rain today

        var result = Fao56Engine.Run(input);
        var insights = ZoneInsightBuilder.Build(input, result, new ZoneFaultSignals());

        Assert.Contains(insights, i => i.InsightType == InsightType.SkipRain);
        Assert.DoesNotContain(insights, i => i.InsightType == InsightType.WaterNow);

        var skip = insights.First(i => i.InsightType == InsightType.SkipRain);
        _out.WriteLine($"     skip_rain: \"{skip.Message}\"");
    }

    // --------------------------------------------------------------------
    // Insights are advisory only - BR 6.9. Nothing in the insight carries an
    // irrigation command reference.
    // --------------------------------------------------------------------
    [Fact]
    public void InsightsCarryNoIrrigationCommandReference()
    {
        foreach (var insight in AllGeneratedInsights())
        {
            Assert.DoesNotContain("command", string.Join(" ", insight.Data.Keys), StringComparison.OrdinalIgnoreCase);
        }
    }

    // --------------------------------------------------------------------
    // Reset to recommended: p_r = clamp(p x soilFactor, 0.1, 0.8),
    // threshold = wet - p_r (wet - dry).
    // --------------------------------------------------------------------
    [Fact]
    public void RecommendedThreshold_UsesTheSoilAdjustedDepletionFraction()
    {
        var input = CompleteZone();          // maize p 0.55, loam factor 1.00
        var result = Fao56Engine.Run(input);

        var threshold = ZoneInsightBuilder.RecommendedThreshold(input, result);

        // wet 1200, dry 3000 -> 1200 - 0.55 * (1200 - 3000) = 1200 + 990 = 2190
        Assert.NotNull(threshold);
        Assert.Equal(2190.0, threshold!.Value, 1);
        _out.WriteLine($"     maize on loam, wet 1200 / dry 3000 -> recommended threshold {threshold.Value:F0}");
    }

    [Fact]
    public void RecommendedThreshold_NeedsCalibrationAndACrop()
    {
        var noCalibration = CompleteZone();
        noCalibration.CalibrationWet = null;
        Assert.Null(ZoneInsightBuilder.RecommendedThreshold(noCalibration, Fao56Engine.Run(noCalibration)));

        var noCrop = CompleteZone();
        noCrop.CropType = null;
        Assert.Null(ZoneInsightBuilder.RecommendedThreshold(noCrop, Fao56Engine.Run(noCrop)));
    }

    [Fact]
    public void SoilTypeChangesHowMuchWaterTheSoilHolds()
    {
        var byType = new Dictionary<string, double>();

        foreach (var soilType in new[] { "sandy", "loam", "clay" })
        {
            var input = CompleteZone();
            input.SoilType = soilType;
            var result = Fao56Engine.Run(input);
            byType[soilType] = result.TawMm!.Value;
            _out.WriteLine($"     {soilType,-6} holds {result.TawMm:F1} mm over a {0.3:F1} m root zone");
        }

        // Sand holds the least, clay the most - which is the whole point of
        // asking the farmer for a soil type.
        Assert.True(byType["sandy"] < byType["loam"]);
        Assert.True(byType["loam"] < byType["clay"]);
    }

    // --------------------------------------------------------------------
    // 12.7b  Advise still returns a valid ZoneAdvice for a zone with no planting
    //        date: the summary says what is missing and nothing throws.
    // --------------------------------------------------------------------
    [Fact]
    public void Advise_WithNoPlantingDate_ReturnsValidAdviceAndNoException()
    {
        var engineInput = CompleteZone();
        engineInput.PlantingDate = null;

        var advice = IrrigationAdvisor.Advise(new ZoneAdviceInput
        {
            ZoneName = "Tub 1",
            CropType = "maize",
            PlantingDate = null,
            AsOf = Today,
            SoilMoisturePercent = 22,
            MoistureThresholdPercent = 30,
            FarmLatitudeDegrees = -33.93,
            LatestWeather = new DailyWeather(Today, 14, 28, 0, false),
            WaterBalance = engineInput,
        });

        Assert.NotNull(advice);
        Assert.False(string.IsNullOrWhiteSpace(advice.Summary));
        Assert.Contains(advice.Limitations, l => l.Contains("planting date"));
        Assert.NotNull(advice.FarmerInsights);

        // And it still tells the farmer what to add.
        Assert.Contains(advice.FarmerInsights, i => i.InsightType == InsightType.SetupMissing);
        _out.WriteLine($"     summary with no planting date: \"{advice.Summary}\"");
    }

    [Fact]
    public void Advise_WithoutWaterBalanceInputs_BehavesExactlyAsBefore()
    {
        // The engine is opt-in: a caller that has not been updated gets the old
        // advice, with no water-balance fields set and no exception.
        var advice = IrrigationAdvisor.Advise(new ZoneAdviceInput
        {
            ZoneName = "Tub 1",
            CropType = "maize",
            PlantingDate = Today.AddDays(-60),
            AsOf = Today,
            SoilMoisturePercent = 22,
            MoistureThresholdPercent = 30,
            FarmLatitudeDegrees = -33.93,
            LatestWeather = new DailyWeather(Today, 14, 28, 0, false),
        });

        Assert.False(advice.WaterBalanceAvailable);
        Assert.Null(advice.PlainSummary);
        Assert.Empty(advice.FarmerInsights);
        Assert.NotEmpty(advice.Summary);
    }

    [Fact]
    public void Advise_WithWaterBalance_ProducesThePlainSummaryAndFarmerInsights()
    {
        var engineInput = CompleteZone();
        engineInput.Readings[0].RawValue = 2950;   // dry

        var advice = IrrigationAdvisor.Advise(new ZoneAdviceInput
        {
            ZoneName = "Tub 1",
            CropType = "maize",
            PlantingDate = engineInput.PlantingDate,
            AsOf = Today,
            SoilMoisturePercent = 10,
            MoistureThresholdPercent = 30,
            FarmLatitudeDegrees = -33.93,
            LatestWeather = new DailyWeather(Today, 14, 28, 0, false),
            WaterBalance = engineInput,
        });

        Assert.True(advice.WaterBalanceAvailable);
        Assert.NotNull(advice.PlainSummary);
        Assert.NotEmpty(advice.FarmerInsights);
        Assert.NotNull(advice.TotalAvailableWaterMm);
        Assert.NotNull(advice.DepletionMm);

        // The FAO narrative insights are untouched and still carry citations.
        Assert.All(advice.Insights, i => Assert.Contains("FAO-56", i));

        _out.WriteLine($"     plain summary: \"{advice.PlainSummary}\"");
        _out.WriteLine($"     farmer insights: {string.Join(", ", advice.FarmerInsights.Select(i => i.InsightType))}");
    }
}
