#nullable enable
using System;
using System.Globalization;
using System.Linq;

namespace AgroFlow.Business
{
    // Validation for an incoming irrigation event, before anything is written.
    // POST /api/irrigation-events adds estimated_litres to zone.water_used_total, and
    // nothing ever recomputes that total, so a negative runtime or litres value would
    // corrupt it for good. The ESP32 buffers events in flash while offline and replays
    // them, so garbled values are a real risk.
    // Pure, so the rules are tested directly. Returns null when the request is fine, or a
    // readable reason for the 400 body.
    public static class IrrigationEventValidation
    {
        public static readonly string[] ValidTriggerSources = { "auto", "manual", "scheduled", "unknown" };
        public static readonly string[] ValidSyncStatuses = { "synced", "offline_queued" };

        // A single run longer than this is a stuck valve, a corrupt offline record or a
        // firmware bug. Matches WaterUsageEstimator.MaxPlausibleRuntimeSeconds.
        public const int MaxRuntimeSeconds = 6 * 60 * 60; // 6 hours

        // Upper limit on the implied flow rate. No smallholding zone moves 1,000 L/min, so
        // such a value means runtime and litres disagree and neither can be trusted.
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

            // Negative values are rejected so they can never be subtracted from the total.
            if (runtimeSeconds < 0)
            {
                return "runtimeSeconds cannot be negative (got " + runtimeSeconds.ToString(CultureInfo.InvariantCulture) + ").";
            }

            if (estimatedLitres < 0)
            {
                return "estimatedLitres cannot be negative (got " + estimatedLitres.ToString(CultureInfo.InvariantCulture) + ").";
            }

            // NaN passes both checks above (every comparison with NaN is false) and would ruin
            // zone.water_used_total for good, since NaN + anything is NaN. Infinity is just as bad.
            if (float.IsNaN(estimatedLitres) || float.IsInfinity(estimatedLitres))
            {
                return "estimatedLitres must be a finite number.";
            }

            // Duration limit.
            if (runtimeSeconds > MaxRuntimeSeconds)
            {
                return "runtimeSeconds of " + runtimeSeconds.ToString(CultureInfo.InvariantCulture) +
                       " exceeds the " + MaxRuntimeSeconds.ToString(CultureInfo.InvariantCulture) +
                       "s (6 hour) bound for a single irrigation cycle - this looks like a stuck valve or a corrupt offline record, not a real run.";
            }

            // The two numbers must agree with each other.
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
