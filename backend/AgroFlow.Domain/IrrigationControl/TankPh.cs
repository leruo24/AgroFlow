#nullable enable
using System;

namespace AgroFlow.Business
{
    public static class TankPhRules
    {
        public const decimal LowFraction = 0.20m;
        public const string LowTankMessage = "Your tank is getting low — refill and log the reading.";
        public const string WaterPhWarning = "Check your water — pH is outside the usual range for irrigation water.";

        public static string? ValidateCapacity(decimal litres)
            => litres <= 0 ? "Tank size must be greater than 0 litres." : null;

        public static string? ValidateRefill(decimal litres, decimal? waterPh, decimal capacity)
        {
            if (litres <= 0) return "Litres added must be greater than 0.";
            if (capacity <= 0) return "Set the tank size before logging a refill.";
            if (litres > capacity) return "Litres added cannot be greater than the tank size.";
            return ValidatePh(waterPh);
        }

        public static string? ValidateSoilPh(decimal ph, string? note)
        {
            var error = ValidatePh(ph);
            if (error is not null) return error;
            return note?.Length > 500 ? "The note must be 500 characters or fewer." : null;
        }

        private static string? ValidatePh(decimal? ph)
            => ph is < 0 or > 14 ? "pH must be between 0 and 14." : null;

        public static decimal EstimateRemaining(decimal refillLitres, decimal estimatedUsed, decimal capacity)
            => Math.Clamp(refillLitres - Math.Max(0, estimatedUsed), 0, capacity);

        public static bool IsLow(decimal remaining, decimal capacity)
            => capacity > 0 && remaining < capacity * LowFraction;

        public static string? WaterWarning(decimal? waterPh)
        {
            // Usual irrigation-water range cited by Ayers & Westcot (1985),
            // FAO Irrigation and Drainage Paper 29 Rev. 1. This is a warning only.
            return waterPh is < 6.5m or > 8.4m ? WaterPhWarning : null;
        }
    }

    public sealed class TankStatus
    {
        public long FarmId { get; set; }
        public string FarmName { get; set; } = string.Empty;
        public decimal? CapacityLitres { get; set; }
        public long? LastRefillId { get; set; }
        public decimal? LastRefillLitres { get; set; }
        public DateTimeOffset? LastRefilledAt { get; set; }
        public decimal? LatestWaterPh { get; set; }
        public decimal EstimatedUsedLitres { get; set; }
        public decimal? EstimatedRemainingLitres { get; set; }
        public bool IsLow { get; set; }
        public string? WaterPhWarning { get; set; }
    }

    public sealed class SoilPhEntry
    {
        public long Id { get; set; }
        public long ZoneId { get; set; }
        public decimal Ph { get; set; }
        public DateTimeOffset MeasuredAt { get; set; }
        public string? Note { get; set; }
    }

    public sealed class ZoneSoilPhSummary
    {
        public long ZoneId { get; set; }
        public string ZoneName { get; set; } = string.Empty;
        public SoilPhEntry? Latest { get; set; }
    }

    public sealed class TankRefillResult
    {
        public TankStatus Status { get; set; } = new TankStatus();
        public decimal? EstimatedUsedBeforeRefill { get; set; }
        public decimal? ObservedUsed { get; set; }
        public string? Comparison { get; set; }
    }
}
