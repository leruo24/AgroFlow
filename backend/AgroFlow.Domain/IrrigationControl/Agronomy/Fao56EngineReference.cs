#nullable enable
using System;
using System.Collections.Generic;

namespace AgroFlow.Business.Agronomy
{
    // The engine's FAO-56 reference tables: crop coefficients and stage lengths
    // (Tables 11, 12, 22) and soil water-holding values (Table 19).
    // Agronomy/fao56-crop-knowledge.json is a separate cited extract used by
    // GrowthStageCalculator and the narrative part of IrrigationAdvisor. For two crops it
    // picks a different Table 11 row from the engine:
    //
    //   maize   JSON: 30/40/50/30 = 150 (Apr, Spain/Calif.), Kc_end 0.60
    //           here: 25/40/45/30 = 140 (Dec/Jan, Arid),     Kc_end 0.35
    //   potato  JSON: 30/35/50/25 = 140 (Dec, Calif. Desert)
    //           here: 25/30/45/30 = 130 (Jan/Nov, (Semi)Arid)
    //
    // Both are published FAO-56 values (a choice of row and management case). Maize
    // Kc_end is a published pair: 0.60 harvested moist, 0.35 field-dried; the engine
    // plans with the field-dried value. Changing the JSON would move the schedule report's
    // numbers, so the difference is written down here and in docs/fao56-engine-report.md.
    // No value is invented. Where FAO-56 gives a range, the single value used is marked
    // ASSUMPTION in the report and on the value.

    public sealed class Fao56EngineCrop
    {
        public string Key { get; }

        // Farmer-facing label.
        public string Label { get; }

        public string Fao56Entry { get; }

        public int LIniDays { get; }
        public int LDevDays { get; }
        public int LMidDays { get; }
        public int LLateDays { get; }

        // The Table 11 row the lengths come from, shown in report facts: "140-day maize" means
        // nothing without knowing which of the six maize rows it is.
        public string Table11Row { get; }

        public double KcIni { get; }
        public double KcMid { get; }
        public double KcEnd { get; }

        // Where Kc_ini came from: the crop's own Table 12 row, or its group row when the
        // crop line has none.
        public string KcIniBasis { get; }

        // Table 22 rooting depth, low end of the range. FAO-56 p. 163: the smaller values
        // are meant for irrigation scheduling.
        public double RootDepthM { get; }

        // Table 22 depletion fraction, tabulated at ETc ~ 5 mm/day.
        public double DepletionFractionP { get; }

        // Set when one value stands in for a published range or one of two management
        // cases. Printed in the report's limitations.
        public string? ValueNote { get; }

        public Fao56EngineCrop(
            string key, string label, string fao56Entry,
            int lIni, int lDev, int lMid, int lLate, string table11Row,
            double kcIni, double kcMid, double kcEnd, string kcIniBasis,
            double rootDepthM, double depletionFractionP, string? valueNote)
        {
            Key = key;
            Label = label;
            Fao56Entry = fao56Entry;
            LIniDays = lIni;
            LDevDays = lDev;
            LMidDays = lMid;
            LLateDays = lLate;
            Table11Row = table11Row;
            KcIni = kcIni;
            KcMid = kcMid;
            KcEnd = kcEnd;
            KcIniBasis = kcIniBasis;
            RootDepthM = rootDepthM;
            DepletionFractionP = depletionFractionP;
            ValueNote = valueNote;
        }

        public int TotalDays
        {
            get { return LIniDays + LDevDays + LMidDays + LLateDays; }
        }
    }

    // FAO-56 Table 19 soil water characteristics (ranges also in Allen et al. 2005, J.
    // Irrig. Drain. Eng. 131(1), Table 1). We use the midpoint of each range (ASSUMPTION).
    public sealed class Fao56SoilClass
    {
        public string Key { get; }
        public string Label { get; }
        public string Table19Class { get; }

        public double ThetaFieldCapacity { get; }
        public double ThetaWiltingPoint { get; }

        // FAO-56 Chapter 8 allows p to be lowered 5-10% for clay and raised 5-10% for sand.
        // We use 5% (ASSUMPTION).
        public double PFactor { get; }

        public string ThetaNote { get; }

        public Fao56SoilClass(
            string key, string label, string table19Class,
            double thetaFc, double thetaWp, double pFactor, string thetaNote)
        {
            Key = key;
            Label = label;
            Table19Class = table19Class;
            ThetaFieldCapacity = thetaFc;
            ThetaWiltingPoint = thetaWp;
            PFactor = pFactor;
            ThetaNote = thetaNote;
        }
    }

    // Farmer-facing stage names; a farmer never sees "Mid-season".
    public enum SeasonStage
    {
        Establishing,
        Growing,
        PeakGrowth,
        NearingHarvest,
        SeasonComplete,
    }

    public static class Fao56EngineReference
    {
        public const string DefaultSoilKey = "loam";

        // ------------------------------------------------------------------
        // Crops
        // ------------------------------------------------------------------
        private static readonly Dictionary<string, Fao56EngineCrop> CropsByKey =
            new Dictionary<string, Fao56EngineCrop>(StringComparer.OrdinalIgnoreCase)
            {
                ["spinach"] = new Fao56EngineCrop(
                    "spinach", "Spinach", "Spinach",
                    20, 20, 15, 5, "Table 11, Apr, Mediterranean",
                    0.70, 1.00, 0.95, "Table 12 group row 'a. Small Vegetables' (omitted on the spinach line)",
                    0.3, 0.20, null),

                ["tomato"] = new Fao56EngineCrop(
                    "tomato", "Tomato", "Tomato",
                    30, 40, 45, 30, "Table 11, Apr/May, Mediterranean",
                    0.60, 1.15, 0.80, "Table 12 group row 'b. Vegetables - Solanum Family'",
                    0.7, 0.40,
                    "FAO-56 publishes tomato Kc_end as the range 0.70-0.90 rather than a single value. The midpoint 0.80 is used, so late-season figures carry that spread."),

                ["cucumber"] = new Fao56EngineCrop(
                    "cucumber", "Cucumber", "Cucumber, fresh market",
                    20, 30, 40, 15, "Table 11, June/Aug, Arid Region",
                    0.60, 1.00, 0.75, "Table 12, cucumber (fresh market) row",
                    0.7, 0.50, null),

                ["potato"] = new Fao56EngineCrop(
                    "potato", "Potato", "Potato",
                    25, 30, 45, 30, "Table 11, Jan/Nov, (Semi)Arid Climate",
                    0.50, 1.15, 0.75, "Table 12 group row 'd. Roots and Tubers'",
                    0.4, 0.35,
                    "Table 11's Jan/Nov (Semi)Arid potato row prints two alternative mid-season lengths (30 or 45); 45 is used, giving a 130-day season."),

                ["dry beans"] = new Fao56EngineCrop(
                    "dry beans", "Dry beans", "Beans, dry and pulses",
                    20, 30, 40, 20, "Table 11, May/June, Continental Climate",
                    0.40, 1.15, 0.35, "Table 12, beans (dry) row",
                    0.6, 0.45, null),

                ["maize"] = new Fao56EngineCrop(
                    "maize", "Maize", "Maize, field (grain)",
                    25, 40, 45, 30, "Table 11, Dec/Jan, Arid Climate",
                    0.30, 1.20, 0.35, "Table 12 group row 'i. Cereals'",
                    1.0, 0.55,
                    "FAO-56 gives maize Kc_end as 0.60 when harvested at high grain moisture or 0.35 when field-dried. 0.35 is used, so the engine plans for a crop dried down in the field."),

                // Taken from Agronomy/fao56-crop-knowledge.json, which has FAO-56 values with page
                // references for these two, so zones already growing them keep getting advice.
                // FAO-56 has no "leafy veg" entry, so this key means lettuce: Table 11 "Lettuce"
                // (p. 104), Table 12 "Lettuce" (p. 110) with Kc_ini from its group row
                // "a. Small Vegetables", and Table 22 "Lettuce" (p. 163).
                ["leafy_veg"] = new Fao56EngineCrop(
                    "leafy_veg", "Leafy vegetables (lettuce)", "Lettuce",
                    20, 30, 15, 10, "Table 11, Apr, Mediterranean (Lettuce), p. 104",
                    0.70, 1.00, 0.95, "Table 12 group row 'a. Small Vegetables', p. 110 (omitted on the lettuce row itself)",
                    0.3, 0.30,
                    "FAO-56 does not tabulate \"leafy vegetables\". These are the published figures for LETTUCE (Table 11 p. 104, Table 12 p. 110, Table 22 p. 163). Spinach, chard and other leafy crops are not identical to lettuce - spinach has its own row and its own key here."),

                // FAO-56 splits citrus six ways (with or without ground cover, at 70%, 50% and 20%
                // canopy). These are "Citrus, no ground cover - 70% canopy": a mature, clean-floor
                // orchard. A young or grassed orchard is a different row.
                ["citrus"] = new Fao56EngineCrop(
                    "citrus", "Citrus", "Citrus, no ground cover - 70% canopy",
                    60, 90, 120, 95, "Table 11, Jan, Mediterranean, p. 107",
                    0.70, 0.65, 0.70, "Table 12 'Citrus, no ground cover - 70% canopy', p. 113",
                    1.2, 0.50,
                    "These are the figures for a mature citrus orchard at 70% canopy with no ground cover (Table 12 p. 113, Table 22 'Citrus - 70% canopy' p. 165); FAO-56 publishes five other citrus variants for different canopies and orchard floors. Kc_mid (0.65) is below Kc_ini (0.70) because of stomatal closure at peak ET, so Kc falls through development and rises again late season - that is correct, not a sign error. Citrus is an evergreen perennial, so its 365-day season means the planting date is the start of the annual cycle, not the year the tree went in."),
            };

        // Free-text crop type -> engine key. Returns null instead of guessing, so an unknown
        // crop gets setup_missing, never a substitute Kc curve.
        private static readonly Dictionary<string, string> Aliases =
            new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
            {
                ["maize"] = "maize",
                ["corn"] = "maize",
                ["mielies"] = "maize",
                ["field maize"] = "maize",
                ["grain maize"] = "maize",

                ["potato"] = "potato",
                ["potatoes"] = "potato",
                ["aartappel"] = "potato",

                ["tomato"] = "tomato",
                ["tomatoes"] = "tomato",

                ["cucumber"] = "cucumber",
                ["cucumbers"] = "cucumber",
                ["komkommer"] = "cucumber",

                ["spinach"] = "spinach",
                ["spinaca"] = "spinach",
                ["baby spinach"] = "spinach",

                ["dry beans"] = "dry beans",
                ["dry_beans"] = "dry beans",
                ["drybeans"] = "dry beans",
                ["beans"] = "dry beans",
                ["pulses"] = "dry beans",

                // Still supported (see the two carried-over rows).
                ["leafy veg"] = "leafy_veg",
                ["leafy vegetables"] = "leafy_veg",
                ["leafy_veg"] = "leafy_veg",
                ["lettuce"] = "leafy_veg",
                ["salad greens"] = "leafy_veg",

                ["citrus"] = "citrus",
                ["orange"] = "citrus",
                ["oranges"] = "citrus",
                ["lemon"] = "citrus",
                ["lemons"] = "citrus",
                ["naartjie"] = "citrus",
            };

        public static IEnumerable<Fao56EngineCrop> AllCrops
        {
            get { return CropsByKey.Values; }
        }

        // The six crops the farmer pickers offer. leafy_veg and citrus still resolve but are
        // not offered as new choices.
        public static readonly string[] OfferedCropKeys =
            { "maize", "potato", "tomato", "dry beans", "spinach", "cucumber" };

        public static Fao56EngineCrop? TryResolveCrop(string? cropType)
        {
            if (string.IsNullOrWhiteSpace(cropType)) return null;

            var normalised = cropType.Trim().ToLowerInvariant().Replace('_', ' ');

            string? key;
            if (!Aliases.TryGetValue(normalised, out key))
            {
                // Try the raw spelling too, so 'dry_beans' and 'leafy_veg' both match.
                if (!Aliases.TryGetValue(cropType.Trim(), out key)) return null;
            }

            Fao56EngineCrop? crop;
            return CropsByKey.TryGetValue(key, out crop) ? crop : null;
        }

        // Soils: FAO-56 Table 19 midpoints
        private static readonly Dictionary<string, Fao56SoilClass> SoilsByKey =
            new Dictionary<string, Fao56SoilClass>(StringComparer.OrdinalIgnoreCase)
            {
                ["sandy"] = new Fao56SoilClass(
                    "sandy", "Sandy", "Sand", 0.12, 0.045, 1.05,
                    "Table 19 'Sand': theta_FC 0.07-0.17, theta_WP 0.02-0.07. Midpoints used. FAO's Sand class is used rather than sandy loam, so it differs clearly from loam."),

                ["loam"] = new Fao56SoilClass(
                    "loam", "Loam / garden soil", "Loam", 0.25, 0.12, 1.00,
                    "Table 19 'Loam': theta_FC 0.20-0.30, theta_WP 0.07-0.17. Midpoints used."),

                ["clay"] = new Fao56SoilClass(
                    "clay", "Clay", "Clay", 0.36, 0.22, 0.95,
                    "Table 19 'Clay': theta_FC 0.32-0.40, theta_WP 0.20-0.24. Midpoints used."),
            };

        public static IEnumerable<Fao56SoilClass> AllSoils
        {
            get { return SoilsByKey.Values; }
        }

        public static Fao56SoilClass? TryResolveSoil(string? soilType)
        {
            if (string.IsNullOrWhiteSpace(soilType)) return null;
            Fao56SoilClass? soil;
            return SoilsByKey.TryGetValue(soilType.Trim(), out soil) ? soil : null;
        }

        // Loam is the documented default when a zone's soil type is unknown.
        public static Fao56SoilClass DefaultSoil
        {
            get { return SoilsByKey[DefaultSoilKey]; }
        }

        // Stage names
        public static string StageLabel(SeasonStage stage)
        {
            switch (stage)
            {
                case SeasonStage.Establishing: return "Establishing";
                case SeasonStage.Growing: return "Growing";
                case SeasonStage.PeakGrowth: return "Peak growth";
                case SeasonStage.NearingHarvest: return "Nearing harvest";
                case SeasonStage.SeasonComplete: return "Season complete";
                default: return stage.ToString();
            }
        }
    }
}
