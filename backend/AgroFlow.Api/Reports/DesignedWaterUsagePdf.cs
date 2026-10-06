namespace AgroFlow.Api.Reports;

/// The single-zone water usage PDF.
///
/// Item 3 replaced the three-page designed layout with the action report
/// (ActionReportPdf): "This week, do this" first, the period described by its
/// real length, weekly charts past two weeks, jargon only in the appendix.
/// This name stays because callers and tests know it; it renders exactly what
/// the endpoints render.
internal static class DesignedWaterUsagePdf
{
    /// On every page, deliberately. A reader who only has one page in their
    /// hand still has to know the litres are inferred - there is no flow
    /// meter on any AgroFlow node.
    internal const string EstimateNote =
        "Litres are estimated (pump running time × flow rate). " +
        "Soil moisture is relative to this zone's setup.";

    public static byte[] Render(WaterUsageReportModel m) =>
        ActionReportPdf.Render(
            ReportKind.WaterUsage, m.FarmName, new[] { m }, m.From, m.To,
            DateOnly.FromDateTime(m.GeneratedAtSast.DateTime), m.GeneratedAtSast);
}
