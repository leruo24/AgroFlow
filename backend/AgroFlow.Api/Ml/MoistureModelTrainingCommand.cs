using System.Text.Json;
using AgroFlow.Business;

namespace AgroFlow.Api.Ml;

// Retrains the forecast model from the command line:
//
//   dotnet run --project backend/AgroFlow.Api -- train-moisture-model
//       [--out backend/AgroFlow.Api/Ml/moisture-model.zip]
//       [--weather-dir backend/AgroFlow.Api/Ml/training-weather]
//       [--no-db]
//
// Writes the model and moisture-model-evaluation.json side by side. Database rows
// are added when ConnectionStrings:Supabase connects; if it does not, the run says
// so and trains on the simulated weather files alone.
public static class MoistureModelTrainingCommand
{
    public const string Name = "train-moisture-model";

    public static readonly JsonSerializerOptions Json = new() { WriteIndented = true };

    public static int Run(string[] args, IConfiguration configuration)
    {
        string Option(string name, string fallback)
        {
            var i = Array.IndexOf(args, name);
            return i >= 0 && i + 1 < args.Length ? args[i + 1] : fallback;
        }

        var mlDir = Path.Combine(ProjectDirectory(), "Ml");
        var outPath = Option("--out", Path.Combine(mlDir, "moisture-model.zip"));
        var weatherDir = Option("--weather-dir", Path.Combine(mlDir, "training-weather"));
        var sources = new List<string>();

        var examples = MoistureTrainingData.SimulatedFromWeatherFiles(weatherDir, sources);

        if (!args.Contains("--no-db"))
        {
            var connectionString = configuration.GetConnectionString("Supabase");
            if (string.IsNullOrWhiteSpace(connectionString))
            {
                sources.Add("Database: not configured, so no real readings were used");
            }
            else
            {
                try
                {
                    examples.AddRange(MoistureTrainingData.FromDatabase(new MoistureMlController(connectionString), sources));
                }
                catch (Exception ex)
                {
                    // The message only: a connection error must never echo the connection string.
                    sources.Add("Database: could not be read (" + ex.GetType().Name + "), so no real readings were used");
                }
            }
        }

        var (model, report) = MoistureModel.TrainAndEvaluate(examples, sources);
        MoistureModel.Save(model, outPath);
        var reportPath = Path.Combine(Path.GetDirectoryName(Path.GetFullPath(outPath))!, "moisture-model-evaluation.json");
        File.WriteAllText(reportPath, JsonSerializer.Serialize(report, Json));

        Console.WriteLine($"Model: {Path.GetFullPath(outPath)}");
        Console.WriteLine($"Evaluation: {reportPath}");
        foreach (var source in sources) Console.WriteLine("  " + source);
        Console.WriteLine($"Examples {report.ExamplesTotal} (simulated {report.ExamplesSimulated}, real {report.ExamplesReal}); "
                          + $"train {report.TrainCount}, test {report.TestCount} from {report.TestFromDay:yyyy-MM-dd}");
        Console.WriteLine($"Model         MAE {report.Model.Mae:F3}  R² {report.Model.RSquared:F4}");
        Console.WriteLine($"FAO-56 alone  MAE {report.Fao56Baseline.Mae:F3}  R² {report.Fao56Baseline.RSquared:F4}");
        Console.WriteLine($"No change     MAE {report.Persistence.Mae:F3}  R² {report.Persistence.RSquared:F4}");
        return 0;
    }

    // backend/AgroFlow.Api, found by walking up from the build output, so the command
    // works from any working directory.
    private static string ProjectDirectory()
    {
        for (var dir = new DirectoryInfo(AppContext.BaseDirectory); dir != null; dir = dir.Parent)
            if (File.Exists(Path.Combine(dir.FullName, "AgroFlow.Api.csproj"))) return dir.FullName;
        return Directory.GetCurrentDirectory();
    }
}
