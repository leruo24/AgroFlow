#nullable enable
using System;
using System.Collections.Generic;
using System.Linq;

namespace AgroFlow.Business.Agronomy.RuleBook
{
    // How much to trust a piece of advice, and the one thing that would improve it.
    // The engine always gives the best advice it can, even with missing inputs; this
    // says how sure it is and names one step, not a list.
    // Every rule here is a DATA RULE, not FAO-56: FAO-56 says how much water a crop uses,
    // not how far to trust an estimate from partial inputs. The levels and order are our
    // judgement about which missing input distorts the advice most.

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

        /// <summary>The farmer felt the soil by hand within <see cref="ConfidenceRules.FreshReadingHours"/>.</summary>
        public bool ManualCheckFresh { get; set; }
    }

    public sealed class Confidence
    {
        public Confidence(ConfidenceLevel level, string reason, string code = "other", IReadOnlyDictionary<string, string>? args = null)
        {
            Level = level;
            Reason = reason;
            Code = code;
            Args = args ?? new Dictionary<string, string>();
        }

        /// <summary>
        /// RET-06: a stable message code, so the apps can say the reason in the farmer's language
        /// (Reason stays the English). no_crop, no_weather, all_agree, sensor_disagree, or partial
        /// with Args basis (weather / own_check) and because (own_check, kit_quiet, kit_never,
        /// no_readings, or the missing field: planting_date, flow_rate, area, soil, calibration),
        /// and date ("17 Sep", SAST) for kit_quiet.
        /// </summary>
        public string Code { get; }

        public IReadOnlyDictionary<string, string> Args { get; }

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
        // DATA RULE: a reading older than this no longer describes today's soil (soil dries
        // several mm a day in summer). Past it, the engine switches to weather-only advice.
        public const double FreshReadingHours = 24.0;

        // DATA RULE: up to this many missing setup inputs is still Medium. With the crop and
        // weather known we have the two things that matter most; three or more missing and
        // the errors add up too much.
        public const int MaxMissingForMedium = 2;

        // The inputs counted for Medium vs Low, in the order the next step is chosen, by how
        // much each one distorts the advice when missing (DATA RULE):
        //
        //   crop           - no crop, no crop water use at all; nothing else matters until
        //                    this is set.
        //   planting date  - without it the crop is assumed to be at peak water use (see
        //                    CropRules.KcWhenStageUnknown). FAO-56 Table 12 (p. 110-114) puts
        //                    the mid-season factor at 1.4x (spinach, lettuce) to 4.0x (maize)
        //                    the early-season one, so a new crop could be told to take up to
        //                    four times what it uses.
        //   flow rate      - without it there is no "run the pump N minutes", only a depth in
        //                    mm, which nobody can act on at a tap.
        //   area           - without it there are no litres; minutes per square metre still
        //                    work, so it ranks below flow rate.
        //   soil type      - loam is assumed. Table 19 (p. 144) puts sand and clay either side
        //                    of loam, so the error is limited.
        //   wet/dry setup  - without it the sensor cannot be read as "how wet", so advice comes
        //                    from the weather balance alone. Last, because that balance is
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
                return new Confidence(ConfidenceLevel.Low, "Low: no crop is set, so its water use is unknown.", "no_crop");
            }

            if (!s.WeatherAvailable)
            {
                return new Confidence(ConfidenceLevel.Low, "Low: there is no weather for this farm yet.", "no_weather");
            }

            var missing = Steps.Where(step => step.IsMissing(s)).ToList();

            // A stale reading is not missing setup (the kit is set up but has gone quiet). It
            // still stops High, and it is the most useful thing to say when it is the only problem.
            var staleKit = s.HasKit && !s.ReadingFresh;

            if (missing.Count == 0 && s.ReadingFresh)
            {
                return new Confidence(ConfidenceLevel.High, "High: your sensor, setup and the weather all agree.", "all_agree");
            }

            var level = missing.Count <= MaxMissingForMedium ? ConfidenceLevel.Medium : ConfidenceLevel.Low;
            var label = level == ConfidenceLevel.Medium ? "Medium" : "Low";

            // The farmer's own check is better than the weather alone but not as good as a
            // sensor, so we mention it and stay Medium.
            var basis = s.ManualCheckFresh ? "based on the weather and your own soil check" : "based on the weather";

            string because;
            var args = new Dictionary<string, string> { ["basis"] = s.ManualCheckFresh ? "own_check" : "weather" };
            if (missing.Count == 0 && s.ManualCheckFresh)
            {
                because = basis;
                args["because"] = "own_check";
            }
            else if (missing.Count == 0 && staleKit)
            {
                because = basis + "; " + KitQuiet(s.LastReadingAtUtc);
                args["because"] = s.LastReadingAtUtc.HasValue ? "kit_quiet" : "kit_never";
                if (s.LastReadingAtUtc.HasValue)
                    args["date"] = s.LastReadingAtUtc.Value.AddHours(2).ToString("d MMM", System.Globalization.CultureInfo.InvariantCulture);
            }
            else if (missing.Count == 0)
            {
                // Fully set up, but no kit has ever reported: weather-only.
                because = "based on the weather and your crop; no soil readings yet";
                args["because"] = "no_readings";
            }
            else
            {
                because = basis + "; " + missing[0].Because;
                args["because"] = missing[0].Field;
            }

            return new Confidence(level, label + ": " + because + ".", "partial", args);
        }

        /// <summary>The one step that would most improve this zone's advice, or null if none.</summary>
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
