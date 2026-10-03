#nullable enable
using System;

namespace AgroFlow.Business
{
    public enum ReportFrequency
    {
        Weekly,
        Monthly,
    }

    // Decides when an automatic report schedule is due, and for which period.
    //
    // WHY THIS IS A NAMED POLICY AND NOT AN `if` IN THE SERVICE
    // --------------------------------------------------------
    // The service wakes every hour. Getting "is it due?" wrong in one
    // direction sends a farmer the same report every hour until someone
    // notices; in the other it silently sends nothing for a month and nobody
    // notices at all. Both are invisible from the code that calls it, so the
    // rule is separated out and tested directly.
    //
    // ALL TIMES ARE Africa/Johannesburg. South Africa has no daylight saving,
    // so a fixed +2 offset is exact and needs no timezone database - the same
    // choice the FAO-56 engine and the report endpoints already make.
    public static class ReportSchedulePolicy
    {
        // 07:00 SAST. Early enough to be read with the morning's first coffee,
        // late enough not to be a 3am phone buzz.
        public const int SendHourSast = 7;

        public static readonly TimeSpan SastOffset = TimeSpan.FromHours(2);

        public static DateTimeOffset ToSast(DateTimeOffset utcNow)
        {
            return utcNow.ToOffset(SastOffset);
        }

        public static ReportFrequency ParseFrequency(string? value)
        {
            return string.Equals(value, "monthly", StringComparison.OrdinalIgnoreCase)
                ? ReportFrequency.Monthly
                : ReportFrequency.Weekly;
        }

        public static string ToDatabaseValue(ReportFrequency frequency)
        {
            return frequency == ReportFrequency.Monthly ? "monthly" : "weekly";
        }

        // The period a run at this moment should report ON.
        //
        // Always a CLOSED period in the past: weekly covers the Monday-to-
        // Sunday that just ended, monthly the calendar month that just ended.
        // Never a part-finished period - a "week" report sent on Monday
        // morning covering the two hours since midnight would be worse than
        // useless, and it is also the value the duplicate check keys on, so
        // it has to be stable for the whole run.
        public static (DateOnly Start, DateOnly End) PeriodFor(
            ReportFrequency frequency, DateTimeOffset sastNow)
        {
            var today = DateOnly.FromDateTime(sastNow.DateTime);

            if (frequency == ReportFrequency.Monthly)
            {
                // The whole of last month.
                var firstOfThisMonth = new DateOnly(today.Year, today.Month, 1);
                var end = firstOfThisMonth.AddDays(-1);
                var start = new DateOnly(end.Year, end.Month, 1);

                return (start, end);
            }

            // Weekly: the seven days ending last Sunday.
            //
            // DayOfWeek.Sunday is 0 and Monday is 1, so this maps Monday->0
            // ... Sunday->6 and steps back to the most recent Monday, then
            // back one more week to the Monday of the week that has finished.
            var daysSinceMonday = ((int)today.DayOfWeek + 6) % 7;
            var thisMonday = today.AddDays(-daysSinceMonday);
            var lastMonday = thisMonday.AddDays(-7);

            return (lastMonday, lastMonday.AddDays(6));
        }

        // Is this schedule due to run right now?
        //
        // Three conditions, all of which must hold:
        //   1. it is on or after the send hour TODAY;
        //   2. today is the right day (Monday, or the 1st);
        //   3. this period has not already been run.
        //
        // lastRunAt is the period the schedule last produced reports FOR, not
        // when the service last looked - see the column comment in 0035. That
        // is what makes (3) survive a container restarting every ten minutes
        // during a deploy.
        public static bool IsDue(
            bool enabled,
            ReportFrequency frequency,
            DateTimeOffset? lastRunAt,
            DateTimeOffset sastNow)
        {
            if (!enabled) return false;

            if (sastNow.Hour < SendHourSast) return false;

            var today = DateOnly.FromDateTime(sastNow.DateTime);

            var onTheRightDay = frequency == ReportFrequency.Monthly
                ? today.Day == 1
                : today.DayOfWeek == DayOfWeek.Monday;

            if (!onTheRightDay) return false;

            if (lastRunAt is null) return true;

            // Already run today. Compared as a SAST calendar date rather than
            // "within 24 hours", so a run at 07:05 and one at 23:50 on the
            // same Monday are correctly one run, and 07:00 next Monday is
            // correctly a new one.
            var lastRunDate = DateOnly.FromDateTime(ToSast(lastRunAt.Value).DateTime);

            return lastRunDate < today;
        }

        // What the farmer sees on their Reports screen.
        //
        // Named here rather than built in the app so the farmer's wording and
        // the admin's checkboxes cannot drift - they are describing the same
        // row.
        public static string Describe(
            bool enabled, ReportFrequency frequency, string[] reportTypes)
        {
            if (!enabled || reportTypes.Length == 0) return "Automatic reports: off";

            var names = new string[reportTypes.Length];
            for (var i = 0; i < reportTypes.Length; i++)
            {
                names[i] = ReportKinds.DisplayName(reportTypes[i]);
            }

            var how = frequency == ReportFrequency.Monthly ? "Monthly" : "Weekly";

            return "Automatic reports: " + how + " (" + string.Join(", ", names) + ")";
        }
    }
}
