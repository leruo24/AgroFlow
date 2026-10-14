using System.Text.Json;
using AgroFlow.Business;
using Microsoft.ML;

namespace AgroFlow.Api.Ml;

// Holds the trained forecast model. Loads Ml:ModelPath when that file exists (a
// retrained model), otherwise the model built into the assembly. Ml:Forecast:Enabled
// = false unloads it, which hides the forecast line everywhere.
public sealed class MoistureForecaster
{
    private const string ModelResource = "AgroFlow.Api.Ml.moisture-model.zip";
    private const string ReportResource = "AgroFlow.Api.Ml.moisture-model-evaluation.json";

    private readonly MLContext _ml = new(seed: MoistureModel.Seed);
    private readonly ILogger<MoistureForecaster> _logger;
    private readonly object _gate = new();
    private PredictionEngine<MoistureModelInput, MoistureModelOutput>? _engine;

    public MoistureForecaster(IConfiguration configuration, ILogger<MoistureForecaster> logger)
    {
        _logger = logger;
        ModelPath = configuration["Ml:ModelPath"];
        var enabled = !bool.TryParse(configuration["Ml:Forecast:Enabled"], out var on) || on;
        if (enabled) Load();
        else _logger.LogInformation("Moisture forecast (machine learning model) is off (Ml:Forecast:Enabled=false).");
    }

    public string? ModelPath { get; }
    public bool IsLoaded { get { lock (_gate) return _engine != null; } }
    public MoistureTrainingReport? Report { get; private set; }

    public double? Predict(MoistureForecastFeatures features)
    {
        lock (_gate)
        {
            // PredictionEngine is not thread-safe, hence the lock.
            return _engine == null ? null : _engine.Predict(MoistureModel.ToInput(features)).Score;
        }
    }

    public void Replace(ITransformer model, MoistureTrainingReport report)
    {
        lock (_gate)
        {
            _engine = _ml.Model.CreatePredictionEngine<MoistureModelInput, MoistureModelOutput>(model);
            Report = report;
        }
    }

    private void Load()
    {
        try
        {
            ITransformer model;
            if (!string.IsNullOrWhiteSpace(ModelPath) && File.Exists(ModelPath))
            {
                model = _ml.Model.Load(ModelPath, out _);
                var reportPath = Path.Combine(Path.GetDirectoryName(ModelPath)!, "moisture-model-evaluation.json");
                if (File.Exists(reportPath)) Report = JsonSerializer.Deserialize<MoistureTrainingReport>(File.ReadAllText(reportPath));
            }
            else
            {
                var assembly = typeof(MoistureForecaster).Assembly;
                using var stream = assembly.GetManifestResourceStream(ModelResource);
                if (stream == null)
                {
                    _logger.LogWarning("No moisture forecast model found; the forecast line stays hidden.");
                    return;
                }
                model = _ml.Model.Load(stream, out _);
                using var reportStream = assembly.GetManifestResourceStream(ReportResource);
                if (reportStream != null) Report = JsonSerializer.Deserialize<MoistureTrainingReport>(reportStream);
            }

            lock (_gate) _engine = _ml.Model.CreatePredictionEngine<MoistureModelInput, MoistureModelOutput>(model);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Moisture forecast model could not be loaded; the forecast line stays hidden.");
        }
    }
}
