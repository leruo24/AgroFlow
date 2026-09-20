#nullable enable
using System;

namespace AgroFlow.Business
{
    public enum ReplayDecision
    {
        // Publish it - the device plausibly never received it.
        Publish,

        // Too old to act on safely. Mark it failed so the queue does not grow
        // without bound and so it can never fire later as a surprise.
        Expire,
    }

    // Decides what to do with an irrigation_commands row that is still
    // 'pending' when a replay sweep finds it.
    //
    // WHY REPLAY EXISTS AT ALL
    // ------------------------
    // Until now a command reached a device exactly once, at the instant it was
    // inserted: the row fired trg_irrigation_commands_notify -> pg_notify ->
    // MQTT publish. If AgroFlow.Api was down, or its MQTT connection was down,
    // that NOTIFY went nowhere and the row sat at 'pending' forever with
    // nothing to retry it. That was tolerable when the API ran on a laptop
    // during a demo. It is not tolerable now that it is a Railway container
    // that restarts on every deploy.
    //
    // WHY OLD COMMANDS ARE EXPIRED RATHER THAN REPLAYED
    // -------------------------------------------------
    // This is the safety-critical half, and it is the reason this decision is a
    // named policy instead of a bare "select where status = 'pending'".
    //
    // A pending 'start' is an instruction to open a valve. Replaying one that
    // was queued three days ago - because the container happened to restart -
    // would start irrigating a field for reasons nobody watching could explain,
    // possibly at night, possibly after rain, possibly on a crop that has since
    // been harvested. The conditions that justified it are long gone.
    //
    // So: replay what is recent enough to still be the right instruction, and
    // expire the rest. A farmer who wants water now can always ask again; a
    // farmer who gets an unexplained midnight flood cannot un-flood the field.
    public static class CommandReplayPolicy
    {
        // How recent a pending command must be to still be worth sending.
        //
        // Two hours covers the cases replay is actually for - a deploy, a
        // container restart, a broker blip, a brief network partition - while
        // staying well short of "the situation has changed".
        public static readonly TimeSpan MaxReplayAge = TimeSpan.FromHours(2);

        public static ReplayDecision Decide(DateTimeOffset createdAt, DateTimeOffset now)
        {
            var age = now - createdAt;

            // A negative age means the row is timestamped in the future -
            // clock skew between the database and this process. Treat it as
            // current rather than expiring it: the row was only just written.
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
