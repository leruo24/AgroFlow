using System.Globalization;
using System.Reflection;
using QuestPDF.Fluent;
using QuestPDF.Helpers;
using QuestPDF.Infrastructure;

namespace AgroFlow.Api.Reports;

/// The page furniture every AgroFlow report shares: the green band at the top,
/// the estimate note and page number at the bottom, headings, table cells and
/// number formatting.
///
/// WHY IT IS SHARED
/// There are three farmer-facing reports - water usage, soil moisture and the
/// watering schedule - and until now each drew its own plain header. Pulling
/// the furniture out means all three look like one product, and the estimate
/// disclaimer at the foot of every page cannot be forgotten on one of them.
/// It also means the logo is loaded once, not three times.
internal static class ReportShell
{
    /// The report's logo, read once out of the assembly.
    ///
    /// Embedded rather than deployed beside the binary: a Railway container's
    /// filesystem is rebuilt on every deploy and nothing copies loose assets
    /// into it, so a report loading this from disk would lose its header in
    /// production and only in production. Null if the resource is missing,
    /// which the header handles - a farmer's weekly report must not fail over
    /// a picture.
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

    /// `note` carries whatever that report must say on every page. For water
    /// usage that is the estimate disclaimer; a reader who only has page 3 in
    /// their hand still has to know the litres are inferred.
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

                // QuestPDF's own counters, rather than a number passed in:
                // a report whose length depends on how many zones a farm has
                // cannot know its page count in advance.
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

    /// A smaller heading, for a zone's section inside a farm-wide report.
    public static void ZoneHeading(ColumnDescriptor col, string zone, string? crop)
    {
        col.Item().PaddingTop(4).PaddingBottom(8)
            .Background(ReportTheme.Surface).Padding(10)
            .Text(string.IsNullOrWhiteSpace(crop) ? zone : $"{zone} — {crop}")
            .FontSize(13).Bold().FontColor(ReportTheme.Brand);
    }

    /// The one-line explanation that sits UNDER a chart, not over it: the
    /// chart is the thing being explained, and a caption above is read before
    /// there is anything to apply it to.
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

    /// InvariantCulture everywhere. .NET on some hosts renders "3 Sept" and a
    /// comma decimal separator, and these strings reach a farmer in a Telegram
    /// caption - the project has been bitten by exactly this once already, in
    /// ReportPeriods.Describe.
    public static string Num(double value, int decimals) =>
        value.ToString("F" + decimals.ToString(CultureInfo.InvariantCulture), CultureInfo.InvariantCulture);

    /// An em dash, never "0". A missing reading and a measured zero are
    /// different facts and must not share a rendering.
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
