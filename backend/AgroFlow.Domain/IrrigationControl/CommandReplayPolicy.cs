#nullable enable
using System;

namespace AgroFlow.Business
{
    public enum ReplayDecision
    {
        // Publish it: the device probably never got it.
        Publish,

        // Too old to act on safely. Mark it failed so the queue cannot grow forever and it
        // can never fire later as a surprise.
        Expire,
    }

    // Decides what to do with an irrigation_commands row that is still 'pending' when a
    // replay sweep finds it.
    // A command is normally sent once, when it is inserted (trigger -> pg_notify -> MQTT).
    // If the API or MQTT was down at that moment, nothing would ever retry it, and the
    // Railway container restarts on every deploy, so we replay pending commands.
    // Safety: old commands are expired, not replayed. A pending 'start' opens a valve;
    // replaying one from three days ago would water a field for reasons nobody can
    // explain, maybe at night or after rain. Recent commands are replayed and the rest
    // expired: a farmer can always ask again, but cannot undo a midnight flood.
    public static class CommandReplayPolicy
    {
        // Safety: how recent a pending command must be to still be sent. Two hours covers a
        // deploy, a restart, a broker blip or a short network outage, well before the
        // situation has changed.
        public static readonly TimeSpan MaxReplayAge = TimeSpan.FromHours(2);

        public static ReplayDecision Decide(DateTimeOffset createdAt, DateTimeOffset now)
        {
            var age = now - createdAt;

            // A negative age means the row is timestamped in the future (clock skew between the
            // database and this process). It was only just written, so treat it as current.
            if (age < TimeSpan.Zero) return ReplayDecision.Publish;

            return age <= MaxReplayAge ? ReplayDecision.Publish : ReplayDecision.Expire;
        }

        public static string ExpiryReason(DateTimeOffset createdAt, DateTimeOffset now)
        {
            return "pending for " + FormatAge(now - createdAt) +
                   ", beyond the " + FormatAge(MaxReplayAge) +
                   " replay window - expired rather than published, because acting on a stale irrigation instruction is worse than dropping it";
        }

        private static string FormatAge(TimeSpan age)
        {
            if (age.TotalDays >= 1) return ((int)age.TotalDays) + "d " + age.Hours + "h";
            if (age.TotalHours >= 1) return ((int)age.TotalHours) + "h " + age.Minutes + "m";
            return ((int)age.TotalMinutes) + "m";
        }
    }
}
