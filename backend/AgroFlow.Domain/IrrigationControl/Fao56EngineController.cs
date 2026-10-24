#nullable enable
using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text.Json;
using AgroFlow.Business.Agronomy;
using AgroFlow.Data;

namespace AgroFlow.Business
{
    // Controller for the FAO-56 engine (DB / XDB / Controller pattern): endpoints
    // and the hosted service call this, and this calls Fao56EngineXDB and the
    // Agronomy classes. Synchronous, no interfaces, no DTOs.
    // It is the only place that builds a ZoneEngineInput, so every caller runs the
    // engine on the same inputs.
    public class Fao56EngineController
    {
        // Days of history the water balance runs over: enough for the 7-day insights,
        // small enough to stay a cheap query per zone.
        public const int BalanceWindowDays = 30;
        public const int ForecastWindowDays = 8;

        private readonly Fao56EngineXDB db;

        public Fao56EngineController(string connectionString)
        {
            db = new Fao56EngineXDB(connectionString);
        }

        public Fao56EngineXDB Data
        {
            get { return db; }
        }

        // Today in SAST. South Africa has no daylight saving, so it is always UTC+2.
        public static DateOnly TodayInSast()
        {
            return DateOnly.FromDateTime(DateTime.UtcNow.AddHours(2));
        }

        // Build the engine's inputs for one zone.
        public ZoneEngineInput BuildInput(EngineZoneRow zone, DateOnly today)
        {
            var from = today.AddDays(-BalanceWindowDays);
            var to = today.AddDays(ForecastWindowDays);

            var input = new ZoneEngineInput
            {
                ZoneId = zone.ZoneId,
                ZoneName = zone.ZoneName,
                CropType = zone.CropType,
                PlantingDate = zone.PlantingDate,
                SoilType = zone.SoilType,
                AreaM2 = zone.AreaM2,
                FlowRateLpm = zone.FlowRateLpm,
                RootDepthLimitM = zone.RootDepthLimitM,
                CalibrationWet = zone.CalibrationWet,
                CalibrationDry = zone.CalibrationDry,
                MoistureThreshold = zone.MoistureThreshold,
                DesiredMoisture = zone.DesiredMoisture,
                FarmLatitudeDegrees = zone.FarmLatitude,

                // We have no reliable farm elevation, so we leave it unknown and the ETo
                // calculation uses (and labels) standard air pressure.
                FarmElevationM = null,

                Today = today,
                BalanceStartDate = from,

                // Lets the engine tell a fresh reading from a stale one.
                NowUtc = DateTime.UtcNow,
            };

            var prior = db.GetLastCompleteBalanceBefore(zone.ZoneId, from);
            if (prior.HasValue)
            {
                input.InitialDepletionDate = prior.Value.Day;
                input.InitialDepletionMm = prior.Value.DepletionMm;
            }

            input.Weather.AddRange(db.GetWeather(zone.FarmId, zone.ZoneId, from, to));

            foreach (var reading in db.GetMoistureReadings(zone.ZoneId, DateTime.UtcNow.AddDays(-BalanceWindowDays)))
            {
                // Mark bad readings instead of dropping them, so no row is lost.
                reading.IsValid = Fao56Engine.IsPlausibleReading(
                    reading.RawValue, zone.CalibrationWet, zone.CalibrationDry);
                input.Readings.Add(reading);
            }

            foreach (var pair in db.GetIrrigationMmByDay(zone.ZoneId, zone.FlowRateLpm, zone.AreaM2, from, to))
            {
                input.IrrigationMmByDay[pair.Key] = pair.Value;
            }

            input.SoilFeelChecks.AddRange(db.GetSoilFeelChecks(zone.ZoneId, from));

            // Only needed when a watering cannot be measured in mm.
            if (input.IrrigationMmByDay.Count == 0
                && (!(zone.FlowRateLpm > 0.0) || !(zone.AreaM2 > 0.0)))
            {
                foreach (var pair in db.GetLongestRunSecondsByDay(zone.ZoneId, from, today))
                {
                    input.LongestRunSecondsByDay[pair.Key] = pair.Value;
                }
            }

            return input;
        }

        public ZoneFaultSignals BuildFaultSignals(EngineZoneRow zone, DateOnly today)
        {
            var signals = db.GetFaultSignals(zone, DateTime.UtcNow);

            signals.SevenDayIrrigationMm = db.SumIrrigationMm(
                zone.ZoneId, zone.FlowRateLpm, zone.AreaM2, today.AddDays(-7), today);

            signals.TrailingSevenDayMeanEto = db.GetTrailingMeanEto(
                zone.FarmId, today.AddDays(-7), today.AddDays(-1));

            return signals;
        }

        // Run one zone end to end: balance, save, insights.
        public ZoneEngineResult RunZone(EngineZoneRow zone, DateOnly today, bool persist)
        {
            var input = BuildInput(zone, today);
            var result = Fao56Engine.Run(input);

            if (persist)
            {
                foreach (var day in result.Days.Where(d => !d.IsForecast))
                {
                    db.SaveWaterBalanceDay(
                        zone.ZoneId, day,
                        // A guessed stage is never stored as if it were known.
                        day.Stage.HasValue && !result.StageAssumed ? Fao56EngineReference.StageLabel(day.Stage.Value) : null);
                }

                // ETo belongs to the farm and day, so we write it once for today's row.
                var todayRow = result.Days.FirstOrDefault(d => d.Day == today);
                if (todayRow != null)
                {
                    db.SaveFarmEto(zone.FarmId, today, todayRow.EtoMm, todayRow.EtoSource, todayRow.RsSource);
                }
            }

            return result;
        }

        // Run the zone and save its insights. Returns what was written.
        public List<ZoneInsight> RunZoneAndWriteInsights(EngineZoneRow zone, DateOnly today)
        {
            var input = BuildInput(zone, today);
            var result = Fao56Engine.Run(input);
            var signals = BuildFaultSignals(zone, today);

            foreach (var day in result.Days.Where(d => !d.IsForecast))
            {
                db.SaveWaterBalanceDay(
                    zone.ZoneId, day,
                    day.Stage.HasValue && !result.StageAssumed ? Fao56EngineReference.StageLabel(day.Stage.Value) : null);
            }

            var todayRow = result.Days.FirstOrDefault(d => d.Day == today);
            if (todayRow != null)
            {
                db.SaveFarmEto(zone.FarmId, today, todayRow.EtoMm, todayRow.EtoSource, todayRow.RsSource);
            }

            var insights = ZoneInsightBuilder.Build(input, result, signals);
            WriteInsights(insights);

            HandleDhtFault(zone, signals, today);

            return insights;
        }

        // Only the act-now rules, run after each reading instead of once a day.
        public List<ZoneInsight> RunActNowChecks(EngineZoneRow zone, DateOnly today)
        {
            var input = BuildInput(zone, today);
            var result = Fao56Engine.Run(input);
            var signals = BuildFaultSignals(zone, today);

            var insights = ZoneInsightBuilder.Build(input, result, signals)
                .Where(i => i.Severity == InsightSeverity.ActNow)
                .ToList();

            WriteInsights(insights);
            HandleDhtFault(zone, signals, today);

            return insights;
        }

        public void WriteInsights(IEnumerable<ZoneInsight> insights)
        {
            foreach (var insight in insights)
            {
                db.SaveInsight(insight, SerialiseData(insight));
            }
        }

        // While the DHT11 is down we log one maintenance callout for the team.
        // It is never closed automatically; the team closes it after the visit.
        private void HandleDhtFault(EngineZoneRow zone, ZoneFaultSignals signals, DateOnly today)
        {
            if (signals.DhtOffline)
            {
                db.CreateDhtMaintenanceAlert(zone.ZoneId, signals.DhtOfflineSinceUtc);
            }
            else
            {
                // Back online: stop showing it to the farmer, but leave the callout open.
                db.ClearInsight(zone.ZoneId, InsightType.DhtOffline, today);
            }
        }

        private static string SerialiseData(ZoneInsight insight)
        {
            var payload = new Dictionary<string, object?>(insight.Data)
            {
                ["source"] = insight.Data.ContainsKey("source") ? insight.Data["source"] : insight.Source,
                ["provenance"] = insight.Source,
            };

            // Saved with the insight so "Why?" shows what was true at the time.
            if (insight.Explanation != null) payload["explanation"] = insight.Explanation;

            return JsonSerializer.Serialize(payload);
        }

        // Reset the zone's thresholds to the recommended values.
        public ResetRecommendedOutcome ResetToRecommended(long zoneId)
        {
            var zone = db.GetZone(zoneId);
            if (zone == null)
            {
                return ResetRecommendedOutcome.Failed("That zone could not be found.");
            }

            var crop = Fao56EngineReference.TryResolveCrop(zone.CropType);
            if (crop == null)
            {
                return ResetRecommendedOutcome.Failed(string.IsNullOrWhiteSpace(zone.CropType)
                    ? "Set this zone's crop first, then tap Reset to recommended."
                    : "We do not have water figures for \"" + zone.CropType + "\" yet, so there is no recommended setting for it.");
            }

            var soil = Fao56EngineReference.TryResolveSoil(zone.SoilType);
            if (soil == null)
            {
                return ResetRecommendedOutcome.Failed("Set this zone's soil type first, then tap Reset to recommended.");
            }

            if (!zone.CalibrationWet.HasValue || !zone.CalibrationDry.HasValue)
            {
                return ResetRecommendedOutcome.Failed("Do the wet and dry soil setup first, then tap Reset to recommended.");
            }

            var pr = crop.DepletionFractionP * soil.PFactor;
            if (pr < SoilWaterBalance.MinDepletionFraction) pr = SoilWaterBalance.MinDepletionFraction;
            if (pr > SoilWaterBalance.MaxDepletionFraction) pr = SoilWaterBalance.MaxDepletionFraction;

            var wet = zone.CalibrationWet.Value;
            var dry = zone.CalibrationDry.Value;
            var domain = Fao56Engine.DetectSensorDomain(wet, dry);
            if (domain == SoilMoistureDomain.InvalidMixedCalibration)
                return ResetRecommendedOutcome.Failed("Wet and dry settings use different sensor scales. Record both again first.");

            var desired = domain == SoilMoistureDomain.RelativePercent ? 100.0 : wet;
            var threshold = domain == SoilMoistureDomain.RelativePercent
                ? 100.0 * (1.0 - pr)
                : wet - pr * (wet - dry);

            db.SaveRecommendedThresholds(zoneId, threshold, desired);

            var message =
                "Reset for " + crop.Label.ToLowerInvariant() + ": waters at " +
                threshold.ToString("F0", CultureInfo.InvariantCulture) + ", stops at " +
                desired.ToString("F0", CultureInfo.InvariantCulture) + ".";

            return ResetRecommendedOutcome.Succeeded(message, threshold, desired);
        }

        // Wet/dry sensor calibration.
        public const double MinCalibrationSeparationFraction = 0.10;

        public CalibrationOutcome SaveCalibrationPoint(long zoneId, string point)
        {
            if (point != "wet" && point != "dry")
            {
                return CalibrationOutcome.Failed("Pick either the wet or the dry point.");
            }

            var zone = db.GetZone(zoneId);
            if (zone == null) return CalibrationOutcome.Failed("That zone could not be found.");

            var reading = db.GetLatestValidReading(zoneId);
            if (!reading.HasValue)
            {
                return CalibrationOutcome.Failed("No recent soil reading from this zone yet. Wait for the next reading and try again.");
            }

            // Check the gap to the other point before writing anything.
            var other = point == "wet" ? zone.CalibrationDry : zone.CalibrationWet;

            if (other.HasValue)
            {
                var domain = Fao56Engine.DetectSensorDomain(
                    point == "wet" ? reading.Value : other.Value,
                    point == "dry" ? reading.Value : other.Value);
                if (domain == SoilMoistureDomain.InvalidMixedCalibration)
                {
                    return CalibrationOutcome.Failed(
                        "This reading uses a different sensor scale from the saved point. Clear the old calibration and record both points again.");
                }

                var separation = Math.Abs(reading.Value - other.Value);
                var domainMaximum = domain == SoilMoistureDomain.RelativePercent
                    ? 100.0
                    : Fao56Engine.MaxAdcReading;
                if (separation < MinCalibrationSeparationFraction * domainMaximum)
                {
                    return CalibrationOutcome.Failed("Wet and dry readings are too close. Try again.");
                }
            }

            db.SaveCalibrationPoint(zoneId, point, reading.Value);

            var message = point == "wet"
                ? "Wet setting saved."
                : "Dry setting saved.";

            return CalibrationOutcome.Succeeded(message, reading.Value);
        }

        // Soil type.
        public SoilTypeOutcome SaveSoilType(long zoneId, string? soilType)
        {
            var soil = Fao56EngineReference.TryResolveSoil(soilType);
            if (soil == null)
            {
                return SoilTypeOutcome.Failed("Pick sandy, loam or clay.");
            }

            var zone = db.GetZone(zoneId);
            if (zone == null) return SoilTypeOutcome.Failed("That zone could not be found.");

            db.SaveSoilType(zoneId, soil.Key);

            // Recalculate today's advice for the new soil. We do not change the farmer's
            // saved threshold; if it is now unsafe, the threshold_unsafe insight says so.
            var today = TodayInSast();
            var refreshed = db.GetZone(zoneId);
            if (refreshed != null)
            {
                RunZoneAndWriteInsights(refreshed, today);
            }

            return SoilTypeOutcome.Succeeded(
                "Soil set to " + soil.Label.ToLowerInvariant() + ". Watering advice updated.", soil.Key);
        }
    }

    // Expected farmer-facing problems (like "do the wet/dry setup first") come back
    // as small outcome objects instead of exceptions.
    public sealed class ResetRecommendedOutcome
    {
        public bool Ok { get; private set; }
        public string Message { get; private set; } = string.Empty;
        public double? Threshold { get; private set; }
        public double? Desired { get; private set; }

        public static ResetRecommendedOutcome Succeeded(string message, double threshold, double desired)
        {
            return new ResetRecommendedOutcome { Ok = true, Message = message, Threshold = threshold, Desired = desired };
        }

        public static ResetRecommendedOutcome Failed(string message)
        {
            return new ResetRecommendedOutcome { Ok = false, Message = message };
        }
    }

    public sealed class CalibrationOutcome
    {
        public bool Ok { get; private set; }
        public string Message { get; private set; } = string.Empty;
        public double? Reading { get; private set; }

        public static CalibrationOutcome Succeeded(string message, double reading)
        {
            return new CalibrationOutcome { Ok = true, Message = message, Reading = reading };
        }

        public static CalibrationOutcome Failed(string message)
        {
            return new CalibrationOutcome { Ok = false, Message = message };
        }
    }

    public sealed class SoilTypeOutcome
    {
        public bool Ok { get; private set; }
        public string Message { get; private set; } = string.Empty;
        public string? SoilType { get; private set; }

        public static SoilTypeOutcome Succeeded(string message, string soilType)
        {
            return new SoilTypeOutcome { Ok = true, Message = message, SoilType = soilType };
        }

        public static SoilTypeOutcome Failed(string message)
        {
            return new SoilTypeOutcome { Ok = false, Message = message };
        }
    }
}
