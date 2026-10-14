using AgroFlow.Business;
using AgroFlow.Business.Agronomy;

namespace AgroFlow.Api.Ml;

// What the zone screen shows under the advice. Available = false means show nothing.
public sealed record MoistureForecastLine(
    bool Available,
    string Label,
    string? Text,
    int? HoursUntilWater,
    double? CurrentMoisturePct,
    double? PredictedMoisturePct24h,
    bool SimulatedData,
    bool TrainedOnSimulatedOnly)
{
    public static MoistureForecastLine Hidden { get; } =
        new(false, MoistureForecastRules.Label, null, null, null, null, false, false);
}

// Builds the forecast line for one zone. It reads the engine's result and never
// changes it: PrimaryAction stays the only watering decision.
public sealed class MoistureForecastService
{
    private readonly Fao56EngineController _engine;
    private readonly MoistureMlController _ml;
    private readonly MoistureForecaster _forecaster;

    public MoistureForecastService(Fao56EngineController engine, MoistureMlController ml, MoistureForecaster forecaster)
    {
        _engine = engine;
        _ml = ml;
        _forecaster = forecaster;
    }

    public MoistureForecastLine ForZone(long zoneId)
    {
        if (!_forecaster.IsLoaded) return MoistureForecastLine.Hidden;
        var zone = _engine.Data.GetZone(zoneId);
        if (zone == null) return MoistureForecastLine.Hidden;

        var today = Fao56EngineController.TodayInSast();
        var input = _engine.BuildInput(zone, today);
        var result = Fao56Engine.Run(input);

        return Build(input, result, _ml.Data.ReadingDaysInLastWeek(zoneId), _forecaster.IsLoaded,
            _forecaster.Predict, _ml.Data.IsSimulatedZone(zoneId),
            _forecaster.Report?.TrainedOnSimulatedOnly ?? true, DateTime.UtcNow);
    }

    // Pure: everything it needs is passed in, so tests can run it without a database.
    public static MoistureForecastLine Build(
        ZoneEngineInput input, ZoneEngineResult result, int readingDaysInLastWeek, bool modelLoaded,
        Func<MoistureForecastFeatures, double?> predict, bool simulatedZone, bool trainedOnSimulatedOnly, DateTime nowUtc)
    {
        var tomorrow = result.Days.FirstOrDefault(d => d.Day == input.Today.AddDays(1));
        if (!MoistureForecastRules.HasEnoughData(
                modelLoaded, result.RelativeMoisturePercent, result.LatestReadingAtUtc, readingDaysInLastWeek,
                result.TawMm, result.RawMm, tomorrow?.EtoMm, result.Stage, nowUtc))
            return MoistureForecastLine.Hidden;

        var weatherToday = input.Weather
            .Where(w => w.Date == input.Today)
            .OrderBy(w => w.IsForecast ? 0 : 1)
            .LastOrDefault();

        var features = new MoistureForecastFeatures
        {
            CurrentMoisturePct = result.RelativeMoisturePercent!.Value,
            HoursSinceIrrigation = HoursSinceIrrigation(input),
            TMaxC = weatherToday?.TMaxC ?? 0,
            TMinC = weatherToday?.TMinC ?? 0,
            HumidityPct = weatherToday?.RhMeanPct ?? 0,
            ForecastRainMm = tomorrow!.RainMm,
            EtoNextMm = tomorrow.EtoMm!.Value,
            SoilType = result.Soil.Key,
            CropStage = result.Stage!.Value.ToString(),
        };

        var predicted = predict(features);
        if (!predicted.HasValue) return MoistureForecastLine.Hidden;
        var predictedPct = Math.Clamp(predicted.Value, 0, 100);

        var hours = MoistureForecastRules.HoursUntilWater(
            features.CurrentMoisturePct, predictedPct,
            MoistureForecastRules.WateringLevelPct(result.TawMm!.Value, result.RawMm!.Value));

        return new MoistureForecastLine(
            true, MoistureForecastRules.Label, MoistureForecastRules.Describe(hours), hours,
            Math.Round(features.CurrentMoisturePct, 1), Math.Round(predictedPct, 1),
            simulatedZone, trainedOnSimulatedOnly);
    }

    // Whole days since the last logged watering, like the training data.
    private static double HoursSinceIrrigation(ZoneEngineInput input)
    {
        var watered = input.IrrigationMmByDay.Where(p => p.Value > 0).Select(p => p.Key)
            .Concat(input.LongestRunSecondsByDay.Where(p => p.Value > 0).Select(p => p.Key))
            .Where(d => d <= input.Today)
            .ToList();
        if (watered.Count == 0) return MoistureForecastRules.NoRecentIrrigationHours;
        return Math.Min(MoistureForecastRules.NoRecentIrrigationHours, 24.0 * (input.Today.DayNumber - watered.Max().DayNumber));
    }
}
