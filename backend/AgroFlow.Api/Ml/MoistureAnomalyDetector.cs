using AgroFlow.Business;
using Microsoft.ML;
using Microsoft.ML.Data;

namespace AgroFlow.Api.Ml;

// ML.NET time-series anomaly detection on one zone's soil moisture: IID spike
// (a single odd reading) and IID change-point (the level suddenly shifts and stays).
// Jumps that watering or rain explain are ignored, and only the latest readings are
// judged so an old anomaly does not alert again.
public static class MoistureAnomalyDetector
{
    public const int MinPoints = 12;
    public const double Confidence = 95;
    public const int RecentPoints = 3;
    public const int HoursExplainedByWatering = 6;
    public const double RainExplainsMm = 2;

    private sealed class Point
    {
        public float Value { get; set; }
    }

    private sealed class SpikeRow
    {
        // [alert, raw score, p-value]
        [VectorType(3)] public double[] Spike { get; set; } = Array.Empty<double>();
    }

    private sealed class ChangePointRow
    {
        // [alert, raw score, p-value, martingale value]
        [VectorType(4)] public double[] ChangePoint { get; set; } = Array.Empty<double>();
    }

    // Smaller moves than this are ordinary drying, sensor wobble or rounding, whatever
    // the detector says.
    public const double MinJumpPoints = 5;

    public static List<MoistureFault> Detect(
        IReadOnlyList<MoistureSample> samples, IReadOnlyList<PumpRun> runs, ISet<DateOnly> rainDays)
    {
        var ordered = samples.OrderBy(s => s.AtUtc).ToList();
        if (ordered.Count < MinPoints) return new List<MoistureFault>();

        var ml = new MLContext(seed: MoistureModel.Seed);
        var history = Math.Max(4, ordered.Count / 4);

        // Spikes are looked for in the change between readings, not the level: soil
        // that is steadily drying is a trend, and the IID detector would otherwise flag
        // its newest (lowest) reading.
        var steps = ordered.Skip(1).Select((s, i) => new Point { Value = (float)(s.Value - ordered[i].Value) }).ToList();
        var spikes = Run<SpikeRow>(ml, steps, ml.Transforms.DetectIidSpike("Spike", nameof(Point.Value), Confidence, history));
        var changes = Run<ChangePointRow>(ml, ordered.Select(s => new Point { Value = (float)s.Value }).ToList(),
            ml.Transforms.DetectIidChangePoint("ChangePoint", nameof(Point.Value), Confidence, history));

        var faults = new List<MoistureFault>();
        for (var i = Math.Max(1, ordered.Count - RecentPoints); i < ordered.Count; i++)
        {
            var at = ordered[i].AtUtc;
            if (Explained(at, runs, rainDays)) continue;

            var step = steps[i - 1].Value;
            if (spikes[i - 1].Spike[0] > 0 && Math.Abs(step) >= MinJumpPoints)
            {
                faults.Add(new MoistureFault
                {
                    Kind = MoistureFaultKind.MoistureSpike,
                    AtUtc = at,
                    Detail = "A soil moisture reading jumped suddenly, with no watering or rain to explain it.",
                });
            }

            // A change-point counts only if the latest readings really sit at a new level.
            var before = ordered.Take(i).TakeLast(history).Average(s => s.Value);
            var after = ordered.Skip(i).Average(s => s.Value);
            if (changes[i].ChangePoint[0] > 0 && Math.Abs(after - before) >= MinJumpPoints)
            {
                faults.Add(new MoistureFault
                {
                    Kind = MoistureFaultKind.MoistureChangePoint,
                    AtUtc = at,
                    Detail = "Soil moisture suddenly moved to a new level, with no watering or rain to explain it.",
                });
            }
        }
        return faults;
    }

    private static List<T> Run<T>(MLContext ml, List<Point> points, IEstimator<ITransformer> detector)
        where T : class, new()
    {
        var data = ml.Data.LoadFromEnumerable(points);
        return ml.Data.CreateEnumerable<T>(detector.Fit(data).Transform(data), reuseRowObject: false).ToList();
    }

    private static bool Explained(DateTime atUtc, IReadOnlyList<PumpRun> runs, ISet<DateOnly> rainDays)
    {
        if (runs.Any(r => atUtc >= r.StartedAtUtc && atUtc <= r.StartedAtUtc.AddHours(HoursExplainedByWatering)))
            return true;
        return rainDays.Contains(DateOnly.FromDateTime(atUtc.AddHours(2)));
    }
}
