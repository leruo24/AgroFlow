using System.Text.Json;
using AgroFlow.Business;
using AgroFlow.Api.Services;
using Npgsql;

namespace AgroFlow.Api.Mqtt;

// MaxRunSeconds is the zone's maximum run time (zone.max_run_minutes, migration 0052), added
// when the command is published. The kit stops a start at min(durationSeconds, maxRunSeconds).
public record IrrigationCommandNotification(
    Guid Id, long ZoneId, string Command, int? DurationSeconds, string Source, int? MaxRunSeconds = null);

// Sends each new irrigation_commands row to the device's MQTT commands topic.
// The notify_irrigation_command() trigger (migration 0009) raises a Postgres
// NOTIFY, and we LISTEN for it here.
// We use LISTEN/NOTIFY because there is no official Supabase Realtime client for
// .NET and polling would add delay. The trigger also catches all three ways a
// command is written: the app, this API's auto-irrigation, and the pg_cron schedule job.
public class IrrigationCommandNotifyService : BackgroundService
{
    private const string Channel = "irrigation_commands_channel";

    private readonly NpgsqlDataSource _dataSource;
    private readonly IMqttPublisher _mqttPublisher;
    private readonly IConfiguration _configuration;
    private readonly ILogger<IrrigationCommandNotifyService> _logger;

    // Startup, MQTT reconnect and the timer can all start a sweep at once.
    // Only one runs at a time; a second caller skips, since the first one
    // already handles the same rows.
    private readonly SemaphoreSlim _replayGate = new(1, 1);

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    };

    public IrrigationCommandNotifyService(
        NpgsqlDataSource dataSource, IMqttPublisher mqttPublisher,
        IConfiguration configuration, ILogger<IrrigationCommandNotifyService> logger)
    {
        _dataSource = dataSource;
        _mqttPublisher = mqttPublisher;
        _configuration = configuration;
        _logger = logger;
    }

    // How often the safety-net sweep runs. It catches anything NOTIFY and the
    // reconnect hook both miss, e.g. a NOTIFY sent while LISTEN was reconnecting.
    private TimeSpan SweepInterval =>
        TimeSpan.FromSeconds(int.TryParse(_configuration["Irrigation:ReplaySweepIntervalSeconds"], out var s) && s > 0
            ? s
            : 120);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        // Replay pending commands whenever MQTT connects, including the first time,
        // so commands queued during an outage go out. Fire-and-forget so the connect
        // path is never blocked.
        _mqttPublisher.Connected += () =>
            _ = ReplayPendingCommandsAsync("MQTT connected", stoppingToken);

        // The periodic sweep runs separately from the LISTEN loop, so a stuck LISTEN
        // connection cannot also stop the replay.
        var sweepTask = RunPeriodicSweepAsync(stoppingToken);

        try
        {
            await RunListenLoopAsync(stoppingToken);
        }
        finally
        {
            await sweepTask;
        }
    }

    private async Task RunPeriodicSweepAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(SweepInterval);

        try
        {
            while (await timer.WaitForNextTickAsync(stoppingToken))
            {
                await ReplayPendingCommandsAsync("periodic sweep", stoppingToken);
            }
        }
        catch (OperationCanceledException)
        {
            // expected on shutdown
        }
    }

    // Finds pending irrigation_commands rows and republishes or expires them
    // (CommandReplayPolicy). Sending a command twice is safe: MQTT is at-least-once,
    // and once the device confirms via POST /api/devices/commands/{id}/executed the
    // row is no longer pending.
    private async Task ReplayPendingCommandsAsync(string trigger, CancellationToken stoppingToken)
    {
        if (!await _replayGate.WaitAsync(0, stoppingToken)) return;

        try
        {
            if (!_mqttPublisher.IsConnected)
            {
                // Not connected yet; the Connected hook will call us again.
                return;
            }

            await using var connection = await _dataSource.OpenConnectionAsync(stoppingToken);

            var pending = await FetchPendingCommandsAsync(connection, stoppingToken);
            if (pending.Count == 0) return;

            _logger.LogInformation(
                "Replay ({Trigger}): {Count} pending irrigation command(s) found", trigger, pending.Count);

            var now = DateTimeOffset.UtcNow;
            var published = 0;
            var expired = 0;

            foreach (var (notification, createdAt) in pending)
            {
                if (stoppingToken.IsCancellationRequested) break;

                if (CommandReplayPolicy.Decide(createdAt, now) == ReplayDecision.Expire)
                {
                    await MarkCommandFailedAsync(connection, notification.Id, stoppingToken);
                    _logger.LogWarning(
                        "Expired irrigation command {CommandId} for zone {ZoneId}: {Reason}",
                        notification.Id, notification.ZoneId, CommandReplayPolicy.ExpiryReason(createdAt, now));
                    expired++;
                    continue;
                }

                if (await PublishNotificationAsync(connection, notification)) published++;
            }

            _logger.LogInformation(
                "Replay ({Trigger}) complete: {Published} republished, {Expired} expired", trigger, published, expired);
        }
        catch (OperationCanceledException)
        {
            // expected on shutdown
        }
        catch (Exception ex)
        {
            // A failed sweep must never crash the host; it is only a safety net.
            _logger.LogError(ex, "Irrigation command replay ({Trigger}) failed", trigger);
        }
        finally
        {
            _replayGate.Release();
        }
    }

    private static async Task<List<(IrrigationCommandNotification Notification, DateTimeOffset CreatedAt)>>
        FetchPendingCommandsAsync(NpgsqlConnection connection, CancellationToken ct)
    {
        var results = new List<(IrrigationCommandNotification, DateTimeOffset)>();

        // Oldest first, so a start/stop pair queued during an outage is sent in the
        // order the farmer gave it. Uses idx_irrigation_commands_pending_created (0019).
        await using var cmd = new NpgsqlCommand(
            "select id, zone_id, command, duration_seconds, source, created_at " +
            "from irrigation_commands where status = 'pending' order by created_at", connection);

        await using var reader = await cmd.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct))
        {
            results.Add((
                new IrrigationCommandNotification(
                    reader.GetGuid(0),
                    reader.GetInt64(1),
                    reader.GetString(2),
                    reader.IsDBNull(3) ? null : reader.GetInt32(3),
                    reader.GetString(4)),
                reader.GetFieldValue<DateTimeOffset>(5)));
        }

        return results;
    }

    private static async Task MarkCommandFailedAsync(NpgsqlConnection connection, Guid commandId, CancellationToken ct)
    {
        // 'failed' is already allowed by the status check constraint (0004). The row
        // stops being replayed and stays visible as a command that never reached a device.
        await using var cmd = new NpgsqlCommand(
            "update irrigation_commands set status = 'failed' where id = $1 and status = 'pending'", connection);
        cmd.Parameters.AddWithValue(commandId);
        await cmd.ExecuteNonQueryAsync(ct);
    }

    private async Task RunListenLoopAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await using var connection = await _dataSource.OpenConnectionAsync(stoppingToken);
                connection.Notification += (_, args) => _ = HandleNotificationAsync(args.Payload);

                await using (var listenCmd = new NpgsqlCommand($"LISTEN {Channel};", connection))
                {
                    await listenCmd.ExecuteNonQueryAsync(stoppingToken);
                }

                _logger.LogInformation("Listening on Postgres channel {Channel} for new irrigation_commands", Channel);

                // WaitAsync waits until a NOTIFY arrives or the timeout passes; we loop so this
                // connection keeps listening for as long as the service runs.
                while (!stoppingToken.IsCancellationRequested)
                {
                    await connection.WaitAsync(stoppingToken);
                }
            }
            catch (OperationCanceledException)
            {
                break;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "LISTEN connection failed, reconnecting in 10s");
                await Task.Delay(TimeSpan.FromSeconds(10), stoppingToken);
            }
        }
    }

    private async Task HandleNotificationAsync(string payloadJson)
    {
        try
        {
            var notification = JsonSerializer.Deserialize<IrrigationCommandNotification>(payloadJson, JsonOptions);
            if (notification is null) return;

            await using var connection = await _dataSource.OpenConnectionAsync();
            await PublishNotificationAsync(connection, notification);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to handle irrigation_commands notification: {Payload}", payloadJson);
        }
    }

    // Finds the zone's active devices and publishes to each. Used by both the
    // NOTIFY path and the sweep. Returns true if at least one device got it.
    private async Task<bool> PublishNotificationAsync(
        NpgsqlConnection connection, IrrigationCommandNotification notification)
    {
        var devices = await ResolveActiveDevicesForZoneAsync(connection, notification.ZoneId);

        if (devices.Count == 0)
        {
            _logger.LogWarning(
                "No active claimed device found for zone {ZoneId} - command {CommandId} not published",
                notification.ZoneId, notification.Id);
            return false;
        }

        var maxRunMinutes = await ZoneRunLimit.ForZoneAsync(connection, notification.ZoneId);
        var payload = JsonSerializer.Serialize(notification with { MaxRunSeconds = maxRunMinutes * 60 }, JsonOptions);

        // Publish to every active device on the zone, since a zone can have more than
        // one board (e.g. a separate pump controller).
        foreach (var (deviceId, farmId) in devices)
        {
            var topic = MqttTopics.CommandsTopic(farmId, deviceId);
            await _mqttPublisher.PublishAsync(topic, payload);
            _logger.LogInformation("Published command {CommandId} to {Topic}", notification.Id, topic);
        }

        // "Waiting for kit" from here on (0057). The first publish counts; a replay keeps it.
        try
        {
            await using var mark = new NpgsqlCommand(
                "update irrigation_commands set published_at = coalesce(published_at, now()) where id = $1", connection);
            mark.Parameters.AddWithValue(notification.Id);
            await mark.ExecuteNonQueryAsync();
        }
        catch (PostgresException e) when (e.SqlState == PostgresErrorCodes.UndefinedColumn)
        {
            // Before 0057: the app shows "Request sent" until the kit answers.
        }

        return true;
    }

    private static async Task<List<(string DeviceId, long FarmId)>> ResolveActiveDevicesForZoneAsync(
        NpgsqlConnection connection, long zoneId)
    {
        var results = new List<(string, long)>();

        await using var cmd = new NpgsqlCommand(
            "select h.device_id, z.farm_id from hardware h join zone z on z.id = h.zone_id " +
            "where h.zone_id = $1 and h.enrollment_status = 'active' and h.device_id is not null", connection);
        cmd.Parameters.AddWithValue(zoneId);

        await using var reader = await cmd.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            results.Add((reader.GetString(0), reader.GetInt64(1)));
        }

        return results;
    }
}
