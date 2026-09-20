#nullable enable
using System;

namespace AgroFlow.Business
{
    // Which write paths are allowed to create an irrigation_commands row for a
    // zone, given that zone's irrigation_mode.
    //
    // zone.irrigation_mode was added by 0010_zone_schema_realignment.sql with
    // check (irrigation_mode in ('automatic', 'scheduled', 'manual')) and is
    // what the mobile app's zone-settings screen writes. Until this type
    // existed, nothing on the backend read it: SensorReadingProcessor issued
    // moisture-triggered 'start' commands for every zone regardless of mode, so
    // a farmer who deliberately set a zone to Manual could still have the pump
    // started under them by a sensor reading. That is the bug this closes.
    //
    // FAIL CLOSED. Anything that is not exactly 'automatic' - including null,
    // empty, unknown text, or a value someone adds to the check constraint
    // later without revisiting this file - returns false. Starting a pump is a
    // physical action on someone's field; the safe default when the mode is
    // not understood is to do nothing and let the farmer act.
    public static class IrrigationMode
    {
        public const string Automatic = "automatic";
        public const string Scheduled = "scheduled";
        public const string Manual = "manual";

        // True only for 'automatic'.
        //
        // 'manual' is obvious: the farmer asked to drive it themselves.
        //
        // 'scheduled' is the less obvious one and is deliberate. In scheduled
        // mode the pg_cron job fire_due_irrigation_schedules() owns the
        // decision of when this zone runs (0010). If moisture-triggered auto
        // commands were also allowed, the two would fight each other - the
        // sensor path would start the pump off-schedule and the de-dup logic
        // in SensorReadingProcessor would then suppress the scheduled 'start'
        // that followed, because the last command already said 'start'.
        //
        // Comparison is ordinal and case-insensitive: the column is plain text
        // and this must not depend on the server's locale.
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
