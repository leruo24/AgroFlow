namespace AgroFlow.Api.Reports;

/// "All zones": the farm's action report. One set of actions and a summary table,
/// then about a page per zone, the forecast and weather once, and the appendix with
/// shared notes once. Each zone's section uses the same code as its own report,
/// so the two never disagree.
internal static class DesignedFarmWaterUsagePdf
{
    public static byte[] Render(FarmWaterUsageReport farm) =>
        ActionReportPdf.Render(
            ReportKind.WaterUsage, farm.FarmName, farm.Zones, farm.From, farm.To,
            DateOnly.FromDateTime(farm.GeneratedAtSast.DateTime), farm.GeneratedAtSast);
}
