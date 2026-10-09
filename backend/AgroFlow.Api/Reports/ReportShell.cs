using System.Globalization;
using System.Reflection;
using QuestPDF.Fluent;
using QuestPDF.Helpers;
using QuestPDF.Infrastructure;

namespace AgroFlow.Api.Reports;

/// The layout every AgroFlow report shares: the green band at the top, the
/// estimate note and page number at the bottom, headings, table cells and number
/// formatting. Shared so all reports look the same, the estimate note is never
/// forgotten, and the logo is loaded once.
internal static class ReportShell
{
    // An emoji in a farm or zone name prints as a blank box instead of failing the
    // report. Also set in Program.cs; here so every path through the shell has it.
    static ReportShell()
    {
        QuestPDF.Settings.CheckIfAllTextGlyphsAreAvailable = false;
    }

    /// The logo, embedded in the assembly and read once. Railway rebuilds the
    /// container on every deploy, so a loose file would go missing. Null if the
    /// resource is missing; the header copes without it.
    private static readonly Lazy<byte[]?> LogoBytes = new(() =>
    {
        var assembly = typeof(ReportShell).Assembly;

        var name = assembly.GetManifestResourceNames()
            .FirstOrDefault(n => n.EndsWith("agroflow-icon.png", StringComparison.Ordinal));

        if (name is null) return null;

        using var stream = assembly.GetManifestResourceStream(name);
        if (stream is null) return null;

        using var memory = new MemoryStream();
        stream.CopyTo(memory);
        return memory.ToArray();
    });

    public static void ApplyPageDefaults(PageDescriptor page)
    {
        page.Size(PageSizes.A4);
        page.Margin(0);
        page.DefaultTextStyle(t => t.FontSize(9.5f).FontColor(ReportTheme.Ink).LineHeight(1.35f));
    }

    public static void Header(IContainer container, string title, string subtitle, string generated)
    {
        container
            .Background(ReportTheme.Brand)
            .PaddingVertical(20)
            .PaddingHorizontal(34)
            .Row(row =>
            {
                var logo = LogoBytes.Value;

                row.ConstantItem(54).Height(54).Background(Colors.White)
                    .AlignCenter().AlignMiddle()
                    .Element(plate =>
                    {
                        if (logo is not null) plate.Padding(5).Image(logo).FitArea();
                        else plate.Text("AF").FontSize(17).Bold().FontColor(ReportTheme.Brand);
                    });

                row.ConstantItem(16);

                row.RelativeItem().Column(col =>
                {
                    col.Item().Text(title).FontSize(21).Bold().FontColor(Colors.White);
                    col.Item().PaddingTop(3).Text(subtitle).FontSize(9.5f).FontColor("#C9DBD1");
                    col.Item().Text(generated).FontSize(9.5f).FontColor("#C9DBD1");
                });
            });
    }

    /// `note` is printed on every page. For water usage it is the estimate note, so
    /// even page 3 on its own says the litres are estimated.
    public static void Footer(IContainer container, string note)
    {
        container
            .PaddingHorizontal(34)
            .PaddingBottom(18)
            .PaddingTop(10)
            .BorderTop(0.6f)
            .BorderColor(ReportTheme.Rule)
            .PaddingTop(8)
            .Row(row =>
            {
                row.RelativeItem().Column(col =>
                {
                    if (!string.IsNullOrWhiteSpace(note))
                    {
                        col.Item().Text(note).FontSize(7.5f).FontColor(ReportTheme.Muted);
                    }

                    col.Item().Text("AgroFlow · smart irrigation")
                        .FontSize(7.5f).FontColor(ReportTheme.Muted);
                });

                // QuestPDF's own page counters, because a report's length depends on how many
                // zones the farm has.
                row.ConstantItem(80).AlignRight().Text(t =>
                {
                    t.DefaultTextStyle(x => x.FontSize(7.5f).FontColor(ReportTheme.Muted));
                    t.Span("Page ");
                    t.CurrentPageNumber();
                    t.Span(" of ");
                    t.TotalPages();
                });
            });
    }

    public static string GeneratedLine(DateTimeOffset generatedAtSast, string? suffix = null)
    {
        var stamp = generatedAtSast.ToString("d MMM yyyy, HH:mm", CultureInfo.InvariantCulture);
        return suffix is null ? $"Generated {stamp} SAST" : $"Generated {stamp} SAST  ·  {suffix}";
    }

    public static void Heading(ColumnDescriptor col, string text)
    {
        col.Item().PaddingTop(10).PaddingBottom(6)
            .Text(text).FontSize(12.5f).Bold().FontColor(ReportTheme.Brand);
    }

    /// A smaller heading for a zone's section inside a farm-wide report.
    public static void ZoneHeading(ColumnDescriptor col, string zone, string? crop)
    {
        col.Item().PaddingTop(4).PaddingBottom(8)
            .Background(ReportTheme.Surface).Padding(10)
            .Text(string.IsNullOrWhiteSpace(crop) ? zone : $"{zone} — {crop}")
            .FontSize(13).Bold().FontColor(ReportTheme.Brand);
    }

    /// The one-line note under a chart, read after the chart it explains.
    public static void ChartNote(ColumnDescriptor col, string text)
    {
        col.Item().PaddingTop(6).Text(text).FontSize(8.8f).FontColor(ReportTheme.Ink);
    }

    public static void HeadCell(TableCellDescriptor h, string text)
    {
        h.Cell().Background(ReportTheme.Brand).PaddingVertical(4).PaddingHorizontal(5)
            .Text(text).FontSize(7.8f).Bold().FontColor(Colors.White);
    }

    public static void BodyCell(TableDescriptor table, string text, string fill)
    {
        table.Cell().Background(fill).PaddingVertical(3).PaddingHorizontal(5)
            .Text(text).FontSize(8.2f);
    }

    public static void TotalCell(TableDescriptor table, string text)
    {
        table.Cell().Background("#DCE7E0").PaddingVertical(4).PaddingHorizontal(5)
            .Text(text).FontSize(8.2f).Bold();
    }

    public const string Stripe = "#FFFFFF";

    /// InvariantCulture everywhere: some hosts write "3 Sept" and a comma decimal
    /// separator, and these strings can reach a farmer in a Telegram caption.
    public static string Num(double value, int decimals) =>
        value.ToString("F" + decimals.ToString(CultureInfo.InvariantCulture), CultureInfo.InvariantCulture);

    /// An em dash, never "0": a missing reading and a measured zero are different.
    public static string Opt(double? value, int decimals) =>
        value is { } v ? Num(v, decimals) : "—";

    public static string Delta(double? a, double? b, int decimals, string unit)
    {
        if (a is not { } x || b is not { } y) return "—";

        var difference = x - y;
        var sign = difference >= 0 ? "+" : "−";

        return $"{sign}{Num(Math.Abs(difference), decimals)}{unit}";
    }
}
