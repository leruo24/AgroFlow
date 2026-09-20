#nullable enable
using System;
using System.Globalization;
using System.Linq;

namespace AgroFlow.Business
{
    // Validation for an inbound irrigation event, before anything is written.
    //
    // POST /api/irrigation-events increments zone.water_used_total by whatever
    // estimated_litres the caller sends. It used to check only zoneId,
    // triggerSource and syncStatus - so a negative runtime or a negative litres
    // value was accepted and silently SUBTRACTED from the zone's running total,
    // permanently corrupting it. Nothing recomputes that total from the event
    // rows, so the corruption would not heal on its own.
    //
    // The endpoint is device-facing (X-Api-Key), and the device is an ESP32
    // that buffers events to flash while offline and replays them later. A
    // garbled buffer, a bad cast or a half-written flash record is a realistic
    // source of nonsense values, not a hypothetical one.
    //
    // Pure and side-effect free so the rules can be tested directly. Returns
    // null when the request is acceptable, or a human-readable reason to put in
    // the 400 body.
    public static class IrrigationEventValidation
    {
        public static readonly string[] ValidTriggerSources = { "auto", "manual", "scheduled", "unknown" };
        public static readonly string[] ValidSyncStatuses = { "synced", "offline_queued" };

        // A single irrigation cycle longer than this is a stuck valve, a
        // corrupt offline record, or a firmware bug - not a real run. Matches
        // WaterUsageEstimator.MaxPlausibleRuntimeSeconds.
        public const int MaxRuntimeSeconds = 6 * 60 * 60; // 6 hours

        // Upper bound on the implied delivery rate. Nothing on a smallholding
        // irrigation zone moves a thousand litres a minute; a value implying it
        // means runtime and litres disagree, so neither can be trusted.
        public const double MaxImpliedFlowRateLpm = 1000.0;

        public static string? Validate(
            long zoneId, int runtimeSeconds, float estimatedLitres, string? triggerSource, string? syncStatus)
        {
            if (zoneId <= 0)
            {
                return "zoneId must be a positive zone identifier.";
            }

            if (triggerSource == null || !ValidTriggerSources.Contains(triggerSource))
            {
                return "triggerSource must be one of: " + string.Join(", ", ValidTriggerSources) + ".";
            }

            if (syncStatus == null || !ValidSyncStatuses.Contains(syncStatus))
            {
                return "syncStatus must be one of: " + string.Join(", ", ValidSyncStatuses) + ".";
            }

            // --- The bug: negatives were accepted and subtracted from the total.
            if (runtimeSeconds < 0)
            {
                return "runtimeSeconds cannot be negative (got " + runtimeSeconds.ToString(CultureInfo.InvariantCulture) + ").";
            }

            if (estimatedLitres < 0)
            {
                return "estimatedLitres cannot be negative (got " + estimatedLitres.ToString(CultureInfo.InvariantCulture) + ").";
            }

            // NaN slips past both comparisons above - every comparison with NaN
            // is false - and would poison zone.water_used_total permanently,
            // since NaN + anything stays NaN. Infinity is just as bad.
            if (float.IsNaN(estimatedLitres) || float.IsInfinity(estimatedLitres))
            {
                return "estimatedLitres must be a finite number.";
            }

            // --- Absurd-duration bound.
            if (runtimeSeconds > MaxRuntimeSeconds)
            {
                return "runtimeSeconds of " + runtimeSeconds.ToString(CultureInfo.InvariantCulture) +
                       " exceeds the " + MaxRuntimeSeconds.ToString(CultureInfo.InvariantCulture) +
                       "s (6 hour) bound for a single irrigation cycle - this looks like a stuck valve or a corrupt offline record, not a real run.";
            }

            // --- Internal consistency between the two numbers.
            if (runtimeSeconds == 0 && estimatedLitres > 0)
            {
                return "estimatedLitres is " + estimatedLitres.ToString(CultureInfo.InvariantCulture) +
                       " but runtimeSeconds is 0 - water cannot be delivered in no time.";
            }

            if (runtimeSeconds > 0)
            {
                var impliedLpm = estimatedLitres / (runtimeSeconds / 60.0);
                if (impliedLpm > MaxImpliedFlowRateLpm)
                {
                    return "estimatedLitres " + estimatedLitres.ToString(CultureInfo.InvariantCulture) +
                           " over " + runtimeSeconds.ToString(CultureInfo.InvariantCulture) +
                           "s implies " + impliedLpm.ToString("F0", CultureInfo.InvariantCulture) +
                           " L/min, above the " + MaxImpliedFlowRateLpm.ToString("F0", CultureInfo.InvariantCulture) +
                           " L/min plausibility bound - runtime and litres disagree, so neither is trustworthy.";
                }
            }

            return null;
        }
    }
}
