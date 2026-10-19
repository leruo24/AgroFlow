#nullable enable
using System;

namespace AgroFlow.Business;

// The rules for a farmer's Water now run (docs/irrigate-path.md), shared by the API and its
// tests. The kit stops every run at 5 minutes, so the server refuses longer ones instead of
// accepting a run the kit will silently cut short; and a run needs a kit that is listening,
// so the server refuses at once instead of accepting a command that fails 2 hours later.
public static class IrrigationRunRules
{
    // The kit's SAFETY_MAX_RUN_MS (AgroFlowIrrigationNode.ino).
    public const int MaxManualRunSeconds = 300;

    public const string TooLongMessage =
        "A run can be at most 5 minutes (300 seconds). The kit stops every run at 5 minutes.";

    // Null when the request is fine; otherwise the sentence for the 400.
    public static string? CheckRequest(string? command, int? durationSeconds)
    {
        if (command is not ("start" or "stop")) return "Command must be start or stop.";
        if (command == "start" && durationSeconds is null) return "A start command requires a duration.";
        if (durationSeconds is <= 0) return "Duration must be at least 1 second.";
        if (durationSeconds > MaxManualRunSeconds) return TooLongMessage;
        return null;
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
