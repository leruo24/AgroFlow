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

    // One day of weather for a farm, as weather_daily holds it plus the dht_daily
    // view's values for the same day.
    public sealed class ZoneWeatherDay
    {
        public DateOnly Date { get; set; }
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
        public double FarmElevationM { get; set; }

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
        public int? RecommendedMinutes { get; set; }

        public double? RelativeMoisturePercent { get; set; }
        public double? LatestRawReading { get; set; }
        public DateTime? LatestReadingAtUtc { get; set; }

        // Days until Dr reaches RAW, projected on the forecast. Null when there is
        // no forecast to project onto.
        public int? DaysToNextWatering { get; set; }
        public DateOnly? NextWateringDate { get; set; }

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

        public ZoneSetupState Setup { get; set; } = new ZoneSetupState();
        public Confidence Confidence { get; set; } = new Confidence(ConfidenceLevel.Low, "Low: not worked out yet.");
        public SetupStep? NextStep { get; set; }

        public WaterBalanceDay? Today
        {
            get { return Days.FirstOrDefault(d => !d.IsForecast || d.DrEndMm.HasValue); }
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

        public static bool IsPlausibleReading(
            double raw, double? calibrationWet, double? calibrationDry)
        {
            if (double.IsNaN(raw) || double.IsInfinity(raw)) return false;
            if (raw < 0.0 || raw > MaxAdcReading) return false;

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

            var calibrated = input.CalibrationWet.HasValue && input.CalibrationDry.HasValue;
            if (!calibrated)
            {
                result.MissingSetup.Add("the wet/dry soil setup");
                result.Limitations.Add(
                    "This zone's sensor has not had its wet and dry setup done, so soil readings are shown as raw numbers and cannot be turned into a moisture percentage. Watering advice still works from the weather and the crop.");
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
                result.RelativeMoisturePercent = SoilWaterBalance.RelativeMoisturePercent(
                    latest.RawValue, input.CalibrationWet, input.CalibrationDry);

                if (result.RelativeMoisturePercent.HasValue)
                {
                    result.Facts.Add(new AdviceFact(
                        "Relative moisture",
                        result.RelativeMoisturePercent.Value.ToString("F0", CultureInfo.InvariantCulture) + "%",
                        "soil sensor reading " + latest.RawValue.ToString("F0", CultureInfo.InvariantCulture) +
                        " against this zone's wet/dry setup - relative only, not a volume of water"));
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

            // ---- Run the balance over every day we have, oldest first ---------
            var days = input.Weather
                .Where(w => w.Date <= input.Today)
                .OrderBy(w => w.Date)
                .ToList();

            var forecastDays = input.Weather
                .Where(w => w.Date > input.Today)
                .OrderBy(w => w.Date)
                .ToList();

            // Starting depletion. Anchored to the sensor when the zone is
            // calibrated, otherwise starting from a full profile - spec 6.10.
            double dr;
            if (calibrated && result.RelativeMoisturePercent.HasValue && !result.ReadingStale)
            {
                dr =SoilWaterBalance.DepletionFromRelativeMoistureMm(result.RelativeMoisturePercent.Value, taw);
                result.Limitations.Add(
                    "How dry the soil is was worked out from the sensor reading in proportion to what the soil can hold. The sensor measures relative wetness, not an actual volume of water, so this is an approximation.");
            }
            else
            {
                dr = 0.0;
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

                // A valid reading at or wetter than the wet calibration point
                // means the profile was refilled: reset Dr to zero (spec 6.10).
                if (calibrated && WasRefilledOn(input, w.Date))
                {
                    dr = 0.0;
                    day.DrEndMm = 0.0;
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
                return Finish(input, result, calibrated);
            }

            result.BalanceRan = result.Days.Count > 0;
            result.DepletionMm = dr;

            var todayRow = result.Days.LastOrDefault();
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
                    "FAO-56 Eq. 85 water balance" + (calibrated && !result.ReadingStale ? ", started from the soil sensor reading" : ", started from a full profile")));
            }

            // ---- Amount to apply ---------------------------------------------
            // Net irrigation never exceeds the depletion: more than that drains
            // away (spec 6.12).
            result.RecommendedLitres = SoilWaterBalance.IrrigationLitres(dr, input.AreaM2);
            result.RecommendedMinutes = SoilWaterBalance.IrrigationMinutes(result.RecommendedLitres, input.FlowRateLpm);
            result.RecommendedDepthMm = Math.Round(dr, 1);
            if (!result.RecommendedLitres.HasValue)
            {
                result.RecommendedMinutesPerSquareMetre = WaterRules.MinutesPerSquareMetre(dr, input.FlowRateLpm);
            }

            // ---- Project forward to the next watering ------------------------
            if (forecastDays.Count > 0 && result.RawMm.HasValue)
            {
                var projected = dr;
                for (var i = 0; i < forecastDays.Count; i++)
                {
                    var f = forecastDays[i];
                    var fday = BuildDay(input, crop, soil, taw, rootDepth, f, projected, isForecast: true);
                    result.Days.Add(fday);

                    if (!fday.DrEndMm.HasValue) break;
                    projected = fday.DrEndMm.Value;

                    if (!result.DaysToNextWatering.HasValue
                        && fday.RawMm.HasValue && projected >= fday.RawMm.Value)
                    {
                        result.DaysToNextWatering = i + 1;
                        result.NextWateringDate = f.Date;
                    }
                }
            }
            else if (forecastDays.Count == 0)
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
            };

            result.Confidence = ConfidenceRules.For(result.Setup);
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
                HasWeatherRow = true,
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
