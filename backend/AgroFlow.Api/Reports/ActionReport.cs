using System.Globalization;
using AgroFlow.Business.Agronomy;
using AgroFlow.Business.Agronomy.RuleBook;

namespace AgroFlow.Api.Reports;

// Item 3: every farmer report - water usage, soil moisture, watering
// schedule; one zone or all of them - is built around what to DO.
//
//   1. This week, do this        1-5 actions: when, how much, how sure, why
//   2. How your farm did          the period in boxes, one verdict per zone
//   3. Three questions            needed vs given / healthy soil / what's coming
//   4. Area weather vs at plants  only days a local field sensor reported
//   5. Improve your advice        one setup step per zone, grouped
//   6. Technical appendix         ALL the jargon, and nowhere else
//
// This file composes the WORDS; ActionReportPdf only lays them out. Keeping
// the two apart is what lets a test read every sentence a farmer will see and
// check it for jargon, ISO dates and repeats - which cannot be done against a
// rendered PDF.

internal enum ReportKind
{
    WaterUsage,
    Moisture,
    Schedule,
}

internal sealed record ReportAction(
    string Lead,            // bold: "Water North Plot today (Wed 7 Oct)"
    string Detail,          // ": about 12 minutes (about 18 L)."
    string Zone,
    ConfidenceLevel Confidence,
    Explanation? Why,
    int Priority);

internal sealed record ZoneSummary(
    string Zone,
    string? Crop,
    string Given,           // "about 84 L", or "not known (no flow rate)"
    string Needed,
    string Verdict,         // Watered about right / Too much / Too little / Not enough data
    int PumpRuns,
    string Rain,
    Explanation? VerdictWhy);

internal sealed record ChartAnswer(string Question, string Answer);

internal sealed record ForecastCard(string Day, string MaxTemp, string Rain, string Action);

internal sealed record WeatherRow(string Day, string AreaMax, string LocalMax, string AreaHumidity, string LocalHumidity);

internal sealed record AppendixFact(string Label, string Value, string Source);

internal sealed record ZoneAppendix(string Zone, IReadOnlyList<AppendixFact> Facts, IReadOnlyList<string> Notes);

internal sealed class ActionReportContent
{
    public required ReportKind Kind { get; init; }
    public required string Title { get; init; }
    public required string Subtitle { get; init; }
    public required string PeriodWords { get; init; }
    public required IReadOnlyList<ReportAction> Actions { get; init; }
    public required string NoActionsLine { get; init; }
    public required IReadOnlyList<ZoneSummary> Summaries { get; init; }

    /// Per zone, in zone order: the answers under the two zone charts.
    public required IReadOnlyList<(ChartAnswer Need, ChartAnswer Soil)> ZoneAnswers { get; init; }
    public required IReadOnlyList<ForecastCard> Forecast { get; init; }
    public required string ForecastLine { get; init; }
    public required IReadOnlyList<WeatherRow> WeatherRows { get; init; }
    public required string WeatherLine { get; init; }
    public required IReadOnlyList<string> ImproveSteps { get; init; }
    public required IReadOnlyList<ZoneAppendix> Appendix { get; init; }
    public required IReadOnlyList<string> SharedNotes { get; init; }
    public required IReadOnlyList<string> Assumptions { get; init; }

    /// Every sentence a farmer reads outside the appendix, for the jargon,
    /// ISO-date and repeat checks.
    public IEnumerable<string> FarmerText()
    {
        yield return Title;
        yield return Subtitle;
        yield return NoActionsLine;
        // A reason shared by several zones is printed once; later lines point
        // back to it (ReportWhy), so it is yielded once here too.
        var reasons = new HashSet<string>(StringComparer.Ordinal);
        foreach (var a in Actions)
        {
            yield return a.Lead + a.Detail;
            if (a.Why != null && reasons.Add(a.Why.Summary)) yield return a.Why.Summary;
        }
        foreach (var s in Summaries) { yield return s.Given; yield return s.Needed; yield return s.Verdict; yield return s.Rain; }
        foreach (var (need, soil) in ZoneAnswers) { yield return need.Answer; yield return soil.Answer; }
        yield return ForecastLine;
        foreach (var c in Forecast) { yield return c.Day; yield return c.Action; }
        yield return WeatherLine;
        foreach (var w in WeatherRows) yield return w.Day;
        foreach (var s in ImproveSteps) yield return s;
    }
}

internal static class ActionReport
{
    private static readonly CultureInfo Inv = CultureInfo.InvariantCulture;

    // The brief's own bounds: at least one action when there is anything to
    // do, never more than five - past that a farmer stops reading.
    public const int MaxActions = 5;

    public static string TitleFor(ReportKind kind) => kind switch
    {
        ReportKind.Moisture => "Soil Moisture Report",
        ReportKind.Schedule => "Watering Schedule",
        _ => "Water Usage Report",
    };

    public static ActionReportContent Compose(
        ReportKind kind, string farmName, IReadOnlyList<WaterUsageReportModel> zones,
        DateOnly from, DateOnly to, DateOnly today)
    {
        var period = ReportPeriod.Words(from, to, today);
        var zoneCount = zones.Count == 1 ? zones[0].ZoneName : $"all {zones.Count} zones";

        var actions = Actions(zones, period, today);

        var forecast = Forecast(zones, to, today, out var forecastLine);
        var weather = WeatherRows(zones);

        return new ActionReportContent
        {
            Kind = kind,
            Title = TitleFor(kind),
            Subtitle = $"{farmName}  ·  {zoneCount}  ·  {ReportPeriod.Day(from)} to {ReportPeriod.Day(to)}",
            PeriodWords = period,
            Actions = actions,
            NoActionsLine = actions.Count == 0
                ? "Nothing needs doing differently: the readings and the forecast look ordinary for these crops."
                : "",
            Summaries = zones.Select(z => Summary(z, period)).ToList(),
            ZoneAnswers = zones.Select(z => (NeedAnswer(z, period), SoilAnswer(z, period))).ToList(),
            Forecast = forecast,
            ForecastLine = forecastLine,
            WeatherRows = weather,
            WeatherLine = weather.Count == 0
                ? "The local field sensors sent no readings in this period, so only the area forecast was used."
                : "Only days with readings from a sensor in an irrigation zone are shown.",
            ImproveSteps = ImproveSteps(zones),
            Appendix = zones.Select(Appendix).ToList(),
            SharedNotes = SharedNotes(zones),
            Assumptions = Assumptions,
        };
    }

    /* ---------------------------------------------------------------- *
     * 1. This week, do this
     * ---------------------------------------------------------------- */

    public static List<ReportAction> Actions(IReadOnlyList<WaterUsageReportModel> zones, string period, DateOnly today)
    {
        var all = new List<ReportAction>();

        foreach (var z in zones)
        {
            var confidence = z.Engine?.Confidence.Level ?? ConfidenceLevel.Low;
            var byType = z.Insights.GroupBy(i => i.InsightType).ToDictionary(g => g.Key, g => g.First());
            ZoneInsight? Get(string type) => byType.TryGetValue(type, out var i) ? i : null;

            if (Get(InsightType.SkipRain) is { } skip)
            {
                var rain = z.Engine?.Days.FirstOrDefault(d => d.Day == today)?.RainMm ?? 0;
                all.Add(new ReportAction(
                    $"Skip watering {z.ZoneName} today ({ReportPeriod.Day(today)})",
                    $": about {N(rain)} mm of rain is expected, which covers it.",
                    z.ZoneName, confidence, skip.Explanation, 0));
            }
            else if (Get(InsightType.WaterNow) is { } water)
            {
                all.Add(new ReportAction(
                    $"Water {z.ZoneName} today ({ReportPeriod.Day(today)})",
                    ": " + Amount(z.Engine) + ".",
                    z.ZoneName, confidence, water.Explanation, 0));
            }
            else if (Get(InsightType.WaterSoon) is { } soon && z.Engine?.NextWateringDate is { } next)
            {
                all.Add(new ReportAction(
                    $"Water {z.ZoneName} on {ReportPeriod.Weekday(next)} ({ReportPeriod.Day(next)})",
                    ": " + ProjectedAmount(z, next) + ".",
                    z.ZoneName, confidence, soon.Explanation, 2));
            }

            // Kit problems: check the kit, with the plain reason.
            foreach (var (type, lead, detail) in new[]
            {
                (InsightType.ZoneOffline, $"Check the kit in {z.ZoneName}", $": {Quiet(z)}. Make sure it has power and WiFi."),
                (InsightType.SensorStuck, $"Check the soil sensor in {z.ZoneName}", ": it has shown the same reading for hours. Make sure it is firmly in the soil."),
                (InsightType.WateringFailed, $"Check the pump in {z.ZoneName}", ": the pump ran but the soil did not get wetter. Check the pump, the pipe and the water supply."),
                (InsightType.DhtOffline, $"Check the temperature sensor in {z.ZoneName}", ": it stopped reporting, so the weather app is standing in."),
            })
            {
                if (Get(type) is { } kit)
                {
                    all.Add(new ReportAction(lead, detail, z.ZoneName, ConfidenceLevel.High, kit.Explanation, 1));
                }
            }

            // The period's verdict, when it was off.
            if (z.Verdict is { } verdict && z.TotalLitres is { } given && z.TotalNeedLitres is { } need && need > 0)
            {
                var crop = string.IsNullOrWhiteSpace(z.CropLabel) ? z.ZoneName : $"Your {z.CropLabel!.ToLowerInvariant()} in {z.ZoneName}";
                if (verdict == WateringVerdict.TooMuch)
                {
                    all.Add(new ReportAction(
                        $"{crop} got about {N(Math.Round(given / need, 1))} times what it needed {period}",
                        ShortenTo(z, need / given) is { } minutes
                            ? $". Shorten each watering to about {minutes} minutes."
                            : ". Water less often or for less time.",
                        z.ZoneName, ConfidenceLevel.Medium, z.VerdictWhy, 3));
                }
                else if (verdict == WateringVerdict.TooLittle)
                {
                    all.Add(new ReportAction(
                        $"{crop} got about {N(Math.Round(given / need * 100))}% of what it needed {period}",
                        ". Water a little longer, or when the app suggests it.",
                        z.ZoneName, ConfidenceLevel.Medium, z.VerdictWhy, 3));
                }
            }

            if (Get(InsightType.ThresholdUnsafe) is { } unsafeLevel)
            {
                all.Add(new ReportAction(
                    $"Reset {z.ZoneName}'s watering level",
                    ": it waits until the soil is drier than this crop handles well. Tap Reset to recommended in the app.",
                    z.ZoneName, confidence, unsafeLevel.Explanation, 3));
            }

            if (Get(InsightType.PeakGrowth) is { } peak && z.Engine?.Crop is { } c && z.Engine.DayOfSeason is { } day)
            {
                var left = CropRules.StageFor(c, day).DaysLeftInStage ?? 0;
                all.Add(new ReportAction(
                    $"Peak growth in {z.ZoneName} for about {Weeks(left)}",
                    ": this is when shortages cost the most harvest, so don't let it dry out.",
                    z.ZoneName, confidence, peak.Explanation, 4));
            }

            if (Get(InsightType.HotDays) is { } hot)
            {
                all.Add(new ReportAction(
                    $"Hot, dry days ahead for {z.ZoneName}",
                    ": expect it to need more water than usual.",
                    z.ZoneName, confidence, hot.Explanation, 5));
            }
        }

        return all
            .OrderBy(a => a.Priority)
            .ThenBy(a => a.Zone, StringComparer.Ordinal)
            .Take(MaxActions)
            .ToList();
    }

    private static string Amount(ZoneEngineResult? r)
    {
        if (r is null) return "water as usual";
        if (r.RecommendedRuntimeSeconds is { } seconds && r.RecommendedLitres is { } l)
            return seconds < 60.0
                ? $"about {N(seconds)} seconds (about {N(Math.Round(l))} L)"
                : $"about {N(seconds / 60.0)} minutes (about {N(Math.Round(l))} L)";
        if (r.RecommendedLitres is { } litres)
            return $"about {N(Math.Round(litres))} L";
        if (r.RecommendedMinutesPerSquareMetre is { } perM2)
            return $"for each square metre, run the pump about {N(perM2)} minutes";
        if (r.RecommendedDepthMm is { } mm && mm > 0)
            return $"about {N(mm)} mm (about {N(mm)} L for each square metre)";
        return "water as usual";
    }

    // How much on the expected watering day: the forecast balance's dryness
    // that day, through the same rule the app uses for "now".
    private static string ProjectedAmount(WaterUsageReportModel z, DateOnly day)
    {
        var planned = z.Engine?.Outlook.FirstOrDefault(d => d.Date == day);
        if (planned?.RuntimeSeconds is { } seconds && planned.Litres is { } plannedLitres)
            return seconds < 60.0
                ? $"about {N(seconds)} seconds (about {N(Math.Round(plannedLitres))} L)"
                : $"about {N(seconds / 60.0)} minutes (about {N(Math.Round(plannedLitres))} L)";
        if (planned?.Litres is { } litresOnly) return $"about {N(Math.Round(litresOnly))} L";
        if (planned?.RequiredDepthMm is { } plannedDepth) return $"about {N(plannedDepth)} mm";

        var dr = z.Engine?.Days.FirstOrDefault(d => d.Day == day)?.DrEndMm;
        if (dr is null) return "water as usual";
        var minutes = WaterRules.MinutesToRun(dr.Value, z.EngineInput?.AreaM2, z.EngineInput?.FlowRateLpm);
        var litres = SoilWaterBalance.IrrigationLitres(dr.Value, z.EngineInput?.AreaM2);
        if (minutes is { } m && litres is { } l) return $"about {m} minutes (about {N(Math.Round(l))} L)";
        if (WaterRules.MinutesPerSquareMetre(dr.Value, z.EngineInput?.FlowRateLpm) is { } perM2)
            return $"for each square metre, run the pump about {N(perM2)} minutes";
        return $"about {N(Math.Round(dr.Value, 1))} mm";
    }

    // The average run, scaled by need/given. Null without runs to scale.
    private static int? ShortenTo(WaterUsageReportModel z, double factor)
    {
        if (z.TotalRuns <= 0 || z.TotalMinutes <= 0) return null;
        var perRun = z.TotalMinutes / z.TotalRuns;
        return Math.Max(1, (int)Math.Round(perRun * factor));
    }

    private static string Quiet(WaterUsageReportModel z)
    {
        var at = z.Engine?.LatestReadingAtUtc;
        return at.HasValue
            ? "no data since " + ReportPeriod.Day(DateOnly.FromDateTime(at.Value.AddHours(2)))
            : "no data received";
    }

    private static string Weeks(int days) =>
        days >= 14 ? $"{(int)Math.Round(days / 7.0)} more weeks"
        : days >= 7 ? "1 more week"
        : days <= 1 ? "1 more day"
        : $"{days} more days";

    /* ---------------------------------------------------------------- *
     * 2. How your farm did
     * ---------------------------------------------------------------- */

    public static ZoneSummary Summary(WaterUsageReportModel z, string period)
    {
        var verdict = z.Verdict switch
        {
            WateringVerdict.TooMuch => "Too much",
            WateringVerdict.TooLittle => "Too little",
            WateringVerdict.AboutRight => "Watered about right",
            _ => "Not enough data",
        };

        return new ZoneSummary(
            z.ZoneName,
            z.CropLabel,
            z.TotalLitres is { } given ? $"about {N(Math.Round(given))} L" : "not known (no flow rate)",
            z.TotalNeedLitres is { } need ? $"about {N(Math.Round(need))} L" : "not known",
            verdict,
            z.TotalRuns,
            $"{N(Math.Round(z.TotalRainMm, 1))} mm",
            z.VerdictWhy);
    }

    /// The answer under "Did my crop get the water it needed?".
    public static ChartAnswer NeedAnswer(WaterUsageReportModel z, string period)
    {
        const string q = "Did my crop get the water it needed?";
        if (z.TotalNeedLitres is null)
            return new(q, "We could not work out what the crop needed: that takes the crop, the zone's size and weather for these days.");
        if (z.TotalLitres is null)
            return new(q, $"The crop needed about {N(Math.Round(z.TotalNeedLitres.Value))} L {period}. What it got cannot be worked out until the zone has a flow rate.");

        return new(q, z.Verdict switch
        {
            WateringVerdict.TooMuch => $"No - it got more than it needed: about {N(Math.Round(z.TotalLitres.Value))} L against about {N(Math.Round(z.TotalNeedLitres.Value))} L {period}.",
            WateringVerdict.TooLittle => $"Not quite - it got about {N(Math.Round(z.TotalLitres.Value))} L against about {N(Math.Round(z.TotalNeedLitres.Value))} L {period}.",
            _ => $"Yes - about {N(Math.Round(z.TotalLitres.Value))} L against about {N(Math.Round(z.TotalNeedLitres.Value))} L needed {period}.",
        });
    }

    /// The answer under "Was my soil in the healthy range?" - or why there is no chart.
    public static ChartAnswer SoilAnswer(WaterUsageReportModel z, string period)
    {
        const string q = "Was my soil in the healthy range?";
        if (!z.Calibrated)
            return new(q, "No chart: the soil sensor's wet/dry setup has not been done, so its readings are not moisture yet.");
        if (z.MoistureSeries.Count == 0)
            return new(q, $"No chart: the soil sensor sent no readings {period}.");

        var below = z.DaysTooDry;
        return new(q, below == 0
            ? $"Yes - it stayed in the healthy range every day {period}."
            : $"Mostly - it dipped below the healthy range on {below} day{(below == 1 ? "" : "s")} {period}.");
    }

    /* ---------------------------------------------------------------- *
     * 3. What's coming this week?
     * ---------------------------------------------------------------- */

    public static List<ForecastCard> Forecast(IReadOnlyList<WaterUsageReportModel> zones, DateOnly to, DateOnly today, out string line)
    {
        var cards = new List<ForecastCard>();

        if (to < today.AddDays(-1))
        {
            line = "This report covers a past period, so it has no forecast.";
            return cards;
        }

        var withForecast = zones.Where(z => z.EngineInput != null).ToList();
        var days = withForecast
            .SelectMany(z => z.EngineInput!.Weather.Where(w => w.IsForecast && w.Date > today))
            .GroupBy(w => w.Date)
            .OrderBy(g => g.Key)
            .Take(7)
            .ToList();

        if (days.Count == 0)
        {
            line = "There is no weather forecast saved for this farm yet.";
            return cards;
        }

        foreach (var day in days)
        {
            var w = day.First();
            var water = withForecast.Where(z => z.Engine?.NextWateringDate == day.Key).Select(z => z.ZoneName).ToList();
            var rainCovers = withForecast.Any(z =>
                z.Engine?.Days.FirstOrDefault(d => d.Day == day.Key) is { EtcMm: { } etc } && WaterRules.SkipForRain(w.RainMm ?? 0, etc) && (w.RainMm ?? 0) > 0);

            var action = water.Count > 0 ? "Water " + Join(water)
                       : rainCovers ? "Rain covers it"
                       : "No watering needed";

            cards.Add(new ForecastCard(
                ReportPeriod.Day(day.Key),
                w.TMaxC is { } t ? $"{N(Math.Round(t))} °C" : "-",
                $"{N(Math.Round(w.RainMm ?? 0, 1))} mm",
                action));
        }

        line = "";
        return cards;
    }

    /* ---------------------------------------------------------------- *
     * 4. Area weather vs at your plants - local sensor days only
     * ---------------------------------------------------------------- */

    public static List<WeatherRow> WeatherRows(IReadOnlyList<WaterUsageReportModel> zones)
    {
        // One row per day a local sensor reported, across zones (the first zone
        // that reported that day). Days without local data carry no comparison and
        // are not printed at all - the old table was mostly "Sensor offline".
        return zones
            .SelectMany(z => z.Days)
            .Where(d => d.LocalMaxC.HasValue || d.LocalHumidity.HasValue)
            .GroupBy(d => d.Date)
            .OrderBy(g => g.Key)
            .Select(g => g.First())
            .Select(d => new WeatherRow(
                ReportPeriod.Day(d.Date),
                d.AreaMaxC is { } a ? $"{N(Math.Round(a, 1))} °C" : "-",
                d.LocalMaxC is { } t ? $"{N(Math.Round(t, 1))} °C" : "-",
                d.AreaHumidity is { } ah ? $"{N(Math.Round(ah))}%" : "-",
                d.LocalHumidity is { } th ? $"{N(Math.Round(th))}%" : "-"))
            .ToList();
    }

    /* ---------------------------------------------------------------- *
     * 5. Improve your advice - one step per zone, grouped
     * ---------------------------------------------------------------- */

    public static List<string> ImproveSteps(IReadOnlyList<WaterUsageReportModel> zones)
    {
        // Grouped by the step itself, so the same sentence is never printed
        // once per zone: "North Plot and East Plot: Add the planting date ...".
        return zones
            .Where(z => z.Engine?.NextStep != null)
            .GroupBy(z => z.Engine!.NextStep!.Ask)
            .Select(g => $"{Join(g.Select(z => z.ZoneName).ToList())}: {g.Key}")
            .ToList();
    }

    /* ---------------------------------------------------------------- *
     * 6. Technical appendix - the only place jargon lives
     * ---------------------------------------------------------------- */

    public static ZoneAppendix Appendix(WaterUsageReportModel z)
    {
        var facts = new List<AppendixFact>();
        if (z.Engine is { } r)
        {
            facts.AddRange(r.Facts.Select(f => new AppendixFact(f.Label, f.Value, f.Source)));
            if (r.TawMm is { } taw) facts.Add(new("TAW", $"{N(Math.Round(taw, 1))} mm", "FAO-56 Eq. 82, p. 162; Table 19 p. 144; Table 22 pp. 163-165"));
            if (r.RawMm is { } raw) facts.Add(new("RAW", $"{N(Math.Round(raw, 1))} mm", "FAO-56 Eq. 83, p. 162"));
            if (r.AdjustedP is { } p) facts.Add(new("p (adjusted)", N(Math.Round(p, 2)), "FAO-56 Table 22 p. 163-165; p. 162 ETc adjustment; p. 167 soil adjustment"));
            if (r.KcToday is { } kc) facts.Add(new("Kc", N(Math.Round(kc, 2)), r.StageAssumed ? "FAO-56 Table 12 pp. 110-114, highest value (stage assumed)" : "FAO-56 Table 12 pp. 110-114; Eq. 66 p. 132"));
            facts.Add(new("Confidence", r.Confidence.Reason, "ConfidenceRules (DATA RULE)"));
        }

        return new ZoneAppendix(z.ZoneName, facts, z.Engine?.Limitations.ToList() ?? new List<string> { "The FAO-56 engine did not run for this zone." });
    }

    // A note that every zone carries is printed once, at farm level, not per zone.
    public static List<string> SharedNotes(IReadOnlyList<WaterUsageReportModel> zones)
    {
        if (zones.Count < 2) return new List<string>();
        var perZone = zones.Select(z => (z.Engine?.Limitations ?? new List<string>()).ToHashSet()).ToList();
        return perZone.Skip(1).Aggregate(new HashSet<string>(perZone[0]), (acc, s) => { acc.IntersectWith(s); return acc; }).ToList();
    }

    public static readonly IReadOnlyList<string> Assumptions = new[]
    {
        "Litres are estimated as pump running time x the zone's flow rate. There is no flow meter on any AgroFlow kit.",
        "Reference evapotranspiration (ETo) is FAO-56 Penman-Monteith (Eq. 6, p. 24) from the weather app. Solar radiation is always estimated from the day's temperature range (Eq. 50, p. 60); missing humidity is estimated from the temperatures (Eq. 64, p. 124); missing temperatures come from a local field sensor.",
        "Crop water need is ETc = Kc x ETo (Eq. 58, p. 103), with Kc from Table 12 joined by Eq. 66 (p. 132).",
        "The daily soil water balance is FAO-56 Eq. 85 (p. 170); stress days are days with Ks < 1 (Eq. 84, p. 169).",
        "Watering is advised when the root-zone depletion reaches RAW (p. 171): Dr >= RAW.",
        "Soil sensor readings are relative (wet/dry setup), not a measured volume of water.",
        "Verdicts: more than 1.2 x the need is too much, less than 0.8 x is too little (VerdictRules, DATA RULE).",
    };

    /* ---------------------------------------------------------------- */

    private static string Join(IReadOnlyList<string> names) =>
        names.Count switch
        {
            0 => "",
            1 => names[0],
            2 => $"{names[0]} and {names[1]}",
            _ => string.Join(", ", names.Take(names.Count - 1)) + " and " + names[^1],
        };

    private static string N(double value) => value.ToString("0.#", Inv);
}
