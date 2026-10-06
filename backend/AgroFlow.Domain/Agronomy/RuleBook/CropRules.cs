#nullable enable
using System;

namespace AgroFlow.Business.Agronomy.RuleBook
{
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
    }
}
