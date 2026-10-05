using System.IO.Compression;
using System.Xml.Linq;
using AgroFlow.Api.Reports;

namespace AgroFlow.Domain.Tests;

// "All zones" (item 3): the farm report and its workbook.
//
// The case that matters most here is a farm where ONE zone has no data. That
// is the normal state of a real farm - a kit not installed yet, a flow rate
// nobody has entered - and it must not take the other zones' figures down
// with it, or void the farm total, or crash the render.
public class FarmWaterUsageReportTests
{
    private const string Ns = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}";

    static FarmWaterUsageReportTests()
    {
        QuestPDF.Settings.License = QuestPDF.Infrastructure.LicenseType.Community;
    }

    private static WaterUsageReportModel Zone(string name, bool withData)
    {
        var from = new DateOnly(2026, 9, 28);

        var days = Enumerable.Range(0, 7).Select(i =>
            new WaterUsageReportModel.DayLine(
                from.AddDays(i),
                withData ? 2 : 0,
                withData ? 1.5 : 0,
                withData ? 2.25 : null,
                withData ? 1.5 : null,
                withData ? 78 : null,
                24, 26.0, 55, 63, 0,
                withData ? "Watering about right" : "Pump did not run")).ToList();

        return new WaterUsageReportModel
        {
            FarmName = "Rustenburg Orchards",
            ZoneName = name,
            CropLabel = withData ? "Tomato" : null,
            From = from,
            To = from.AddDays(6),
            GeneratedAtSast = new DateTimeOffset(2026, 10, 5, 7, 0, 0, TimeSpan.FromHours(2)),
            FlowRateLpm = withData ? 1.5 : null,
            Days = days,
            MoistureSeries = withData
                ? Enumerable.Range(0, 50)
                    .Select(i => new ChartSvg.MoisturePoint(i / 49.0, 60 + (i % 40)))
                    .ToList()
                : Array.Empty<ChartSvg.MoisturePoint>(),
            PumpPositions = withData ? new[] { 0.2, 0.5, 0.8 } : Array.Empty<double>(),
            Advice = withData
                ? new[] { new WaterUsageReportModel.AdviceLine("Water on Thursday.", "FAO-56 water balance") }
                : Array.Empty<WaterUsageReportModel.AdviceLine>(),
            GrowthStage = withData ? "Peak growth, day 72 of 145" : null,
            NextWatering = withData ? new DateOnly(2026, 10, 8) : null,
        };
    }

    private static FarmWaterUsageReport Farm(params WaterUsageReportModel[] zones) =>
        new()
        {
            FarmName = "Rustenburg Orchards & Sons",
            From = new DateOnly(2026, 9, 28),
            To = new DateOnly(2026, 10, 4),
            GeneratedAtSast = new DateTimeOffset(2026, 10, 5, 7, 0, 0, TimeSpan.FromHours(2)),
            Zones = zones,
        };

    private static bool IsPdf(byte[] bytes) =>
        bytes.Length > 1000 && bytes[0] == '%' && bytes[1] == 'P' && bytes[2] == 'D' && bytes[3] == 'F';

    /* ---- the PDF ---------------------------------------------------- */

    [Fact]
    public void AFarmWithSeveralZones_Renders()
    {
        var pdf = DesignedFarmWaterUsagePdf.Render(
            Farm(Zone("Tub 1", true), Zone("Tub 2", true), Zone("Tub 3", true)));

        Assert.True(IsPdf(pdf));
    }

    [Fact]
    public void AFarmWhereOneZoneHasNoData_StillRenders()
    {
        // The normal state of a real farm. It must not crash, and it must not
        // void the other zones.
        var pdf = DesignedFarmWaterUsagePdf.Render(
            Farm(Zone("Tub 1", true), Zone("Tub 2", false)));

        Assert.True(IsPdf(pdf));
    }

    [Fact]
    public void AFarmWithNoZonesAtAll_StillRenders()
    {
        Assert.True(IsPdf(DesignedFarmWaterUsagePdf.Render(Farm())));
    }

    /* ---- the totals -------------------------------------------------- */

    [Fact]
    public void OneZoneWithoutAFlowRate_DoesNotVoidTheFarmTotal()
    {
        var farm = Farm(Zone("Tub 1", true), Zone("Tub 2", false));

        // 7 days x 1.5 min x 1.5 L/min = 15.75 L from the one zone we can
        // estimate. The other contributes nothing rather than nulling it.
        Assert.NotNull(farm.TotalLitres);
        Assert.Equal(15.75, farm.TotalLitres!.Value, 2);
    }

    [Fact]
    public void TheZonesItCouldNotEstimate_AreNamedRatherThanSilentlyDropped()
    {
        var farm = Farm(Zone("Tub 1", true), Zone("Tub 2", false));

        Assert.Equal(new[] { "Tub 2" }, farm.ZonesWithoutEstimate);
    }

    [Fact]
    public void AFarmWhereNoZoneCanBeEstimated_HasNoTotalAtAll()
    {
        // Null, not zero - the same rule as a single zone. Migration 0018.
        Assert.Null(Farm(Zone("Tub 1", false), Zone("Tub 2", false)).TotalLitres);
    }

    [Fact]
    public void FarmRunsAndMinutes_AreTheSumOfItsZones()
    {
        var farm = Farm(Zone("Tub 1", true), Zone("Tub 2", true));

        Assert.Equal(28, farm.TotalRuns);        // 2 x 7 x 2
        Assert.Equal(21.0, farm.TotalMinutes, 2); // 1.5 x 7 x 2
    }

    /* ---- the workbook ------------------------------------------------ */

    [Fact]
    public void TheWorkbookHasASheetPerZone_PlusSummaryAndWeather()
    {
        var bytes = FarmWaterUsageWorkbook.Render(
            Farm(Zone("Tub 1", true), Zone("Tub 2", true)));

        using var zip = new ZipArchive(new MemoryStream(bytes), ZipArchiveMode.Read);
        using var stream = zip.GetEntry("xl/workbook.xml")!.Open();

        var names = XDocument.Load(stream)
            .Descendants(Ns + "sheet")
            .Select(e => e.Attribute("name")!.Value)
            .ToList();

        Assert.Equal(4, names.Count);
        Assert.Equal("Summary", names[0]);
        Assert.Contains("Daily - Tub 1", names);
        Assert.Contains("Daily - Tub 2", names);
        Assert.Equal("Weather comparison", names[^1]);
    }

    [Fact]
    public void TheLitresColumnIsAFormula_PointingAtTheFlowRateOnSummary()
    {
        // The reason the workbook is worth more than a PDF: a farmer who
        // measures their pump at 1.3 L/min instead of the 1.5 on file changes
        // one cell and the whole workbook follows.
        var bytes = FarmWaterUsageWorkbook.Render(Farm(Zone("Tub 1", true)));

        using var zip = new ZipArchive(new MemoryStream(bytes), ZipArchiveMode.Read);
        using var stream = zip.GetEntry("xl/worksheets/sheet2.xml")!.Open();

        var formulas = XDocument.Load(stream)
            .Descendants(Ns + "f")
            .Select(f => f.Value)
            .ToList();

        Assert.Contains(formulas, f => f.Contains("Summary!$E$", StringComparison.Ordinal));
        Assert.Contains(formulas, f => f.StartsWith("SUM(", StringComparison.Ordinal));
    }

    [Fact]
    public void AZoneWithNoDataStillGetsASheet_AndItOpens()
    {
        // Rendering must not depend on a zone having anything in it.
        var bytes = FarmWaterUsageWorkbook.Render(
            Farm(Zone("Tub 1", true), Zone("Tub 2", false)));

        using var zip = new ZipArchive(new MemoryStream(bytes), ZipArchiveMode.Read);

        foreach (var entry in zip.Entries.Where(e => e.FullName.EndsWith(".xml", StringComparison.Ordinal)))
        {
            using var stream = entry.Open();
            Assert.Null(Record.Exception(() => XDocument.Load(stream)));
        }
    }

    [Fact]
    public void AFarmWithNoZones_StillProducesAnOpenableWorkbook()
    {
        var bytes = FarmWaterUsageWorkbook.Render(Farm());

        using var zip = new ZipArchive(new MemoryStream(bytes), ZipArchiveMode.Read);
        using var stream = zip.GetEntry("xl/workbook.xml")!.Open();

        var names = XDocument.Load(stream)
            .Descendants(Ns + "sheet")
            .Select(e => e.Attribute("name")!.Value)
            .ToList();

        // Summary and Weather, with nothing between them.
        Assert.Equal(new[] { "Summary", "Weather comparison" }, names);
    }
}
