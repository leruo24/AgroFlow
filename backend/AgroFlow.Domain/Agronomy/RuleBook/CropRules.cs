#nullable enable
using System;

namespace AgroFlow.Business.Agronomy.RuleBook
{
    /// <summary>Where a crop is in its season.</summary>
    public readonly struct StageResult
    {
        public StageResult(SeasonStage stage, int dayOfSeason, int? daysLeftInStage)
        {
            Stage = stage;
            DayOfSeason = dayOfSeason;
            DaysLeftInStage = daysLeftInStage;
        }

        public SeasonStage Stage { get; }

        /// <summary>Day 1 is the planting date itself.</summary>
        public int DayOfSeason { get; }

        /// <summary>Null once the season is complete.</summary>
        public int? DaysLeftInStage { get; }
    }

    // Crop rules - what a crop needs, and at what stage.
    //
    // Values are READ from Fao56EngineReference (which holds FAO-56 Tables 11,
    // 12 and 22), never re-typed here. This file adds the rules about how to
    // use them; it is not a second copy of the table.
    public static class CropRules
    {
        // The label shown whenever the stage is assumed rather than known, so a
        // farmer is never told "peak growth" as if it were a fact.
        public const string AssumedStageLabel = "assumed peak growth";

        // DATA RULE: warn this many days before the crop's water need changes
        // stage - a week is one watering routine, enough to adjust it.
        public const int StageChangeWarningDays = 7;

        // DATA RULE: say "harvest soon" in the last two weeks, when the falling
        // late-season factor (Table 12 Kc end) starts to matter for watering.
        public const int HarvestSoonDays = 14;

        /// <summary>
        /// The growth stage on a day of the season, and the days left in it.
        /// </summary>
        /// <remarks>
        /// FAO-56 Table 11 (pp. 104-108) stage lengths: initial, development,
        /// mid-season, late season. Named for farmers as Establishing, Growing,
        /// Peak growth, Nearing harvest; past the last day, Season complete.
        /// Day 1 is the planting date.
        /// </remarks>
        public static StageResult StageFor(Fao56EngineCrop crop, int dayOfSeason)
        {
            if (crop == null) throw new ArgumentNullException(nameof(crop));

            var stage = SoilWaterBalance.Stage(crop.LIniDays, crop.LDevDays, crop.LMidDays, crop.LLateDays, dayOfSeason);

            int? left = stage switch
            {
                SeasonStage.Establishing => crop.LIniDays - dayOfSeason,
                SeasonStage.Growing => crop.LIniDays + crop.LDevDays - dayOfSeason,
                SeasonStage.PeakGrowth => crop.LIniDays + crop.LDevDays + crop.LMidDays - dayOfSeason,
                SeasonStage.NearingHarvest => crop.TotalDays - dayOfSeason,
                _ => null,
            };

            return new StageResult(stage, dayOfSeason, left);
        }

        /// <summary>The crop factor on a day of the season.</summary>
        /// <remarks>
        /// FAO-56 Table 12 (pp. 110-114) for Kc ini, Kc mid and Kc end, joined
        /// by straight lines through development and late season - Eq. 66
        /// (p. 132).
        /// </remarks>
        public static double KcFor(Fao56EngineCrop crop, int dayOfSeason)
        {
            if (crop == null) throw new ArgumentNullException(nameof(crop));
            return SoilWaterBalance.Kc(
                crop.KcIni, crop.KcMid, crop.KcEnd,
                crop.LIniDays, crop.LDevDays, crop.LMidDays, crop.LLateDays,
                dayOfSeason);
        }

        /// <summary>
        /// The crop factor to use when the growth stage is unknown (no planting date).
        /// </summary>
        /// <remarks>
        /// DATA RULE, built on FAO-56 Table 12 (pp. 110-114).
        ///
        /// Without a planting date there is no way to know where in its season a
        /// crop is (Table 11, pp. 104-108, needs the start date). Rather than
        /// refuse to advise, the engine assumes the crop is using as much water as
        /// it ever does - so if the guess is wrong, it errs toward enough water,
        /// not too little. Under-watering at the wrong moment costs yield; FAO-56
        /// Chapter 8 (p. 176) says the loss is largest at flowering and yield
        /// formation.
        ///
        /// That means the HIGHEST of the crop's three Table 12 values, which is
        /// the mid-season one for every crop we hold except one. Citrus has a
        /// mid-season factor (0.65) LOWER than its initial one (0.70), so for
        /// citrus "mid-season" would not be the cautious choice. Taking the
        /// maximum honours the intent - conservative - for citrus too.
        ///
        /// Every place this is used carries <see cref="AssumedStageLabel"/>.
        /// </remarks>
        public static double KcWhenStageUnknown(Fao56EngineCrop crop)
        {
            if (crop == null) throw new ArgumentNullException(nameof(crop));
            return Math.Max(crop.KcMid, Math.Max(crop.KcIni, crop.KcEnd));
        }

        /// <summary>
        /// Whether a water shortage at this stage costs the most yield.
        /// </summary>
        /// <remarks>
        /// FAO-56 Chapter 8 (p. 176): "the decrease in yield due to water
        /// deficit during the vegetative and ripening period is relatively
        /// small, while during the flowering and yield formation periods it
        /// will be large." Flowering and yield formation fall in the
        /// mid-season stage: it "runs from effective full cover to the start
        /// of maturity" (p. 96), and full cover "for many crops occurs at the
        /// initiation of flowering" (p. 95). Farmers see it as Peak growth.
        /// The crop-by-crop ranking of sensitive stages is FAO Paper 33, not
        /// FAO-56 - see "Needs another source" in docs/rule-book.md.
        /// </remarks>
        public static bool SensitiveStage(SeasonStage stage)
        {
            return stage == SeasonStage.PeakGrowth;
        }

        /// <summary>
        /// The next stage the crop moves into, and in how many days - or null
        /// if it is already in its last stage.
        /// </summary>
        /// <remarks>FAO-56 Table 11 (pp. 104-108) stage lengths.</remarks>
        public static (SeasonStage Stage, int DaysUntil)? NextStageChange(Fao56EngineCrop crop, int dayOfSeason)
        {
            if (crop == null) throw new ArgumentNullException(nameof(crop));

            var boundaries = new[]
            {
                (Stage: SeasonStage.Growing, StartsAt: crop.LIniDays + 1),
                (Stage: SeasonStage.PeakGrowth, StartsAt: crop.LIniDays + crop.LDevDays + 1),
                (Stage: SeasonStage.NearingHarvest, StartsAt: crop.LIniDays + crop.LDevDays + crop.LMidDays + 1),
            };

            foreach (var b in boundaries)
            {
                if (b.StartsAt > dayOfSeason) return (b.Stage, b.StartsAt - dayOfSeason);
            }

            return null;
        }

        /// <summary>A stage change worth warning about: inside <see cref="StageChangeWarningDays"/>.</summary>
        /// <remarks>DATA RULE on top of Table 11's stage lengths.</remarks>
        public static bool StageChangeSoon(int daysUntil)
        {
            return daysUntil > 0 && daysUntil <= StageChangeWarningDays;
        }

        /// <summary>Days to the end of the season when inside <see cref="HarvestSoonDays"/>, else null.</summary>
        /// <remarks>Table 11 (pp. 104-108) season length; DATA RULE for the 14-day window.</remarks>
        public static int? HarvestSoon(Fao56EngineCrop crop, int dayOfSeason)
        {
            if (crop == null) throw new ArgumentNullException(nameof(crop));
            var daysToEnd = crop.TotalDays - dayOfSeason;
            return daysToEnd >= 0 && daysToEnd <= HarvestSoonDays ? daysToEnd : (int?)null;
        }

        /// <summary>Whether the season is over: past Table 11's total length.</summary>
        public static bool SeasonComplete(Fao56EngineCrop crop, int dayOfSeason)
        {
            if (crop == null) throw new ArgumentNullException(nameof(crop));
            return dayOfSeason > crop.TotalDays;
        }
    }
}
