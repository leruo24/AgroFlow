#nullable enable
using System;

namespace AgroFlow.Business.Agronomy
{
    // Water volume per irrigation event.
    //
    // THERE IS NO FLOW METER ON ANY AGROFLOW NODE. Nothing in this system
    // measures litres. Volume is inferred from how long the pump ran and a
    // per-zone nominal flow rate that someone typed in:
    //
    //     litres = runtime_seconds / 60 * flow_rate_lpm
    //
    // That makes every figure this class produces an ESTIMATE, and the type
    // system is used to keep it labelled as one: the result carries
    // IsEstimate = true and a Basis string, so a caller cannot accidentally
    // render it as a measurement. Do not add a code path that returns a bare
    // double - the labelling is the point.
    //
    // Real accuracy is bounded by things nobody here measures: pump wear, line
    // pressure, emitter clogging, head differences between zones. Treat the
    // number as an order-of-magnitude planning figure, not a billing figure.
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
        // A pump running longer than this in one event is almost certainly a
        // stuck valve or a bad payload rather than a real cycle. Callers use
        // this to bound-check before persisting; see IrrigationEventEndpoints.
        public const int MaxPlausibleRuntimeSeconds = 6 * 60 * 60; // 6 hours

        // Litres for one irrigation event. Returns null when the zone has no
        // flow rate configured - an unconfigured zone must not silently fall
        // back to a guessed default rate, exactly as an unset moisture
        // threshold must never trigger irrigation.
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
