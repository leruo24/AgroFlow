namespace AgroFlow.Api.Services;

// Runs WeatherBackfillService once, when configured. A backfill is a one-off, so
// this is a trigger, not a schedule.
// To run it: set Weather__BackfillDays on Railway (e.g. 90) and redeploy. On the next
// start it runs once for every farm with coordinates, then does nothing more.
// Remove the variable afterwards, or every redeploy runs it again (harmless thanks
// to the (farm_id, date) upsert, but thousands of wasted requests to a free service).
// A BackgroundService instead of awaiting it in Program.cs, so the API is already
// serving (and passing Railway's health checks) while the backfill runs.
public class WeatherBackfillStartupService : BackgroundService
{
    private readonly WeatherBackfillService _backfill;
    private readonly IConfiguration _configuration;
    private readonly IHostApplicationLifetime _lifetime;
    private readonly ILogger<WeatherBackfillStartupService> _logger;

    public WeatherBackfillStartupService(
        WeatherBackfillService backfill,
        IConfiguration configuration,
        IHostApplicationLifetime lifetime,
        ILogger<WeatherBackfillStartupService> logger)
    {
        _backfill = backfill;
        _configuration = configuration;
        _lifetime = lifetime;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        // Unset, unparseable or not positive all mean "not requested", and we log nothing
        // so the normal start-up log stays clean.
        var raw = _configuration["Weather:BackfillDays"];
        if (string.IsNullOrWhiteSpace(raw))
        {
            return;
        }

        if (!int.TryParse(raw, out var days) || days <= 0)
        {
            _logger.LogWarning(
                "Weather:BackfillDays is set to '{Raw}', which is not a positive whole number of days. " +
                "Skipping the historical backfill.",
                raw);
            return;
        }

        // Let the app finish starting first, so the backfill does not compete for the
        // connection pool while Railway checks the container.
        try
        {
            var started = new TaskCompletionSource();
            using var registration = _lifetime.ApplicationStarted.Register(() => started.TrySetResult());
            await started.Task.WaitAsync(stoppingToken);
        }
        catch (OperationCanceledException)
        {
            return;
        }

        var end = DateOnly.FromDateTime(DateTime.UtcNow);
        var start = end.AddDays(-days);

        _logger.LogInformation(
            "Weather backfill requested via Weather:BackfillDays={Days}. Backfilling {Start}..{End} for every farm " +
            "with coordinates, from the Open-Meteo archive (ERA5). The API is already serving requests; this runs " +
            "in the background. REMEMBER TO REMOVE Weather__BackfillDays once this finishes, or it re-runs on every deploy.",
            days, start, end);

        var startedAt = DateTime.UtcNow;

        // Nothing may escape: an unhandled exception in ExecuteAsync stops the whole host
        // by default, turning an optional backfill into a dead API. RunForAllFarmsAsync
        // already handles per-farm failures; this catches structural ones (e.g. no
        // weather_daily table).
        try
        {
            var rows = await _backfill.RunForAllFarmsAsync(start, end, stoppingToken);

            _logger.LogInformation(
                "Weather backfill finished: {Rows} rows written across all farms in {Seconds:F1}s. " +
                "Now REMOVE the Weather__BackfillDays variable on Railway so the next redeploy does not repeat this.",
                rows, (DateTime.UtcNow - startedAt).TotalSeconds);
        }
        catch (OperationCanceledException)
        {
            _logger.LogInformation("Weather backfill cancelled during shutdown; partial results are already committed.");
        }
        catch (Exception ex)
        {
            _logger.LogError(ex,
                "Weather backfill failed. The API is unaffected and normal weather collection continues. " +
                "If this is a missing weather_daily table, apply migration 0016 and redeploy.");
        }
    }
}
