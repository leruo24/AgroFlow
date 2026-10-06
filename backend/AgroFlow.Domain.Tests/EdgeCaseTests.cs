using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using System.Xml.Linq;
using AgroFlow.Api.Reports;
using AgroFlow.Business;
using AgroFlow.Business.Agronomy;
using AgroFlow.Business.Agronomy.RuleBook;
using Xunit;

namespace AgroFlow.Domain.Tests;

// Part 2 adversarial sweep: data edges, time and locale.
public class EdgeCaseTests
{
    private static readonly DateOnly Today = new(2026, 2, 10);
    private static readonly DateTime Morning = DateTime.SpecifyKind(Today.ToDateTime(new TimeOnly(5, 0)), DateTimeKind.Utc);

    private static ZoneEngineInput Zone(Action<ZoneEngineInput>? change = null)
    {
        var input = new ZoneEngineInput
        {
            ZoneId = 1, ZoneName = "Tub 1", CropType = "maize", PlantingDate = Today.AddDays(-60), SoilType = "loam",
            AreaM2 = 1.5, FlowRateLpm = 1.5, CalibrationWet = 1200, CalibrationDry = 3000,
            FarmLatitudeDegrees = -33.93, Today = Today, NowUtc = Morning.AddHours(2),
        };
        for (var i = 9; i >= 0; i--)
            input.Weather.Add(new ZoneWeatherDay { Date = Today.AddDays(-i), TMinC = 14, TMaxC = 28, RainMm = 0, RhMinPct = 40, RhMaxPct = 80, WindMs = 2.5, WindHeightM = 10 });
        change?.Invoke(input);
        return input;
    }

    private static string RepoRoot()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir != null && !Directory.Exists(Path.Combine(dir.FullName, "apps"))) dir = dir.Parent;
        return dir!.FullName;
    }

    private static List<string> ValuesIn(string file, string marker)
    {
        var text = File.ReadAllText(Path.Combine(RepoRoot(), file));
        var block = text[text.IndexOf(marker, StringComparison.Ordinal)..];
        block = block[block.IndexOf("= [", StringComparison.Ordinal)..];
        block = block[..Regex.Match(block, @"?
\]").Index];       // the list's own closing line
        return Regex.Matches(block, @"value:\s*['""]([a-z_]+)['""]").Select(m => m.Groups[1].Value).ToList();
    }

    // ---- crops -------------------------------------------------------------

    [Fact]
    public void Every_crop_list_is_the_same_and_the_engine_knows_every_one()
    {
        var admin = ValuesIn("apps/web/admin/src/data/referenceData.ts", "export const ZONE_CROPS");
        var mobile = ValuesIn("apps/mobile/src/lib/setupHelpers.ts", "export const ZONE_CROPS");
        Assert.Equal(8, admin.Count);
        Assert.Equal(admin, mobile);
        Assert.Equal(admin, EnquiryRules.Crops.Where(c => c != "other"));
        foreach (var c in admin) Assert.NotNull(Fao56EngineReference.TryResolveCrop(c));
    }

    [Theory]
    [InlineData("Maize")]
    [InlineData("  maize  ")]
    [InlineData("MAIZE")]
    [InlineData("mielies")]
    [InlineData("potatoes")]
    [InlineData("Dry beans")]
    [InlineData("dry_beans")]
    [InlineData("Leafy vegetables")]
    public void Crop_names_resolve_however_they_are_typed(string typed)
    {
        Assert.NotNull(Fao56EngineReference.TryResolveCrop(typed));
    }

    [Theory]
    [InlineData("dragonfruit")]
    [InlineData("")]
    [InlineData(null)]
    public void An_unknown_crop_gets_a_setup_message_never_silence(string? crop)
    {
        var input = Zone(i => i.CropType = crop);
        var result = Fao56Engine.Run(input);
        var action = TodayRules.For(result, ZoneInsightBuilder.Build(input, result, new ZoneFaultSignals()));
        Assert.Equal("setup", action.Kind);
        Assert.StartsWith("Finish setup:", action.Text);
        Assert.Equal("crop", result.NextStep!.Field);
    }

    // ---- planting dates ------------------------------------------------------

    [Theory]
    [InlineData(5)]      // planted in the future (a typo)
    [InlineData(0)]      // planted today
    [InlineData(-1)]
    [InlineData(-400)]   // well past the end of any season
    public void Any_planting_date_gives_advice_without_crashing(int daysFromToday)
    {
        var input = Zone(i => i.PlantingDate = Today.AddDays(daysFromToday));
        var result = Fao56Engine.Run(input);
        Assert.True(result.BalanceRan);
        Assert.NotEmpty(ZoneInsightBuilder.Build(input, result, new ZoneFaultSignals()));
    }

    // ---- readings ------------------------------------------------------------

    [Theory]
    [InlineData(0.0)]
    [InlineData(4095.0)]
    [InlineData(double.NaN)]
    [InlineData(double.PositiveInfinity)]
    [InlineData(-5.0)]
    [InlineData(5000.0)]
    public void Sensor_values_at_and_past_the_limits_never_crash(double raw)
    {
        var input = Zone(i => i.Readings.Add(new ZoneMoistureReading { RecordedAtUtc = Morning, RawValue = raw }));
        var result = Fao56Engine.Run(input);
        Assert.True(result.BalanceRan);
        if (double.IsNaN(raw) || double.IsInfinity(raw) || raw < 0 || raw > 4095) Assert.Null(result.LatestReadingAtUtc);
    }

    [Fact]
    public void A_hundred_thousand_readings_take_well_under_two_seconds()
    {
        var input = Zone(i =>
        {
            for (var k = 0; k < 100_000; k++)
                i.Readings.Add(new ZoneMoistureReading { RecordedAtUtc = Morning.AddSeconds(-30 * k), RawValue = 1500 + k % 400 });
        });
        var watch = Stopwatch.StartNew();
        var result = Fao56Engine.Run(input);
        watch.Stop();
        Assert.True(result.BalanceRan);
        Assert.True(watch.Elapsed < TimeSpan.FromSeconds(2), $"took {watch.Elapsed.TotalMilliseconds} ms");
    }

    // ---- time: SAST midnight -------------------------------------------------

    [Fact]
    public void A_soil_check_at_23_59_SAST_counts_for_that_day_and_00_01_for_the_next()
    {
        var yesterday = Today.AddDays(-1);
        var late = DateTime.SpecifyKind(yesterday.ToDateTime(new TimeOnly(21, 59)), DateTimeKind.Utc);  // 23:59 SAST
        var early = late.AddMinutes(2);                                                                    // 00:01 SAST today

        var lateRun = Fao56Engine.Run(Zone(i => i.SoilFeelChecks.Add(new ZoneSoilFeelCheck { CheckedAtUtc = late, Feel = "wet" })));
        Assert.Equal(0.0, lateRun.Days.Single(d => d.Day == yesterday).DrEndMm);

        var earlyRun = Fao56Engine.Run(Zone(i => i.SoilFeelChecks.Add(new ZoneSoilFeelCheck { CheckedAtUtc = early, Feel = "wet" })));
        Assert.NotEqual(0.0, earlyRun.Days.Single(d => d.Day == yesterday).DrEndMm);
        Assert.Equal(0.0, earlyRun.Days.Single(d => d.Day == Today).DrEndMm);
    }

    [Fact]
    public void A_report_period_spanning_a_month_and_a_year_end_counts_each_day_once()
    {
        var rows = new List<EnquiryFact>
        {
            new(1, new DateTimeOffset(2026, 12, 31, 23, 59, 0, TimeSpan.FromHours(2)), "Gauteng", "new", null, null, null, null, null, null, null, 0, null),
            new(2, new DateTimeOffset(2027, 1, 1, 0, 1, 0, TimeSpan.FromHours(2)), "Gauteng", "new", null, null, null, null, null, null, null, 0, null),
        };
        var now = new DateTimeOffset(2027, 1, 2, 10, 0, 0, TimeSpan.FromHours(2));
        Assert.Equal(1, EnquiryReport.Compose(rows, new List<EnquiryCallFact>(), new DateOnly(2026, 12, 1), new DateOnly(2026, 12, 31), now, null, null, null).Received);
        Assert.Equal(1, EnquiryReport.Compose(rows, new List<EnquiryCallFact>(), new DateOnly(2027, 1, 1), new DateOnly(2027, 1, 31), now, null, null, null).Received);
        Assert.Equal(2, EnquiryReport.Compose(rows, new List<EnquiryCallFact>(), new DateOnly(2026, 12, 15), new DateOnly(2027, 1, 1), now, null, null, null).Received);
    }

    // ---- locale: af-ZA / en-ZA write decimal commas ---------------------------

    [Theory]
    [InlineData("af-ZA")]
    [InlineData("en-ZA")]
    public void Numbers_in_charts_workbooks_and_advice_never_take_the_machine_s_decimal_comma(string culture)
    {
        var before = CultureInfo.CurrentCulture;
        var beforeUi = CultureInfo.CurrentUICulture;
        try
        {
            CultureInfo.CurrentCulture = CultureInfo.CurrentUICulture = new CultureInfo(culture);
            Assert.Equal(",", CultureInfo.CurrentCulture.NumberFormat.NumberDecimalSeparator);  // the trap is real here

            var svg = ChartSvg.DailyBars(new[] { "Mon", "Tue" }, new double?[] { 1.5, 2.25 }, "mm");
            foreach (var attr in XDocument.Parse(svg).Descendants().SelectMany(e => e.Attributes())
                         .Where(a => a.Name.LocalName is "x" or "y" or "width" or "height"))
                Assert.True(double.TryParse(attr.Value, NumberStyles.Float, CultureInfo.InvariantCulture, out _), $"{attr.Name}={attr.Value}");

            var rec = RecommendationRules.For("potato", "loam", null, 5.0, "the last 30 days", 0.2, 1.5, null, "Mafikeng", Today)!;
            Assert.Contains("0.2 m²", rec.Text);
            Assert.DoesNotContain("0,2", rec.Text);

            var result = Fao56Engine.Run(Zone(i => { i.FlowRateLpm = null; i.AreaM2 = null; i.Readings.Add(new ZoneMoistureReading { RecordedAtUtc = Morning, RawValue = 2950 }); }));
            var today = TodayRules.For(result, ZoneInsightBuilder.Build(Zone(), result, new ZoneFaultSignals()));
            Assert.DoesNotMatch(@"\d,\d", today.Text);

            var xlsx = EnquiryReportPdf.Workbook(EnquiryReport.Compose(
                new List<EnquiryFact> { new(1, new DateTimeOffset(2026, 2, 1, 9, 0, 0, TimeSpan.FromHours(2)), "Gauteng", "won", "wants", null, null, null, null,
                    new DateTimeOffset(2026, 2, 1, 11, 30, 0, TimeSpan.FromHours(2)), null, 0, Guid.NewGuid()) },
                new List<EnquiryCallFact>(), new DateOnly(2026, 1, 15), Today, new DateTimeOffset(2026, 2, 10, 10, 0, 0, TimeSpan.FromHours(2)), null, null, null));
            using var zip = new System.IO.Compression.ZipArchive(new MemoryStream(xlsx));
            var sheet = XDocument.Load(zip.GetEntry("xl/worksheets/sheet1.xml")!.Open());
            foreach (var v in sheet.Descendants().Where(e => e.Name.LocalName == "v"))
                Assert.True(double.TryParse(v.Value, NumberStyles.Float, CultureInfo.InvariantCulture, out _), $"cell value {v.Value}");
        }
        finally
        {
            CultureInfo.CurrentCulture = before;
            CultureInfo.CurrentUICulture = beforeUi;
        }
    }
}
