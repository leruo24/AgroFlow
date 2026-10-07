using System.Globalization;
using AgroFlow.Api.Reports;

namespace AgroFlow.Domain.Tests;

// Renders the designed water usage report end to end and asserts the bytes
// are a PDF.
//
// WHY THIS IS WORTH A TEST RATHER THAN A ONE-OFF CHECK
// The report is built from SVG strings handed to QuestPDF. A malformed SVG
// does not throw - Skia renders a blank box and the document still "succeeds",
// so a broken chart ships looking like a layout choice. This exercises the
// whole path with data shaped like a real week, including the cases that
// actually break it: a day with no reading, a day with no estimate, and a
// zone name containing an ampersand.
//
// It writes nothing to a database and needs no connection: the model is
// constructed directly, which is the reason WaterUsageReportModel is a plain
// object with no data access on it.
public class DesignedReportRenderSmokeTests
{
    // The same tier Program.cs declares at startup. QuestPDF refuses to
    // render a single page without it, and the test host never runs
    // Program.cs - so without this the tests fail on licensing rather than on
    // anything about the report.
    static DesignedReportRenderSmokeTests()
    {
        QuestPDF.Settings.License = QuestPDF.Infrastructure.LicenseType.Community;
    }

    private static WaterUsageReportModel SampleWeek(
        bool withFlowRate = true, bool withGaps = false)
    {
        var from = new DateOnly(2026, 9, 28);

        var runs = new[] { 2, 1, 2, 2, 1, 2, 2 };
        var minutes = new[] { 1.5, 0.5, 1.5, 1.5, 1.0, 1.5, 1.5 };
        var need = new double?[] { 1.5, 1.6, 1.3, 1.8, 1.4, 1.7, 1.7 };
        var moisture = new double?[] { 78, 74, 81, 66, 72, 70, 73 };
        var areaC = new double?[] { 24, 26, 22, 27, 25, 28, 27 };
        var localC = new double?[] { 26.0, 28.2, 23.8, 29.3, 27.0, 30.4, 29.0 };
        var areaRh = new double?[] { 55, 50, 62, 48, 52, 45, 47 };
        var localRh = new double?[] { 63, 58, 69, 57, 60, 53, 55 };
        var rain = new double?[] { 0, 0, 3.2, 0, 0, 0, 0 };

        var days = new List<WaterUsageReportModel.DayLine>();

        for (var i = 0; i < 7; i++)
        {
            // A real week has holes in it. The sensor drops out, the weather
            // row has not been backfilled yet. Those days must render as a
            // dash and a gap, not as zero.
            var gap = withGaps && i == 3;

            days.Add(new WaterUsageReportModel.DayLine(
                from.AddDays(i),
                runs[i],
                minutes[i],
                withFlowRate ? Math.Round(minutes[i] * 1.5, 2) : null,
                gap ? null : need[i],
                gap ? null : moisture[i],
                gap ? null : areaC[i],
                gap ? null : localC[i],
                gap ? null : areaRh[i],
                gap ? null : localRh[i],
                rain[i],
                "Watering about right"));
        }

        var series = new List<ChartSvg.MoisturePoint>();
        var rng = new Random(7);
        var level = 95.0;

        for (var i = 0; i < 160; i++)
        {
            level -= rng.NextDouble() * 3.2;
            if (level < 61) level = 100;
            series.Add(new ChartSvg.MoisturePoint(i / 159.0, level));
        }

        return new WaterUsageReportModel
        {
            // The ampersand is the point: SVG does not parse raw & inside
            // text, and QuestPDF renders the failure as an empty box rather
            // than throwing, so it would ship silently.
            FarmName = "Rustenburg Orchards & Sons",
            ZoneName = "Tub 1",
            CropLabel = "Tomato",
            From = from,
            To = from.AddDays(6),
            GeneratedAtSast = new DateTimeOffset(2026, 10, 5, 7, 0, 0, TimeSpan.FromHours(2)),
            FlowRateLpm = withFlowRate ? 1.5 : null,
            Days = days,
            MoistureSeries = series,
            PumpPositions = new[] { 0.12, 0.28, 0.44, 0.58, 0.73, 0.88 },
            Advice = new[]
            {
                new WaterUsageReportModel.AdviceLine(
                    "Water about 2 minutes on Thursday (about 3 L). The soil will reach the watering point then.",
                    "FAO-56 water balance + weather app forecast"),
                new WaterUsageReportModel.AdviceLine(
                    "Hot days ahead on Friday and Saturday: expect your tomatoes to need more water than usual.",
                    "weather app forecast"),
                new WaterUsageReportModel.AdviceLine(
                    "Peak growth: don't let the soil dry out now. Shortages at this stage cost the most yield.",
                    "FAO-56 growth stages for tomato"),
            },
            GrowthStage = "Peak growth, day 72 of 145",
            NextWatering = new DateOnly(2026, 10, 8),
            NextWateringMinutes = 2,
            NextWateringLitres = 3,
        };
    }

    private static bool IsPdf(byte[] bytes)
    {
        return bytes.Length > 1000
            && bytes[0] == '%' && bytes[1] == 'P' && bytes[2] == 'D' && bytes[3] == 'F';
    }

    [Fact]
    public void AnOrdinaryWeek_Renders()
    {
        Assert.True(IsPdf(DesignedWaterUsagePdf.Render(SampleWeek())));
    }

    [Fact]
    public void AZoneWithNoFlowRate_StillRenders()
    {
        // The whole report has to survive this: it is the single most common
        // real state for a newly installed kit, and every litre figure on
        // every page is null in it.
        Assert.True(IsPdf(DesignedWaterUsagePdf.Render(SampleWeek(withFlowRate: false))));
    }

    [Fact]
    public void AWeekWithMissingDays_StillRenders()
    {
        Assert.True(IsPdf(DesignedWaterUsagePdf.Render(SampleWeek(withGaps: true))));
    }

    [Fact]
    public void AnEmptyWeek_StillRenders()
    {
        // No events, no readings, no weather, no advice. A farmer whose kit
        // was offline all week still gets a report that says so, rather than
        // a 500.
        var model = new WaterUsageReportModel
        {
            FarmName = "Quiet Farm",
            ZoneName = "Zone 1",
            CropLabel = null,
            From = new DateOnly(2026, 9, 28),
            To = new DateOnly(2026, 10, 4),
            GeneratedAtSast = DateTimeOffset.UtcNow,
            FlowRateLpm = null,
            Days = Enumerable.Range(0, 7).Select(i =>
                new WaterUsageReportModel.DayLine(
                    new DateOnly(2026, 9, 28).AddDays(i),
                    0, 0, null, null, null, null, null, null, null, null,
                    "Pump did not run")).ToList(),
            MoistureSeries = Array.Empty<ChartSvg.MoisturePoint>(),
            PumpPositions = Array.Empty<double>(),
            Advice = Array.Empty<WaterUsageReportModel.AdviceLine>(),
        };

        Assert.True(IsPdf(DesignedWaterUsagePdf.Render(model)));
    }

    [Fact]
    public void TotalsAgreeWithTheDaysTheyAddUp()
    {
        // The PDF and the workbook both print these, and the one thing that
        // must never happen is the two disagreeing - which is why they are
        // computed on the model rather than in either renderer.
        var m = SampleWeek();

        Assert.Equal(12, m.TotalRuns);
        Assert.Equal(9.0, m.TotalMinutes, 3);
        Assert.Equal(13.5, m.TotalLitres!.Value, 3);
        Assert.Equal(3.2, m.TotalRainMm, 3);
    }

    [Fact]
    public void ANoFlowRateZone_HasNoLitresTotalAtAll()
    {
        // Null, not zero. Migration 0018: a zone whose flow rate nobody has
        // entered must yield "no estimate", because a zero reads as a pump
        // that ran and delivered nothing.
        Assert.Null(SampleWeek(withFlowRate: false).TotalLitres);
    }

    [Fact]
    public void ChartsUseInvariantNumbers_WhateverTheHostCultureIs()
    {
        // A decimal comma inside an SVG coordinate truncates the shape, and
        // Skia renders the damage as a blank box rather than throwing. This
        // forces the culture that would cause it.
        var original = CultureInfo.CurrentCulture;
        try
        {
            CultureInfo.CurrentCulture = new CultureInfo("af-ZA");

            var svg = ChartSvg.DailyBars(
                new[] { "Mon 28" }, new double?[] { 2.25 }, "Litres (estimated)");

            Assert.Contains("2.25", svg);
            Assert.DoesNotContain("2,25", svg);
        }
        finally
        {
            CultureInfo.CurrentCulture = original;
        }
    }

    [Fact]
    public void ChartTextIsEscaped_SoAnAmpersandCannotVoidTheMarkup()
    {
        var svg = ChartSvg.DailyBars(
            new[] { "Smith & Son" }, new double?[] { 1 }, "Litres & more");

        Assert.Contains("Smith &amp; Son", svg);
        Assert.DoesNotContain("Smith & Son", svg);
    }
}
