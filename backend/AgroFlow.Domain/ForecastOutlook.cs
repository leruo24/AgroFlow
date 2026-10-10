#nullable enable
using System;
using AgroFlow.Business.Agronomy;

namespace AgroFlow.Business
{
    // The three pictures a farmer can tell apart at a glance on a phone in sunlight.
    // Rain / cloud / sun is the whole watering decision; a full weather icon set adds
    // nothing the farmer acts on.
    public enum ForecastIcon
    {
        Sun,
        Cloud,
        Rain,
    }

    // Turns a day's weather row into the icon and plain sentence on the Forecast screen.
    // Pure, so the thresholds can be tested directly.
    public static class ForecastOutlook
    {
        // The screen shows a week. The engine collects eight days, but day 8 is the least
        // reliable and nobody plans irrigation that far out.
        public const int MaxForecastDays = 7;

        // At or above this, rain is worth mentioning. Below it, it is a trace that evaporates
        // before reaching the roots and must not be shown as watering. The same 1.0 mm the
        // schedule report uses, so the two screens agree.
        public const double RainMmThreshold = 1.0;

        // Humid and not raining reads as overcast. Only chooses between sun and cloud; it
        // never changes the watering advice.
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

        // The engine's decision for one day, in the farmer's words. "Rain should cover it"
        // answers the farmer's real question ("do I need to do anything tomorrow?").
        // Null for a day the engine cannot speak to (no crop, planting date or weather row);
        // the screen then shows nothing instead of a guess.
        public static string? PlainDayAdvice(AdviceAction action, double? rainMm)
        {
            switch (action)
            {
                case AdviceAction.IrrigateNow:
                    return "Water likely needed";

                case AdviceAction.HoldRainExpected:
                    return "Rain should cover it";

                case AdviceAction.NoActionNeeded:
                    // A dry day with no need and a day whose rain covers it are different answers, even
                    // though both mean "do nothing".
                    return rainMm.HasValue && rainMm.Value >= RainMmThreshold
                        ? "Rain should cover it"
                        : "No watering needed";

                default:
                    return null;
            }
        }

        // Future days have no soil reading, so their outlook rests on rainfall alone, the
        // same rule the schedule report uses beyond day 0.
        public static string PlainOutlookFromRainOnly(double? rainMm)
        {
            return rainMm.HasValue && rainMm.Value >= RainMmThreshold
                ? "Rain should cover it"
                : "Check the soil that morning";
        }

        // Shown instead of an empty screen, so the farmer does not think the app is broken.
        public const string NoForecastMessage = "Forecast not available right now";

        // Required by Open-Meteo's terms, and accurate: this is an area forecast, not a
        // measurement at the farm.
        public const string SourceLine = "Forecast from the weather app (Open-Meteo)";
    }
}
