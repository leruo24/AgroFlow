using System.Text.Json;
using AgroFlow.Business;
using Npgsql;

namespace AgroFlow.Api.Mqtt;

public record IrrigationCommandNotification(
    Guid Id, long ZoneId, string Command, int? DurationSeconds, string Source);

// Bridges "a new row landed in irrigation_commands" (Postgres, via the
// notify_irrigation_command() trigger added in
// 0009_mqtt_and_device_identity.sql) to "publish it on the device's MQTT
// commands topic".
//
// Chose Postgres LISTEN/NOTIFY over the alternatives:
//   - Supabase Realtime from this backend: there's no official Supabase
//     Realtime client for .NET (JS/Dart/Python/Swift/Kotlin are supported,
//     C# isn't) - only unmaintained community ports, which would be a
//     fragile dependency for something this central.
//   - Polling irrigation_commands on a timer: works, but reintroduces
//     exactly the polling-latency-vs-load tradeoff this whole MQTT migration
//     is meant to get away from, and AgroFlow.Api already holds a direct
//     Npgsql connection, so LISTEN/NOTIFY is "free" - no new client, no new
//     infra, well-documented Npgsql feature.
// LISTEN/NOTIFY also has a real correctness edge the other options don't:
// irrigation_commands rows come from THREE different write paths (the app's
// direct Supabase insert for manual commands, this API's own auto-irrigation
// insert, and the pg_cron schedule-firing job) - a table-level trigger
// catches all three uniformly. A publish call added only inside this API's
// own code paths would miss the other two entirely.
public class IrrigationCommandNotifyService : BackgroundService
{
    private const string Channel = "irrigation_commands_channel";

    private readonly NpgsqlDataSource _dataSource;
    private readonly IMqttPublisher _mqttPublisher;
    private readonly IConfiguration _configuration;
    private readonly ILogger<IrrigationCommandNotifyService> _logger;

    // Startup, MQTT reconnect and the periodic timer can all want to sweep at
    // once - a container restart triggers the first two within a second of
    // each other. One sweep at a time: a second caller skips rather than
    // queues, because by the time it would run the first has already handled
    // the same rows.
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

    // How often the periodic safety-net sweep runs. The NOTIFY path and the
    // reconnect hook cover the normal cases; this catches anything they both
    // miss - a NOTIFY that arrived while the LISTEN connection was being
    // re-established, for instance.
    private TimeSpan SweepInterval =>
        TimeSpan.FromSeconds(int.TryParse(_configuration["Irrigation:ReplaySweepIntervalSeconds"], out var s) && s > 0
            ? s
            : 120);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        // Replay when MQTT comes up, including the very first connect. This is
        // the hook that flushes commands queued while the broker or this
        // container was unreachable. Fire-and-forget: the handler runs on the
        // MQTT connect path and must not block it.
        _mqttPublisher.Connected += () =>
            _ = ReplayPendingCommandsAsync("MQTT connected", stoppingToken);

        // The periodic safety net, independent of the LISTEN loop below so a
        // wedged LISTEN connection cannot also stop replay.
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

    // Finds irrigation_commands rows still pending and either republishes them
    // or expires them, per CommandReplayPolicy.
    //
    // Republishing a command the device already got is safe and expected: MQTT
    // is at-least-once anyway, and once the device executes and ACKs via
    // POST /api/devices/commands/{id}/executed the row leaves pending status
    // and the sweep stops seeing it.
    private async Task ReplayPendingCommandsAsync(string trigger, CancellationToken stoppingToken)
    {
        if (!await _replayGate.WaitAsync(0, stoppingToken)) return;

        try
        {
            if (!_mqttPublisher.IsConnected)
            {
                // Nothing to do yet. The Connected hook will call us back.
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
            // A failing sweep must never take the host down - it is a safety
            // net, not a critical path.
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

        // Oldest first, so a start/stop pair queued during an outage is
        // replayed in the order the farmer issued it. Supported by
        // idx_irrigation_commands_pending_created (migration 0019).
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
        // The failed status is already in 0004's status check constraint, so
        // this needs no schema change. The row stops being replayed and stays
        // visible as a command that never reached a device.
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

                // WaitAsync blocks until a NOTIFY arrives (dispatching it via
                // the Notification event above) or the timeout elapses - loop
                // forever so this connection keeps listening for the life of
                // the service.
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

    // Resolves the zone's active devices and publishes to each. Shared by the
    // NOTIFY path and the replay sweep so both behave identically. Returns
    // true when at least one device was published to.
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

        var payload = JsonSerializer.Serialize(notification, JsonOptions);

        // Publishes to every active device on this zone rather than assuming
        // exactly one - multi-device-per-zone is explicitly supported now, and
        // this errs on the side of not silently missing a legitimate second
        // device (e.g. a separate pump-controller board) rather than picking
        // one arbitrarily.
        foreach (var (deviceId, farmId) in devices)
        {
            var topic = MqttTopics.CommandsTopic(farmId, deviceId);
            await _mqttPublisher.PublishAsync(topic, payload);
            _logger.LogInformation("Published command {CommandId} to {Topic}", notification.Id, topic);
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
