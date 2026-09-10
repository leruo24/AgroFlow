using System.Text.Json;
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
    private readonly ILogger<IrrigationCommandNotifyService> _logger;

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    };

    public IrrigationCommandNotifyService(
        NpgsqlDataSource dataSource, IMqttPublisher mqttPublisher, ILogger<IrrigationCommandNotifyService> logger)
    {
        _dataSource = dataSource;
        _mqttPublisher = mqttPublisher;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
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
            var devices = await ResolveActiveDevicesForZoneAsync(connection, notification.ZoneId);

            if (devices.Count == 0)
            {
                _logger.LogWarning("No active claimed device found for zone {ZoneId} - command {CommandId} not published", notification.ZoneId, notification.Id);
                return;
            }

            var payload = JsonSerializer.Serialize(notification, JsonOptions);

            // Publishes to every active device on this zone rather than
            // assuming exactly one - multi-device-per-zone is explicitly
            // supported now, and this errs on the side of not silently
            // missing a legitimate second device (e.g. a separate
            // pump-controller board) rather than picking one arbitrarily.
            foreach (var (deviceId, farmId) in devices)
            {
                var topic = MqttTopics.CommandsTopic(farmId, deviceId);
                await _mqttPublisher.PublishAsync(topic, payload);
                _logger.LogInformation("Published command {CommandId} to {Topic}", notification.Id, topic);
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to handle irrigation_commands notification: {Payload}", payloadJson);
        }
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
