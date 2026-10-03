using AgroFlow.Business;

namespace AgroFlow.Domain.Tests;

// Step 4 / step 7: "The schedule fires once per period (no duplicates);
// disabled schedules never fire."
//
// The service wakes every hour. Getting this wrong in one direction sends a
// farmer the same PDF every hour until somebody notices; in the other it
// silently sends nothing for a month and nobody notices at all. Neither is
// visible from the calling code, which is why the rule is a named policy
// with its own tests.
//
// All times are Africa/Johannesburg (UTC+2, no daylight saving).
public class ReportSchedulePolicyTests
{
    private static DateTimeOffset Sast(int year, int month, int day, int hour, int minute = 0) =>
        new(year, month, day, hour, minute, 0, TimeSpan.FromHours(2));

    // 2026-10-05 is a Monday; 2026-10-06 a Tuesday; 2026-11-01 a Sunday.
    private static readonly DateTimeOffset MondayAt7 = Sast(2026, 10, 5, 7);

    // ---- Disabled ----------------------------------------------------------

    [Fact]
    public void ADisabledScheduleNeverFires_EvenAtExactlyTheRightMoment()
    {
        Assert.False(ReportSchedulePolicy.IsDue(
            enabled: false, ReportFrequency.Weekly, lastRunAt: null, MondayAt7));
    }

    // ---- Weekly ------------------------------------------------------------

    [Fact]
    public void AWeeklyScheduleFiresOnMondayAtSeven()
    {
        Assert.True(ReportSchedulePolicy.IsDue(
            true, ReportFrequency.Weekly, lastRunAt: null, MondayAt7));
    }

    [Fact]
    public void ItDoesNotFireBeforeSeven()
    {
        Assert.False(ReportSchedulePolicy.IsDue(
            true, ReportFrequency.Weekly, null, Sast(2026, 10, 5, 6, 59)));
    }

    // Still fires later the same day. A container that was down at 07:00 -
    // a deploy, a crash - must still send the report when it comes back,
    // rather than skipping the week in silence.
    [Theory]
    [InlineData(8)]
    [InlineData(14)]
    [InlineData(23)]
    public void ItStillFiresLaterTheSameDayIfTheServerWasDownAtSeven(int hour)
    {
        Assert.True(ReportSchedulePolicy.IsDue(
            true, ReportFrequency.Weekly, null, Sast(2026, 10, 5, hour)));
    }

    [Fact]
    public void AWeeklyScheduleDoesNotFireOnOtherDays()
    {
        for (var day = 6; day <= 11; day++) // Tue 6 Oct .. Sun 11 Oct
        {
            Assert.False(
                ReportSchedulePolicy.IsDue(true, ReportFrequency.Weekly, null, Sast(2026, 10, day, 9)),
                $"Weekly schedule fired on 2026-10-{day:00}, which is not a Monday.");
        }
    }

    // ---- THE DUPLICATE RULE ------------------------------------------------

    [Fact]
    public void ItDoesNotFireTwiceInOneDay_TheHourlyCheckMustNotResend()
    {
        var alreadyRan = Sast(2026, 10, 5, 7, 5);

        Assert.False(ReportSchedulePolicy.IsDue(
            true, ReportFrequency.Weekly, alreadyRan, Sast(2026, 10, 5, 8, 5)));
    }

    // The whole rest of the day, not just the next hour.
    [Fact]
    public void HavingRunThisMorning_ItStaysDoneAllDay()
    {
        var alreadyRan = Sast(2026, 10, 5, 7, 5);

        Assert.False(ReportSchedulePolicy.IsDue(
            true, ReportFrequency.Weekly, alreadyRan, Sast(2026, 10, 5, 23, 59)));
    }

    [Fact]
    public void TheFollowingMonday_ItFiresAgain()
    {
        var lastWeek = Sast(2026, 10, 5, 7, 5);

        Assert.True(ReportSchedulePolicy.IsDue(
            true, ReportFrequency.Weekly, lastWeek, Sast(2026, 10, 12, 7)));
    }

    // A run recorded in UTC must be compared as a SAST calendar date. A run at
    // 23:30 UTC on Sunday is 01:30 SAST on Monday - the same Monday the next
    // check looks at - and comparing raw instants would let it resend.
    [Fact]
    public void TheDayComparisonUsesSastNotUtc()
    {
        var ranJustAfterMidnightSast = new DateTimeOffset(2026, 10, 4, 23, 30, 0, TimeSpan.Zero);

        Assert.False(ReportSchedulePolicy.IsDue(
            true, ReportFrequency.Weekly, ranJustAfterMidnightSast, Sast(2026, 10, 5, 7)));
    }

    // ---- Monthly -----------------------------------------------------------

    [Fact]
    public void AMonthlyScheduleFiresOnTheFirst()
    {
        Assert.True(ReportSchedulePolicy.IsDue(
            true, ReportFrequency.Monthly, null, Sast(2026, 11, 1, 7)));
    }

    [Theory]
    [InlineData(2)]
    [InlineData(15)]
    [InlineData(28)]
    public void AMonthlyScheduleDoesNotFireOnOtherDays(int day)
    {
        Assert.False(ReportSchedulePolicy.IsDue(
            true, ReportFrequency.Monthly, null, Sast(2026, 11, day, 9)));
    }

    // A weekly schedule and a monthly one are genuinely different: the 1st of
    // a month is usually not a Monday, and a Monday is usually not the 1st.
    [Fact]
    public void WeeklyAndMonthlyDoNotFireOnEachOthersDays()
    {
        // 2026-11-01 is a Sunday.
        Assert.True(ReportSchedulePolicy.IsDue(true, ReportFrequency.Monthly, null, Sast(2026, 11, 1, 8)));
        Assert.False(ReportSchedulePolicy.IsDue(true, ReportFrequency.Weekly, null, Sast(2026, 11, 1, 8)));
    }

    // ---- The period reported on -------------------------------------------
    //
    // Always CLOSED and in the past. A "week" report sent on Monday morning
    // covering the seven hours since midnight would be worse than useless,
    // and the period is also the key the duplicate check uses, so it has to
    // be stable for the whole run.

    [Fact]
    public void AWeeklyRunCoversTheWeekThatJustFinished()
    {
        var (start, end) = ReportSchedulePolicy.PeriodFor(ReportFrequency.Weekly, MondayAt7);

        Assert.Equal(new DateOnly(2026, 9, 28), start); // the previous Monday
        Assert.Equal(new DateOnly(2026, 10, 4), end);   // the Sunday before today
        Assert.Equal(7, end.DayNumber - start.DayNumber + 1);
    }

    [Fact]
    public void AWeeklyPeriodNeverIncludesToday()
    {
        var (_, end) = ReportSchedulePolicy.PeriodFor(ReportFrequency.Weekly, MondayAt7);

        Assert.True(end < DateOnly.FromDateTime(MondayAt7.DateTime));
    }

    [Fact]
    public void AMonthlyRunCoversTheWholeOfLastMonth()
    {
        var (start, end) = ReportSchedulePolicy.PeriodFor(
            ReportFrequency.Monthly, Sast(2026, 11, 1, 7));

        Assert.Equal(new DateOnly(2026, 10, 1), start);
        Assert.Equal(new DateOnly(2026, 10, 31), end);
    }

    // January's "last month" is December of the previous year.
    [Fact]
    public void AMonthlyRunInJanuaryCoversLastDecember()
    {
        var (start, end) = ReportSchedulePolicy.PeriodFor(
            ReportFrequency.Monthly, Sast(2027, 1, 1, 7));

        Assert.Equal(new DateOnly(2026, 12, 1), start);
        Assert.Equal(new DateOnly(2026, 12, 31), end);
    }

    [Fact]
    public void AMonthlyRunInMarchCoversFebruary_IncludingALeapDay()
    {
        var (start, end) = ReportSchedulePolicy.PeriodFor(
            ReportFrequency.Monthly, Sast(2028, 3, 1, 7));

        Assert.Equal(new DateOnly(2028, 2, 1), start);
        Assert.Equal(new DateOnly(2028, 2, 29), end); // 2028 is a leap year
    }

    // The same moment must always produce the same period, because it is the
    // duplicate check's key.
    [Fact]
    public void ThePeriodIsStableForAGivenMoment()
    {
        var a = ReportSchedulePolicy.PeriodFor(ReportFrequency.Weekly, Sast(2026, 10, 5, 7, 1));
        var b = ReportSchedulePolicy.PeriodFor(ReportFrequency.Weekly, Sast(2026, 10, 5, 23, 59));

        Assert.Equal(a, b);
    }

    // ---- Parsing and wording ----------------------------------------------

    [Theory]
    [InlineData("monthly", ReportFrequency.Monthly)]
    [InlineData("Monthly", ReportFrequency.Monthly)]
    [InlineData("weekly", ReportFrequency.Weekly)]
    [InlineData("", ReportFrequency.Weekly)]
    [InlineData(null, ReportFrequency.Weekly)]
    [InlineData("nonsense", ReportFrequency.Weekly)]
    public void FrequencyParsingDefaultsToWeekly(string? value, ReportFrequency expected)
    {
        Assert.Equal(expected, ReportSchedulePolicy.ParseFrequency(value));
    }

    [Fact]
    public void TheFarmerSeesWhatTheyAreSignedUpFor()
    {
        Assert.Equal(
            "Automatic reports: Weekly (Water usage, Soil moisture)",
            ReportSchedulePolicy.Describe(
                true, ReportFrequency.Weekly, new[] { "water_usage", "moisture" }));
    }

    [Fact]
    public void AnOffScheduleSaysSo()
    {
        Assert.Equal(
            "Automatic reports: off",
            ReportSchedulePolicy.Describe(false, ReportFrequency.Weekly, new[] { "water_usage" }));
    }

    // An enabled schedule with nothing chosen reads as off, because that is
    // what it is. The database refuses to store one (0035).
    [Fact]
    public void AnEnabledScheduleWithNoReportsReadsAsOff()
    {
        Assert.Equal(
            "Automatic reports: off",
            ReportSchedulePolicy.Describe(true, ReportFrequency.Weekly, Array.Empty<string>()));
    }

    [Fact]
    public void SevenInTheMorningIsTheSendHour()
    {
        Assert.Equal(7, ReportSchedulePolicy.SendHourSast);
    }
}

// The three report kinds, and which of them can run for a whole farm.
public class ReportKindsTests
{
    [Theory]
    [InlineData("water_usage")]
    [InlineData("moisture")]
    [InlineData("schedule")]
    public void TheThreeKindsMatchTheCheckConstraint(string kind)
    {
        Assert.True(ReportKinds.IsValid(kind));
    }

    [Theory]
    [InlineData("rainfall")]
    [InlineData("")]
    [InlineData(null)]
    [InlineData("Water_Usage")]
    public void AnythingElseIsRejected(string? kind)
    {
        Assert.False(ReportKinds.IsValid(kind));
    }

    // Olwethu's moisture endpoint takes a zoneId and nothing else, so a
    // farm-wide soil moisture report genuinely cannot be produced. The form
    // has to respect that rather than offering a choice that gets refused.
    [Fact]
    public void OnlySoilMoistureNeedsAZone()
    {
        Assert.True(ReportKinds.RequiresZone(ReportKinds.Moisture));
        Assert.False(ReportKinds.RequiresZone(ReportKinds.WaterUsage));
        Assert.False(ReportKinds.RequiresZone(ReportKinds.Schedule));
    }

    // The schedule report projects forward from today and takes no range, so
    // offering a period picker for it would be a control that changes nothing.
    [Fact]
    public void TheScheduleReportTakesNoDateRange()
    {
        Assert.False(ReportKinds.UsesDateRange(ReportKinds.Schedule));
        Assert.True(ReportKinds.UsesDateRange(ReportKinds.WaterUsage));
        Assert.True(ReportKinds.UsesDateRange(ReportKinds.Moisture));
    }

    [Fact]
    public void TheNamesAreWhatTheFarmerSeesElsewhereInTheApp()
    {
        Assert.Equal("Water usage", ReportKinds.DisplayName("water_usage"));
        Assert.Equal("Soil moisture", ReportKinds.DisplayName("moisture"));
        Assert.Equal("Watering schedule & advice", ReportKinds.DisplayName("schedule"));
    }

    [Fact]
    public void AnUnknownKindStillRendersSomething()
    {
        Assert.Equal("Report", ReportKinds.DisplayName("nonsense"));
    }

    // Used in the Telegram caption and the list row, so a farmer can tell two
    // reports of the same type apart.
    [Fact]
    public void ASevenDayRangeReadsAsLastSevenDays()
    {
        Assert.Equal(
            "last 7 days",
            ReportPeriods.Describe(new DateOnly(2026, 9, 28), new DateOnly(2026, 10, 4)));
    }

    [Fact]
    public void AFullMonthReadsAsLastThirtyDays()
    {
        Assert.Equal(
            "last 30 days",
            ReportPeriods.Describe(new DateOnly(2026, 10, 1), new DateOnly(2026, 10, 31)));
    }

    [Fact]
    public void AnOddRangeIsSpelledOut()
    {
        Assert.Equal(
            "3 Sep to 19 Sep 2026",
            ReportPeriods.Describe(new DateOnly(2026, 9, 3), new DateOnly(2026, 9, 19)));
    }

    // The farmer never sees the real reason a report failed, because none of
    // them are things they can act on.
    [Fact]
    public void AFailedReportTellsTheFarmerSomethingTheyCanAct0n()
    {
        Assert.Equal(
            "This report couldn't be made. Try again later.",
            ReportRequestStatuses.FarmerFailureMessage);
    }
}
