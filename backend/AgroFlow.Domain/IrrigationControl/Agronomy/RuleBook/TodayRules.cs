#nullable enable
using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;

namespace AgroFlow.Business.Agronomy.RuleBook
{
    /// <summary>A zone's one action for today, for the Home card and the admin farm page.</summary>
    public sealed class TodayAction
    {
        public TodayAction(string kind, string text, Explanation? why, string? code = null, IReadOnlyDictionary<string, string>? args = null)
        {
            Kind = kind;
            Text = text;
            Why = why;
            Code = code ?? "text";
            Args = args ?? new Dictionary<string, string>();
        }

        /// <summary>
        /// A stable code for the sentence (AF-02), so the app shows it in the farmer's language:
        /// "water.now.minutes", "skip.rain", "setup.next", ... Text stays the English sentence for
        /// older apps, reports and Telegram. docs/audit/ui-contracts.md lists the codes.
        /// </summary>
        public string Code { get; }

        /// <summary>The values in the sentence: minutes, litres, seconds, date, field.</summary>
        public IReadOnlyDictionary<string, string> Args { get; }

        /// <summary>"water" | "skip" | "kit" | "setup" | "soon" | "none" - for the card's icon and tone.</summary>
        public string Kind { get; }

        /// <summary>"Water about 12 min this morning (about 18 L)", "No watering needed today", ...</summary>
        public string Text { get; }

        public Explanation? Why { get; }
    }

    // The single thing to do today for one zone.
    // The decision is the engine's PrimaryAction; this only words it, in the order a
    // farmer would want: rain that makes watering unnecessary, then watering, then a kit
    // problem, then unfinished setup, then "not today". One sentence, so the Home screen
    // never shows a list per zone.
    public static class TodayRules
    {
        private static readonly CultureInfo Inv = CultureInfo.InvariantCulture;

        public static TodayAction For(ZoneEngineResult result, IReadOnlyList<ZoneInsight> insights)
        {
            ZoneInsight? Get(string type) => insights.FirstOrDefault(i => i.InsightType == type);

            if (result.PrimaryAction == IrrigationPrimaryAction.CropNotPlanted)
                return new TodayAction("none", "No crop irrigation yet: the crop has not been planted", null, "none.not_planted");

            if (result.PrimaryAction == IrrigationPrimaryAction.SeasonComplete)
                return new TodayAction("none", "Crop cycle complete; start a new crop cycle if this field was replanted", null, "none.season_complete");

            if (result.PrimaryAction == IrrigationPrimaryAction.PostponeForRain)
            {
                return new TodayAction("skip", "No watering today: rain is expected to cover it.", Get(InsightType.SkipRain)?.Explanation, "skip.rain");
            }

            if (result.PrimaryAction is IrrigationPrimaryAction.WaterNow or IrrigationPrimaryAction.WaterNowReduced)
            {
                var lead = result.PrimaryAction == IrrigationPrimaryAction.WaterNowReduced ? "Rain helps, but water " : "Water ";
                var (amountCode, amountArgs) = AmountArgs(result);
                return new TodayAction("water", lead + Amount(result) + " this morning", Get(InsightType.WaterNow)?.Explanation,
                    (result.PrimaryAction == IrrigationPrimaryAction.WaterNowReduced ? "water.reduced." : "water.now.") + amountCode, amountArgs);
            }

            foreach (var (type, text, code) in new[]
            {
                (InsightType.WateringFailed, "Check the pump: it ran but the soil did not get wetter", "kit.pump_failed"),
                (InsightType.ZoneOffline, "Check the kit: it has stopped sending readings", "kit.offline"),
                (InsightType.SensorStuck, "Check the soil sensor: its reading has not moved", "kit.sensor_stuck"),
            })
            {
                if (Get(type) is { } kit) return new TodayAction("kit", text, kit.Explanation, code);
            }

            // No crop at all: nothing to advise until it is set.
            if (result.Crop == null && result.NextStep != null)
            {
                return new TodayAction("setup", "Finish setup: " + Lower(result.NextStep.Ask), Explanations.Confidence(result),
                    "setup.next", new Dictionary<string, string> { ["field"] = result.NextStep.Field });
            }

            switch (result.PrimaryAction)
            {
                case IrrigationPrimaryAction.WaterSoon:
                    return new TodayAction("soon",
                        result.NextWateringDate is { } next
                            ? "No watering today; next on " + next.ToString("dddd", Inv)
                            : "No watering today; water is likely needed in the next few days",
                        Get(InsightType.WaterSoon)?.Explanation,
                        result.NextWateringDate is null ? "soon.days" : "soon.on",
                        result.NextWateringDate is { } on
                            ? new Dictionary<string, string> { ["date"] = on.ToString("yyyy-MM-dd", Inv), ["weekday"] = ((int)on.DayOfWeek).ToString(Inv) }
                            : null);

                case IrrigationPrimaryAction.NoWaterNeeded:
                    return new TodayAction("none", "No watering needed today", null, "none.not_needed");

                case IrrigationPrimaryAction.CheckField:
                    return new TodayAction("kit", "Check the field by hand before watering", Explanations.Confidence(result), "kit.check_field");

                case IrrigationPrimaryAction.CheckSensor:
                    return new TodayAction("kit", "Check the soil sensor before relying on today's advice", Explanations.Confidence(result), "kit.check_sensor");

                case IrrigationPrimaryAction.CheckIrrigationSystem:
                    return new TodayAction("kit", "Check the pump and pipes before watering", Explanations.Confidence(result), "kit.check_system");
            }

            // FinishSetup and InsufficientData: no watering call could be made.
            return new TodayAction("setup",
                result.NextStep != null ? "Finish setup: " + Lower(result.NextStep.Ask)
                : result.BalanceRan ? "No advice yet: there is not enough weather data for today"
                : "No advice yet: there is no weather for this farm",
                Explanations.Confidence(result),
                result.NextStep != null ? "setup.next" : result.BalanceRan ? "setup.weather_today" : "setup.no_weather",
                result.NextStep != null ? new Dictionary<string, string> { ["field"] = result.NextStep.Field } : null);
        }

        private static string Amount(ZoneEngineResult r)
        {
            if (r.RecommendedRuntimeSeconds is { } seconds && r.RecommendedLitres is { } l)
                return seconds < 60.0
                    ? $"about {seconds.ToString("0.#", Inv)} sec (about {Math.Round(l).ToString("0", Inv)} L)"
                    : $"about {(seconds / 60.0).ToString("0.#", Inv)} min (about {Math.Round(l).ToString("0", Inv)} L)";
            if (r.RecommendedLitres is { } litres)
                return $"about {Math.Round(litres).ToString("0", Inv)} L";
            if (r.RecommendedMinutesPerSquareMetre is { } perM2)
                return $"about {perM2.ToString("0.#", Inv)} min for each square metre";
            if (r.RecommendedDepthMm is { } mm && mm > 0)
                return $"about {mm.ToString("0.#", Inv)} mm";
            return "as usual";
        }

        // The amount as a code and its numbers: the same choice as Amount() above.
        private static (string Code, Dictionary<string, string> Args) AmountArgs(ZoneEngineResult r)
        {
            if (r.RecommendedRuntimeSeconds is { } seconds && r.RecommendedLitres is { } l)
                return seconds < 60.0
                    ? ("seconds", new() { ["seconds"] = seconds.ToString("0.#", Inv), ["litres"] = Math.Round(l).ToString("0", Inv) })
                    : ("minutes", new() { ["minutes"] = (seconds / 60.0).ToString("0.#", Inv), ["litres"] = Math.Round(l).ToString("0", Inv) });
            if (r.RecommendedLitres is { } litres) return ("litres", new() { ["litres"] = Math.Round(litres).ToString("0", Inv) });
            if (r.RecommendedMinutesPerSquareMetre is { } perM2) return ("per_m2", new() { ["minutes"] = perM2.ToString("0.#", Inv) });
            if (r.RecommendedDepthMm is { } mm && mm > 0) return ("mm", new() { ["mm"] = mm.ToString("0.#", Inv) });
            return ("usual", new());
        }

        private static string Lower(string s) =>
            string.IsNullOrEmpty(s) ? s : char.ToLowerInvariant(s[0]) + s.Substring(1).TrimEnd('.');
    }
}
