#nullable enable
using System;
using System.Collections.Generic;
using System.Linq;
using AgroFlow.Business.Agronomy;

namespace AgroFlow.Business
{
    // The inputs of the 24-hour soil moisture forecast (the machine learning model in
    // AgroFlow.Api/Ml). The same fields are filled from training history and from a
    // live zone, so the model sees one meaning per feature.
    public sealed class MoistureForecastFeatures
    {
        public double CurrentMoisturePct { get; set; }
        public double HoursSinceIrrigation { get; set; }
        public double TMaxC { get; set; }
        public double TMinC { get; set; }
        public double HumidityPct { get; set; }
        public double ForecastRainMm { get; set; }

        // Reference ET for the next 24 hours, from the existing FAO-56 engine.
        public double EtoNextMm { get; set; }
        public string SoilType { get; set; } = Fao56EngineReference.DefaultSoilKey;
        public string CropStage { get; set; } = SeasonStage.PeakGrowth.ToString();
    }

    // One training or evaluation row: features, the moisture 24 hours later, and the
    // FAO-56 baseline's prediction for the same day.
    public sealed class MoistureExample
    {
        public string ZoneKey { get; set; } = string.Empty;
        public DateOnly Day { get; set; }
        public bool Simulated { get; set; }
        public MoistureForecastFeatures Features { get; set; } = new MoistureForecastFeatures();
        public double LabelMoisturePct { get; set; }
        public double BaselineMoisturePct { get; set; }
    }

    // One day of a zone's history: the moisture at the end of the day plus the FAO-56
    // balance row and weather for that day.
    public sealed class MoistureDay
    {
        public DateOnly Day { get; set; }
        public double? MoisturePct { get; set; }
        public bool Simulated { get; set; }
        public double? TMaxC { get; set; }
        public double? TMinC { get; set; }
        public double? HumidityPct { get; set; }
        public double RainMm { get; set; }
        public double? EtoMm { get; set; }
        public double? Kc { get; set; }
        public double? AdjustedP { get; set; }
        public double? TawMm { get; set; }
        public double? RawMm { get; set; }
        public double IrrigationMm { get; set; }
        public SeasonStage? Stage { get; set; }
    }

    public static class MoistureForecastRules
    {
        public const string Label = "Forecast (machine learning model)";

        // Hours since irrigation is capped here: "none in the last 30 days".
        public const double NoRecentIrrigationHours = 720;

        // The forecast is hidden unless the zone has this much recent data.
        public const int MinReadingDaysInLastWeek = 3;
        public const double MaxReadingAgeHours = 26;

        // Whether a zone has enough data for the forecast line. Any "no" hides it.
        public static bool HasEnoughData(
            bool modelLoaded, double? currentMoisturePct, DateTime? latestReadingAtUtc,
            int readingDaysInLastWeek, double? tawMm, double? rawMm, double? etoNextMm,
            SeasonStage? stage, DateTime nowUtc)
        {
            if (!modelLoaded) return false;
            if (!currentMoisturePct.HasValue || !latestReadingAtUtc.HasValue) return false;
            if ((nowUtc - latestReadingAtUtc.Value).TotalHours > MaxReadingAgeHours) return false;
            if (readingDaysInLastWeek < MinReadingDaysInLastWeek) return false;
            if (!tawMm.HasValue || tawMm.Value <= 0 || !rawMm.HasValue) return false;
            if (!etoNextMm.HasValue || !stage.HasValue) return false;
            return true;
        }

        // The moisture % at which the engine's balance reaches RAW, i.e. where FAO-56
        // says watering is due.
        public static double WateringLevelPct(double tawMm, double rawMm)
            => 100.0 * (1.0 - Math.Clamp(rawMm, 0, tawMm) / tawMm);

        // Hours until the zone reaches the watering level, straight-line between now and
        // the 24-hour prediction. 0 = already there; null = not within 24 hours.
        public static int? HoursUntilWater(double currentPct, double predicted24hPct, double wateringLevelPct)
        {
            if (currentPct <= wateringLevelPct) return 0;
            if (predicted24hPct >= wateringLevelPct || predicted24hPct >= currentPct) return null;
            var hours = 24.0 * (currentPct - wateringLevelPct) / (currentPct - predicted24hPct);
            return (int)Math.Clamp(Math.Round(hours), 1, 24);
        }

        public static string Describe(int? hours)
        {
            if (hours == null) return "Not likely to need water in the next 24 hours";
            if (hours == 0) return "Already at the level where water is usually needed";
            return hours == 1
                ? "Likely to need water in about 1 hour"
                : "Likely to need water in about " + hours + " hours";
        }

        // The FAO-56 baseline: the engine's own daily step (Fao56Engine.BuildDay, Eq. 81,
        // 84 and 85) run once from today's moisture, with no watering.
        public static double Fao56OneDayMoisturePct(
            double currentPct, double tawMm, double rawMm, double adjustedP, double kc, double etoMm, double rainMm)
        {
            var dr = SoilWaterBalance.DepletionFromRelativeMoistureMm(Math.Clamp(currentPct, 0, 100), tawMm);
            var ks = SoilWaterBalance.StressCoefficient(dr, tawMm, rawMm, adjustedP);
            var etcAdj = SoilWaterBalance.StressAdjustedEtcMm(ks, kc * etoMm);
            var rain = SoilWaterBalance.EffectiveRainfallMm(rainMm, etoMm);
            var next = SoilWaterBalance.NextDepletionMm(dr, rain, 0.0, etcAdj, tawMm);
            return 100.0 * (1.0 - next / tawMm);
        }

        // Pairs each day with the next one. A pair is kept only when both days have a
        // moisture value and a balance row, and no watering happened on the second day:
        // the forecast is about how the soil changes on its own.
        public static List<MoistureExample> BuildExamples(string zoneKey, string soilType, IReadOnlyList<MoistureDay> history)
        {
            var examples = new List<MoistureExample>();
            var days = history.OrderBy(d => d.Day).ToList();
            DateOnly? lastIrrigation = null;

            for (var i = 0; i < days.Count - 1; i++)
            {
                var today = days[i];
                var next = days[i + 1];
                if (today.IrrigationMm > 0) lastIrrigation = today.Day;

                if (next.Day != today.Day.AddDays(1)) continue;
                if (!today.MoisturePct.HasValue || !next.MoisturePct.HasValue) continue;
                if (next.IrrigationMm > 0) continue;
                if (!next.EtoMm.HasValue || !next.Kc.HasValue || !next.AdjustedP.HasValue
                    || !next.TawMm.HasValue || !next.RawMm.HasValue || next.TawMm.Value <= 0) continue;

                var hoursSince = lastIrrigation.HasValue
                    ? Math.Min(NoRecentIrrigationHours, 24.0 * (today.Day.DayNumber - lastIrrigation.Value.DayNumber))
                    : NoRecentIrrigationHours;

                examples.Add(new MoistureExample
                {
                    ZoneKey = zoneKey,
                    Day = today.Day,
                    Simulated = today.Simulated || next.Simulated,
                    LabelMoisturePct = next.MoisturePct.Value,
                    BaselineMoisturePct = Fao56OneDayMoisturePct(
                        today.MoisturePct.Value, next.TawMm.Value, next.RawMm.Value, next.AdjustedP.Value,
                        next.Kc.Value, next.EtoMm.Value, next.RainMm),
                    Features = new MoistureForecastFeatures
                    {
                        CurrentMoisturePct = today.MoisturePct.Value,
                        HoursSinceIrrigation = hoursSince,
                        TMaxC = today.TMaxC ?? 0,
                        TMinC = today.TMinC ?? 0,
                        HumidityPct = today.HumidityPct ?? 0,
                        ForecastRainMm = next.RainMm,
                        EtoNextMm = next.EtoMm.Value,
                        SoilType = soilType,
                        CropStage = (today.Stage ?? SeasonStage.PeakGrowth).ToString(),
                    },
                });
            }

            return examples;
        }
    }

    // Generates simulated-farm history the same way SimulationService does: the
    // existing FAO-56 balance over real weather, turned into a reading with
    // SimulationRules (at most ±0.35 points of noise). Every row is Simulated.
    public static class MoistureHistorySimulator
    {
        // A farmer following the engine's advice: water back to field capacity the
        // day after the balance passes RAW. This is a simulation assumption.
        public static List<MoistureDay> Simulate(
            long zoneKey, string cropType, string soilType, double latitude,
            DateOnly firstPlanting, IReadOnlyList<ZoneWeatherDay> observedWeather)
        {
            var crop = Fao56EngineReference.TryResolveCrop(cropType)
                       ?? throw new ArgumentException("Unknown crop " + cropType, nameof(cropType));
            var seasonDays = crop.LIniDays + crop.LDevDays + crop.LMidDays + crop.LLateDays;

            var days = new List<MoistureDay>();
            double? drPrevious = null;
            double? rawPrevious = null;
            var planting = firstPlanting;

            foreach (var w in observedWeather.Where(w => !w.IsForecast).OrderBy(w => w.Date))
            {
                if (w.Date < planting) continue;

                // Replant when the season ends, so all stages keep appearing. The soil is
                // watered to field capacity before planting; that watering is recorded,
                // so the day is never used as a "no watering" example.
                var preplantMm = 0.0;
                if (w.Date.DayNumber - planting.DayNumber + 1 > seasonDays)
                {
                    planting = w.Date;
                    preplantMm = drPrevious ?? 0.0;
                    drPrevious = 0.0;
                }

                var irrigationMm = drPrevious.HasValue && rawPrevious.HasValue && drPrevious.Value > rawPrevious.Value
                    ? drPrevious.Value
                    : 0.0;

                var input = new ZoneEngineInput
                {
                    ZoneId = zoneKey,
                    CropType = cropType,
                    SoilType = soilType,
                    PlantingDate = planting,
                    FarmLatitudeDegrees = latitude,
                    Today = w.Date,
                    BalanceStartDate = w.Date,
                    InitialDepletionDate = drPrevious.HasValue ? w.Date.AddDays(-1) : (DateOnly?)null,
                    InitialDepletionMm = drPrevious,
                    Weather = new List<ZoneWeatherDay> { w },
                };
                if (irrigationMm > 0) input.IrrigationMmByDay[w.Date] = irrigationMm;

                var row = Fao56Engine.Run(input).Days.FirstOrDefault(d => d.Day == w.Date && !d.IsForecast);
                if (row?.DrEndMm == null || row.TawMm == null || row.TawMm.Value <= 0)
                {
                    drPrevious = null;
                    rawPrevious = null;
                    continue;
                }

                drPrevious = row.DrEndMm.Value;
                rawPrevious = row.RawMm;
                days.Add(new MoistureDay
                {
                    Day = w.Date,
                    Simulated = true,
                    MoisturePct = SimulationRules.MoistureFromStoredBalance(
                        row.DrEndMm.Value, row.TawMm.Value, SimulationRules.NoiseFor(zoneKey, w.Date)),
                    TMaxC = w.TMaxC,
                    TMinC = w.TMinC,
                    HumidityPct = w.RhMeanPct,
                    RainMm = row.RainMm,
                    EtoMm = row.EtoMm,
                    Kc = row.Kc,
                    AdjustedP = row.AdjustedP,
                    TawMm = row.TawMm,
                    RawMm = row.RawMm,
                    IrrigationMm = row.IrrigationMm + preplantMm,
                    Stage = row.Stage,
                });
            }

            return days;
        }
    }
}
