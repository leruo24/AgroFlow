using System.Globalization;
using AgroFlow.Business.Agronomy.RuleBook;
using QuestPDF.Fluent;
using QuestPDF.Helpers;
using QuestPDF.Infrastructure;

namespace AgroFlow.Api.Reports;

// Lays out an ActionReportContent: the words come from ActionReport.Compose and
// this file only places them. Farmer pages first, then the technical appendix on
// its own page (the only place with FAO-56 symbols) and the numbered
// "Why we said this" notes.
internal static class ActionReportPdf
{
    private static readonly CultureInfo Inv = CultureInfo.InvariantCulture;

    public static byte[] Render(
        ReportKind kind, string farmName, IReadOnlyList<WaterUsageReportModel> zones,
        DateOnly from, DateOnly to, DateOnly today, DateTimeOffset generatedAtSast)
    {
        var content = ActionReport.Compose(kind, farmName, zones, from, to, today);
        return Render(content, zones, from, to, generatedAtSast);
    }

    public static byte[] Render(
        ActionReportContent content, IReadOnlyList<WaterUsageReportModel> zones,
        DateOnly from, DateOnly to, DateTimeOffset generatedAtSast)
    {
        // Notes are registered before rendering, in reading order, so their numbers
        // never change.
        var why = new ReportWhy();
        foreach (var a in content.Actions) why.Add(a.Why);
        foreach (var s in content.Summaries) why.Add(s.VerdictWhy);

        var generated = ReportShell.GeneratedLine(generatedAtSast);

        // A one-day report is the daily brief: one page of today's actions and setup
        // steps, with no charts, appendix or note numbers.
        if (ReportPeriod.Days(from, to) <= 1)
        {
            return Document.Create(doc => doc.Page(page =>
            {
                Shell(page, content, generated);
                page.Content().PaddingHorizontal(34).PaddingTop(16).Column(col =>
                {
                    col.Spacing(4);
                    Actions(col, content, why, heading: "Today, do this", numbered: false);
                    Improve(col, content);
                });
            })).GeneratePdf();
        }

        return Document.Create(doc =>
        {
            doc.Page(page =>
            {
                Shell(page, content, generated);
                page.Content().PaddingHorizontal(34).PaddingTop(16).Column(col =>
                {
                    col.Spacing(4);
                    Actions(col, content, why);
                    HowItWent(col, content, why);
                    for (var i = 0; i < zones.Count; i++)
                    {
                        // All zones: each zone's charts start on a new page.
                        if (zones.Count > 1) col.Item().PageBreak();
                        Questions(col, zones[i], content.ZoneAnswers[i], from, to, zones.Count > 1);
                    }
                    Forecast(col, content);
                    Weather(col, content);
                    Improve(col, content);
                });
            });

            doc.Page(page =>
            {
                Shell(page, content, generated);
                page.Content().PaddingHorizontal(34).PaddingTop(16).Column(col =>
                {
                    col.Spacing(4);
                    Appendix(col, content);
                    why.Appendix(col);
                });
            });
        }).GeneratePdf();
    }

    private static void Shell(PageDescriptor page, ActionReportContent content, string generated)
    {
        ReportShell.ApplyPageDefaults(page);
        page.Header().Element(c => ReportShell.Header(c, content.Title, content.Subtitle, generated));
        page.Footer().Element(c => ReportShell.Footer(c, DesignedWaterUsagePdf.EstimateNote));
    }

    /* ---- 1. This week, do this -------------------------------------- */

    private static void Actions(ColumnDescriptor col, ActionReportContent content, ReportWhy why,
        string heading = "This week, do this", bool numbered = true)
    {
        ReportShell.Heading(col, heading);

        if (content.Actions.Count == 0)
        {
            col.Item().Background(ReportTheme.Surface).Padding(12).Text(content.NoActionsLine).FontSize(9.5f);
            return;
        }

        // Decided before layout: a reason already given reads "the same reason as above".
        var seen = new HashSet<string>(StringComparer.Ordinal);
        var plainWhy = content.Actions
            .Select(x => x.Why is { } w ? (seen.Add(w.Summary) ? w.Summary : "the same reason as above.") : null)
            .ToList();

        var n = 0;
        foreach (var a in content.Actions)
        {
            n++;
            var index = n - 1;
            col.Item().ShowEntire().PaddingBottom(5).Background(ReportTheme.Surface).Padding(8).Row(row =>
            {
                row.ConstantItem(22).AlignMiddle().Text(n.ToString(Inv)).FontSize(14).Bold().FontColor(ReportTheme.Brand);
                row.RelativeItem().Column(c =>
                {
                    c.Item().Text(t =>
                    {
                        t.Span(a.Lead).Bold().FontSize(10);
                        t.Span(a.Detail).FontSize(10);
                    });
                    c.Item().PaddingTop(3).Element(e => Badge(e, a.Confidence));
                    if (numbered) why.Line(c, a.Why);
                    else if (plainWhy[index] is { } text)
                        c.Item().PaddingTop(2).Text("Why: " + text).FontSize(7.5f).FontColor(ReportTheme.Muted);
                });
            });
        }
    }

    private static void Badge(IContainer container, ConfidenceLevel level)
    {
        var (label, colour) = level switch
        {
            ConfidenceLevel.High => ("High confidence", ReportTheme.Brand),
            ConfidenceLevel.Medium => ("Medium confidence", ReportTheme.Teal),
            _ => ("Low confidence", ReportTheme.Warn),
        };
        container.AlignLeft().Border(0.8f).BorderColor(colour).PaddingHorizontal(5).PaddingVertical(1)
            .Text(label).FontSize(7).Bold().FontColor(colour);
    }

    /* ---- 2. How your farm did --------------------------------------- */

    private static void HowItWent(ColumnDescriptor col, ActionReportContent content, ReportWhy why)
    {
        ReportShell.Heading(col, $"How your farm did {content.PeriodWords}");

        col.Item().Table(table =>
        {
            table.ColumnsDefinition(c =>
            {
                c.RelativeColumn(1.6f); c.RelativeColumn(1.3f); c.RelativeColumn(1.3f);
                c.RelativeColumn(1.6f); c.RelativeColumn(0.8f); c.RelativeColumn(0.9f);
            });
            table.Header(h =>
            {
                ReportShell.HeadCell(h, "Zone");
                ReportShell.HeadCell(h, "Water given");
                ReportShell.HeadCell(h, "Water needed");
                ReportShell.HeadCell(h, "Verdict");
                ReportShell.HeadCell(h, "Pump runs");
                ReportShell.HeadCell(h, "Rain");
            });
            foreach (var s in content.Summaries)
            {
                ReportShell.BodyCell(table, string.IsNullOrWhiteSpace(s.Crop) ? s.Zone : $"{s.Zone} ({s.Crop})", ReportShell.Stripe);
                ReportShell.BodyCell(table, s.Given, ReportShell.Stripe);
                ReportShell.BodyCell(table, s.Needed, ReportShell.Stripe);
                ReportShell.BodyCell(table, s.Verdict, ReportShell.Stripe);
                ReportShell.BodyCell(table, s.PumpRuns.ToString(Inv), ReportShell.Stripe);
                ReportShell.BodyCell(table, s.Rain, ReportShell.Stripe);
            }
        });

        foreach (var s in content.Summaries) why.Line(col, s.VerdictWhy);
    }

    /* ---- 3. The three questions, per zone ---------------------------- */

    private static void Questions(ColumnDescriptor col, WaterUsageReportModel z,
        (ChartAnswer Need, ChartAnswer Soil) answers, DateOnly from, DateOnly to, bool withZoneHeading)
    {
        if (withZoneHeading) ReportShell.ZoneHeading(col, z.ZoneName, z.CropLabel);

        var need = answers.Need;
        col.Item().ShowEntire().Column(c =>
        {
            ReportShell.Heading(c, need.Question);
            if (z.TotalNeedLitres is not null || z.TotalLitres is not null)
            {
                List<string> labels; List<double?> needed; List<double?> given;
                if (ReportPeriod.Weekly(from, to))
                {
                    var weeks = ReportPeriod.Weeks(from, to);
                    labels = weeks.Select(w => w.Label).ToList();
                    needed = weeks.Select(w => Sum(z.Days.Where(d => d.Date >= w.Start && d.Date <= w.End).Select(d => d.NeedLitres))).ToList();
                    given = weeks.Select(w => Sum(z.Days.Where(d => d.Date >= w.Start && d.Date <= w.End).Select(d => d.Litres))).ToList();
                }
                else
                {
                    labels = z.Days.Select(d => d.ShortLabel).ToList();
                    needed = z.Days.Select(d => d.NeedLitres).ToList();
                    given = z.Days.Select(d => d.Litres).ToList();
                }

                c.Item().Height(160).Svg(ChartSvg.PairedBars(labels, needed, given,
                    "Needed", "Given", ReportPeriod.Weekly(from, to) ? "Litres per week" : "Litres per day"));
            }
            ReportShell.ChartNote(c, need.Answer);
        });

        var soil = answers.Soil;
        col.Item().ShowEntire().Column(c =>
        {
            ReportShell.Heading(c, soil.Question);
            if (z.Calibrated && z.MoistureSeries.Count > 0)
            {
                var dayLabels = ReportPeriod.Weekly(from, to)
                    ? ReportPeriod.Weeks(from, to).Select(w => w.Label).ToList()
                    : z.Days.Select(d => d.ShortLabel).ToList();
                c.Item().Height(160).Svg(ChartSvg.MoistureLine(z.MoistureSeries, z.PumpPositions, dayLabels,
                    z.HealthyLowPercent, z.HealthyHighPercent, "Soil moisture"));
            }
            ReportShell.ChartNote(c, soil.Answer);
        });
    }

    private static double? Sum(IEnumerable<double?> values)
    {
        var present = values.Where(v => v.HasValue).Select(v => v!.Value).ToList();
        return present.Count == 0 ? null : Math.Round(present.Sum(), 1);
    }

    /* ---- What's coming this week? (farm-wide) ------------------------- */

    private static void Forecast(ColumnDescriptor col, ActionReportContent content)
    {
        col.Item().ShowEntire().Column(c =>
        {
            ReportShell.Heading(c, "What's coming this week?");
            if (content.Forecast.Count == 0)
            {
                ReportShell.ChartNote(c, content.ForecastLine);
                return;
            }

            c.Item().Row(row =>
            {
                row.Spacing(4);
                foreach (var card in content.Forecast)
                {
                    row.RelativeItem().Background(ReportTheme.Surface).Padding(5).Column(cc =>
                    {
                        cc.Item().Text(card.Day).FontSize(7.5f).Bold();
                        cc.Item().Text(card.MaxTemp).FontSize(9);
                        cc.Item().Text("Rain " + card.Rain).FontSize(7.5f).FontColor(ReportTheme.Muted);
                        cc.Item().PaddingTop(2).Text(card.Action).FontSize(7.5f).FontColor(ReportTheme.Brand);
                    });
                }
            });
        });
    }

    /* ---- 4. Area weather vs at your plants ---------------------------- */

    private static void Weather(ColumnDescriptor col, ActionReportContent content)
    {
        ReportShell.Heading(col, "Area weather vs at your plants");
        if (content.WeatherRows.Count == 0)
        {
            ReportShell.ChartNote(col, content.WeatherLine);
            return;
        }

        col.Item().Table(table =>
        {
            table.ColumnsDefinition(c => { c.RelativeColumn(1.2f); for (var i = 0; i < 4; i++) c.RelativeColumn(); });
            table.Header(h =>
            {
                ReportShell.HeadCell(h, "Day");
                ReportShell.HeadCell(h, "Area high");
                ReportShell.HeadCell(h, "At the plants");
                ReportShell.HeadCell(h, "Area humidity");
                ReportShell.HeadCell(h, "At the plants");
            });
            foreach (var w in content.WeatherRows)
            {
                ReportShell.BodyCell(table, w.Day, ReportShell.Stripe);
                ReportShell.BodyCell(table, w.AreaMax, ReportShell.Stripe);
                ReportShell.BodyCell(table, w.LocalMax, ReportShell.Stripe);
                ReportShell.BodyCell(table, w.AreaHumidity, ReportShell.Stripe);
                ReportShell.BodyCell(table, w.LocalHumidity, ReportShell.Stripe);
            }
        });
        ReportShell.ChartNote(col, content.WeatherLine);
    }

    /* ---- 5. Improve your advice --------------------------------------- */

    private static void Improve(ColumnDescriptor col, ActionReportContent content)
    {
        if (content.ImproveSteps.Count == 0) return;

        col.Item().ShowEntire().Column(c =>
        {
            ReportShell.Heading(c, "Improve your advice");
            foreach (var step in content.ImproveSteps)
            {
                c.Item().PaddingBottom(3).Text("- " + step).FontSize(9);
            }
        });
    }

    /* ---- 6. Technical appendix ---------------------------------------- */

    private static void Appendix(ColumnDescriptor col, ActionReportContent content)
    {
        ReportShell.Heading(col, "Technical appendix");
        col.Item().Text("For extension officers and markers. Figures and sources behind the advice; FAO-56 is Allen et al. (1998), page numbers as printed.")
            .FontSize(8).Italic().FontColor(ReportTheme.Muted);

        foreach (var z in content.Appendix)
        {
            col.Item().PaddingTop(6).Text(z.Zone).FontSize(10).Bold();
            col.Item().Table(table =>
            {
                table.ColumnsDefinition(c => { c.RelativeColumn(1.4f); c.RelativeColumn(1.2f); c.RelativeColumn(3f); });
                table.Header(h =>
                {
                    ReportShell.HeadCell(h, "Figure");
                    ReportShell.HeadCell(h, "Value");
                    ReportShell.HeadCell(h, "Source");
                });
                foreach (var f in z.Facts)
                {
                    ReportShell.BodyCell(table, f.Label, ReportShell.Stripe);
                    ReportShell.BodyCell(table, f.Value, ReportShell.Stripe);
                    ReportShell.BodyCell(table, f.Source, ReportShell.Stripe);
                }
            });

            var own = z.Notes.Where(n => !content.SharedNotes.Contains(n)).ToList();
            foreach (var note in own) col.Item().Text("- " + note).FontSize(7.8f);
        }

        if (content.SharedNotes.Count > 0)
        {
            col.Item().PaddingTop(6).Text("Applies to every zone").FontSize(10).Bold();
            foreach (var note in content.SharedNotes) col.Item().Text("- " + note).FontSize(7.8f);
        }

        col.Item().PaddingTop(6).Text("Assumptions").FontSize(10).Bold();
        foreach (var a in content.Assumptions) col.Item().Text("- " + a).FontSize(7.8f);
    }
}
