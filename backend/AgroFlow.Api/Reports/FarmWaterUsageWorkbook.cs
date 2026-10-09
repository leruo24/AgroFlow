using System.Globalization;
using Cell = AgroFlow.Api.Reports.XlsxWriter.Cell;
using Sheet = AgroFlow.Api.Reports.XlsxWriter.Sheet;

namespace AgroFlow.Api.Reports;

/// "All zones" as a workbook: one Summary for the farm, one Daily sheet per zone,
/// and the farm's weather once.
/// Each zone's Litres column is a formula (pump minutes x the zone's flow rate on
/// the Summary sheet), so a farmer who measures their pump at 1.3 L/min instead of
/// 1.5 changes one cell and the whole workbook updates.
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

    /// Where zone i's flow rate is on the Summary sheet, as an absolute reference
    /// other sheets can use. The zone table starts at row 8, so the first zone is row 9.
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
            // Columns B and C are wide for the Advice section.
            ColumnWidths = new[] { 26.0, 40.0, 60.0, 14.0, 13.0, 13.0, 13.0, 13.0 },
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
        // Row FirstZoneRow - 1 is this header, so the first zone is on FirstZoneRow and
        // SummaryFlowCell can point at column E.
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

                // The editable flow rate cell; everything else points here.
                Cell.Maybe(zone.FlowRateLpm, XlsxStyle.OneDecimal),

                // Minutes x rate as a live formula. IFERROR shows blank instead of #VALUE! for a
                // zone with no flow rate; SUM and AVERAGE skip blanks, and 0 would look like the
                // pump delivered nothing (0018).
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

        // Every zone's verdict and advice, each with its "Why".
        var adviceRows = new List<(string Zone, string Advice, string Why)>();
        foreach (var zone in farm.Zones)
        {
            if (zone.Verdict is { } verdict && zone.VerdictWhy is { } verdictWhy)
                adviceRows.Add((zone.ZoneName, "Water this period: " + AgroFlow.Business.Agronomy.RuleBook.VerdictRules.Label(verdict), verdictWhy.Summary));
            foreach (var line in zone.Advice)
                adviceRows.Add((zone.ZoneName, line.Message, line.Why?.Summary ?? ""));
        }

        if (adviceRows.Count > 0)
        {
            sheet.AddBlank();
            sheet.Add(Cell.Of("Advice", XlsxStyle.SectionHeader),
                      Cell.Of("", XlsxStyle.SectionHeader), Cell.Of("", XlsxStyle.SectionHeader));
            sheet.Add(Cell.Of("Zone", XlsxStyle.TableHeader),
                      Cell.Of("Advice", XlsxStyle.TableHeader),
                      Cell.Of("Why", XlsxStyle.TableHeader));
            foreach (var (zoneName, advice, why) in adviceRows)
            {
                sheet.Add(Cell.Of(zoneName), Cell.Of(advice), Cell.Of(why, XlsxStyle.Note));
            }
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
            Cell.Of("Local max temp (°C)", XlsxStyle.TableHeader),
            Cell.Of("Area humidity (%)", XlsxStyle.TableHeader),
            Cell.Of("Local humidity (%)", XlsxStyle.TableHeader),
            Cell.Of("Rain (mm)", XlsxStyle.TableHeader),
            Cell.Of("Note", XlsxStyle.TableHeader));

        // The header is row 4, so the first day is row 5.
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
                Cell.Maybe(d.LocalMaxC, XlsxStyle.OneDecimal),
                Cell.Maybe(d.AreaHumidity, XlsxStyle.OneDecimal),
                Cell.Maybe(d.LocalHumidity, XlsxStyle.OneDecimal),
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

            // AVERAGE, not SUM: these are percentages and temperatures. Blanks are skipped,
            // so a sensor outage does not lower the average.
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

        sheet.Add(Cell.Of("Weather: area forecast vs conditions at the crop", XlsxStyle.Title));
        sheet.Add(Cell.Of(
            "Area = the weather app (Open-Meteo), which is the same for the whole farm. " +
            "Local = AgroFlow DHT11 sensors, averaged across the irrigation zones that reported.",
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

        var firstRow = 5;
        var days = farm.WeatherDays;

        for (var i = 0; i < days.Count; i++)
        {
            var d = days[i];
            var row = firstRow + i;

            sheet.Add(
                Cell.Of(d.LongLabel),
                Cell.Maybe(d.AreaMaxC, XlsxStyle.OneDecimal),
                Cell.Maybe(farm.LocalTempOn(d.Date), XlsxStyle.OneDecimal),
                Cell.Calc($"IFERROR(C{row}-B{row},\"\")", XlsxStyle.OneDecimal),
                Cell.Maybe(d.AreaHumidity, XlsxStyle.OneDecimal),
                Cell.Maybe(farm.LocalHumidityOn(d.Date), XlsxStyle.OneDecimal),
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
