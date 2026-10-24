using AgroFlow.Business;
using AgroFlow.Api.Services.Notifications;

namespace AgroFlow.Api.Services;

// A periodic estimate check catches pump runs that happen after the last app load.
// It creates one open in-app alert and sends one Telegram message per low episode.
public sealed class TankLowMonitorService : BackgroundService
{
    private static readonly TimeSpan Interval = TimeSpan.FromMinutes(15);
    private readonly TankPhController _controller;
    private readonly INotificationService _notifications;
    private readonly ILogger<TankLowMonitorService> _logger;

    public TankLowMonitorService(
        TankPhController controller,
        INotificationService notifications,
        ILogger<TankLowMonitorService> logger)
    {
        _controller = controller;
        _notifications = notifications;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                foreach (var farmId in _controller.GetConfiguredFarmIds())
                    await CheckFarmAsync(farmId, stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Tank level estimate sweep failed; the next sweep will retry.");
            }

            await Task.Delay(Interval, stoppingToken);
        }
    }

    public async Task CheckFarmAsync(long farmId, CancellationToken cancellationToken)
    {
        var status = _controller.GetTank(farmId);
        if (status?.EstimatedRemainingLitres is null) return;
        var created = _controller.SetLowAlert(farmId, status.IsLow);
        if (created)
            await _notifications.NotifyTankLowAsync(farmId, cancellationToken);
    }
}
