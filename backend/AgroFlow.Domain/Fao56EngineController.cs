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
    // Controller layer for the FAO-56 engine, in the project's DB / XDB /
    // Controller shape: the endpoints and the hosted service talk to this, this
    // talks to Fao56EngineXDB and the Agronomy calculation classes, and nothing
    // skips a layer. Synchronous, no interfaces, no DTOs.
    //
    // This is also the only place that knows how to assemble a ZoneEngineInput
    // from database rows, so the daily job, the after-a-reading checks and the
    // report endpoint all run the engine on identically-built inputs. One source
    // of truth for the advice, rather than three that drift.
    public class Fao56EngineController
    {
        // How much history the balance is run over. Long enough for the 7-day
        // insights and to let Dr settle from its anchor, short enough to stay a
        // cheap query per zone.
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

        // Today in Africa/Johannesburg. South Africa has no daylight saving, so
        // the offset is a fixed UTC+2 and this needs no timezone database.
        public static DateOnly TodayInSast()
        {
            return DateOnly.FromDateTime(DateTime.UtcNow.AddHours(2));
        }

        // ------------------------------------------------------------------
        // Assemble the engine's inputs for one zone.
        // ------------------------------------------------------------------
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

                // farm has no reliable elevation column. Leave it unknown; the
                // ETo resolver labels its standard-pressure fallback rather than
                // inventing an elevation for the farm.
                FarmElevationM = null,

                Today = today,
                BalanceStartDate = from,

                // Item 2: lets the engine tell a fresh reading from a stale one.
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
                // Mark rather than drop: spec 3a says never lose a row.
                reading.IsValid = Fao56Engine.IsPlausibleReading(
                    reading.RawValue, zone.CalibrationWet, zone.CalibrationDry);
                input.Readings.Add(reading);
            }

            foreach (var pair in db.GetIrrigationMmByDay(zone.ZoneId, zone.FlowRateLpm, zone.AreaM2, from, to))
            {
                input.IrrigationMmByDay[pair.Key] = pair.Value;
            }

            // Item 6: the farmer's own soil checks.
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

        // ------------------------------------------------------------------
        // Run one zone end to end: balance, persist, insights.
        // ------------------------------------------------------------------
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
                        // An assumed stage (item 2) is never stored as if it were known.
                        day.Stage.HasValue && !result.StageAssumed ? Fao56EngineReference.StageLabel(day.Stage.Value) : null);
                }

                // ETo belongs to the farm-day, not the zone, so it is written once
                // for today's row rather than once per zone.
                var todayRow = result.Days.FirstOrDefault(d => d.Day == today);
                if (todayRow != null)
                {
                    db.SaveFarmEto(zone.FarmId, today, todayRow.EtoMm, todayRow.EtoSource, todayRow.RsSource);
                }
            }

            return result;
        }

        // Run the zone and write its insights. Returns what was written so a
        // caller can log or report it.
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

        // Only the act_now rules, for running after a reading arrives rather than
        // once a day (spec section 10).
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

        // Spec 8b: while the DHT11 is down, log one maintenance callout for the
        // team. Never closed automatically, even when the sensor returns - the
        // team closes it after the visit.
        private void HandleDhtFault(EngineZoneRow zone, ZoneFaultSignals signals, DateOnly today)
        {
            if (signals.DhtOffline)
            {
                db.CreateDhtMaintenanceAlert(zone.ZoneId, signals.DhtOfflineSinceUtc);
            }
            else
            {
                // Back online: stop telling the farmer about it. The callout row
                // is deliberately left open.
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

            // Item 2c: stored with the insight so "Why?" shows what was true then.
            if (insight.Explanation != null) payload["explanation"] = insight.Explanation;

            return JsonSerializer.Serialize(payload);
        }

        // ------------------------------------------------------------------
        // Reset to recommended (spec section 8).
        // ------------------------------------------------------------------
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

        // ------------------------------------------------------------------
        // Calibration (spec section 8).
        // ------------------------------------------------------------------
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

            // The other point as it currently stands, to check the separation
            // BEFORE writing anything.
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

        // ------------------------------------------------------------------
        // Soil type (spec section 11).
        // ------------------------------------------------------------------
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

            // Recalculate today's advice for the new soil. The farmer's own saved
            // thresholds are NOT touched - if the new soil makes their threshold
            // unsafe, the normal threshold_unsafe insight says so rather than this
            // endpoint quietly rewriting their setting.
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

    // Small outcome objects rather than exceptions for expected, farmer-facing
    // failures: "do the wet/dry setup first" is a normal answer, not a fault.
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
