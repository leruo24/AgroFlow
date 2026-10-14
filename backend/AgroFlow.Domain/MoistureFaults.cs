#nullable enable
using System;
using System.Collections.Generic;
using System.Linq;

namespace AgroFlow.Business
{
    // One soil moisture reading for the fault checks, in relative % when the zone's
    // calibration allows it, otherwise in the sensor's own units.
    public sealed class MoistureSample
    {
        public DateTime AtUtc { get; set; }
        public double Value { get; set; }
    }

    // One pump run from irrigation_event.
    public sealed class PumpRun
    {
        public DateTime StartedAtUtc { get; set; }
        public int DurationSeconds { get; set; }
    }

    public enum MoistureFaultKind
    {
        PumpRanMoistureDidNotRise,
        SensorUnchanged,
        MoistureSpike,
        MoistureChangePoint,
    }

    public sealed class MoistureFault
    {
        public MoistureFaultKind Kind { get; set; }
        public DateTime AtUtc { get; set; }
        public string Detail { get; set; } = string.Empty;

        // The alert text: always "possible", never a certainty.
        public string Message => MoistureFaultRules.MessagePrefix + " " + Detail;
    }

    // The two rule-based fault checks. The machine learning checks (spike and
    // change-point) live in AgroFlow.Api/Ml because they need ML.NET.
    public static class MoistureFaultRules
    {
        public const string MessagePrefix = "Possible sensor or water supply problem — please check.";

        // After a pump run, moisture should rise by at least this many percentage
        // points within RiseWindowMinutes of the run ending.
        public const int RiseWindowMinutes = 60;
        public const double MinRisePercentagePoints = 2.0;

        // Runs shorter than this may not wet the soil around the probe, so they are not judged.
        public const int MinJudgedRunSeconds = 120;

        // A sensor that reports the same value for this long, over at least
        // MinUnchangedSamples readings, is probably stuck.
        public const int UnchangedHours = 12;
        public const int MinUnchangedSamples = 4;
        public const double UnchangedTolerance = 0.05;

        // Null when there are not enough readings around the run to judge it.
        public static bool? PumpRanButMoistureDidNotRise(
            IReadOnlyList<MoistureSample> samples, PumpRun run,
            int windowMinutes = RiseWindowMinutes, double minRise = MinRisePercentagePoints)
        {
            if (run.DurationSeconds < MinJudgedRunSeconds) return null;
            var start = run.StartedAtUtc;
            var end = start.AddSeconds(run.DurationSeconds);
            var windowEnd = end.AddMinutes(windowMinutes);

            var before = samples.Where(s => s.AtUtc <= start).OrderBy(s => s.AtUtc).LastOrDefault();
            var after = samples.Where(s => s.AtUtc > start && s.AtUtc <= windowEnd).ToList();
            if (before == null || after.Count == 0) return null;

            // Only judge once the whole window has readings in it, so a run that has
            // just finished is not flagged before the water has had time to soak in.
            if (!samples.Any(s => s.AtUtc >= end.AddMinutes(windowMinutes / 2.0))) return null;

            return after.Max(s => s.Value) - before.Value < minRise;
        }

        // True when every reading over the last `hours` is the same value.
        public static bool SensorUnchanged(
            IReadOnlyList<MoistureSample> samples, DateTime nowUtc,
            int hours = UnchangedHours, int minSamples = MinUnchangedSamples, double tolerance = UnchangedTolerance)
        {
            var from = nowUtc.AddHours(-hours);
            var recent = samples.Where(s => s.AtUtc >= from && s.AtUtc <= nowUtc).OrderBy(s => s.AtUtc).ToList();
            if (recent.Count < minSamples) return false;

            // The readings must actually cover the period, not arrive in one burst.
            if ((recent[recent.Count - 1].AtUtc - recent[0].AtUtc).TotalHours < hours * 0.75) return false;

            var min = recent.Min(s => s.Value);
            var max = recent.Max(s => s.Value);
            return max - min <= tolerance;
        }

        // Both rule checks for one zone, newest problem first.
        public static List<MoistureFault> Check(
            IReadOnlyList<MoistureSample> samples, IReadOnlyList<PumpRun> runs, DateTime nowUtc)
        {
            var faults = new List<MoistureFault>();

            foreach (var run in runs.OrderByDescending(r => r.StartedAtUtc))
            {
                if (PumpRanButMoistureDidNotRise(samples, run) == true)
                {
                    faults.Add(new MoistureFault
                    {
                        Kind = MoistureFaultKind.PumpRanMoistureDidNotRise,
                        AtUtc = run.StartedAtUtc,
                        Detail = "The pump ran for " + Math.Max(1, run.DurationSeconds / 60)
                                 + " minutes but soil moisture did not rise within " + RiseWindowMinutes + " minutes.",
                    });
                    break;
                }
            }

            if (SensorUnchanged(samples, nowUtc))
            {
                faults.Add(new MoistureFault
                {
                    Kind = MoistureFaultKind.SensorUnchanged,
                    AtUtc = nowUtc,
                    Detail = "The soil moisture reading has not changed for " + UnchangedHours + " hours.",
                });
            }

            return faults;
        }
    }
}
