using AgroFlow.Business;

namespace AgroFlow.Api.Services;

// Optional demonstration data generator. It reads the existing FAO-56 balance,
// which is based on real Open-Meteo weather, and writes a labelled soil-moisture
// reading. It never calls SensorReadingProcessor, MQTT or irrigation_commands.
public sealed class SimulationService : BackgroundService
{
    private readonly SimulationController _controller;
    private readonly IConfiguration _configuration;
    private readonly ILogger<SimulationService> _logger;

    public SimulationService(
        SimulationController controller,
        IConfiguration configuration,
        ILogger<SimulationService> logger)
    {
        _controller = controller;
        _configuration = configuration;
        _logger = logger;
    }

    private bool Enabled => bool.TryParse(_configuration["Simulation:Enabled"], out var enabled) && enabled;
    private TimeSpan Interval => TimeSpan.FromHours(
        double.TryParse(_configuration["Simulation:IntervalHours"], out var hours) && hours > 0 ? hours : 6);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!Enabled)
        {
            _logger.LogInformation("Simulated farm readings are disabled (Simulation:Enabled=false).");
            return;
        }

        _logger.LogWarning("Simulated farm readings are enabled; every generated row is labelled Simulated.");
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                RunOnce(DateTimeOffset.UtcNow);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Simulated reading cycle failed; the next cycle will retry.");
            }

            try { await Task.Delay(Interval, stoppingToken); }
            catch (OperationCanceledException) { break; }
        }
    }

    internal int RunOnce(DateTimeOffset now)
    {
        var day = DateOnly.FromDateTime(now.UtcDateTime.AddHours(2));
        var written = 0;
        foreach (var target in _controller.Targets(day))
        {
            if (_controller.Write(target, now)) written++;
        }
        _logger.LogInformation("Simulated reading cycle wrote {Count} labelled rows for {Day}.", written, day);
        return written;
    }
}
