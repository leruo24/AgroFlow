#nullable enable
using System;
using System.Collections.Generic;

namespace AgroFlow.Business
{
    public enum ReportFrequency
    {
        Weekly,
        Monthly,
        // A one-page brief of today's actions, every morning.
        Daily,
    }

    // Decides when an automatic report schedule is due, and for which period.
    // The service wakes every hour. Getting "is it due?" wrong either sends the same
    // report every hour or silently sends nothing for a month, so the rule is kept
    // separate and tested directly.
    // All times are SAST (fixed UTC+2, no daylight saving), like the engine and reports.
    public static class ReportSchedulePolicy
    {
        // 07:00 SAST: early enough for the morning, late enough not to buzz at 3am.
        public const int SendHourSast = 7;

        public static readonly TimeSpan SastOffset = TimeSpan.FromHours(2);

        public static DateTimeOffset ToSast(DateTimeOffset utcNow)
        {
            return utcNow.ToOffset(SastOffset);
        }

        public static ReportFrequency ParseFrequency(string? value)
        {
            if (string.Equals(value, "monthly", StringComparison.OrdinalIgnoreCase)) return ReportFrequency.Monthly;
            if (string.Equals(value, "daily", StringComparison.OrdinalIgnoreCase)) return ReportFrequency.Daily;
            return ReportFrequency.Weekly;
        }

        public static string ToDatabaseValue(ReportFrequency frequency)
        {
            return frequency switch
            {
                ReportFrequency.Monthly => "monthly",
                ReportFrequency.Daily => "daily",
                _ => "weekly",
            };
        }

        // The weekday a weekly schedule is sent, ISO 1 (Monday) .. 7 (Sunday). Null or out of
        // range means Monday, the original default (0040).
        public const int DefaultIsoDay = 1;

        public static int IsoDay(int? dayOfWeek) =>
            dayOfWeek is >= 1 and <= 7 ? dayOfWeek.Value : DefaultIsoDay;

        private static int IsoDayOf(DateOnly date) => ((int)date.DayOfWeek + 6) % 7 + 1;

        private static bool IsSendDay(ReportFrequency frequency, int? dayOfWeek, DateOnly date) =>
            frequency switch
            {
                ReportFrequency.Daily => true,
                ReportFrequency.Monthly => date.Day == 1,
                _ => IsoDayOf(date) == IsoDay(dayOfWeek),
            };

        // The period a run now should report on: always a finished period in the past.
        // Weekly is the Monday-Sunday that just ended, monthly the month that just ended.
        // The duplicate check is keyed on this value, so it must be stable for the whole run.
        public static (DateOnly Start, DateOnly End) PeriodFor(
            ReportFrequency frequency, DateTimeOffset sastNow)
        {
            var today = DateOnly.FromDateTime(sastNow.DateTime);

            // Daily: today. The brief is "today's actions", and the date stays stable all day,
            // which the duplicate check needs.
            if (frequency == ReportFrequency.Daily)
            {
                return (today, today);
            }

            if (frequency == ReportFrequency.Monthly)
            {
                // The whole of last month.
                var firstOfThisMonth = new DateOnly(today.Year, today.Month, 1);
                var end = firstOfThisMonth.AddDays(-1);
                var start = new DateOnly(end.Year, end.Month, 1);

                return (start, end);
            }

            // Weekly: the seven days ending last Sunday.
            // DayOfWeek.Sunday is 0 and Monday is 1, so this maps Monday->0 ... Sunday->6, steps back
            // to the latest Monday, then one more week back to the Monday of the finished week.
            var daysSinceMonday = ((int)today.DayOfWeek + 6) % 7;
            var thisMonday = today.AddDays(-daysSinceMonday);
            var lastMonday = thisMonday.AddDays(-7);

            return (lastMonday, lastMonday.AddDays(6));
        }

        // Is this schedule due right now? All three must hold:
        //   1. it is on or after the send hour today;
        //   2. today is the right day (Monday, or the 1st);
        //   3. this period has not already been run.
        // lastRunAt is the period the schedule last reported on, not when the service last
        // looked (see 0035), so (3) still holds when the container restarts during a deploy.
        public static bool IsDue(
            bool enabled,
            ReportFrequency frequency,
            DateTimeOffset? lastRunAt,
            DateTimeOffset sastNow) =>
            IsDue(enabled, frequency, null, lastRunAt, sastNow);

        public static bool IsDue(
            bool enabled,
            ReportFrequency frequency,
            int? dayOfWeek,
            DateTimeOffset? lastRunAt,
            DateTimeOffset sastNow)
        {
            if (!enabled) return false;

            if (sastNow.Hour < SendHourSast) return false;

            var today = DateOnly.FromDateTime(sastNow.DateTime);

            if (!IsSendDay(frequency, dayOfWeek, today)) return false;

            if (lastRunAt is null) return true;

            // Already run today. Compared as a SAST calendar date, not "within 24 hours", so runs
            // at 07:05 and 23:50 on the same Monday count as one, and next Monday is a new one.
            var lastRunDate = DateOnly.FromDateTime(ToSast(lastRunAt.Value).DateTime);

            return lastRunDate < today;
        }

        // Weekly period for a chosen weekday: the seven days ending yesterday. For Monday
        // that is the same Monday-Sunday PeriodFor gives.
        public static (DateOnly Start, DateOnly End) PeriodFor(
            ReportFrequency frequency, int? dayOfWeek, DateTimeOffset sastNow)
        {
            if (frequency != ReportFrequency.Weekly || IsoDay(dayOfWeek) == DefaultIsoDay)
            {
                return PeriodFor(frequency, sastNow);
            }

            var today = DateOnly.FromDateTime(sastNow.DateTime);
            return (today.AddDays(-7), today.AddDays(-1));
        }

        // When this schedule will next send, for the "Next send" line. Null when it is off.
        public static DateTimeOffset? NextSend(
            bool enabled, ReportFrequency frequency, int? dayOfWeek,
            DateTimeOffset? lastRunAt, DateTimeOffset sastNow)
        {
            if (!enabled) return null;

            var day = DateOnly.FromDateTime(sastNow.DateTime);
            for (var i = 0; i <= 62; i++, day = day.AddDays(1))
            {
                if (!IsSendDay(frequency, dayOfWeek, day)) continue;

                var at = new DateTimeOffset(day.ToDateTime(new TimeOnly(SendHourSast, 0)), SastOffset);

                // Today counts only if today's run has not happened yet.
                if (i == 0 && lastRunAt is { } last
                    && DateOnly.FromDateTime(ToSast(last).DateTime) >= day)
                {
                    continue;
                }

                return at < sastNow && i == 0 ? sastNow : at;
            }

            return null;
        }

        // "The combined weekly farm summary": the farm's all-zones action report for the
        // period, queued as a farm-level water_usage request. Schedule only; a farmer cannot
        // request it by hand.
        public const string FarmSummary = "farm_summary";

        public static bool IsScheduleType(string? type) =>
            type == FarmSummary || ReportKinds.IsValid(type);

        public static string DisplayName(string? type) =>
            type == FarmSummary ? "Farm summary" : ReportKinds.DisplayName(type);

        // The report requests one due schedule creates, as (report type, zone or null for the
        // whole farm). Moisture is always per zone; water usage and the schedule are one
        // all-zones PDF unless perZonePdf (then one per zone); the farm summary is always the
        // whole farm. Duplicates collapse, so "water usage" (all zones) plus "farm summary"
        // sends one PDF.
        public static List<(string ReportType, long? ZoneId)> RequestsFor(
            IEnumerable<string> types, bool perZonePdf, IReadOnlyList<long> zoneIds)
        {
            var requests = new List<(string, long?)>();

            void Add(string type, long? zone)
            {
                if (!requests.Contains((type, zone))) requests.Add((type, zone));
            }

            foreach (var type in types)
            {
                if (type == FarmSummary)
                {
                    Add(ReportKinds.WaterUsage, null);
                }
                else if (ReportKinds.RequiresZone(type) || (perZonePdf && ReportKinds.IsValid(type)))
                {
                    foreach (var zone in zoneIds) Add(type, zone);
                }
                else if (ReportKinds.IsValid(type))
                {
                    Add(type, null);
                }
            }

            return requests;
        }

        // What the farmer sees on their Reports screen, built here so the farmer's wording
        // and the admin's checkboxes describe the same row the same way.
        public static string Describe(
            bool enabled, ReportFrequency frequency, string[] reportTypes)
        {
            if (!enabled || reportTypes.Length == 0) return "Automatic reports: off";

            var names = new string[reportTypes.Length];
            for (var i = 0; i < reportTypes.Length; i++)
            {
                names[i] = DisplayName(reportTypes[i]);
            }

            var how = frequency switch
            {
                ReportFrequency.Monthly => "Monthly",
                ReportFrequency.Daily => "Daily",
                _ => "Weekly",
            };

            return "Automatic reports: " + how + " (" + string.Join(", ", names) + ")";
        }
    }
}
