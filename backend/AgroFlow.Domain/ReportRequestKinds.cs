#nullable enable
using System;
using System.Globalization;

namespace AgroFlow.Business
{
    // The three reports a farmer can ask for, and their names. One place, because the
    // same strings appear in the CHECK constraint (0034), the request form, the status
    // list, the Telegram caption and the auto-report checkboxes.
    public static class ReportKinds
    {
        public const string WaterUsage = "water_usage";
        public const string Moisture = "moisture";
        public const string Schedule = "schedule";

        public static readonly string[] All = { WaterUsage, Moisture, Schedule };

        public static bool IsValid(string? reportType)
        {
            return reportType == WaterUsage || reportType == Moisture || reportType == Schedule;
        }

        // What the farmer sees. "Soil moisture" matches every other screen, and "Watering
        // schedule & advice" says it includes the advice, the part farmers actually read.
        public static string DisplayName(string? reportType)
        {
            switch (reportType)
            {
                case WaterUsage: return "Water usage";
                case Moisture: return "Soil moisture";
                case Schedule: return "Watering schedule & advice";
                default: return "Report";
            }
        }

        // The schedule report is always "now and the week ahead" (its endpoint takes no date
        // range), so we do not ask the farmer to pick a period.
        public static bool UsesDateRange(string? reportType)
        {
            return reportType != Schedule;
        }

        // Moisture is per zone; the other two are per farm (the report endpoints take zoneId
        // and farmId respectively), so the form does not offer "all zones" for moisture.
        public static bool RequiresZone(string? reportType)
        {
            return reportType == Moisture;
        }
    }

    public static class ReportRequestStatuses
    {
        public const string Preparing = "preparing";
        public const string Ready = "ready";
        public const string Failed = "failed";

        public static string DisplayName(string? status)
        {
            switch (status)
            {
                case Ready: return "Ready";
                case Failed: return "Failed";
                default: return "Preparing";
            }
        }

        // Shown to the farmer when generation fails. It does not say what went wrong, because
        // the farmer cannot act on that; the real reason is in the row and the server log.
        public const string FarmerFailureMessage = "This report couldn't be made. Try again later.";
    }

    // The period a request covers, in words the farmer chose it with.
    public static class ReportPeriods
    {
        public const string Last7Days = "last_7_days";
        public const string Last30Days = "last_30_days";
        public const string Custom = "custom";

        // "last 7 days" / "1 Sep to 30 Sep", used in the Telegram caption and the list row so
        // the farmer can tell two reports of the same type apart.
        public static string Describe(DateOnly start, DateOnly end)
        {
            var span = end.DayNumber - start.DayNumber + 1;

            if (span == 7) return "last 7 days";
            if (span == 30 || span == 31) return "last 30 days";

            // InvariantCulture, not the host's: otherwise Linux may write "Sept" and Windows
            // "Sep", and this reaches the farmer in a Telegram message.
            return start.ToString("d MMM", CultureInfo.InvariantCulture)
                 + " to "
                 + end.ToString("d MMM yyyy", CultureInfo.InvariantCulture);
        }
    }
}
