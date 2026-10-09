#nullable enable
using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using AgroFlow.Business.Agronomy.RuleBook;

namespace AgroFlow.Business.Agronomy
{
    // The per-zone daily water balance: the piece that turns FAO-56 into "water
    // for 4 minutes".
    //
    // Deterministic and synchronous. No I/O, no clock, no database - the caller
    // (Fao56EngineXDB / the hosted service) reads the rows and hands them in, so
    // this whole file is verifiable against the book offline.
    //
    // Equation references are FAO-56 (Allen et al., 1998).

    // One soil moisture reading as stored: raw as the device sent it.
    public sealed class ZoneMoistureReading
    {
        public DateTime RecordedAtUtc { get; set; }
        public double RawValue { get; set; }

        // False when the reading failed the spec 3b plausibility checks. Kept in
        // the list - never dropped - but excluded from every calculation.
        public bool IsValid { get; set; } = true;
    }

    // Item 6: a farmer's own "How does the soil feel?" check.
    public sealed class ZoneSoilFeelCheck
    {
        public DateTime CheckedAtUtc { get; set; }
        public string Feel { get; set; } = "moist"; // dry | moist | wet
    }

    // One day of weather for a farm, as weather_daily holds it plus the dht_daily
    // view's values for the same day.
    public sealed class ZoneWeatherDay
    {
        public DateOnly Date { get; set; }
        public bool HasWeatherRow { get; set; } = true;
        public double? TMinC { get; set; }
        public double? TMaxC { get; set; }
        public double? RainMm { get; set; }
        public double? RhMinPct { get; set; }
        public double? RhMaxPct { get; set; }
        public double? RhMeanPct { get; set; }
        public double? WindMs { get; set; }
        public double? WindHeightM { get; set; }
        public bool IsForecast { get; set; }

        public double? DhtTMinC { get; set; }
        public double? DhtTMaxC { get; set; }
        public double? DhtRhMeanPct { get; set; }
    }

    public sealed class ZoneEngineInput
    {
        public long ZoneId { get; set; }
        public string ZoneName { get; set; } = "Zone";
        public string? CropType { get; set; }
        public DateOnly? PlantingDate { get; set; }

        public string? SoilType { get; set; }
        public double? AreaM2 { get; set; }
        public double? FlowRateLpm { get; set; }
        public double? RootDepthLimitM { get; set; }
        public double? CalibrationWet { get; set; }
        public double? CalibrationDry { get; set; }

        // The farmer's own trigger levels, in whatever units the zone records them.
        public double? MoistureThreshold { get; set; }
        public double? DesiredMoisture { get; set; }

        public double? FarmLatitudeDegrees { get; set; }
        public double? FarmElevationM { get; set; }

        // Today in Africa/Johannesburg, decided by the caller.
        public DateOnly Today { get; set; }

        // Observed days first, then forecast days. Order does not matter.
        public List<ZoneWeatherDay> Weather { get; set; } = new List<ZoneWeatherDay>();

        // Newest last. Raw values.
        public List<ZoneMoistureReading> Readings { get; set; } = new List<ZoneMoistureReading>();

        // Irrigation actually applied, in mm of depth, per day. The caller derives
        // mm from runtime_seconds / 60 * flow_rate_lpm / area_m2 so that this file
        // never has to know about pumps.
        public Dictionary<DateOnly, double> IrrigationMmByDay { get; set; } = new Dictionary<DateOnly, double>();

        // Item 2. The longest single pump run per day (SAST), in seconds. Used only when
        // the zone has no flow rate or no size, so a watering cannot be turned
        // into millimetres: a real watering then resets the balance instead
        // (WaterRules.WateringResetsBalance).
        public Dictionary<DateOnly, double> LongestRunSecondsByDay { get; set; } = new Dictionary<DateOnly, double>();

        // Item 2. The time "now" for deciding whether the latest reading is
        // fresh. Null keeps the old behaviour (every reading counts as fresh),
        // so callers that have not been updated are unaffected.
        public DateTime? NowUtc { get; set; }

        // Item 6: the farmer's own soil checks, newest last. Each corrects the
        // balance on its day (WaterRules.SoilFeelDepletion).
        public List<ZoneSoilFeelCheck> SoilFeelChecks { get; set; } = new List<ZoneSoilFeelCheck>();

        // The last persisted end-of-day state immediately before the replay
        // window. This keeps Dr continuous without querying an unbounded amount
        // of history on every run. It is derived state, never a weekly reset.
        public DateOnly? InitialDepletionDate { get; set; }
        public double? InitialDepletionMm { get; set; }
        public DateOnly? BalanceStartDate { get; set; }
    }

    public enum IrrigationPrimaryAction
    {
        WaterNow,
        WaterNowReduced,
        WaterSoon,
        PostponeForRain,
        NoWaterNeeded,
        CheckField,
        CheckSensor,
        CheckIrrigationSystem,
        FinishSetup,
        InsufficientData,
        CropNotPlanted,
        SeasonComplete,
    }

    public enum SoilMoistureDomain
    {
        Unknown,
        RelativePercent,
        LegacyRawAdc,
        InvalidMixedCalibration,
    }

    public sealed class RollingIrrigationDay
    {
        public DateOnly Date { get; set; }
        public IrrigationPrimaryAction Action { get; set; }
        public double? RequiredDepthMm { get; set; }
        public double? Litres { get; set; }
        public double? RuntimeSeconds { get; set; }
        public double? ForecastRainMm { get; set; }
        public double? ProjectedDepletionMm { get; set; }
        public double? RawMm { get; set; }
        public string Confidence { get; set; } = "low";
        public bool Tentative { get; set; }
        public string Advice { get; set; } = string.Empty;
    }

    // One row of the water balance, matching zone_water_balance.
    public sealed class WaterBalanceDay
    {
        public DateOnly Day { get; set; }
        public int? DayOfSeason { get; set; }
        public SeasonStage? Stage { get; set; }
        public double? Kc { get; set; }
        public double? EtoMm { get; set; }
        public double? EtcMm { get; set; }
        public double? EtcAdjustedMm { get; set; }
        public double? AdjustedP { get; set; }
        public double? TawMm { get; set; }
        public double? RawMm { get; set; }
        public double RainMm { get; set; }
        public double IrrigationMm { get; set; }
        public double? DrEndMm { get; set; }
        public double? Ks { get; set; }
        public bool Incomplete { get; set; }
        public bool IsForecast { get; set; }
        public string EtoSource { get; set; } = EtoSources.None;
        public string RsSource { get; set; } = EtoSources.None;
    }

    public sealed class ZoneEngineResult
    {
        public long ZoneId { get; set; }
        public string ZoneName { get; set; } = "Zone";
        public Fao56EngineCrop? Crop { get; set; }
        public Fao56SoilClass Soil { get; set; } = Fao56EngineReference.DefaultSoil;

        // True when soil_type was not set and the loam default stood in.
        public bool SoilWasDefaulted { get; set; }

        public List<WaterBalanceDay> Days { get; } = new List<WaterBalanceDay>();

        // Today's state. Null where the inputs did not allow it.
        public double? TawMm { get; set; }
        public double? RawMm { get; set; }
        public double? DepletionMm { get; set; }
        public double? AdjustedP { get; set; }
        public double? EtoTodayMm { get; set; }
        public double? EtcTodayMm { get; set; }
        public int? DayOfSeason { get; set; }
        public SeasonStage? Stage { get; set; }
        public double? KcToday { get; set; }

        public double? RecommendedLitres { get; set; }
        public double? RecommendedMinutes { get; set; }
        public double? RecommendedRuntimeSeconds { get; set; }

        public double? RelativeMoisturePercent { get; set; }
        public double? LatestRawReading { get; set; }
        public DateTime? LatestReadingAtUtc { get; set; }
        public SoilMoistureDomain SensorDomain { get; set; }
        public bool CalibrationValid { get; set; }
        public string? SensorModifier { get; set; }

        // Days until Dr reaches RAW, projected on the forecast. Null when there is
        // no forecast to project onto.
        public int? DaysToNextWatering { get; set; }
        public DateOnly? NextWateringDate { get; set; }

        public IrrigationPrimaryAction PrimaryAction { get; set; } = IrrigationPrimaryAction.InsufficientData;
        public double? ProjectedPostRainDepletionMm { get; set; }
        public double? ForecastRainTodayMm { get; set; }
        public string? EquipmentWarning { get; set; }
        public List<RollingIrrigationDay> Outlook { get; } = new List<RollingIrrigationDay>();

        // Whether the balance could run at all.
        public bool BalanceRan { get; set; }

        // Field names from spec section 7's setup_missing list, farmer-worded.
        public List<string> MissingSetup { get; } = new List<string>();

        public List<string> Limitations { get; } = new List<string>();
        public List<AdviceFact> Facts { get; } = new List<AdviceFact>();

        // ---- Item 2: advice is never blocked -------------------------------

        // True when there was no planting date and the crop was assumed to be
        // at peak growth (CropRules.KcWhenStageUnknown). Stage is then
        // PeakGrowth and DayOfSeason is null.
        public bool StageAssumed { get; set; }

        // True when the latest reading is older than
        // ConfidenceRules.FreshReadingHours: advice is then from the weather
        // alone, and the reading is not used to start the balance.
        public bool ReadingStale { get; set; }

        // How much water to give, as a depth. Always set when the balance ran,
        // so a zone with no size or flow rate still gets an amount.
        public double? RecommendedDepthMm { get; set; }

        // Minutes per square metre, when the zone's size is unknown but its
        // flow rate is (WaterRules.MinutesPerSquareMetre).
        public double? RecommendedMinutesPerSquareMetre { get; set; }

        // True when a watering whose depth could not be measured reset the
        // balance (WaterRules.WateringResetsBalance).
        public bool BalanceResetByWatering { get; set; }

        // Item 6: the latest soil check the balance used, if any.
        public ZoneSoilFeelCheck? LatestSoilFeel { get; set; }

        public ZoneSetupState Setup { get; set; } = new ZoneSetupState();
        public Confidence Confidence { get; set; } = new Confidence(ConfidenceLevel.Low, "Low: not worked out yet.");
        public SetupStep? NextStep { get; set; }

        public WaterBalanceDay? Today
        {
            get { return Days.OrderBy(d => d.Day).LastOrDefault(); }
        }
    }

    public static class Fao56Engine
    {
        // Spec 3b: a raw ADC reading must sit in 0-4095, or 0-100 if the firmware
        // already converted to a percentage. The current firmware sends a
        // percentage (see AgroFlowIrrigationNode.ino, readMoisturePercent), but the
        // column is raw-valued by design so both are accepted.
        public const double MaxAdcReading = 4095.0;

        // How far outside the calibrated range a reading may sit before it is
        // treated as implausible: 10% of (wet - dry), per spec 3b.
        public const double CalibrationToleranceFraction = 0.10;

        public static SoilMoistureDomain DetectSensorDomain(
            double? calibrationWet, double? calibrationDry)
        {
            if (calibrationWet.HasValue && calibrationDry.HasValue)
            {
                var wetPercent = calibrationWet.Value >= 0.0 && calibrationWet.Value <= 100.0;
                var dryPercent = calibrationDry.Value >= 0.0 && calibrationDry.Value <= 100.0;
                if (wetPercent != dryPercent) return SoilMoistureDomain.InvalidMixedCalibration;
                return wetPercent ? SoilMoistureDomain.RelativePercent : SoilMoistureDomain.LegacyRawAdc;
            }

            // A lone value cannot identify its domain: a legacy ADC can also be
            // between 0 and 100. Only same-domain wet/dry calibration points make
            // the distinction safe; otherwise keep and display the raw signal.
            return SoilMoistureDomain.Unknown;
        }

        public static bool IsPlausibleReading(
            double raw, double? calibrationWet, double? calibrationDry)
        {
            if (double.IsNaN(raw) || double.IsInfinity(raw)) return false;
            if (raw < 0.0 || raw > MaxAdcReading) return false;

            if (DetectSensorDomain(calibrationWet, calibrationDry) == SoilMoistureDomain.InvalidMixedCalibration)
                return false;

            if (calibrationWet.HasValue && calibrationDry.HasValue)
            {
                var span = Math.Abs(calibrationWet.Value - calibrationDry.Value);
                if (span > 0.0)
                {
                    var tolerance = CalibrationToleranceFraction * span;
                    var low = Math.Min(calibrationWet.Value, calibrationDry.Value) - tolerance;
                    var high = Math.Max(calibrationWet.Value, calibrationDry.Value) + tolerance;
                    if (raw < low || raw > high) return false;
                }
            }

            return true;
        }

        public static ZoneEngineResult Run(ZoneEngineInput input)
        {
            if (input == null) throw new ArgumentNullException(nameof(input));

            var result = new ZoneEngineResult
            {
                ZoneId = input.ZoneId,
                ZoneName = input.ZoneName,
            };

            // ---- Crop ---------------------------------------------------------
            var crop = Fao56EngineReference.TryResolveCrop(input.CropType);
            result.Crop = crop;

            if (crop == null)
            {
                result.MissingSetup.Add(string.IsNullOrWhiteSpace(input.CropType) ? "the crop" : "a crop we have water figures for");
                result.Limitations.Add(string.IsNullOrWhiteSpace(input.CropType)
                    ? "This zone has no crop set, so no crop water figures could be used."
                    : "\"" + input.CropType + "\" is not a crop we hold FAO-56 water figures for, so no crop water figures were used. No substitute crop was chosen.");
            }

            if (!input.PlantingDate.HasValue)
            {
                result.MissingSetup.Add("the planting date");
                result.Limitations.Add(crop != null
                    ? "This zone has no planting date, so its growth stage is unknown. The crop was assumed to be at its highest water use (" + CropRules.AssumedStageLabel + "), so the advice errs toward enough water."
                    : "This zone has no planting date, so its growth stage and water need over the season are unknown.");
            }

            // ---- Soil ---------------------------------------------------------
            var soil = Fao56EngineReference.TryResolveSoil(input.SoilType);
            if (soil == null)
            {
                soil = Fao56EngineReference.DefaultSoil;
                result.SoilWasDefaulted = true;
                if (string.IsNullOrWhiteSpace(input.SoilType))
                {
                    result.MissingSetup.Add("the soil type");
                    result.Limitations.Add(
                        "This zone has no soil type set, so garden soil (loam) was assumed. Setting the real soil type changes how much water the soil holds.");
                }
                else
                {
                    result.Limitations.Add(
                        "Soil type \"" + input.SoilType + "\" is not one we have figures for, so garden soil (loam) was assumed.");
                }
            }
            result.Soil = soil;

            if (!input.AreaM2.HasValue || input.AreaM2.Value <= 0.0)
            {
                result.MissingSetup.Add("the area");
                result.Limitations.Add("This zone has no area recorded, so water amounts in litres cannot be worked out.");
            }

            if (!input.FlowRateLpm.HasValue || input.FlowRateLpm.Value <= 0.0)
            {
                result.MissingSetup.Add("the flow rate");
                result.Limitations.Add("This zone has no flow rate recorded, so watering times in minutes cannot be worked out.");
            }

            var sensorDomain = DetectSensorDomain(input.CalibrationWet, input.CalibrationDry);
            result.SensorDomain = sensorDomain;
            var calibrated = input.CalibrationWet.HasValue && input.CalibrationDry.HasValue
                             && sensorDomain != SoilMoistureDomain.InvalidMixedCalibration
                             && Math.Abs(input.CalibrationWet.Value - input.CalibrationDry.Value) > 1e-9;
            result.CalibrationValid = calibrated;
            if (!calibrated)
            {
                result.MissingSetup.Add("the wet/dry soil setup");
                result.Limitations.Add(sensorDomain == SoilMoistureDomain.InvalidMixedCalibration
                    ? "The saved wet and dry sensor points use different value domains (percentage and legacy ADC). The sensor is excluded until both points are recorded in the same domain."
                    : "This zone's sensor has not had a valid wet and dry setup, so it is supporting evidence only. Watering advice still works from the weather and the crop.");
            }

            if (!input.FarmLatitudeDegrees.HasValue)
            {
                result.MissingSetup.Add("the farm location");
            }

            // ---- Latest reading and relative moisture -------------------------
            var validReadings = input.Readings
                .Where(r => r.IsValid && IsPlausibleReading(r.RawValue, input.CalibrationWet, input.CalibrationDry))
                .OrderBy(r => r.RecordedAtUtc)
                .ToList();

            var latest = validReadings.LastOrDefault();

            // Item 2: a reading older than a day no longer describes today's
            // soil. It is still shown, but advice comes from the weather.
            if (latest != null && input.NowUtc.HasValue
                && (input.NowUtc.Value - latest.RecordedAtUtc).TotalHours > ConfidenceRules.FreshReadingHours)
            {
                result.ReadingStale = true;
                result.Limitations.Add(
                    "This advice is based on the weather: " + ConfidenceRules.KitQuiet(latest.RecordedAtUtc) + ".");
            }

            if (latest != null)
            {
                result.LatestRawReading = latest.RawValue;
                result.LatestReadingAtUtc = latest.RecordedAtUtc;
                result.RelativeMoisturePercent = sensorDomain == SoilMoistureDomain.RelativePercent
                    ? Math.Max(0.0, Math.Min(100.0, latest.RawValue))
                    : calibrated
                        ? SoilWaterBalance.RelativeMoisturePercent(latest.RawValue, input.CalibrationWet, input.CalibrationDry)
                        : null;

                if (result.RelativeMoisturePercent.HasValue)
                {
                    result.Facts.Add(new AdviceFact(
                        "Relative moisture",
                        result.RelativeMoisturePercent.Value.ToString("F0", CultureInfo.InvariantCulture) + "%",
                        "soil sensor reading " + latest.RawValue.ToString("F0", CultureInfo.InvariantCulture) +
                        (sensorDomain == SoilMoistureDomain.RelativePercent
                            ? " in the current firmware's 0-100 relative-moisture domain"
                            : " against this zone's legacy ADC wet/dry setup") +
                        " - relative only, not volumetric water content"));
                }
                else
                {
                    result.Facts.Add(new AdviceFact(
                        "Soil sensor reading",
                        latest.RawValue.ToString("F0", CultureInfo.InvariantCulture),
                        "raw soil sensor reading; no wet/dry setup done, so it cannot be shown as a percentage"));
                }
            }

            // Without a crop there is no crop water use at all, so there is no
            // water balance to run. Say so and stop - do not invent a crop.
            // Without a planting date the balance still runs, on the assumed
            // stage (item 2; CropRules.KcWhenStageUnknown).
            if (crop == null)
            {
                return Finish(input, result, calibrated);
            }

            result.StageAssumed = !input.PlantingDate.HasValue;

            // ---- Soil water holding ------------------------------------------
            var rootDepth = SoilWaterBalance.EffectiveRootDepthM(crop.RootDepthM, input.RootDepthLimitM);
            var taw = SoilWaterBalance.TotalAvailableWaterMm(
                soil.ThetaFieldCapacity, soil.ThetaWiltingPoint, rootDepth);

            result.TawMm = taw;

            result.Facts.Add(new AdviceFact(
                "Soil type", soil.Label,
                "FAO-56 Table 19 (" + soil.Table19Class + "): " + soil.ThetaNote));

            result.Facts.Add(new AdviceFact(
                "Root depth", rootDepth.ToString("F2", CultureInfo.InvariantCulture) + " m",
                input.RootDepthLimitM.HasValue && input.RootDepthLimitM.Value < crop.RootDepthM
                    ? "limited by this zone's depth; FAO-56 Table 22 gives " + crop.RootDepthM.ToString("F1", CultureInfo.InvariantCulture) + " m for " + crop.Label.ToLowerInvariant()
                    : "FAO-56 Table 22, low end of the published range for " + crop.Label.ToLowerInvariant()));

            result.Facts.Add(new AdviceFact(
                "Water the soil can hold", taw.ToString("F0", CultureInfo.InvariantCulture) + " mm",
                "FAO-56 Eq. 82 from Table 19 soil values and Table 22 root depth"));

            if (!string.IsNullOrWhiteSpace(crop.ValueNote))
            {
                result.Limitations.Add(crop.ValueNote!);
            }

            result.Limitations.Add(
                "Stage lengths come from FAO-56 Table 11 (" + crop.Table11Row +
                "), which the book says are indicative only - a real season may run shorter or longer.");

            // A future planting and a completed annual crop are explicit terminal
            // states. They must never inherit an ordinary Kc watering schedule.
            if (input.PlantingDate.HasValue && input.PlantingDate.Value > input.Today)
            {
                result.PrimaryAction = IrrigationPrimaryAction.CropNotPlanted;
                result.DayOfSeason = (input.Today.DayNumber - input.PlantingDate.Value.DayNumber) + 1;
                return Finish(input, result, calibrated);
            }

            if (input.PlantingDate.HasValue)
            {
                var currentDay = (input.Today.DayNumber - input.PlantingDate.Value.DayNumber) + 1;
                if (CropRules.SeasonComplete(crop, currentDay))
                {
                    result.PrimaryAction = IrrigationPrimaryAction.SeasonComplete;
                    result.DayOfSeason = currentDay;
                    result.Stage = SeasonStage.SeasonComplete;
                    return Finish(input, result, calibrated);
                }
            }

            // ---- Reconstruct actual history in calendar order -----------------
            // Today's Open-Meteo row is still a forecast. It belongs in the
            // projection, never in historical truth.
            var observedByDate = input.Weather
                .Where(w => !w.IsForecast && w.Date <= input.Today)
                .GroupBy(w => w.Date)
                .ToDictionary(g => g.Key, g => g.Last());

            var firstObserved = observedByDate.Count > 0 ? observedByDate.Keys.Min() : input.Today;
            var start = input.BalanceStartDate ?? firstObserved;
            var lastObservedDate = input.Weather.Any(w => w.Date == input.Today && !w.IsForecast)
                ? input.Today
                : input.Today.AddDays(-1);

            var days = new List<ZoneWeatherDay>();
            for (var date = start; date <= lastObservedDate; date = date.AddDays(1))
            {
                days.Add(observedByDate.TryGetValue(date, out var observed)
                    ? observed
                    : new ZoneWeatherDay { Date = date, HasWeatherRow = false, IsForecast = false });
            }

            var forecastDays = input.Weather
                .Where(w => w.IsForecast && w.Date >= input.Today)
                .GroupBy(w => w.Date)
                .Select(g => g.Last())
                .OrderBy(w => w.Date)
                .ToList();

            // Continue from the persisted day immediately before this bounded
            // replay. A fresh sensor is deliberately not used as a historical
            // starting state: doing so would replay old weather after a current
            // observation. The point sensor remains supporting evidence below.
            var dr = Math.Max(0.0, Math.Min(taw, input.InitialDepletionMm ?? 0.0));
            if (input.InitialDepletionMm.HasValue)
            {
                result.Limitations.Add("The running water balance continued from the previous persisted field state; calendar weeks do not reset it.");
            }

            var depthMeasurable = input.AreaM2.HasValue && input.AreaM2.Value > 0.0
                                  && input.FlowRateLpm.HasValue && input.FlowRateLpm.Value > 0.0;

            var consecutiveGapDays = 0;
            var balanceStopped = false;

            foreach (var w in days)
            {
                var day = BuildDay(input, crop, soil, taw, rootDepth, w, dr, isForecast: false);

                if (!day.EtoMm.HasValue)
                {
                    // Spec 3c fallback 5: carry Dr forward unchanged for at most
                    // one day, then stop the balance for this zone.
                    consecutiveGapDays++;
                    if (consecutiveGapDays > 1)
                    {
                        balanceStopped = true;
                        day.DrEndMm = null;
                        result.Days.Add(day);
                        result.Limitations.Add(
                            "Weather data has been missing for more than one day, so the running estimate of how dry the soil is has been paused for this zone until data returns.");
                        break;
                    }

                    day.DrEndMm = dr;
                    result.Days.Add(day);
                    continue;
                }

                consecutiveGapDays = 0;
                dr = day.DrEndMm!.Value;
                result.Days.Add(day);

                // Item 6: the farmer's own soil check on this day corrects the
                // estimate - the latest one that day wins.
                var feel = input.SoilFeelChecks
                    .Where(c => DateOnly.FromDateTime(c.CheckedAtUtc.AddHours(2)) == w.Date)
                    .OrderBy(c => c.CheckedAtUtc)
                    .LastOrDefault();
                if (feel != null && day.RawMm.HasValue)
                {
                    dr = WaterRules.SoilFeelDepletion(feel.Feel, dr, day.RawMm.Value);
                    day.DrEndMm = dr;
                    result.LatestSoilFeel = feel;
                }

                // Item 2: a watering that cannot be measured in mm still counts.
                double runtimeSeconds;
                if (input.LongestRunSecondsByDay.TryGetValue(w.Date, out runtimeSeconds)
                    && WaterRules.WateringResetsBalance(runtimeSeconds, depthMeasurable))
                {
                    dr = 0.0;
                    day.DrEndMm = 0.0;
                    result.BalanceResetByWatering = true;
                }
            }

            if (result.BalanceResetByWatering)
            {
                result.Limitations.Add(
                    "This zone has no flow rate or size, so a watering could not be measured. Each watering of at least two minutes was taken as filling the soil.");
            }

            if (balanceStopped)
            {
                result.BalanceRan = false;
                result.PrimaryAction = IrrigationPrimaryAction.InsufficientData;
                return Finish(input, result, calibrated);
            }

            result.BalanceRan = input.InitialDepletionMm.HasValue
                                || result.Days.Any(d => d.DrEndMm.HasValue)
                                || forecastDays.Count > 0;
            result.DepletionMm = dr;

            // Today's agronomic inputs come from the observed row when it exists,
            // otherwise from today's forecast row. Forecast rain remains a
            // projection and does not mutate the historical Dr above.
            var todayWeather = input.Weather
                .Where(w => w.Date == input.Today)
                .OrderBy(w => w.IsForecast ? 1 : 0)
                .FirstOrDefault();
            WaterBalanceDay? todayRow = result.Days.LastOrDefault(d => d.Day == input.Today);
            if (todayRow == null && todayWeather != null)
            {
                todayRow = BuildDay(input, crop, soil, taw, rootDepth, todayWeather, dr, isForecast: true);
            }
            if (todayRow != null)
            {
                result.EtoTodayMm = todayRow.EtoMm;
                result.EtcTodayMm = todayRow.EtcMm;
                result.AdjustedP = todayRow.AdjustedP;
                result.RawMm = todayRow.RawMm;
                result.DayOfSeason = todayRow.DayOfSeason;
                result.Stage = todayRow.Stage;
                result.KcToday = todayRow.Kc;

                if (todayRow.Kc.HasValue)
                {
                    result.Facts.Add(new AdviceFact(
                        "Crop water need factor today",
                        todayRow.Kc.Value.ToString("F2", CultureInfo.InvariantCulture),
                        result.StageAssumed
                            ? "FAO-56 Table 12, the highest of this crop's values - " + CropRules.AssumedStageLabel + ", as there is no planting date"
                            : "FAO-56 Eq. 66 across Table 11 stage lengths, Kc values from Table 12 (Kc start: " + crop.KcIniBasis + ")"));
                }

                if (todayRow.EtoMm.HasValue)
                {
                    result.Facts.Add(new AdviceFact(
                        "Reference water use today",
                        todayRow.EtoMm.Value.ToString("F1", CultureInfo.InvariantCulture) + " mm",
                        "FAO-56 Eq. 6 (Penman-Monteith), inputs from " + todayRow.EtoSource));
                }

                if (todayRow.EtcMm.HasValue)
                {
                    result.Facts.Add(new AdviceFact(
                        "This crop's water use today",
                        todayRow.EtcMm.Value.ToString("F1", CultureInfo.InvariantCulture) + " mm",
                        "FAO-56 Eq. 58: crop factor x reference water use"));
                }

                if (todayRow.RawMm.HasValue)
                {
                    result.Facts.Add(new AdviceFact(
                        "Dryness it can stand before watering",
                        todayRow.RawMm.Value.ToString("F0", CultureInfo.InvariantCulture) + " mm",
                        "FAO-56 Eq. 83 with the depletion fraction from Table 22, adjusted for today's water use and for soil type"));
                }

                result.Facts.Add(new AdviceFact(
                    "How dry the soil is now",
                    dr.ToString("F0", CultureInfo.InvariantCulture) + " mm short of full",
                    "FAO-56 Eq. 85 continuous water balance; the point sensor is supporting evidence, not a root-zone volume measurement"));

                if (todayRow.Incomplete)
                {
                    result.Limitations.Add(
                        "One or more reference-water-use inputs were estimated or defaulted. Technical details retain the input provenance.");
                }
            }

            if (!result.BalanceRan || todayRow?.RawMm == null)
            {
                result.PrimaryAction = IrrigationPrimaryAction.InsufficientData;
            }
            else
            {
                BuildRollingOutlook(input, result, crop, soil, taw, rootDepth, dr, todayRow, forecastDays);
                ApplySensorModifier(result);
                EnforceDecisionInvariants(result);
            }

            if (forecastDays.Count == 0)
            {
                result.Limitations.Add(
                    "There is no weather forecast saved for this farm, so no advice could be given on when the next watering will be needed.");
            }

            if (input.AreaM2.HasValue)
            {
                result.Limitations.Add(
                    "Water amounts in litres are estimates worked out from pump running time and the zone's flow rate. There is no flow meter anywhere in AgroFlow.");
            }

            return Finish(input, result, calibrated);
        }

        private static void BuildRollingOutlook(
            ZoneEngineInput input, ZoneEngineResult result, Fao56EngineCrop crop,
            Fao56SoilClass soil, double taw, double rootDepth, double currentDr,
            WaterBalanceDay todayRow, List<ZoneWeatherDay> forecastDays)
        {
            var forecastByDate = forecastDays.ToDictionary(d => d.Date);
            var projected = currentDr;

            for (var offset = 0; offset < 7; offset++)
            {
                var date = input.Today.AddDays(offset);
                WaterBalanceDay? projectedDay;
                WaterBalanceDay? withoutRainDay;

                if (offset == 0 && !todayRow.IsForecast)
                {
                    projectedDay = todayRow;
                    withoutRainDay = todayRow;
                }
                else if (forecastByDate.TryGetValue(date, out var weather))
                {
                    projectedDay = BuildDay(input, crop, soil, taw, rootDepth, weather, projected, isForecast: true);
                    withoutRainDay = BuildDay(input, crop, soil, taw, rootDepth,
                        CopyWithoutRain(weather), projected, isForecast: true);
                    if (!result.Days.Any(d => d.Day == date && d.IsForecast)) result.Days.Add(projectedDay);
                }
                else
                {
                    result.Outlook.Add(new RollingIrrigationDay
                    {
                        Date = date,
                        Action = IrrigationPrimaryAction.InsufficientData,
                        Tentative = offset > 0,
                        Advice = "Forecast data unavailable; reassess when weather updates.",
                    });
                    break;
                }

                if (!projectedDay.DrEndMm.HasValue || !projectedDay.RawMm.HasValue
                    || withoutRainDay == null || !withoutRainDay.DrEndMm.HasValue)
                {
                    result.Outlook.Add(new RollingIrrigationDay
                    {
                        Date = date,
                        Action = IrrigationPrimaryAction.InsufficientData,
                        Tentative = offset > 0,
                        Advice = "Not enough weather data for a reliable irrigation decision.",
                    });
                    break;
                }

                if (projectedDay.Stage == SeasonStage.SeasonComplete)
                {
                    result.Outlook.Add(new RollingIrrigationDay
                    {
                        Date = date,
                        Action = IrrigationPrimaryAction.SeasonComplete,
                        Tentative = offset > 0,
                        Advice = "Crop cycle complete; no normal crop irrigation is scheduled.",
                    });
                    break;
                }

                var postRain = projectedDay.DrEndMm.Value;
                var withoutRain = withoutRainDay.DrEndMm.Value;
                var raw = projectedDay.RawMm.Value;
                var usefulRain = Math.Max(0.0, withoutRain - postRain);
                var dueWithoutRain = WaterRules.ShouldWaterToday(withoutRain, raw);
                IrrigationPrimaryAction action;
                double? depth = null;

                if (dueWithoutRain && usefulRain > 0.0 && postRain < raw)
                {
                    action = IrrigationPrimaryAction.PostponeForRain;
                }
                else if (dueWithoutRain && usefulRain > 0.0 && postRain >= raw)
                {
                    action = IrrigationPrimaryAction.WaterNowReduced;
                    depth = postRain;
                }
                else if (dueWithoutRain)
                {
                    action = IrrigationPrimaryAction.WaterNow;
                    depth = withoutRain;
                }
                else
                {
                    action = IrrigationPrimaryAction.NoWaterNeeded;
                }

                var litres = depth.HasValue ? SoilWaterBalance.IrrigationLitres(depth.Value, input.AreaM2) : null;
                var seconds = SoilWaterBalance.IrrigationRuntimeSeconds(litres, input.FlowRateLpm);
                var outlook = new RollingIrrigationDay
                {
                    Date = date,
                    Action = action,
                    RequiredDepthMm = depth.HasValue ? Math.Round(depth.Value, 1) : null,
                    Litres = litres,
                    RuntimeSeconds = seconds,
                    ForecastRainMm = projectedDay.IsForecast ? projectedDay.RainMm : (double?)null,
                    ProjectedDepletionMm = postRain,
                    RawMm = raw,
                    Tentative = offset > 1,
                    Advice = AdviceFor(action, depth, offset),
                };
                result.Outlook.Add(outlook);

                if (!result.NextWateringDate.HasValue
                    && (action == IrrigationPrimaryAction.WaterNow || action == IrrigationPrimaryAction.WaterNowReduced))
                {
                    result.NextWateringDate = date;
                    result.DaysToNextWatering = offset;
                }

                // The projection assumes a recommended irrigation is performed,
                // solely to avoid showing the same event on every following day.
                // Only real irrigation_event rows alter the next actual run.
                projected = depth.HasValue ? Math.Max(0.0, postRain - depth.Value) : postRain;
            }

            var today = result.Outlook.FirstOrDefault(d => d.Date == input.Today);
            if (today == null)
            {
                result.PrimaryAction = IrrigationPrimaryAction.InsufficientData;
                return;
            }

            result.PrimaryAction = today.Action;
            result.ProjectedPostRainDepletionMm = today.ProjectedDepletionMm;
            result.ForecastRainTodayMm = today.ForecastRainMm;

            if (today.Action == IrrigationPrimaryAction.NoWaterNeeded
                && result.DaysToNextWatering is > 0 and <= WaterRules.WaterSoonDays)
            {
                result.PrimaryAction = IrrigationPrimaryAction.WaterSoon;
                today.Action = IrrigationPrimaryAction.WaterSoon;
                today.Advice = result.DaysToNextWatering == 1
                    ? "Irrigation is likely tomorrow."
                    : "Irrigation is likely within the next 2 days.";
            }

            if (result.PrimaryAction == IrrigationPrimaryAction.WaterNow
                || result.PrimaryAction == IrrigationPrimaryAction.WaterNowReduced)
            {
                result.RecommendedDepthMm = today.RequiredDepthMm;
                result.RecommendedLitres = today.Litres;
                result.RecommendedRuntimeSeconds = today.RuntimeSeconds;
                result.RecommendedMinutes = today.RuntimeSeconds.HasValue
                    ? Math.Round(today.RuntimeSeconds.Value / 60.0, 2)
                    : null;
                if (!result.RecommendedLitres.HasValue && result.RecommendedDepthMm.HasValue)
                {
                    result.RecommendedMinutesPerSquareMetre = WaterRules.MinutesPerSquareMetre(
                        result.RecommendedDepthMm.Value, input.FlowRateLpm);
                }

                if (today.RuntimeSeconds is > 0.0 and < WaterRules.ImpracticallyShortRuntimeSeconds)
                {
                    result.EquipmentWarning = "Water is required, but the configured pump may be too large for accurate dosing in this zone.";
                }
                else if (today.RuntimeSeconds > WaterRules.ImpracticallyLongRuntimeSeconds)
                {
                    result.EquipmentWarning = "The configured flow rate may be too low for this zone. Check the irrigation setup.";
                }
            }
        }

        private static ZoneWeatherDay CopyWithoutRain(ZoneWeatherDay day)
        {
            return new ZoneWeatherDay
            {
                Date = day.Date, HasWeatherRow = day.HasWeatherRow,
                TMinC = day.TMinC, TMaxC = day.TMaxC, RainMm = 0.0,
                RhMinPct = day.RhMinPct, RhMaxPct = day.RhMaxPct, RhMeanPct = day.RhMeanPct,
                WindMs = day.WindMs, WindHeightM = day.WindHeightM, IsForecast = day.IsForecast,
                DhtTMinC = day.DhtTMinC, DhtTMaxC = day.DhtTMaxC, DhtRhMeanPct = day.DhtRhMeanPct,
            };
        }

        private static string AdviceFor(IrrigationPrimaryAction action, double? depth, int offset)
        {
            switch (action)
            {
                case IrrigationPrimaryAction.WaterNowReduced:
                    return "Rain partially helps; irrigation is still likely at about " + depth?.ToString("0.#", CultureInfo.InvariantCulture) + " mm.";
                case IrrigationPrimaryAction.WaterNow:
                    return offset == 0
                        ? "Irrigate today at about " + depth?.ToString("0.#", CultureInfo.InvariantCulture) + " mm."
                        : "Irrigation likely at about " + depth?.ToString("0.#", CultureInfo.InvariantCulture) + " mm.";
                case IrrigationPrimaryAction.PostponeForRain:
                    return "Rain is expected to move the field below the watering trigger; reassess after rain.";
                default:
                    return "No irrigation currently expected.";
            }
        }

        private static void ApplySensorModifier(ZoneEngineResult result)
        {
            if (!result.LatestReadingAtUtc.HasValue)
            {
                result.SensorModifier = "Field sensor unavailable. Advice uses the crop, soil and weather balance.";
                return;
            }
            if (result.ReadingStale)
            {
                result.SensorModifier = "The field sensor is stale, so the recommendation relies mainly on crop, soil and weather.";
                return;
            }
            if (!result.RelativeMoisturePercent.HasValue || !result.DepletionMm.HasValue || !result.TawMm.HasValue)
            {
                result.SensorModifier = "Calibrate the field sensor in one value domain to improve confidence.";
                return;
            }

            var modelMoisture = 100.0 * (1.0 - result.DepletionMm.Value / result.TawMm.Value);
            var difference = result.RelativeMoisturePercent.Value - modelMoisture;
            if (Math.Abs(difference) >= 25.0)
            {
                result.SensorModifier = difference > 0
                    ? "Check the field before irrigating: the local sensor indicates wetter conditions than the weather-based estimate."
                    : "Inspect the zone: the local sensor is considerably drier than the weather-based estimate.";
            }
            else
            {
                result.SensorModifier = result.PrimaryAction is IrrigationPrimaryAction.WaterNow or IrrigationPrimaryAction.WaterNowReduced
                    ? "The field sensor also indicates relatively dry conditions."
                    : "The field sensor supports the current recommendation.";
            }
        }

        private static void EnforceDecisionInvariants(ZoneEngineResult result)
        {
            var waters = result.PrimaryAction is IrrigationPrimaryAction.WaterNow or IrrigationPrimaryAction.WaterNowReduced;
            if (!waters)
            {
                result.RecommendedDepthMm = null;
                result.RecommendedLitres = null;
                result.RecommendedMinutes = null;
                result.RecommendedRuntimeSeconds = null;
                result.RecommendedMinutesPerSquareMetre = null;
            }

            if (result.PrimaryAction == IrrigationPrimaryAction.PostponeForRain
                && result.ProjectedPostRainDepletionMm.HasValue && result.RawMm.HasValue
                && result.ProjectedPostRainDepletionMm.Value >= result.RawMm.Value)
            {
                throw new InvalidOperationException("POSTPONE_FOR_RAIN cannot leave projected depletion at or above RAW.");
            }
        }

        // Item 2: every way out of Run says how sure it is and names one next step.
        private static ZoneEngineResult Finish(ZoneEngineInput input, ZoneEngineResult result, bool calibrated)
        {
            DateTime? newestAny = input.Readings.Count > 0
                ? input.Readings.Max(r => r.RecordedAtUtc)
                : (DateTime?)null;

            result.Setup = new ZoneSetupState
            {
                CropKnown = result.Crop != null,
                PlantingDateKnown = input.PlantingDate.HasValue,
                SoilSet = !result.SoilWasDefaulted,
                AreaSet = input.AreaM2.HasValue && input.AreaM2.Value > 0.0,
                FlowRateSet = input.FlowRateLpm.HasValue && input.FlowRateLpm.Value > 0.0,
                Calibrated = calibrated,
                ReadingFresh = result.LatestReadingAtUtc.HasValue && !result.ReadingStale,
                HasKit = input.Readings.Count > 0,
                WeatherAvailable = result.Crop == null ? input.Weather.Count > 0 : result.BalanceRan,
                LastReadingAtUtc = result.LatestReadingAtUtc ?? newestAny,

                // Item 6: a soil check by hand in the last day stands in for a
                // reading - at lower confidence than a set-up sensor.
                ManualCheckFresh = input.NowUtc.HasValue && result.LatestSoilFeel != null
                    && (input.NowUtc.Value - result.LatestSoilFeel.CheckedAtUtc).TotalHours <= ConfidenceRules.FreshReadingHours,
            };

            result.Confidence = ConfidenceRules.For(result.Setup);
            if (result.SensorModifier != null
                && (result.SensorModifier.StartsWith("Check", StringComparison.Ordinal)
                    || result.SensorModifier.StartsWith("Inspect", StringComparison.Ordinal))
                && result.Confidence.Level == ConfidenceLevel.High)
            {
                result.Confidence = new Confidence(ConfidenceLevel.Medium,
                    "Medium: the crop/weather balance and local field sensor disagree; inspect the zone before acting.");
            }
            foreach (var day in result.Outlook) day.Confidence = result.Confidence.Key;
            result.NextStep = ConfidenceRules.NextStep(result.Setup);
            return result;
        }

        // One day of the balance.
        private static WaterBalanceDay BuildDay(
            ZoneEngineInput input, Fao56EngineCrop crop, Fao56SoilClass soil,
            double taw, double rootDepth, ZoneWeatherDay w, double drPrevious, bool isForecast)
        {
            var day = new WaterBalanceDay
            {
                Day = w.Date,
                IsForecast = isForecast,
                RainMm = w.RainMm ?? 0.0,
            };

            var eto = DailyEtoResolver.Resolve(new DailyEtoInputs
            {
                Date = w.Date,
                LatitudeDegrees = input.FarmLatitudeDegrees,
                WeatherTMinC = w.TMinC,
                WeatherTMaxC = w.TMaxC,
                WeatherRhMinPct = w.RhMinPct,
                WeatherRhMaxPct = w.RhMaxPct,
                WeatherRhMeanPct = w.RhMeanPct,
                WeatherWindMs = w.WindMs,
                WeatherWindHeightM = w.WindHeightM,
                WeatherIsForecast = w.IsForecast,
                HasWeatherRow = w.HasWeatherRow,
                DhtTMinC = w.DhtTMinC,
                DhtTMaxC = w.DhtTMaxC,
                DhtRhMeanPct = w.DhtRhMeanPct,
                ElevationM = input.FarmElevationM,
            });

            day.EtoSource = eto.EtoSource;
            day.RsSource = eto.RsSource;
            day.Incomplete = eto.Incomplete;
            day.EtoMm = eto.EtoMm;

            if (input.PlantingDate.HasValue)
            {
                var dayOfSeason = (w.Date.DayNumber - input.PlantingDate.Value.DayNumber) + 1;
                day.DayOfSeason = dayOfSeason;
                day.Stage = SoilWaterBalance.Stage(
                    crop.LIniDays, crop.LDevDays, crop.LMidDays, crop.LLateDays, dayOfSeason);

                day.Kc = SoilWaterBalance.Kc(
                    crop.KcIni, crop.KcMid, crop.KcEnd,
                    crop.LIniDays, crop.LDevDays, crop.LMidDays, crop.LLateDays,
                    dayOfSeason);
            }
            else
            {
                // Item 2: no planting date - assume peak growth, never a day number.
                day.DayOfSeason = null;
                day.Stage = SeasonStage.PeakGrowth;
                day.Kc = CropRules.KcWhenStageUnknown(crop);
            }

            day.TawMm = taw;

            if (!eto.EtoMm.HasValue)
            {
                // No ETo: the caller decides whether to carry Dr forward or stop.
                return day;
            }

            var etc = day.Kc.Value * eto.EtoMm.Value;
            day.EtcMm = etc;

            var adjustedP = SoilWaterBalance.AdjustP(crop.DepletionFractionP, soil.PFactor, etc);
            day.AdjustedP = adjustedP;
            day.RawMm = SoilWaterBalance.ReadilyAvailableWaterMm(adjustedP, taw);

            // Ks from yesterday's depletion, applied to today's ETc (Eq. 81) - the
            // order FAO-56's own daily table advances in.
            var ks = SoilWaterBalance.StressCoefficient(drPrevious, taw, day.RawMm.Value, adjustedP);
            day.Ks = ks;
            var etcAdj = SoilWaterBalance.StressAdjustedEtcMm(ks, etc);
            day.EtcAdjustedMm = etcAdj;

            var effectiveRain = SoilWaterBalance.EffectiveRainfallMm(day.RainMm, eto.EtoMm.Value);

            double irrigationMm;
            input.IrrigationMmByDay.TryGetValue(w.Date, out irrigationMm);
            day.IrrigationMm = irrigationMm;

            day.DrEndMm = SoilWaterBalance.NextDepletionMm(drPrevious, effectiveRain, irrigationMm, etcAdj, taw);

            return day;
        }

        // Did a valid reading on this day reach the wet calibration point? The
        // probe is resistive, so "wetter" may be a lower or a higher raw number
        // depending on which way the two calibration points sit.
        private static bool WasRefilledOn(ZoneEngineInput input, DateOnly date)
        {
            if (!input.CalibrationWet.HasValue || !input.CalibrationDry.HasValue) return false;

            var wet = input.CalibrationWet.Value;
            var dry = input.CalibrationDry.Value;
            var wetIsLower = wet < dry;

            foreach (var r in input.Readings)
            {
                if (!r.IsValid) continue;
                if (DateOnly.FromDateTime(r.RecordedAtUtc.AddHours(2)) != date) continue;
                if (!IsPlausibleReading(r.RawValue, input.CalibrationWet, input.CalibrationDry)) continue;

                if (wetIsLower ? r.RawValue <= wet : r.RawValue >= wet) return true;
            }

            return false;
        }
    }
}
