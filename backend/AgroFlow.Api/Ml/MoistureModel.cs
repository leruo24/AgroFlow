using AgroFlow.Business;
using Microsoft.ML;
using Microsoft.ML.Data;

namespace AgroFlow.Api.Ml;

// The row ML.NET trains on. Field names are the model's column names, so renaming
// one breaks every saved model.
public sealed class MoistureModelInput
{
    public float CurrentMoisturePct { get; set; }
    public float HoursSinceIrrigation { get; set; }
    public float TMaxC { get; set; }
    public float TMinC { get; set; }
    public float HumidityPct { get; set; }
    public float ForecastRainMm { get; set; }
    public float EtoNextMm { get; set; }
    public string SoilType { get; set; } = "loam";
    public string CropStage { get; set; } = "PeakGrowth";
    public float Label { get; set; }
}

public sealed class MoistureModelOutput
{
    [ColumnName("Score")]
    public float Score { get; set; }
}

public sealed class RegressionScore
{
    public int Count { get; set; }
    public double Mae { get; set; }
    public double RSquared { get; set; }
}

// What a training run measured. Saved next to the model as JSON and copied into
// docs/ml-evaluation.md; nothing in it is estimated.
public sealed class MoistureTrainingReport
{
    public DateTime TrainedAtUtc { get; set; }
    public string Trainer { get; set; } = "FastTree regression (ML.NET 4.0.3)";
    public int Seed { get; set; }
    public int ExamplesTotal { get; set; }
    public int ExamplesSimulated { get; set; }
    public int ExamplesReal { get; set; }
    public int TrainCount { get; set; }
    public int TestCount { get; set; }
    public int TestSimulated { get; set; }
    public int TestReal { get; set; }
    public DateOnly TestFromDay { get; set; }
    public List<string> Sources { get; set; } = new();
    public RegressionScore Model { get; set; } = new();
    public RegressionScore Fao56Baseline { get; set; } = new();
    public RegressionScore Persistence { get; set; } = new();
    public RegressionScore? ModelOnRealOnly { get; set; }
    public RegressionScore? Fao56BaselineOnRealOnly { get; set; }

    public bool TrainedOnSimulatedOnly => ExamplesReal == 0;
}

public static class MoistureModel
{
    public const int Seed = 20261014;
    public const double TestFraction = 0.2;

    public static MoistureModelInput ToInput(MoistureForecastFeatures f, double label = 0) => new()
    {
        CurrentMoisturePct = (float)f.CurrentMoisturePct,
        HoursSinceIrrigation = (float)f.HoursSinceIrrigation,
        TMaxC = (float)f.TMaxC,
        TMinC = (float)f.TMinC,
        HumidityPct = (float)f.HumidityPct,
        ForecastRainMm = (float)f.ForecastRainMm,
        EtoNextMm = (float)f.EtoNextMm,
        SoilType = f.SoilType,
        CropStage = f.CropStage,
        Label = (float)label,
    };

    public static ITransformer Train(MLContext ml, IEnumerable<MoistureExample> examples)
    {
        var data = ml.Data.LoadFromEnumerable(examples.Select(e => ToInput(e.Features, e.LabelMoisturePct)));
        var pipeline = ml.Transforms.Categorical.OneHotEncoding("SoilTypeEncoded", nameof(MoistureModelInput.SoilType))
            .Append(ml.Transforms.Categorical.OneHotEncoding("CropStageEncoded", nameof(MoistureModelInput.CropStage)))
            .Append(ml.Transforms.Concatenate("Features",
                nameof(MoistureModelInput.CurrentMoisturePct),
                nameof(MoistureModelInput.HoursSinceIrrigation),
                nameof(MoistureModelInput.TMaxC),
                nameof(MoistureModelInput.TMinC),
                nameof(MoistureModelInput.HumidityPct),
                nameof(MoistureModelInput.ForecastRainMm),
                nameof(MoistureModelInput.EtoNextMm),
                "SoilTypeEncoded",
                "CropStageEncoded"))
            .Append(ml.Regression.Trainers.FastTree(
                labelColumnName: nameof(MoistureModelInput.Label),
                featureColumnName: "Features",
                numberOfLeaves: 20,
                numberOfTrees: 200,
                minimumExampleCountPerLeaf: 10,
                learningRate: 0.1));
        return pipeline.Fit(data);
    }

    // Held-out set by date, not at random: the last 20% of days are never seen in
    // training, so the score is for days the model has not learned from.
    public static (List<MoistureExample> Train, List<MoistureExample> Test, DateOnly TestFrom) SplitByDate(
        IReadOnlyList<MoistureExample> examples, double testFraction = TestFraction)
    {
        var days = examples.Select(e => e.Day).Distinct().OrderBy(d => d).ToList();
        if (days.Count < 2) throw new InvalidOperationException("Need at least two days of examples to hold some out.");
        var testFrom = days[(int)Math.Floor(days.Count * (1 - testFraction))];
        return (examples.Where(e => e.Day < testFrom).ToList(), examples.Where(e => e.Day >= testFrom).ToList(), testFrom);
    }

    public static List<double> Predict(MLContext ml, ITransformer model, IEnumerable<MoistureExample> examples)
    {
        var data = ml.Data.LoadFromEnumerable(examples.Select(e => ToInput(e.Features, e.LabelMoisturePct)));
        return ml.Data.CreateEnumerable<MoistureModelOutput>(model.Transform(data), reuseRowObject: false)
            .Select(o => (double)o.Score).ToList();
    }

    // MAE and R² (1 - SS_res / SS_tot), the same formula for the model and every baseline.
    public static RegressionScore Score(IReadOnlyList<double> labels, IReadOnlyList<double> predictions)
    {
        if (labels.Count != predictions.Count) throw new ArgumentException("Label and prediction counts differ.");
        if (labels.Count == 0) return new RegressionScore();
        var mean = labels.Average();
        double abs = 0, ssRes = 0, ssTot = 0;
        for (var i = 0; i < labels.Count; i++)
        {
            var error = labels[i] - predictions[i];
            abs += Math.Abs(error);
            ssRes += error * error;
            ssTot += (labels[i] - mean) * (labels[i] - mean);
        }
        return new RegressionScore
        {
            Count = labels.Count,
            Mae = abs / labels.Count,
            RSquared = ssTot > 0 ? 1 - ssRes / ssTot : 0,
        };
    }

    public static (ITransformer Model, MoistureTrainingReport Report) TrainAndEvaluate(
        IReadOnlyList<MoistureExample> examples, IEnumerable<string> sources)
    {
        var ml = new MLContext(seed: Seed);
        var (train, test, testFrom) = SplitByDate(examples);
        var model = Train(ml, train);

        var report = new MoistureTrainingReport
        {
            TrainedAtUtc = DateTime.UtcNow,
            Seed = Seed,
            ExamplesTotal = examples.Count,
            ExamplesSimulated = examples.Count(e => e.Simulated),
            ExamplesReal = examples.Count(e => !e.Simulated),
            TrainCount = train.Count,
            TestCount = test.Count,
            TestSimulated = test.Count(e => e.Simulated),
            TestReal = test.Count(e => !e.Simulated),
            TestFromDay = testFrom,
            Sources = sources.ToList(),
        };

        var labels = test.Select(e => e.LabelMoisturePct).ToList();
        report.Model = Score(labels, Predict(ml, model, test));
        report.Fao56Baseline = Score(labels, test.Select(e => e.BaselineMoisturePct).ToList());
        report.Persistence = Score(labels, test.Select(e => e.Features.CurrentMoisturePct).ToList());

        var real = test.Where(e => !e.Simulated).ToList();
        if (real.Count > 0)
        {
            var realLabels = real.Select(e => e.LabelMoisturePct).ToList();
            report.ModelOnRealOnly = Score(realLabels, Predict(ml, model, real));
            report.Fao56BaselineOnRealOnly = Score(realLabels, real.Select(e => e.BaselineMoisturePct).ToList());
        }

        return (model, report);
    }

    public static void Save(ITransformer model, string path)
    {
        var ml = new MLContext(seed: Seed);
        var schema = ml.Data.LoadFromEnumerable(new List<MoistureModelInput>()).Schema;
        Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(path))!);
        ml.Model.Save(model, schema, path);
    }
}
