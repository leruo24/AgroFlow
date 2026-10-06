using System.Globalization;
using QuestPDF.Fluent;
using QuestPDF.Helpers;
using QuestPDF.Infrastructure;

namespace AgroFlow.Api.Reports;

/// The designed water usage report: three pages, built to
/// docs/agroflow-report-template.pdf.
///
/// WHO THIS IS WRITTEN FOR
/// A farmer, on a phone, who did not ask for a lesson in evapotranspiration.
/// That is why the first section is "How your system works" in plain
/// sentences, why every chart is explained underneath it in one line rather
/// than captioned above it, and why the last box is a glossary of the three
/// terms the report cannot avoid using. The template's own wording is kept
/// wherever it fits - it is better than anything I would write to replace it.
///
/// WHAT IT NEVER DOES
/// It never prints a number the data does not support. A zone with no flow
/// rate shows "no estimate" rather than 0 L (migration 0018); a day with no
/// reading leaves a gap in the chart rather than a line drawn across it; and
/// a crop with no planting date simply has no growth stage line rather than a
/// guessed one.
internal static class DesignedWaterUsagePdf
{
    public static byte[] Render(WaterUsageReportModel m)
    {
        // Item 2c: every verdict and advice line gets a numbered "Why:", in
        // page order - the verdict on page 2 first, then the advice.
        var why = new ReportWhy();
        why.Add(m.VerdictWhy);
        foreach (var line in m.Advice) why.Add(line.Why);

        return Document.Create(doc =>
        {
            doc.Page(page => BuildPage(page, m, 1, why));
            doc.Page(page => BuildPage(page, m, 2, why));
            doc.Page(page => BuildPage(page, m, 3, why));
            if (why.Notes.Count > 0) doc.Page(page => BuildPage(page, m, 4, why));
        }).GeneratePdf();
    }

    private static void BuildPage(PageDescriptor page, WaterUsageReportModel m, int pageNumber, ReportWhy why)
    {
        ReportShell.ApplyPageDefaults(page);

        page.Header().Element(c => ReportShell.Header(
            c, "Water Usage Report", Subtitle(m), ReportShell.GeneratedLine(m.GeneratedAtSast)));

        page.Content().PaddingHorizontal(34).PaddingTop(18).Column(col =>
        {
            switch (pageNumber)
            {
                case 1: PageOne(col, m); break;
                case 2: PageTwo(col, m, why); break;
                case 3: PageThree(col, m); break;
                default: why.Appendix(col); break;
            }
        });

        page.Footer().Element(c => ReportShell.Footer(c, EstimateNote));
    }

    /// On every page, deliberately. A reader who only has page 3 in their
    /// hand still has to know the litres are inferred - there is no flow
    /// meter on any AgroFlow node.
    internal const string EstimateNote =
        "Litres are estimated (pump running time × flow rate). " +
        "Soil moisture is relative to this zone's setup.";

    /* ------------------------------------------------------------------ *
     * Furniture
     * ------------------------------------------------------------------ */


    internal static string Subtitle(WaterUsageReportModel m)
    {
        var zone = string.IsNullOrWhiteSpace(m.CropLabel)
            ? m.ZoneName
            : $"{m.ZoneName} ({m.CropLabel})";

        return $"{m.FarmName}  ·  {zone}  ·  {Period(m)}";
    }

    /// "28 Sep – 4 Oct 2026". The year appears once, on the end date, unless
    /// the period crosses a year boundary - in which case both carry it,
    /// because "28 Dec – 3 Jan 2027" would otherwise read as one year.
    internal static string Period(WaterUsageReportModel m)
    {
        var from = m.From.ToDateTime(TimeOnly.MinValue);
        var to = m.To.ToDateTime(TimeOnly.MinValue);

        var fromText = from.Year == to.Year
            ? from.ToString("d MMM", CultureInfo.InvariantCulture)
            : from.ToString("d MMM yyyy", CultureInfo.InvariantCulture);

        return $"{fromText} – {to.ToString("d MMM yyyy", CultureInfo.InvariantCulture)}";
    }




    /// The one-line explanation that sits under a chart rather than over it.
    /// Under, because the chart is the thing being explained - a caption above
    /// is read before there is anything to apply it to.

    /* ------------------------------------------------------------------ *
     * Page 1
     * ------------------------------------------------------------------ */

    internal static void PageOne(ColumnDescriptor col, WaterUsageReportModel m)
    {
        /* ---- The four figures ----------------------------------------- */
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
                m.TotalLitres is { } litres ? $"~{ReportShell.Num(litres, 1)} L" : "No estimate",
                m.TotalLitres is null ? "Set a flow rate to estimate" : "Estimated water used");

            Tile($"{m.TotalRuns}", $"Pump runs ({ReportShell.Num(m.TotalMinutes, 0)} min total)");

            Tile($"{m.DaysTooDry}", m.DaysTooDry == 1 ? "Day too dry" : "Days too dry");

            Tile(
                m.NextWatering is { } next
                    ? next.ToDateTime(TimeOnly.MinValue).ToString("dddd", CultureInfo.InvariantCulture)
                    : "Not due",
                "Next watering");
        });

        /* ---- How your system works ------------------------------------ */
        col.Item().PaddingTop(16).Background(ReportTheme.CalloutFill)
            .BorderLeft(3).BorderColor(ReportTheme.Teal)
            .Padding(14).Column(c =>
            {
                c.Item().Text("How your system works")
                    .FontSize(10).Bold().FontColor(ReportTheme.Brand);

                c.Item().PaddingTop(6).Text(HowItWorks(m)).FontSize(9).LineHeight(1.45f);
            });

        /* ---- Water used per day ---------------------------------------- */
        ReportShell.Heading(col, "Water used per day");

        col.Item().Height(175).Svg(ChartSvg.DailyBars(
            m.Days.Select(d => d.ShortLabel).ToList(),
            m.Days.Select(d => d.Litres).ToList(),
            "Litres (estimated)"));

        ReportShell.ChartNote(col, WaterPerDayNote(m));
    }

    internal static string HowItWorks(WaterUsageReportModel m)
    {
        var flow = m.FlowRateLpm is { } f
            ? $"a pump that delivers about {ReportShell.Num(f, 1)} litres per minute"
            : "a pump whose flow rate has not been set yet";

        var crop = string.IsNullOrWhiteSpace(m.CropLabel) ? "your crop" : $"your {m.CropLabel.ToLowerInvariant()}";

        var stage = string.IsNullOrWhiteSpace(m.GrowthStage) ? "" : $" ({m.GrowthStage})";

        return
            $"Your kit has a soil moisture sensor in the soil, a temperature and humidity sensor (DHT11) " +
            $"next to the plants, and {flow}. Weather for your area comes from the weather app " +
            $"(Open-Meteo). AgroFlow uses the FAO-56 method to work out how much water {crop} needs at " +
            $"its current growth stage{stage}.";
    }

    internal static string WaterPerDayNote(WaterUsageReportModel m)
    {
        if (m.TotalLitres is null)
        {
            return
                $"The pump ran {m.TotalRuns} times this week, {ReportShell.Num(m.TotalMinutes, 0)} minutes in total. " +
                "How much water that delivered cannot be worked out yet: this zone has no flow rate on " +
                "file. Set one and these figures will fill in.";
        }

        var arithmetic = m.FlowRateLpm is { } f
            ? $" At about {ReportShell.Num(f, 1)} L per minute that's roughly {ReportShell.Num(m.TotalLitres.Value, 1)} L " +
              $"({ReportShell.Num(m.TotalMinutes, 0)} × {ReportShell.Num(f, 1)})."
            : "";

        return
            $"The pump ran {m.TotalRuns} times this week, {ReportShell.Num(m.TotalMinutes, 0)} minutes in total." +
            arithmetic +
            " Runs are short on purpose, with a soak between them, so water reaches the roots " +
            "instead of running off.";
    }

    /* ------------------------------------------------------------------ *
     * Page 2
     * ------------------------------------------------------------------ */

    internal static void PageTwo(ColumnDescriptor col, WaterUsageReportModel m) => PageTwo(col, m, new ReportWhy());

    internal static void PageTwo(ColumnDescriptor col, WaterUsageReportModel m, ReportWhy why)
    {
        ReportShell.Heading(col, "What the crop needed vs what it got");

        col.Item().Height(168).Svg(ChartSvg.PairedBars(
            m.Days.Select(d => d.ShortLabel).ToList(),
            m.Days.Select(d => d.NeedLitres).ToList(),
            m.Days.Select(d => d.Litres).ToList(),
            "Crop needed (L)",
            "Water given (L)",
            "Litres"));

        ReportShell.ChartNote(col, NeededVsGotNote(m));
        why.Line(col, m.VerdictWhy);

        ReportShell.Heading(col, "Soil moisture over the week");

        col.Item().Height(168).Svg(ChartSvg.MoistureLine(
            m.MoistureSeries,
            m.PumpPositions,
            m.Days.Select(d => d.ShortLabel).ToList(),
            m.HealthyLowPercent,
            m.HealthyHighPercent,
            "Relative moisture %"));

        ReportShell.ChartNote(col, MoistureNote(m));

        ReportShell.Heading(col, "Advice for this week");

        if (m.Advice.Count == 0)
        {
            col.Item().Background(ReportTheme.Surface).Padding(12)
                .Text("Nothing needs doing differently this week - the readings and the forecast " +
                      "both look ordinary for this crop and stage.")
                .FontSize(9);
            return;
        }

        var n = 0;
        foreach (var line in m.Advice)
        {
            n++;
            col.Item().PaddingBottom(5).Background(ReportTheme.Surface).Padding(8).Row(row =>
            {
                row.ConstantItem(22).AlignMiddle()
                    .Text(n.ToString(CultureInfo.InvariantCulture))
                    .FontSize(13).Bold().FontColor(ReportTheme.Brand);

                row.RelativeItem().Column(c =>
                {
                    c.Item().Text(line.Message).FontSize(9);

                    // The source is on every line on purpose. Advice a farmer
                    // cannot trace is advice they are being asked to take on
                    // faith, and the whole point of the FAO-56 work is that
                    // it does not have to be.
                    c.Item().PaddingTop(2).Text($"Source: {line.Source}")
                        .FontSize(7.5f).FontColor(ReportTheme.Muted);

                    why.Line(c, line.Why);
                });
            });
        }
    }

    internal static string NeededVsGotNote(WaterUsageReportModel m)
    {
        if (m.TotalNeedLitres is null)
        {
            return
                "How much water the crop needed cannot be worked out for this period. That needs the " +
                "zone's crop, planting date and area on file, plus weather for the dates covered.";
        }

        if (m.TotalLitres is null)
        {
            return
                $"The crop needed about {ReportShell.Num(m.TotalNeedLitres.Value, 0)} L this week. How much it " +
                "actually got cannot be estimated until this zone has a flow rate on file.";
        }

        var crop = string.IsNullOrWhiteSpace(m.CropLabel) ? "The crop" : $"Your {m.CropLabel.ToLowerInvariant()}";
        var difference = m.Difference ?? 0;

        // The verdict is VerdictRules' (item 2b) - this used to be its own
        // 15% band, written only here.
        var verdict = m.Verdict switch
        {
            AgroFlow.Business.Agronomy.RuleBook.WateringVerdict.TooMuch => "That's a surplus - worth easing off if it continues.",
            AgroFlow.Business.Agronomy.RuleBook.WateringVerdict.TooLittle => "That's less than needed - worth watering a little longer.",
            _ => "That's about right.",
        };

        var direction = difference >= 0 ? "more than" : "less than";

        return
            $"{crop} needed about {ReportShell.Num(m.TotalNeedLitres.Value, 0)} L this week (worked out from the " +
            $"weather and the growth stage). It got about {ReportShell.Num(m.TotalLitres.Value, 1)} L, so " +
            $"{ReportShell.Num(Math.Abs(difference), 1)} L {direction} needed. {verdict}";
    }

    internal static string MoistureNote(WaterUsageReportModel m)
    {
        if (m.MoistureSeries.Count == 0)
        {
            return
                "No soil moisture readings arrived for this period, so there is no line to show. " +
                "That usually means the kit was offline, or the wet/dry setup has not been done for " +
                "this zone yet.";
        }

        var dips = m.DaysTooDry;

        var dryText = dips == 0
            ? "It stayed in the healthy range all week."
            : dips == 1
                ? "It dropped below the healthy range on one day."
                : $"It dropped below the healthy range on {dips} days.";

        return
            $"The pump ran {m.TotalRuns} times across the week, each run topping the soil back up. " +
            dryText +
            " The shaded band is where this zone's soil should sit; the markers along the top are " +
            "the moments the pump ran.";
    }

    /* ------------------------------------------------------------------ *
     * Page 3
     * ------------------------------------------------------------------ */

    internal static void PageThree(ColumnDescriptor col, WaterUsageReportModel m)
    {
        ReportShell.Heading(col, "Weather: area forecast vs in the tub");

        col.Item().Height(165).Svg(ChartSvg.TwoLines(
            m.Days.Select(d => d.ShortLabel).ToList(),
            m.Days.Select(d => d.AreaMaxC).ToList(),
            m.Days.Select(d => d.TubMaxC).ToList(),
            "Area forecast max °C (weather app)",
            "In the tub max °C (DHT11)",
            "°C"));

        col.Item().PaddingTop(8).Element(c => WeatherTable(c, m));

        col.Item().PaddingTop(8).Background("#FDF6E6")
            .BorderLeft(3).BorderColor(ReportTheme.WeatherTub)
            .Padding(12)
            .Text(WeatherNote(m)).FontSize(9);

        ReportShell.Heading(col, "Daily data");
        col.Item().Element(c => DailyTable(c, m));

        col.Item().PaddingTop(10).Background(ReportTheme.Surface).Padding(10).Column(c =>
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
                t.Span("100% = soaked and drained, 0% = dry, based on this zone's setup.").FontSize(8.5f);
            });

            c.Item().Text(t =>
            {
                t.Span("Area forecast: ").Bold().FontSize(8.5f);
                t.Span("weather for your location from the weather app, not measured on site.").FontSize(8.5f);
            });
        });
    }

    internal static void WeatherTable(IContainer container, WaterUsageReportModel m)
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
                ReportShell.HeadCell(h, "Tub max °C");
                ReportShell.HeadCell(h, "Difference");
                ReportShell.HeadCell(h, "Area humidity %");
                ReportShell.HeadCell(h, "Tub humidity %");
                ReportShell.HeadCell(h, "Difference");
            });

            var striped = false;
            foreach (var d in m.Days)
            {
                striped = !striped;
                var fill = striped ? ReportShell.Stripe : ReportTheme.Surface;

                ReportShell.BodyCell(table, d.LongLabel, fill);
                ReportShell.BodyCell(table, ReportShell.Opt(d.AreaMaxC, 0), fill);
                ReportShell.BodyCell(table, ReportShell.Opt(d.TubMaxC, 1), fill);
                ReportShell.BodyCell(table, ReportShell.Delta(d.TubMaxC, d.AreaMaxC, 1, " °C"), fill);
                ReportShell.BodyCell(table, ReportShell.Opt(d.AreaHumidity, 0), fill);
                ReportShell.BodyCell(table, ReportShell.Opt(d.TubHumidity, 0), fill);
                ReportShell.BodyCell(table, ReportShell.Delta(d.TubHumidity, d.AreaHumidity, 0, "%"), fill);
            }
        });
    }

    internal static void DailyTable(IContainer container, WaterUsageReportModel m)
    {
        container.Table(table =>
        {
            table.ColumnsDefinition(c =>
            {
                c.RelativeColumn(1.4f);
                c.RelativeColumn(); c.RelativeColumn(1.1f); c.RelativeColumn(1.1f);
                c.RelativeColumn(1.2f); c.RelativeColumn(1.3f); c.RelativeColumn();
            });

            table.Header(h =>
            {
                ReportShell.HeadCell(h, "Day");
                ReportShell.HeadCell(h, "Pump runs");
                ReportShell.HeadCell(h, "Pump minutes");
                ReportShell.HeadCell(h, "Litres (est.)");
                ReportShell.HeadCell(h, "Crop needed (L)");
                ReportShell.HeadCell(h, "Avg soil moisture %");
                ReportShell.HeadCell(h, "Rain mm");
            });

            var striped = false;
            foreach (var d in m.Days)
            {
                striped = !striped;
                var fill = striped ? ReportShell.Stripe : ReportTheme.Surface;

                ReportShell.BodyCell(table, d.LongLabel, fill);
                ReportShell.BodyCell(table, d.PumpRuns.ToString(CultureInfo.InvariantCulture), fill);
                ReportShell.BodyCell(table, ReportShell.Num(d.PumpMinutes, 1), fill);
                ReportShell.BodyCell(table, d.Litres is { } l ? ReportShell.Num(l, 1) : "—", fill);
                ReportShell.BodyCell(table, ReportShell.Opt(d.NeedLitres, 1), fill);
                ReportShell.BodyCell(table, ReportShell.Opt(d.AvgMoisturePercent, 0), fill);
                ReportShell.BodyCell(table, ReportShell.Opt(d.RainMm, 1), fill);
            }

            // The totals row. Bold and tinted, because it is the line most
            // people read first and then stop.
            ReportShell.TotalCell(table, "Week");
            ReportShell.TotalCell(table, m.TotalRuns.ToString(CultureInfo.InvariantCulture));
            ReportShell.TotalCell(table, ReportShell.Num(m.TotalMinutes, 1));
            ReportShell.TotalCell(table, m.TotalLitres is { } tl ? ReportShell.Num(tl, 1) : "—");
            ReportShell.TotalCell(table, ReportShell.Opt(m.TotalNeedLitres, 1));
            ReportShell.TotalCell(table, ReportShell.Opt(m.AvgMoisturePercent, 0));
            ReportShell.TotalCell(table, ReportShell.Num(m.TotalRainMm, 1));
        });
    }

    internal static string WeatherNote(WaterUsageReportModel m)
    {
        if (m.AvgTubTempC is not { } tub || m.AvgAreaTempC is not { } area)
        {
            return
                "There is not enough paired data this week to compare the area forecast with the " +
                "sensor in the tub. AgroFlow uses the area forecast for its water calculations either " +
                "way; the tub sensor is a check on it, not an input to it.";
        }

        var tempDiff = tub - area;
        var humidityDiff = (m.AvgTubHumidity ?? 0) - (m.AvgAreaHumidity ?? 0);

        var warmer = tempDiff >= 0 ? "warmer" : "cooler";
        var humid = humidityDiff >= 0 ? "more humid" : "drier";

        return
            $"Inside the tub it was on average {ReportShell.Num(Math.Abs(tempDiff), 1)} °C {warmer} and " +
            $"{ReportShell.Num(Math.Abs(humidityDiff), 0)}% {humid} than the area forecast. That's normal for a " +
            "sheltered tub, and it's why AgroFlow uses the area forecast for its water calculations " +
            "and the tub sensor as a check.";
    }

    /* ------------------------------------------------------------------ *
     * Cells
     * ------------------------------------------------------------------ */




    /* ------------------------------------------------------------------ *
     * Numbers
     * ------------------------------------------------------------------ */

    /// InvariantCulture everywhere. .NET on this host renders "3 Sept" and a
    /// comma decimal separator under some locales, and these strings reach a
    /// farmer in a Telegram caption - the project has been bitten by exactly
    /// this once already, in ReportPeriods.Describe.

    /// An em dash, never "0". A missing reading and a measured zero are
    /// different facts and must not share a rendering.

}
