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
