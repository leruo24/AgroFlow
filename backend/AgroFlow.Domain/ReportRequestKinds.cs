#nullable enable
using System;
using System.Globalization;

namespace AgroFlow.Business
{
    // The three reports a farmer can ask for, and the words used for each.
    //
    // One place, because the same three strings appear in the database CHECK
    // constraint (0034), the request form, the status list, the Telegram
    // caption and the auto-report checkboxes. Five spellings of
    // "water_usage" is how one of them ends up never matching.
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

        // What the farmer sees. Not a prettified version of the key - "Soil
        // moisture" is what the thing is called on every other screen, and
        // "Watering schedule & advice" says that it carries the advice too,
        // which is the half farmers actually read.
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

        // The schedule report is always "right now, and the week ahead" -
        // Olwethu's endpoint takes no date range, it projects forward from
        // today. Asking a farmer to pick a period for it would offer a
        // choice that changes nothing.
        public static bool UsesDateRange(string? reportType)
        {
            return reportType != Schedule;
        }

        // Moisture is per zone; the other two are per farm. Olwethu's
        // endpoints already draw this line (GetMoistureAsync takes zoneId,
        // the others take farmId), so the request form has to respect it
        // rather than offering "all zones" for a report that cannot do it.
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

        // Shown to the farmer when generation fails. Deliberately says
        // nothing about what went wrong: the farmer cannot act on "the
        // engine threw on zone 12", and the real reason is in the row's
        // error column and the server log for whoever can.
        public const string FarmerFailureMessage = "This report couldn't be made. Try again later.";
    }

    // The period a request covers, in words the farmer chose it with.
    public static class ReportPeriods
    {
        public const string Last7Days = "last_7_days";
        public const string Last30Days = "last_30_days";
        public const string Custom = "custom";

        // "last 7 days" / "1 Sep to 30 Sep". Used in the Telegram caption and
        // the list row, so the farmer can tell two reports of the same type
        // apart.
        public static string Describe(DateOnly start, DateOnly end)
        {
            var span = end.DayNumber - start.DayNumber + 1;

            if (span == 7) return "last 7 days";
            if (span == 30 || span == 31) return "last 30 days";

            // InvariantCulture, not the host's. Without it the month name is
            // whatever the container's locale produces - a Linux box on
            // .NET 8 renders September as "Sept", a Windows dev machine as
            // "Sep" - so the same report would be captioned differently
            // depending on where it was generated. This string reaches the
            // farmer in a Telegram message, so it has to be the same every
            // time.
            return start.ToString("d MMM", CultureInfo.InvariantCulture)
                 + " to "
                 + end.ToString("d MMM yyyy", CultureInfo.InvariantCulture);
        }
    }
}
