using Microsoft.Extensions.Options;
using Npgsql;

namespace AgroFlow.Api.Services.Notifications;

// Warns farmers about weather that could damage the crop, using the forecast rows
// already in weather_daily (nothing is fetched here). Every warning is saved in the app
// (a farm-wide alert row, like the tank alert) and also sent on Telegram to linked chats.
// Before, it was Telegram only, so a farmer without Telegram never saw a frost warning.
// The forecast refreshes every 6 hours with 8 days, so a storm four days out is seen
// about 20 times. Every send goes through NotificationLedger keyed on the forecast
// date, so a storm on Friday is one message however often Friday's forecast updates.
public sealed class WeatherAlertService : BackgroundService
{
    private readonly NpgsqlDataSource _dataSource;
    private readonly INotificationService _notifications;
    private readonly NotificationLedger _ledger;
    private readonly WeatherAlertOptions _options;
    private readonly ILogger<WeatherAlertService> _logger;

    public WeatherAlertService(
        NpgsqlDataSource dataSource,
        INotificationService notifications,
        NotificationLedger ledger,
        IOptions<WeatherAlertOptions> options,
        ILogger<WeatherAlertService> logger)
    {
        _dataSource = dataSource;
        _notifications = notifications;
        _ledger = ledger;
        _options = options.Value;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!_options.Enabled)
        {
            _logger.LogInformation("Weather alerts are disabled (WeatherAlerts:Enabled=false).");
            return;
        }

        var interval = TimeSpan.FromHours(Math.Max(1, _options.CheckIntervalHours));

        _logger.LogInformation(
            "Weather alerts started: rain over {Rain}mm, frost under {Frost}C, heat over {Heat}C, " +
            "looking {Days} days ahead, checked every {Interval}.",
            _options.HeavyRainMm, _options.FrostMinC, _options.HeatMaxC, _options.ForecastDays, interval);

        using var timer = new PeriodicTimer(interval);

        // Sweep once at start-up instead of waiting a full interval: frost tomorrow night is
        // no use reported three hours late. The ledger means a restart re-sends nothing.
        do
        {
            try
            {
                await SweepAsync(stoppingToken);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                // A failed sweep must not kill the service: an unhandled exception in a
                // BackgroundService stops the whole host, including irrigation.
                _logger.LogError(ex, "Weather alert sweep failed; will retry on the next interval.");
            }
        }
        while (await SafeWaitAsync(timer, stoppingToken));
    }

    private static async Task<bool> SafeWaitAsync(PeriodicTimer timer, CancellationToken stoppingToken)
    {
        try
        {
            return await timer.WaitForNextTickAsync(stoppingToken);
        }
        catch (OperationCanceledException)
        {
            return false;
        }
    }

    // internal: the sim database tests run one sweep (SimDatabaseTests).
    internal async Task SweepAsync(CancellationToken cancellationToken)
    {
        var today = DateOnly.FromDateTime(DateTime.UtcNow.AddHours(2));
        var horizon = today.AddDays(Math.Max(1, _options.ForecastDays));

        // Every farm with an owner or member: the in-app alert does not need Telegram.
        // is_forecast leaves out the historical backfill rows, which would otherwise raise
        // alerts about last winter.
        const string sql =
            """
            select w.farm_id, f.name, w.date, w.precipitation_mm, w.tmin_c, w.tmax_c
              from weather_daily w
              join farm f on f.farm_id = w.farm_id
             where w.is_forecast
               and w.date >= $1
               and w.date <= $2
               and (f.owner_id is not null
                    or exists (select 1 from farm_member fm where fm.farm_id = f.farm_id))
             order by w.farm_id, w.date
            """;

        var candidates = new List<(long FarmId, string FarmName, DateOnly Date, float? Rain, float? Tmin, float? Tmax)>();

        await using (var connection = await _dataSource.OpenConnectionAsync(cancellationToken))
        {
            await using var command = new NpgsqlCommand(sql, connection);
            command.Parameters.AddWithValue(today);
            command.Parameters.AddWithValue(horizon);

            await using var reader = await command.ExecuteReaderAsync(cancellationToken);

            while (await reader.ReadAsync(cancellationToken))
            {
                candidates.Add((
                    reader.GetInt64(0),
                    reader.GetString(1),
                    reader.GetFieldValue<DateOnly>(2),
                    reader.IsDBNull(3) ? null : reader.GetFloat(3),
                    reader.IsDBNull(4) ? null : reader.GetFloat(4),
                    reader.IsDBNull(5) ? null : reader.GetFloat(5)));
            }
        }

        var sent = 0;

        foreach (var row in candidates)
        {
            if (row.Rain is { } rain && rain > _options.HeavyRainMm)
            {
                sent += await TrySendAsync(
                    row.FarmId, row.FarmName, WeatherAlertKind.HeavyRain, "weather_rain",
                    row.Date, rain, cancellationToken);
            }

            if (row.Tmin is { } tmin && tmin < _options.FrostMinC)
            {
                sent += await TrySendAsync(
                    row.FarmId, row.FarmName, WeatherAlertKind.Frost, "weather_frost",
                    row.Date, tmin, cancellationToken);
            }

            if (row.Tmax is { } tmax && tmax > _options.HeatMaxC)
            {
                sent += await TrySendAsync(
                    row.FarmId, row.FarmName, WeatherAlertKind.Heat, "weather_heat",
                    row.Date, tmax, cancellationToken);
            }
        }

        _logger.LogInformation(
            "Weather alert sweep: {Rows} forecast days examined, {Sent} alerts sent " +
            "(the rest were either within thresholds or already sent).",
            candidates.Count, sent);
    }

    private async Task<int> TrySendAsync(
        long farmId,
        string farmName,
        WeatherAlertKind kind,
        string alertType,
        DateOnly date,
        double value,
        CancellationToken cancellationToken)
    {
        if (!await _ledger.TryClaimAsync(farmId, alertType, date, cancellationToken))
        {
            return 0;
        }

        // In the app first, for everyone on the farm whether or not they use Telegram.
        await SaveInAppAsync(farmId, InAppMessage(kind, date, value), cancellationToken);

        // INotificationService never throws, so one unreachable farmer cannot stop the sweep.
        // It only messages linked chats with alerts on.
        await _notifications.NotifyWeatherAsync(
            farmId,
            new WeatherAlertNotification(kind, date, value, farmName),
            cancellationToken);

        _logger.LogInformation(
            "Sent a {Kind} weather alert to farm {FarmId} about {Date} ({Value}).",
            kind, farmId, date, value);

        return 1;
    }

    // The in-app alert's text, in English like the other stored alerts: the title, the day
    // (a date, because the alert stays in the list), the forecast figure and what to do.
    internal static string InAppMessage(WeatherAlertKind kind, DateOnly date, double value)
    {
        var prefix = kind switch
        {
            WeatherAlertKind.HeavyRain => "rain",
            WeatherAlertKind.Frost => "frost",
            _ => "heat",
        };
        var figure = value.ToString("0.#", System.Globalization.CultureInfo.InvariantCulture);
        var day = date.ToString("dddd d MMMM", System.Globalization.CultureInfo.InvariantCulture);
        return $"{BotText.Get("en", prefix + ".title")} on {day}. " +
               $"{BotText.Get("en", prefix + ".value", ("value", figure))}. " +
               BotText.Get("en", prefix + ".action");
    }

    // A farm-wide alert (zone_id null, farm_id set; migration 0046), which the app's Alerts
    // list and the admin console already show. A failure is logged, never fatal: Telegram
    // still goes out.
    private async Task SaveInAppAsync(long farmId, string message, CancellationToken cancellationToken)
    {
        try
        {
            await using var connection = await _dataSource.OpenConnectionAsync(cancellationToken);
            await using var cmd = new NpgsqlCommand(
                "insert into alert (zone_id, farm_id, severity, message) values (null, $1, 'Warning', $2)", connection);
            cmd.Parameters.AddWithValue(farmId);
            cmd.Parameters.AddWithValue(message);
            await cmd.ExecuteNonQueryAsync(cancellationToken);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _logger.LogWarning(ex, "Could not save the in-app weather alert for farm {FarmId}.", farmId);
        }
    }
}
