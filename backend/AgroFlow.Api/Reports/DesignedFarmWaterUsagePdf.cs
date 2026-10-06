namespace AgroFlow.Api.Reports;

/// "All zones": the farm's action report (item 3) - one set of actions and
/// one summary table for the farm, then about a page per zone, the forecast
/// and the weather once, and the appendix with shared notes printed once.
/// Each zone's section comes from the same composer as its own single-zone
/// report, so the two documents can never disagree about a zone.
internal static class DesignedFarmWaterUsagePdf
{
    public static byte[] Render(FarmWaterUsageReport farm) =>
        ActionReportPdf.Render(
            ReportKind.WaterUsage, farm.FarmName, farm.Zones, farm.From, farm.To,
            DateOnly.FromDateTime(farm.GeneratedAtSast.DateTime), farm.GeneratedAtSast);
}
