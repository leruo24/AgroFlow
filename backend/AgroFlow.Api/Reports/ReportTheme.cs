namespace AgroFlow.Api.Reports;

/// The report's colours and spacing in one place.
/// The PDF layout (QuestPDF) and the charts (SVG) cannot share a stylesheet, so both
/// read these plain hex strings. The palette matches the console's brand colours in
/// apps/web/admin/src/styles/main.css.
internal static class ReportTheme
{
    /// The header band and every heading.
    public const string Brand = "#184D35";

    /// Body text. Slightly softer than pure black, still about 15:1 contrast.
    public const string Ink = "#222A26";

    /// Captions, axis labels, the footer.
    public const string Muted = "#6B7A72";

    /// Bars for water actually delivered, and the moisture line.
    public const string Teal = "#246B7A";

    /// "Crop needed" in the paired chart: lighter than Teal so need and given are
    /// easy to tell apart.
    public const string TealLight = "#86CFE8";

    /// The healthy-moisture band behind the moisture chart.
    public const string BandFill = "#E7F3F9";

    /// The area forecast line, grey because it is the reference the local sensor is
    /// compared against.
    public const string WeatherArea = "#96A39C";

    /// The local field sensor line.
    public const string WeatherLocal = "#D4A017";

    /// KPI tiles, table stripes, the glossary box.
    public const string Surface = "#F2F5F3";

    /// The "How your system works" callout.
    public const string CalloutFill = "#EAF2F8";

    /// Hairlines: table rules, chart gridlines, axes.
    public const string Rule = "#D8E0DB";

    /// Only for a figure that is a problem, never for emphasis.
    public const string Warn = "#B3451F";
}
