using System.Text;
using System.Text.RegularExpressions;
using AgroFlow.Api.Reports;
using AgroFlow.Api.Services;
using AgroFlow.Business;
using static AgroFlow.Domain.Tests.ActionReportTests;

namespace AgroFlow.Domain.Tests;

// Item 4: automatic reports - daily, a chosen weekday, per-zone PDFs, extra
// recipients, one retry then an alert. All pure; no database, no Telegram.
public class AutoReportScheduleTests
{
    static AutoReportScheduleTests()
    {
        QuestPDF.Settings.License = QuestPDF.Infrastructure.LicenseType.Community;
    }

    private static DateTimeOffset Sast(int y, int m, int d, int h, int min = 0) =>
        new(y, m, d, h, min, 0, ReportSchedulePolicy.SastOffset);

    // Wed 7 Oct 2026.
    private static readonly DateTimeOffset WedMorning = Sast(2026, 10, 7, 7, 30);

    [Fact]
    public void Daily_IsDueEveryDayAfterSeven_OnceADay()
    {
        Assert.False(ReportSchedulePolicy.IsDue(true, ReportFrequency.Daily, null, null, Sast(2026, 10, 7, 6, 59)));
        Assert.True(ReportSchedulePolicy.IsDue(true, ReportFrequency.Daily, null, null, WedMorning));
        Assert.False(ReportSchedulePolicy.IsDue(true, ReportFrequency.Daily, null, Sast(2026, 10, 7, 7, 5), Sast(2026, 10, 7, 23, 0)));
        Assert.True(ReportSchedulePolicy.IsDue(true, ReportFrequency.Daily, null, Sast(2026, 10, 6, 7, 5), WedMorning));
        Assert.Equal((new DateOnly(2026, 10, 7), new DateOnly(2026, 10, 7)), ReportSchedulePolicy.PeriodFor(ReportFrequency.Daily, WedMorning));
    }

    [Fact]
    public void Weekly_OnAChosenDay_IsDueThatDayOnly_ForTheSevenDaysBefore()
    {
        const int wednesday = 3;
        Assert.True(ReportSchedulePolicy.IsDue(true, ReportFrequency.Weekly, wednesday, null, WedMorning));
        Assert.False(ReportSchedulePolicy.IsDue(true, ReportFrequency.Weekly, wednesday, null, Sast(2026, 10, 8, 7, 30)));
        Assert.False(ReportSchedulePolicy.IsDue(true, ReportFrequency.Weekly, null, null, WedMorning)); // default Monday
        Assert.Equal((new DateOnly(2026, 9, 30), new DateOnly(2026, 10, 6)),
            ReportSchedulePolicy.PeriodFor(ReportFrequency.Weekly, wednesday, WedMorning));
    }

    [Fact]
    public void Weekly_WithNoDayChosen_IsExactlyWhatItWasBefore()
    {
        var monday = Sast(2026, 10, 12, 8);
        Assert.Equal(ReportSchedulePolicy.PeriodFor(ReportFrequency.Weekly, monday),
            ReportSchedulePolicy.PeriodFor(ReportFrequency.Weekly, null, monday));
        Assert.Equal(ReportSchedulePolicy.IsDue(true, ReportFrequency.Weekly, null, monday),
            ReportSchedulePolicy.IsDue(true, ReportFrequency.Weekly, null, null, monday));
    }

    [Theory]
    [InlineData(ReportFrequency.Daily)]
    [InlineData(ReportFrequency.Weekly)]
    [InlineData(ReportFrequency.Monthly)]
    public void Off_NeverFires_AndHasNoNextSend(ReportFrequency frequency)
    {
        for (var day = 1; day <= 31; day++)
        {
            Assert.False(ReportSchedulePolicy.IsDue(false, frequency, 1, null, Sast(2026, 10, day, 9)));
        }
        Assert.Null(ReportSchedulePolicy.NextSend(false, frequency, 1, null, WedMorning));
    }

    [Fact]
    public void NextSend_IsTheNextSendDayAtSeven()
    {
        // Weekly on Friday, asked on Wednesday: Friday 07:00.
        Assert.Equal(Sast(2026, 10, 9, 7), ReportSchedulePolicy.NextSend(true, ReportFrequency.Weekly, 5, null, WedMorning));
        // Monthly: the 1st of next month.
        Assert.Equal(Sast(2026, 11, 1, 7), ReportSchedulePolicy.NextSend(true, ReportFrequency.Monthly, null, null, WedMorning));
        // Daily, already sent today: tomorrow.
        Assert.Equal(Sast(2026, 10, 8, 7), ReportSchedulePolicy.NextSend(true, ReportFrequency.Daily, null, Sast(2026, 10, 7, 7, 2), WedMorning));
        // Daily, before seven and not yet sent: today at seven.
        Assert.Equal(Sast(2026, 10, 7, 7), ReportSchedulePolicy.NextSend(true, ReportFrequency.Daily, null, null, Sast(2026, 10, 7, 5)));
    }

    /* ---- which PDFs ------------------------------------------------------ */

    private static readonly long[] Zones = { 11, 12, 13 };

    [Fact]
    public void AllZonesPdf_IsOneFarmRequest_MoistureIsAlwaysPerZone()
    {
        var plan = ReportSchedulePolicy.RequestsFor(new[] { "water_usage", "moisture" }, perZonePdf: false, Zones);
        Assert.Equal(new (string, long?)[] { ("water_usage", null), ("moisture", 11), ("moisture", 12), ("moisture", 13) }, plan);
    }

    [Fact]
    public void PerZonePdf_GivesEachZoneItsOwnReport()
    {
        var plan = ReportSchedulePolicy.RequestsFor(new[] { "water_usage", "schedule" }, perZonePdf: true, Zones);
        Assert.Equal(6, plan.Count);
        Assert.All(plan, p => Assert.NotNull(p.ZoneId));
        Assert.Equal(plan.Count, plan.Distinct().Count()); // once per period per zone
    }

    [Fact]
    public void FarmSummary_IsTheWholeFarm_AndNeverSentTwice()
    {
        var plan = ReportSchedulePolicy.RequestsFor(new[] { ReportSchedulePolicy.FarmSummary, "water_usage" }, perZonePdf: false, Zones);
        Assert.Equal(new (string, long?)[] { ("water_usage", null) }, plan);
        Assert.True(ReportSchedulePolicy.IsScheduleType(ReportSchedulePolicy.FarmSummary));
        Assert.False(ReportKinds.IsValid(ReportSchedulePolicy.FarmSummary)); // never a farmer-requested type
        Assert.Contains("Farm summary", ReportSchedulePolicy.Describe(true, ReportFrequency.Weekly, new[] { ReportSchedulePolicy.FarmSummary }));
    }

    [Fact]
    public void UnknownTypes_QueueNothing()
    {
        Assert.Empty(ReportSchedulePolicy.RequestsFor(new[] { "device_performance" }, perZonePdf: true, Zones));
    }

    /* ---- delivery ---------------------------------------------------------- */

    [Fact]
    public async Task AFailedSend_IsRetriedOnce_ThenGivesUp()
    {
        var calls = 0;
        var ok = await ReportDelivery.SendWithOneRetryAsync(() => { calls++; return Task.FromResult(false); }, TimeSpan.Zero, default);
        Assert.False(ok);
        Assert.Equal(2, calls);
    }

    [Fact]
    public async Task ASendThatWorksSecondTime_Succeeds_AndAFirstTimeSuccessIsNotRepeated()
    {
        var calls = 0;
        Assert.True(await ReportDelivery.SendWithOneRetryAsync(() => Task.FromResult(++calls == 2), TimeSpan.Zero, default));
        Assert.Equal(2, calls);

        calls = 0;
        Assert.True(await ReportDelivery.SendWithOneRetryAsync(() => { calls++; return Task.FromResult(true); }, TimeSpan.Zero, default));
        Assert.Equal(1, calls);
    }

    [Fact]
    public void Recipients_ExtrasOnlyForAutomaticReports_AndNeverTwice()
    {
        Assert.Equal(new long[] { 1, 2, 3 }, ReportDelivery.Recipients(1, automatic: true, true, 2, true, 3));
        Assert.Equal(new long[] { 1 }, ReportDelivery.Recipients(1, automatic: false, true, 2, true, 3));
        Assert.Equal(new long[] { 1 }, ReportDelivery.Recipients(1, automatic: true, true, 1, false, null)); // admin is the farmer
        Assert.Equal(new long[] { 3 }, ReportDelivery.Recipients(null, automatic: true, false, 2, true, 3));
    }

    /* ---- the daily brief ---------------------------------------------------- */

    [Fact]
    public void TheDailyBrief_IsOnePage()
    {
        var zones = new[] { Zone("Tub 1", Setup.Full, 1), Zone("Tub 2", Setup.Partial, 1), Zone("Veg Block", Setup.NoKit, 1) };
        var pdf = ActionReportPdf.Render(ReportKind.Schedule, "Green Farm", zones, Today, Today, Today, zones[0].GeneratedAtSast);
        Assert.Equal(1, Regex.Matches(Encoding.Latin1.GetString(pdf), @"/Type\s*/Page[^s]").Count);
    }
}
