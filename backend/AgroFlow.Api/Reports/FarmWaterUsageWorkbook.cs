using System.Globalization;
using Cell = AgroFlow.Api.Reports.XlsxWriter.Cell;
using Sheet = AgroFlow.Api.Reports.XlsxWriter.Sheet;

namespace AgroFlow.Api.Reports;

/// "All zones" as a workbook: one Summary across the farm, one Daily sheet per
/// zone, and the farm's weather once.
///
/// WHY THE FLOW RATE LIVES ON THE SUMMARY SHEET
/// Each zone's Litres column is an Excel formula - pump minutes times that
/// zone's flow rate, read from a named cell on Summary. A farmer who measures
/// their pump at 1.3 L/min rather than the 1.5 on file changes one cell and
/// the whole workbook follows, which is the difference between a document
/// they can check and one they have to believe.
internal static class FarmWaterUsageWorkbook
{
    public static byte[] Render(FarmWaterUsageReport farm)
    {
        var sheets = new List<Sheet> { SummarySheet(farm) };

        // One per zone, in the order the summary lists them.
        for (var i = 0; i < farm.Zones.Count; i++)
        {
            sheets.Add(DailySheet(farm.Zones[i], SummaryFlowCell(i)));
        }

        sheets.Add(WeatherSheet(farm));

        return XlsxWriter.Build(sheets);
    }

    /// Where zone i's flow rate sits on the Summary sheet, as an absolute
    /// reference a formula on another sheet can point at.
    ///
    /// The zone table starts at row 8 (title, farm, period, blank, "The farm",
    /// header, totals, blank → first zone on 9). Absolute, so the reference
    /// survives a reader inserting a column.
    private static string SummaryFlowCell(int zoneIndex) =>
        $"Summary!$E${FirstZoneRow + zoneIndex}";

    private const int FirstZoneRow = 12;

    /* ------------------------------------------------------------------ *
     * Sheet 1 — the farm
     * ------------------------------------------------------------------ */

    private static Sheet SummarySheet(FarmWaterUsageReport farm)
    {
        var sheet = new Sheet
        {
            Name = "Summary",
            ColumnWidths = new[] { 26.0, 14.0, 22.0, 14.0, 13.0, 13.0, 13.0, 13.0 },
        };

        sheet.Add(Cell.Of("AgroFlow — Water Usage Data (all zones)", XlsxStyle.Title));
        sheet.Add(Cell.Of($"Farm: {farm.FarmName}", XlsxStyle.Subtitle));
        sheet.Add(Cell.Of(
            $"Period: {FarmWaterUsageReportBuilder.DescribePeriod(farm.From, farm.To)}   ·   Generated " +
            $"{farm.GeneratedAtSast.ToString("d MMM yyyy HH:mm", CultureInfo.InvariantCulture)} SAST",
            XlsxStyle.Subtitle));
        sheet.AddBlank();

        /* ---- the whole farm ------------------------------------------- */
        sheet.Add(Cell.Of("The whole farm", XlsxStyle.SectionHeader),
                  Cell.Of("", XlsxStyle.SectionHeader), Cell.Of("", XlsxStyle.SectionHeader),
                  Cell.Of("", XlsxStyle.SectionHeader), Cell.Of("", XlsxStyle.SectionHeader),
                  Cell.Of("", XlsxStyle.SectionHeader), Cell.Of("", XlsxStyle.SectionHeader),
                  Cell.Of("", XlsxStyle.SectionHeader));

        sheet.Add(Cell.Of("Zones", XlsxStyle.Bold), Cell.Of(farm.Zones.Count, XlsxStyle.Integer));
        sheet.Add(Cell.Of("Pump runs", XlsxStyle.Bold), Cell.Of(farm.TotalRuns, XlsxStyle.Integer));
        sheet.Add(Cell.Of("Total pump minutes", XlsxStyle.Bold), Cell.Of(farm.TotalMinutes, XlsxStyle.OneDecimal));
        sheet.AddBlank();

        /* ---- a line per zone ------------------------------------------ */
        // Row FirstZoneRow - 1 is this header, so the first zone lands on
        // FirstZoneRow and SummaryFlowCell can point at column E.
        sheet.Add(
            Cell.Of("Zone", XlsxStyle.TableHeader),
            Cell.Of("Crop", XlsxStyle.TableHeader),
            Cell.Of("Growth stage", XlsxStyle.TableHeader),
            Cell.Of("Pump minutes", XlsxStyle.TableHeader),
            Cell.Of("Flow rate (L/min)", XlsxStyle.TableHeader),
            Cell.Of("Litres (est.)", XlsxStyle.TableHeader),
            Cell.Of("Crop need (L)", XlsxStyle.TableHeader),
            Cell.Of("Days too dry", XlsxStyle.TableHeader));

        for (var i = 0; i < farm.Zones.Count; i++)
        {
            var zone = farm.Zones[i];
            var row = FirstZoneRow + i;

            sheet.Add(
                Cell.Of(zone.ZoneName),
                Cell.Of(zone.CropLabel ?? "Not set"),
                Cell.Of(zone.GrowthStage ?? "Not known"),
                Cell.Of(zone.TotalMinutes, XlsxStyle.OneDecimal),

                // THE editable cell. Everything downstream points here.
                Cell.Maybe(zone.FlowRateLpm, XlsxStyle.OneDecimal),

                // Minutes times rate, live. IFERROR rather than a bare
                // product so a zone with no flow rate shows blank instead of
                // #VALUE! - blank is what SUM and AVERAGE ignore, and 0 would
                // read as a pump that ran and delivered nothing (0018).
                Cell.Calc($"IFERROR(D{row}*E{row},\"\")", XlsxStyle.OneDecimal),

                Cell.Maybe(zone.TotalNeedLitres, XlsxStyle.OneDecimal),
                Cell.Of(zone.DaysTooDry, XlsxStyle.Integer));
        }

        if (farm.Zones.Count > 0)
        {
            var first = FirstZoneRow;
            var last = FirstZoneRow + farm.Zones.Count - 1;

            sheet.Add(
                Cell.Of("Whole farm", XlsxStyle.Total),
                Cell.Of("", XlsxStyle.Total),
                Cell.Of("", XlsxStyle.Total),
                Cell.Calc($"SUM(D{first}:D{last})", XlsxStyle.TotalOneDecimal),
                Cell.Of("", XlsxStyle.Total),
                Cell.Calc($"SUM(F{first}:F{last})", XlsxStyle.TotalOneDecimal),
                Cell.Calc($"SUM(G{first}:G{last})", XlsxStyle.TotalOneDecimal),
                Cell.Calc($"SUM(H{first}:H{last})", XlsxStyle.TotalInteger));
        }

        sheet.AddBlank();
        sheet.Add(Cell.Of("Notes", XlsxStyle.SectionHeader),
                  Cell.Of("", XlsxStyle.SectionHeader), Cell.Of("", XlsxStyle.SectionHeader),
                  Cell.Of("", XlsxStyle.SectionHeader), Cell.Of("", XlsxStyle.SectionHeader),
                  Cell.Of("", XlsxStyle.SectionHeader), Cell.Of("", XlsxStyle.SectionHeader),
                  Cell.Of("", XlsxStyle.SectionHeader));

        sheet.Add(Cell.Of(
            "The flow rate column above is the one to change. Every Litres figure here and on each " +
            "zone's sheet is calculated from it, so correcting a pump's rate corrects the whole workbook.",
            XlsxStyle.Note));

        sheet.Add(Cell.Of(
            "Litres are estimated: pump minutes × flow rate. There is no flow meter on any AgroFlow node.",
            XlsxStyle.Note));

        sheet.Add(Cell.Of(
            "Crop water need comes from the FAO-56 method (weather app + crop growth stage) × the zone's area.",
            XlsxStyle.Note));

        sheet.Add(Cell.Of(
            "An empty cell means the figure could not be worked out, which is not the same as zero.",
            XlsxStyle.Note));

        if (farm.ZonesWithoutEstimate.Count > 0)
        {
            sheet.AddBlank();
            sheet.Add(Cell.Of(
                $"No flow rate on file for: {string.Join(", ", farm.ZonesWithoutEstimate)}. " +
                "Those zones are not in the farm's water total. Type a rate into column E and they will be.",
                XlsxStyle.Bold));
        }

        return sheet;
    }

    /* ------------------------------------------------------------------ *
     * One sheet per zone
     * ------------------------------------------------------------------ */

    private static Sheet DailySheet(WaterUsageReportModel zone, string flowCell)
    {
        var sheet = new Sheet
        {
            Name = $"Daily - {zone.ZoneName}",
            ColumnWidths = new[] { 16.0, 11.0, 13.0, 13.0, 16.0, 17.0, 14.0, 13.0, 16.0, 15.0, 10.0, 26.0 },
        };

        var title = string.IsNullOrWhiteSpace(zone.CropLabel)
            ? zone.ZoneName
            : $"{zone.ZoneName} ({zone.CropLabel})";

        sheet.Add(Cell.Of($"Daily data — {title}", XlsxStyle.Title));
        sheet.Add(Cell.Of(
            "Litres (est.) is calculated: pump minutes × this zone's flow rate on the Summary sheet. " +
            "Change the rate there and this column follows.",
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
            Cell.Of("Tub max temp (°C)", XlsxStyle.TableHeader),
            Cell.Of("Area humidity (%)", XlsxStyle.TableHeader),
            Cell.Of("Tub humidity (%)", XlsxStyle.TableHeader),
            Cell.Of("Rain (mm)", XlsxStyle.TableHeader),
            Cell.Of("Note", XlsxStyle.TableHeader));

        // Header is row 4, so the first day is row 5.
        var firstRow = 5;

        for (var i = 0; i < zone.Days.Count; i++)
        {
            var d = zone.Days[i];
            var row = firstRow + i;

            sheet.Add(
                Cell.Of(d.LongLabel),
                Cell.Of(d.PumpRuns, XlsxStyle.Integer),
                Cell.Of(d.PumpMinutes, XlsxStyle.OneDecimal),
                Cell.Calc($"IFERROR(C{row}*{flowCell},\"\")", XlsxStyle.TwoDecimals),
                Cell.Maybe(d.NeedLitres, XlsxStyle.TwoDecimals),
                Cell.Maybe(d.AvgMoisturePercent, XlsxStyle.OneDecimal),
                Cell.Maybe(d.AreaMaxC, XlsxStyle.OneDecimal),
                Cell.Maybe(d.TubMaxC, XlsxStyle.OneDecimal),
                Cell.Maybe(d.AreaHumidity, XlsxStyle.OneDecimal),
                Cell.Maybe(d.TubHumidity, XlsxStyle.OneDecimal),
                Cell.Maybe(d.RainMm, XlsxStyle.OneDecimal),
                Cell.Of(d.Note));
        }

        var lastRow = firstRow + Math.Max(0, zone.Days.Count - 1);

        sheet.Add(
            Cell.Of("Week total / average", XlsxStyle.Total),
            Cell.Calc($"SUM(B{firstRow}:B{lastRow})", XlsxStyle.TotalInteger),
            Cell.Calc($"SUM(C{firstRow}:C{lastRow})", XlsxStyle.TotalOneDecimal),
            Cell.Calc($"SUM(D{firstRow}:D{lastRow})", XlsxStyle.TotalOneDecimal),
            Cell.Calc($"SUM(E{firstRow}:E{lastRow})", XlsxStyle.TotalOneDecimal),

            // AVERAGE, not SUM: a mean of percentages and temperatures. It
            // ignores blanks, which is why a sensor outage lowers nothing.
            Cell.Calc($"IFERROR(AVERAGE(F{firstRow}:F{lastRow}),\"\")", XlsxStyle.TotalOneDecimal),
            Cell.Calc($"IFERROR(AVERAGE(G{firstRow}:G{lastRow}),\"\")", XlsxStyle.TotalOneDecimal),
            Cell.Calc($"IFERROR(AVERAGE(H{firstRow}:H{lastRow}),\"\")", XlsxStyle.TotalOneDecimal),
            Cell.Calc($"IFERROR(AVERAGE(I{firstRow}:I{lastRow}),\"\")", XlsxStyle.TotalOneDecimal),
            Cell.Calc($"IFERROR(AVERAGE(J{firstRow}:J{lastRow}),\"\")", XlsxStyle.TotalOneDecimal),
            Cell.Calc($"SUM(K{firstRow}:K{lastRow})", XlsxStyle.TotalOneDecimal),
            Cell.Of("", XlsxStyle.Total));

        return sheet;
    }

    /* ------------------------------------------------------------------ *
     * The farm's weather, once
     * ------------------------------------------------------------------ */

    private static Sheet WeatherSheet(FarmWaterUsageReport farm)
    {
        var sheet = new Sheet
        {
            Name = "Weather comparison",
            ColumnWidths = new[] { 16.0, 14.0, 14.0, 15.0, 17.0, 16.0, 15.0, 13.0 },
        };

        sheet.Add(Cell.Of("Weather: area forecast vs in the tubs", XlsxStyle.Title));
        sheet.Add(Cell.Of(
            "Area = the weather app (Open-Meteo), which is the same for the whole farm. " +
            "Tubs = the DHT11 sensors, averaged across the zones that reported.",
            XlsxStyle.Note));
        sheet.AddBlank();

        sheet.Add(
            Cell.Of("Date", XlsxStyle.TableHeader),
            Cell.Of("Area max °C", XlsxStyle.TableHeader),
            Cell.Of("Tubs max °C", XlsxStyle.TableHeader),
            Cell.Of("Difference °C", XlsxStyle.TableHeader),
            Cell.Of("Area humidity %", XlsxStyle.TableHeader),
            Cell.Of("Tubs humidity %", XlsxStyle.TableHeader),
            Cell.Of("Difference %", XlsxStyle.TableHeader),
            Cell.Of("Rain (mm)", XlsxStyle.TableHeader));

        var firstRow = 5;
        var days = farm.WeatherDays;

        for (var i = 0; i < days.Count; i++)
        {
            var d = days[i];
            var row = firstRow + i;

            sheet.Add(
                Cell.Of(d.LongLabel),
                Cell.Maybe(d.AreaMaxC, XlsxStyle.OneDecimal),
                Cell.Maybe(farm.TubTempOn(d.Date), XlsxStyle.OneDecimal),
                Cell.Calc($"IFERROR(C{row}-B{row},\"\")", XlsxStyle.OneDecimal),
                Cell.Maybe(d.AreaHumidity, XlsxStyle.OneDecimal),
                Cell.Maybe(farm.TubHumidityOn(d.Date), XlsxStyle.OneDecimal),
                Cell.Calc($"IFERROR(F{row}-E{row},\"\")", XlsxStyle.OneDecimal),
                Cell.Maybe(d.RainMm, XlsxStyle.OneDecimal));
        }

        if (days.Count > 0)
        {
            var lastRow = firstRow + days.Count - 1;

            sheet.Add(
                Cell.Of("Average", XlsxStyle.Total),
                Cell.Calc($"IFERROR(AVERAGE(B{firstRow}:B{lastRow}),\"\")", XlsxStyle.TotalOneDecimal),
                Cell.Calc($"IFERROR(AVERAGE(C{firstRow}:C{lastRow}),\"\")", XlsxStyle.TotalOneDecimal),
                Cell.Calc($"IFERROR(AVERAGE(D{firstRow}:D{lastRow}),\"\")", XlsxStyle.TotalOneDecimal),
                Cell.Calc($"IFERROR(AVERAGE(E{firstRow}:E{lastRow}),\"\")", XlsxStyle.TotalOneDecimal),
                Cell.Calc($"IFERROR(AVERAGE(F{firstRow}:F{lastRow}),\"\")", XlsxStyle.TotalOneDecimal),
                Cell.Calc($"IFERROR(AVERAGE(G{firstRow}:G{lastRow}),\"\")", XlsxStyle.TotalOneDecimal),
                Cell.Calc($"SUM(H{firstRow}:H{lastRow})", XlsxStyle.TotalOneDecimal));
        }

        return sheet;
    }
}
