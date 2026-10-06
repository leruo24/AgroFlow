using System.Globalization;

namespace AgroFlow.Api.Reports;

// Item 3: how a report talks about its own period, and how it writes dates.
//
// The 5 Oct reports said "the pump ran 6 times this week" in a 30-day report
// and printed "2026-09-16T22:49:04Z (UTC)". Every report now takes its words
// from here, so the period is always described by its real length and a date
// always reads "Wed 7 Oct".
internal static class ReportPeriod
{
    private static readonly CultureInfo Inv = CultureInfo.InvariantCulture;

    // DATA RULE: over two weeks, daily bars crowd into an unreadable comb
    // (the 30-bar chart of 5 Oct), so charts group by week instead.
    public const int MaxDailyBars = 14;

    public static int Days(DateOnly from, DateOnly to) => to.DayNumber - from.DayNumber + 1;

    public static bool Weekly(DateOnly from, DateOnly to) => Days(from, to) > MaxDailyBars;

    /// "Wed 7 Oct" - never an ISO string.
    public static string Day(DateOnly d) => d.ToString("ddd d MMM", Inv);

    /// "Wednesday", for when a farmer acts within the coming week.
    public static string Weekday(DateOnly d) => d.ToString("dddd", Inv);

    /// "09:49", SAST.
    public static string Time(DateTime sast) => sast.ToString("HH:mm", Inv);

    /// The period in words, from its real length:
    ///   one day       -> "on Wed 7 Oct"
    ///   7 days, ended -> "this week"
    ///   n days, ended -> "in the last 30 days"
    ///   older         -> "between Mon 1 Sep and Tue 30 Sep"
    /// "Ended" means it ends today or yesterday; anything older is a past
    /// period and is named by its dates, never as "this week".
    public static string Words(DateOnly from, DateOnly to, DateOnly today)
    {
        var n = Days(from, to);
        if (n <= 1) return "on " + Day(from);

        var endsRecently = to >= today.AddDays(-1);
        if (endsRecently && n == 7) return "this week";
        if (endsRecently) return $"in the last {n} days";
        return $"between {Day(from)} and {Day(to)}";
    }

    /// Weekly buckets from the first day: (label, first day, last day). The
    /// last bucket may be shorter; its label says so by its dates.
    public static List<(string Label, DateOnly Start, DateOnly End)> Weeks(DateOnly from, DateOnly to)
    {
        var weeks = new List<(string, DateOnly, DateOnly)>();
        for (var start = from; start <= to; start = start.AddDays(7))
        {
            var end = start.AddDays(6) > to ? to : start.AddDays(6);
            weeks.Add(($"{start.ToString("d MMM", Inv)}", start, end));
        }
        return weeks;
    }
}
