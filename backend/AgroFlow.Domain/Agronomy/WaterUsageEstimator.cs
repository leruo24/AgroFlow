#nullable enable
using System;

namespace AgroFlow.Business.Agronomy
{
    // Water volume per irrigation event.
    // There is no flow meter on any AgroFlow node. Volume is inferred from pump run time
    // and the zone's nominal flow rate:
    //
    //     litres = runtime_seconds / 60 * flow_rate_lpm
    //
    // So every figure is an estimate, and the result carries IsEstimate = true and a
    // Basis string so it is never shown as a measurement. Do not add a path that returns
    // a bare double.
    // Accuracy also depends on pump wear, pressure and clogging, so treat it as a
    // planning figure, not a billing figure.
    public sealed class WaterVolumeEstimate
    {
        public double Litres { get; }
        public bool IsEstimate { get { return true; } }
        public string Basis { get; }

        internal WaterVolumeEstimate(double litres, string basis)
        {
            Litres = litres;
            Basis = basis;
        }

        public override string ToString()
        {
            return Fao56Knowledge.Format(Litres, 1) + " L (estimated - " + Basis + ")";
        }
    }

    public static class WaterUsageEstimator
    {
        // A run longer than this in one event is almost certainly a stuck valve or a bad
        // payload. Callers check it before saving (see IrrigationEventEndpoints).
        public const int MaxPlausibleRuntimeSeconds = 6 * 60 * 60; // 6 hours

        // Litres for one irrigation event. Null when the zone has no flow rate: an
        // unconfigured zone never falls back to a guessed rate, just as an unset moisture
        // threshold never triggers irrigation.
        public static WaterVolumeEstimate? EstimateEventLitres(int runtimeSeconds, double? flowRateLitresPerMinute)
        {
            if (runtimeSeconds < 0)
            {
                throw new ArgumentOutOfRangeException(
                    nameof(runtimeSeconds), runtimeSeconds, "Runtime cannot be negative.");
            }

            if (!flowRateLitresPerMinute.HasValue) return null;

            if (flowRateLitresPerMinute.Value < 0)
            {
                throw new ArgumentOutOfRangeException(
                    nameof(flowRateLitresPerMinute), flowRateLitresPerMinute.Value, "Flow rate cannot be negative.");
            }

            var litres = runtimeSeconds / 60.0 * flowRateLitresPerMinute.Value;

            return new WaterVolumeEstimate(
                litres,
                runtimeSeconds + " s at a configured " + Fao56Knowledge.Format(flowRateLitresPerMinute.Value, 1) +
                " L/min; no flow meter is fitted, so this is inferred, not measured");
        }

        public static bool IsPlausibleRuntime(int runtimeSeconds)
        {
            return runtimeSeconds >= 0 && runtimeSeconds <= MaxPlausibleRuntimeSeconds;
        }

        // Converts an ETc figure (mm/day) into the litres that depth represents
        // over a zone of a given area, so advice can say "about N litres" as
        // well as "N mm". 1 mm over 1 hectare is exactly 10 000 litres.
        public static double MillimetresToLitres(double millimetres, double areaHectares)
        {
            if (millimetres < 0) throw new ArgumentOutOfRangeException(nameof(millimetres));
            if (areaHectares < 0) throw new ArgumentOutOfRangeException(nameof(areaHectares));
            return millimetres * areaHectares * 10000.0;
        }
    }
}
