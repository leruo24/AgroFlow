using System.Globalization;
using System.IO.Compression;
using System.Xml.Linq;
using AgroFlow.Api.Reports;

namespace AgroFlow.Domain.Tests;

// The workbook half of the designed report.
//
// WHY THESE CHECKS AND NOT "IT DID NOT THROW"
// An .xlsx is a zip of XML written by hand here, and Excel's failure mode is
// all-or-nothing: one malformed part and it refuses to open the file at all,
// reporting "unreadable content" with no clue which part. So the tests take
// the file apart and check the things that actually break it - the parts are
// present, the XML parses, every sheet is declared and related, and numbers
// are written with a decimal point rather than whatever the host's culture
// would produce.
//
// The last one matters most. A decimal comma does not corrupt the file; it
// makes Excel read the cell as text, so the column still looks right and
// every total silently stops counting it.
public class WaterUsageWorkbookTests
{
    private const string Ns = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}";

    private static WaterUsageReportModel Sample(bool withFlowRate = true)
    {
        var from = new DateOnly(2026, 9, 28);

        var days = Enumerable.Range(0, 7).Select(i =>
            new WaterUsageReportModel.DayLine(
                from.AddDays(i),
                2, 1.5,
                withFlowRate ? 2.25 : null,
                1.5, 78, 24, 26.0, 55, 63, 0,
                "Watering about right")).ToList();

        return new WaterUsageReportModel
        {
            // Both of these are user input and both are hostile to the
            // format: the ampersand is invalid raw XML, and a forward slash
            // is illegal in an Excel sheet name.
            FarmName = "Smith & Son",
            ZoneName = "Tub 1 / North",
            CropLabel = "Tomato",
            From = from,
            To = from.AddDays(6),
            GeneratedAtSast = new DateTimeOffset(2026, 10, 5, 7, 0, 0, TimeSpan.FromHours(2)),
            FlowRateLpm = withFlowRate ? 1.5 : null,
            Days = days,
            MoistureSeries = Array.Empty<ChartSvg.MoisturePoint>(),
            PumpPositions = Array.Empty<double>(),
            Advice = Array.Empty<WaterUsageReportModel.AdviceLine>(),
        };
    }

    private static ZipArchive Open(byte[] bytes)
    {
        return new ZipArchive(new MemoryStream(bytes), ZipArchiveMode.Read);
    }

    private static XDocument Part(ZipArchive zip, string path)
    {
        var entry = zip.GetEntry(path);
        Assert.NotNull(entry);

        using var stream = entry!.Open();
        return XDocument.Load(stream);
    }

    [Fact]
    public void EveryRequiredPartIsPresent()
    {
        using var zip = Open(WaterUsageWorkbook.Render(Sample()));
        var names = zip.Entries.Select(e => e.FullName).ToHashSet();

        // Miss any one of these and Excel reports the whole file unreadable.
        Assert.Contains("[Content_Types].xml", names);
        Assert.Contains("_rels/.rels", names);
        Assert.Contains("xl/workbook.xml", names);
        Assert.Contains("xl/_rels/workbook.xml.rels", names);
        Assert.Contains("xl/styles.xml", names);
        Assert.Contains("xl/worksheets/sheet1.xml", names);
        Assert.Contains("xl/worksheets/sheet2.xml", names);
        Assert.Contains("xl/worksheets/sheet3.xml", names);
    }

    [Fact]
    public void EveryPartIsWellFormedXml()
    {
        using var zip = Open(WaterUsageWorkbook.Render(Sample()));

        foreach (var entry in zip.Entries.Where(e => e.FullName.EndsWith(".xml", StringComparison.Ordinal)
                                                  || e.FullName.EndsWith(".rels", StringComparison.Ordinal)))
        {
            using var stream = entry.Open();
            var exception = Record.Exception(() => XDocument.Load(stream));
            Assert.Null(exception);
        }
    }

    [Fact]
    public void TheThreeSheetsAreNamedAndRelated()
    {
        using var zip = Open(WaterUsageWorkbook.Render(Sample()));

        var sheets = Part(zip, "xl/workbook.xml")
            .Descendants(Ns + "sheet")
            .Select(e => (Name: e.Attribute("name")!.Value,
                          Id: e.Attributes().First(a => a.Name.LocalName == "id").Value))
            .ToList();

        Assert.Equal(3, sheets.Count);
        Assert.Equal("Summary", sheets[0].Name);
        Assert.Equal("Weather comparison", sheets[2].Name);

        // Every r:id the workbook names must exist in its rels part, or the
        // sheet opens blank.
        var rels = Part(zip, "xl/_rels/workbook.xml.rels")
            .Descendants()
            .Where(e => e.Name.LocalName == "Relationship")
            .Select(e => e.Attribute("Id")!.Value)
            .ToHashSet();

        foreach (var sheet in sheets) Assert.Contains(sheet.Id, rels);
    }

    [Fact]
    public void ASheetNameWithASlashIsMadeLegal()
    {
        // Excel rejects : \ / ? * [ ] in a sheet name and refuses to open the
        // file - and a zone name is whatever the farmer typed.
        using var zip = Open(WaterUsageWorkbook.Render(Sample()));

        var names = Part(zip, "xl/workbook.xml")
            .Descendants(Ns + "sheet")
            .Select(e => e.Attribute("name")!.Value);

        foreach (var name in names)
        {
            Assert.DoesNotContain('/', name);
            Assert.True(name.Length <= 31, $"'{name}' is longer than Excel allows");
        }
    }

    [Fact]
    public void AnAmpersandSurvivesAsText()
    {
        using var zip = Open(WaterUsageWorkbook.Render(Sample()));

        // XDocument parsing it at all proves the entity was escaped; this
        // then proves it was escaped rather than stripped.
        var text = string.Concat(
            Part(zip, "xl/worksheets/sheet1.xml").Descendants(Ns + "t").Select(t => t.Value));

        Assert.Contains("Smith & Son", text);
    }

    [Fact]
    public void NumbersAreWrittenWithADecimalPoint_WhateverTheHostCultureIs()
    {
        var original = CultureInfo.CurrentCulture;
        try
        {
            CultureInfo.CurrentCulture = new CultureInfo("af-ZA");

            using var zip = Open(WaterUsageWorkbook.Render(Sample()));

            var values = Part(zip, "xl/worksheets/sheet2.xml")
                .Descendants(Ns + "v")
                .Select(v => v.Value)
                .ToList();

            Assert.NotEmpty(values);

            // A comma here does not corrupt the file - Excel reads the cell
            // as text, the column still looks right, and every total quietly
            // stops counting it.
            Assert.DoesNotContain(values, v => v.Contains(','));
            Assert.Contains(values, v => v.Contains('.'));
        }
        finally
        {
            CultureInfo.CurrentCulture = original;
        }
    }

    [Fact]
    public void AZoneWithNoFlowRate_LeavesLitresEmptyRatherThanZero()
    {
        using var zip = Open(WaterUsageWorkbook.Render(Sample(withFlowRate: false)));

        var rows = Part(zip, "xl/worksheets/sheet2.xml").Descendants(Ns + "row").ToList();

        // Row 5 is the first day: Date, runs, minutes, litres, …
        var firstDay = rows.First(r => r.Attribute("r")!.Value == "5");
        var litres = firstDay.Elements(Ns + "c").First(c => c.Attribute("r")!.Value.StartsWith("D", StringComparison.Ordinal));

        // No <v> at all. An empty cell is what AVERAGE and SUM ignore; a 0
        // would be counted, and migration 0018 is explicit that a zone with
        // no flow rate yields no estimate rather than a zero.
        Assert.Empty(litres.Elements(Ns + "v"));
    }

    [Fact]
    public void TheWorkbookAndThePdfAgreeOnTheWeekTotal()
    {
        // The reason WaterUsageReportModel computes totals rather than either
        // renderer doing its own arithmetic.
        var model = Sample();

        using var zip = Open(WaterUsageWorkbook.Render(model));

        var summaryValues = Part(zip, "xl/worksheets/sheet1.xml")
            .Descendants(Ns + "v").Select(v => double.Parse(v.Value, CultureInfo.InvariantCulture)).ToList();

        Assert.Contains(model.TotalLitres!.Value, summaryValues);
        Assert.Contains((double)model.TotalRuns, summaryValues);
    }
}
