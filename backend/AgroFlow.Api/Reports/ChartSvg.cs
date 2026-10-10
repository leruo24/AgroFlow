using System.Globalization;
using System.Text;

namespace AgroFlow.Api.Reports;

/// The report's charts, built as SVG.
/// QuestPDF has no chart element and does not expose SkiaSharp, but it renders SVG,
/// which also handles the shaded band, markers and value labels we need.
/// Every number uses InvariantCulture: on a machine with a comma decimal separator
/// "12,5" would break the SVG path.
internal static class ChartSvg
{
    /// Padding inside the viewBox for the axis labels (bottom) and value labels (top).
    private const double PadLeft = 44;
    private const double PadRight = 12;
    private const double PadTop = 18;
    private const double PadBottom = 28;

    private static string N(double value)
    {
        return value.ToString("0.##", CultureInfo.InvariantCulture);
    }

    /// Escape the five SVG special characters. A farm called "Smith & Son" would
    /// otherwise break the markup, and QuestPDF just draws a blank box.
    private static string E(string? text)
    {
        return ReportText.Clean(text)
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
        // Only "Lato": QuestPDF's SVG renderer only knows its one bundled font, and any
        // other font-family drops the <text> element without an error.
        sb.Append("font-family=\"Lato\">");
        return sb;
    }

    /// A "nice" top for the value axis (1, 2 or 5 times a power of ten), so the
    /// gridlines land on readable numbers.
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
            // Rotated about its own midpoint so the label stays centred.
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

    /// One bar per day, with the value printed above it, because this chart is read
    /// day by day ("what did Tuesday get?").
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
            // A day with no estimate draws nothing, not a zero bar, which would look like the
            // pump ran and delivered nothing. A zone with no flow rate has no estimate (0018).
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

    /// Two bars per day, side by side, with a legend above. Side by side because the
    /// question is "was it enough?", a comparison of two heights.
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

        // The legend sits in the top padding, above the first gridline.
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

    /// A line, a shaded healthy band behind it, and a marker wherever the pump ran.
    /// "In the band" is the whole message. Position runs 0..1 across the period, so a
    /// sensor that missed four hours leaves a gap of the right width.
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

        // Fixed 40-100 scale, so a calm week and a worrying one look different and the
        // healthy band stays in the same place.
        const double axisMin = 40;
        const double axisMax = 100;

        // The legend sits above the plot like the other charts; below it, it overlapped
        // the day labels.
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

        // Pump markers: small triangles at the top of the plot, pointing down at each run,
        // so a burst of runs does not hide the line.
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

        // Day labels on the axis, one per day, centred in that day's slot.
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
     * Page 3 — area forecast vs local field conditions
     * ------------------------------------------------------------------ */

    /// Two lines with round markers, comparing a forecast with a sensor. A day with no
    /// reading breaks the line, because joining across it would invent a measurement.
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

        // Padded to whole units so the lines never touch the frame.
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
        Series(seriesB, ReportTheme.WeatherLocal);

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
            $"stroke=\"{ReportTheme.WeatherLocal}\" stroke-width=\"1.3\"/>");
        sb.Append(CultureInfo.InvariantCulture,
            $"<circle cx=\"{N(plotLeft + 218)}\" cy=\"7\" r=\"2.4\" fill=\"{ReportTheme.WeatherLocal}\"/>");
        sb.Append(CultureInfo.InvariantCulture,
            $"<text x=\"{N(plotLeft + 231)}\" y=\"10\" font-size=\"8\" fill=\"{ReportTheme.Ink}\">{E(labelB)}</text>");

        CategoryLabels(sb, labels, width, height);
        sb.Append("</svg>");
        return sb.ToString();
    }
}
