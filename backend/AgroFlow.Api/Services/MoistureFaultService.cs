using AgroFlow.Api.Ml;
using AgroFlow.Api.Services.Notifications;
using AgroFlow.Business;

namespace AgroFlow.Api.Services;

// Hourly fault checks on every zone with recent soil moisture readings: the two
// rules (pump ran but moisture did not rise; sensor unchanged) and the ML.NET
// spike/change-point checks. A finding becomes one open in-app alert per zone and a
// Telegram message to every farm member, always worded as "possible".
// Off unless Ml__FaultDetection__Enabled=true.
public sealed class MoistureFaultService : BackgroundService
{
    private static readonly TimeSpan Interval = TimeSpan.FromHours(1);
    private readonly MoistureMlController _controller;
    private readonly INotificationService _notifications;
    private readonly IConfiguration _configuration;
    private readonly ILogger<MoistureFaultService> _logger;

    public MoistureFaultService(
        MoistureMlController controller,
        INotificationService notifications,
        IConfiguration configuration,
        ILogger<MoistureFaultService> logger)
    {
        _controller = controller;
        _notifications = notifications;
        _configuration = configuration;
        _logger = logger;
    }

    private bool Enabled => bool.TryParse(_configuration["Ml:FaultDetection:Enabled"], out var on) && on;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!Enabled)
        {
            _logger.LogInformation("Moisture fault checks are off (Ml:FaultDetection:Enabled=false).");
            return;
        }

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await SweepAsync(DateTime.UtcNow, stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Moisture fault sweep failed; the next sweep will retry.");
            }

            try { await Task.Delay(Interval, stoppingToken); }
            catch (OperationCanceledException) { break; }
        }
    }

    public async Task SweepAsync(DateTime nowUtc, CancellationToken cancellationToken)
    {
        foreach (var zone in _controller.Data.GetActiveZones())
        {
            var samples = _controller.Samples(zone, nowUtc.AddDays(-7));
            var runs = _controller.Data.GetPumpRuns(zone.ZoneId, nowUtc.AddDays(-2));
            var rainDays = _controller.Data.GetRainDays(
                zone.FarmId, DateOnly.FromDateTime(nowUtc.AddDays(-7)), MoistureAnomalyDetector.RainExplainsMm);

            // The rise rule needs relative %; raw sensor units cannot say what "2 points" is.
            var rulesRuns = MoistureMlController.IsRelative(zone.CalibrationWet, zone.CalibrationDry)
                ? runs : new List<PumpRun>();
            var fault = MoistureFaultRules.Check(samples, rulesRuns, nowUtc)
                .Concat(MoistureAnomalyDetector.Detect(samples, runs, rainDays))
                .OrderByDescending(f => f.AtUtc)
                .FirstOrDefault();
            if (fault == null) continue;

            if (_controller.Data.InsertFaultAlert(zone.FarmId, zone.ZoneId, fault.Message))
            {
                _logger.LogInformation("Possible fault ({Kind}) flagged for zone {ZoneId}.", fault.Kind, zone.ZoneId);
                await _notifications.NotifyPossibleFaultAsync(zone.FarmId, zone.ZoneId, fault.Message, cancellationToken);
            }
        }
    }
}
