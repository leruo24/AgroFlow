using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text;
using AgroFlow.Business.Agronomy;
using AgroFlow.Business.Agronomy.RuleBook;
using Xunit;

namespace AgroFlow.Domain.Tests;

// Item 2b: docs/rule-book.md is GENERATED from the rules, so it cannot drift
// from the code. Every "outcome" and every farmer sentence below is what the
// code returns for those inputs - computed here, never typed.
//
// The test fails when the committed file differs from what the code now says.
// To regenerate after changing a rule:
//   AGROFLOW_WRITE_RULEBOOK=1 dotnet test --filter RuleBookDocument
public class RuleBookDocumentTests
{
    [Fact]
    public void RuleBookDocument_MatchesTheCode()
    {
        var path = Path.Combine(FindRepoRoot(), "docs", "rule-book.md");
        var generated = RuleBookDocument.Build();

        if (Environment.GetEnvironmentVariable("AGROFLOW_WRITE_RULEBOOK") == "1")
        {
            File.WriteAllText(path, generated, new UTF8Encoding(false));
        }

        Assert.True(File.Exists(path), "docs/rule-book.md is missing. Regenerate it: AGROFLOW_WRITE_RULEBOOK=1 dotnet test --filter RuleBookDocument");

        var committed = File.ReadAllText(path).Replace("\r\n", "\n");
        Assert.True(committed == generated.Replace("\r\n", "\n"),
            "docs/rule-book.md no longer matches the rules in code. Regenerate it: AGROFLOW_WRITE_RULEBOOK=1 dotnet test --filter RuleBookDocument");
    }

    [Fact]
    public void RuleBookDocument_HasTheBriefsSoilStageRawRainTable_AndNeedsAnotherSource()
    {
        var doc = RuleBookDocument.Build();
        Assert.Contains("| Soil | Crop stage | Dryness vs RAW | Rain forecast | → Action |", doc);
        Assert.Contains("## Needs another source", doc);
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

public static class RuleBookDocument
{
    private static readonly CultureInfo Inv = CultureInfo.InvariantCulture;
    private static readonly DateOnly Today = new DateOnly(2026, 10, 6);

    // The worked example every table uses, so the numbers can be checked by
    // hand: maize in a 1.5 m² plot with a 0.3 m usable root zone, a
    // 1.5 L/min drip line, and a
    // 5 mm/day crop water use.
    private const string ExampleCrop = "maize";
    private const double ExampleRootLimitM = 0.3;
    private const double ExampleAreaM2 = 1.5;
    private const double ExampleFlowLpm = 1.5;
    private const double ExampleNeedMm = 5.0;

    public static string Build()
    {
        var sb = new StringBuilder();
        void L(string line = "") => sb.Append(line).Append('\n');

        L("# AgroFlow rule book");
        L("");
        L("Every piece of advice AgroFlow gives comes from a small, named rule in");
        L("`backend/AgroFlow.Domain/Agronomy/RuleBook/`. This page is **generated from");
        L("those rules** by `RuleBookDocument.cs`: every outcome and every farmer sentence");
        L("below is what the code returns for those inputs. A test fails if this page and");
        L("the code disagree. Regenerate with:");
        L("");
        L("```");
        L("AGROFLOW_WRITE_RULEBOOK=1 dotnet test --filter RuleBookDocument");
        L("```");
        L("");
        L("**Sources.** \"FAO-56\" is Allen et al. (1998), *Crop evapotranspiration*, FAO");
        L("Irrigation and Drainage Paper 56, `docs/Fao56.pdf`; page numbers are the book's");
        L("printed pages. A **DATA RULE** is our own judgement from how the kit and farms");
        L("behave, not FAO-56 - each one says why.");
        L("");
        L("**One table.** Every rule reads crop and soil values from `Fao56EngineReference.cs`; none");
        L("is re-typed in a rule. An older extract, `fao56-crop-knowledge.json`, still feeds the");
        L("FAO-56 notes in the schedule report. For maize and potato it uses a different Table 11");
        L("row (a different planting season) - both are published FAO-56 values, and the reason is");
        L("written at the top of `Fao56EngineReference.cs`. No advice on this page comes from it.");
        L("");
        L("**Worked example** used in every table: maize in a " + N(ExampleAreaM2) +
          " m² plot with a " + N(ExampleRootLimitM) + " m usable root zone, a " +
          N(ExampleFlowLpm) + " L/min drip line, crop water use " + N(ExampleNeedMm) + " mm/day.");
        L("");
        L("## The order the rules run in");
        L("");
        L("`ZoneInsightBuilder` calls the rules in this order; the first act-now message wins.");
        L("");
        L("1. `ConfidenceRules.NextStep` → setup step (one, not a list)");
        L("2. `KitRules.IsOffline` → zone offline");
        L("3. `KitRules.IsStuck` → sensor stuck");
        L("4. `KitRules.PumpRanNoChange` → watering failed");
        L("5. `KitRules.IsDhtOffline` → temperature sensor offline");
        L("6. `WaterRules.RecommendedThreshold` + `ThresholdTooDry` → threshold unsafe");
        L("7. `WaterRules.ShouldWaterToday`, then `AtOrBelowFarmerThreshold` → due for water");
        L("8. `WaterRules.SkipForRain` → skip for rain, else water now");
        L("9. a day with no weather → data gap");
        L("10. `WaterRules.WaterSoon` → water soon");
        L("11. `WaterRules.HotDaysAhead` → hot days");
        L("12. `CropRules` (assumed stage, `SeasonComplete`, `SensitiveStage`, `NextStageChange`, `HarvestSoon`) → growth messages");
        L("13. `WaterRules.WasStressed` → stress days");
        L("14. `VerdictRules.For` = Too much → overwatering");
        L("15. `KitRules.IsDrifting` → sensor drift");
        L("");

        WateringTable(L);
        SoilTable(L);
        CropTable(L);
        WaterRulesTable(L);
        VerdictTable(L);
        ConfidenceTable(L);
        KitTable(L);
        TodayTable(L);
        RecommendationTable(L);
        NeedsAnotherSource(L);

        return sb.ToString();
    }

    // ---- 1. The brief's table -------------------------------------------

    private static void WateringTable(Action<string> L)
    {
        var crop = Fao56EngineReference.TryResolveCrop(ExampleCrop)!;
        var rootDepth = SoilWaterBalance.EffectiveRootDepthM(crop.RootDepthM, ExampleRootLimitM);

        L("## 1. Should I water today? (soil × stage × dryness × rain)");
        L("");
        L("Rules: `WaterRules.ShouldWaterToday` (FAO-56 p. 171: water \"before or at the moment\" the");
        L("readily available water is used up, Dr ≥ RAW) and `WaterRules.SkipForRain` (DATA RULE: rain");
        L("at least today's need replaces today's watering - Eq. 85, p. 170, credits rain like irrigation).");
        L("RAW comes from the soil (Table 19, p. 144), the crop's p (Table 22, pp. 163-165), the soil");
        L("adjustment (p. 167) and today's water use (p. 162).");
        L("");
        L("| Soil | Crop stage | Dryness vs RAW | Rain forecast | → Action | Farmer sentence | Source |");
        L("|---|---|---|---|---|---|---|");

        foreach (var soilKey in new[] { "loam", "sandy", "clay" })
        {
            var soil = SoilRules.WaterHoldingFor(soilKey);
            var taw = SoilRules.TotalAvailableWaterMm(soil, rootDepth);
            var p = SoilWaterBalance.AdjustP(crop.DepletionFractionP, soil.Soil.PFactor, ExampleNeedMm);
            var raw = Math.Round(SoilWaterBalance.ReadilyAvailableWaterMm(p, taw), 1);
            var soilLabel = soilKey == "loam" ? "any (loam shown)" : soil.Soil.Label;

            var cases = soilKey == "loam"
                ? new[] { (Dr: raw - 1.0, Rain: 0.0), (Dr: raw, Rain: 0.0), (Dr: raw, Rain: ExampleNeedMm - 0.1), (Dr: raw, Rain: ExampleNeedMm), (Dr: raw, Rain: 12.0) }
                : new[] { (Dr: raw, Rain: 0.0) };

            foreach (var c in cases)
            {
                var (action, sentence) = Decide(crop, soil, c.Dr, raw, c.Rain);
                var vsRaw = c.Dr < raw ? $"below RAW ({N(c.Dr)} of {N(raw)} mm)" : c.Dr == raw ? $"at RAW ({N(raw)} mm)" : $"over RAW";
                var rain = c.Rain == 0.0 ? "none" : c.Rain < ExampleNeedMm ? $"{N(c.Rain)} mm < need" : c.Rain == ExampleNeedMm ? $"{N(c.Rain)} mm = need" : $"{N(c.Rain)} mm > need";
                L($"| {soilLabel} | any | {vsRaw} | {rain} | {action} | \"{sentence}\" | p. 171; p. 170 |");
            }
        }

        L("");
        L("**What the soil changes.** Sand holds less water than loam and clay more (Table 19), so in");
        L("sand RAW is reached sooner and each watering is smaller - shorter, more often. That is not a");
        L("separate rule: it falls out of the numbers above. Whether clay should be watered *slowly*");
        L("(infiltration rate) is not in FAO-56 and is listed under \"Needs another source\".");
        L("");
        L("**Stage.** Stage changes the crop factor (Table 12) and so the daily need, not the rule. At");
        L("peak growth a shortage costs the most yield (p. 176) - see the crop table.");
        L("");
    }

    private static (string Action, string Sentence) Decide(
        Fao56EngineCrop crop, SoilWaterHolding soil, double depletion, double raw, double rainMm)
    {
        var noRain = depletion + ExampleNeedMm;
        var effectiveRain = SoilWaterBalance.EffectiveRainfallMm(rainMm, ExampleNeedMm);
        var postRain = Math.Max(0, noRain - effectiveRain);
        var dueWithoutRain = noRain >= raw;
        var primary = dueWithoutRain && effectiveRain > 0 && postRain < raw
            ? IrrigationPrimaryAction.PostponeForRain
            : dueWithoutRain && effectiveRain > 0
                ? IrrigationPrimaryAction.WaterNowReduced
                : dueWithoutRain ? IrrigationPrimaryAction.WaterNow : IrrigationPrimaryAction.NoWaterNeeded;
        var required = primary is IrrigationPrimaryAction.WaterNow or IrrigationPrimaryAction.WaterNowReduced
            ? postRain
            : (double?)null;
        var input = new ZoneEngineInput { ZoneId = 1, ZoneName = "North Plot", CropType = crop.Key, Today = Today };
        var result = new ZoneEngineResult
        {
            ZoneId = 1,
            ZoneName = "North Plot",
            Crop = crop,
            Soil = soil.Soil,
            BalanceRan = true,
            DepletionMm = depletion,
            RawMm = raw,
            EtcTodayMm = ExampleNeedMm,
            PrimaryAction = primary,
            ProjectedPostRainDepletionMm = postRain,
            ForecastRainTodayMm = rainMm,
            RecommendedLitres = required.HasValue ? SoilWaterBalance.IrrigationLitres(required.Value, ExampleAreaM2) : null,
            RecommendedRuntimeSeconds = required.HasValue
                ? SoilWaterBalance.IrrigationRuntimeSeconds(SoilWaterBalance.IrrigationLitres(required.Value, ExampleAreaM2), ExampleFlowLpm)
                : null,
            RecommendedMinutes = required.HasValue
                ? SoilWaterBalance.IrrigationRuntimeSeconds(SoilWaterBalance.IrrigationLitres(required.Value, ExampleAreaM2), ExampleFlowLpm) / 60.0
                : null,
            RecommendedDepthMm = required.HasValue ? Math.Round(required.Value, 1) : null,
        };
        result.Days.Add(new WaterBalanceDay { Day = Today, RainMm = rainMm, IsForecast = true });

        var insights = ZoneInsightBuilder.Build(input, result, new ZoneFaultSignals());
        var skip = insights.FirstOrDefault(i => i.InsightType == InsightType.SkipRain);
        if (skip != null) return ("Postpone for rain", skip.Message);
        var water = insights.FirstOrDefault(i => i.InsightType == InsightType.WaterNow);
        if (water != null) return ("Water today", water.Message);
        return ("No watering", "No watering needed today.");
    }

    // ---- 2. Soil ----------------------------------------------------------

    private static void SoilTable(Action<string> L)
    {
        var crop = Fao56EngineReference.TryResolveCrop(ExampleCrop)!;
        var rootDepth = SoilWaterBalance.EffectiveRootDepthM(crop.RootDepthM, ExampleRootLimitM);

        L("## 2. Soil rules (`SoilRules`)");
        L("");
        L("`WaterHoldingFor` - FAO-56 Table 19 (p. 144), midpoints. No soil type → loam, labelled");
        L("\"assumed\" (DATA RULE: loam sits between sand and clay, so the error is bounded both ways).");
        L("`DepletionFactorAdjust` - p. 167: p \"can be reduced by 5-10%\" for clay and \"increased by");
        L("5-10%\" for sand; the cautious 5% is used. `TotalAvailableWaterMm` - Eq. 82, p. 162.");
        L("");
        L($"| Soil | θFC | θWP | p × | Water held in {N(rootDepth)} m (TAW) | Source |");
        L("|---|---|---|---|---|---|");
        foreach (var soil in Fao56EngineReference.AllSoils)
        {
            var holding = SoilRules.WaterHoldingFor(soil.Key);
            L($"| {soil.Label} | {N(holding.ThetaFieldCapacity, "0.###")} | {N(holding.ThetaWiltingPoint, "0.###")} | ×{N(SoilRules.DepletionFactorAdjust(soil.Key), "0.00")} | {N(SoilRules.TotalAvailableWaterMm(holding, rootDepth))} mm | Table 19 '{soil.Table19Class}', p. 144; p. 167 |");
        }
        var none = SoilRules.WaterHoldingFor(null);
        L($"| (not set) | as {none.Soil.Label} | | | | assumed: {none.Assumed.ToString().ToLowerInvariant()} |");
        L("");
    }

    // ---- 3. Crop ----------------------------------------------------------

    private static void CropTable(Action<string> L)
    {
        L("## 3. Crop rules (`CropRules`)");
        L("");
        L("`KcFor` - Table 12 (pp. 110-114) joined by Eq. 66 (p. 132). `StageFor` - Table 11");
        L("(pp. 104-108) stage lengths; the last day of a stage still counts as that stage.");
        L("`KcWhenStageUnknown` (no planting date) - DATA RULE: the **highest** of the crop's three");
        L("Table 12 values, labelled \"" + CropRules.AssumedStageLabel + "\", so a wrong guess errs toward enough water.");
        L("That is Kc mid for every crop except citrus, whose Kc mid is below its Kc ini.");
        L("`SensitiveStage` - p. 176: yield loss from shortage is largest at flowering and yield");
        L("formation, which fall in mid-season (p. 95-96) - farmers' \"Peak growth\".");
        L($"`StageChangeSoon` warns {CropRules.StageChangeWarningDays} days ahead and `HarvestSoon` in the last {CropRules.HarvestSoonDays} days (DATA RULES: one watering routine; when the late-season fall in Kc starts to matter).");
        L("");
        L("| Crop | Kc start | Kc peak | Kc end | Kc with no planting date | Stage days (est./grow/peak/late) | p | Root depth | Source |");
        L("|---|---|---|---|---|---|---|---|---|");
        foreach (var c in Fao56EngineReference.AllCrops.OrderBy(c => c.Label, StringComparer.Ordinal))
        {
            L($"| {c.Label} | {N(c.KcIni, "0.00")} | {N(c.KcMid, "0.00")} | {N(c.KcEnd, "0.00")} | {N(CropRules.KcWhenStageUnknown(c), "0.00")} | {c.LIniDays}/{c.LDevDays}/{c.LMidDays}/{c.LLateDays} = {c.TotalDays} | {N(c.DepletionFractionP, "0.00")} | {N(c.RootDepthM, "0.0#")} m | {c.Table11Row}; Tables 12 and 22 |");
        }
        L("");
        L("| Stage | Shortage costs the most yield? |");
        L("|---|---|");
        foreach (SeasonStage s in Enum.GetValues(typeof(SeasonStage)))
        {
            L($"| {Fao56EngineReference.StageLabel(s)} | {(CropRules.SensitiveStage(s) ? "**yes** (p. 176)" : "no")} |");
        }
        L("");
    }

    // ---- 4. Water -------------------------------------------------------

    private static void WaterRulesTable(Action<string> L)
    {
        L("## 4. Water rules (`WaterRules`)");
        L("");
        L("| Rule | Input | → Outcome | Source |");
        L("|---|---|---|---|");
        L($"| `ShouldWaterToday` | dryness 19.9 mm, RAW 20 mm | {YesNo(WaterRules.ShouldWaterToday(19.9, 20))} | p. 171 |");
        L($"| `ShouldWaterToday` | dryness 20 mm, RAW 20 mm | {YesNo(WaterRules.ShouldWaterToday(20, 20))} | p. 171 (\"or at the moment\") |");
        L($"| `SkipForRain` | rain 4.9 mm, need 5 mm | {YesNo(WaterRules.SkipForRain(4.9, 5))} | DATA RULE, Eq. 85 p. 170 |");
        L($"| `SkipForRain` | rain 5 mm, need 5 mm | {YesNo(WaterRules.SkipForRain(5, 5))} | DATA RULE, Eq. 85 p. 170 |");
        L($"| `MinutesToRun` | 6 mm, 1.5 m², 1.5 L/min | {WaterRules.MinutesToRun(6, 1.5, 1.5)} min | 1 mm on 1 m² = 1 L (Ch. 1 p. 3); never more than the dryness (p. 171); rounded up (DATA RULE) |");
        L($"| `MinutesToRun` | 6.1 mm, 1.5 m², 1.5 L/min | {WaterRules.MinutesToRun(6.1, 1.5, 1.5)} min | rounded up, never under-waters |");
        L($"| `MinutesPerSquareMetre` | 6 mm, 1.5 L/min, no size | {N(WaterRules.MinutesPerSquareMetre(6, 1.5)!.Value)} min per m² | Ch. 1 p. 3; one decimal (DATA RULE) |");
        L($"| `WaterSoon` | next watering in {WaterRules.WaterSoonDays} days | {YesNo(WaterRules.WaterSoon(WaterRules.WaterSoonDays))} | DATA RULE: {WaterRules.WaterSoonDays}-day look-ahead |");
        L($"| `WaterSoon` | next watering in {WaterRules.WaterSoonDays + 1} days | {YesNo(WaterRules.WaterSoon(WaterRules.WaterSoonDays + 1))} | |");
        L($"| `HotDaysAhead` | forecast peak 5.2 mm, last week 4.0 mm | {YesNo(WaterRules.HotDaysAhead(5.2, 4.0))} | DATA RULE: ×{N(WaterRules.HotDaysEtoMultiple)} |");
        L($"| `WasStressed` | Ks 1.0 / 0.99 | {YesNo(WaterRules.WasStressed(1.0))} / {YesNo(WaterRules.WasStressed(0.99))} | Eq. 84, p. 169 |");
        L($"| `AtOrBelowFarmerThreshold` | 30% vs 30%, fresh | {YesNo(WaterRules.AtOrBelowFarmerThreshold(30, 30, true))} | DATA RULE: the farmer's own level |");
        L($"| `AtOrBelowFarmerThreshold` | 10% vs 30%, reading a day old | {YesNo(WaterRules.AtOrBelowFarmerThreshold(10, 30, false))} | stale readings never decide alone |");
        L($"| `WateringResetsBalance` | 2 min run, no size or flow | {YesNo(WaterRules.WateringResetsBalance(WaterRules.FullWateringMinimumSeconds, false))} | DATA RULE: \"the last full watering as the reset\" |");
        L($"| `WateringResetsBalance` | 1 min 59 s run | {YesNo(WaterRules.WateringResetsBalance(WaterRules.FullWateringMinimumSeconds - 1, false))} | a pump test is not a watering |");
        L($"| `RecommendedThreshold` | maize p 0.55, loam, wet 1200, dry 3000 | {N(WaterRules.RecommendedThreshold(0.55, 1.0, 1200, 3000))} | Table 22 p, p. 167, clamp 0.1-0.8 p. 162 |");
        L($"| `SoilFeelDepletion` | farmer says \"wet\", dryness 12 mm, RAW 20 mm | {N(WaterRules.SoilFeelDepletion("wet", 12, 20))} mm | field capacity, Dr = 0 (p. 167) |");
        L($"| `SoilFeelDepletion` | farmer says \"dry\", dryness 6 mm, RAW 20 mm | {N(WaterRules.SoilFeelDepletion("dry", 6, 20))} mm | at least RAW - the watering point (p. 171) |");
        L($"| `SoilFeelDepletion` | farmer says \"moist\", dryness 18 mm, RAW 20 mm | {N(WaterRules.SoilFeelDepletion("moist", 18, 20))} mm | DATA RULE: held between {N(WaterRules.MoistLowFractionOfRaw * 100)}% and {N(WaterRules.MoistHighFractionOfRaw * 100)}% of RAW |");
        L("");
        L("A soil check by hand counts for the day it was made (the latest one that day wins) and,");
        L($"within {ConfidenceRules.FreshReadingHours} h, is named in the confidence (\"based on the weather and your own soil check\").");
        L("It never makes the advice High - only a set-up sensor does.");
        L("");
    }

    // ---- 5. Verdict -----------------------------------------------------

    private static void VerdictTable(Action<string> L)
    {
        L("## 5. Verdict rules (`VerdictRules`)");
        L("");
        L($"DATA RULE: more than ×{N(VerdictRules.OverwaterRatio)} the crop's need is too much, less than ×{N(VerdictRules.UnderwaterRatio)} too little.");
        L("Pump litres are estimates (run time × flow rate, no flow meter), so a tighter band would flag");
        L("noise. Exactly on a boundary is still \"About right\".");
        L("");
        L("| Water given | Water needed | Ratio | → Verdict |");
        L("|---|---|---|---|");
        foreach (var (applied, needed) in new[] { (7.9, 10.0), (8.0, 10.0), (10.0, 10.0), (12.0, 10.0), (12.1, 10.0), (5.0, 0.0) })
        {
            var ratio = needed > 0 ? N(applied / needed, "0.00") : "-";
            L($"| {N(applied)} L | {N(needed)} L | {ratio} | {VerdictRules.Label(VerdictRules.For(applied, needed))} |");
        }
        L("");
    }

    // ---- 6. Confidence --------------------------------------------------

    private static void ConfidenceTable(Action<string> L)
    {
        L("## 6. Confidence rules (`ConfidenceRules`)");
        L("");
        L($"All DATA RULES: FAO-56 does not say how far to trust partial inputs. High needs everything set up");
        L($"and a reading under {N(ConfidenceRules.FreshReadingHours)} hours old; Medium allows up to {ConfidenceRules.MaxMissingForMedium} missing inputs;");
        L("otherwise Low. The next step is the first missing input in this order: crop, planting date,");
        L("flow rate, area, soil, wet/dry setup - then a quiet kit.");
        L("");
        L("| Situation | → Level and reason | → Next step |");
        L("|---|---|---|");

        ZoneSetupState Full() => new ZoneSetupState
        {
            CropKnown = true, PlantingDateKnown = true, SoilSet = true, AreaSet = true, FlowRateSet = true,
            Calibrated = true, ReadingFresh = true, HasKit = true, WeatherAvailable = true,
            LastReadingAtUtc = new DateTime(2026, 10, 6, 6, 0, 0, DateTimeKind.Utc),
        };

        var cases = new List<(string, ZoneSetupState)>
        {
            ("Everything set up, fresh reading", Full()),
            ("No planting date", With(Full(), s => s.PlantingDateKnown = false)),
            ("No planting date, no zone size", With(Full(), s => { s.PlantingDateKnown = false; s.AreaSet = false; })),
            ("No planting date, size or soil", With(Full(), s => { s.PlantingDateKnown = false; s.AreaSet = false; s.SoilSet = false; })),
            ("Sensor not set up", With(Full(), s => s.Calibrated = false)),
            ("Kit quiet since 17 Sep", With(Full(), s => { s.ReadingFresh = false; s.LastReadingAtUtc = new DateTime(2026, 9, 17, 6, 0, 0, DateTimeKind.Utc); })),
            ("Everything set up, no kit", With(Full(), s => { s.ReadingFresh = false; s.HasKit = false; s.LastReadingAtUtc = null; })),
            ("No crop", With(Full(), s => s.CropKnown = false)),
            ("No weather", With(Full(), s => s.WeatherAvailable = false)),
        };

        foreach (var (label, state) in cases)
        {
            var c = ConfidenceRules.For(state);
            var step = ConfidenceRules.NextStep(state);
            L($"| {label} | {c.Reason} | {(step == null ? "-" : step.Ask)} |");
        }
        L("");
    }

    private static ZoneSetupState With(ZoneSetupState s, Action<ZoneSetupState> change)
    {
        change(s);
        return s;
    }

    // ---- 7. Kit ---------------------------------------------------------

    private static void KitTable(Action<string> L)
    {
        L("## 7. Kit rules (`KitRules`)");
        L("");
        L("All DATA RULES - FAO-56 knows nothing about sensors. A kit reports every 30 seconds.");
        L("");
        L("| Problem | Rule | → Farmer sentence |");
        L("|---|---|---|");

        var input = new ZoneEngineInput { ZoneId = 1, ZoneName = "North Plot", Today = Today, CalibrationWet = 1200, CalibrationDry = 3000 };
        var result = new ZoneEngineResult { ZoneId = 1, ZoneName = "North Plot", LatestReadingAtUtc = new DateTime(2026, 10, 6, 6, 0, 0, DateTimeKind.Utc) };

        string Sentence(ZoneFaultSignals s, string type) =>
            ZoneInsightBuilder.Build(input, result, s).First(i => i.InsightType == type).Message;

        L($"| Offline | no reading for {KitRules.ZoneOfflineHours} h | \"{Sentence(new ZoneFaultSignals { SinceLastReading = TimeSpan.FromHours(KitRules.ZoneOfflineHours) }, InsightType.ZoneOffline)}\" |");
        L($"| Sensor stuck | same reading for {KitRules.SensorStuckHours} h | \"{Sentence(new ZoneFaultSignals { IdenticalReadingFor = TimeSpan.FromHours(KitRules.SensorStuckHours) }, InsightType.SensorStuck)}\" |");
        L($"| Pump ran, no change | a run of at least {N(KitRules.PumpCheckMinimumSeconds / 60.0)} min, soil no wetter {KitRules.PumpCheckWindowMinutes} min later; never judged on missing readings | \"{Sentence(new ZoneFaultSignals { WateringAppearedToFail = true }, InsightType.WateringFailed)}\" |");
        L($"| Temperature sensor offline | soil readings arriving, no valid temperature/humidity for {KitRules.DhtOfflineWindowHours} h; back after {KitRules.DhtBackOnlineReadingCount} good readings in a row | \"{Sentence(new ZoneFaultSignals { DhtOffline = true }, InsightType.DhtOffline)}\" |");
        L($"| Sensor drift | wettest reading this week more than {N(KitRules.SensorDriftFraction * 100)}% of the wet/dry span from the saved wet point | \"{Sentence(new ZoneFaultSignals { SevenDayMinimumReading = 1200 + 0.2 * 1800 }, InsightType.SensorDrift)}\" |");
        L("");
    }

    // ---- 8. Today's one action -------------------------------------------

    private static void TodayTable(Action<string> L)
    {
        L("## 8. Today's one action (`TodayRules`)");
        L("");
        L("The Home card and the admin farm page show ONE sentence per zone, picked from the insights");
        L("above in this order (DATA RULE - the order a farmer would want them):");
        L("");
        L("1. Rain will cover it → \"No watering today: rain is expected to cover it.\"");
        L("2. Water now → \"Water about N min this morning (about N L)\" - the amount from `MinutesToRun`.");
        L("3. Kit problem: pump ran with no effect, kit offline, sensor stuck → \"Check the …\"");
        L("4. No crop set → \"Finish setup: …\" with the one next step.");
        L("5. Water soon → \"No watering today; next on <day>\".");
        L("6. The balance ran and nothing is due → \"No watering needed today\".");
        L("7. Otherwise → \"Finish setup: …\" or, with no weather, \"No advice yet\".");
        L("");
    }

    // ---- 9. Recommended for you -------------------------------------------

    private static void RecommendationTable(Action<string> L)
    {
        L("## 9. Recommended for you (`RecommendationRules`)");
        L("");
        L("| Number | Rule | Source |");
        L("|---|---|---|");
        L("| Water at (relative %) | (1 − p × soil factor) × 100, p clamped 0.1-0.8 - exactly what Reset to recommended saves | Table 22 (pp. 163-165), p. 167, p. 162 |");
        L("| Stop at | 100% (field capacity) | p. 167 |");
        L("| How often | RAW ÷ ETc days, shown as a whole-day range; ETc = Kc × mean ETo | Eq. 83 p. 162, Eq. 58 p. 103 |");
        L("| How long | RAW × area ÷ flow, whole minutes, rounded up | Ch. 1 p. 3, p. 171 |");
        L($"| Climate | the last 30 days of measured ETo if at least {RecommendationRules.MinHistoryDays}; else the forecast; else what history there is | DATA RULE |");
        L($"| No weather yet | RAW from Table 22's own basis, ETc ≈ {N(RecommendationRules.Table22EtcMm)} mm/day; no \"how often\" | Table 22 footnote, p. 163 |");
        L("| Stage unknown / soil unknown | peak Kc / loam, as in the daily advice, and the confidence says so | item 2 |");
        L("");

        var r = RecommendationRules.For("potato", "loam", null, 5.0, "the last 30 days", 0.2, 1.5, null, "Mafikeng", Today)!;
        L("Worked example - potato, loam, 0.2 m², 1.5 L/min, ETo 5 mm/day, stage unknown:");
        L("");
        L("> " + r.Text);
        L("");
        L($"Confidence: {r.Confidence.Reason}");
        L("");
    }

    // ---- 10. Needs another source ---------------------------------------

    private static void NeedsAnotherSource(Action<string> L)
    {
        L("## Needs another source");
        L("");
        L("Rules a farmer would find useful that FAO-56 does **not** support. They are not in the app;");
        L("each says what would have to be found first.");
        L("");
        L("| Question | Why FAO-56 can't answer it | Kind of source that would |");
        L("|---|---|---|");
        L("| How slowly should clay be watered to avoid run-off? | FAO-56 gives how much water soil holds (Table 19), not how fast it soaks in. | Soil infiltration rates by texture - ARC Soil, Climate and Water guidelines; FAO Irrigation and Drainage Paper 24. |");
        L("| Which growth stage of *each* crop is most sensitive to a shortage, and how much yield is lost? | FAO-56 (p. 176) says only that flowering and yield formation are the most sensitive in general, and points to Paper 33. | Yield response factors Ky by stage - FAO Irrigation and Drainage Paper 33 and Paper 66 (*Crop yield response to water*). |");
        L("| When should a farmer plant each crop in the Western Cape? | FAO-56 Table 11 gives example planting months for other regions, not local calendars. | ARC crop production guidelines; Western Cape Department of Agriculture planting calendars. |");
        L("| How long does each stage really last for local varieties? | Table 11 says its stage lengths are indicative only. | Local trials or seed-company variety data; ARC. |");
        L("| When and how much to fertilise? | Out of scope for FAO-56 (water only). | ARC crop production guidelines; fertiliser-company recommendations from a soil test. |");
        L("| Which pests or diseases follow from wet leaves or over-watering? | Out of scope for FAO-56. | ARC Plant Health; Department of Agriculture pest advisories. |");
        L("| How much light rain actually reaches the roots in a small tub? | FAO-56 Eq. 85 uses effective rain but gives no method for containers; our cut-off (rain under 0.2 × ETo ignored) is a DATA RULE. | Measurement in our own tubs; FAO Irrigation and Drainage Paper 25 (*Effective rainfall*). |");
        L("| How often should a resistive soil probe be re-set-up as it corrodes? | Not about crop water; our 15% drift trigger is a DATA RULE. | Probe manufacturer data; our own drift logs over a season. |");
        L("| How well can a farmer judge soil water by hand? | FAO-56 has no feel method; our \"moist\" band (25-75% of RAW) is a DATA RULE. | USDA NRCS *Estimating Soil Moisture by Feel and Appearance* (1998), checked against our own tubs. |");
        L("| Does salty water or soil change the advice? | FAO-56 Eqs. 89-92 need soil salinity (ECe), which AgroFlow does not measure. | A soil and water salinity test from an accredited lab. |");
    }

    // ---- helpers --------------------------------------------------------

    private static string N(double value, string format = "0.#") => value.ToString(format, Inv);

    private static string YesNo(bool value) => value ? "**yes**" : "no";
}
