#nullable enable
using System;

namespace AgroFlow.Business;

// The rules for a farmer's Water now run (docs/irrigate-path.md), shared by the API and its
// tests. Each zone has a maximum run time (zone.max_run_minutes, migration 0052: default
// 5 minutes, staff set 1 to 120). The server refuses a longer manual run instead of accepting
// one the kit will cut short, sends the limit to the kit with every command, and the kit
// enforces min(requested, zone maximum) itself. A run also needs a kit that is listening, so
// the server refuses at once instead of accepting a command that fails 2 hours later.
public static class IrrigationRunRules
{
    public const int DefaultMaxRunMinutes = 5;
    public const int LowestMaxRunMinutes = 1;
    public const int HighestMaxRunMinutes = 120;

    // The firmware's own ceiling (ABSOLUTE_MAX_RUN_MS), whatever a command says.
    public const int AbsoluteMaxRunSeconds = HighestMaxRunMinutes * 60;

    // Null when the request is fine; otherwise the sentence for the 400. The zone's own
    // limit is checked separately (CheckAgainstZone), once the zone is read.
    public static string? CheckRequest(string? command, int? durationSeconds)
    {
        if (command is not ("start" or "stop")) return "Command must be start or stop.";
        if (command == "start" && durationSeconds is null) return "A start command requires a duration.";
        if (durationSeconds is <= 0) return "Duration must be at least 1 second.";
        if (durationSeconds > AbsoluteMaxRunSeconds) return $"A run can be at most {HighestMaxRunMinutes} minutes.";
        return null;
    }

    // A start longer than this zone's maximum run time.
    public static string? CheckAgainstZone(int durationSeconds, int zoneMaxRunMinutes) =>
        durationSeconds > zoneMaxRunMinutes * 60
            ? $"This zone's pump is limited to {zoneMaxRunMinutes} min per run. Choose {zoneMaxRunMinutes} minutes or less, and run it again after it finishes."
            : null;

    // What staff may set in the admin site.
    public static string? CheckMaxRunMinutes(int? minutes) =>
        minutes is >= LowestMaxRunMinutes and <= HighestMaxRunMinutes
            ? null
            : $"The maximum run time must be between {LowestMaxRunMinutes} and {HighestMaxRunMinutes} minutes.";

    // A stored value outside the range (a hand edit) reads as the default, never as "no limit".
    public static int ZoneMaxOrDefault(int? stored) =>
        stored is >= LowestMaxRunMinutes and <= HighestMaxRunMinutes ? stored.Value : DefaultMaxRunMinutes;

    // What the kit does with a command: min(requested, zone maximum, its own ceiling). With
    // no maximum in the command (an older server) the kit uses DefaultMaxRunMinutes.
    // Mirrors hardware/esp32/AgroFlowIrrigationNode/RunLimits.h.
    public static int EffectiveRunSeconds(int requestedSeconds, int? maxRunSeconds)
    {
        var max = maxRunSeconds is > 0 ? maxRunSeconds.Value : DefaultMaxRunMinutes * 60;
        return Math.Max(0, Math.Min(requestedSeconds, Math.Min(max, AbsoluteMaxRunSeconds)));
    }

    public const string NoKitMessage = "No kit connected to this zone.";

    public const string KitOfflineMessage =
        "No kit connected to this zone: its kit has not been heard from in the last 5 minutes. Check it has power and WiFi.";

    public enum KitState { None, Offline, Online }

    // Whether a start may be sent: a kit enrolled on the zone (active, with a device id) that
    // was heard from within DeviceLiveness.OnlineWindow. A stop is always allowed.
    public static KitState Kit(bool hasActiveKit, DateTimeOffset? lastContact, DateTimeOffset now) =>
        !hasActiveKit ? KitState.None
        : DeviceLiveness.IsOnline(lastContact, now) ? KitState.Online
        : KitState.Offline;
}
