#nullable enable
using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using AgroFlow.Business.Agronomy.RuleBook;

namespace AgroFlow.Business.Agronomy
{
    // Turns an engine run into the farmer-facing insight rows of section 7.
    //
    // COPY RULES, ENFORCED HERE AND NOT LEFT TO GOODWILL
    // -------------------------------------------------
    // No Kc, ETo, ETc, TAW, RAW, p, Ks or "depletion" ever reaches a message.
    // One action per message, about 120 characters or less. Whole minutes and
    // whole litres, and litres always carry "about" because there is no flow
    // meter. The numbers themselves and their provenance go in Data and Source,
    // which reports print and farmers never see.
    //
    // There is a test that greps every generated message for the banned words.
    //
    // THE ORDER THE RULES ARE CALLED IN (item 2b). Every decision below is a
    // call into RuleBook/; this file only words the answer.
    //   1. ConfidenceRules.NextStep      -> setup_missing (one step)
    //   2. KitRules.IsOffline            -> zone_offline
    //   3. KitRules.IsStuck              -> sensor_stuck
    //   4. signals (KitRules.PumpRanNoChange, in the data layer) -> watering_failed
    //   5. signals (KitRules.IsDhtOffline, in the data layer)    -> dht_offline
    //   6. WaterRules.RecommendedThreshold + ThresholdTooDry     -> threshold_unsafe
    //   7. WaterRules.ShouldWaterToday, then AtOrBelowFarmerThreshold
    //      -> due for water today
    //   8. WaterRules.SkipForRain        -> skip_rain, else water_now
    //   9. (a day with no weather)       -> data_gap
    //  10. WaterRules.WaterSoon          -> water_soon
    //  11. WaterRules.HotDaysAhead       -> hot_days
    //  12. CropRules: assumed stage, SeasonComplete, StageFor, SensitiveStage,
    //      NextStageChange + StageChangeSoon, HarvestSoon
    //      -> growth_status, season_complete, peak_growth, stage_change, harvest_soon
    //  13. WaterRules.WasStressed        -> stress_days
    //  14. VerdictRules.For == TooMuch   -> overwatering
    //  15. KitRules.IsDrifting           -> sensor_drift

    public static class InsightSeverity
    {
        public const string ActNow = "act_now";
        public const string HeadsUp = "heads_up";
        public const string Info = "info";
    }

    public static class InsightType
    {
        public const string WaterNow = "water_now";
        public const string SkipRain = "skip_rain";
        public const string WateringFailed = "watering_failed";
        public const string SensorStuck = "sensor_stuck";
        public const string SensorDrift = "sensor_drift";
        public const string ZoneOffline = "zone_offline";
        public const string ThresholdUnsafe = "threshold_unsafe";
        public const string SetupMissing = "setup_missing";
        public const string DhtOffline = "dht_offline";
        public const string DataGap = "data_gap";
        public const string WaterSoon = "water_soon";
        public const string StageChange = "stage_change";
        public const string PeakGrowth = "peak_growth";
        public const string HarvestSoon = "harvest_soon";
        public const string HotDays = "hot_days";
        public const string Overwatering = "overwatering";
        public const string StressDays = "stress_days";
        public const string GrowthStatus = "growth_status";
        public const string SeasonComplete = "season_complete";
    }

    public sealed class ZoneInsight
    {
        public long ZoneId { get; set; }
        public string InsightType { get; set; } = string.Empty;
        public string Severity { get; set; } = InsightSeverity.Info;

        // What the farmer reads.
        public string Message { get; set; } = string.Empty;

        // Where it came from. Reports always show this; farmers never do.
        public string Source { get; set; } = string.Empty;

        // The raw numbers behind the message, written to ai_recommendation.data.
        public Dictionary<string, object?> Data { get; } = new Dictionary<string, object?>();

        public DateOnly ValidFor { get; set; }

        // Item 2c: "Why am I seeing this?", built from the same rule and
        // inputs as the message. Stored in ai_recommendation.data.explanation
        // so it can be shown later exactly as it was.
        public Explanation? Explanation { get; set; }
    }

    // Extra signals the engine itself cannot see, because they come from pump
    // runs and device timing rather than from the water balance.
    public sealed class ZoneFaultSignals
    {
        // Most recent reading age, for zone_offline.
        public TimeSpan? SinceLastReading { get; set; }

        // How long the latest valid reading has been identical, for sensor_stuck.
        public TimeSpan? IdenticalReadingFor { get; set; }

        // A pump run of at least 2 minutes whose soil reading did not move toward
        // wet within 30 minutes, for watering_failed.
        public bool WateringAppearedToFail { get; set; }
        public DateTime? FailedRunAtUtc { get; set; }

        // Spec 8b: the board is still sending soil readings but no valid DHT11
        // temperature or humidity.
        public bool DhtOffline { get; set; }
        public DateTime? DhtOfflineSinceUtc { get; set; }

        // The zone's 7-day minimum reading - its wettest point after watering -
        // for sensor_drift.
        public double? SevenDayMinimumReading { get; set; }

        // Irrigation and crop water use over the last 7 days, for overwatering.
        public double? SevenDayIrrigationMm { get; set; }

        // Trailing 7-day mean ETo, for hot_days.
        public double? TrailingSevenDayMeanEto { get; set; }
    }

    public static class ZoneInsightBuilder
    {
        // The thresholds live in RuleBook/ with their reasons; these names are
        // kept so nothing that read them here breaks.
        public const int ZoneOfflineHours = KitRules.ZoneOfflineHours;
        public const int SensorStuckHours = KitRules.SensorStuckHours;
        public const int WaterSoonDays = WaterRules.WaterSoonDays;
        public const int StageChangeWarningDays = CropRules.StageChangeWarningDays;
        public const int HarvestSoonDays = CropRules.HarvestSoonDays;
        public const double HotDaysEtoMultiple = WaterRules.HotDaysEtoMultiple;
        public const double OverwateringMultiple = VerdictRules.OverwaterRatio;
        public const double SensorDriftFraction = KitRules.SensorDriftFraction;

        public static List<ZoneInsight> Build(
            ZoneEngineInput input, ZoneEngineResult result, ZoneFaultSignals signals)
        {
            if (input == null) throw new ArgumentNullException(nameof(input));
            if (result == null) throw new ArgumentNullException(nameof(result));
            signals ??= new ZoneFaultSignals();

            var insights = new List<ZoneInsight>();
            var today = input.Today;
            var zone = input.ZoneName;

            // ---------------- act_now ----------------------------------------

            // setup_missing: ONE next step, not a list (item 2). Only act_now
            // when there is no crop - otherwise advice still comes, and finishing
            // setup only improves it, so it is a heads-up. The full list stays
            // in data for the setup checklist.
            if (result.MissingSetup.Count > 0)
            {
                var step = result.NextStep;
                var message = step != null && step.Field != "kit"
                    ? step.Ask
                    : $"Finish setting up {zone}: add {JoinNaturally(result.MissingSetup)}.";

                insights.Add(Make(input, InsightType.SetupMissing,
                    result.Crop == null ? InsightSeverity.ActNow : InsightSeverity.HeadsUp,
                    Trim(message),
                    "Zone setup fields that the water figures need",
                    today,
                    ("missing", result.MissingSetup.ToArray()),
                    ("next_step", step?.Field),
                    ("confidence", result.Confidence.Key)));
            }

            // zone_offline: no reading for 3 hours.
            if (KitRules.IsOffline(signals.SinceLastReading))
            {
                var at = result.LatestReadingAtUtc.HasValue
                    ? result.LatestReadingAtUtc.Value.AddHours(2).ToString("HH:mm on d MMM", CultureInfo.InvariantCulture)
                    : "its last report";
                insights.Add(Make(input, InsightType.ZoneOffline, InsightSeverity.ActNow,
                    Trim($"No data from {zone} since {at}."),
                    "Time since the zone's last soil reading",
                    today,
                    ("hours_since_last_reading", Math.Round(signals.SinceLastReading!.Value.TotalHours, 1))));
            }

            // sensor_stuck: the same valid reading for 6 hours.
            if (KitRules.IsStuck(signals.IdenticalReadingFor))
            {
                var stuckHours = Math.Round(signals.IdenticalReadingFor!.Value.TotalHours, 1);
                insights.Add(Make(input, InsightType.SensorStuck, InsightSeverity.ActNow,
                    Trim($"{zone} sensor may be faulty or loose. Check it."),
                    "Soil sensor reported an unchanged value for " +
                    stuckHours.ToString(CultureInfo.InvariantCulture) + " hours",
                    today,
                    ("identical_for_hours", stuckHours),
                    ("reading", result.LatestRawReading)));
            }

            // watering_failed: the pump ran but the soil did not get wetter.
            if (signals.WateringAppearedToFail)
            {
                insights.Add(Make(input, InsightType.WateringFailed, InsightSeverity.ActNow,
                    Trim($"{zone}: pump ran but soil didn't get wetter. Check pump, pipe and water supply."),
                    "Pump runtime of at least 2 minutes with no move toward wet on the soil sensor within 30 minutes",
                    today,
                    ("run_at", signals.FailedRunAtUtc)));
            }

            // dht_offline: spec 8b.
            if (signals.DhtOffline)
            {
                insights.Add(Make(input, InsightType.DhtOffline, InsightSeverity.ActNow,
                    Trim($"{zone}'s temperature sensor isn't working. We're using weather app data for now, and our team has been notified."),
                    "No valid temperature or humidity reading from the zone's sensor while soil readings continue",
                    today,
                    ("offline_since", signals.DhtOfflineSinceUtc)));
            }

            // threshold_unsafe: the farmer's trigger is drier than FAO-56 allows.
            var recommendedThreshold = RecommendedThreshold(input, result);
            if (recommendedThreshold.HasValue && input.MoistureThreshold.HasValue
                && WaterRules.ThresholdTooDry(input.MoistureThreshold.Value, recommendedThreshold.Value,
                    input.CalibrationWet!.Value, input.CalibrationDry!.Value))
            {
                var cropLabel = result.Crop != null ? result.Crop.Label.ToLowerInvariant() : "this crop";
                insights.Add(Make(input, InsightType.ThresholdUnsafe, InsightSeverity.ActNow,
                    Trim($"{zone} waters too late for {cropLabel}. Tap Reset to recommended."),
                    "FAO-56 Table 22 depletion fraction for " + cropLabel + " against this zone's wet/dry setup",
                    today,
                    ("current_threshold", input.MoistureThreshold),
                    ("recommended_threshold", Math.Round(recommendedThreshold.Value, 1))));
            }

            var todayRow = result.Days.FirstOrDefault(d => d.Day == today);
            var dueForWater = result.BalanceRan && result.DepletionMm.HasValue && result.RawMm.HasValue
                              && WaterRules.ShouldWaterToday(result.DepletionMm.Value, result.RawMm.Value);

            // A reading at or below the farmer's own threshold also means water now
            // - but only a fresh one (item 2): yesterday's dry reading says
            // nothing about today.
            if (!dueForWater && WaterRules.AtOrBelowFarmerThreshold(
                    result.RelativeMoisturePercent, input.MoistureThreshold, readingFresh: !result.ReadingStale))
            {
                dueForWater = true;
            }

            // skip_rain takes precedence over water_now: there is no point telling
            // someone to water and to skip watering on the same day.
            var rainToday = todayRow?.RainMm ?? 0.0;
            var etcToday = result.EtcTodayMm;
            var rainCoversToday = dueForWater && etcToday.HasValue && WaterRules.SkipForRain(rainToday, etcToday.Value);

            if (rainCoversToday)
            {
                var saved = result.RecommendedLitres;
                var litresText = saved.HasValue
                    ? " and save ~" + Math.Round(saved.Value).ToString("F0", CultureInfo.InvariantCulture) + " L"
                    : "";
                insights.Add(Make(input, InsightType.SkipRain, InsightSeverity.ActNow,
                    Trim($"Rain expected. Skip watering {zone} today{litresText}."),
                    "Weather app forecast rain for today against this crop's water use",
                    today,
                    ("forecast_rain_mm", Math.Round(rainToday, 1)),
                    ("crop_water_use_mm", etcToday.HasValue ? Math.Round(etcToday.Value, 2) : (double?)null),
                    ("litres_saved", saved.HasValue ? Math.Round(saved.Value) : (double?)null),
                    ("source", todayRow?.EtoSource)));
            }
            else if (dueForWater)
            {
                var minutes = result.RecommendedMinutes;
                var litres = result.RecommendedLitres;

                var perM2 = result.RecommendedMinutesPerSquareMetre;
                var depth = result.RecommendedDepthMm;

                // Item 2: always an amount. Whole-zone minutes and litres when
                // the zone is set up; otherwise per square metre, or as a depth.
                string amount;
                if (minutes.HasValue && litres.HasValue)
                {
                    amount = $"about {minutes.Value} min (~{Math.Round(litres.Value):F0} L)";
                }
                else if (litres.HasValue)
                {
                    amount = $"about {Math.Round(litres.Value):F0} L";
                }
                else
                {
                    amount = "";
                }

                // No size: the brief's own sentence, per square metre.
                var perM2Sentence = "";
                if (amount.Length == 0 && perM2.HasValue && depth.HasValue)
                {
                    perM2Sentence = $" For each square metre, run the pump about {perM2.Value.ToString("0.#", CultureInfo.InvariantCulture)} minutes ({depth.Value.ToString("0.#", CultureInfo.InvariantCulture)} mm).";
                }
                else if (amount.Length == 0 && depth.HasValue && depth.Value > 0.0)
                {
                    perM2Sentence = $" Give about {depth.Value.ToString("0.#", CultureInfo.InvariantCulture)} mm ({depth.Value.ToString("0.#", CultureInfo.InvariantCulture)} L per square metre).";
                }

                var message = (amount.Length > 0 ? $"Water {zone} now: {amount}." : $"Water {zone} now.") + perM2Sentence;
                if (result.ReadingStale)
                {
                    var action = (amount.Length > 0 ? $"water {zone} now, {amount}." : $"water {zone} now.") + perM2Sentence;
                    message = $"Based on the weather ({ConfidenceRules.KitQuiet(result.LatestReadingAtUtc)}): " + action;

                    // Never trim the amount away to fit the date in: the date is
                    // also in the confidence line, the amount is only here.
                    if (message.Length > MaxMessageLength) message = "Based on the weather: " + action;
                }

                insights.Add(Make(input, InsightType.WaterNow, InsightSeverity.ActNow,
                    Trim(message),
                    result.ReadingStale || !result.Setup.Calibrated
                        ? "FAO-56 Table 22 + weather water balance: the soil has dried past what this crop can stand"
                        : "FAO-56 Table 22 + soil sensor: the soil has dried past what this crop can stand",
                    today,
                    ("minutes", minutes),
                    ("litres", litres.HasValue ? Math.Round(litres.Value, 1) : (double?)null),
                    ("minutes_per_m2", perM2),
                    ("depth_mm", depth),
                    ("confidence", result.Confidence.Key),
                    ("source", todayRow?.EtoSource)));
            }

            // ---------------- heads_up ---------------------------------------

            // data_gap: a day with no usable weather.
            var gapDay = result.Days.FirstOrDefault(d => !d.IsForecast && !d.EtoMm.HasValue);
            if (gapDay != null)
            {
                insights.Add(Make(input, InsightType.DataGap, InsightSeverity.HeadsUp,
                    Trim($"Weather data missing for {gapDay.Day.ToString("d MMM", CultureInfo.InvariantCulture)}. Advice for {zone} may be less accurate."),
                    "No usable weather-app or zone-sensor temperature for that day",
                    today,
                    ("date", gapDay.Day.ToString("yyyy-MM-dd"))));
            }

            // water_soon: within 2 days, and only when not already due today.
            if (!dueForWater && WaterRules.WaterSoon(result.DaysToNextWatering)
                && result.NextWateringDate.HasValue)
            {
                var weekday = result.NextWateringDate.Value.ToString("dddd", CultureInfo.InvariantCulture);
                insights.Add(Make(input, InsightType.WaterSoon, InsightSeverity.HeadsUp,
                    Trim($"{zone} will need water in ~{result.DaysToNextWatering!.Value} days ({weekday})."),
                    "Weather app forecast projected forward against this crop's water use",
                    today,
                    ("days", result.DaysToNextWatering),
                    ("date", result.NextWateringDate.Value.ToString("yyyy-MM-dd"))));
            }

            // hot_days: forecast ETo well above the recent average.
            if (signals.TrailingSevenDayMeanEto.HasValue && signals.TrailingSevenDayMeanEto.Value > 0.0)
            {
                var forecastEto = result.Days
                    .Where(d => d.IsForecast && d.EtoMm.HasValue)
                    .Select(d => d.EtoMm!.Value)
                    .ToList();

                if (forecastEto.Count > 0)
                {
                    var peak = forecastEto.Max();
                    if (WaterRules.HotDaysAhead(peak, signals.TrailingSevenDayMeanEto.Value))
                    {
                        insights.Add(Make(input, InsightType.HotDays, InsightSeverity.HeadsUp,
                            Trim($"Hot, dry days ahead. {zone} will need more water than usual."),
                            "Weather app forecast compared with the last 7 days",
                            today,
                            ("forecast_peak_mm", Math.Round(peak, 2)),
                            ("trailing_mean_mm", Math.Round(signals.TrailingSevenDayMeanEto.Value, 2))));
                    }
                }
            }

            // Item 2: the stage is assumed, so say so - and say nothing about
            // stage changes or harvest, which would need a real date.
            if (result.Crop != null && result.StageAssumed)
            {
                insights.Add(Make(input, InsightType.GrowthStatus, InsightSeverity.Info,
                    Trim($"{result.Crop.Label}: {CropRules.AssumedStageLabel} (no planting date yet)."),
                    "FAO-56 Table 12: the highest crop factor, used when the planting date is unknown",
                    today,
                    ("stage", CropRules.AssumedStageLabel),
                    ("stage_assumed", true)));
            }

            // Crop and stage insights need the season.
            if (result.Crop != null && result.DayOfSeason.HasValue && result.Stage.HasValue)
            {
                var crop = result.Crop;
                var i = result.DayOfSeason.Value;
                var total = crop.TotalDays;
                var cropLabel = crop.Label;

                if (CropRules.SeasonComplete(crop, i))
                {
                    insights.Add(Make(input, InsightType.SeasonComplete, InsightSeverity.Info,
                        Trim($"{cropLabel} season is complete. Update the planting date for your next crop."),
                        "FAO-56 Table 11 season length (" + crop.Table11Row + ")",
                        today,
                        ("day_of_season", i), ("total_days", total)));
                }
                else
                {
                    insights.Add(Make(input, InsightType.GrowthStatus, InsightSeverity.Info,
                        Trim($"{cropLabel}: {Fao56EngineReference.StageLabel(result.Stage.Value)}, day {i} of {total}."),
                        "FAO-56 Table 11 stage lengths (" + crop.Table11Row + ")",
                        today,
                        ("day_of_season", i), ("total_days", total),
                        ("stage", Fao56EngineReference.StageLabel(result.Stage.Value))));

                    // peak_growth: the stage where a shortage costs the most.
                    if (CropRules.SensitiveStage(result.Stage.Value))
                    {
                        insights.Add(Make(input, InsightType.PeakGrowth, InsightSeverity.HeadsUp,
                            Trim($"{cropLabel} is at peak growth. Don't let it dry out; shortages now cost the most yield."),
                            "FAO-56 Chapter 8: water shortage during flowering and yield formation costs the most yield",
                            today,
                            ("stage", "Peak growth")));
                    }

                    // stage_change: the next stage inside a week.
                    var next = CropRules.NextStageChange(crop, i);
                    if (next != null && CropRules.StageChangeSoon(next.Value.DaysUntil))
                    {
                        var kcNow = CropRules.KcFor(crop, i);
                        var kcThen = CropRules.KcFor(crop, i + next.Value.DaysUntil);

                        var direction = kcThen >= kcNow ? "rise" : "drop";
                        var stageLabel = Fao56EngineReference.StageLabel(next.Value.Stage);
                        insights.Add(Make(input, InsightType.StageChange, InsightSeverity.HeadsUp,
                            Trim($"{cropLabel} moves to {stageLabel} in {next.Value.DaysUntil} days. Water need will {direction}."),
                            "FAO-56 Table 11 stage lengths and Table 12 crop factors",
                            today,
                            ("days_until", next.Value.DaysUntil), ("next_stage", stageLabel)));
                    }

                    // harvest_soon.
                    var harvestIn = CropRules.HarvestSoon(crop, i);
                    if (harvestIn.HasValue)
                    {
                        var daysToEnd = harvestIn.Value;
                        insights.Add(Make(input, InsightType.HarvestSoon, InsightSeverity.HeadsUp,
                            Trim($"About {daysToEnd} days to harvest. {cropLabel} needs less water from now."),
                            "FAO-56 Table 11 season length and the falling late-season crop factor",
                            today,
                            ("days_to_end", daysToEnd)));
                    }
                }
            }

            // stress_days: any day in the last 7 where the crop was drawing hard.
            var recentStress = result.Days
                .Where(d => !d.IsForecast && d.Ks.HasValue && WaterRules.WasStressed(d.Ks.Value)
                            && d.Day > today.AddDays(-7) && d.Day <= today)
                .ToList();

            if (recentStress.Count > 0)
            {
                insights.Add(Make(input, InsightType.StressDays, InsightSeverity.HeadsUp,
                    Trim($"{zone} was too dry on {recentStress.Count} day(s) this week."),
                    "FAO-56 Eq. 84: days when the soil was drier than this crop can comfortably draw from",
                    today,
                    ("days", recentStress.Count),
                    ("dates", recentStress.Select(d => d.Day.ToString("yyyy-MM-dd")).ToArray())));
            }

            // overwatering: more applied than the crop used.
            var sevenDayEtc = result.Days
                .Where(d => !d.IsForecast && d.EtcMm.HasValue && d.Day > today.AddDays(-7) && d.Day <= today)
                .Sum(d => d.EtcMm!.Value);

            if (signals.SevenDayIrrigationMm.HasValue
                && VerdictRules.For(signals.SevenDayIrrigationMm.Value, sevenDayEtc) == WateringVerdict.TooMuch)
            {
                var ratio = signals.SevenDayIrrigationMm.Value / sevenDayEtc;
                insights.Add(Make(input, InsightType.Overwatering, InsightSeverity.HeadsUp,
                    Trim($"{zone} got about {ratio.ToString("0.#", CultureInfo.InvariantCulture)}x more water than needed this week."),
                    "Pump runtime x zone flow rate against this crop's water use over 7 days",
                    today,
                    ("ratio", Math.Round(ratio, 2)),
                    ("irrigation_mm", Math.Round(signals.SevenDayIrrigationMm.Value, 1)),
                    ("crop_use_mm", Math.Round(sevenDayEtc, 1))));
            }

            // sensor_drift: the wettest point after watering has moved.
            if (KitRules.IsDrifting(signals.SevenDayMinimumReading, input.CalibrationWet, input.CalibrationDry))
            {
                var drift = Math.Abs(signals.SevenDayMinimumReading!.Value - input.CalibrationWet!.Value);
                insights.Add(Make(input, InsightType.SensorDrift, InsightSeverity.HeadsUp,
                    Trim($"{zone} sensor readings are drifting. Re-do the wet/dry setup."),
                    "The zone's wettest reading this week against its saved wet setting - a resistive probe drifts as it corrodes",
                    today,
                    ("seven_day_minimum", signals.SevenDayMinimumReading),
                    ("calibration_wet", input.CalibrationWet),
                    ("drift", Math.Round(drift, 1))));
            }

            // Item 2c: every insight carries its own explanation.
            foreach (var insight in insights)
            {
                insight.Explanation = Explanations.For(insight, input, result, signals);
            }

            return insights;
        }

        // ------------------------------------------------------------------
        // Recommended threshold, shared with the reset-recommended endpoint:
        //   p_r = clamp(p * soilFactor, 0.1, 0.8)
        //   threshold = wet - p_r * (wet - dry)
        // ------------------------------------------------------------------
        public static double? RecommendedThreshold(ZoneEngineInput input, ZoneEngineResult result)
        {
            if (result.Crop == null) return null;
            if (!input.CalibrationWet.HasValue || !input.CalibrationDry.HasValue) return null;

            return WaterRules.RecommendedThreshold(
                result.Crop.DepletionFractionP, result.Soil.PFactor,
                input.CalibrationWet.Value, input.CalibrationDry.Value);
        }

        private static ZoneInsight Make(
            ZoneEngineInput input, string type, string severity, string message, string source,
            DateOnly validFor, params (string Key, object? Value)[] data)
        {
            var insight = new ZoneInsight
            {
                ZoneId = input.ZoneId,
                InsightType = type,
                Severity = severity,
                Message = message,
                Source = source,
                ValidFor = validFor,
            };

            foreach (var pair in data)
            {
                insight.Data[pair.Key] = pair.Value;
            }

            return insight;
        }

        // Spec 7: about 120 characters. Long zone or crop names can push a message
        // past that, so it is trimmed on a word boundary rather than mid-word.
        public const int MaxMessageLength = 120;

        private static string Trim(string message)
        {
            if (message.Length <= MaxMessageLength) return message;

            var cut = message.LastIndexOf(' ', Math.Min(MaxMessageLength - 1, message.Length - 1));
            if (cut <= 0) cut = MaxMessageLength - 1;
            return message.Substring(0, cut).TrimEnd(',', '.', ' ') + ".";
        }

        private static string JoinNaturally(IReadOnlyList<string> items)
        {
            if (items.Count == 0) return string.Empty;
            if (items.Count == 1) return items[0];
            if (items.Count == 2) return items[0] + " and " + items[1];
            return string.Join(", ", items.Take(items.Count - 1)) + " and " + items[items.Count - 1];
        }
    }
}
