using System.Globalization;
using QuestPDF.Fluent;
using QuestPDF.Infrastructure;

namespace AgroFlow.Api.Reports;

/// "All zones": the farm's week, then each zone's week, then the weather once.
///
/// WHY THE SUMMARY COMES FIRST AND THE WEATHER LAST
/// A farmer opening this wants one number - did the farm get roughly what it
/// needed - and then wants to know which block is the problem. So page one is
/// the totals and a line per zone, with the zone that needs attention visible
/// without turning a page. The per-zone sections answer "why" for whichever
/// one they picked out. The weather is the same for every zone on the farm,
/// so repeating it per zone would be three identical charts; it goes once, at
/// the end, where it explains the week rather than interrupting it.
///
/// Each zone's section is rendered by exactly the code that renders that
/// zone's own single-zone report. That is deliberate: a farmer who pulls both
/// documents must not find them disagreeing about the same zone.
internal static class DesignedFarmWaterUsagePdf
{
    public static byte[] Render(FarmWaterUsageReport farm)
    {
        return Document.Create(doc =>
        {
            doc.Page(page =>
            {
                ReportShell.ApplyPageDefaults(page);
                Shell(page, farm);
                page.Content().PaddingHorizontal(34).PaddingTop(18).Column(col => Summary(col, farm));
            });

            foreach (var zone in farm.Zones)
            {
                // Two pages per zone, matching the single-zone report's own
                // first two: the week's water, then the needs, moisture and
                // advice. Its page three is the weather and the daily table -
                // the weather is farm-wide and printed once at the end, and
                // the daily table goes with it.
                doc.Page(page =>
                {
                    ReportShell.ApplyPageDefaults(page);
                    Shell(page, farm);

                    page.Content().PaddingHorizontal(34).PaddingTop(18).Column(col =>
                    {
                        ReportShell.ZoneHeading(col, zone.ZoneName, zone.CropLabel);
                        DesignedWaterUsagePdf.PageOne(col, zone);
                    });
                });

                doc.Page(page =>
                {
                    ReportShell.ApplyPageDefaults(page);
                    Shell(page, farm);

                    page.Content().PaddingHorizontal(34).PaddingTop(18).Column(col =>
                    {
                        ReportShell.ZoneHeading(col, zone.ZoneName, zone.CropLabel);
                        DesignedWaterUsagePdf.PageTwo(col, zone);
                    });
                });
            }

            doc.Page(page =>
            {
                ReportShell.ApplyPageDefaults(page);
                Shell(page, farm);
                page.Content().PaddingHorizontal(34).PaddingTop(18).Column(col => Weather(col, farm));
            });
        }).GeneratePdf();
    }

    private static void Shell(PageDescriptor page, FarmWaterUsageReport farm)
    {
        page.Header().Element(c => ReportShell.Header(
            c,
            "Water Usage Report",
            $"{farm.FarmName}  ·  {ZoneCount(farm)}  ·  {FarmWaterUsageReportBuilder.DescribePeriod(farm.From, farm.To)}",
            ReportShell.GeneratedLine(farm.GeneratedAtSast)));

        page.Footer().Element(c => ReportShell.Footer(c, DesignedWaterUsagePdf.EstimateNote));
    }

    private static string ZoneCount(FarmWaterUsageReport farm) =>
        farm.Zones.Count == 1 ? "1 zone" : $"all {farm.Zones.Count} zones";

    /* ------------------------------------------------------------------ *
     * Page 1 — the farm
     * ------------------------------------------------------------------ */

    private static void Summary(ColumnDescriptor col, FarmWaterUsageReport farm)
    {
        col.Item().Row(row =>
        {
            void Tile(string value, string label)
            {
                row.RelativeItem().PaddingRight(8).Background(ReportTheme.Surface)
                    .Padding(12).Column(c =>
                    {
                        c.Item().Text(value).FontSize(16).Bold().FontColor(ReportTheme.Brand);
                        c.Item().PaddingTop(2).Text(label).FontSize(8).FontColor(ReportTheme.Muted);
                    });
            }

            Tile(
                farm.TotalLitres is { } litres ? $"~{ReportShell.Num(litres, 1)} L" : "No estimate",
                farm.TotalLitres is null ? "No zone has a flow rate" : "Estimated across the farm");

            Tile($"{farm.TotalRuns}", $"Pump runs ({ReportShell.Num(farm.TotalMinutes, 0)} min total)");

            Tile($"{farm.Zones.Count}", farm.Zones.Count == 1 ? "Zone" : "Zones");

            Tile($"{farm.DaysTooDryAcrossZones}", "Zone-days too dry");
        });

        col.Item().PaddingTop(16).Background(ReportTheme.CalloutFill)
            .BorderLeft(3).BorderColor(ReportTheme.Teal)
            .Padding(14).Column(c =>
            {
                c.Item().Text("How your system works")
                    .FontSize(10).Bold().FontColor(ReportTheme.Brand);

                c.Item().PaddingTop(6).Text(HowTheFarmWorks(farm)).FontSize(9).LineHeight(1.45f);
            });

        ReportShell.Heading(col, "Every zone this week");

        if (farm.Zones.Count == 0)
        {
            col.Item().Text(
                "This farm has no active zones, so there is nothing to report on yet. " +
                "Add a zone and its kit, and next week's report will have figures in it.")
                .FontSize(9);
            return;
        }

        col.Item().Element(c => ZoneTable(c, farm));

        if (farm.ZonesWithoutEstimate.Count > 0)
        {
            // Said out loud rather than left as a dash in a table. A farm
            // total quietly missing a zone is the kind of error somebody acts
            // on without knowing they are acting on it.
            col.Item().PaddingTop(10).Background("#FDF6E6")
                .BorderLeft(3).BorderColor(ReportTheme.WeatherTub)
                .Padding(12)
                .Text(
                    $"{string.Join(", ", farm.ZonesWithoutEstimate)} " +
                    $"{(farm.ZonesWithoutEstimate.Count == 1 ? "has" : "have")} no flow rate on file, so " +
                    $"{(farm.ZonesWithoutEstimate.Count == 1 ? "it is" : "they are")} not in the farm's " +
                    "water total. Set a flow rate on the zone and it will be included.")
                .FontSize(9);
        }

        if (farm.TotalNeedLitres is { } need && farm.TotalLitres is { } got)
        {
            var difference = got - need;
            var direction = difference >= 0 ? "more than" : "less than";

            var verdict = Math.Abs(difference) < need * 0.15
                ? "That's about right for the farm as a whole."
                : difference > 0
                    ? "That's a surplus across the farm - the zone table above shows where."
                    : "That's short across the farm - the zone table above shows where.";

            ReportShell.ChartNote(col,
                $"Across every zone we can estimate, the crops needed about {ReportShell.Num(need, 0)} L " +
                $"and got about {ReportShell.Num(got, 1)} L - {ReportShell.Num(Math.Abs(difference), 1)} L " +
                $"{direction} needed. {verdict}");
        }
    }

    private static string HowTheFarmWorks(FarmWaterUsageReport farm)
    {
        var crops = farm.Zones
            .Select(z => z.CropLabel)
            .Where(c => !string.IsNullOrWhiteSpace(c))
            .Select(c => c!.ToLowerInvariant())
            .Distinct()
            .ToList();

        // The verb has to agree with the list, and the list is built from
        // whatever crops the farm happens to have - so one crop reads "your
        // tomato needs" and three read "your tomato, maize and citrus need".
        var (cropText, verb) = crops.Count switch
        {
            0 => ("your crops", "need"),
            1 => ($"your {crops[0]}", "needs"),
            2 => ($"your {crops[0]} and {crops[1]}", "need"),
            _ => ($"your {string.Join(", ", crops.Take(crops.Count - 1))} and {crops[^1]}", "need"),
        };

        var theirIts = crops.Count == 1 ? "its" : "their";

        return
            "Each zone has a soil moisture sensor in the soil, a temperature and humidity sensor " +
            "(DHT11) next to the plants, and a pump. Weather for your area comes from the weather " +
            $"app (Open-Meteo). AgroFlow uses the FAO-56 method to work out how much water {cropText} " +
            $"{verb} at {theirIts} current growth stage, zone by zone - which is why a zone can be " +
            "short while the farm as a whole looks fine.";
    }

    private static void ZoneTable(IContainer container, FarmWaterUsageReport farm)
    {
        container.Table(table =>
        {
            table.ColumnsDefinition(c =>
            {
                c.RelativeColumn(2.2f); c.RelativeColumn(1.4f); c.RelativeColumn(2.2f);
                c.RelativeColumn(1.2f); c.RelativeColumn(1.3f); c.RelativeColumn(1.2f);
            });

            table.Header(h =>
            {
                ReportShell.HeadCell(h, "Zone");
                ReportShell.HeadCell(h, "Crop");
                ReportShell.HeadCell(h, "Growth stage");
                ReportShell.HeadCell(h, "Litres (est.)");
                ReportShell.HeadCell(h, "Needed (L)");
                ReportShell.HeadCell(h, "Days too dry");
            });

            var striped = false;

            foreach (var zone in farm.Zones)
            {
                striped = !striped;
                var fill = striped ? ReportShell.Stripe : ReportTheme.Surface;

                ReportShell.BodyCell(table, zone.ZoneName, fill);
                ReportShell.BodyCell(table, zone.CropLabel ?? "Not set", fill);
                ReportShell.BodyCell(table, zone.GrowthStage ?? "Not known", fill);

                // "No estimate", not 0 - see migration 0018.
                ReportShell.BodyCell(table,
                    zone.TotalLitres is { } l ? ReportShell.Num(l, 1) : "No estimate", fill);

                ReportShell.BodyCell(table, ReportShell.Opt(zone.TotalNeedLitres, 1), fill);
                ReportShell.BodyCell(table, zone.DaysTooDry.ToString(CultureInfo.InvariantCulture), fill);
            }

            ReportShell.TotalCell(table, "Whole farm");
            ReportShell.TotalCell(table, "");
            ReportShell.TotalCell(table, "");
            ReportShell.TotalCell(table,
                farm.TotalLitres is { } tl ? ReportShell.Num(tl, 1) : "—");
            ReportShell.TotalCell(table, ReportShell.Opt(farm.TotalNeedLitres, 1));
            ReportShell.TotalCell(table,
                farm.DaysTooDryAcrossZones.ToString(CultureInfo.InvariantCulture));
        });
    }

    /* ------------------------------------------------------------------ *
     * Last page — the farm's weather
     * ------------------------------------------------------------------ */

    private static void Weather(ColumnDescriptor col, FarmWaterUsageReport farm)
    {
        ReportShell.Heading(col, "Weather: area forecast vs in the tubs");

        var days = farm.WeatherDays;

        if (days.Count == 0)
        {
            col.Item().Text("There is no weather on file for this farm over these dates.").FontSize(9);
            return;
        }

        col.Item().Height(165).Svg(ChartSvg.TwoLines(
            days.Select(d => d.ShortLabel).ToList(),
            days.Select(d => d.AreaMaxC).ToList(),
            days.Select(d => farm.TubTempOn(d.Date)).ToList(),
            "Area forecast max °C (weather app)",
            "In the tubs max °C (averaged)",
            "°C"));

        col.Item().PaddingTop(8).Element(c => WeatherTable(c, farm));

        col.Item().PaddingTop(8).Background("#FDF6E6")
            .BorderLeft(3).BorderColor(ReportTheme.WeatherTub)
            .Padding(12)
            .Text(WeatherNote(farm)).FontSize(9);

        col.Item().PaddingTop(12).Background(ReportTheme.Surface).Padding(10).Column(c =>
        {
            c.Item().Text("Words used in this report").FontSize(9).Bold();

            c.Item().PaddingTop(4).Text(t =>
            {
                t.Span("Crop water need: ").Bold().FontSize(8.5f);
                t.Span("how much water the plants used, worked out from the weather and their growth stage.")
                    .FontSize(8.5f);
            });

            c.Item().Text(t =>
            {
                t.Span("Relative soil moisture: ").Bold().FontSize(8.5f);
                t.Span("100% = soaked and drained, 0% = dry, based on each zone's own setup.").FontSize(8.5f);
            });

            c.Item().Text(t =>
            {
                t.Span("Area forecast: ").Bold().FontSize(8.5f);
                t.Span("weather for your location from the weather app, not measured on site.").FontSize(8.5f);
            });
        });
    }

    private static void WeatherTable(IContainer container, FarmWaterUsageReport farm)
    {
        container.Table(table =>
        {
            table.ColumnsDefinition(c =>
            {
                c.RelativeColumn(1.4f);
                c.RelativeColumn(); c.RelativeColumn(); c.RelativeColumn(1.1f);
                c.RelativeColumn(1.2f); c.RelativeColumn(1.2f); c.RelativeColumn(1.1f);
            });

            table.Header(h =>
            {
                ReportShell.HeadCell(h, "Day");
                ReportShell.HeadCell(h, "Area max °C");
                ReportShell.HeadCell(h, "Tubs max °C");
                ReportShell.HeadCell(h, "Difference");
                ReportShell.HeadCell(h, "Area humidity %");
                ReportShell.HeadCell(h, "Tubs humidity %");
                ReportShell.HeadCell(h, "Difference");
            });

            var striped = false;

            foreach (var d in farm.WeatherDays)
            {
                striped = !striped;
                var fill = striped ? ReportShell.Stripe : ReportTheme.Surface;

                var tubTemp = farm.TubTempOn(d.Date);
                var tubHumidity = farm.TubHumidityOn(d.Date);

                ReportShell.BodyCell(table, d.LongLabel, fill);
                ReportShell.BodyCell(table, ReportShell.Opt(d.AreaMaxC, 0), fill);
                ReportShell.BodyCell(table, ReportShell.Opt(tubTemp, 1), fill);
                ReportShell.BodyCell(table, ReportShell.Delta(tubTemp, d.AreaMaxC, 1, " °C"), fill);
                ReportShell.BodyCell(table, ReportShell.Opt(d.AreaHumidity, 0), fill);
                ReportShell.BodyCell(table, ReportShell.Opt(tubHumidity, 0), fill);
                ReportShell.BodyCell(table, ReportShell.Delta(tubHumidity, d.AreaHumidity, 0, "%"), fill);
            }
        });
    }

    private static string WeatherNote(FarmWaterUsageReport farm)
    {
        if (farm.AvgTubTempC is not { } tub || farm.AvgAreaTempC is not { } area)
        {
            return
                "There is not enough paired data this week to compare the area forecast with the " +
                "sensors on the farm. AgroFlow uses the area forecast for its water calculations " +
                "either way; the tub sensors are a check on it, not an input to it.";
        }

        var tempDiff = tub - area;
        var humidityDiff = (farm.AvgTubHumidity ?? 0) - (farm.AvgAreaHumidity ?? 0);

        var warmer = tempDiff >= 0 ? "warmer" : "cooler";
        var humid = humidityDiff >= 0 ? "more humid" : "drier";

        return
            $"Across the farm's tubs it was on average {ReportShell.Num(Math.Abs(tempDiff), 1)} °C " +
            $"{warmer} and {ReportShell.Num(Math.Abs(humidityDiff), 0)}% {humid} than the area " +
            "forecast. That's normal for sheltered tubs, and it's why AgroFlow uses the area " +
            "forecast for its water calculations and the tub sensors as a check.";
    }
}
