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
        public TodayAction(string kind, string text, Explanation? why)
        {
            Kind = kind;
            Text = text;
            Why = why;
        }

        /// <summary>"water" | "skip" | "kit" | "setup" | "soon" | "none" - for the card's icon and tone.</summary>
        public string Kind { get; }

        /// <summary>"Water about 12 min this morning (about 18 L)", "No watering needed today", ...</summary>
        public string Text { get; }

        public Explanation? Why { get; }
    }

    // Item 6: the single thing to do today for one zone.
    //
    // Picked from the same insights the advice card shows, in the order a
    // farmer would want them: rain that makes watering pointless, then
    // watering, then a kit problem, then unfinished setup, then "not today".
    // One sentence, so the Home screen never shows a list per zone.
    public static class TodayRules
    {
        private static readonly CultureInfo Inv = CultureInfo.InvariantCulture;

        public static TodayAction For(ZoneEngineResult result, IReadOnlyList<ZoneInsight> insights)
        {
            ZoneInsight? Get(string type) => insights.FirstOrDefault(i => i.InsightType == type);

            if (result.PrimaryAction == IrrigationPrimaryAction.CropNotPlanted)
                return new TodayAction("none", "No crop irrigation yet: the crop has not been planted", null);

            if (result.PrimaryAction == IrrigationPrimaryAction.SeasonComplete)
                return new TodayAction("none", "Crop cycle complete; start a new crop cycle if this field was replanted", null);

            if (Get(InsightType.SkipRain) is { } skip)
            {
                return new TodayAction("skip", "No watering today: rain is expected to cover it.", skip.Explanation);
            }

            if (Get(InsightType.WaterNow) is { } water)
            {
                return new TodayAction("water", "Water " + Amount(result) + " this morning", water.Explanation);
            }

            foreach (var (type, text) in new[]
            {
                (InsightType.WateringFailed, "Check the pump: it ran but the soil did not get wetter"),
                (InsightType.ZoneOffline, "Check the kit: it has stopped sending readings"),
                (InsightType.SensorStuck, "Check the soil sensor: its reading has not moved"),
            })
            {
                if (Get(type) is { } kit) return new TodayAction("kit", text, kit.Explanation);
            }

            // No crop at all: nothing to advise until it is set.
            if (result.Crop == null && result.NextStep != null)
            {
                return new TodayAction("setup", "Finish setup: " + Lower(result.NextStep.Ask), Explanations.Confidence(result));
            }

            if (Get(InsightType.WaterSoon) is { } soon && result.NextWateringDate is { } next)
            {
                return new TodayAction("soon", "No watering today; next on " + next.ToString("dddd", Inv), soon.Explanation);
            }

            if (result.BalanceRan)
            {
                return new TodayAction("none", "No watering needed today", null);
            }

            return new TodayAction("setup",
                result.NextStep != null ? "Finish setup: " + Lower(result.NextStep.Ask) : "No advice yet: there is no weather for this farm",
                Explanations.Confidence(result));
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

        private static string Lower(string s) =>
            string.IsNullOrEmpty(s) ? s : char.ToLowerInvariant(s[0]) + s.Substring(1).TrimEnd('.');
    }
}
