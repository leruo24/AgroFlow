using System.Globalization;
using System.Text;

namespace AgroFlow.Api.Reports;

/// The report's charts, built as SVG.
///
/// WHY SVG AND NOT DRAWING COMMANDS
/// QuestPDF has no chart element, and its canvas (SkiaSharp) is not exposed
/// by the packaged build - a probe confirmed `using SkiaSharp` does not
/// resolve through it. What it does render is SVG, so the charts are
/// generated as SVG markup and handed to `.Svg(...)`.
///
/// That is a better fit than it sounds. A bar chart assembled out of QuestPDF
/// layout elements can only ever be rectangles in a row; the template needs a
/// shaded band behind a line, markers sitting on that line, and value labels
/// floating above bars. All of those are one SVG element each, and the
/// alternative was a new charting dependency, which the brief does not allow.
///
/// EVERY NUMBER IS FORMATTED WITH InvariantCulture. An SVG coordinate written
/// on a machine with a comma decimal separator - which is most of Europe, and
/// is what a Railway container may well report - produces "12,5" inside a
/// path, which silently truncates the shape or voids the whole attribute.
/// This has bitten the project once already, in ReportPeriods.Describe.
internal static class ChartSvg
{
    /// Inside the viewBox. The axis labels need the room at the bottom, and
    /// bar value labels need it at the top.
    private const double PadLeft = 44;
    private const double PadRight = 12;
    private const double PadTop = 18;
    private const double PadBottom = 28;

    private static string N(double value)
    {
        return value.ToString("0.##", CultureInfo.InvariantCulture);
    }

    /// SVG has five characters that cannot appear raw in text or an attribute.
    /// Zone and crop names reach these charts, and a farm called "Smith & Son"
    /// would otherwise produce markup that does not parse - and QuestPDF
    /// renders a blank box rather than throwing, so it would have shipped.
    private static string E(string? text)
    {
        return (text ?? string.Empty)
            .Replace("&", "&amp;")
            .Replace("<", "&lt;")
            .Replace(">", "&gt;")
            .Replace("\"", "&quot;")
            .Replace("'", "&apos;");
    }

    private static StringBuilder Open(double width, double height)
    {
        var sb = new StringBuilder();
        sb.Append(CultureInfo.InvariantCulture,
            $"<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 {N(width)} {N(height)}\" ");
        sb.Append(CultureInfo.InvariantCulture, $"width=\"{N(width)}\" height=\"{N(height)}\" ");
        // "Lato", and nothing else.
        //
        // QuestPDF's SVG renderer resolves a font-family only against the
        // fonts it has registered, and it ships exactly one: Lato. Naming
        // Helvetica, Arial or sans-serif does not fall back - it drops the
        // <text> element entirely. The charts rendered with every bar in
        // place and not one axis label, value or legend, and nothing threw.
        // Omitting the attribute works too, but naming it keeps the charts
        // in the same typeface as the rest of the document.
        sb.Append("font-family=\"Lato\">");
        return sb;
    }

    /// A "nice" top for the value axis: the smallest of 1, 2 or 5 times a
    /// power of ten that clears the data. Without this the axis tops out at
    /// whatever the largest bar happens to be, and the gridlines land on
    /// numbers like 2.37, which nobody can read a value off.
    private static double NiceMax(double rawMax)
    {
        if (rawMax <= 0) return 1;

        var magnitude = Math.Pow(10, Math.Floor(Math.Log10(rawMax)));
        var normalised = rawMax / magnitude;

        var step = normalised <= 1 ? 1
                 : normalised <= 2 ? 2
                 : normalised <= 5 ? 5
                 : 10;

        return step * magnitude;
    }

    private static void Gridlines(
        StringBuilder sb, double width, double height, double max, int divisions, string? axisLabel)
    {
        var plotTop = PadTop;
        var plotBottom = height - PadBottom;
        var plotHeight = plotBottom - plotTop;

        for (var i = 0; i <= divisions; i++)
        {
            var value = max * i / divisions;
            var y = plotBottom - (plotHeight * i / divisions);

            sb.Append(CultureInfo.InvariantCulture,
                $"<line x1=\"{N(PadLeft)}\" y1=\"{N(y)}\" x2=\"{N(width - PadRight)}\" y2=\"{N(y)}\" " +
                $"stroke=\"{ReportTheme.Rule}\" stroke-width=\"0.6\"/>");

            sb.Append(CultureInfo.InvariantCulture,
                $"<text x=\"{N(PadLeft - 6)}\" y=\"{N(y + 3)}\" text-anchor=\"end\" " +
                $"font-size=\"8\" fill=\"{ReportTheme.Muted}\">{N(value)}</text>");
        }

        if (!string.IsNullOrEmpty(axisLabel))
        {
            // Rotated about its own midpoint, so the label stays centred on
            // the plot however tall the chart is.
            var midY = plotTop + plotHeight / 2;
            sb.Append(CultureInfo.InvariantCulture,
                $"<text x=\"10\" y=\"{N(midY)}\" text-anchor=\"middle\" font-size=\"8\" " +
                $"fill=\"{ReportTheme.Muted}\" transform=\"rotate(-90 10 {N(midY)})\">{E(axisLabel)}</text>");
        }
    }

    private static void CategoryLabels(
        StringBuilder sb, IReadOnlyList<string> labels, double width, double height)
    {
        var plotLeft = PadLeft;
        var plotWidth = width - PadLeft - PadRight;
        var slot = plotWidth / Math.Max(1, labels.Count);
        var y = height - PadBottom + 12;

        for (var i = 0; i < labels.Count; i++)
        {
            var centre = plotLeft + slot * i + slot / 2;
            sb.Append(CultureInfo.InvariantCulture,
                $"<text x=\"{N(centre)}\" y=\"{N(y)}\" text-anchor=\"middle\" font-size=\"8\" " +
                $"fill=\"{ReportTheme.Muted}\">{E(labels[i])}</text>");
        }
    }

    /* ------------------------------------------------------------------ *
     * Page 1 — water used per day
     * ------------------------------------------------------------------ */

    /// One bar per day, with the value printed above it.
    ///
    /// The values are printed because this chart is read for individual days
    /// ("what did Tuesday get?"), not for its shape. A reader should not have
    /// to measure a bar against a gridline to answer that.
    public static string DailyBars(
        IReadOnlyList<string> labels,
        IReadOnlyList<double?> values,
        string axisLabel,
        double width = 500,
        double height = 175)
    {
        var sb = Open(width, height);

        var max = NiceMax(values.Where(v => v.HasValue).Select(v => v!.Value).DefaultIfEmpty(0).Max());
        Gridlines(sb, width, height, max, 4, axisLabel);

        var plotBottom = height - PadBottom;
        var plotHeight = plotBottom - PadTop;
        var slot = (width - PadLeft - PadRight) / Math.Max(1, labels.Count);
        var barWidth = Math.Min(34, slot * 0.52);

        for (var i = 0; i < labels.Count; i++)
        {
            // A day with no estimate is drawn as nothing at all, not as a
            // zero-height bar: a flat bar on the axis reads as "the pump ran
            // and delivered none", which is a fault report. See migration
            // 0018 - a zone with no flow rate yields no estimate.
            if (i >= values.Count || values[i] is null) continue;

            var value = values[i]!.Value;
            var barHeight = max <= 0 ? 0 : plotHeight * (value / max);
            var x = PadLeft + slot * i + (slot - barWidth) / 2;
            var y = plotBottom - barHeight;

            sb.Append(CultureInfo.InvariantCulture,
                $"<rect x=\"{N(x)}\" y=\"{N(y)}\" width=\"{N(barWidth)}\" height=\"{N(barHeight)}\" " +
                $"fill=\"{ReportTheme.Teal}\" rx=\"1\"/>");

            sb.Append(CultureInfo.InvariantCulture,
                $"<text x=\"{N(x + barWidth / 2)}\" y=\"{N(y - 4)}\" text-anchor=\"middle\" " +
                $"font-size=\"8\" fill=\"{ReportTheme.Ink}\">{N(value)}</text>");
        }

        CategoryLabels(sb, labels, width, height);
        sb.Append("</svg>");
        return sb.ToString();
    }

    /* ------------------------------------------------------------------ *
     * Page 2 — what the crop needed vs what it got
     * ------------------------------------------------------------------ */

    /// Two bars per day, side by side, with a legend above the plot.
    ///
    /// Side by side rather than stacked on purpose: the question this answers
    /// is "was it enough?", which is a comparison of two heights. Stacking
    /// them would show a total nobody wants.
    public static string PairedBars(
        IReadOnlyList<string> labels,
        IReadOnlyList<double?> needed,
        IReadOnlyList<double?> given,
        string neededLabel,
        string givenLabel,
        string axisLabel,
        double width = 500,
        double height = 168)
    {
        var sb = Open(width, height);

        var all = needed.Concat(given).Where(v => v.HasValue).Select(v => v!.Value);
        var max = NiceMax(all.DefaultIfEmpty(0).Max());

        // The legend sits inside the top padding, above the first gridline.
        sb.Append(CultureInfo.InvariantCulture,
            $"<rect x=\"{N(PadLeft + 4)}\" y=\"2\" width=\"10\" height=\"8\" fill=\"{ReportTheme.TealLight}\"/>");
        sb.Append(CultureInfo.InvariantCulture,
            $"<text x=\"{N(PadLeft + 19)}\" y=\"9\" font-size=\"8\" fill=\"{ReportTheme.Ink}\">{E(neededLabel)}</text>");
        sb.Append(CultureInfo.InvariantCulture,
            $"<rect x=\"{N(PadLeft + 124)}\" y=\"2\" width=\"10\" height=\"8\" fill=\"{ReportTheme.Brand}\"/>");
        sb.Append(CultureInfo.InvariantCulture,
            $"<text x=\"{N(PadLeft + 139)}\" y=\"9\" font-size=\"8\" fill=\"{ReportTheme.Ink}\">{E(givenLabel)}</text>");

        Gridlines(sb, width, height, max, 4, axisLabel);

        var plotBottom = height - PadBottom;
        var plotHeight = plotBottom - PadTop;
        var slot = (width - PadLeft - PadRight) / Math.Max(1, labels.Count);
        var barWidth = Math.Min(16, slot * 0.3);
        var gap = 2.0;

        for (var i = 0; i < labels.Count; i++)
        {
            var pairLeft = PadLeft + slot * i + (slot - (barWidth * 2 + gap)) / 2;

            void Bar(double? value, double x, string fill)
            {
                if (value is null) return;

                var barHeight = max <= 0 ? 0 : plotHeight * (value.Value / max);
                sb.Append(CultureInfo.InvariantCulture,
                    $"<rect x=\"{N(x)}\" y=\"{N(plotBottom - barHeight)}\" width=\"{N(barWidth)}\" " +
                    $"height=\"{N(barHeight)}\" fill=\"{fill}\" rx=\"1\"/>");
            }

            Bar(i < needed.Count ? needed[i] : null, pairLeft, ReportTheme.TealLight);
            Bar(i < given.Count ? given[i] : null, pairLeft + barWidth + gap, ReportTheme.Brand);
        }

        CategoryLabels(sb, labels, width, height);
        sb.Append("</svg>");
        return sb.ToString();
    }

    /* ------------------------------------------------------------------ *
     * Page 2 — soil moisture through the week
     * ------------------------------------------------------------------ */

    public sealed record MoisturePoint(double Position, double Percent);

    /// A line, a shaded healthy band behind it, and a marker wherever the
    /// pump ran.
    ///
    /// The band is what makes this chart readable without the surrounding
    /// text: "in the blue" is the whole message, and a dip below it is the
    /// only thing a farmer has to act on. Position is 0..1 across the period
    /// rather than an index, because readings do not arrive on a tidy grid -
    /// a sensor that missed four hours must leave a gap of the right width,
    /// not a point of equal spacing that hides the outage.
    public static string MoistureLine(
        IReadOnlyList<MoisturePoint> points,
        IReadOnlyList<double> pumpPositions,
        IReadOnlyList<string> dayLabels,
        double healthyLow,
        double healthyHigh,
        string axisLabel,
        double width = 500,
        double height = 168)
    {
        var sb = Open(width, height);

        // Fixed 40-100 scale, not fitted to the data. A chart that rescales
        // to its own range makes a calm week and an alarming one look
        // identical, and the healthy band would move between reports.
        const double axisMin = 40;
        const double axisMax = 100;

        // The legend sits ABOVE the plot, as it does on the other charts.
        // Below it, it collided with the day labels and the two strings
        // interleaved character by character - "HMeaolnth2y8range" - which
        // renders without complaint and is unreadable.
        var plotTop = PadTop + 10;
        var plotBottom = height - PadBottom;
        var plotHeight = plotBottom - plotTop;
        var plotLeft = PadLeft;
        var plotWidth = width - PadLeft - PadRight;

        double Y(double percent)
        {
            var clamped = Math.Clamp(percent, axisMin, axisMax);
            return plotBottom - plotHeight * ((clamped - axisMin) / (axisMax - axisMin));
        }

        double X(double position) => plotLeft + plotWidth * Math.Clamp(position, 0, 1);

        // Band first, so everything else draws over it.
        var bandTop = Y(healthyHigh);
        var bandBottom = Y(healthyLow);
        sb.Append(CultureInfo.InvariantCulture,
            $"<rect x=\"{N(plotLeft)}\" y=\"{N(bandTop)}\" width=\"{N(plotWidth)}\" " +
            $"height=\"{N(bandBottom - bandTop)}\" fill=\"{ReportTheme.BandFill}\"/>");

        for (var tick = axisMin; tick <= axisMax; tick += 10)
        {
            var y = Y(tick);
            sb.Append(CultureInfo.InvariantCulture,
                $"<line x1=\"{N(plotLeft)}\" y1=\"{N(y)}\" x2=\"{N(plotLeft + plotWidth)}\" y2=\"{N(y)}\" " +
                $"stroke=\"{ReportTheme.Rule}\" stroke-width=\"0.5\"/>");
            sb.Append(CultureInfo.InvariantCulture,
                $"<text x=\"{N(plotLeft - 6)}\" y=\"{N(y + 3)}\" text-anchor=\"end\" font-size=\"8\" " +
                $"fill=\"{ReportTheme.Muted}\">{N(tick)}</text>");
        }

        var midY = plotTop + plotHeight / 2;
        sb.Append(CultureInfo.InvariantCulture,
            $"<text x=\"10\" y=\"{N(midY)}\" text-anchor=\"middle\" font-size=\"8\" fill=\"{ReportTheme.Muted}\" " +
            $"transform=\"rotate(-90 10 {N(midY)})\">{E(axisLabel)}</text>");

        if (points.Count > 0)
        {
            var path = new StringBuilder();
            for (var i = 0; i < points.Count; i++)
            {
                path.Append(i == 0 ? 'M' : 'L');
                path.Append(CultureInfo.InvariantCulture, $"{N(X(points[i].Position))} {N(Y(points[i].Percent))} ");
            }

            sb.Append(CultureInfo.InvariantCulture,
                $"<path d=\"{path.ToString().Trim()}\" fill=\"none\" stroke=\"{ReportTheme.Teal}\" " +
                $"stroke-width=\"1.4\" stroke-linejoin=\"round\"/>");
        }

        // Pump markers: a small triangle at the top of the plot, pointing
        // down at the moment the pump ran. Above the line rather than on it,
        // so a burst of runs does not obscure the recovery it caused.
        foreach (var position in pumpPositions)
        {
            var x = X(position);
            sb.Append(CultureInfo.InvariantCulture,
                $"<polygon points=\"{N(x - 3)},{N(plotTop)} {N(x + 3)},{N(plotTop)} {N(x)},{N(plotTop + 5)}\" " +
                $"fill=\"{ReportTheme.Teal}\"/>");
        }

        // Legend strip above the plot.
        var legendY = 9.0;
        sb.Append(CultureInfo.InvariantCulture,
            $"<rect x=\"{N(plotLeft)}\" y=\"{N(legendY - 6)}\" width=\"10\" height=\"7\" fill=\"{ReportTheme.BandFill}\"/>");
        sb.Append(CultureInfo.InvariantCulture,
            $"<text x=\"{N(plotLeft + 15)}\" y=\"{N(legendY)}\" font-size=\"7.5\" fill=\"{ReportTheme.Muted}\">" +
            $"Healthy range ({N(healthyLow)}–{N(healthyHigh)}%)</text>");
        sb.Append(CultureInfo.InvariantCulture,
            $"<line x1=\"{N(plotLeft + 120)}\" y1=\"{N(legendY - 2)}\" x2=\"{N(plotLeft + 136)}\" y2=\"{N(legendY - 2)}\" " +
            $"stroke=\"{ReportTheme.Teal}\" stroke-width=\"1.4\"/>");
        sb.Append(CultureInfo.InvariantCulture,
            $"<text x=\"{N(plotLeft + 141)}\" y=\"{N(legendY)}\" font-size=\"7.5\" fill=\"{ReportTheme.Muted}\">" +
            $"Soil moisture (relative %)</text>");
        sb.Append(CultureInfo.InvariantCulture,
            $"<polygon points=\"{N(plotLeft + 252)},{N(legendY - 6)} {N(plotLeft + 258)},{N(legendY - 6)} " +
            $"{N(plotLeft + 255)},{N(legendY - 1)}\" fill=\"{ReportTheme.Teal}\"/>");
        sb.Append(CultureInfo.InvariantCulture,
            $"<text x=\"{N(plotLeft + 264)}\" y=\"{N(legendY)}\" font-size=\"7.5\" fill=\"{ReportTheme.Muted}\">" +
            $"Pump ran</text>");

        // Day labels sit on the axis itself, one per day, centred in the slot
        // that day occupies across the period.
        if (dayLabels.Count > 0)
        {
            var slot = plotWidth / dayLabels.Count;
            for (var i = 0; i < dayLabels.Count; i++)
            {
                sb.Append(CultureInfo.InvariantCulture,
                    $"<text x=\"{N(plotLeft + slot * i + slot / 2)}\" y=\"{N(plotBottom + 12)}\" " +
                    $"text-anchor=\"middle\" font-size=\"8\" fill=\"{ReportTheme.Muted}\">{E(dayLabels[i])}</text>");
            }
        }

        sb.Append("</svg>");
        return sb.ToString();
    }

    /* ------------------------------------------------------------------ *
     * Page 3 — area forecast vs in the tub
     * ------------------------------------------------------------------ */

    /// Two lines with round markers, for comparing a forecast against a
    /// sensor. Gaps are real: a day with no reading breaks the line rather
    /// than joining across it, because a straight segment over a missing day
    /// is an invented measurement.
    public static string TwoLines(
        IReadOnlyList<string> labels,
        IReadOnlyList<double?> seriesA,
        IReadOnlyList<double?> seriesB,
        string labelA,
        string labelB,
        string axisLabel,
        double width = 500,
        double height = 165)
    {
        var sb = Open(width, height);

        var all = seriesA.Concat(seriesB).Where(v => v.HasValue).Select(v => v!.Value).ToList();
        var dataMin = all.Count > 0 ? all.Min() : 0;
        var dataMax = all.Count > 0 ? all.Max() : 1;

        // Padded to whole units so the lines never touch the frame, which
        // makes a peak look clipped.
        var axisMin = Math.Floor(dataMin - 2);
        var axisMax = Math.Ceiling(dataMax + 2);
        if (axisMax - axisMin < 4) axisMax = axisMin + 4;

        var plotTop = PadTop;
        var plotBottom = height - PadBottom;
        var plotHeight = plotBottom - plotTop;
        var plotLeft = PadLeft;
        var plotWidth = width - PadLeft - PadRight;

        double Y(double v) => plotBottom - plotHeight * ((v - axisMin) / (axisMax - axisMin));

        var slot = plotWidth / Math.Max(1, labels.Count);
        double X(int i) => plotLeft + slot * i + slot / 2;

        var steps = 4;
        for (var i = 0; i <= steps; i++)
        {
            var value = axisMin + (axisMax - axisMin) * i / steps;
            var y = Y(value);
            sb.Append(CultureInfo.InvariantCulture,
                $"<line x1=\"{N(plotLeft)}\" y1=\"{N(y)}\" x2=\"{N(plotLeft + plotWidth)}\" y2=\"{N(y)}\" " +
                $"stroke=\"{ReportTheme.Rule}\" stroke-width=\"0.5\"/>");
            sb.Append(CultureInfo.InvariantCulture,
                $"<text x=\"{N(plotLeft - 6)}\" y=\"{N(y + 3)}\" text-anchor=\"end\" font-size=\"8\" " +
                $"fill=\"{ReportTheme.Muted}\">{N(value)}</text>");
        }

        var midY = plotTop + plotHeight / 2;
        sb.Append(CultureInfo.InvariantCulture,
            $"<text x=\"10\" y=\"{N(midY)}\" text-anchor=\"middle\" font-size=\"8\" fill=\"{ReportTheme.Muted}\" " +
            $"transform=\"rotate(-90 10 {N(midY)})\">{E(axisLabel)}</text>");

        void Series(IReadOnlyList<double?> values, string colour)
        {
            var path = new StringBuilder();
            var penDown = false;

            for (var i = 0; i < labels.Count && i < values.Count; i++)
            {
                if (values[i] is null)
                {
                    penDown = false;
                    continue;
                }

                var x = X(i);
                var y = Y(values[i]!.Value);

                path.Append(penDown ? 'L' : 'M');
                path.Append(CultureInfo.InvariantCulture, $"{N(x)} {N(y)} ");
                penDown = true;

                sb.Append(CultureInfo.InvariantCulture,
                    $"<circle cx=\"{N(x)}\" cy=\"{N(y)}\" r=\"2.4\" fill=\"{colour}\"/>");
            }

            if (path.Length > 0)
            {
                sb.Append(CultureInfo.InvariantCulture,
                    $"<path d=\"{path.ToString().Trim()}\" fill=\"none\" stroke=\"{colour}\" " +
                    $"stroke-width=\"1.3\" stroke-linejoin=\"round\"/>");
            }
        }

        Series(seriesA, ReportTheme.WeatherArea);
        Series(seriesB, ReportTheme.WeatherTub);

        // Legend in the top padding.
        sb.Append(CultureInfo.InvariantCulture,
            $"<line x1=\"{N(plotLeft + 4)}\" y1=\"7\" x2=\"{N(plotLeft + 20)}\" y2=\"7\" " +
            $"stroke=\"{ReportTheme.WeatherArea}\" stroke-width=\"1.3\"/>");
        sb.Append(CultureInfo.InvariantCulture,
            $"<circle cx=\"{N(plotLeft + 12)}\" cy=\"7\" r=\"2.4\" fill=\"{ReportTheme.WeatherArea}\"/>");
        sb.Append(CultureInfo.InvariantCulture,
            $"<text x=\"{N(plotLeft + 25)}\" y=\"10\" font-size=\"8\" fill=\"{ReportTheme.Ink}\">{E(labelA)}</text>");

        sb.Append(CultureInfo.InvariantCulture,
            $"<line x1=\"{N(plotLeft + 210)}\" y1=\"7\" x2=\"{N(plotLeft + 226)}\" y2=\"7\" " +
            $"stroke=\"{ReportTheme.WeatherTub}\" stroke-width=\"1.3\"/>");
        sb.Append(CultureInfo.InvariantCulture,
            $"<circle cx=\"{N(plotLeft + 218)}\" cy=\"7\" r=\"2.4\" fill=\"{ReportTheme.WeatherTub}\"/>");
        sb.Append(CultureInfo.InvariantCulture,
            $"<text x=\"{N(plotLeft + 231)}\" y=\"10\" font-size=\"8\" fill=\"{ReportTheme.Ink}\">{E(labelB)}</text>");

        CategoryLabels(sb, labels, width, height);
        sb.Append("</svg>");
        return sb.ToString();
    }
}
