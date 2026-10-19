#nullable enable
using System;

namespace AgroFlow.Business;

// The rules for a farmer's Water now run (docs/irrigate-path.md), shared by the API and its
// tests. The kit stops every run at 5 minutes, so the server refuses longer ones instead of
// accepting a run the kit will silently cut short.
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
}
