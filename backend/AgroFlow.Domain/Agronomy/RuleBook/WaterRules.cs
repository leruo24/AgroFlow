#nullable enable
using System;

namespace AgroFlow.Business.Agronomy.RuleBook
{
    // Water rules - turning "how dry the soil is" into "run the pump N minutes".
    public static class WaterRules
    {
        // DATA RULE: a pump run at least this long counts as a real watering.
        // The same two-minute figure the watering-failed check already uses
        // (ZoneInsightBuilder: "pump runtime of at least 2 minutes") - a few
        // seconds of a pump being tested is not a watering, and the two checks
        // must agree about what a watering is.
        public const double FullWateringMinimumSeconds = 120.0;

        // DATA RULE: "water soon" looks this many days ahead - far enough to
        // plan around, near enough that the forecast is still worth trusting.
        public const int WaterSoonDays = 2;

        // DATA RULE: forecast reference water use this many times the last
        // week's average is "hot, dry days ahead". 30% more demand is roughly
        // a heatwave's worth on the Western Cape's summer figures.
        public const double HotDaysEtoMultiple = 1.3;

        // Configurable/testable equipment sanity bounds. These warn; they never
        // cap or alter an agronomic requirement.
        public const double ImpracticallyShortRuntimeSeconds = 10.0;
        public const double ImpracticallyLongRuntimeSeconds = 12.0 * 60.0 * 60.0;

        // DATA RULE (item 6): where "moist" sits between full and the watering
        // point. A farmer's hand cannot tell a quarter-dry soil from a
        // three-quarter-dry one, so a "moist" check only pulls the estimate
        // into the middle band; it never moves it past either end.
        public const double MoistLowFractionOfRaw = 0.25;
        public const double MoistHighFractionOfRaw = 0.75;

        /// <summary>
        /// How dry the soil is after the farmer's own "How does the soil feel?" check.
        /// </summary>
        /// <remarks>
        /// DATA RULE, anchored on FAO-56's own two marks: "wet" is field
        /// capacity, a depletion of 0 (p. 167: "At field capacity, the root
        /// zone depletion is zero");
        /// "dry" is the watering point, depletion at least RAW (p. 171). A
        /// manual check is never more precise than that, so "moist" is held
        /// between <see cref="MoistLowFractionOfRaw"/> and
        /// <see cref="MoistHighFractionOfRaw"/> of RAW. Labelled manual, and it
        /// lowers confidence compared with a set-up sensor.
        /// </remarks>
        public static double SoilFeelDepletion(string feel, double depletionMm, double rawMm)
        {
            switch (feel)
            {
                case "wet": return 0.0;
                case "dry": return Math.Max(depletionMm, rawMm);
                case "moist":
                    return Math.Min(Math.Max(depletionMm, MoistLowFractionOfRaw * rawMm), MoistHighFractionOfRaw * rawMm);
                default: return depletionMm;
            }
        }

        /// <summary>Whether the crop needs water today: the soil has dried to RAW or past it.</summary>
        /// <remarks>
        /// FAO-56 Chapter 8 (p. 171): "To avoid crop water stress, irrigations
        /// should be applied before or at the moment when the readily available
        /// soil water is depleted (Dr,i ≥ RAW)". Exactly at RAW counts.
        /// </remarks>
        public static bool ShouldWaterToday(double depletionMm, double rawMm)
        {
            return depletionMm >= rawMm;
        }

        /// <summary>
        /// Whether a fresh, calibrated reading is at or below the farmer's own
        /// trigger level.
        /// </summary>
        /// <remarks>
        /// DATA RULE: the farmer's threshold is their own setting, not FAO-56.
        /// "At or below" - the threshold is the level they asked us to water
        /// at. Only a fresh reading counts (ConfidenceRules.FreshReadingHours):
        /// yesterday's dry reading says nothing about today.
        /// </remarks>
        public static bool AtOrBelowFarmerThreshold(double? relativeMoisturePercent, double? thresholdPercent, bool readingFresh)
        {
            return readingFresh
                   && relativeMoisturePercent.HasValue && thresholdPercent.HasValue
                   && relativeMoisturePercent.Value <= thresholdPercent.Value;
        }

        /// <summary>Whole minutes to run the pump to refill the root zone, or null if it cannot be worked out.</summary>
        /// <remarks>
        /// Litres = depletion (mm) × area (m²), since 1 mm over 1 m² is 1 L
        /// (FAO-56 Chapter 1, p. 3). Never more than the depletion: FAO-56
        /// p. 171, "the net irrigation depth should be smaller than or equal to
        /// the root zone depletion" - more drains away. Minutes are rounded UP
        /// (DATA RULE): rounding down would under-water.
        /// </remarks>
        public static int? MinutesToRun(double depletionMm, double? areaM2, double? flowRateLpm)
        {
            return SoilWaterBalance.IrrigationMinutes(SoilWaterBalance.IrrigationLitres(depletionMm, areaM2), flowRateLpm);
        }

        /// <summary>Whether today's forecast rain covers today's need, so watering can be skipped.</summary>
        /// <remarks>
        /// DATA RULE: rain equal to or more than the crop's water use today
        /// replaces today's watering. FAO-56 Eq. 85 (p. 170) credits rain
        /// against depletion exactly as it credits irrigation, so rain that
        /// covers the day's use leaves the soil no drier than watering would.
        /// Exactly equal counts as covered.
        /// </remarks>
        public static bool SkipForRain(double forecastRainMm, double expectedNeedMm)
        {
            return forecastRainMm >= expectedNeedMm;
        }

        /// <summary>Whether the next watering is close enough to mention: within <see cref="WaterSoonDays"/>.</summary>
        public static bool WaterSoon(int? daysToNextWatering)
        {
            return daysToNextWatering.HasValue && daysToNextWatering.Value <= WaterSoonDays;
        }

        /// <summary>Whether the forecast is hot and dry compared with the last week.</summary>
        /// <remarks>DATA RULE: see <see cref="HotDaysEtoMultiple"/>.</remarks>
        public static bool HotDaysAhead(double peakForecastEtoMm, double trailingMeanEtoMm)
        {
            return trailingMeanEtoMm > 0.0 && peakForecastEtoMm >= HotDaysEtoMultiple * trailingMeanEtoMm;
        }

        /// <summary>Whether the crop was under water stress on a day.</summary>
        /// <remarks>FAO-56 Eq. 84 (p. 169): Ks &lt; 1 once the soil is drier than RAW; Ks = 1 otherwise.</remarks>
        public static bool WasStressed(double ks)
        {
            return ks < 1.0;
        }

        /// <summary>
        /// The trigger level FAO-56 recommends for this crop and soil, in the
        /// zone's own sensor units.
        /// </summary>
        /// <remarks>
        /// p from FAO-56 Table 22 (pp. 163-165), adjusted for soil (p. 167,
        /// <see cref="SoilRules.DepletionFactorAdjust"/>) and held within
        /// 0.1-0.8 (p. 162). The sensor's wet/dry span stands in for TAW -
        /// DATA RULE: a resistive probe reads relative wetness, so the
        /// threshold sits p of the way from wet to dry.
        /// </remarks>
        public static double RecommendedThreshold(double depletionFractionP, double soilPFactor, double calibrationWet, double calibrationDry)
        {
            var pr = depletionFractionP * soilPFactor;
            if (pr < SoilWaterBalance.MinDepletionFraction) pr = SoilWaterBalance.MinDepletionFraction;
            if (pr > SoilWaterBalance.MaxDepletionFraction) pr = SoilWaterBalance.MaxDepletionFraction;
            return calibrationWet - pr * (calibrationWet - calibrationDry);
        }

        /// <summary>Whether the farmer's trigger waits longer (drier) than recommended.</summary>
        /// <remarks>
        /// Which way is "drier" depends on the probe: wired so that wet is the
        /// LOWER raw number, a drier threshold is a HIGHER number.
        /// </remarks>
        public static bool ThresholdTooDry(double threshold, double recommended, double calibrationWet, double calibrationDry)
        {
            var wetIsLower = calibrationWet < calibrationDry;
            return wetIsLower ? threshold > recommended : threshold < recommended;
        }

        /// <summary>
        /// Litres per square metre for a depth of water in millimetres.
        /// </summary>
        /// <remarks>
        /// A unit identity: 1 mm of water spread over 1 m² is 1 litre. FAO-56
        /// states the same conversion at field scale - "1 mm day-1 ... is
        /// equivalent to 10 m3 ha-1 day-1" (Chapter 1, p. 3). It is what lets a
        /// zone with no recorded size still get an answer per square metre.
        /// </remarks>
        public static double LitresPerSquareMetre(double depthMm)
        {
            return depthMm <= 0.0 ? 0.0 : depthMm;
        }

        /// <summary>
        /// Minutes of pumping per square metre, when the zone's size is unknown.
        /// </summary>
        /// <remarks>
        /// DATA RULE on top of the identity above: minutes = litres ÷ flow rate,
        /// and per square metre the litres equal the depth in mm. Rounded to one
        /// decimal rather than up to a whole minute - per square metre the figure
        /// is often below a minute, and rounding 0.4 up to 1 would more than
        /// double it. The whole-zone figure (SoilWaterBalance.IrrigationMinutes)
        /// still rounds up, as a farmer acts on whole minutes.
        /// </remarks>
        public static double? MinutesPerSquareMetre(double depthMm, double? flowRateLpm)
        {
            if (!flowRateLpm.HasValue || flowRateLpm.Value <= 0.0) return null;
            if (depthMm <= 0.0) return 0.0;
            return Math.Round(LitresPerSquareMetre(depthMm) / flowRateLpm.Value, 1);
        }

        /// <summary>
        /// Whether a watering whose depth cannot be measured should reset the
        /// water balance to a full root zone.
        /// </summary>
        /// <remarks>
        /// DATA RULE. With no flow rate or no zone size, a pump run cannot be
        /// turned into millimetres, so FAO-56 Eq. 85 (p. 170) has no irrigation
        /// term for it. Left out, the balance would only ever dry: every zone
        /// without those two figures would be told to water every day, forever,
        /// however often it was watered. A real watering is assumed to refill
        /// the root zone instead - "the last full watering as the reset" - which
        /// is right for a farmer who waters until the soil is soaked, and is
        /// flagged in the advice so it is never mistaken for a measurement.
        /// </remarks>
        public static bool WateringResetsBalance(double runtimeSeconds, bool depthMeasurable)
        {
            return !depthMeasurable && runtimeSeconds >= FullWateringMinimumSeconds;
        }
    }
}
