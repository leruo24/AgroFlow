#nullable enable
using System;

namespace AgroFlow.Business
{
    // Which write paths may create an irrigation_commands row for a zone, given its
    // irrigation_mode (0010: 'automatic', 'scheduled' or 'manual', set from the app's
    // zone settings). SensorReadingProcessor checks this so a zone set to Manual is never
    // started by a sensor reading.
    // Safety: fails closed. Anything that is not exactly 'automatic' (null, empty,
    // unknown, or a value added later) returns false, because starting a pump acts on a
    // real field and the safe default is to do nothing.
    public static class IrrigationMode
    {
        public const string Automatic = "automatic";
        public const string Scheduled = "scheduled";
        public const string Manual = "manual";

        // True only for 'automatic'.
        // 'manual': the farmer controls it.
        // 'scheduled': the pg_cron job fire_due_irrigation_schedules() decides when the zone
        // runs (0010). Allowing sensor commands too would make the two fight: the sensor
        // would start the pump off-schedule, and the de-dup logic would then skip the
        // scheduled 'start'.
        // Ordinal, case-insensitive comparison, so it never depends on the server's locale.
        public static bool AllowsAutoCommands(string? irrigationMode)
        {
            return string.Equals(irrigationMode, Automatic, StringComparison.OrdinalIgnoreCase);
        }

        public static bool IsRecognised(string? irrigationMode)
        {
            return string.Equals(irrigationMode, Automatic, StringComparison.OrdinalIgnoreCase)
                || string.Equals(irrigationMode, Scheduled, StringComparison.OrdinalIgnoreCase)
                || string.Equals(irrigationMode, Manual, StringComparison.OrdinalIgnoreCase);
        }
    }
}
