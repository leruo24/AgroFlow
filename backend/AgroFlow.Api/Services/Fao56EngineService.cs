using AgroFlow.Business;
using AgroFlow.Business.Agronomy;

namespace AgroFlow.Api.Services;

// Runs the FAO-56 engine on a schedule, as a BackgroundService like the MQTT and
// LISTEN services.
// Two cadences:
//   Daily, just after midnight SAST: work out yesterday's and today's ETo, update
//   every zone's water balance, and write the growth, forecast and efficiency insights.
//   Every 15 minutes: the checks that cannot wait a day (zone_offline, sensor_stuck,
//   watering_failed, water_now) plus the DHT11 fault sweep.
// A timer is enough because the daily pass only needs "has the SAST day changed?".
// Every write is an upsert keyed on (zone, day), so a missed run, a double run or a
// restart all end with the same rows.
public sealed class Fao56EngineService : BackgroundService
{
    // Every 15 minutes, because a farmer who waters by hand wants to know within the
    // quarter hour, not the day.
    private static readonly TimeSpan PeriodicInterval = TimeSpan.FromMinutes(15);

    private readonly IConfiguration _configuration;
    private readonly ILogger<Fao56EngineService> _logger;

    private DateOnly _lastDailyRun = DateOnly.MinValue;
    private readonly Dictionary<long, List<RollingIrrigationDay>> _lastPlans = new();

    public Fao56EngineService(IConfiguration configuration, ILogger<Fao56EngineService> logger)
    {
        _configuration = configuration;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!_configuration.GetValue("Fao56Engine:Enabled", true))
        {
            _logger.LogInformation("FAO-56 engine is disabled (Fao56Engine:Enabled=false).");
            return;
        }

        var connectionString = _configuration.GetConnectionString("Supabase");
        if (string.IsNullOrWhiteSpace(connectionString))
        {
            _logger.LogError("FAO-56 engine cannot start: no Supabase connection string configured.");
            return;
        }

        _logger.LogInformation(
            "FAO-56 engine starting; daily pass just after midnight {TimeZone}, periodic checks every {Minutes} minutes",
            "Africa/Johannesburg", PeriodicInterval.TotalMinutes);

        // Let the API finish starting before the first sweep.
        try
        {
            await Task.Delay(TimeSpan.FromSeconds(20), stoppingToken);
        }
        catch (OperationCanceledException)
        {
            return;
        }

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                var today = Fao56EngineController.TodayInSast();

                if (_lastDailyRun < today)
                {
                    RunDailyPass(connectionString, today);
                    _lastDailyRun = today;
                }
                else
                {
                    RunPeriodicChecks(connectionString, today);
                }
            }
            catch (Exception ex)
            {
                // One bad cycle must not stop the service; the next tick recalculates everything.
                _logger.LogError(ex, "FAO-56 engine cycle failed; will retry on the next tick");
            }

            try
            {
                await Task.Delay(PeriodicInterval, stoppingToken);
            }
            catch (OperationCanceledException)
            {
                return;
            }
        }
    }

    // The full daily pass: balance plus every insight.
    private void RunDailyPass(string connectionString, DateOnly today)
    {
        var engine = new Fao56EngineController(connectionString);
        var zones = engine.Data.GetAllZones();

        var zonesDone = 0;
        var insightsWritten = 0;

        foreach (var zone in zones)
        {
            try
            {
                var insights = engine.RunZoneAndWriteInsights(zone, today);
                TrackPlanChange(engine, zone, today);
                insightsWritten += insights.Count;
                zonesDone++;
            }
            catch (Exception ex)
            {
                // Per zone, so one zone with bad data cannot stop the farm.
                _logger.LogError(ex, "FAO-56 daily pass failed for zone {ZoneId}", zone.ZoneId);
            }
        }

        _logger.LogInformation(
            "FAO-56 daily pass for {Day}: {ZonesDone}/{ZoneCount} zones updated, {InsightCount} insights written",
            today, zonesDone, zones.Count, insightsWritten);
    }

    // The act_now checks only.
    private void RunPeriodicChecks(string connectionString, DateOnly today)
    {
        var engine = new Fao56EngineController(connectionString);
        var zones = engine.Data.GetAllZones();

        var actNow = 0;

        foreach (var zone in zones)
        {
            try
            {
                actNow += engine.RunActNowChecks(zone, today).Count;
                TrackPlanChange(engine, zone, today);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "FAO-56 periodic check failed for zone {ZoneId}", zone.ZoneId);
            }
        }

        if (actNow > 0)
        {
            _logger.LogInformation("FAO-56 periodic checks wrote {Count} act_now insight(s)", actNow);
        }
    }

    private void TrackPlanChange(Fao56EngineController engine, AgroFlow.Data.EngineZoneRow zone, DateOnly today)
    {
        var current = engine.RunZone(zone, today, persist: false).Outlook
            .Select(d => new RollingIrrigationDay
            {
                Date = d.Date,
                Action = d.Action,
                RequiredDepthMm = d.RequiredDepthMm,
                ForecastRainMm = d.ForecastRainMm,
            }).ToList();

        if (_lastPlans.TryGetValue(zone.ZoneId, out var previous))
        {
            var change = IrrigationPlanChangeDetector.Compare(zone.ZoneName, previous, current);
            if (change != null)
            {
                engine.Data.CreateDecisionAlert(zone.ZoneId, change.Message);
                _logger.LogInformation("Decision alert for zone {ZoneId}: {Kind}", zone.ZoneId, change.Kind);
            }
        }

        _lastPlans[zone.ZoneId] = current;
    }
}
