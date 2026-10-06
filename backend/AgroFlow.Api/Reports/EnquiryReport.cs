using System.Globalization;
using AgroFlow.Business;

namespace AgroFlow.Api.Reports;

/// One enquiry, as the report needs it (no personal details).
internal sealed record EnquiryFact(
    long Id, DateTimeOffset CreatedAt, string Province, string Status, string? Outcome,
    string? Reason, string? ReasonOther, Guid? HandlerId, string? HandlerName,
    DateTimeOffset? FirstCalledAt, DateTimeOffset? CallbackAt, int NoAnswerCount, Guid? FarmerProfileId);

/// One logged call.
internal sealed record EnquiryCallFact(long EnquiryId, DateTimeOffset CalledAt, string CallerName, string Outcome);

internal sealed record Count(string Label, int Value);

/// Everything the PDF and the workbook show - worked out once, here, so the
/// two can never disagree and the numbers can be tested.
internal sealed class EnquiryReportContent
{
    public required string Title { get; init; }
    public required string Subtitle { get; init; }
    public required string Filters { get; init; }

    public int Received { get; init; }
    public int Called { get; init; }
    public int BecameFarmers { get; init; }
    /// Of those received, the share that became farmers; null with none received.
    public double? ConversionPercent { get; init; }
    /// Mean hours from the enquiry to its first call, over those called; null if none.
    public double? AverageHoursToFirstCall { get; init; }
    public int OverdueCallbacks { get; init; }

    public required List<Count> Outcomes { get; init; }
    public required List<Count> Reasons { get; init; }
    public required List<string> OtherReasons { get; init; }
    public required List<Count> ByProvince { get; init; }
    /// Week starting (Monday, "6 Oct") → average hours to first call that week.
    public required List<(string Week, double? Hours, int Called)> FirstCallByWeek { get; init; }
    public required List<Count> CallsPerAdmin { get; init; }

    public required List<string> DoThisNext { get; init; }
}

// Item 6c: "Enquiries & sales follow-up" - for the team that phones people
// back. Action-led: what to do next first, then how it went.
internal static class EnquiryReport
{
    private static readonly CultureInfo Inv = CultureInfo.InvariantCulture;
    private static readonly TimeSpan Sast = TimeSpan.FromHours(2);

    /// DATA RULE: an enquiry with no call this many working days after it
    /// arrived has missed the "within 2 working days" the form promises.
    public const int PromisedWorkingDays = 2;

    public static readonly IReadOnlyDictionary<string, string> OutcomeLabels = new Dictionary<string, string>
    {
        ["wants"] = "Wants AgroFlow",
        ["callback"] = "Call back later",
        ["no_answer"] = "No answer",
        ["not_interested"] = "Not interested",
    };

    /// Short labels for the chart's axis; the table beside it uses the full ones.
    public static readonly IReadOnlyDictionary<string, string> ReasonShort = new Dictionary<string, string>
    {
        ["too_expensive"] = "Price",
        ["no_internet"] = "No WiFi",
        ["no_electricity"] = "No power",
        ["not_farming"] = "Not farming",
        ["has_system"] = "Has system",
        ["not_right_time"] = "Timing",
        ["thinking"] = "Thinking",
        ["other"] = "Other",
    };

    /// Weekdays (Mon-Fri) wholly passed between two moments, in SAST.
    public static int WorkingDaysBetween(DateTimeOffset from, DateTimeOffset to)
    {
        var day = DateOnly.FromDateTime(from.ToOffset(Sast).Date).AddDays(1);
        var end = DateOnly.FromDateTime(to.ToOffset(Sast).Date);
        var n = 0;
        for (; day <= end; day = day.AddDays(1))
        {
            if (day.DayOfWeek is not (DayOfWeek.Saturday or DayOfWeek.Sunday)) n++;
        }
        return n;
    }

    public static EnquiryReportContent Compose(
        IReadOnlyList<EnquiryFact> allEnquiries, IReadOnlyList<EnquiryCallFact> allCalls,
        DateOnly from, DateOnly to, DateTimeOffset now, string? province, Guid? handler, string? handlerName)
    {
        var start = new DateTimeOffset(from.ToDateTime(TimeOnly.MinValue), Sast);
        var end = new DateTimeOffset(to.AddDays(1).ToDateTime(TimeOnly.MinValue), Sast);

        var rows = allEnquiries
            .Where(e => e.CreatedAt >= start && e.CreatedAt < end)
            .Where(e => province is null || e.Province == province)
            .Where(e => handler is null || e.HandlerId == handler)
            .ToList();
        var ids = rows.Select(e => e.Id).ToHashSet();
        var calls = allCalls.Where(c => ids.Contains(c.EnquiryId)).ToList();

        var called = rows.Where(e => e.FirstCalledAt.HasValue).ToList();
        var won = rows.Count(e => e.Status == "won");
        var today = DateOnly.FromDateTime(now.ToOffset(Sast).Date);

        // "Due" means its day has come (SAST), so this morning's list includes
        // this afternoon's call-backs. Across ALL enquiries, not the period:
        // a call-back promised last month is still owed today.
        var dueToday = allEnquiries.Count(e =>
            e.Status == "open" && e.CallbackAt is { } cb && DateOnly.FromDateTime(cb.ToOffset(Sast).Date) <= today
            && (province is null || e.Province == province) && (handler is null || e.HandlerId == handler));

        var waitingTooLong = allEnquiries.Count(e =>
            e.Status is "new" or "open" && e.FirstCalledAt is null
            && WorkingDaysBetween(e.CreatedAt, now) >= PromisedWorkingDays
            && (province is null || e.Province == province) && (handler is null || e.HandlerId == handler));

        var unreachable = rows.Count(e => e.Status == "open" && e.NoAnswerCount >= EnquiryRules.NoAnswerLimit);

        var outcomes = OutcomeLabels.Select(kv => new Count(kv.Value, rows.Count(e => e.Outcome == kv.Key))).ToList();
        outcomes.Insert(0, new Count("Not called yet", rows.Count(e => e.FirstCalledAt is null)));

        var lost = rows.Where(e => e.Status == "lost" && e.Reason != null).ToList();
        var reasons = EnquiryRules.Reasons
            .Select(kv => new Count(kv.Value, lost.Count(e => e.Reason == kv.Key)))
            .Where(c => c.Value > 0)
            .OrderByDescending(c => c.Value)
            .ToList();
        var otherTexts = lost.Where(e => e.Reason == "other" && !string.IsNullOrWhiteSpace(e.ReasonOther))
            .Select(e => e.ReasonOther!.Trim()).ToList();

        var byProvince = rows.GroupBy(e => e.Province)
            .Select(g => new Count(g.Key, g.Count()))
            .OrderByDescending(c => c.Value).ThenBy(c => c.Label, StringComparer.Ordinal).ToList();

        var weeks = called
            .GroupBy(e => MondayOf(DateOnly.FromDateTime(e.CreatedAt.ToOffset(Sast).Date)))
            .OrderBy(g => g.Key)
            .Select(g => (g.Key.ToString("d MMM", Inv),
                (double?)Math.Round(g.Average(e => (e.FirstCalledAt!.Value - e.CreatedAt).TotalHours), 1), g.Count()))
            .ToList();

        var perAdmin = calls.GroupBy(c => c.CallerName)
            .Select(g => new Count(g.Key, g.Count()))
            .OrderByDescending(c => c.Value).ThenBy(c => c.Label, StringComparer.Ordinal).ToList();

        var next = new List<string>();
        if (dueToday > 0) next.Add($"{dueToday} call-back{(dueToday == 1 ? " is" : "s are")} due today.");
        if (waitingTooLong > 0)
            next.Add($"{waitingTooLong} enquir{(waitingTooLong == 1 ? "y is" : "ies are")} older than {PromisedWorkingDays} working days with no call - the form promised one by now.");
        if (unreachable > 0)
            next.Add($"{unreachable} enquir{(unreachable == 1 ? "y has" : "ies have")} had no answer {EnquiryRules.NoAnswerLimit} times: try a different time of day, or close {(unreachable == 1 ? "it" : "them")}.");
        if (reasons.Count > 0)
        {
            var top = reasons[0];
            var key = EnquiryRules.Reasons.First(kv => kv.Value == top.Label).Key;
            var hint = key == "no_internet" ? ": consider the offline kit option" : "";
            next.Add($"The top reason for \"no\" is {char.ToLowerInvariant(top.Label[0]) + top.Label[1..]} ({top.Value} of {lost.Count}){hint}.");
        }
        if (next.Count == 0) next.Add("Nothing is waiting: every enquiry has been called and no call-back is due.");

        var filters = new List<string> { $"{from.ToString("d MMM yyyy", Inv)} – {to.ToString("d MMM yyyy", Inv)}" };
        if (province != null) filters.Add(province);
        if (handler != null) filters.Add("handled by " + (handlerName ?? "one admin"));

        return new EnquiryReportContent
        {
            Title = "Enquiries & sales follow-up",
            Subtitle = string.Join(" · ", filters),
            Filters = string.Join(" · ", filters),
            Received = rows.Count,
            Called = called.Count,
            BecameFarmers = won,
            ConversionPercent = rows.Count == 0 ? null : Math.Round(100.0 * won / rows.Count, 1),
            AverageHoursToFirstCall = called.Count == 0 ? null
                : Math.Round(called.Average(e => (e.FirstCalledAt!.Value - e.CreatedAt).TotalHours), 1),
            OverdueCallbacks = dueToday,
            Outcomes = outcomes,
            Reasons = reasons,
            OtherReasons = otherTexts,
            ByProvince = byProvince,
            FirstCallByWeek = weeks,
            CallsPerAdmin = perAdmin,
            DoThisNext = next,
        };
    }

    private static DateOnly MondayOf(DateOnly d) => d.AddDays(-(((int)d.DayOfWeek + 6) % 7));
}
