using System.IO.Compression;
using System.Text;
using System.Text.RegularExpressions;
using AgroFlow.Api.Reports;
using AgroFlow.Business.Agronomy.RuleBook;

namespace AgroFlow.Domain.Tests;

// Item 2c: "Why:" lines in the PDFs, the "Why we said this" appendix, and the
// workbook's Why column. Models are built in memory - no database.
public class ReportWhyTests
{
    static ReportWhyTests()
    {
        QuestPDF.Settings.License = QuestPDF.Infrastructure.LicenseType.Community;
    }

    private static readonly DateOnly From = new DateOnly(2026, 9, 28);

    private static WaterUsageReportModel Model(double litresPerDay, double? needPerDay, bool withWhy)
    {
        var days = Enumerable.Range(0, 7).Select(i => new WaterUsageReportModel.DayLine(
            From.AddDays(i), 1, 1.0, litresPerDay, needPerDay, 70, 25, 26, 50, 55, 0, "")).ToList();

        var why = withWhy
            ? new Explanation { Summary = "Your soil has dried to the point where tomato starts to struggle.", Rule = "A rule.", Confidence = "Medium: test." }
                .Fact("Crop", "Tomato", "this zone's setup")
            : null;

        return new WaterUsageReportModel
        {
            FarmName = "Green Farm",
            ZoneName = "Tub 1",
            CropLabel = "Tomato",
            From = From,
            To = From.AddDays(6),
            GeneratedAtSast = new DateTimeOffset(2026, 10, 5, 7, 0, 0, TimeSpan.FromHours(2)),
            FlowRateLpm = 1.5,
            Days = days,
            MoistureSeries = new List<ChartSvg.MoisturePoint>(),
            PumpPositions = Array.Empty<double>(),
            Advice = new[] { new WaterUsageReportModel.AdviceLine("Water Tub 1 now: about 2 min (~3 L).", "FAO-56 water balance", why) },
            GrowthStage = null,
            NextWatering = null,
            NextWateringMinutes = null,
            NextWateringLitres = null,
        };
    }

    private static int PageCount(byte[] pdf) =>
        Regex.Matches(Encoding.Latin1.GetString(pdf), @"/Type\s*/Page[^s]").Count;

    [Fact]
    public void ThePdf_EndsWithAnAppendixPage_WhetherOrNotThereIsMuchToExplain()
    {
        // Item 3: the farmer pages, then the technical appendix on its own
        // page - with "Why we said this" notes when there are any.
        var withWhy = DesignedWaterUsagePdf.Render(Model(2.0, 2.0, withWhy: true));
        var nothing = DesignedWaterUsagePdf.Render(Model(2.0, null, withWhy: false));

        Assert.True(PageCount(withWhy) >= 2);
        Assert.True(PageCount(nothing) >= 2);
    }

    [Fact]
    public void Notes_AreNumberedOncePerExplanation_HoweverOftenAPageIsComposed()
    {
        var why = new ReportWhy();
        var a = new Explanation { Summary = "A" };
        var b = new Explanation { Summary = "B" };
        why.Add(a); why.Add(b); why.Add(a); why.Add(null); why.Add(new Explanation { Summary = "" });

        Assert.Equal(new[] { a, b }, why.Notes);
    }

    [Fact]
    public void TwoZonesWithTheSameReason_ShareOneNote()
    {
        var why = new ReportWhy();
        var tub1 = new Explanation { Summary = "Your soil has dried to the point where tomato starts to struggle." };
        var tub2 = new Explanation { Summary = "Your soil has dried to the point where tomato starts to struggle." };
        why.Add(tub1); why.Add(tub2);

        Assert.Single(why.Notes);
        Assert.Same(tub1, why.Notes[0]);
    }

    [Theory]
    [InlineData(2.3, 2.0, WateringVerdict.AboutRight)]   // 1.15x: the old hidden 15% band called this a surplus
    [InlineData(2.4, 2.0, WateringVerdict.AboutRight)]   // exactly 1.2x
    [InlineData(2.5, 2.0, WateringVerdict.TooMuch)]
    [InlineData(1.5, 2.0, WateringVerdict.TooLittle)]
    public void TheReportVerdict_IsVerdictRules(double litres, double need, WateringVerdict expected)
    {
        var m = Model(litres, need, withWhy: false);
        Assert.Equal(expected, m.Verdict);
        Assert.Same(m.VerdictWhy, m.VerdictWhy); // cached: the line and the appendix are one object

        // The answer under "Did my crop get the water it needed?".
        var answer = ActionReport.NeedAnswer(m, "in the last 7 days").Answer;
        var expectedWords = expected switch
        {
            WateringVerdict.TooMuch => "more than it needed",
            WateringVerdict.TooLittle => "Not quite",
            _ => "Yes",
        };
        Assert.Contains(expectedWords, answer);
        Assert.Contains("in the last 7 days", answer);
    }

    [Fact]
    public void TheWorkbook_HasAWhyColumnBesideEachAdviceRow()
    {
        var bytes = WaterUsageWorkbook.Render(Model(2.0, 2.0, withWhy: true));
        using var zip = new ZipArchive(new MemoryStream(bytes));

        string Read(string name)
        {
            using var s = zip.GetEntry(name)!.Open();
            using var r = new StreamReader(s);
            return r.ReadToEnd();
        }

        // Inline strings or the shared-string table - either way the text is in the package.
        var text = string.Join("\n", zip.Entries.Where(e => e.FullName.EndsWith(".xml")).Select(e => Read(e.FullName)));
        Assert.Contains(">Why<", text);
        Assert.Contains("Your soil has dried to the point where tomato starts to struggle.", text);
        Assert.Contains("Water this period: About right", text);
    }
}
