using AgroFlow.Api.Reports;
using static AgroFlow.Domain.Tests.ActionReportTests;

namespace AgroFlow.Domain.Tests;

// Item 3: docs/sample-reports - every report type, one zone and all zones,
// for a full setup, a partial setup and a farm with no kit. Generated from
// in-memory engine runs (sample data lives only in tests and that folder,
// never in production code).
//
//   AGROFLOW_WRITE_SAMPLES=1 dotnet test --filter SampleReports
//
// Without the variable this still renders every combination, so a layout
// that breaks for one of them fails the suite.
public class SampleReportsTests
{
    static SampleReportsTests()
    {
        QuestPDF.Settings.License = QuestPDF.Infrastructure.LicenseType.Community;
    }

    [Fact]
    public void EveryCombination_Renders_AndIsWrittenOnRequest()
    {
        var write = Environment.GetEnvironmentVariable("AGROFLOW_WRITE_SAMPLES") == "1";
        var folder = Path.Combine(FindRepoRoot(), "docs", "sample-reports");
        if (write) Directory.CreateDirectory(folder);

        foreach (var setup in Enum.GetValues<Setup>())
        {
            var name = setup.ToString().ToLowerInvariant().Replace("nokit", "no-kit");
            var one = Zone("Tub 1", setup, 7);
            var farmZones = new[] { one, Zone("Tub 2", setup, 7), Zone("Veg Block", setup, 7, dry: false) };

            foreach (var kind in Enum.GetValues<ReportKind>())
            {
                var k = kind.ToString().ToLowerInvariant();
                var single = ActionReportPdf.Render(kind, "Green Farm", new[] { one }, one.From, one.To, Today, one.GeneratedAtSast);
                var all = ActionReportPdf.Render(kind, "Green Farm", farmZones, one.From, one.To, Today, one.GeneratedAtSast);
                Assert.True(single.Length > 1000 && all.Length > 1000);

                if (write)
                {
                    File.WriteAllBytes(Path.Combine(folder, $"{k}-one-zone-{name}.pdf"), single);
                    File.WriteAllBytes(Path.Combine(folder, $"{k}-all-zones-{name}.pdf"), all);
                }
            }

            var month = Zone("Tub 1", setup, 30);
            var monthPdf = ActionReportPdf.Render(ReportKind.WaterUsage, "Green Farm", new[] { month }, month.From, month.To, Today, month.GeneratedAtSast);
            var xlsx = WaterUsageWorkbook.Render(one);
            var farmXlsx = FarmWaterUsageWorkbook.Render(new FarmWaterUsageReport
            {
                FarmName = "Green Farm", From = one.From, To = one.To, GeneratedAtSast = one.GeneratedAtSast, Zones = farmZones,
            });

            if (write)
            {
                File.WriteAllBytes(Path.Combine(folder, $"waterusage-one-zone-30-days-{name}.pdf"), monthPdf);
                File.WriteAllBytes(Path.Combine(folder, $"waterusage-one-zone-{name}.xlsx"), xlsx);
                File.WriteAllBytes(Path.Combine(folder, $"waterusage-all-zones-{name}.xlsx"), farmXlsx);
            }
        }
    }

    private static string FindRepoRoot()
    {
        var directory = new DirectoryInfo(AppContext.BaseDirectory);
        while (directory is not null)
        {
            if (Directory.Exists(Path.Combine(directory.FullName, "supabase", "migrations"))) return directory.FullName;
            directory = directory.Parent;
        }
        throw new DirectoryNotFoundException("Could not find the repo root above " + AppContext.BaseDirectory);
    }
}
