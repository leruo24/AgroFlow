using System.Globalization;
using QuestPDF.Fluent;
using QuestPDF.Helpers;
using QuestPDF.Infrastructure;

namespace AgroFlow.Api.Reports;

// The "Enquiries & sales follow-up" PDF and workbook, on the same report shell
// as the farm reports (header, footer, headings, chart style).
internal static class EnquiryReportPdf
{
    private static readonly CultureInfo Inv = CultureInfo.InvariantCulture;

    public const string FooterNote =
        "Counts are for enquiries received in the period. Overdue call-backs and uncalled enquiries are as of when the report was made.";

    public static string HoursText(double? hours) => hours switch
    {
        null => "No calls yet",
        < 1 => "under an hour",
        < 48 => $"about {Math.Round(hours.Value).ToString("0", Inv)} hours",
        _ => $"about {Math.Round(hours.Value / 24, 1).ToString("0.#", Inv)} days",
    };

    public static byte[] Build(EnquiryReportContent c, DateTimeOffset generatedAtSast)
    {
        var generated = ReportShell.GeneratedLine(generatedAtSast);

        return Document.Create(doc => doc.Page(page =>
        {
            ReportShell.ApplyPageDefaults(page);
            page.Header().Element(h => ReportShell.Header(h, c.Title, c.Subtitle, generated));
            page.Footer().Element(f => ReportShell.Footer(f, FooterNote));
            page.Content().PaddingHorizontal(34).PaddingTop(16).Column(col =>
            {
                col.Spacing(4);

                ReportShell.Heading(col, "Do this next");
                var n = 0;
                foreach (var line in c.DoThisNext)
                {
                    n++;
                    col.Item().ShowEntire().PaddingBottom(5).Background(ReportTheme.Surface).Padding(8).Row(row =>
                    {
                        row.ConstantItem(22).AlignMiddle().Text(n.ToString(Inv)).FontSize(14).Bold().FontColor(ReportTheme.Brand);
                        row.RelativeItem().AlignMiddle().Text(line).FontSize(10);
                    });
                }

                ReportShell.Heading(col, "How it went");
                col.Item().Row(row =>
                {
                    Figure(row, c.Received.ToString(Inv), "enquiries received");
                    Figure(row, c.Called.ToString(Inv), "called");
                    Figure(row, c.BecameFarmers.ToString(Inv) +
                        (c.ConversionPercent is { } p ? $" ({p.ToString("0.#", Inv)}%)" : ""), "became farmers");
                    Figure(row, HoursText(c.AverageHoursToFirstCall), "average time to first call");
                    Figure(row, c.OverdueCallbacks.ToString(Inv), "call-backs overdue");
                });

                Bars(col, "Outcomes", c.Outcomes, "enquiries");

                // Each heading is kept on the page with its chart.
                col.Item().ShowEntire().Column(col =>
                {
                ReportShell.Heading(col, "Why people said no");
                if (c.Reasons.Count == 0)
                {
                    col.Item().Text("Nobody has said no in this period.").FontColor(ReportTheme.Muted);
                }
                else
                {
                    col.Item().Height(150).Svg(ChartSvg.DailyBars(
                        c.Reasons.Select(r => EnquiryReport.ReasonShort.FirstOrDefault(kv =>
                            AgroFlow.Business.EnquiryRules.Reasons[kv.Key] == r.Label).Value ?? r.Label).ToList(),
                        c.Reasons.Select(r => (double?)r.Value).ToList(), "people"));
                    col.Item().Text(string.Join(" · ", c.Reasons.Select(r => $"{r.Label}: {r.Value}"))).FontSize(8.5f);
                    if (c.OtherReasons.Count > 0)
                    {
                        col.Item().PaddingTop(4).Text("\"Other\", in their words:").FontSize(8.5f).SemiBold();
                        foreach (var o in c.OtherReasons) col.Item().Text("• " + o).FontSize(8.5f);
                    }
                }
                });

                Bars(col, "Enquiries by province", c.ByProvince, "enquiries");

                col.Item().ShowEntire().Column(col =>
                {
                ReportShell.Heading(col, "Time to first call, by week received");
                if (c.FirstCallByWeek.Count == 0)
                {
                    col.Item().Text("No enquiry in this period has been called yet.").FontColor(ReportTheme.Muted);
                }
                else
                {
                    col.Item().Height(150).Svg(ChartSvg.DailyBars(
                        c.FirstCallByWeek.Select(w => w.Week).ToList(), c.FirstCallByWeek.Select(w => w.Hours).ToList(), "hours"));
                    ReportShell.ChartNote(col, "Average hours from the enquiry arriving to its first call, for enquiries received that week.");
                }
                });

                Bars(col, "Calls handled per admin", c.CallsPerAdmin, "calls");
            });
        })).GeneratePdf();
    }

    private static void Figure(RowDescriptor row, string value, string label)
    {
        row.RelativeItem().Padding(3).Background(ReportTheme.Surface).Padding(8).Column(c =>
        {
            c.Item().Text(value).FontSize(13).Bold().FontColor(ReportTheme.Brand);
            c.Item().Text(label).FontSize(8).FontColor(ReportTheme.Muted);
        });
    }

    private static void Bars(ColumnDescriptor outer, string heading, List<Count> counts, string unit) =>
        outer.Item().ShowEntire().Column(col => BarsBlock(col, heading, counts, unit));

    private static void BarsBlock(ColumnDescriptor col, string heading, List<Count> counts, string unit)
    {
        ReportShell.Heading(col, heading);
        if (counts.Count == 0 || counts.All(x => x.Value == 0))
        {
            col.Item().Text("None in this period.").FontColor(ReportTheme.Muted);
            return;
        }
        col.Item().Height(150).Svg(ChartSvg.DailyBars(
            counts.Select(x => x.Label).ToList(), counts.Select(x => (double?)x.Value).ToList(), unit));
    }

    /* ---- The workbook: the same content, as tables ------------------- */

    public static byte[] Workbook(EnquiryReportContent c)
    {
        static XlsxWriter.Sheet Table(string name, string title, string a, string b, IEnumerable<(string, double?)> rows)
        {
            var s = new XlsxWriter.Sheet { Name = name, ColumnWidths = new[] { 34.0, 16.0 } };
            s.Add(XlsxWriter.Cell.Of(title, XlsxStyle.Title));
            s.AddBlank();
            s.Add(XlsxWriter.Cell.Of(a, XlsxStyle.TableHeader), XlsxWriter.Cell.Of(b, XlsxStyle.TableHeader));
            foreach (var (label, value) in rows)
                s.Add(XlsxWriter.Cell.Of(label), XlsxWriter.Cell.Maybe(value, XlsxStyle.Normal));
            return s;
        }

        var summary = new XlsxWriter.Sheet { Name = "Summary", ColumnWidths = new[] { 34.0, 60.0 } };
        summary.Add(XlsxWriter.Cell.Of(c.Title, XlsxStyle.Title));
        summary.Add(XlsxWriter.Cell.Of(c.Filters, XlsxStyle.Subtitle));
        summary.AddBlank();
        summary.Add(XlsxWriter.Cell.Of("Do this next", XlsxStyle.SectionHeader));
        foreach (var line in c.DoThisNext) summary.Add(XlsxWriter.Cell.Of("•"), XlsxWriter.Cell.Of(line));
        summary.AddBlank();
        summary.Add(XlsxWriter.Cell.Of("How it went", XlsxStyle.SectionHeader));
        summary.Add(XlsxWriter.Cell.Of("Enquiries received"), XlsxWriter.Cell.Of(c.Received));
        summary.Add(XlsxWriter.Cell.Of("Called"), XlsxWriter.Cell.Of(c.Called));
        summary.Add(XlsxWriter.Cell.Of("Became farmers"), XlsxWriter.Cell.Of(c.BecameFarmers));
        summary.Add(XlsxWriter.Cell.Of("Conversion rate (%)"), XlsxWriter.Cell.Maybe(c.ConversionPercent, XlsxStyle.OneDecimal));
        summary.Add(XlsxWriter.Cell.Of("Average hours to first call"), XlsxWriter.Cell.Maybe(c.AverageHoursToFirstCall, XlsxStyle.OneDecimal));
        summary.Add(XlsxWriter.Cell.Of("Call-backs overdue"), XlsxWriter.Cell.Of(c.OverdueCallbacks));
        summary.AddBlank();
        summary.Add(XlsxWriter.Cell.Of(FooterNote, XlsxStyle.Note));

        var reasons = Table("Why no", "Why people said no", "Reason", "People",
            c.Reasons.Select(r => (r.Label, (double?)r.Value)));
        if (c.OtherReasons.Count > 0)
        {
            reasons.AddBlank();
            reasons.Add(XlsxWriter.Cell.Of("\"Other\", in their words", XlsxStyle.SectionHeader));
            foreach (var o in c.OtherReasons) reasons.Add(XlsxWriter.Cell.Of(o));
        }

        return XlsxWriter.Build(new List<XlsxWriter.Sheet>
        {
            summary,
            Table("Outcomes", "Outcomes", "Outcome", "Enquiries", c.Outcomes.Select(o => (o.Label, (double?)o.Value))),
            reasons,
            Table("Provinces", "Enquiries by province", "Province", "Enquiries", c.ByProvince.Select(p => (p.Label, (double?)p.Value))),
            Table("First call", "Time to first call, by week received", "Week starting", "Average hours",
                c.FirstCallByWeek.Select(w => (w.Week, w.Hours))),
            Table("Calls per admin", "Calls handled per admin", "Admin", "Calls", c.CallsPerAdmin.Select(a => (a.Label, (double?)a.Value))),
        });
    }
}
