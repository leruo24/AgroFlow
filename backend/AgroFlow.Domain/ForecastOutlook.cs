#nullable enable
using System;
using AgroFlow.Business.Agronomy;

namespace AgroFlow.Business
{
    // The three pictures a farmer can tell apart at a glance on a phone, in
    // sunlight, without reading anything.
    //
    // Three and not twelve on purpose. A weather app's full icon set
    // (drizzle, sleet, thunder, partly cloudy...) is a vocabulary the farmer
    // has to learn, and none of those distinctions change what they do about
    // watering. Rain / cloud / sun is the whole decision.
    public enum ForecastIcon
    {
        Sun,
        Cloud,
        Rain,
    }

    // Turns a day's weather row into the icon and the plain sentence the
    // Forecast screen shows.
    //
    // Pure and side-effect free so the thresholds can be tested directly -
    // they are the difference between a farmer watering a field the rain was
    // about to cover and one watching a crop dry out.
    public static class ForecastOutlook
    {
        // The screen shows a week. The engine collects eight days from
        // Open-Meteo (Fao56EngineController.ForecastWindowDays), but day 8 is
        // both the least reliable and the least actionable - nobody plans
        // irrigation eight days out - so the screen stops at seven.
        public const int MaxForecastDays = 7;

        // At or above this, rain is worth mentioning as rain. Below it, a
        // trace that evaporates off the leaves before it reaches the root
        // zone and must not be presented as watering.
        //
        // Matches the 1.0 mm the schedule report already uses for its
        // "rain forecast, check moisture before irrigating" note, so the two
        // screens cannot disagree about whether it rained.
        public const double RainMmThreshold = 1.0;

        // Humid and not raining reads as overcast. Only used to choose
        // between sun and cloud - it never changes the watering advice, which
        // comes from the engine.
        public const double CloudHumidityPercent = 75.0;

        public static ForecastIcon PickIcon(double? rainMm, double? humidityPercent)
        {
            if (rainMm.HasValue && rainMm.Value >= RainMmThreshold) return ForecastIcon.Rain;

            if (humidityPercent.HasValue && humidityPercent.Value >= CloudHumidityPercent)
            {
                return ForecastIcon.Cloud;
            }

            return ForecastIcon.Sun;
        }

        public static string IconName(ForecastIcon icon)
        {
            switch (icon)
            {
                case ForecastIcon.Rain: return "rain";
                case ForecastIcon.Cloud: return "cloud";
                default: return "sun";
            }
        }

        // The engine's decision for one day, in the farmer's words.
        //
        // The wording is deliberately NOT a reworded version of the action
        // enum. "HoldRainExpected" is a state; "Rain should cover it" is an
        // answer to the question the farmer actually asked, which is whether
        // they need to do anything tomorrow.
        //
        // Null for a day the engine cannot speak to - a zone with no crop, no
        // planting date, or no weather row. The screen renders nothing rather
        // than a guess: advice the app invented is worse than no advice,
        // because the farmer cannot tell the two apart.
        public static string? PlainDayAdvice(AdviceAction action, double? rainMm)
        {
            switch (action)
            {
                case AdviceAction.IrrigateNow:
                    return "Water likely needed";

                case AdviceAction.HoldRainExpected:
                    return "Rain should cover it";

                case AdviceAction.NoActionNeeded:
                    // A dry day the crop simply does not need water on, and a
                    // day whose rain already covers it, are different answers
                    // even though the engine reaches both as "do nothing".
                    return rainMm.HasValue && rainMm.Value >= RainMmThreshold
                        ? "Rain should cover it"
                        : "No watering needed";

                default:
                    return null;
            }
        }

        // Future days have no soil reading, so the engine's per-day outlook
        // for them rests on rainfall alone - the same rule the schedule
        // report applies beyond day 0. Kept here so both read the same.
        public static string PlainOutlookFromRainOnly(double? rainMm)
        {
            return rainMm.HasValue && rainMm.Value >= RainMmThreshold
                ? "Rain should cover it"
                : "Check the soil that morning";
        }

        // Shown instead of an empty screen. A farmer who opens Forecast and
        // sees nothing assumes the app is broken; this says which of the two
        // it is, without blaming them.
        public const string NoForecastMessage = "Forecast not available right now";

        // Required by Open-Meteo's terms and, more usefully, honest: these
        // numbers are a public forecast for the area, not a measurement at
        // this farm.
        public const string SourceLine = "Forecast from the weather app (Open-Meteo)";
    }
}
