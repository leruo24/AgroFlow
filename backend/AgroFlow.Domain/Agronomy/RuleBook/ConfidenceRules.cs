#nullable enable
using System;
using System.Collections.Generic;
using System.Linq;

namespace AgroFlow.Business.Agronomy.RuleBook
{
    // How much to trust a piece of advice, and the one thing that would make it
    // better (item 2).
    //
    // WHY THIS EXISTS
    // The advice engine used to stop when an input was missing: no planting
    // date, no fresh reading, no wet/dry setup - "No recommendation possible".
    // A farmer with a half-finished setup got nothing at all, which is the
    // worst possible outcome: they still have to water, they just have to
    // guess. The engine now always gives the best advice it can, and this is
    // the other half of that bargain - it says plainly how sure it is, and
    // names ONE step that would improve it, rather than a list of five.
    //
    // Every rule in this file is a DATA RULE: none of it is FAO-56. FAO-56 says
    // how much water a crop uses; it says nothing about how much to trust an
    // estimate built from partial inputs. The levels and the order below are
    // our judgement about which missing input distorts the advice most, and
    // they are written down here so that judgement can be argued with.

    public enum ConfidenceLevel
    {
        High,
        Medium,
        Low,
    }

    /// <summary>What the engine had to work with, as plain yes/no facts.</summary>
    public sealed class ZoneSetupState
    {
        public bool CropKnown { get; set; }
        public bool PlantingDateKnown { get; set; }
        public bool SoilSet { get; set; }
        public bool AreaSet { get; set; }
        public bool FlowRateSet { get; set; }
        public bool Calibrated { get; set; }

        /// <summary>A valid soil reading inside <see cref="ConfidenceRules.FreshReadingHours"/>.</summary>
        public bool ReadingFresh { get; set; }

        /// <summary>Any soil reading at all in the engine's window - a kit exists and has reported.</summary>
        public bool HasKit { get; set; }

        public bool WeatherAvailable { get; set; }

        /// <summary>When the kit last reported, for "your kit hasn't sent data since 17 Sep".</summary>
        public DateTime? LastReadingAtUtc { get; set; }

        /// <summary>Item 6: the farmer felt the soil by hand within <see cref="ConfidenceRules.FreshReadingHours"/>.</summary>
        public bool ManualCheckFresh { get; set; }
    }

    public sealed class Confidence
    {
        public Confidence(ConfidenceLevel level, string reason)
        {
            Level = level;
            Reason = reason;
        }

        public ConfidenceLevel Level { get; }

        /// <summary>One plain line, for the badge: "Medium: based on the weather; your kit hasn't sent data since 17 Sep".</summary>
        public string Reason { get; }

        /// <summary>"high" / "medium" / "low" - the value the API and the apps carry.</summary>
        public string Key => Level.ToString().ToLowerInvariant();
    }

    /// <summary>The single most valuable missing input, and how to ask for it.</summary>
    public sealed class SetupStep
    {
        public SetupStep(string field, string ask)
        {
            Field = field;
            Ask = ask;
        }

        /// <summary>Stable key the apps can link to: "crop", "planting_date", "flow_rate", ...</summary>
        public string Field { get; }

        /// <summary>The farmer-facing sentence.</summary>
        public string Ask { get; }
    }

    public static class ConfidenceRules
    {
        // DATA RULE: a soil reading older than this no longer describes the soil
        // today. Soil dries by several millimetres a day in summer, so a day-old
        // reading is about the limit of what can anchor today's advice. It is
        // the same figure the schedule report has always used to decide whether
        // to use a reading - here it switches the engine to weather-only advice
        // instead of switching advice off.
        public const double FreshReadingHours = 24.0;

        // DATA RULE: up to this many missing setup inputs is still Medium. With
        // the crop and the weather known, the engine has the two things that
        // matter most (how much water this crop uses in this weather), and each
        // missing input below adds error in one known direction. Three or more
        // and the errors compound past the point where we would act on them
        // ourselves.
        public const int MaxMissingForMedium = 2;

        // The inputs counted for Medium vs Low, in the order the next step is
        // chosen. Ordered by how much each one, when missing, distorts the
        // advice (DATA RULE, reasoning per entry):
        //
        //   crop           - no crop, no crop water use at all; nothing else
        //                    matters until this is set.
        //   planting date  - without it the crop is assumed to be at its peak
        //                    water use (see CropRules.KcWhenStageUnknown).
        //                    Across the crops we hold, FAO-56 Table 12
        //                    (p. 110-114) puts the mid-season factor at 1.4x
        //                    (spinach, lettuce) to 4.0x (maize) the early-
        //                    season one - so a newly planted crop can be told
        //                    to take up to four times what it uses. Checked
        //                    against Fao56EngineReference, not from memory.
        //   flow rate      - without it there is no "run the pump N minutes",
        //                    only a depth in millimetres, which nobody can act
        //                    on directly at a tap.
        //   area           - without it there are no litres; minutes per square
        //                    metre still work, so it ranks below flow rate.
        //   soil type      - garden soil (loam) is assumed. Table 19 (p. 144)
        //                    puts sand and clay either side of loam, so the
        //                    error is bounded and two-sided.
        //   wet/dry setup  - without it the soil sensor cannot be read as
        //                    "how wet", so advice comes from the weather
        //                    balance alone. Ranked last because that balance is
        //                    what FAO-56 itself prescribes; the sensor refines it.
        private static readonly (string Field, Func<ZoneSetupState, bool> IsMissing, string Ask, string Because)[] Steps =
        {
            ("crop", s => !s.CropKnown,
                "Choose the crop for this zone so we can work out how much water it needs.",
                "no crop is set"),
            ("planting_date", s => !s.PlantingDateKnown,
                "Add the planting date for advice that follows your crop's growth.",
                "the planting date is missing, so peak growth is assumed"),
            ("flow_rate", s => !s.FlowRateSet,
                "Add the pump's flow rate to get watering times in minutes.",
                "the pump's flow rate is missing"),
            ("area", s => !s.AreaSet,
                "Add the size of this zone to get litres.",
                "the size of this zone is missing"),
            ("soil", s => !s.SoilSet,
                "Choose the soil type - sandy, loam or clay - for a closer estimate.",
                "the soil type is missing, so loam is assumed"),
            ("calibration", s => !s.Calibrated,
                "Do the wet/dry setup on the soil sensor so its readings can be used.",
                "the soil sensor has not been set up"),
        };

        /// <summary>
        /// High: everything set up and a fresh calibrated reading.
        /// Medium: crop and weather known, at most <see cref="MaxMissingForMedium"/> inputs missing.
        /// Low: no crop, no weather, or more missing than that.
        /// </summary>
        public static Confidence For(ZoneSetupState s)
        {
            if (s == null) throw new ArgumentNullException(nameof(s));

            if (!s.CropKnown)
            {
                return new Confidence(ConfidenceLevel.Low, "Low: no crop is set, so its water use is unknown.");
            }

            if (!s.WeatherAvailable)
            {
                return new Confidence(ConfidenceLevel.Low, "Low: there is no weather for this farm yet.");
            }

            var missing = Steps.Where(step => step.IsMissing(s)).ToList();

            // A stale reading is not "missing setup" - the kit is set up, it has
            // just gone quiet. It still stops the advice being High, and it is
            // the most useful thing to say when it is the only problem.
            var staleKit = s.HasKit && !s.ReadingFresh;

            if (missing.Count == 0 && s.ReadingFresh)
            {
                return new Confidence(ConfidenceLevel.High, "High: your sensor, setup and the weather all agree.");
            }

            var level = missing.Count <= MaxMissingForMedium ? ConfidenceLevel.Medium : ConfidenceLevel.Low;
            var label = level == ConfidenceLevel.Medium ? "Medium" : "Low";

            // Item 6: the farmer's own check - better than the weather alone,
            // never as good as a set-up sensor, so it is said, and stays Medium.
            var basis = s.ManualCheckFresh ? "based on the weather and your own soil check" : "based on the weather";

            string because;
            if (missing.Count == 0 && s.ManualCheckFresh)
            {
                because = basis;
            }
            else if (missing.Count == 0 && staleKit)
            {
                because = basis + "; " + KitQuiet(s.LastReadingAtUtc);
            }
            else if (missing.Count == 0)
            {
                // Fully set up, but no kit has ever reported: weather-only.
                because = "based on the weather and your crop; no soil readings yet";
            }
            else
            {
                because = basis + "; " + missing[0].Because;
            }

            return new Confidence(level, label + ": " + because + ".");
        }

        /// <summary>The ONE step that would most improve this zone's advice, or null if none.</summary>
        public static SetupStep? NextStep(ZoneSetupState s)
        {
            if (s == null) throw new ArgumentNullException(nameof(s));

            var first = Steps.FirstOrDefault(step => step.IsMissing(s));
            if (first.Field != null) return new SetupStep(first.Field, first.Ask);

            // Everything is set up; the only thing left to fix is a quiet kit.
            if (s.HasKit && !s.ReadingFresh)
            {
                var quiet = KitQuiet(s.LastReadingAtUtc);
                return new SetupStep("kit",
                    char.ToUpperInvariant(quiet[0]) + quiet.Substring(1) + ". Check it has power and WiFi.");
            }

            return null;
        }

        /// <summary>"your kit hasn't sent data since 17 Sep" - SAST, never ISO.</summary>
        public static string KitQuiet(DateTime? lastReadingAtUtc)
        {
            if (!lastReadingAtUtc.HasValue) return "your kit hasn't sent any data yet";

            var sast = lastReadingAtUtc.Value.AddHours(2);
            return "your kit hasn't sent data since " +
                   sast.ToString("d MMM", System.Globalization.CultureInfo.InvariantCulture);
        }
    }
}
