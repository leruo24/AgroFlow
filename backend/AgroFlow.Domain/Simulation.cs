#nullable enable
using System;

namespace AgroFlow.Business
{
    public sealed class SimulationTarget
    {
        public long FarmId { get; set; }
        public long ZoneId { get; set; }
        public DateOnly Day { get; set; }
        public double DepletionMm { get; set; }
        public double TotalAvailableWaterMm { get; set; }
    }

    public static class SimulationRules
    {
        public const double MaximumNoisePercentagePoints = 0.35;

        public static bool CanWrite(bool farmIsSimulated) => farmIsSimulated;

        public static double MoistureFromStoredBalance(
            double depletionMm, double totalAvailableWaterMm, double noisePercentagePoints)
        {
            if (totalAvailableWaterMm <= 0) throw new ArgumentOutOfRangeException(nameof(totalAvailableWaterMm));
            var modelled = 100.0 * (1.0 - Math.Clamp(depletionMm, 0, totalAvailableWaterMm) / totalAvailableWaterMm);
            var boundedNoise = Math.Clamp(
                noisePercentagePoints, -MaximumNoisePercentagePoints, MaximumNoisePercentagePoints);
            return Math.Round(Math.Clamp(modelled + boundedNoise, 0, 100), 2);
        }

        // Deterministic noise makes a rerun reproducible and stays at or below 0.35 points.
        public static double NoiseFor(long zoneId, DateOnly day)
        {
            var seed = unchecked(zoneId * 397L + day.DayNumber * 17L);
            var unit = (Math.Abs(seed % 701L) / 700.0) * 2.0 - 1.0;
            return unit * MaximumNoisePercentagePoints;
        }
    }
}
