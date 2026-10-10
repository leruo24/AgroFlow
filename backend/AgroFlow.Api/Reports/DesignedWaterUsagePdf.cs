namespace AgroFlow.Api.Reports;

/// The single-zone water usage PDF, rendered as the action report (ActionReportPdf).
/// The class name is kept because callers and tests use it.
internal static class DesignedWaterUsagePdf
{
    /// On every page, so even a single page says the litres are estimates: there is
    /// no flow meter on any AgroFlow node.
    internal const string EstimateNote =
        "Litres are estimated (pump running time × flow rate). " +
        "Soil moisture is relative to this zone's setup.";

    public static byte[] Render(WaterUsageReportModel m) =>
        ActionReportPdf.Render(
            ReportKind.WaterUsage, m.FarmName, new[] { m }, m.From, m.To,
            DateOnly.FromDateTime(m.GeneratedAtSast.DateTime), m.GeneratedAtSast);
}
