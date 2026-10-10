#nullable enable
using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;

namespace AgroFlow.Business.Agronomy.RuleBook
{
    // "Why am I seeing this?" for every insight type.
    // Each explanation uses the same values the rule used (the engine result, the fault
    // signals and the numbers in the insight's Data), and rule sentences quote the rule's
    // own constants, so changing a threshold changes its explanation.
    // Wording: plain language, no FAO-56 symbols, column names or ISO dates in
    // summary/facts/rule/whatWouldChangeIt. Settings are "from this zone's setup" (we do
    // not record who set them). Never blame the farmer. FAO-56 detail goes in Technical.
    public static class Explanations
    {
        private static readonly CultureInfo Inv = CultureInfo.InvariantCulture;

        // Plain source labels, used everywhere so they read the same.
        public const string FromSetup = "this zone's setup";
        public const string FromWeather = "weather app";
        public const string FromSensor = "your soil sensor";
        public const string FromKit = "your kit";
        public const string FromGuide = "FAO crop water guide";
        public const string FromPump = "pump run times";

        private const string KitTrusted = "High: this comes straight from your kit's own readings.";

        public static Explanation For(ZoneInsight insight, ZoneEngineInput input, ZoneEngineResult result, ZoneFaultSignals signals)
        {
            if (insight == null) throw new ArgumentNullException(nameof(insight));
            signals ??= new ZoneFaultSignals();
            var zone = input.ZoneName;

            switch (insight.InsightType)
            {
                case InsightType.SetupMissing: return SetupMissing(zone, result);
                case InsightType.ZoneOffline: return ZoneOffline(result, signals);
                case InsightType.SensorStuck: return SensorStuck(result, signals);
                case InsightType.WateringFailed: return WateringFailed(signals);
                case InsightType.DhtOffline: return DhtOffline(signals);
                case InsightType.ThresholdUnsafe: return ThresholdUnsafe(input, result, insight);
                case InsightType.SkipRain: return SkipRain(input, result);
                case InsightType.WaterNow: return WaterNow(input, result);
                case InsightType.DataGap: return DataGap(result, insight);
                case InsightType.WaterSoon: return WaterSoon(input, result);
                case InsightType.HotDays: return HotDays(result, insight);
                case InsightType.GrowthStatus: return GrowthStatus(input, result);
                case InsightType.SeasonComplete: return SeasonComplete(input, result);
                case InsightType.PeakGrowth: return PeakGrowth(input, result);
                case InsightType.StageChange: return StageChange(result, insight);
                case InsightType.HarvestSoon: return HarvestSoon(input, result, insight);
                case InsightType.StressDays: return StressDays(input, result, insight);
                case InsightType.Overwatering: return Overwatering(input, result, insight);
                case InsightType.SensorDrift: return SensorDrift(input, signals);
                default:
                    return new Explanation
                    {
                        Summary = insight.Message,
                        Rule = "This message comes from your zone's readings and setup.",
                        Confidence = result.Confidence.Reason,
                        Technical = insight.Source,
                    };
            }
        }

        // Setup

        private static Explanation SetupMissing(string zone, ZoneEngineResult r)
        {
            var e = new Explanation
            {
                Summary = r.NextStep != null
                    ? $"The advice for {zone} would be more accurate with one more detail."
                    : $"Some of {zone}'s setup is missing.",
                Rule = "We ask for one thing at a time, in the order that improves the advice most: the crop, the planting date, the pump's flow rate, the zone's size, the soil type, then the soil sensor's wet/dry setup.",
                Confidence = r.Confidence.Reason,
                WhatWouldChangeIt = r.NextStep?.Ask,
                Technical = "ConfidenceRules.NextStep; missing: " + string.Join(", ", r.MissingSetup),
            };
            foreach (var missing in r.MissingSetup)
            {
                e.Fact(Capitalise(missing.Replace("the ", "")), "not set yet", FromSetup);
            }
            return e;
        }

        // Kit

        private static Explanation ZoneOffline(ZoneEngineResult r, ZoneFaultSignals s)
        {
            var hours = s.SinceLastReading.HasValue ? Math.Round(s.SinceLastReading.Value.TotalHours, 1) : 0;
            var e = new Explanation
            {
                Summary = $"Your kit hasn't sent a reading for {N(hours)} hours.",
                Rule = $"Kits normally report every 30 seconds. We call a kit offline after {KitRules.ZoneOfflineHours} hours with no reading.",
                Confidence = KitTrusted,
                WhatWouldChangeIt = "It clears as soon as the kit sends a reading. Check it has power and WiFi.",
                Technical = $"KitRules.IsOffline: {N(hours)} h >= {KitRules.ZoneOfflineHours} h (DATA RULE).",
            };
            if (r.LatestReadingAtUtc.HasValue) e.Fact("Last reading", Sast(r.LatestReadingAtUtc.Value), FromKit);
            return e.Fact("Time since then", N(hours) + " hours", FromKit);
        }

        private static Explanation SensorStuck(ZoneEngineResult r, ZoneFaultSignals s)
        {
            var hours = s.IdenticalReadingFor.HasValue ? Math.Round(s.IdenticalReadingFor.Value.TotalHours, 1) : 0;
            var e = new Explanation
            {
                Summary = $"Your soil sensor has shown exactly the same number for {N(hours)} hours.",
                Rule = $"Real soil changes a little through the day. The same reading for {KitRules.SensorStuckHours} hours or more usually means a loose or broken sensor.",
                Confidence = KitTrusted,
                WhatWouldChangeIt = "It clears once the reading starts to move. Check the sensor is pushed firmly into the soil.",
                Technical = $"KitRules.IsStuck: identical for {N(hours)} h >= {KitRules.SensorStuckHours} h (DATA RULE).",
            };
            if (r.LatestRawReading.HasValue) e.Fact("Reading", N(r.LatestRawReading.Value), FromSensor);
            return e.Fact("Unchanged for", N(hours) + " hours", FromSensor);
        }

        private static Explanation WateringFailed(ZoneFaultSignals s)
        {
            var e = new Explanation
            {
                Summary = "The pump ran, but your soil sensor didn't show the soil getting any wetter.",
                Rule = $"After a pump run of at least {N(KitRules.PumpCheckMinimumSeconds / 60.0)} minutes we expect the sensor to show wetter soil within {KitRules.PumpCheckWindowMinutes} minutes. We never decide this if readings are missing.",
                Confidence = KitTrusted,
                WhatWouldChangeIt = "If the next watering shows the soil getting wetter, this goes away.",
                Technical = $"KitRules.PumpRanNoChange: run >= {KitRules.PumpCheckMinimumSeconds} s, window {KitRules.PumpCheckWindowMinutes} min (DATA RULE).",
            };
            if (s.FailedRunAtUtc.HasValue) e.Fact("Pump run", Sast(s.FailedRunAtUtc.Value), FromPump);
            return e;
        }

        private static Explanation DhtOffline(ZoneFaultSignals s)
        {
            var e = new Explanation
            {
                Summary = "The temperature and humidity sensor on your kit isn't sending readings, so we're using the weather app instead.",
                Rule = $"If soil readings keep arriving but temperature and humidity stop for {KitRules.DhtOfflineWindowHours} hours, we switch to the weather app.",
                Confidence = KitTrusted,
                WhatWouldChangeIt = $"It clears after {KitRules.DhtBackOnlineReadingCount} good readings in a row.",
                Technical = $"KitRules.IsDhtOffline: no valid DHT11 value in {KitRules.DhtOfflineWindowHours} h (DATA RULE).",
            };
            return e.Fact("Last good reading", s.DhtOfflineSinceUtc.HasValue ? Sast(s.DhtOfflineSinceUtc.Value) : "none recorded", FromKit);
        }

        private static Explanation SensorDrift(ZoneEngineInput i, ZoneFaultSignals s)
        {
            var e = new Explanation
            {
                Summary = "Your soil sensor's wettest reading this week is a long way from the wet setting saved for it.",
                Rule = $"Soil sensors wear as they corrode. When the wettest reading moves more than {N(KitRules.SensorDriftFraction * 100)}% of the way between the wet and dry settings, we suggest redoing the setup.",
                Confidence = KitTrusted,
                WhatWouldChangeIt = "Redo the wet/dry setup on the sensor.",
                Technical = "KitRules.IsDrifting (DATA RULE).",
            };
            if (s.SevenDayMinimumReading.HasValue) e.Fact("Wettest reading this week", N(s.SevenDayMinimumReading.Value), FromSensor);
            if (i.CalibrationWet.HasValue) e.Fact("Saved wet setting", N(i.CalibrationWet.Value), FromSetup);
            if (i.CalibrationDry.HasValue) e.Fact("Saved dry setting", N(i.CalibrationDry.Value), FromSetup);
            return e;
        }

        // Water

        // The engine has already decided (WaterNow or WaterNowReduced); this explains that
        // decision and never works it out again.
        private static Explanation WaterNow(ZoneEngineInput i, ZoneEngineResult r)
        {
            var crop = CropName(r);
            var rainToday = RainToday(i, r);
            var reduced = r.PrimaryAction == IrrigationPrimaryAction.WaterNowReduced;
            var pct = r.AdjustedP.HasValue ? Math.Round(r.AdjustedP.Value * 100) : (double?)null;

            var e = new Explanation
            {
                Confidence = r.Confidence.Reason,
                Summary = reduced
                    ? $"The {N(rainToday)} mm of rain expected today helps, but your soil will still be drier than {crop} can stand, so it needs a smaller watering."
                    : $"By the end of today your soil will be drier than {crop} can stand" +
                      (rainToday > 0 ? $", and the {N(rainToday)} mm of rain expected today won't change that." : ", and no rain is expected today."),
                Rule = pct.HasValue
                    ? $"We suggest watering once your crop has used about {N(pct.Value)}% of the water your soil can hold for it, counting any useful rain first."
                    : "We suggest watering once your crop has used the share of soil water it can take without struggling, counting any useful rain first.",
            };

            AddCropFacts(e, i, r);
            if (r.DepletionMm.HasValue) e.Fact("How dry the soil is now", $"about {N(r.DepletionMm.Value)} mm short of full", r.Setup.Calibrated && !r.ReadingStale ? FromSensor + " and " + FromWeather : FromWeather);
            if (r.ProjectedPostRainDepletionMm.HasValue) e.Fact("How dry it will be by tonight", $"about {N(r.ProjectedPostRainDepletionMm.Value)} mm short of full", FromWeather + " and " + FromGuide);
            if (r.RawMm.HasValue) e.Fact("Watering point", $"about {N(r.RawMm.Value)} mm short of full", FromGuide);
            AddReadingFact(e, i, r);
            e.Fact("Rain expected today", N(rainToday) + " mm", FromWeather);
            if (r.EtcTodayMm.HasValue) e.Fact("Water your crop will use today", N(r.EtcTodayMm.Value) + " mm", FromWeather + " and " + FromGuide);
            AddAmountFact(e, r);

            e.WhatWouldChangeIt = "More rain than forecast today could make this smaller or unnecessary. If it has rained heavily, check the soil before watering.";
            e.Technical = Technical(r) + (reduced
                ? " Fao56Engine PrimaryAction WaterNowReduced: projected Dr after effective rain >= RAW (FAO-56 p. 171)."
                : " Fao56Engine PrimaryAction WaterNow: projected end-of-day Dr >= RAW (FAO-56 p. 171).");
            return e;
        }

        // PrimaryAction PostponeForRain: without rain the zone would be due,
        // and after the effective forecast rain it stays below the watering point.
        private static Explanation SkipRain(ZoneEngineInput i, ZoneEngineResult r)
        {
            var rain = RainToday(i, r);
            var e = new Explanation
            {
                Summary = $"Without rain your soil would need water today, but after the {N(rain)} mm of rain expected it should stay wetter than {CropName(r)}'s watering point, so watering can wait.",
                Rule = "We work out how dry the soil will be after the rain that is expected. If that is still short of the point where your crop starts to struggle, we suggest waiting.",
                Confidence = r.Confidence.Reason,
                WhatWouldChangeIt = "If the rain doesn't come, or is much less than forecast, the zone will need water - check again tomorrow.",
                Technical = Technical(r) +
                            $" Fao56Engine PrimaryAction PostponeForRain: projected Dr after effective rain {N(r.ProjectedPostRainDepletionMm)} mm < RAW {N(r.RawMm)} mm.",
            };
            e.Fact("Rain expected today", N(rain) + " mm", FromWeather);
            if (r.DepletionMm.HasValue) e.Fact("How dry the soil is now", $"about {N(r.DepletionMm.Value)} mm short of full", FromWeather);
            if (r.ProjectedPostRainDepletionMm.HasValue) e.Fact("How dry it should be after the rain", $"about {N(r.ProjectedPostRainDepletionMm.Value)} mm short of full", FromWeather + " and " + FromGuide);
            if (r.RawMm.HasValue) e.Fact("Watering point", $"about {N(r.RawMm.Value)} mm short of full", FromGuide);
            if (r.EtcTodayMm.HasValue) e.Fact("Water your crop will use today", N(r.EtcTodayMm.Value) + " mm", FromWeather + " and " + FromGuide);
            AddCropFacts(e, i, r);
            return e;
        }

        // The rain the engine credited today: the forecast figure it used for
        // the decision, else today's balance row.
        private static double RainToday(ZoneEngineInput i, ZoneEngineResult r) =>
            r.ForecastRainTodayMm ?? r.Days.FirstOrDefault(d => d.Day == i.Today)?.RainMm ?? 0.0;

        private static Explanation WaterSoon(ZoneEngineInput i, ZoneEngineResult r)
        {
            var weekday = r.NextWateringDate?.ToString("dddd", Inv) ?? "soon";
            var e = new Explanation
            {
                Summary = $"At the rate {CropName(r)} is using water, the soil will reach its watering point in about {r.DaysToNextWatering} days.",
                Rule = $"We look {WaterRules.WaterSoonDays} days ahead using the weather forecast, so you can plan.",
                Confidence = r.Confidence.Reason,
                WhatWouldChangeIt = $"Rain before {weekday} would push this back.",
                Technical = Technical(r) + " Forecast projection of Eq. 85 to Dr >= RAW.",
            };
            if (r.NextWateringDate.HasValue) e.Fact("Expected watering day", r.NextWateringDate.Value.ToString("dddd d MMM", Inv), FromWeather);
            AddCropFacts(e, i, r);
            if (r.DepletionMm.HasValue) e.Fact("How dry the soil is now", $"about {N(r.DepletionMm.Value)} mm short of full", FromWeather);
            return e;
        }

        private static Explanation HotDays(ZoneEngineResult r, ZoneInsight insight)
        {
            var peak = D(insight, "forecast_peak_mm");
            var mean = D(insight, "trailing_mean_mm");
            var e = new Explanation
            {
                Summary = "The forecast shows days when crops will need clearly more water than last week.",
                Rule = $"We warn when a forecast day needs at least {N((WaterRules.HotDaysEtoMultiple - 1) * 100)}% more water than the average of the last 7 days.",
                Confidence = r.Confidence.Reason,
                WhatWouldChangeIt = "If the forecast cools down, this goes away.",
                Technical = $"WaterRules.HotDaysAhead: peak forecast ETo {N(peak)} mm >= {N(WaterRules.HotDaysEtoMultiple)} x trailing mean {N(mean)} mm (DATA RULE).",
            };
            if (peak.HasValue) e.Fact("Thirstiest forecast day", N(peak.Value) + " mm of water use", FromWeather);
            if (mean.HasValue) e.Fact("Average over the last 7 days", N(mean.Value) + " mm a day", FromWeather);
            return e;
        }

        private static Explanation DataGap(ZoneEngineResult r, ZoneInsight insight)
        {
            var date = insight.Data.TryGetValue("date", out var v) && v is string s && DateOnly.TryParse(s, Inv, DateTimeStyles.None, out var d)
                ? d.ToString("d MMM", Inv) : "one day";
            return new Explanation
            {
                Summary = $"We had no weather for {date}, so the estimate for that day is less certain.",
                Rule = "Without weather for a day we keep the previous day's estimate for one day, then pause until weather returns.",
                Confidence = r.Confidence.Reason,
                WhatWouldChangeIt = "It clears when weather data for that day arrives.",
                Technical = "Spec 3c fallback 5: carry Dr forward one day, then stop.",
            }.Fact("Day with no weather", date, FromWeather);
        }

        private static Explanation ThresholdUnsafe(ZoneEngineInput i, ZoneEngineResult r, ZoneInsight insight)
        {
            var current = D(insight, "current_threshold");
            var recommended = D(insight, "recommended_threshold");
            var p = r.Crop != null ? Math.Round(r.Crop.DepletionFractionP * r.Soil.PFactor * 100) : (double?)null;
            var e = new Explanation
            {
                Summary = $"The watering level saved for this zone waits until the soil is drier than {CropName(r)} handles well.",
                Rule = p.HasValue
                    ? $"{Capitalise(CropName(r))} can use about {N(p.Value)}% of the water in the soil before it struggles. Your level waits longer than that."
                    : "Your level waits longer than this crop can go without struggling.",
                Confidence = r.Confidence.Reason,
                WhatWouldChangeIt = recommended.HasValue
                    ? $"Tap Reset to recommended, or set the level to {N(Math.Round(recommended.Value))} or wetter."
                    : "Tap Reset to recommended.",
                Technical = $"WaterRules.RecommendedThreshold: Table 22 p x soil factor (p. 167), clamped 0.1-0.8 (p. 162); recommended {N(recommended)}, current {N(current)}.",
            };
            if (current.HasValue) e.Fact("Watering level now", N(current.Value), FromSetup);
            if (recommended.HasValue) e.Fact("Recommended level", N(Math.Round(recommended.Value)), FromGuide);
            AddCropFacts(e, i, r);
            return e;
        }

        private static Explanation StressDays(ZoneEngineInput i, ZoneEngineResult r, ZoneInsight insight)
        {
            var days = (int)(D(insight, "days") ?? 0);
            var e = new Explanation
            {
                Summary = $"On {days} day(s) this week the soil was drier than {CropName(r)} can easily draw water from.",
                Rule = "A day counts when the soil had dried past the watering point, so the crop had to work harder for water.",
                Confidence = r.Confidence.Reason,
                WhatWouldChangeIt = "Watering when we suggest it keeps this at zero.",
                Technical = "WaterRules.WasStressed: Ks < 1, FAO-56 Eq. 84 p. 169.",
            };
            AddCropFacts(e, i, r);
            return e.Fact("Dry days this week", days.ToString(Inv), FromWeather + " and " + FromPump);
        }

        private static Explanation Overwatering(ZoneEngineInput i, ZoneEngineResult r, ZoneInsight insight)
        {
            var given = D(insight, "irrigation_mm");
            var used = D(insight, "crop_use_mm");
            var e = new Explanation
            {
                Summary = $"This week the zone got about {N(D(insight, "ratio"))} times the water {CropName(r)} used.",
                Rule = $"More than {N(VerdictRules.OverwaterRatio)} times what the crop used counts as too much. Pump amounts are estimates from run time and flow rate, so smaller differences are not flagged.",
                Confidence = r.Confidence.Reason,
                WhatWouldChangeIt = "Shorter or fewer waterings bring this back into range.",
                Technical = $"VerdictRules.For = TooMuch: irrigation {N(given)} mm vs ETc {N(used)} mm over 7 days (DATA RULE).",
            };
            if (given.HasValue) e.Fact("Water given this week", N(given.Value) + " mm", FromPump);
            if (used.HasValue) e.Fact("Water the crop used", N(used.Value) + " mm", FromWeather + " and " + FromGuide);
            AddCropFacts(e, i, r);
            return e;
        }

        // Crop

        private static Explanation GrowthStatus(ZoneEngineInput i, ZoneEngineResult r)
        {
            if (r.PrimaryAction == IrrigationPrimaryAction.CropNotPlanted)
            {
                return new Explanation
                {
                    Summary = $"{Capitalise(CropName(r))} is scheduled for planting on {i.PlantingDate:dd MMM}; crop irrigation has not started.",
                    Rule = "A future crop does not receive ordinary irrigation advice before its planting date.",
                    Confidence = r.Confidence.Reason,
                    WhatWouldChangeIt = "Advice starts on the planting date, or when you update that date.",
                    Technical = "Fao56Engine terminal state: CropNotPlanted.",
                }.Fact("Planting date", i.PlantingDate?.ToString("d MMM", Inv) ?? "not set", FromSetup)
                 .Fact("Crop", Capitalise(CropName(r)), FromSetup);
            }

            if (r.StageAssumed)
            {
                return new Explanation
                {
                    Summary = $"We don't know when {CropName(r)} was planted, so we assume it is at peak growth, when it uses the most water.",
                    Rule = "Without a planting date we use the crop's highest water need, so any mistake errs toward enough water.",
                    Confidence = r.Confidence.Reason,
                    WhatWouldChangeIt = "Add the planting date for advice that follows your crop's growth.",
                    Technical = $"CropRules.KcWhenStageUnknown = {N(r.KcToday)} (max of Table 12 values).",
                }.Fact("Planting date", "not set yet", FromSetup).Fact("Crop", Capitalise(CropName(r)), FromSetup);
            }

            var e = new Explanation
            {
                Summary = $"{Capitalise(CropName(r))} is in its {StageName(r)} stage, day {r.DayOfSeason} of about {r.Crop?.TotalDays}.",
                Rule = "Growth stages and their lengths come from the FAO crop water guide for this crop, counted from the planting date.",
                Confidence = r.Confidence.Reason,
                WhatWouldChangeIt = "If the planting date is wrong, correct it in the zone's settings.",
                Technical = "CropRules.StageFor: FAO-56 Table 11, " + r.Crop?.Table11Row + ".",
            };
            AddCropFacts(e, i, r);
            return e;
        }

        private static Explanation SeasonComplete(ZoneEngineInput i, ZoneEngineResult r) =>
            AddCropFacts(new Explanation
            {
                Summary = $"Counting from the planting date, {CropName(r)}'s season of about {r.Crop?.TotalDays} days is over.",
                Rule = "We count the season from the planting date using the crop's usual season length.",
                Confidence = r.Confidence.Reason,
                WhatWouldChangeIt = "Update the planting date when you plant the next crop.",
                Technical = "CropRules.SeasonComplete: day > Table 11 total.",
            }, i, r);

        private static Explanation PeakGrowth(ZoneEngineInput i, ZoneEngineResult r) =>
            AddCropFacts(new Explanation
            {
                Summary = $"{Capitalise(CropName(r))} is at peak growth, when a shortage of water costs the most harvest.",
                Rule = "Running short of water while a crop flowers and forms its harvest costs more than at any other time.",
                Confidence = r.Confidence.Reason,
                WhatWouldChangeIt = "This message stops when the crop moves into its last stage.",
                Technical = "CropRules.SensitiveStage: FAO-56 p. 176 (flowering and yield formation); mid-season p. 95-96.",
            }, i, r);

        private static Explanation StageChange(ZoneEngineResult r, ZoneInsight insight)
        {
            var daysUntil = (int)(D(insight, "days_until") ?? 0);
            var next = insight.Data.TryGetValue("next_stage", out var v) ? v as string : null;
            return new Explanation
            {
                Summary = $"{Capitalise(CropName(r))} moves to {next?.ToLowerInvariant() ?? "its next stage"} in {daysUntil} days, and its water need changes with it.",
                Rule = $"We warn {CropRules.StageChangeWarningDays} days before a stage change so you can adjust your watering routine.",
                Confidence = r.Confidence.Reason,
                WhatWouldChangeIt = "If the planting date is wrong, correct it and the date of the change moves too.",
                Technical = "CropRules.NextStageChange + StageChangeSoon: Table 11 lengths, Table 12 factors.",
            }.Fact("Days until the change", daysUntil.ToString(Inv), FromGuide).Fact("Next stage", next ?? "-", FromGuide);
        }

        private static Explanation HarvestSoon(ZoneEngineInput i, ZoneEngineResult r, ZoneInsight insight)
        {
            var days = (int)(D(insight, "days_to_end") ?? 0);
            return AddCropFacts(new Explanation
            {
                Summary = $"{Capitalise(CropName(r))} is about {days} days from harvest, and needs less water from now.",
                Rule = $"In the last {CropRules.HarvestSoonDays} days of the season a crop's water need falls.",
                Confidence = r.Confidence.Reason,
                WhatWouldChangeIt = "If the planting date is wrong, correct it in the zone's settings.",
                Technical = "CropRules.HarvestSoon: Table 11 season length; late-season Kc falls toward Kc end (Table 12).",
            }, i, r);
        }

        // Confidence badge

        /// <summary>Why the advice is High / Medium / Low - from the same setup state ConfidenceRules used.</summary>
        public static Explanation Confidence(ZoneEngineResult r)
        {
            var s = r.Setup;
            string Set(bool v) => v ? "set" : "not set yet";

            var e = new Explanation
            {
                Summary = r.Confidence.Reason,
                Rule = $"High needs every setup detail and a sensor reading from the last {N(ConfidenceRules.FreshReadingHours)} hours. Medium is the weather and the crop with up to {ConfidenceRules.MaxMissingForMedium} details missing. Anything less is Low.",
                Confidence = r.Confidence.Reason,
                WhatWouldChangeIt = r.NextStep?.Ask ?? "Nothing - this zone is fully set up.",
                Technical = "ConfidenceRules.For / NextStep (DATA RULES).",
            };

            e.Fact("Crop", Set(s.CropKnown), FromSetup)
             .Fact("Planting date", Set(s.PlantingDateKnown), FromSetup)
             .Fact("Pump flow rate", Set(s.FlowRateSet), FromSetup)
             .Fact("Zone size", Set(s.AreaSet), FromSetup)
             .Fact("Soil type", Set(s.SoilSet), FromSetup)
             .Fact("Sensor wet/dry setup", s.Calibrated ? "done" : "not done yet", FromSetup)
             .Fact("Soil sensor", !s.HasKit ? "no readings yet" : s.ReadingFresh ? "reporting" : ConfidenceRules.KitQuiet(s.LastReadingAtUtc), FromKit)
             .Fact("Weather", s.WeatherAvailable ? "available" : "not available yet", FromWeather);
            return e;
        }

        // Alert rows

        /// <summary>Why a zone's "entered Critical" alert was raised.</summary>
        public static Explanation CriticalAlert(float? reading, float? temperatureC, float readingCriticalBelow, float temperatureCriticalFrom)
        {
            var dry = reading.HasValue && reading.Value < readingCriticalBelow;
            var hot = temperatureC.HasValue && temperatureC.Value >= temperatureCriticalFrom;

            var e = new Explanation
            {
                Summary = dry && hot ? "The zone's soil sensor reading was very low and the kit measured very high heat."
                        : hot ? "The kit measured very high heat at this zone."
                        : "The zone's soil sensor reading dropped very low.",
                Rule = $"A zone is critical when its soil sensor reads below {N(readingCriticalBelow)}, or the kit measures {N(temperatureCriticalFrom)} °C or hotter. We record it once, when it happens.",
                Confidence = "High: this comes straight from your kit's own readings.",
                WhatWouldChangeIt = "The alert closes by itself once readings are back out of the critical range.",
                Technical = $"Zone.CalculateHealthStatus = Critical (reading < {readingCriticalBelow} or temperature >= {temperatureCriticalFrom}).",
            };
            if (reading.HasValue) e.Fact("Soil sensor reading", N(reading.Value), FromSensor);
            if (temperatureC.HasValue) e.Fact("Temperature at the kit", N(temperatureC.Value) + " °C", FromKit);
            return e;
        }

        /// <summary>Why the DHT11 maintenance callout was raised.</summary>
        public static Explanation DhtCallout(DateTime? lastGoodUtc) =>
            new Explanation
            {
                Summary = "The kit's temperature and humidity sensor stopped sending readings while soil readings kept arriving.",
                Rule = $"If temperature and humidity stop for {KitRules.DhtOfflineWindowHours} hours while soil readings continue, the sensor needs a visit. Until then the weather app stands in.",
                Confidence = "High: this comes straight from your kit's own readings.",
                WhatWouldChangeIt = "The team closes this after the visit. Advice keeps working from the weather app meanwhile.",
                Technical = "KitRules.IsDhtOffline (DATA RULE).",
            }.Fact("Last good reading", lastGoodUtc.HasValue ? Sast(lastGoodUtc.Value) : "none recorded", FromKit);

        // Verdicts (reports)

        /// <summary>Why a period's water was Too little / About right / Too much.</summary>
        public static Explanation Verdict(double appliedL, double neededL, string? cropLabel, string periodWords)
        {
            var verdict = VerdictRules.For(appliedL, neededL);
            var crop = string.IsNullOrWhiteSpace(cropLabel) ? "the crop" : cropLabel!.ToLowerInvariant();
            var ratio = neededL > 0 ? appliedL / neededL : 0;

            return new Explanation
            {
                Summary = verdict switch
                {
                    WateringVerdict.TooMuch => $"The zone got about {N(Math.Round(ratio, 1))} times what {crop} needed {periodWords}.",
                    WateringVerdict.TooLittle => $"The zone got about {N(Math.Round(ratio * 100))}% of what {crop} needed {periodWords}.",
                    WateringVerdict.AboutRight => $"The water given {periodWords} was close to what {crop} needed.",
                    _ => $"There was no water need to compare against {periodWords}.",
                },
                Rule = $"More than {N(VerdictRules.OverwaterRatio)} times the need is too much and less than {N(VerdictRules.UnderwaterRatio)} times is too little. Pump amounts are estimates from run time and flow rate, so smaller differences are not flagged.",
                Confidence = "Medium: water given is estimated from pump run time and the zone's flow rate - there is no flow meter.",
                WhatWouldChangeIt = verdict switch
                {
                    WateringVerdict.TooMuch => "Shorter or fewer waterings.",
                    WateringVerdict.TooLittle => "Longer waterings, or watering when the app suggests it.",
                    _ => "A big change in the weather or in how long the pump runs.",
                },
                Technical = $"VerdictRules.For({N(appliedL)} L, {N(neededL)} L) = {verdict}; need = sum of ETc x area (FAO-56 Eq. 58, p. 103).",
            }
            .Fact("Water given", $"about {N(Math.Round(appliedL))} L", FromPump)
            .Fact("Water needed", $"about {N(Math.Round(neededL))} L", FromWeather + " and " + FromGuide)
            .Fact("Verdict", VerdictRules.Label(verdict), "the rule below");
        }

        // Shared facts

        private static Explanation AddCropFacts(Explanation e, ZoneEngineInput i, ZoneEngineResult r)
        {
            if (r.Crop != null) e.Fact("Crop", r.Crop.Label, FromSetup);

            if (r.StageAssumed)
            {
                e.Fact("Crop stage", CropRules.AssumedStageLabel + " (no planting date)", FromGuide);
            }
            else if (r.Stage.HasValue && r.DayOfSeason.HasValue && r.Crop != null)
            {
                e.Fact("Crop stage", $"{StageName(r)}, day {r.DayOfSeason} of about {r.Crop.TotalDays}", "your planting date");
            }

            e.Fact("Soil", r.SoilWasDefaulted ? r.Soil.Label + " (assumed - not set yet)" : r.Soil.Label,
                r.SoilWasDefaulted ? FromGuide : FromSetup);
            return e;
        }

        private static void AddReadingFact(Explanation e, ZoneEngineInput i, ZoneEngineResult r)
        {
            // The farmer's own soil check, when the balance used one.
            if (r.LatestSoilFeel is { } feel)
            {
                e.Fact("Your soil check", $"felt {feel.Feel} at {Sast(feel.CheckedAtUtc)}", "you, by hand");
            }

            if (!r.LatestRawReading.HasValue) return;

            if (r.ReadingStale)
            {
                e.Fact("Soil sensor", ConfidenceRules.KitQuiet(r.LatestReadingAtUtc), FromKit);
            }
            else if (r.RelativeMoisturePercent.HasValue)
            {
                e.Fact("Soil moisture", N(Math.Round(r.RelativeMoisturePercent.Value)) + "%", FromSensor);
                // The level is in the zone's own sensor units (the engine compares in those units),
                // so it never has a %.
                if (i.MoistureThreshold.HasValue) e.Fact("Watering level", N(i.MoistureThreshold.Value), FromSetup);
            }
            else
            {
                e.Fact("Soil sensor", "sensor reading " + N(r.LatestRawReading.Value) + " (not yet set up)", FromSensor);
            }
        }

        private static void AddAmountFact(Explanation e, ZoneEngineResult r)
        {
            if (r.RecommendedRuntimeSeconds.HasValue && r.RecommendedLitres.HasValue)
                e.Fact("How much", r.RecommendedRuntimeSeconds.Value < 60.0
                    ? $"about {N(r.RecommendedRuntimeSeconds.Value)} sec (about {N(Math.Round(r.RecommendedLitres.Value))} L)"
                    : $"about {N(r.RecommendedRuntimeSeconds.Value / 60.0)} min (about {N(Math.Round(r.RecommendedLitres.Value))} L)", FromSetup);
            else if (r.RecommendedMinutesPerSquareMetre.HasValue)
                e.Fact("How much", $"about {N(r.RecommendedMinutesPerSquareMetre.Value)} min for each square metre", FromSetup);
            else if (r.RecommendedDepthMm.HasValue)
                e.Fact("How much", $"about {N(r.RecommendedDepthMm.Value)} mm ({N(r.RecommendedDepthMm.Value)} L per square metre)", FromGuide);
        }

        private static string Technical(ZoneEngineResult r)
        {
            var parts = new List<string>();
            if (r.DepletionMm.HasValue) parts.Add($"Dr {N(r.DepletionMm.Value)} mm");
            if (r.RawMm.HasValue) parts.Add($"RAW {N(r.RawMm.Value)} mm");
            if (r.TawMm.HasValue) parts.Add($"TAW {N(r.TawMm.Value)} mm");
            if (r.AdjustedP.HasValue) parts.Add($"p {N(r.AdjustedP.Value, "0.00")}");
            if (r.KcToday.HasValue) parts.Add($"Kc {N(r.KcToday.Value, "0.00")}" + (r.StageAssumed ? " (assumed stage)" : ""));
            if (r.EtoTodayMm.HasValue) parts.Add($"ETo {N(r.EtoTodayMm.Value)} mm");
            if (r.EtcTodayMm.HasValue) parts.Add($"ETc {N(r.EtcTodayMm.Value)} mm");
            return string.Join(", ", parts) + ". FAO-56 Eq. 58 (p. 103), 82-85 (pp. 162-170).";
        }

        // Helpers

        private static string CropName(ZoneEngineResult r) =>
            r.Crop != null ? r.Crop.Label.ToLowerInvariant() : "this crop";

        private static string StageName(ZoneEngineResult r) =>
            r.Stage.HasValue ? Fao56EngineReference.StageLabel(r.Stage.Value).ToLowerInvariant() : "current";

        private static string Sast(DateTime utc) =>
            utc.AddHours(2).ToString("HH:mm 'on' d MMM", Inv);

        private static double? D(ZoneInsight insight, string key)
        {
            if (!insight.Data.TryGetValue(key, out var v) || v == null) return null;
            try { return Convert.ToDouble(v, Inv); }
            catch (Exception) { return null; }
        }

        private static string N(double value, string format = "0.#") => value.ToString(format, Inv);
        private static string N(double? value) => value.HasValue ? N(value.Value) : "-";

        private static string Capitalise(string s) =>
            string.IsNullOrEmpty(s) ? s : char.ToUpperInvariant(s[0]) + s.Substring(1);
    }
}
