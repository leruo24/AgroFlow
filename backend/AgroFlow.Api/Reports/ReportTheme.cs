namespace AgroFlow.Api.Reports;

/// The one place the designed report's colours and spacing live.
///
/// WHY A THEME FILE RATHER THAN LITERALS AT EACH USE
/// The report is drawn two different ways: QuestPDF elements for the page
/// furniture, and SVG strings for the charts. Those are different rendering
/// paths that cannot share a stylesheet, so without this the same green would
/// be written twice in two syntaxes and drift the first time one was changed.
/// Everything here is a plain hex string, which both paths accept.
///
/// The palette is the one in docs/agroflow-report-template.pdf, which in turn
/// matches the console's brand tokens in apps/web/admin/src/styles/main.css.
internal static class ReportTheme
{
    /// The header band and every heading.
    public const string Brand = "#184D35";

    /// Body text. Not pure black - against a white page at 10pt, #22 reads
    /// softer over three pages without losing contrast (still ~15:1).
    public const string Ink = "#222A26";

    /// Captions, axis labels, the footer.
    public const string Muted = "#6B7A72";

    /// Bars for water actually delivered, and the moisture line.
    public const string Teal = "#246B7A";

    /// "Crop needed" in the paired chart - deliberately lighter than Teal so
    /// the pair reads as need versus given at a glance.
    public const string TealLight = "#86CFE8";

    /// The healthy-moisture band behind the moisture chart.
    public const string BandFill = "#E7F3F9";

    /// The area forecast line. Grey because it is the reference series; the
    /// local field sensor is the one being compared against it.
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
