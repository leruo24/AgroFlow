#nullable enable
using System;

namespace AgroFlow.Business;

// What happened to a command, in the words the app shows. The database's status column is
// the kit's word ("executed" = the kit started the run); finished_at is set when the kit
// reports the run itself as an irrigation event. So "executed" never means "finished".
public static class CommandState
{
    public const string Sent = "sent";              // waiting for the kit
    public const string Started = "started";        // the kit acknowledged: watering
    public const string Finished = "finished";      // the kit reported the finished run
    public const string NoResponse = "no_response"; // nothing from the kit within the wait
    public const string Failed = "failed";          // given up (2 hours, CommandReplayPolicy)

    // How long the app waits for the kit's acknowledgement before saying so.
    public static readonly TimeSpan AckWait = TimeSpan.FromSeconds(60);

    public static string Describe(string status, DateTimeOffset createdAt, DateTimeOffset? finishedAt, DateTimeOffset now)
    {
        if (finishedAt is not null) return Finished;
        return status switch
        {
            "executed" => Started,
            "failed" => Failed,
            _ => now - createdAt > AckWait ? NoResponse : Sent,
        };
    }

    public static string Label(string state) => state switch
    {
        Sent => "Sending…",
        Started => "Kit started watering",
        Finished => "Finished",
        NoResponse => "Kit didn't respond — check it's online",
        _ => "Could not reach the kit",
    };
}

// The words the app shows for a command, in the order they happen (docs/audit/ui-contracts.md).
// Only the kit's own messages move a command to "confirmed": a request the server saved or sent is
// never shown as watering. Stops have their own words, so "Stop requested" is never read as stopped.
public static class CommandPhase
{
    public const string RequestSent = "request_sent";              // saved, not yet handed to the broker
    public const string WaitingForKit = "waiting_for_kit";         // sent to the kit, no answer yet
    public const string KitConfirmedStart = "kit_confirmed_start"; // the kit acknowledged and started
    public const string Finished = "finished";                     // the kit reported the finished run
    public const string StopRequested = "stop_requested";          // a stop sent, the kit has not answered
    public const string KitConfirmedStop = "kit_confirmed_stop";   // the kit acknowledged the stop
    public const string NoResponse = "no_response";                // nothing from the kit within the wait
    public const string Failed = "failed";                         // given up (2 hours)

    public static string Describe(string command, string status, DateTimeOffset createdAt, DateTimeOffset? publishedAt,
        DateTimeOffset? finishedAt, DateTimeOffset now)
    {
        if (status == "failed") return Failed;
        if (command == "stop")
        {
            if (status == "executed") return KitConfirmedStop;
            return now - createdAt > CommandState.AckWait ? NoResponse : StopRequested;
        }
        if (finishedAt is not null) return Finished;
        if (status == "executed") return KitConfirmedStart;
        if (now - createdAt > CommandState.AckWait) return NoResponse;
        return publishedAt is null ? RequestSent : WaitingForKit;
    }

    public static string Label(string phase) => phase switch
    {
        RequestSent => "Request sent",
        WaitingForKit => "Waiting for kit",
        KitConfirmedStart => "Kit confirmed start",
        Finished => "Finished",
        StopRequested => "Stop requested",
        KitConfirmedStop => "Kit confirmed stop",
        NoResponse => "No response",
        _ => "Could not reach the kit",
    };
}

// Links a pump run the kit reports (POST /api/irrigation-events) to the command it came from.
// The firmware does not send the command id with a run, so the server matches: same zone and
// source, the command was started (executed) and not finished yet, and its start time is the
// run's start, within a margin for clocks and network. A run with no start time (old firmware)
// matches a command started no earlier than the run's length plus the margin before now.
public static class RunCompletion
{
    public static readonly TimeSpan Margin = TimeSpan.FromMinutes(2);

    public static bool Matches(DateTimeOffset commandExecutedAt, DateTimeOffset? runStartedAt, int runtimeSeconds, DateTimeOffset now)
    {
        if (runStartedAt is { } started)
            return (commandExecutedAt - started).Duration() <= Margin;
        return commandExecutedAt >= now - TimeSpan.FromSeconds(Math.Max(0, runtimeSeconds)) - Margin
               && commandExecutedAt <= now + Margin;
    }
}
