namespace AgroFlow.Api.Services;

// Config-triggered one-shot runner for WeatherBackfillService.
//
// WeatherBackfillService knows how to pull ERA5 history out of Open-Meteo's
// archive endpoint, but nothing ever called it - it was written under a brief
// that said "write the routine, do not run it", because weather_daily did not
// exist in the live database yet. This class is the trigger, and it is
// deliberately a trigger rather than a schedule: a historical backfill is a
// one-off, not something that should happen on every container start.
//
// HOW TO RUN IT
//   Set Weather__BackfillDays on Railway (e.g. 90) and redeploy. On the next
//   start this runs once for every farm that has coordinates, then the service
//   completes and does nothing further for the life of the process.
//
//   REMOVE THE VARIABLE AFTERWARDS. While it is set, every redeploy re-runs
//   the backfill. That is harmless in terms of data - the upsert on
//   (farm_id, date) makes a re-run converge on the same rows rather than
//   duplicate them - but it is a pointless few thousand Open-Meteo requests
//   on each deploy, and Open-Meteo is a free service we should not abuse.
//
// WHY A BackgroundService AND NOT A CALL IN Program.cs
//   Awaiting the backfill inline during startup would hold the container in
//   "starting" for as long as the fetch takes - minutes, for a multi-year
//   range across several farms - and Railway would see a service that is not
//   answering health checks. Running it here, after ApplicationStarted, means
//   the API is already serving requests while the backfill works behind it.
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
        // Unset, unparseable or non-positive all mean "not requested". Staying
        // silent on the common path keeps the ordinary startup log clean;
        // there is no value in a line saying the backfill did not run on every
        // single deploy for the rest of the project's life.
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

        // Let the app finish starting first. Without this the backfill competes
        // with startup for the connection pool and the HTTP stack while Railway
        // is still deciding whether the container came up.
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

        // Nothing below may be allowed to escape. An unhandled exception out of
        // ExecuteAsync stops the whole host by default
        // (BackgroundServiceExceptionBehavior.StopHost), which would turn a
        // failed optional backfill into a dead API. RunForAllFarmsAsync already
        // swallows per-farm failures; this catch is for anything structural,
        // such as weather_daily not existing because 0016 has not been applied.
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
