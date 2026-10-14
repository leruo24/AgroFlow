using System.Text.Json;
using AgroFlow.Api.Ml;
using AgroFlow.Business;
using AgroFlow.Business.Agronomy;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;

namespace AgroFlow.Domain.Tests;

// Phase 5: the fault checks, the 24-hour forecast line and its guarantee that the
// FAO-56 engine's decision does not move.
public class MoistureMlTests
{
    private static readonly DateTime T0 = new(2026, 10, 1, 6, 0, 0, DateTimeKind.Utc);

    private static List<MoistureSample> Hourly(Func<int, double> value, int count) =>
        Enumerable.Range(0, count).Select(i => new MoistureSample { AtUtc = T0.AddHours(i), Value = value(i) }).ToList();

    private static double Wobble(int i) => 0.3 * Math.Sin(i * 1.7);

    // ---- rule-based faults --------------------------------------------------

    [Fact]
    public void Pump_run_with_no_moisture_rise_is_flagged()
    {
        var samples = Hourly(i => 40 + Wobble(i), 6);
        var run = new PumpRun { StartedAtUtc = T0.AddHours(2).AddMinutes(5), DurationSeconds = 600 };

        Assert.True(MoistureFaultRules.PumpRanButMoistureDidNotRise(samples, run));
        var fault = Assert.Single(MoistureFaultRules.Check(samples, new[] { run }, T0.AddHours(6)));
        Assert.Equal(MoistureFaultKind.PumpRanMoistureDidNotRise, fault.Kind);
        Assert.StartsWith("Possible sensor or water supply problem — please check.", fault.Message);
    }

    [Fact]
    public void Pump_run_that_wets_the_soil_is_not_flagged()
    {
        var samples = Hourly(i => i >= 3 ? 55 : 40, 6);
        var run = new PumpRun { StartedAtUtc = T0.AddHours(2).AddMinutes(5), DurationSeconds = 600 };

        Assert.False(MoistureFaultRules.PumpRanButMoistureDidNotRise(samples, run));
    }

    [Fact]
    public void Pump_run_is_not_judged_without_readings_around_it()
    {
        var run = new PumpRun { StartedAtUtc = T0.AddHours(2), DurationSeconds = 600 };

        Assert.Null(MoistureFaultRules.PumpRanButMoistureDidNotRise(Hourly(_ => 40, 2), run)); // nothing after
        Assert.Null(MoistureFaultRules.PumpRanButMoistureDidNotRise(Hourly(_ => 40, 6),
            new PumpRun { StartedAtUtc = T0.AddHours(2), DurationSeconds = 30 })); // too short to judge
    }

    [Fact]
    public void Sensor_stuck_on_one_value_for_twelve_hours_is_flagged()
    {
        var stuck = Hourly(_ => 37.2, 14);
        var fault = Assert.Single(MoistureFaultRules.Check(stuck, Array.Empty<PumpRun>(), T0.AddHours(13)));
        Assert.Equal(MoistureFaultKind.SensorUnchanged, fault.Kind);
    }

    [Fact]
    public void Changing_or_sparse_readings_are_not_called_stuck()
    {
        Assert.False(MoistureFaultRules.SensorUnchanged(Hourly(i => 50 - 0.2 * i, 14), T0.AddHours(13)));
        Assert.False(MoistureFaultRules.SensorUnchanged(Hourly(_ => 37.2, 3), T0.AddHours(13)));
    }

    // ---- ML.NET anomaly detection -------------------------------------------

    private static readonly HashSet<DateOnly> NoRain = new();

    [Fact]
    public void Steady_drying_raises_no_anomaly()
    {
        Assert.Empty(MoistureAnomalyDetector.Detect(Hourly(i => 60 - 0.2 * i + Wobble(i), 48), Array.Empty<PumpRun>(), NoRain));
        Assert.Empty(MoistureAnomalyDetector.Detect(Hourly(i => 80 - 0.8 * i + Wobble(i), 48), Array.Empty<PumpRun>(), NoRain));
    }

    [Fact]
    public void A_sudden_unexplained_spike_is_flagged()
    {
        var samples = Hourly(i => i == 47 ? 85 : 60 - 0.2 * i + Wobble(i), 48);
        Assert.Contains(MoistureAnomalyDetector.Detect(samples, Array.Empty<PumpRun>(), NoRain),
            f => f.Kind == MoistureFaultKind.MoistureSpike);
    }

    [Fact]
    public void A_sudden_unexplained_level_change_is_flagged()
    {
        var samples = Hourly(i => (i >= 45 ? 30 : 60) + Wobble(i), 48);
        Assert.Contains(MoistureAnomalyDetector.Detect(samples, Array.Empty<PumpRun>(), NoRain),
            f => f.Kind == MoistureFaultKind.MoistureChangePoint);
    }

    [Fact]
    public void A_jump_that_watering_or_rain_explains_is_not_flagged()
    {
        var samples = Hourly(i => (i >= 46 ? 85 : 60) + Wobble(i), 48);
        var run = new PumpRun { StartedAtUtc = T0.AddHours(45.5), DurationSeconds = 600 };
        Assert.Empty(MoistureAnomalyDetector.Detect(samples, new[] { run }, NoRain));

        var rainDay = new HashSet<DateOnly> { DateOnly.FromDateTime(T0.AddHours(46).AddHours(2)) };
        Assert.Empty(MoistureAnomalyDetector.Detect(samples, Array.Empty<PumpRun>(), rainDay));
    }

    [Fact]
    public void Too_few_readings_raise_no_anomaly()
    {
        Assert.Empty(MoistureAnomalyDetector.Detect(Hourly(i => i == 5 ? 90 : 40, 6), Array.Empty<PumpRun>(), NoRain));
    }

    // ---- forecast rules -----------------------------------------------------

    [Fact]
    public void Hours_until_water_interpolates_and_reads_plainly()
    {
        Assert.Equal(12, MoistureForecastRules.HoursUntilWater(60, 40, 50));
        Assert.Null(MoistureForecastRules.HoursUntilWater(60, 55, 50));
        Assert.Equal(0, MoistureForecastRules.HoursUntilWater(45, 40, 50));
        Assert.Equal("Likely to need water in about 14 hours", MoistureForecastRules.Describe(14));
        Assert.Equal("Not likely to need water in the next 24 hours", MoistureForecastRules.Describe(null));
    }

    [Fact]
    public void Fao56_baseline_matches_one_day_of_the_engine()
    {
        // One observed day from a known depletion, run through the real engine...
        var today = new DateOnly(2026, 1, 15);
        var input = new ZoneEngineInput
        {
            CropType = "tomato", SoilType = "loam", PlantingDate = today.AddDays(-50), FarmLatitudeDegrees = -25.6,
            Today = today, BalanceStartDate = today, InitialDepletionDate = today.AddDays(-1), InitialDepletionMm = 30,
            Weather = { Day(today, rain: 1.0, forecast: false) },
        };
        var day = Fao56Engine.Run(input).Days.Single(d => d.Day == today && !d.IsForecast);
        var engineMoisture = 100 * (1 - day.DrEndMm!.Value / day.TawMm!.Value);

        // ...and through the baseline, starting from the same soil state.
        var start = 100 * (1 - 30 / day.TawMm.Value);
        var baseline = MoistureForecastRules.Fao56OneDayMoisturePct(
            start, day.TawMm.Value, day.RawMm!.Value, day.AdjustedP!.Value, day.Kc!.Value, day.EtoMm!.Value, day.RainMm);

        Assert.Equal(engineMoisture, baseline, 6);
    }

    [Fact]
    public void Forecast_is_hidden_when_a_zone_has_too_little_data()
    {
        var now = T0;
        Assert.False(MoistureForecastRules.HasEnoughData(false, 50, now, 5, 100, 50, 5, SeasonStage.Growing, now));
        Assert.False(MoistureForecastRules.HasEnoughData(true, null, now, 5, 100, 50, 5, SeasonStage.Growing, now));
        Assert.False(MoistureForecastRules.HasEnoughData(true, 50, now.AddHours(-30), 5, 100, 50, 5, SeasonStage.Growing, now));
        Assert.False(MoistureForecastRules.HasEnoughData(true, 50, now, 2, 100, 50, 5, SeasonStage.Growing, now));
        Assert.False(MoistureForecastRules.HasEnoughData(true, 50, now, 5, null, 50, 5, SeasonStage.Growing, now));
        Assert.False(MoistureForecastRules.HasEnoughData(true, 50, now, 5, 100, 50, null, SeasonStage.Growing, now));
        Assert.True(MoistureForecastRules.HasEnoughData(true, 50, now, 5, 100, 50, 5, SeasonStage.Growing, now));

        var (input, result) = ZoneWithReadings(readingDays: 1);
        var line = MoistureForecastService.Build(input, result, readingDaysInLastWeek: 1, modelLoaded: true,
            _ => 40, simulatedZone: false, trainedOnSimulatedOnly: true, input.NowUtc!.Value);
        Assert.False(line.Available);
        Assert.Null(line.Text);
    }

    [Fact]
    public void Forecast_line_uses_the_label_and_the_model_prediction()
    {
        var (input, result) = ZoneWithReadings(readingDays: 4);
        var line = MoistureForecastService.Build(input, result, 4, true, _ => 0, false, true, input.NowUtc!.Value);

        Assert.True(line.Available);
        Assert.Equal("Forecast (machine learning model)", line.Label);
        Assert.StartsWith("Likely to need water", line.Text);
        Assert.True(line.TrainedOnSimulatedOnly);
    }

    [Fact]
    public void Engine_decision_is_identical_with_the_model_on_or_off()
    {
        var (input, _) = ZoneWithReadings(readingDays: 4);
        var off = Fao56Engine.Run(input);
        var offSnapshot = JsonSerializer.Serialize(off);

        var forecaster = LoadedForecaster();
        Assert.True(forecaster.IsLoaded);
        var withModel = Fao56Engine.Run(input);
        var line = MoistureForecastService.Build(input, withModel, 4, forecaster.IsLoaded, forecaster.Predict,
            false, true, input.NowUtc!.Value);

        Assert.True(line.Available);
        Assert.Equal(off.PrimaryAction, withModel.PrimaryAction);
        Assert.Equal(offSnapshot, JsonSerializer.Serialize(withModel)); // the forecast never wrote into it
        Assert.Equal(off.PrimaryAction, Fao56Engine.Run(input).PrimaryAction);
    }

    [Fact]
    public void Saved_model_loads_and_predicts_moisture_in_range()
    {
        var forecaster = LoadedForecaster();
        Assert.NotNull(forecaster.Report);
        Assert.True(forecaster.Report!.TrainedOnSimulatedOnly);

        var predicted = forecaster.Predict(new MoistureForecastFeatures
        {
            CurrentMoisturePct = 70, HoursSinceIrrigation = 48, TMaxC = 28, TMinC = 12, HumidityPct = 50,
            ForecastRainMm = 0, EtoNextMm = 5, SoilType = "loam", CropStage = SeasonStage.PeakGrowth.ToString(),
        });
        Assert.NotNull(predicted);
        Assert.InRange(predicted!.Value, 40, 75);
    }

    [Fact]
    public void Engine_sources_do_not_reference_the_machine_learning_code()
    {
        var root = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", ".."));
        foreach (var file in new[] { "Fao56Engine.cs", "SoilWaterBalance.cs", "DailyEtoResolver.cs" })
        {
            var source = File.ReadAllText(Path.Combine(root, "AgroFlow.Domain", "Agronomy", file));
            Assert.DoesNotContain("Moisture" + "Forecast", source);
            Assert.DoesNotContain("AgroFlow.Api.Ml", source);
        }
    }

    // ---- helpers ------------------------------------------------------------

    private static MoistureForecaster LoadedForecaster() => new(
        new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>()).Build(),
        NullLogger<MoistureForecaster>.Instance);

    private static ZoneWeatherDay Day(DateOnly date, double rain, bool forecast) => new()
    {
        Date = date, TMinC = 14, TMaxC = 30, RainMm = rain, RhMinPct = 30, RhMaxPct = 80, RhMeanPct = 55,
        WindMs = 2, WindHeightM = 10, IsForecast = forecast,
    };

    // A tomato zone with a calibrated percent sensor, ten days of weather, a forecast
    // and readings on the last `readingDays` days.
    private static (ZoneEngineInput, ZoneEngineResult) ZoneWithReadings(int readingDays)
    {
        var today = new DateOnly(2026, 1, 15);
        var now = new DateTime(2026, 1, 15, 8, 0, 0, DateTimeKind.Utc);
        var input = new ZoneEngineInput
        {
            ZoneId = 1, CropType = "tomato", SoilType = "loam", PlantingDate = today.AddDays(-50),
            AreaM2 = 10, FlowRateLpm = 5, CalibrationWet = 100, CalibrationDry = 0, FarmLatitudeDegrees = -25.6,
            Today = today, BalanceStartDate = today.AddDays(-10), NowUtc = now,
        };
        for (var d = -10; d < 0; d++) input.Weather.Add(Day(today.AddDays(d), 0, false));
        for (var d = 0; d < 4; d++) input.Weather.Add(Day(today.AddDays(d), 0, true));
        for (var d = readingDays - 1; d >= 0; d--)
            input.Readings.Add(new ZoneMoistureReading { RecordedAtUtc = now.AddDays(-d).AddHours(-1), RawValue = 62 - d });
        return (input, Fao56Engine.Run(input));
    }
}
