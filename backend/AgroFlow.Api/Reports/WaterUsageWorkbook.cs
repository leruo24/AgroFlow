using System.Globalization;
using Cell = AgroFlow.Api.Reports.XlsxWriter.Cell;
using Sheet = AgroFlow.Api.Reports.XlsxWriter.Sheet;

namespace AgroFlow.Api.Reports;

/// The water usage report as a workbook (docs/agroflow-data-template.xlsx).
/// The PDF is for reading; this is for working with the numbers (charting months,
/// pasting into a funding application). Both render from the same
/// WaterUsageReportModel, so their totals match.
internal static class WaterUsageWorkbook
{
    public static byte[] Render(WaterUsageReportModel m)
    {
        return XlsxWriter.Build(new[]
        {
            SummarySheet(m),
            DailySheet(m),
            WeatherSheet(m),
        });
    }

    private static string Period(WaterUsageReportModel m)
    {
        var from = m.From.ToDateTime(TimeOnly.MinValue);
        var to = m.To.ToDateTime(TimeOnly.MinValue);

        return $"{from.ToString("d MMM", CultureInfo.InvariantCulture)} – " +
               $"{to.ToString("d MMM yyyy", CultureInfo.InvariantCulture)}";
    }

    private static string ZoneTitle(WaterUsageReportModel m)
    {
        return string.IsNullOrWhiteSpace(m.CropLabel) ? m.ZoneName : $"{m.ZoneName} ({m.CropLabel})";
    }

    /* ------------------------------------------------------------------ *
     * Sheet 1 — Summary
     * ------------------------------------------------------------------ */

    private static Sheet SummarySheet(WaterUsageReportModel m)
    {
        var sheet = new Sheet
        {
            Name = "Summary",
            // Column B is wide for the Advice section's "Why" text.
            ColumnWidths = new[] { 40.0, 60.0, 10.0 },
        };

        sheet.Add(Cell.Of("AgroFlow — Water Usage Data", XlsxStyle.Title));
        sheet.Add(Cell.Of($"Farm: {m.FarmName}   ·   Zone: {ZoneTitle(m)}", XlsxStyle.Subtitle));
        sheet.Add(Cell.Of(
            $"Period: {Period(m)}   ·   Generated " +
            $"{m.GeneratedAtSast.ToString("d MMM yyyy HH:mm", CultureInfo.InvariantCulture)} SAST",
            XlsxStyle.Subtitle));
        sheet.AddBlank();

        sheet.Add(Cell.Of("Key figures", XlsxStyle.SectionHeader),
                  Cell.Of("", XlsxStyle.SectionHeader),
                  Cell.Of("", XlsxStyle.SectionHeader));

        sheet.Add(Cell.Of("Measure", XlsxStyle.TableHeader),
                  Cell.Of("Value", XlsxStyle.TableHeader),
                  Cell.Of("Unit", XlsxStyle.TableHeader));

        // Every figure is a number cell, not text, so the sheet can be charted and summed.
        // Where a figure cannot be worked out the cell is left empty, not 0 (see Cell.Blank).
        sheet.Add(Cell.Of("Pump flow rate"),
                  Cell.Maybe(m.FlowRateLpm, XlsxStyle.OneDecimal),
                  Cell.Of("L/min"));

        sheet.Add(Cell.Of("Pump runs"),
                  Cell.Of(m.TotalRuns, XlsxStyle.Integer),
                  Cell.Of("runs"));

        sheet.Add(Cell.Of("Total pump minutes"),
                  Cell.Of(m.TotalMinutes, XlsxStyle.OneDecimal),
                  Cell.Of("min"));

        sheet.Add(Cell.Of("Estimated water used"),
                  Cell.Maybe(m.TotalLitres, XlsxStyle.OneDecimal),
                  Cell.Of("L"));

        sheet.Add(Cell.Of("Crop water need"),
                  Cell.Maybe(m.TotalNeedLitres, XlsxStyle.OneDecimal),
                  Cell.Of("L"));

        sheet.Add(Cell.Of("Difference (given − needed)"),
                  Cell.Maybe(m.Difference, XlsxStyle.OneDecimal),
                  Cell.Of("L"));

        sheet.Add(Cell.Of("Days too dry"),
                  Cell.Of(m.DaysTooDry, XlsxStyle.Integer),
                  Cell.Of("days"));

        sheet.Add(Cell.Of("Average soil moisture"),
                  Cell.Maybe(m.AvgMoisturePercent, XlsxStyle.OneDecimal),
                  Cell.Of("%"));

        sheet.Add(Cell.Of("Rain over the period"),
                  Cell.Of(m.TotalRainMm, XlsxStyle.OneDecimal),
                  Cell.Of("mm"));

        sheet.AddBlank();

        AddAdvice(sheet, m);

        sheet.Add(Cell.Of("Notes", XlsxStyle.SectionHeader),
                  Cell.Of("", XlsxStyle.SectionHeader),
                  Cell.Of("", XlsxStyle.SectionHeader));

        sheet.Add(Cell.Of(
            "Litres are estimated: pump minutes × flow rate. There is no flow meter on any AgroFlow node.",
            XlsxStyle.Note));

        sheet.Add(Cell.Of(
            "Crop water need comes from the FAO-56 method (weather app + crop growth stage) × the zone's area.",
            XlsxStyle.Note));

        sheet.Add(Cell.Of(
            "Soil moisture is relative to this zone's setup: 100% = soaked and drained, 0% = dry.",
            XlsxStyle.Note));

        sheet.Add(Cell.Of(
            "An empty cell means the figure could not be worked out, which is not the same as zero.",
            XlsxStyle.Note));

        if (m.FlowRateLpm is null)
        {
            sheet.AddBlank();
            sheet.Add(Cell.Of(
                "This zone has no flow rate on file, so no water volume can be estimated for it. " +
                "Set one and every litre figure in this workbook will fill in.",
                XlsxStyle.Bold));
        }

        return sheet;
    }

    // The period's verdict and each piece of advice, with a "Why" column: the same
    // summary the PDF prints under each line.
    internal static void AddAdvice(Sheet sheet, WaterUsageReportModel m)
    {
        var rows = new List<(string Advice, string Why)>();
        if (m.Verdict is { } verdict && m.VerdictWhy is { } verdictWhy)
        {
            rows.Add(("Water this period: " + AgroFlow.Business.Agronomy.RuleBook.VerdictRules.Label(verdict), verdictWhy.Summary));
        }
        foreach (var line in m.Advice)
        {
            rows.Add((line.Message, line.Why?.Summary ?? ""));
        }

        if (rows.Count == 0) return;

        sheet.Add(Cell.Of("Advice", XlsxStyle.SectionHeader),
                  Cell.Of("", XlsxStyle.SectionHeader),
                  Cell.Of("", XlsxStyle.SectionHeader));
        sheet.Add(Cell.Of("Advice", XlsxStyle.TableHeader),
                  Cell.Of("Why", XlsxStyle.TableHeader));
        foreach (var (advice, why) in rows)
        {
            sheet.Add(Cell.Of(advice), Cell.Of(why, XlsxStyle.Note));
        }
        sheet.AddBlank();
    }

    /* ------------------------------------------------------------------ *
     * Sheet 2 — Daily
     * ------------------------------------------------------------------ */

    private static Sheet DailySheet(WaterUsageReportModel m)
    {
        var sheet = new Sheet
        {
            // The zone goes in the tab name, so two zones' workbooks can be told apart.
            Name = $"Daily - {m.ZoneName}",
            ColumnWidths = new[] { 16.0, 11.0, 13.0, 13.0, 16.0, 17.0, 14.0, 13.0, 16.0, 15.0, 10.0, 26.0 },
        };

        sheet.Add(Cell.Of($"Daily data — {ZoneTitle(m)}", XlsxStyle.Title));
        sheet.Add(Cell.Of(
            "Litres (est.) = pump minutes × the flow rate on the Summary sheet. " +
            "An empty cell means the figure could not be worked out.",
            XlsxStyle.Note));
        sheet.AddBlank();

        sheet.Add(
            Cell.Of("Date", XlsxStyle.TableHeader),
            Cell.Of("Pump runs", XlsxStyle.TableHeader),
            Cell.Of("Pump minutes", XlsxStyle.TableHeader),
            Cell.Of("Litres (est.)", XlsxStyle.TableHeader),
            Cell.Of("Crop water need (L)", XlsxStyle.TableHeader),
            Cell.Of("Avg soil moisture (%)", XlsxStyle.TableHeader),
            Cell.Of("Area max temp (°C)", XlsxStyle.TableHeader),
            Cell.Of("Local max temp (°C)", XlsxStyle.TableHeader),
            Cell.Of("Area humidity (%)", XlsxStyle.TableHeader),
            Cell.Of("Local humidity (%)", XlsxStyle.TableHeader),
            Cell.Of("Rain (mm)", XlsxStyle.TableHeader),
            Cell.Of("Note", XlsxStyle.TableHeader));

        foreach (var d in m.Days)
        {
            sheet.Add(
                Cell.Of(d.LongLabel),
                Cell.Of(d.PumpRuns, XlsxStyle.Integer),
                Cell.Of(d.PumpMinutes, XlsxStyle.OneDecimal),
                Cell.Maybe(d.Litres, XlsxStyle.TwoDecimals),
                Cell.Maybe(d.NeedLitres, XlsxStyle.TwoDecimals),
                Cell.Maybe(d.AvgMoisturePercent, XlsxStyle.OneDecimal),
                Cell.Maybe(d.AreaMaxC, XlsxStyle.OneDecimal),
                Cell.Maybe(d.LocalMaxC, XlsxStyle.OneDecimal),
                Cell.Maybe(d.AreaHumidity, XlsxStyle.OneDecimal),
                Cell.Maybe(d.LocalHumidity, XlsxStyle.OneDecimal),
                Cell.Maybe(d.RainMm, XlsxStyle.OneDecimal),
                Cell.Of(d.Note));
        }

        sheet.Add(
            Cell.Of("Week total / average", XlsxStyle.Total),
            Cell.Of(m.TotalRuns, XlsxStyle.TotalInteger),
            Cell.Of(m.TotalMinutes, XlsxStyle.TotalOneDecimal),
            Cell.Maybe(m.TotalLitres, XlsxStyle.TotalOneDecimal),
            Cell.Maybe(m.TotalNeedLitres, XlsxStyle.TotalOneDecimal),
            Cell.Maybe(m.AvgMoisturePercent, XlsxStyle.TotalOneDecimal),
            Cell.Maybe(m.AvgAreaTempC, XlsxStyle.TotalOneDecimal),
            Cell.Maybe(m.AvgLocalTempC, XlsxStyle.TotalOneDecimal),
            Cell.Maybe(m.AvgAreaHumidity, XlsxStyle.TotalOneDecimal),
            Cell.Maybe(m.AvgLocalHumidity, XlsxStyle.TotalOneDecimal),
            Cell.Of(m.TotalRainMm, XlsxStyle.TotalOneDecimal),
            Cell.Of("", XlsxStyle.Total));

        return sheet;
    }

    /* ------------------------------------------------------------------ *
     * Sheet 3 — Weather comparison
     * ------------------------------------------------------------------ */

    private static Sheet WeatherSheet(WaterUsageReportModel m)
    {
        var sheet = new Sheet
        {
            Name = "Weather comparison",
            ColumnWidths = new[] { 16.0, 14.0, 14.0, 15.0, 17.0, 16.0, 15.0, 26.0 },
        };

        sheet.Add(Cell.Of("Weather: area forecast vs conditions at the crop", XlsxStyle.Title));
        sheet.Add(Cell.Of(
            "Area = the weather app (Open-Meteo). Local = the AgroFlow DHT11 installed in this irrigation zone. " +
            "Local crop conditions can differ naturally from the wider area.",
            XlsxStyle.Note));
        sheet.AddBlank();

        sheet.Add(
            Cell.Of("Date", XlsxStyle.TableHeader),
            Cell.Of("Area max °C", XlsxStyle.TableHeader),
            Cell.Of("Local max °C", XlsxStyle.TableHeader),
            Cell.Of("Difference °C", XlsxStyle.TableHeader),
            Cell.Of("Area humidity %", XlsxStyle.TableHeader),
            Cell.Of("Local humidity %", XlsxStyle.TableHeader),
            Cell.Of("Difference %", XlsxStyle.TableHeader),
            Cell.Of("Rain (mm)", XlsxStyle.TableHeader));

        foreach (var d in m.Days)
        {
            sheet.Add(
                Cell.Of(d.LongLabel),
                Cell.Maybe(d.AreaMaxC, XlsxStyle.OneDecimal),
                Cell.Maybe(d.LocalMaxC, XlsxStyle.OneDecimal),
                Cell.Maybe(Difference(d.LocalMaxC, d.AreaMaxC), XlsxStyle.OneDecimal),
                Cell.Maybe(d.AreaHumidity, XlsxStyle.OneDecimal),
                Cell.Maybe(d.LocalHumidity, XlsxStyle.OneDecimal),
                Cell.Maybe(Difference(d.LocalHumidity, d.AreaHumidity), XlsxStyle.OneDecimal),
                Cell.Maybe(d.RainMm, XlsxStyle.OneDecimal));
        }

        sheet.Add(
            Cell.Of("Average", XlsxStyle.Total),
            Cell.Maybe(m.AvgAreaTempC, XlsxStyle.TotalOneDecimal),
            Cell.Maybe(m.AvgLocalTempC, XlsxStyle.TotalOneDecimal),
            Cell.Maybe(Difference(m.AvgLocalTempC, m.AvgAreaTempC), XlsxStyle.TotalOneDecimal),
            Cell.Maybe(m.AvgAreaHumidity, XlsxStyle.TotalOneDecimal),
            Cell.Maybe(m.AvgLocalHumidity, XlsxStyle.TotalOneDecimal),
            Cell.Maybe(Difference(m.AvgLocalHumidity, m.AvgAreaHumidity), XlsxStyle.TotalOneDecimal),
            Cell.Of(m.TotalRainMm, XlsxStyle.TotalOneDecimal));

        sheet.AddBlank();

        if (m.AvgLocalTempC is { } local && m.AvgAreaTempC is { } area)
        {
            var warmer = local - area >= 0 ? "warmer" : "cooler";

            sheet.Add(Cell.Of(
                $"At the crop it was on average " +
                $"{Math.Abs(local - area).ToString("0.0", CultureInfo.InvariantCulture)} °C {warmer} than the " +
                "area forecast. AgroFlow uses the area forecast for its water calculations and the local " +
                "field sensor as a check on it.",
                XlsxStyle.Bold));
        }

        return sheet;
    }

    /// Rounded like the model's totals: 28.2 - 26 gives 2.1999999999999993 otherwise,
    /// which the workbook would store.
    private static double? Difference(double? a, double? b)
    {
        return a is { } x && b is { } y ? Math.Round(x - y, 3) : null;
    }
}
