using System.Text;
using System.Text.RegularExpressions;
using AgroFlow.Api.Reports;
using AgroFlow.Business.Agronomy;
using AgroFlow.Business.Agronomy.RuleBook;
using Xunit.Abstractions;

namespace AgroFlow.Domain.Tests;

// Item 3: every report is built around actions. Models come from real engine
// runs in memory (no database); the same fixtures write docs/sample-reports
// when AGROFLOW_WRITE_SAMPLES=1.
public class ActionReportTests
{
    private readonly ITestOutputHelper _out;
    public ActionReportTests(ITestOutputHelper output) { _out = output; }

    static ActionReportTests()
    {
        QuestPDF.Settings.License = QuestPDF.Infrastructure.LicenseType.Community;
    }

    internal static readonly DateOnly Today = new DateOnly(2026, 2, 10);
    private static readonly DateTime ReadingAt = DateTime.SpecifyKind(Today.ToDateTime(new TimeOnly(6, 0)), DateTimeKind.Utc);

    public enum Setup { Full, Partial, NoKit }

    // A zone as the builder would produce it, from a real engine run.
    internal static WaterUsageReportModel Zone(string name, Setup setup, int days, bool dry = true)
    {
        var input = new ZoneEngineInput
        {
            ZoneId = name.GetHashCode(), ZoneName = name, CropType = "tomato",
            PlantingDate = setup == Setup.Full ? Today.AddDays(-80) : null,
            SoilType = setup == Setup.NoKit ? null : "loam",
            AreaM2 = setup == Setup.Full ? 1.5 : null,
            FlowRateLpm = setup == Setup.NoKit ? null : 1.5,
            RootDepthLimitM = 0.3,
            CalibrationWet = setup == Setup.Full ? 1200 : null,
            CalibrationDry = setup == Setup.Full ? 3000 : null,
            MoistureThreshold = setup == Setup.Full ? 2000 : null,
            FarmLatitudeDegrees = -33.93, Today = Today, NowUtc = ReadingAt.AddHours(2),
        };
        for (var i = Math.Max(days, 10) - 1; i >= 0; i--)
        {
            input.Weather.Add(new ZoneWeatherDay { Date = Today.AddDays(-i), TMinC = 14, TMaxC = 28, RainMm = dry ? 0 : 6, RhMinPct = 40, RhMaxPct = 80, WindMs = 2.5, WindHeightM = 10 });
        }
        for (var i = 1; i <= 7; i++)
        {
            input.Weather.Add(new ZoneWeatherDay { Date = Today.AddDays(i), TMinC = 16, TMaxC = 30 + i, RainMm = i == 3 ? 8 : 0, RhMinPct = 30, RhMaxPct = 70, WindMs = 3, WindHeightM = 10, IsForecast = true });
        }
        if (setup != Setup.NoKit) input.Readings.Add(new ZoneMoistureReading { RecordedAtUtc = ReadingAt, RawValue = dry ? 2700 : 1400 });

        var result = Fao56Engine.Run(input);
        var insights = ZoneInsightBuilder.Build(input, result, new ZoneFaultSignals());

        var from = Today.AddDays(-(days - 1));
        var dayLines = Enumerable.Range(0, days).Select(i =>
        {
            var d = from.AddDays(i);
            return new WaterUsageReportModel.DayLine(d, 1, 2,
                input.FlowRateLpm is { } f ? 2 * f : null,
                setup == Setup.Full ? 3.5 : null,
                setup == Setup.Full ? 70 : null,
                27, setup == Setup.NoKit ? null : 29,
                55, setup == Setup.NoKit ? null : 60,
                dry ? 0 : 6, "");
        }).ToList();

        return new WaterUsageReportModel
        {
            FarmName = "Green Farm", ZoneName = name, CropLabel = "Tomato",
            From = from, To = Today,
            GeneratedAtSast = new DateTimeOffset(Today.ToDateTime(new TimeOnly(9, 49)), TimeSpan.FromHours(2)),
            FlowRateLpm = input.FlowRateLpm,
            Days = dayLines,
            MoistureSeries = setup == Setup.Full
                ? Enumerable.Range(0, 50).Select(i => new ChartSvg.MoisturePoint(i / 49.0, 65 + (i % 10))).ToList()
                : new List<ChartSvg.MoisturePoint>(),
            PumpPositions = Array.Empty<double>(),
            Advice = insights.Take(4).Select(i => new WaterUsageReportModel.AdviceLine(i.Message, i.Source, i.Explanation)).ToList(),
            Insights = insights,
            EngineInput = input,
            Engine = result,
            Calibrated = setup == Setup.Full,
        };
    }

    private static ActionReportContent Compose(int days, params WaterUsageReportModel[] zones) =>
        ActionReport.Compose(ReportKind.WaterUsage, "Green Farm", zones, Today.AddDays(-(days - 1)), Today, Today);

    private static readonly Regex Jargon = new(@"\b(ETc|ETo|ET0|Eq\.|Tmin|Tmax|Kc|Ks|RAW|TAW|FAO-56|moisture_threshold|evapotranspiration|depletion)\b|\d{4}-\d{2}-\d{2}|T\d{2}:\d{2}");

    public static IEnumerable<object[]> Scenarios()
    {
        foreach (var setup in Enum.GetValues<Setup>())
            foreach (var days in new[] { 7, 14, 30 })
                yield return new object[] { setup, days };
    }

    /* ---- 1. This week, do this ---------------------------------------- */

    [Fact]
    public void PageOne_OpensWithActions_EachWithWhenHowMuchConfidenceAndWhy()
    {
        var c = Compose(7, Zone("Tub 1", Setup.Full, 7));

        Assert.InRange(c.Actions.Count, 1, ActionReport.MaxActions);
        var water = c.Actions[0];
        _out.WriteLine(water.Lead + water.Detail);
        Assert.Contains("today (Tue 10 Feb)", water.Lead);
        Assert.Matches(@"about \d+(\.\d+)? minutes \(about \d+ L\)", water.Detail);
        Assert.NotNull(water.Why);
        Assert.All(c.Actions, a => Assert.NotNull(a.Why));
    }

    [Fact]
    public void NeverMoreThanFiveActions_EvenForABusyFarm()
    {
        var zones = Enumerable.Range(1, 6).Select(i => Zone($"Tub {i}", Setup.Full, 7)).ToArray();
        Assert.Equal(ActionReport.MaxActions, Compose(7, zones).Actions.Count);
    }

    [Fact]
    public void RainToday_IsASkipWithTheRainInIt()
    {
        var z = Zone("Tub 1", Setup.Full, 7);
        var today = z.EngineInput!.Weather.First(w => w.Date == Today);
        today.RainMm = 25;
        today.IsForecast = true;
        z.EngineInput.InitialDepletionMm = 35;
        var rerun = Fao56Engine.Run(z.EngineInput);
        var model = new WaterUsageReportModel
        {
            FarmName = z.FarmName, ZoneName = z.ZoneName, CropLabel = z.CropLabel, From = z.From, To = z.To,
            GeneratedAtSast = z.GeneratedAtSast, FlowRateLpm = z.FlowRateLpm, Days = z.Days,
            MoistureSeries = z.MoistureSeries, PumpPositions = z.PumpPositions, Advice = z.Advice,
            Insights = ZoneInsightBuilder.Build(z.EngineInput, rerun, new ZoneFaultSignals()),
            EngineInput = z.EngineInput, Engine = rerun, Calibrated = true,
        };

        var skip = Compose(7, model).Actions.First();
        Assert.StartsWith("Skip watering Tub 1 today", skip.Lead);
        Assert.Contains("25 mm of rain", skip.Detail);
    }

    [Fact]
    public void Overwatering_SaysByHowMuch_AndWhatToShortenTo()
    {
        var z = Zone("Tub 1", Setup.Full, 7, dry: false); // 3 L given/day vs 3.5 L... make it a lot more:
        var heavy = new WaterUsageReportModel
        {
            FarmName = z.FarmName, ZoneName = z.ZoneName, CropLabel = z.CropLabel, From = z.From, To = z.To,
            GeneratedAtSast = z.GeneratedAtSast, FlowRateLpm = 1.5,
            Days = z.Days.Select(d => d with { PumpRuns = 1, PumpMinutes = 4, Litres = 6, NeedLitres = 3 }).ToList(),
            MoistureSeries = z.MoistureSeries, PumpPositions = z.PumpPositions, Advice = z.Advice,
            Insights = z.Insights, EngineInput = z.EngineInput, Engine = z.Engine, Calibrated = true,
        };

        var action = Compose(7, heavy).Actions.Single(a => a.Lead.Contains("times what it needed"));
        Assert.Contains("Your tomato in Tub 1 got about 2 times what it needed this week", action.Lead);
        Assert.Contains("Shorten each watering to about 2 minutes", action.Detail);
        Assert.Same(heavy.VerdictWhy, action.Why);
    }

    /* ---- the period's own words ---------------------------------------- */

    [Theory]
    [InlineData(7, "this week")]
    [InlineData(14, "in the last 14 days")]
    [InlineData(30, "in the last 30 days")]
    public void ThePeriod_IsDescribedByItsRealLength(int days, string words)
    {
        var c = Compose(days, Zone("Tub 1", Setup.Full, days));
        Assert.Equal(words, c.PeriodWords);
        if (days != 7)
        {
            Assert.DoesNotContain(c.FarmerText(), t => t.Contains("this week", StringComparison.OrdinalIgnoreCase)
                && !t.StartsWith("This week, do this", StringComparison.Ordinal));
        }
    }

    [Fact]
    public void APastPeriod_IsNamedByItsDates_NeverThisWeek()
    {
        Assert.Equal("between Mon 2 Feb and Sun 8 Feb", ReportPeriod.Words(new DateOnly(2026, 2, 2), new DateOnly(2026, 2, 8), new DateOnly(2026, 3, 1)));
        Assert.Equal("on Mon 2 Feb", ReportPeriod.Words(new DateOnly(2026, 2, 2), new DateOnly(2026, 2, 2), Today));
    }

    [Theory]
    [InlineData(7, false)]
    [InlineData(14, false)]
    [InlineData(15, true)]
    [InlineData(30, true)]
    public void OverTwoWeeks_ChartsGoWeekly(int days, bool weekly)
    {
        Assert.Equal(weekly, ReportPeriod.Weekly(Today.AddDays(-(days - 1)), Today));
        if (weekly) Assert.Equal((days + 6) / 7, ReportPeriod.Weeks(Today.AddDays(-(days - 1)), Today).Count);
    }

    /* ---- weather at the plants ---------------------------------------- */

    [Fact]
    public void NoTubData_TheWeatherSectionIsOneSentence()
    {
        var c = Compose(7, Zone("Tub 1", Setup.NoKit, 7));
        Assert.Empty(c.WeatherRows);
        Assert.Equal("The local field sensors sent no readings in this period, so only the area forecast was used.", c.WeatherLine);
    }

    [Fact]
    public void WithTubData_OnlyTheDaysItReportedAreShown()
    {
        var z = Zone("Tub 1", Setup.Full, 7);
        var gappy = z.Days.Select((d, i) => i % 2 == 0 ? d : d with { LocalMaxC = null, LocalHumidity = null }).ToList();
        var model = new WaterUsageReportModel
        {
            FarmName = z.FarmName, ZoneName = z.ZoneName, From = z.From, To = z.To, GeneratedAtSast = z.GeneratedAtSast,
            Days = gappy, MoistureSeries = z.MoistureSeries, PumpPositions = z.PumpPositions, Advice = z.Advice,
            Insights = z.Insights, EngineInput = z.EngineInput, Engine = z.Engine,
        };
        Assert.Equal(4, Compose(7, model).WeatherRows.Count);
    }

    /* ---- plain words everywhere outside the appendix ------------------- */

    [Theory]
    [MemberData(nameof(Scenarios))]
    public void FarmerText_HasNoJargonAndNoIsoDates(Setup setup, int days)
    {
        foreach (var c in new[] { Compose(days, Zone("Tub 1", setup, days)), Compose(days, Zone("Tub 1", setup, days), Zone("Tub 2", setup, days)) })
        {
            foreach (var text in c.FarmerText().Where(t => !string.IsNullOrEmpty(t)))
            {
                var m = Jargon.Match(text);
                Assert.False(m.Success, $"{setup}/{days}d: \"{m.Value}\" in \"{text}\"");
            }
        }
    }

    [Theory]
    [MemberData(nameof(Scenarios))]
    public void NoSentenceIsRepeatedAcrossZones(Setup setup, int days)
    {
        var c = Compose(days, Zone("Tub 1", setup, days), Zone("Tub 2", setup, days), Zone("Tub 3", setup, days));
        var sentences = c.Actions.Select(a => a.Lead + a.Detail).Concat(c.ImproveSteps).ToList();
        Assert.Equal(sentences.Count, sentences.Distinct().Count());

        // The same setup step for three zones is one line naming all three.
        Assert.True(c.ImproveSteps.Count <= 1 || setup == Setup.Full);
        if (c.ImproveSteps.Count > 0) Assert.Contains("Tub 1, Tub 2 and Tub 3", c.ImproveSteps[0]);
    }

    [Fact]
    public void NotesEveryZoneShares_ArePrintedOnceAtFarmLevel()
    {
        var c = Compose(7, Zone("Tub 1", Setup.Partial, 7), Zone("Tub 2", Setup.Partial, 7));
        Assert.NotEmpty(c.SharedNotes);
        Assert.All(c.SharedNotes, n => Assert.Contains(n, c.Appendix[0].Notes));
    }

    [Fact]
    public void TheSoilChart_IsDrawnOnlyWhenCalibrated_AndSaysWhyNot()
    {
        Assert.StartsWith("Yes", ActionReport.SoilAnswer(Zone("Tub 1", Setup.Full, 7), "this week").Answer);
        Assert.Contains("wet/dry setup has not been done", ActionReport.SoilAnswer(Zone("Tub 1", Setup.Partial, 7), "this week").Answer);
    }

    [Fact]
    public void TheForecast_IsDayCards_WithAnActionEach()
    {
        var c = Compose(7, Zone("Tub 1", Setup.Full, 7));
        Assert.Equal(7, c.Forecast.Count);
        Assert.Equal("Wed 11 Feb", c.Forecast[0].Day);
        Assert.All(c.Forecast, f => Assert.False(string.IsNullOrWhiteSpace(f.Action)));
    }

    [Fact]
    public void APastPeriod_HasNoForecast_AndSaysSo()
    {
        var c = ActionReport.Compose(ReportKind.WaterUsage, "Green Farm", new[] { Zone("Tub 1", Setup.Full, 7) },
            Today.AddDays(-20), Today.AddDays(-14), Today);
        Assert.Empty(c.Forecast);
        Assert.Equal("This report covers a past period, so it has no forecast.", c.ForecastLine);
    }

    /* ---- length ---------------------------------------------------------- */

    private static int Pages(byte[] pdf) => Regex.Matches(Encoding.Latin1.GetString(pdf), @"/Type\s*/Page[^s]").Count;

    [Theory]
    [InlineData(Setup.Full)]
    [InlineData(Setup.Partial)]
    [InlineData(Setup.NoKit)]
    public void OneZone_FitsTwoPagesPlusTheAppendix_AndEachExtraZoneAddsAboutAPage(Setup setup)
    {
        var one = Zone("Tub 1", setup, 7);
        var single = ActionReportPdf.Render(ReportKind.WaterUsage, "Green Farm", new[] { one }, one.From, one.To, Today, one.GeneratedAtSast);
        var three = ActionReportPdf.Render(ReportKind.WaterUsage, "Green Farm",
            new[] { one, Zone("Tub 2", setup, 7), Zone("Tub 3", setup, 7) }, one.From, one.To, Today, one.GeneratedAtSast);

        _out.WriteLine($"{setup}: one zone {Pages(single)} pages, three zones {Pages(three)} pages");

        // Two farmer pages + an appendix of one or two pages.
        Assert.InRange(Pages(single), 2, 4);
        // About a page per extra zone (charts) plus its appendix rows.
        Assert.InRange(Pages(three) - Pages(single), 1, 5);
    }
}
