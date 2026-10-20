using AgroFlow.Business;
using AgroFlow.Business.Agronomy;
using Npgsql;

namespace AgroFlow.Api.Services;

public sealed record DroughtZoneView(
    long ZoneId, string ZoneName, string? Crop, string Priority, double Fraction, double? Ky,
    double? NormalLitres, double? DroughtLitres, string Why, string? IrrigationType, string EfficiencyNote);

public sealed record DroughtBudgetView(double LitresLeft, int NormalDays, int DroughtDays, string Text);

public sealed record DroughtView(
    long FarmId, bool Active, bool Automatic, string? Override, string Reason, DateTimeOffset? Since,
    DroughtBudgetView? Budget, string? Summary, IReadOnlyList<DroughtZoneView> Zones,
    string Honesty, string Source);

// Works out drought mode for a farm from its own data (tank estimate, soil readings, its
// forecast and its own past reference ET), and the zone priorities on top of the engine's
// unchanged advice. Saves the decision on the farm; when it changes, records a drought_event,
// writes an in-app alert and tells linked farmers on Telegram (never staff).
public sealed class DroughtEvaluator
{
    public const string Honesty =
        "Worked out from your farm's own tank estimate, soil readings and weather forecast. It is not a drought prediction or an official drought declaration.";

    private readonly NpgsqlDataSource _dataSource;
    private readonly AppSettingsStore _settings;
    private readonly Fao56EngineController _engine;
    private readonly TankPhController _tank;
    private readonly FarmerMessenger _messenger;
    private readonly IConfiguration _config;
    private readonly ILogger<DroughtEvaluator> _logger;

    public DroughtEvaluator(NpgsqlDataSource dataSource, AppSettingsStore settings, Fao56EngineController engine,
        TankPhController tank, FarmerMessenger messenger, IConfiguration config, ILogger<DroughtEvaluator> logger)
    {
        _dataSource = dataSource;
        _settings = settings;
        _engine = engine;
        _tank = tank;
        _messenger = messenger;
        _config = config;
        _logger = logger;
    }

    private sealed record FarmFacts(long FarmId, string Name, string? Override, bool WasActive, DateTimeOffset? Since,
        bool IsSimulated, string? Scenario, string? WaterSource);

    public async Task<DroughtView?> EvaluateAsync(long farmId, bool notify, CancellationToken ct)
    {
        var s = await _settings.DroughtAsync(ct);
        await using var connection = await _dataSource.OpenConnectionAsync(ct);
        if (!await FarmerMessenger.TableExistsAsync(connection, "drought_event", ct)) return null;   // 0054 not applied

        FarmFacts? farm = null;
        await using (var cmd = new NpgsqlCommand(
            "select farm_id, name, drought_override, drought_active, drought_since, coalesce(is_simulated, false), sim_scenario, water_source from farm where farm_id = $1", connection))
        {
            cmd.Parameters.AddWithValue(farmId);
            await using var r = await cmd.ExecuteReaderAsync(ct);
            if (await r.ReadAsync(ct))
                farm = new FarmFacts(r.GetInt64(0), r.GetString(1), r.IsDBNull(2) ? null : r.GetString(2), r.GetBoolean(3),
                    r.IsDBNull(4) ? null : r.GetFieldValue<DateTimeOffset>(4), r.GetBoolean(5),
                    r.IsDBNull(6) ? null : r.GetString(6), r.IsDBNull(7) ? null : r.GetString(7));
        }
        if (farm is null) return null;

        // Tank: the 0046 estimate. A farm whose water is not a tank uses the soil rule.
        var tank = _tank.GetTank(farmId);
        double? litresLeft = tank?.EstimatedRemainingLitres is { } left ? (double)left : null;
        double? tankFraction = farm.WaterSource is null or "tank" && tank?.CapacityLitres is { } cap && cap > 0 && litresLeft is { } l
            ? l / (double)cap : null;

        // Soil below the zone's own threshold (latest reading).
        bool soilLow;
        await using (var cmd = new NpgsqlCommand(
            "select exists (select 1 from zone z join zone_latest_reading r on r.zone_id = z.id " +
            "where z.farm_id = $1 and r.moisture is not null and z.moisture_threshold is not null and r.moisture < z.moisture_threshold)", connection))
        {
            cmd.Parameters.AddWithValue(farmId);
            soilLow = await cmd.ExecuteScalarAsync(ct) is true;
        }

        // Forecast rain and reference ET, and the farm's own recent reference ET.
        var today = Fao56EngineController.TodayInSast();
        double rain = 0;
        double? etoForecast = null, etoUsual = null;
        await using (var cmd = new NpgsqlCommand(
            "select coalesce(sum(precipitation_mm), 0), avg(eto_mm) from weather_daily " +
            "where farm_id = $1 and is_forecast and date >= $2 and date < $3", connection))
        {
            cmd.Parameters.AddWithValue(farmId);
            cmd.Parameters.AddWithValue(today);
            cmd.Parameters.AddWithValue(today.AddDays(s.ForecastDays));
            await using var r = await cmd.ExecuteReaderAsync(ct);
            if (await r.ReadAsync(ct))
            {
                rain = r.IsDBNull(0) ? 0 : Convert.ToDouble(r.GetValue(0));
                etoForecast = r.IsDBNull(1) ? null : Convert.ToDouble(r.GetValue(1));
            }
        }
        await using (var cmd = new NpgsqlCommand(
            "select avg(eto_mm) from weather_daily where farm_id = $1 and not is_forecast and date >= $2 and date < $3", connection))
        {
            cmd.Parameters.AddWithValue(farmId);
            cmd.Parameters.AddWithValue(today.AddDays(-s.EtoLookbackDays));
            cmd.Parameters.AddWithValue(today);
            var v = await cmd.ExecuteScalarAsync(ct);
            etoUsual = v is null or DBNull ? null : Convert.ToDouble(v);
        }

        // Demonstration only (0056): a Simulated farm with the drought scenario gets a dry week,
        // and only while Simulation__Enabled is on. The ET figures are demo values, not data.
        if (farm.IsSimulated && farm.Scenario == "drought" && _config.GetValue("Simulation:Enabled", false))
        {
            rain = 0;
            etoUsual ??= 4.0;
            etoForecast = Math.Max(etoForecast ?? 0, etoUsual.Value * 1.25);
        }

        var decision = DroughtRules.Decide(new DroughtInputs(tankFraction, soilLow, rain, etoForecast, etoUsual, farm.Override), s);

        // Zone priorities: the engine's own amount per zone, unchanged, then the drought layer.
        var zones = new List<DroughtZoneView>();
        var types = new Dictionary<long, string?>();
        await using (var cmd = new NpgsqlCommand("select id, irrigation_type from zone where farm_id = $1", connection))
        {
            cmd.Parameters.AddWithValue(farmId);
            await using var r = await cmd.ExecuteReaderAsync(ct);
            while (await r.ReadAsync(ct)) types[r.GetInt64(0)] = r.IsDBNull(1) ? null : r.GetString(1);
        }
        foreach (var zone in _engine.Data.GetZonesForFarm(farmId))
        {
            ZoneEngineResult? result = null;
            try { result = Fao56Engine.Run(_engine.BuildInput(zone, today)); }
            catch (Exception ex) { _logger.LogWarning(ex, "Engine failed for zone {ZoneId} in drought mode.", zone.ZoneId); }
            types.TryGetValue(zone.ZoneId, out var type);
            var net = result?.PrimaryAction is IrrigationPrimaryAction.WaterNow or IrrigationPrimaryAction.WaterNowReduced ? result.RecommendedLitres : null;
            var gross = net is { } n ? ApplicationEfficiency.Gross(n, type) : (double?)null;
            var a = DroughtPriorities.For(zone.ZoneId, zone.ZoneName, zone.CropType, DroughtStages.From(result?.Stage), gross, s);
            zones.Add(new DroughtZoneView(a.ZoneId, a.ZoneName, zone.CropType, a.Priority.ToString().ToLowerInvariant(), a.Fraction, a.Ky,
                a.NormalLitres, a.DroughtLitres, a.Why, type, ApplicationEfficiency.Explain(type)));
        }

        // Water budget: the tank's litres against recent daily use (or today's advice).
        DroughtBudgetView? budget = null;
        if (litresLeft is { } litres)
        {
            double normalPerDay;
            await using (var cmd = new NpgsqlCommand(
                "select coalesce(sum(e.estimated_litres), 0) / 14.0 from irrigation_event e join zone z on z.id = e.zone_id " +
                "where z.farm_id = $1 and e.started_at > now() - interval '14 days'", connection))
            {
                cmd.Parameters.AddWithValue(farmId);
                normalPerDay = Convert.ToDouble(await cmd.ExecuteScalarAsync(ct) ?? 0);
            }
            var todayNormal = zones.Sum(z => z.NormalLitres ?? 0);
            var todayDrought = zones.Sum(z => z.DroughtLitres ?? 0);
            if (normalPerDay <= 0) normalPerDay = todayNormal;
            var droughtPerDay = todayNormal > 0 ? normalPerDay * (todayDrought / todayNormal) : normalPerDay;
            if (DroughtRules.Budget(litres, normalPerDay, droughtPerDay) is { } b)
                budget = new DroughtBudgetView(Math.Round(litres), b.NormalDays, b.DroughtDays, DroughtRules.BudgetText(litres, b));
        }

        var advice = zones.Select(z => new ZoneDroughtAdvice(z.ZoneId, z.ZoneName,
            Enum.Parse<DroughtPriority>(z.Priority, true), z.Fraction, z.Ky, z.NormalLitres, z.DroughtLitres, z.Why)).ToList();
        var summary = decision.Active ? DroughtPriorities.Summary(advice) : null;

        // Save, and tell people when it changes.
        var since = farm.Since;
        if (decision.Active != farm.WasActive)
        {
            since = decision.Active ? DateTimeOffset.UtcNow : null;
            await using (var cmd = new NpgsqlCommand(
                "update farm set drought_active = $2, drought_since = $3, drought_reason = $4 where farm_id = $1", connection))
            {
                cmd.Parameters.AddWithValue(farmId);
                cmd.Parameters.AddWithValue(decision.Active);
                cmd.Parameters.AddWithValue(NpgsqlTypes.NpgsqlDbType.TimestampTz, (object?)since ?? DBNull.Value);
                cmd.Parameters.AddWithValue(decision.Reason);
                await cmd.ExecuteNonQueryAsync(ct);
            }
            if (decision.Automatic)
                await RecordEventAsync(connection, farmId, decision.Active, "automatic", decision.Reason, null, ct);
            if (notify)
            {
                var text = decision.Active
                    ? $"{summary} {budget?.Text ?? ""}".Trim() + "\n\n" + Honesty
                    : "Drought mode is off: water as usual. " + Honesty;
                await _messenger.InAppAsync(farmId, decision.Active ? "Warning" : "Info", text, ct);
                await _messenger.TelegramAsync(farmId, FarmerMessenger.Kind.Drought, $"{farm.Name}\n{text}", urgent: false, ct);
            }
        }
        else if (decision.Active)
        {
            await using var cmd = new NpgsqlCommand("update farm set drought_reason = $2 where farm_id = $1", connection);
            cmd.Parameters.AddWithValue(farmId);
            cmd.Parameters.AddWithValue(decision.Reason);
            await cmd.ExecuteNonQueryAsync(ct);
        }

        return new DroughtView(farmId, decision.Active, decision.Automatic, farm.Override, decision.Reason, since,
            budget, summary, zones, Honesty, YieldResponse.Source + "; " + ApplicationEfficiency.Source);
    }

    // On / off by hand ("on" / "off"), or back to automatic (null). Recorded with who did it.
    public async Task<DroughtView?> SetOverrideAsync(long farmId, string? mode, Guid by, bool staff, CancellationToken ct)
    {
        await using (var connection = await _dataSource.OpenConnectionAsync(ct))
        {
            await using (var cmd = new NpgsqlCommand("update farm set drought_override = $2 where farm_id = $1", connection))
            {
                cmd.Parameters.AddWithValue(farmId);
                cmd.Parameters.AddWithValue(NpgsqlTypes.NpgsqlDbType.Text, (object?)mode ?? DBNull.Value);
                if (await cmd.ExecuteNonQueryAsync(ct) == 0) return null;
            }
            var reason = mode switch
            {
                "on" => "Switched on by hand.",
                "off" => "Switched off by hand.",
                _ => "Set back to automatic.",
            };
            await RecordEventAsync(connection, farmId, mode == "on", staff ? "staff" : "farmer", reason, by, ct);
        }
        return await EvaluateAsync(farmId, notify: true, ct);
    }

    private static async Task RecordEventAsync(NpgsqlConnection connection, long farmId, bool active, string source, string reason, Guid? by, CancellationToken ct)
    {
        await using var cmd = new NpgsqlCommand(
            "insert into drought_event (farm_id, active, source, reason, changed_by) values ($1, $2, $3, $4, $5)", connection);
        cmd.Parameters.AddWithValue(farmId);
        cmd.Parameters.AddWithValue(active);
        cmd.Parameters.AddWithValue(source);
        cmd.Parameters.AddWithValue(reason);
        cmd.Parameters.AddWithValue(NpgsqlTypes.NpgsqlDbType.Uuid, (object?)by ?? DBNull.Value);
        await cmd.ExecuteNonQueryAsync(ct);
    }
}

// Re-checks every farm once an hour (and at start-up), so drought mode turns on and off by
// itself as the tank, the soil and the forecast change.
public sealed class DroughtMonitorService : BackgroundService
{
    private readonly NpgsqlDataSource _dataSource;
    private readonly DroughtEvaluator _evaluator;
    private readonly ILogger<DroughtMonitorService> _logger;

    public DroughtMonitorService(NpgsqlDataSource dataSource, DroughtEvaluator evaluator, ILogger<DroughtMonitorService> logger)
    {
        _dataSource = dataSource;
        _evaluator = evaluator;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromHours(1));
        do
        {
            try
            {
                var farms = new List<long>();
                await using (var connection = await _dataSource.OpenConnectionAsync(stoppingToken))
                await using (var cmd = new NpgsqlCommand("select farm_id from farm where coalesce(status, 'Active') <> 'Archived'", connection))
                await using (var r = await cmd.ExecuteReaderAsync(stoppingToken))
                    while (await r.ReadAsync(stoppingToken)) farms.Add(r.GetInt64(0));
                foreach (var id in farms) await _evaluator.EvaluateAsync(id, notify: true, stoppingToken);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                _logger.LogWarning(ex, "Drought check failed; will retry next hour.");
            }
        }
        while (await timer.WaitForNextTickAsync(stoppingToken).ConfigureAwait(false));
    }
}
