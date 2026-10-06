using System;
using System.Collections.Generic;
using System.Linq;
using AgroFlow.Api.Endpoints;
using AgroFlow.Api.Reports;
using QuestPDF.Infrastructure;
using Xunit;

namespace AgroFlow.Domain.Tests;

// Item 6c (part 4): the Enquiries & sales follow-up report counts what the
// data says - worked out by hand below for a fixed set of enquiries.
public class EnquiryReportTests
{
    static EnquiryReportTests() { QuestPDF.Settings.License = LicenseType.Community; }

    private static readonly TimeSpan Sast = TimeSpan.FromHours(2);
    private static DateTimeOffset At(int month, int day, int hour) => new(2026, month, day, hour, 0, 0, Sast);

    private static readonly Guid A = Guid.Parse("00000000-0000-4000-8000-00000000000a");
    private static readonly Guid B = Guid.Parse("00000000-0000-4000-8000-00000000000b");

    // Now: Wednesday 7 October 2026, 10:00 SAST. Period: 8 Sep - 7 Oct.
    private static readonly DateTimeOffset Now = At(10, 7, 10);
    private static readonly DateOnly From = new(2026, 9, 8);
    private static readonly DateOnly To = new(2026, 10, 7);

    private static EnquiryFact E(long id, DateTimeOffset created, string province, string status, string? outcome,
        string? reason = null, string? other = null, Guid? handler = null, double? hoursToCall = null,
        DateTimeOffset? callback = null, int noAnswer = 0) =>
        new(id, created, province, status, outcome, reason, other, handler, handler == A ? "Leruo" : handler == B ? "Thandi" : null,
            hoursToCall is { } h ? created.AddHours(h) : null, callback, noAnswer, status == "won" ? Guid.NewGuid() : null);

    private static readonly List<EnquiryFact> Enquiries = new()
    {
        E(1, At(10, 1, 9), "Western Cape", "new", null),                                                   // never called, 4 working days old
        E(2, At(10, 6, 8), "Gauteng", "open", "callback", handler: A, hoursToCall: 2, callback: At(10, 7, 9)), // call-back due today
        E(3, At(9, 29, 9), "Western Cape", "won", "wants", handler: A, hoursToCall: 24),
        E(4, At(9, 30, 9), "North West", "lost", "not_interested", "no_internet", handler: B, hoursToCall: 5),
        E(5, At(9, 30, 11), "North West", "lost", "not_interested", "other", "Moving to the city", handler: B, hoursToCall: 3),
        E(6, At(10, 2, 9), "Gauteng", "open", "no_answer", handler: A, hoursToCall: 1, noAnswer: 3),
        E(7, At(8, 1, 9), "Limpopo", "lost", "not_interested", "too_expensive", handler: B, hoursToCall: 2),  // before the period
    };

    private static readonly List<EnquiryCallFact> Calls = new()
    {
        new(2, At(10, 6, 10), "Leruo", "callback"),
        new(3, At(9, 30, 9), "Leruo", "callback"), new(3, At(10, 1, 9), "Leruo", "wants"),
        new(4, At(9, 30, 14), "Thandi", "not_interested"),
        new(5, At(9, 30, 14), "Thandi", "not_interested"),
        new(6, At(10, 2, 10), "Leruo", "no_answer"), new(6, At(10, 3, 10), "Leruo", "no_answer"), new(6, At(10, 5, 10), "Leruo", "no_answer"),
        new(7, At(8, 1, 11), "Thandi", "not_interested"),
    };

    [Fact]
    public void The_summary_counts_match_the_data()
    {
        var c = EnquiryReport.Compose(Enquiries, Calls, From, To, Now, null, null, null);

        Assert.Equal(6, c.Received);                         // 7 is before the period
        Assert.Equal(5, c.Called);                           // all but 1
        Assert.Equal(1, c.BecameFarmers);
        Assert.Equal(16.7, c.ConversionPercent);             // 1 of 6
        Assert.Equal(7.0, c.AverageHoursToFirstCall);        // (2 + 24 + 5 + 3 + 1) / 5
        Assert.Equal(1, c.OverdueCallbacks);                 // enquiry 2, due 09:00 today

        Assert.Equal(new[] { ("Not called yet", 1), ("Wants AgroFlow", 1), ("Call back later", 1), ("No answer", 1), ("Not interested", 2) },
            c.Outcomes.Select(o => (o.Label, o.Value)));
        Assert.Equal(new[] { ("No reliable internet or WiFi", 1), ("Other", 1) }, c.Reasons.Select(r => (r.Label, r.Value)));
        Assert.Equal(new[] { "Moving to the city" }, c.OtherReasons);
        Assert.Equal(new[] { ("Gauteng", 2), ("North West", 2), ("Western Cape", 2) }, c.ByProvince.Select(p => (p.Label, p.Value)));
        Assert.Equal(new[] { ("Leruo", 6), ("Thandi", 2) }, c.CallsPerAdmin.Select(a => (a.Label, a.Value)));   // enquiry 7's call is outside

        // Weeks by the Monday they start: 28 Sep (3, 4, 5 and 6 - Friday 2 Oct)
        // averages (24 + 5 + 3 + 1) / 4 = 8.25 h; 5 Oct is enquiry 2 alone, 2 h.
        Assert.Equal(new[] { "28 Sep", "5 Oct" }, c.FirstCallByWeek.Select(w => w.Week));
        Assert.Equal(new[] { 4, 1 }, c.FirstCallByWeek.Select(w => w.Called));
        Assert.Equal(8.2, c.FirstCallByWeek[0].Hours!.Value, 6);
        Assert.Equal(2.0, c.FirstCallByWeek[1].Hours!.Value, 6);
    }

    [Fact]
    public void Do_this_next_says_what_is_waiting()
    {
        var c = EnquiryReport.Compose(Enquiries, Calls, From, To, Now, null, null, null);
        Assert.Equal(new[]
        {
            "1 call-back is due today.",
            "1 enquiry is older than 2 working days with no call - the form promised one by now.",
            "1 enquiry has had no answer 3 times: try a different time of day, or close it.",
            "The top reason for \"no\" is no reliable internet or WiFi (1 of 2): consider the offline kit option.",
        }, c.DoThisNext);

        var quiet = EnquiryReport.Compose(new List<EnquiryFact>(), new List<EnquiryCallFact>(), From, To, Now, null, null, null);
        Assert.Equal(new[] { "Nothing is waiting: every enquiry has been called and no call-back is due." }, quiet.DoThisNext);
        Assert.Null(quiet.ConversionPercent);
        Assert.Null(quiet.AverageHoursToFirstCall);
    }

    [Fact]
    public void Filters_narrow_every_count()
    {
        var byA = EnquiryReport.Compose(Enquiries, Calls, From, To, Now, null, A, "Leruo");
        Assert.Equal(3, byA.Received);
        Assert.Equal(new[] { ("Leruo", 6) }, byA.CallsPerAdmin.Select(a => (a.Label, a.Value)));
        Assert.Contains("handled by Leruo", byA.Subtitle);

        var northWest = EnquiryReport.Compose(Enquiries, Calls, From, To, Now, "North West", null, null);
        Assert.Equal(2, northWest.Received);
        Assert.Equal(0, northWest.OverdueCallbacks);
        Assert.Equal(2, northWest.Reasons.Sum(r => r.Value));
    }

    [Theory]
    [InlineData(10, 1, 9, 4)]   // Thu → Wed: Fri, Mon, Tue, Wed
    [InlineData(10, 6, 8, 1)]   // Tue → Wed
    [InlineData(10, 7, 8, 0)]   // same day
    [InlineData(10, 2, 17, 3)]  // Fri evening → Wed: Mon, Tue, Wed (the weekend does not count)
    public void Working_days_skip_weekends(int month, int day, int hour, int expected)
    {
        Assert.Equal(expected, EnquiryReport.WorkingDaysBetween(At(month, day, hour), Now));
    }

    [Fact]
    public void The_pdf_and_workbook_render()
    {
        var c = EnquiryReport.Compose(Enquiries, Calls, From, To, Now, null, null, null);
        var pdf = EnquiryReportPdf.Build(c, Now);
        Assert.Equal("%PDF", System.Text.Encoding.ASCII.GetString(pdf, 0, 4));
        var xlsx = EnquiryReportPdf.Workbook(c);
        Assert.Equal("PK", System.Text.Encoding.ASCII.GetString(xlsx, 0, 2));

        // An empty period renders too, with its "none" lines rather than empty charts.
        var empty = EnquiryReport.Compose(new List<EnquiryFact>(), new List<EnquiryCallFact>(), From, To, Now, null, null, null);
        Assert.Equal("%PDF", System.Text.Encoding.ASCII.GetString(EnquiryReportPdf.Build(empty, Now), 0, 4));
    }

    [Fact]
    public void Report_filters_are_checked()
    {
        var today = new DateOnly(2026, 10, 7);
        var d = EnquiryReportEndpoints.ParseFilters(null, null, null, null, today);
        Assert.Null(d.Problem);
        Assert.Equal(new DateOnly(2026, 9, 8), d.From);       // the last 30 days by default
        Assert.Equal(today, d.To);

        Assert.NotNull(EnquiryReportEndpoints.ParseFilters("2026-10-08", "2026-10-01", null, null, today).Problem);
        Assert.NotNull(EnquiryReportEndpoints.ParseFilters("06/10/2026", null, null, null, today).Problem);
        Assert.NotNull(EnquiryReportEndpoints.ParseFilters("2024-01-01", "2026-01-01", null, null, today).Problem);
        Assert.NotNull(EnquiryReportEndpoints.ParseFilters(null, null, "Atlantis", null, today).Problem);
        Assert.NotNull(EnquiryReportEndpoints.ParseFilters(null, null, null, "not-a-guid", today).Problem);
        Assert.Equal("Gauteng", EnquiryReportEndpoints.ParseFilters(null, null, "Gauteng", null, today).Province);
    }

    // AGROFLOW_WRITE_SAMPLES=1 also writes it to docs/sample-reports - sample
    // data, the only place it may live.
    [Fact]
    public void Writes_the_sample_when_asked()
    {
        if (Environment.GetEnvironmentVariable("AGROFLOW_WRITE_SAMPLES") != "1") return;
        var dir = new System.IO.DirectoryInfo(AppContext.BaseDirectory);
        while (dir != null && !System.IO.Directory.Exists(System.IO.Path.Combine(dir.FullName, "docs"))) dir = dir.Parent;
        Assert.NotNull(dir);
        var folder = System.IO.Path.Combine(dir!.FullName, "docs", "sample-reports");
        var c = EnquiryReport.Compose(Enquiries, Calls, From, To, Now, null, null, null);
        System.IO.File.WriteAllBytes(System.IO.Path.Combine(folder, "enquiries-follow-up.pdf"), EnquiryReportPdf.Build(c, Now));
        System.IO.File.WriteAllBytes(System.IO.Path.Combine(folder, "enquiries-follow-up.xlsx"), EnquiryReportPdf.Workbook(c));
    }
}
