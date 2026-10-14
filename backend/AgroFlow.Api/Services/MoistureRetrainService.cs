using System.Text.Json;
using AgroFlow.Api.Ml;
using AgroFlow.Business;

namespace AgroFlow.Api.Services;

// Weekly retrain of the forecast model from the database (simulated farms' readings
// plus real readings, each marked). Off unless Ml__Retrain__Enabled=true.
// The new model is written to Ml:ModelPath with its evaluation and used at once.
public sealed class MoistureRetrainService : BackgroundService
{
    public const int MinExamples = 200;
    private static readonly TimeSpan Interval = TimeSpan.FromDays(7);

    private readonly MoistureMlController _controller;
    private readonly MoistureForecaster _forecaster;
    private readonly IConfiguration _configuration;
    private readonly ILogger<MoistureRetrainService> _logger;

    public MoistureRetrainService(
        MoistureMlController controller,
        MoistureForecaster forecaster,
        IConfiguration configuration,
        ILogger<MoistureRetrainService> logger)
    {
        _controller = controller;
        _forecaster = forecaster;
        _configuration = configuration;
        _logger = logger;
    }

    private bool Enabled => bool.TryParse(_configuration["Ml:Retrain:Enabled"], out var on) && on;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!Enabled)
        {
            _logger.LogInformation("Weekly forecast model retraining is off (Ml:Retrain:Enabled=false).");
            return;
        }

        while (!stoppingToken.IsCancellationRequested)
        {
            try { RetrainOnce(); }
            catch (Exception ex) { _logger.LogWarning(ex, "Forecast model retraining failed; the current model stays."); }

            try { await Task.Delay(Interval, stoppingToken); }
            catch (OperationCanceledException) { break; }
        }
    }

    public bool RetrainOnce()
    {
        var path = _forecaster.ModelPath;
        if (string.IsNullOrWhiteSpace(path))
        {
            _logger.LogWarning("Ml:ModelPath is not set, so a retrained model has nowhere to go; skipped.");
            return false;
        }

        var sources = new List<string>();
        var examples = MoistureTrainingData.FromDatabase(_controller, sources);
        if (examples.Count < MinExamples)
        {
            _logger.LogInformation("Only {Count} examples in the database (need {Min}); the current model stays.",
                examples.Count, MinExamples);
            return false;
        }

        var (model, report) = MoistureModel.TrainAndEvaluate(examples, sources);
        MoistureModel.Save(model, path);
        File.WriteAllText(Path.Combine(Path.GetDirectoryName(Path.GetFullPath(path))!, "moisture-model-evaluation.json"),
            JsonSerializer.Serialize(report, MoistureModelTrainingCommand.Json));
        _forecaster.Replace(model, report);
        _logger.LogInformation(
            "Forecast model retrained on {Total} examples ({Real} real): MAE {Mae:F2}, FAO-56 baseline MAE {BaseMae:F2}.",
            report.ExamplesTotal, report.ExamplesReal, report.Model.Mae, report.Fao56Baseline.Mae);
        return true;
    }
}
