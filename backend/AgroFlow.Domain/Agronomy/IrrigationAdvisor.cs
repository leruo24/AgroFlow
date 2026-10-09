#nullable enable
using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;

namespace AgroFlow.Business.Agronomy
{
    // The FAO-56 growth-stage advice engine.
    //
    // WHAT THIS IS, AND WHAT IT DELIBERATELY IS NOT
    // ---------------------------------------------
    // This is NOT a language model and there is no API key, no subscription and
    // no vendor behind it. It is a deterministic function of a zone's sensor
    // readings, its weather rows and a committed extract of FAO-56. The same
    // inputs always produce the same words. MafiHub owns it outright.
    //
    // It should read as if something knowledgeable looked at the field, and it
    // earns that by being specific and sourced rather than by sounding clever.
    // The governing rule, applied without exception: every number in the output
    // traces to a sensor reading, a weather row, or a cited FAO-56 value. When
    // an input is missing, the engine says what it cannot tell you and gives
    // the advice it still can - it never fills a gap with a plausible default.

    // The first four are the original values and keep their meaning. The rest
    // exist so every Fao56Engine PrimaryAction has its own answer: a crop that
    // is not planted, or a zone the engine could not decide for, is never
    // reported as "no action needed".
    public enum AdviceAction
    {
        IrrigateNow,
        HoldRainExpected,
        NoActionNeeded,
        InsufficientData,
        WaterSoon,
        CheckField,
        CheckSensor,
        CheckIrrigationSystem,
        FinishSetup,
        CropNotPlanted,
        SeasonComplete,
    }

    // One reported quantity plus where it came from. The UI can render these as
    // footnotes; the report prints them so the agronomy can be checked by hand.
    public sealed class AdviceFact
    {
        public string Label { get; }
        public string Value { get; }
        public string Source { get; }

        public AdviceFact(string label, string value, string source)
        {
            Label = label;
            Value = value;
            Source = source;
        }

        public override string ToString()
        {
            return Label + ": " + Value + "  [" + Source + "]";
        }
    }

    public sealed class DailyWeather
    {
        public DateOnly Date { get; }
        public double TMinC { get; }
        public double TMaxC { get; }
        public double PrecipitationMm { get; }
        public bool IsForecast { get; }

        public DailyWeather(DateOnly date, double tMinC, double tMaxC, double precipitationMm, bool isForecast)
        {
            Date = date;
            TMinC = tMinC;
            TMaxC = tMaxC;
            PrecipitationMm = precipitationMm;
            IsForecast = isForecast;
        }
    }

    public sealed class ZoneAdviceInput
    {
        public string ZoneName { get; set; } = "Zone";
        public string? CropType { get; set; }
        public DateOnly? PlantingDate { get; set; }
        public DateOnly AsOf { get; set; }

        public double? SoilMoisturePercent { get; set; }
        public double? MoistureThresholdPercent { get; set; }

        public double? FarmLatitudeDegrees { get; set; }

        // Most recent actual weather for this farm - the day ET0 is computed
        // for. Null when no weather row exists yet.
        public DailyWeather? LatestWeather { get; set; }

        // Forward-looking rows, used only for the rainfall outlook sentence.
        public IReadOnlyList<DailyWeather> Forecast { get; set; } = Array.Empty<DailyWeather>();

        // ------------------------------------------------------------------
        // Water-balance inputs (added with the FAO-56 water-balance engine).
        //
        // Every one is OPTIONAL and defaults to "not known", so existing callers
        // that only set the fields above keep compiling and keep getting exactly
        // the advice they got before. The engine runs only when WaterBalance is
        // supplied; without it this class behaves as it always did.
        // ------------------------------------------------------------------
        public ZoneEngineInput? WaterBalance { get; set; }

        // Timing and pump-derived fault signals. Optional for the same reason.
        public ZoneFaultSignals? FaultSignals { get; set; }
    }

    public sealed class ZoneAdvice
    {
        public string ZoneName { get; internal set; } = "Zone";
        public string? CropDisplayName { get; internal set; }
        public StageAssessment? Stage { get; internal set; }
        public double? Et0MmPerDay { get; internal set; }
        public double? EtcMmPerDay { get; internal set; }
        public double? AdjustedDepletionFractionP { get; internal set; }
        public AdviceAction Action { get; internal set; }

        // One farmer-facing paragraph, e.g.
        // "North Field (maize) - Mid-season, day 62 of ~150. ..."
        public string Summary { get; internal set; } = string.Empty;

        // The reasoning, one plain sentence per step.
        public IReadOnlyList<string> Reasoning { get; internal set; } = Array.Empty<string>();

        // Every reported quantity with its provenance.
        public IReadOnlyList<AdviceFact> Facts { get; internal set; } = Array.Empty<AdviceFact>();

        // Stage-specific guidance drawn from FAO-56, each carrying its citation.
        public IReadOnlyList<string> Insights { get; internal set; } = Array.Empty<string>();

        // What the engine could not determine and why. Empty when it had
        // everything it needed.
        public IReadOnlyList<string> Limitations { get; internal set; } = Array.Empty<string>();

        // ------------------------------------------------------------------
        // Water-balance results (added with the FAO-56 water-balance engine).
        //
        // Additive: Summary, Reasoning, Facts, Insights and Limitations above all
        // keep their existing meaning and content, so the schedule report and the
        // admin dashboard need no changes for them.
        //
        // Insights above stays the FAO-56 narrative, every line carrying a
        // citation. FarmerInsights below is the separate, farmer-facing set from
        // spec section 7 - short, plain, no jargon - which is what the app shows
        // and what the reports render as { text, source }.
        // ------------------------------------------------------------------
        public IReadOnlyList<ZoneInsight> FarmerInsights { get; internal set; } = Array.Empty<ZoneInsight>();

        // The one plain sentence spec section 9a asks for, e.g. "Water about
        // 2 min today." Null when the water balance could not run. Summary is left
        // untouched for callers already rendering it.
        public string? PlainSummary { get; internal set; }

        // Today's water-balance state, for reports. Null where unavailable.
        public double? TotalAvailableWaterMm { get; internal set; }
        public double? ReadilyAvailableWaterMm { get; internal set; }
        public double? DepletionMm { get; internal set; }
        public double? RecommendedLitres { get; internal set; }
        public double? RecommendedMinutes { get; internal set; }
        public double? RelativeMoisturePercent { get; internal set; }
        public int? DayOfSeason { get; internal set; }
        public int? SeasonLengthDays { get; internal set; }
        public string? SeasonStageLabel { get; internal set; }
        public int? DaysToNextWatering { get; internal set; }
        public string? EtoSource { get; internal set; }

        // True when the balance ran end to end for today.
        public bool WaterBalanceAvailable { get; internal set; }

        // Item 2. How sure the advice is, and the one step that would improve
        // it. Null when the water balance was not asked for.
        public RuleBook.Confidence? Confidence { get; internal set; }
        public RuleBook.SetupStep? NextStep { get; internal set; }
        public bool StageAssumed { get; internal set; }
        public double? RecommendedDepthMm { get; internal set; }
        public double? RecommendedMinutesPerSquareMetre { get; internal set; }

        // The water balance's own decision and its rolling seven-day plan.
        // Null / empty when the balance was not asked for. When set, Action,
        // Reasoning and Summary are all derived from this - never re-decided.
        public IrrigationPrimaryAction? PrimaryAction { get; internal set; }
        public IReadOnlyList<RollingIrrigationDay> Outlook { get; internal set; } = Array.Empty<RollingIrrigationDay>();
    }

    public static class IrrigationAdvisor
    {
        // How far ahead the rainfall outlook looks.
        private const int ForecastHorizonDays = 7;

        // A transition is "approaching" inside this many days.
        private const int TransitionWarningDays = 7;

        public static ZoneAdvice Advise(ZoneAdviceInput input)
        {
            if (input == null) throw new ArgumentNullException(nameof(input));

            var reasoning = new List<string>();
            var facts = new List<AdviceFact>();
            var insights = new List<string>();
            var limitations = new List<string>();

            var advice = new ZoneAdvice { ZoneName = input.ZoneName };

            var crop = Fao56Knowledge.TryResolve(input.CropType);
            advice.CropDisplayName = crop != null ? crop.DisplayName : input.CropType;

            // ---- Soil moisture: the trigger, and the one thing measured -----
            var moisture = input.SoilMoisturePercent;
            var threshold = input.MoistureThresholdPercent;

            if (moisture.HasValue)
            {
                facts.Add(new AdviceFact(
                    "Soil moisture", Fao56Knowledge.Format(moisture.Value, 0) + "%",
                    "latest SoilMoisture sensor reading for this zone"));
            }
            else
            {
                limitations.Add("No soil moisture reading for this zone, so no irrigation trigger can be evaluated at all.");
            }

            if (threshold.HasValue)
            {
                facts.Add(new AdviceFact(
                    "Moisture threshold", Fao56Knowledge.Format(threshold.Value, 0) + "%",
                    "zone.moisture_threshold, configured by the farmer"));
            }
            else
            {
                limitations.Add("This zone has no moisture threshold configured, so auto-irrigation has nothing to trigger against.");
            }

            // ---- Growth stage ------------------------------------------------
            StageAssessment? stage = null;

            if (crop == null)
            {
                limitations.Add(input.CropType == null || input.CropType.Trim().Length == 0
                    ? "This zone has no crop type set, so stage-aware guidance is not available - only the moisture threshold."
                    : "Crop \"" + input.CropType + "\" is not one of the six crops in the FAO-56 knowledge base " +
                      "(maize, potato, tomato, citrus, leafy veg, dry beans), so stage-aware guidance is not available. " +
                      "No substitute crop was used.");
            }
            else if (!input.PlantingDate.HasValue)
            {
                // 3c: the explicit, stated degradation. Do not guess a planting
                // date, and do not fail.
                limitations.Add("Stage-aware guidance needs a planting date, and this zone does not have one. " +
                                "Advice below is moisture-threshold only. Set the zone's planting date to get growth stage, Kc and ETc.");
            }
            else
            {
                stage = GrowthStageCalculator.Assess(crop, input.PlantingDate.Value, input.AsOf);
                advice.Stage = stage;

                facts.Add(new AdviceFact(
                    "Growth stage",
                    stage.StageDisplayName + ", day " + stage.DaysAfterPlanting + " of " + stage.SeasonLengthDays,
                    crop.StageLengthsCite + " (row: planted " + crop.StageLengths.PlantDate + ", " + crop.StageLengths.Region + ")"));

                facts.Add(new AdviceFact("Kc today", Fao56Knowledge.Format(stage.Kc, 2), stage.KcBasis));
            }

            // ---- ET0 / ETc ---------------------------------------------------
            double? et0 = null;
            double? etc = null;

            if (!input.FarmLatitudeDegrees.HasValue)
            {
                limitations.Add("This farm has no latitude recorded, so extraterrestrial radiation (FAO-56 Eq. 21) cannot be computed and there is no ET0 or ETc figure.");
            }
            else if (input.LatestWeather == null)
            {
                limitations.Add("No weather row for this farm yet, so there is no Tmin/Tmax to compute ET0 from.");
            }
            else if (input.LatestWeather.TMaxC < input.LatestWeather.TMinC)
            {
                limitations.Add("The latest weather row has Tmax below Tmin, which is bad data - ET0 was not computed from it.");
            }
            else
            {
                var weather = input.LatestWeather;
                var dayOfYear = weather.Date.DayOfYear;
                var latitude = input.FarmLatitudeDegrees.Value;

                et0 = ReferenceEvapotranspiration.HargreavesEt0Mm(weather.TMinC, weather.TMaxC, latitude, dayOfYear);
                advice.Et0MmPerDay = et0;

                facts.Add(new AdviceFact(
                    "ET0", Fao56Knowledge.Format(et0.Value, 1) + " mm/day",
                    "FAO-56 Eq. 52 (Hargreaves) from Tmin " + Fao56Knowledge.Format(weather.TMinC, 1) + " C / Tmax " +
                    Fao56Knowledge.Format(weather.TMaxC, 1) + " C on " + weather.Date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture) +
                    (weather.IsForecast ? " (forecast row)" : " (actuals row)") +
                    ", latitude " + Fao56Knowledge.Format(latitude, 3)));

                if (ReferenceEvapotranspiration.IsBeyondReliableLatitude(latitude))
                {
                    limitations.Add("Farm latitude is beyond 55 degrees, where FAO-56 (p. 47) warns the Ra equations have limited validity in winter.");
                }

                if (stage != null && stage.IsWithinSeason)
                {
                    etc = stage.Kc * et0.Value;
                    advice.EtcMmPerDay = etc;

                    facts.Add(new AdviceFact(
                        "ETc", Fao56Knowledge.Format(etc.Value, 1) + " mm/day",
                        "ETc = Kc x ET0 = " + Fao56Knowledge.Format(stage.Kc, 2) + " x " +
                        Fao56Knowledge.Format(et0.Value, 1) + " (FAO-56 Eq. 58)"));
                }
            }

            // ---- Stage-specific insights (3e) --------------------------------
            // With the water balance supplied, the balance decides - not the
            // farmer's threshold - so nothing below may claim otherwise.
            var engineDecides = input.WaterBalance != null;

            if (crop != null && stage != null)
            {
                insights.AddRange(BuildInsights(crop, stage, etc, limitations, engineDecides));
            }

            // ---- Rainfall outlook --------------------------------------------
            var upcomingRain = input.Forecast
                .Where(f => f.Date > input.AsOf && f.Date <= input.AsOf.AddDays(ForecastHorizonDays))
                .OrderBy(f => f.Date)
                .ToList();

            var nextMeaningfulRain = upcomingRain.FirstOrDefault(f => f.PrecipitationMm >= 1.0);
            if (nextMeaningfulRain != null)
            {
                facts.Add(new AdviceFact(
                    "Forecast rain",
                    Fao56Knowledge.Format(nextMeaningfulRain.PrecipitationMm, 0) + " mm on " +
                    nextMeaningfulRain.Date.ToString("dddd", CultureInfo.InvariantCulture),
                    "weather_daily forecast row for " + nextMeaningfulRain.Date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)));
            }

            // ---- Decision -----------------------------------------------------
            if (engineDecides)
            {
                // The FAO-56 root-zone water balance (Eq. 82-88) decides, and
                // Action, Reasoning and Summary are worded from its
                // PrimaryAction. The farmer's threshold is not consulted, so
                // the two can never disagree.
                ApplyWaterBalance(input, advice, reasoning, facts, limitations);
            }
            else
            {
                // A caller that has not supplied the balance keeps the original
                // threshold-only decision, unchanged.
                advice.Action = Decide(moisture, threshold, out var decisionSentence);
                reasoning.Add(decisionSentence);

                if (advice.Action == AdviceAction.IrrigateNow && etc.HasValue && nextMeaningfulRain != null)
                {
                    var daysOfDemandCovered = nextMeaningfulRain.PrecipitationMm / etc.Value;
                    reasoning.Add(
                        Fao56Knowledge.Format(nextMeaningfulRain.PrecipitationMm, 0) + " mm forecast on " +
                        nextMeaningfulRain.Date.ToString("dddd", CultureInfo.InvariantCulture) + " is about " +
                        Fao56Knowledge.Format(daysOfDemandCovered, 1) + " days of demand at the current ETc, so it may cover the next cycle.");
                }
            }

            advice.Reasoning = reasoning;
            advice.Facts = facts;
            advice.Insights = insights;
            advice.Limitations = limitations;
            advice.Summary = BuildSummary(input, advice, crop, stage, et0, etc, nextMeaningfulRain, moisture, threshold, engineDecides);

            return advice;
        }

        // The adapter over the water-balance engine. Everything it produces is
        // ADDED to the advice: nothing existing is overwritten.
        private static void ApplyWaterBalance(
            ZoneAdviceInput input, ZoneAdvice advice,
            List<string> reasoning, List<AdviceFact> facts, List<string> limitations)
        {
            var engineInput = input.WaterBalance!;
            var result = Fao56Engine.Run(engineInput);

            advice.WaterBalanceAvailable = result.BalanceRan;
            advice.TotalAvailableWaterMm = result.TawMm;
            advice.ReadilyAvailableWaterMm = result.RawMm;
            advice.DepletionMm = result.DepletionMm;
            advice.RecommendedLitres = result.RecommendedLitres;
            advice.RecommendedMinutes = result.RecommendedMinutes;
            advice.RelativeMoisturePercent = result.RelativeMoisturePercent;
            advice.DayOfSeason = result.DayOfSeason;
            advice.SeasonLengthDays = result.Crop?.TotalDays;
            advice.DaysToNextWatering = result.DaysToNextWatering;
            advice.SeasonStageLabel = result.StageAssumed
                ? RuleBook.CropRules.AssumedStageLabel
                : result.Stage.HasValue
                    ? Fao56EngineReference.StageLabel(result.Stage.Value)
                    : null;
            advice.StageAssumed = result.StageAssumed;
            advice.Confidence = result.Confidence;
            advice.NextStep = result.NextStep;
            advice.RecommendedDepthMm = result.RecommendedDepthMm;
            advice.RecommendedMinutesPerSquareMetre = result.RecommendedMinutesPerSquareMetre;

            var todayRow = result.Days.FirstOrDefault(d => d.Day == engineInput.Today);
            advice.EtoSource = todayRow?.EtoSource;

            facts.AddRange(result.Facts);

            foreach (var limitation in result.Limitations)
            {
                if (!limitations.Contains(limitation)) limitations.Add(limitation);
            }

            // The farmer-facing insight set (spec section 7).
            var insights = ZoneInsightBuilder.Build(
                engineInput, result, input.FaultSignals ?? new ZoneFaultSignals());
            advice.FarmerInsights = insights;

            advice.PrimaryAction = result.PrimaryAction;
            advice.Outlook = result.Outlook;

            // Item 2: the action is the balance's verdict - the same one the
            // farmer reads in FarmerInsights - for every PrimaryAction,
            // including the terminal states the balance returns early from.
            advice.Action = ToAdviceAction(result.PrimaryAction);
            reasoning.Add(DecisionSentence(result));

            // The plain sentence, from the same PrimaryAction.
            advice.PlainSummary = BuildPlainSummary(result, insights);
        }

        // Every PrimaryAction, explicitly. Watering at a reduced amount is
        // still watering; the reduced amount is in RecommendedDepthMm.
        public static AdviceAction ToAdviceAction(IrrigationPrimaryAction action)
        {
            switch (action)
            {
                case IrrigationPrimaryAction.WaterNow:
                case IrrigationPrimaryAction.WaterNowReduced: return AdviceAction.IrrigateNow;
                case IrrigationPrimaryAction.PostponeForRain: return AdviceAction.HoldRainExpected;
                case IrrigationPrimaryAction.NoWaterNeeded: return AdviceAction.NoActionNeeded;
                case IrrigationPrimaryAction.WaterSoon: return AdviceAction.WaterSoon;
                case IrrigationPrimaryAction.CheckField: return AdviceAction.CheckField;
                case IrrigationPrimaryAction.CheckSensor: return AdviceAction.CheckSensor;
                case IrrigationPrimaryAction.CheckIrrigationSystem: return AdviceAction.CheckIrrigationSystem;
                case IrrigationPrimaryAction.FinishSetup: return AdviceAction.FinishSetup;
                case IrrigationPrimaryAction.CropNotPlanted: return AdviceAction.CropNotPlanted;
                case IrrigationPrimaryAction.SeasonComplete: return AdviceAction.SeasonComplete;
                default: return AdviceAction.InsufficientData;
            }
        }

        // The reasoning line for the balance's decision. Plain words only.
        private static string DecisionSentence(ZoneEngineResult r)
        {
            switch (r.PrimaryAction)
            {
                case IrrigationPrimaryAction.WaterNow:
                    return "By the end of today the soil will be drier than this crop can comfortably draw from, so it needs water now.";
                case IrrigationPrimaryAction.WaterNowReduced:
                    return "The rain expected today helps, but the soil will still be drier than this crop can comfortably draw from, so it needs a smaller watering today.";
                case IrrigationPrimaryAction.PostponeForRain:
                    return "Without rain the soil would need water today, but after the rain expected it should stay wetter than its watering point, so watering can wait.";
                case IrrigationPrimaryAction.NoWaterNeeded:
                    return "The soil still holds enough water for this crop today.";
                case IrrigationPrimaryAction.WaterSoon:
                    return "The soil still holds enough water today, but it is expected to reach its watering point in about " +
                           (r.DaysToNextWatering?.ToString(CultureInfo.InvariantCulture) ?? "2") + " day(s).";
                case IrrigationPrimaryAction.CheckField:
                    return "Check the field by hand before watering: the soil sensor and the weather estimate disagree.";
                case IrrigationPrimaryAction.CheckSensor:
                    return "Check the soil sensor before relying on today's watering advice.";
                case IrrigationPrimaryAction.CheckIrrigationSystem:
                    return "Check the pump and pipes before watering.";
                case IrrigationPrimaryAction.FinishSetup:
                    return "Finish this zone's setup to get a watering decision.";
                case IrrigationPrimaryAction.CropNotPlanted:
                    return "The crop has not been planted yet, so no crop watering is advised.";
                case IrrigationPrimaryAction.SeasonComplete:
                    return "The crop's season is over, so no crop watering is advised.";
                default:
                    return "There is not enough information to decide about watering today.";
            }
        }

        private static string BuildPlainSummary(ZoneEngineResult result, IReadOnlyList<ZoneInsight> insights)
        {
            var setupMissing = insights.FirstOrDefault(i => i.InsightType == InsightType.SetupMissing);

            switch (result.PrimaryAction)
            {
                case IrrigationPrimaryAction.WaterNow:
                case IrrigationPrimaryAction.WaterNowReduced:
                    var lead = result.PrimaryAction == IrrigationPrimaryAction.WaterNowReduced ? "Rain helps, but water" : "Water";
                    if (result.RecommendedRuntimeSeconds is { } seconds)
                    {
                        return seconds < 60.0
                            ? lead + " about " + seconds.ToString("0.#", CultureInfo.InvariantCulture) + " sec today."
                            : lead + " about " + (seconds / 60.0).ToString("0.#", CultureInfo.InvariantCulture) + " min today.";
                    }
                    var waterNow = insights.FirstOrDefault(i => i.InsightType == InsightType.WaterNow);
                    return waterNow?.Message ?? lead + " today.";
                case IrrigationPrimaryAction.PostponeForRain:
                    return "Rain is expected, so skip watering today.";
                case IrrigationPrimaryAction.NoWaterNeeded:
                    return "No watering needed today.";
                case IrrigationPrimaryAction.WaterSoon:
                    return "No watering needed today; about " + (result.DaysToNextWatering ?? 2) + " days until the next one.";
                case IrrigationPrimaryAction.CropNotPlanted:
                    return "No crop watering yet: the crop has not been planted.";
                case IrrigationPrimaryAction.SeasonComplete:
                    return "Crop cycle complete: no crop watering is advised.";
                case IrrigationPrimaryAction.FinishSetup:
                case IrrigationPrimaryAction.InsufficientData:
                    return setupMissing?.Message ?? "No watering advice yet: there is not enough information for today.";
                default:
                    return DecisionSentence(result);
            }
        }

        private static AdviceAction Decide(double? moisture, double? threshold, out string sentence)
        {
            if (!moisture.HasValue || !threshold.HasValue)
            {
                sentence = "Cannot decide: " +
                           (!moisture.HasValue && !threshold.HasValue ? "no moisture reading and no threshold configured."
                            : !moisture.HasValue ? "no soil moisture reading for this zone."
                            : "no moisture threshold configured for this zone.");
                return AdviceAction.InsufficientData;
            }

            // The same rule the insight builder uses (item 2b), so the two
            // never disagree at exactly the threshold.
            if (RuleBook.WaterRules.AtOrBelowFarmerThreshold(moisture, threshold, readingFresh: true))
            {
                sentence = "Soil moisture " + Fao56Knowledge.Format(moisture.Value, 0) + "% is at or below the " +
                           Fao56Knowledge.Format(threshold.Value, 0) + "% threshold set for this zone, so the crop needs water.";
                return AdviceAction.IrrigateNow;
            }

            sentence = "Soil moisture " + Fao56Knowledge.Format(moisture.Value, 0) + "% is above the " +
                       Fao56Knowledge.Format(threshold.Value, 0) + "% threshold set for this zone, so no irrigation is called for today.";
            return AdviceAction.NoActionNeeded;
        }

        // 3e. Every line here is tied to something FAO-56 actually says, with
        // the citation attached. Claims the textbook does not support are left
        // out - notably per-crop ranking of which stages are most sensitive to
        // water stress, which is FAO-33 material (yield response factor Ky) and
        // is simply not in FAO-56. See notInFao56 in the knowledge JSON.
        private static IEnumerable<string> BuildInsights(
            Fao56Crop crop, StageAssessment stage, double? etc, List<string> limitations, bool engineDecides)
        {
            var insights = new List<string>();

            // Where this crop sits on the demand curve.
            switch (stage.Stage)
            {
                case GrowthStage.MidSeason:
                    insights.Add("Water demand is at its peak for the season: FAO-56 notes that \"at the mid-season stage the Kc reaches its maximum value\" (FAO-56 p. 96). " +
                                 "Kc will not go higher than " + Fao56Knowledge.Format(crop.Kc.MidSeason, 2) + " for this crop.");
                    break;
                case GrowthStage.Initial:
                    insights.Add("Demand is at its lowest of the season (Kc_ini " + Fao56Knowledge.Format(crop.Kc.Initial, 2) + ", " + crop.KcCite + "). " +
                                 "FAO-56 cautions that tabulated Kc_ini assumes typical wetting - under frequent irrigation or daily rain the real Kc_ini can approach 1.0 to 1.2 " +
                                 "(FAO-56 Table 12 footnote 1, p. 110), so a young crop under daily sprinkling uses more than this figure suggests.");
                    break;
                case GrowthStage.Development:
                    insights.Add("Demand is climbing daily through the development stage as ground cover increases - Kc is interpolating from " +
                                 Fao56Knowledge.Format(crop.Kc.Initial, 2) + " toward " + Fao56Knowledge.Format(crop.Kc.MidSeason, 2) + " (" + crop.KcCite + ").");
                    break;
                case GrowthStage.LateSeason:
                    insights.Add(LateSeasonInsight(crop));
                    break;
            }

            // Approaching-transition warning.
            var transition = GrowthStageCalculator.NextTransition(crop, stage);
            if (transition != null && transition.DaysUntil <= TransitionWarningDays)
            {
                if (transition.NextStage == GrowthStage.MidSeason)
                {
                    var rise = (crop.Kc.MidSeason - stage.Kc) / stage.Kc * 100.0;
                    insights.Add("Entering mid-season in about " + transition.DaysUntil + " day(s) - Kc reaches its maximum " +
                                 Fao56Knowledge.Format(crop.Kc.MidSeason, 2) + " there, which is roughly " +
                                 Fao56Knowledge.Format(Math.Abs(rise), 0) + "% " + (rise >= 0 ? "above" : "below") +
                                 " today's Kc of " + Fao56Knowledge.Format(stage.Kc, 2) + ". Plan for the change in water demand (" + crop.KcCite + ").");
                }
                else if (transition.NextStage == GrowthStage.LateSeason)
                {
                    var change = (crop.Kc.End - crop.Kc.MidSeason) / crop.Kc.MidSeason * 100.0;
                    insights.Add("Entering late season in about " + transition.DaysUntil + " day(s), after which Kc falls from " +
                                 Fao56Knowledge.Format(crop.Kc.MidSeason, 2) + " toward Kc_end " + Fao56Knowledge.Format(crop.Kc.End, 2) +
                                 " (" + Fao56Knowledge.Format(Math.Abs(change), 0) + "% " + (change >= 0 ? "higher" : "lower") + ") over " +
                                 crop.StageLengths.LateSeasonDays + " days (" + crop.KcCite + ").");
                }
                else if (transition.NextStage == GrowthStage.Development)
                {
                    insights.Add("Entering the crop development stage in about " + transition.DaysUntil + " day(s), where Kc begins climbing from " +
                                 Fao56Knowledge.Format(crop.Kc.Initial, 2) + " toward " + Fao56Knowledge.Format(crop.Kc.MidSeason, 2) + " (" + crop.KcCite + ").");
                }
            }

            // Depletion tolerance, and how the weather tightens it.
            var tabulatedP = crop.Soil.DepletionFractionP;
            var pLine = "FAO-56 gives this crop a soil-water depletion fraction p = " + Fao56Knowledge.Format(tabulatedP, 2) +
                        " - the share of plant-available water it can lose before it starts suffering stress (" + crop.SoilCite + "), " +
                        "at a reference ETc of about 5 mm/day.";

            if (etc.HasValue)
            {
                var adjusted = Fao56Knowledge.AdjustDepletionFractionForEtc(tabulatedP, etc.Value);
                if (Math.Abs(adjusted - tabulatedP) >= 0.01)
                {
                    pLine += " At today's ETc of " + Fao56Knowledge.Format(etc.Value, 1) + " mm/day that tightens to p = " +
                             Fao56Knowledge.Format(adjusted, 2) + " (FAO-56 p. 162: p = p_Table22 + 0.04 (5 - ETc)), " +
                             (adjusted < tabulatedP
                                 ? "so in this heat the crop tolerates LESS drying than the table alone suggests."
                                 : "so in these mild conditions the crop tolerates MORE drying than the table alone suggests.");
                }
            }
            insights.Add(pLine);

            // Say plainly why p is context and not a trigger. Only true on the
            // threshold-only path: with the balance, p (via RAW) is the trigger.
            if (!engineDecides) limitations.Add("FAO-56's depletion limit p is a fraction of plant-available water, which needs the soil's field capacity and wilting point " +
                            "(FAO-56 Table 19) to convert into a moisture percentage. AgroFlow does not record soil texture per zone, so p is reported as " +
                            "context only - the irrigation trigger remains the farmer's configured moisture threshold.");

            // Crop-specific notes carried straight from the tables.
            if (!string.IsNullOrWhiteSpace(crop.KcShapeWarning)) insights.Add(crop.KcShapeWarning!);
            if (!string.IsNullOrWhiteSpace(crop.KcEndNote)) insights.Add(crop.KcEndNote!);

            if (crop.Kc.EndIsMidpointOfPublishedRange && stage.Stage == GrowthStage.LateSeason)
            {
                insights.Add("Note on the numbers: FAO-56 publishes Kc_end for this crop as the range " +
                             Fao56Knowledge.Format(crop.Kc.EndRangeMin ?? 0, 2) + " to " + Fao56Knowledge.Format(crop.Kc.EndRangeMax ?? 0, 2) +
                             " rather than a single value (" + crop.KcCite + "). The midpoint " + Fao56Knowledge.Format(crop.Kc.End, 2) +
                             " is used here, so today's late-season Kc and ETc carry that spread.");
            }

            return insights;
        }

        private static string LateSeasonInsight(Fao56Crop crop)
        {
            // FAO-56 p. 97 is explicit that Kc_end encodes a management choice,
            // which is what makes "should I dry this down?" answerable from the
            // table rather than from folklore.
            var line = "Late season. FAO-56 (p. 97) explains that Kc_end \"reflects crop and water management practices\": it is high if the crop is " +
                       "irrigated until harvested fresh, and small if the crop is allowed to senesce and dry out in the field before harvest. " +
                       "This crop's Kc_end is " + Fao56Knowledge.Format(crop.Kc.End, 2) + " (" + crop.KcCite + ")";

            if (crop.Kc.EndAlternate.HasValue)
            {
                line += ", and FAO-56 gives an alternative Kc_end of " + Fao56Knowledge.Format(crop.Kc.EndAlternate.Value, 2) +
                        " for the dry-down case: \"" + (crop.KcEndFootnote ?? string.Empty) + "\" (" + (crop.KcEndFootnoteCite ?? crop.KcCite) + "). " +
                        "If you intend to dry this crop down before harvest, that lower figure is the one to plan against.";
            }
            else if (crop.Kc.End >= 0.90 * crop.Kc.MidSeason)
            {
                line += ", which stays close to its mid-season value - on FAO-56's own reading (p. 97) that is the signature of a crop watered right " +
                        "through to harvest, so late-season dry-down is not appropriate here.";
            }
            else
            {
                line += ".";
            }

            return line;
        }

        private static string BuildSummary(
            ZoneAdviceInput input, ZoneAdvice advice, Fao56Crop? crop, StageAssessment? stage,
            double? et0, double? etc, DailyWeather? nextRain, double? moisture, double? threshold, bool engineDecides)
        {
            var parts = new List<string>();

            var header = input.ZoneName;
            if (crop != null) header += " (" + crop.DisplayName + ")";
            else if (!string.IsNullOrWhiteSpace(input.CropType)) header += " (" + input.CropType + ")";
            parts.Add(header);

            if (stage != null && stage.IsWithinSeason)
            {
                parts.Add(stage.StageDisplayName + ", day " + stage.DaysAfterPlanting + " of ~" + stage.SeasonLengthDays +
                          " (" + stage.DaysRemainingInStage + " day(s) left in this stage)");

                var kcSentence = "Kc " + Fao56Knowledge.Format(stage.Kc, 2);
                if (etc.HasValue) kcSentence += ", ETc " + Fao56Knowledge.Format(etc.Value, 1) + " mm/day";
                else if (et0.HasValue) kcSentence += ", ET0 " + Fao56Knowledge.Format(et0.Value, 1) + " mm/day (no ETc: see limitations)";
                parts.Add(kcSentence);
            }
            else if (stage != null)
            {
                parts.Add(stage.StageDisplayName);
            }
            else
            {
                parts.Add("stage-aware guidance unavailable");
            }

            // With the balance deciding, the threshold comparison is not the
            // reason for the action, so it is not stated as one.
            if (engineDecides && moisture.HasValue)
            {
                parts.Add("Soil moisture " + Fao56Knowledge.Format(moisture.Value, 0) + "%");
            }
            else if (moisture.HasValue && threshold.HasValue)
            {
                parts.Add("Soil moisture " + Fao56Knowledge.Format(moisture.Value, 0) + "%, " +
                          (RuleBook.WaterRules.AtOrBelowFarmerThreshold(moisture, threshold, readingFresh: true) ? "at or below" : "above") + " the " +
                          Fao56Knowledge.Format(threshold.Value, 0) + "% threshold");
            }
            else if (moisture.HasValue)
            {
                parts.Add("Soil moisture " + Fao56Knowledge.Format(moisture.Value, 0) + "% (no threshold configured)");
            }

            switch (advice.Action)
            {
                case AdviceAction.IrrigateNow:
                    var action = advice.PrimaryAction == IrrigationPrimaryAction.WaterNowReduced
                        ? "Irrigate today at a reduced amount; the rain expected helps but is not enough"
                        : "Irrigate today";
                    // The threshold path's forward-looking hint. The balance has
                    // its own outlook, which already accounts for that rain.
                    if (!engineDecides && nextRain != null && etc.HasValue)
                    {
                        action += "; " + Fao56Knowledge.Format(nextRain.PrecipitationMm, 0) + " mm forecast " +
                                  nextRain.Date.ToString("dddd", CultureInfo.InvariantCulture) + " may cover the next cycle";
                    }
                    parts.Add(action);
                    break;
                case AdviceAction.HoldRainExpected:
                    parts.Add("Hold irrigation today: the rain expected should keep the soil above its watering point");
                    break;
                case AdviceAction.NoActionNeeded:
                    parts.Add("No irrigation needed today");
                    break;
                case AdviceAction.WaterSoon:
                    parts.Add("No irrigation needed today; irrigation is likely within " +
                              (advice.DaysToNextWatering?.ToString(CultureInfo.InvariantCulture) ?? "2") + " day(s)");
                    break;
                case AdviceAction.CheckField:
                    parts.Add("Check the field by hand before irrigating");
                    break;
                case AdviceAction.CheckSensor:
                    parts.Add("Check the soil sensor before irrigating");
                    break;
                case AdviceAction.CheckIrrigationSystem:
                    parts.Add("Check the pump and pipes before irrigating");
                    break;
                case AdviceAction.CropNotPlanted:
                    parts.Add("No crop irrigation yet: the crop has not been planted");
                    break;
                case AdviceAction.SeasonComplete:
                    parts.Add("Crop cycle complete: no crop irrigation is advised");
                    break;
                case AdviceAction.FinishSetup:
                case AdviceAction.InsufficientData:
                    parts.Add("No watering call yet - see what to add to this zone below");
                    break;
            }

            return string.Join(". ", parts) + ".";
        }
    }
}
