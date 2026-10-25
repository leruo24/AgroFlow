using System.Text.Json;
using AgroFlow.Business;
using AgroFlow.Api.Services;
using AgroFlow.Api.Services.Notifications;
using MQTTnet;
using Npgsql;

namespace AgroFlow.Api.Mqtt;

// RecordedAt and Seq come only with a reading the kit kept while offline (v1.5.0).
// Backlog: readings the kit still has waiting to upload, on every reading from v1.7.0.
// Rssi (dBm) and SoilProbeOk (its last soil sample was in range): on every reading from v1.7.1.
public record SensorMqttPayload(string SensorType, float Value, DateTimeOffset? RecordedAt = null, long? Seq = null, int? Backlog = null,
    int? Rssi = null, bool? SoilProbeOk = null);

public interface IMqttPublisher
{
    Task PublishAsync(string topic, string payload);

    // True while the shared MQTT connection is up. The command replay sweep checks
    // this instead of catching a "not connected" error for every message.
    bool IsConnected { get; }

    // Raised once the connection and subscription are ready, on the first connect
    // and after every reconnect. IrrigationCommandNotifyService uses it to send
    // commands that queued up while the broker was down. Handlers must not block.
    event Action? Connected;
}

// Owns the one MQTT connection to HiveMQ Cloud for the API: subscribes to
// agroflow/farm/+/device/+/sensors, passes each message to the same
// SensorReadingProcessor the HTTP endpoint uses, and lets
// IrrigationCommandNotifyService publish commands over the same connection.
public class MqttConnectionService : BackgroundService, IMqttPublisher
{
    private readonly NpgsqlDataSource _dataSource;
    private readonly IConfiguration _configuration;
    private readonly INotificationService _notifications;
    private readonly ILogger<MqttConnectionService> _logger;
    private IMqttClient? _client;
    private MqttClientOptions? _options;

    public event Action? Connected;

    public bool IsConnected => _client is { IsConnected: true };

    // When the broker became unreachable (from start-up or from the last drop),
    // so the health check can tell a short blip from an outage.
    private DateTimeOffset? _disconnectedSinceUtc = DateTimeOffset.UtcNow;
    public DateTimeOffset? DisconnectedSinceUtc => IsConnected ? null : _disconnectedSinceUtc;

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    };

    public MqttConnectionService(
        NpgsqlDataSource dataSource,
        IConfiguration configuration,
        INotificationService notifications,
        ILogger<MqttConnectionService> logger)
    {
        _dataSource = dataSource;
        _configuration = configuration;
        _notifications = notifications;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var factory = new MqttClientFactory();
        _client = factory.CreateMqttClient();

        var host = _configuration["Mqtt:Host"]
            ?? throw new InvalidOperationException("Missing Mqtt:Host in configuration - see appsettings.json.");
        var port = int.Parse(_configuration["Mqtt:Port"] ?? "8883");
        var username = _configuration["Mqtt:Username"]
            ?? throw new InvalidOperationException("Missing Mqtt:Username in configuration - see appsettings.json.");
        var password = _configuration["Mqtt:Password"]
            ?? throw new InvalidOperationException("Missing Mqtt:Password in configuration - see appsettings.json.");

        var builder = new MqttClientOptionsBuilder();

        // Mqtt:ProtocolVersion is unset in production (MQTTnet's default, MQTT 5, which HiveMQ
        // speaks). "311" selects MQTT 3.1.1 for a test broker that has only that, like the
        // simulation's (hardware/sim). The kits themselves speak 3.1.1 (PubSubClient).
        if (_configuration["Mqtt:ProtocolVersion"] == "311")
        {
            builder = builder.WithProtocolVersion(MQTTnet.Formatter.MqttProtocolVersion.V311);
        }

        _options = builder
            .WithTcpServer(host, port)
            // Mqtt:UseTls defaults to true (HiveMQ Cloud). Only a local test broker turns it off.
            .WithTlsOptions(o => o.UseTls(!string.Equals(_configuration["Mqtt:UseTls"], "false", StringComparison.OrdinalIgnoreCase)))
            .WithCredentials(username, password)
            .WithClientId($"agroflow-api-{Guid.NewGuid():N}")
            .WithCleanSession()
            .Build();

        _client.ApplicationMessageReceivedAsync += OnMessageReceivedAsync;
        _client.DisconnectedAsync += OnDisconnectedAsync;

        try
        {
            while (!stoppingToken.IsCancellationRequested)
            {
                if (!_client.IsConnected)
                {
                    await ConnectAsync(stoppingToken);
                }

                // MQTTnet handles receiving messages. This loop handles all reconnects, so a
                // failed ConnectAsync and its Disconnected event cannot start two retry loops.
                await Task.Delay(TimeSpan.FromSeconds(1), stoppingToken);
            }
        }
        catch (OperationCanceledException)
        {
            // expected on shutdown
        }
    }

    private async Task ConnectAsync(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            try
            {
                await _client!.ConnectAsync(_options, ct);
                await _client.SubscribeAsync(MqttTopics.SensorTopicFilter, cancellationToken: ct);
                // Firmware 1.7.2's own topics: agroflow/<deviceId>/telemetry, /ack and /status.
                foreach (var filter in KitLink.SubscribeFilters)
                    await _client.SubscribeAsync(filter, cancellationToken: ct);
                _disconnectedSinceUtc = null;
                _logger.LogInformation("MQTT connected, subscribed to {Topic} and {KitTopics}",
                    MqttTopics.SensorTopicFilter, string.Join(", ", KitLink.SubscribeFilters));

                // Only announce once the subscription is in place, so a handler that publishes
                // straight away does not race a half-ready connection. A failing handler must
                // not stop the connect loop.
                try
                {
                    Connected?.Invoke();
                }
                catch (Exception handlerEx)
                {
                    _logger.LogError(handlerEx, "An MQTT Connected handler threw; the connection itself is fine.");
                }

                return;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "MQTT connect failed, retrying in 10s");
                await Task.Delay(TimeSpan.FromSeconds(10), ct);
            }
        }
    }

    private Task OnDisconnectedAsync(MqttClientDisconnectedEventArgs args)
    {
        _disconnectedSinceUtc ??= DateTimeOffset.UtcNow;
        _logger.LogWarning("MQTT disconnected ({Reason}); the connection loop will retry.", args.Reason);
        return Task.CompletedTask;
    }

    // Every sensor reading a board publishes arrives here: we work out the device
    // from the topic and pass the reading to SensorReadingProcessor.
    private async Task OnMessageReceivedAsync(MqttApplicationMessageReceivedEventArgs args)
    {
        try
        {
            if (KitLink.ParseKitTopic(args.ApplicationMessage.Topic) is { } kitTopic)
            {
                await OnKitMessageAsync(kitTopic.DeviceId, kitTopic.Channel, args.ApplicationMessage.ConvertPayloadToString());
                return;
            }

            var parsed = MqttTopics.ParseFarmAndDevice(args.ApplicationMessage.Topic);
            if (parsed is null)
            {
                _logger.LogWarning("Ignoring message on unrecognised topic {Topic}", args.ApplicationMessage.Topic);
                return;
            }

            var (farmId, deviceId) = parsed.Value;
            var payloadJson = args.ApplicationMessage.ConvertPayloadToString();
            var payload = JsonSerializer.Deserialize<SensorMqttPayload>(payloadJson, JsonOptions);
            if (payload is null) return;

            // Boards send SoilMoisture, Temperature and Humidity on this topic, and all
            // three are allowed by sensor_reading's CHECK constraint (0002). Anything else
            // is logged once and dropped instead of failing the database insert.
            if (!SensorReadingTypes.IsValid(payload.SensorType))
            {
                _logger.LogWarning(
                    "Ignoring sensor message on {Topic}: sensorType {SensorType} is not one of {Allowed}",
                    args.ApplicationMessage.Topic, payload.SensorType, SensorReadingTypes.Describe());
                return;
            }

            await using var connection = await _dataSource.OpenConnectionAsync();
            var device = await ResolveDeviceAsync(connection, deviceId, farmId);
            if (device is null)
            {
                _logger.LogWarning("Ignoring sensor message - no active device {DeviceId} on farm {FarmId}", deviceId, farmId);
                return;
            }

            await ProcessReadingAsync(connection, device.Value, deviceId, payload);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to process MQTT sensor message on topic {Topic}", args.ApplicationMessage.Topic);
        }
    }

    // One reading from either topic family, for a resolved active kit.
    private async Task ProcessReadingAsync(
        NpgsqlConnection connection, (long HardwareId, long ZoneId) device, string deviceId, SensorMqttPayload payload)
    {
        // This is the only place that knows which physical device sent a reading, so
        // it updates last_seen. DeviceStatusMonitorService uses that to spot quiet devices.
        await TouchDeviceLastSeenAsync(connection, device.HardwareId, payload.Backlog, payload.Rssi, payload.SoilProbeOk);

        var result = await SensorReadingProcessor.ProcessAsync(
            connection, device.ZoneId, payload.SensorType, payload.Value, _notifications,
            recordedAt: payload.RecordedAt,
            hardwareId: device.HardwareId);

        if (result.Timing == ReadingTiming.Rejected)
        {
            _logger.LogWarning(
                "Ignoring a {SensorType} reading from {DeviceId} recorded at {RecordedAt}: older than {Days} days or in the future",
                payload.SensorType, deviceId, payload.RecordedAt, ReadingAge.MaxBackfillAge.TotalDays);
        }
    }

    // agroflow/<deviceId>/telemetry | ack | status (firmware 1.7.2). The kit's identity is the topic.
    // A device id with no active link is ignored, so an unlinked or replaced kit changes nothing.
    private async Task OnKitMessageAsync(string deviceId, string channel, string payloadText)
    {
        await using var connection = await _dataSource.OpenConnectionAsync();
        var device = await ResolveKitAsync(connection, deviceId);
        if (device is null)
        {
            _logger.LogInformation("Ignoring {Channel} from {DeviceId}: no active link.", channel, deviceId);
            return;
        }

        switch (channel)
        {
            case KitLink.Telemetry:
            {
                var payload = JsonSerializer.Deserialize<SensorMqttPayload>(payloadText, JsonOptions);
                if (payload is null) return;
                if (!SensorReadingTypes.IsValid(payload.SensorType))
                {
                    _logger.LogWarning("Ignoring telemetry from {DeviceId}: sensorType {SensorType} is not one of {Allowed}",
                        deviceId, payload.SensorType, SensorReadingTypes.Describe());
                    return;
                }
                await ProcessReadingAsync(connection, device.Value, deviceId, payload);
                return;
            }
            case KitLink.Status:
            {
                var report = KitLink.ParseStatus(payloadText);
                if (report is null) return;
                await using var cmd = new NpgsqlCommand(
                    "update hardware set status = $2, status_reported_at = now(), " +
                    "last_seen = case when $3 then now() else last_seen end, " +
                    "firmware_version = coalesce($4, firmware_version), wifi_rssi = coalesce($5, wifi_rssi) " +
                    "where hardware_id = $1", connection);
                cmd.Parameters.AddWithValue(device.Value.HardwareId);
                cmd.Parameters.AddWithValue(report.Online ? "Online" : "Offline");
                cmd.Parameters.AddWithValue(report.Online);
                cmd.Parameters.AddWithValue(NpgsqlTypes.NpgsqlDbType.Text, (object?)report.Firmware ?? DBNull.Value);
                cmd.Parameters.AddWithValue(NpgsqlTypes.NpgsqlDbType.Smallint, (object?)(short?)report.Rssi ?? DBNull.Value);
                await cmd.ExecuteNonQueryAsync();
                _logger.LogInformation("Kit {DeviceId} reports itself {State}.", deviceId, report.Online ? "online" : "offline");
                return;
            }
            case KitLink.Ack:
            {
                using var doc = JsonDocument.Parse(payloadText);
                var root = doc.RootElement;
                if (!root.TryGetProperty("id", out var idProp) || idProp.ValueKind != JsonValueKind.String
                    || !Guid.TryParse(idProp.GetString(), out var commandId)) return;
                var executedAt = root.TryGetProperty("executedAt", out var at) && at.ValueKind == JsonValueKind.String
                                 && DateTimeOffset.TryParse(at.GetString(), out var parsedAt) ? parsedAt : DateTimeOffset.UtcNow;
                if (!await AgroFlow.Api.Endpoints.DeviceCommandEndpoints.AcknowledgeFromKitAsync(connection, commandId, deviceId, executedAt))
                    _logger.LogInformation("Ignoring ack for command {CommandId} from {DeviceId}: not its command.", commandId, deviceId);
                return;
            }
        }
    }

    private static async Task<(long HardwareId, long ZoneId)?> ResolveKitAsync(NpgsqlConnection connection, string deviceId)
    {
        await using var cmd = new NpgsqlCommand(
            "select hardware_id, zone_id from hardware " +
            "where upper(device_id) = upper($1) and enrollment_status = 'active' and zone_id is not null", connection);
        cmd.Parameters.AddWithValue(deviceId);
        await using var reader = await cmd.ExecuteReaderAsync();
        return await reader.ReadAsync() ? (reader.GetInt64(0), reader.GetInt64(1)) : null;
    }

    // Security: check that the farmId in the topic really is this device's farm.
    // A device publishing to another farm's topic is ignored.
    private static async Task<(long HardwareId, long ZoneId)?> ResolveDeviceAsync(
        NpgsqlConnection connection, string deviceId, long claimedFarmId)
    {
        await using var cmd = new NpgsqlCommand(
            "select h.hardware_id, h.zone_id, z.farm_id from hardware h join zone z on z.id = h.zone_id " +
            "where h.device_id = $1 and h.enrollment_status = 'active'", connection);
        cmd.Parameters.AddWithValue(deviceId);

        await using var reader = await cmd.ExecuteReaderAsync();
        if (!await reader.ReadAsync()) return null;

        var hardwareId = reader.GetInt64(0);
        var zoneId = reader.GetInt64(1);
        var actualFarmId = reader.GetInt64(2);
        return actualFarmId == claimedFarmId ? (hardwareId, zoneId) : null;
    }

    // Set to false the first time the backlog columns turn out to be missing (before migration
    // 0060), so last_seen is still updated and the backlog is simply not kept.
    private static volatile bool _backlogColumns = true;
    // The same for the kit's own report (migration 0061).
    private static volatile bool _kitReportColumns = true;

    private static async Task TouchDeviceLastSeenAsync(NpgsqlConnection connection, long hardwareId, int? backlog,
        int? rssi = null, bool? soilProbeOk = null)
    {
        // A dBm the column accepts (-127..0); anything else is not a real reading and is dropped.
        if (rssi is < -127 or > 0) rssi = null;
        if ((rssi is not null || soilProbeOk is not null) && _kitReportColumns)
        {
            try
            {
                await using var report = new NpgsqlCommand(
                    "update hardware set wifi_rssi = coalesce($2, wifi_rssi), soil_probe_ok = coalesce($3, soil_probe_ok), " +
                    "kit_report_at = now() where hardware_id = $1", connection);
                report.Parameters.AddWithValue(hardwareId);
                report.Parameters.AddWithValue(NpgsqlTypes.NpgsqlDbType.Smallint, (object?)(short?)rssi ?? DBNull.Value);
                report.Parameters.AddWithValue(NpgsqlTypes.NpgsqlDbType.Boolean, (object?)soilProbeOk ?? DBNull.Value);
                await report.ExecuteNonQueryAsync();
            }
            catch (PostgresException e) when (e.SqlState == PostgresErrorCodes.UndefinedColumn)
            {
                _kitReportColumns = false;
            }
        }

        if (backlog is >= 0 && _backlogColumns)
        {
            try
            {
                await using var withBacklog = new NpgsqlCommand(
                    "update hardware set last_seen = now(), offline_backlog = $2, offline_backlog_at = now() where hardware_id = $1", connection);
                withBacklog.Parameters.AddWithValue(hardwareId);
                withBacklog.Parameters.AddWithValue(backlog.Value);
                await withBacklog.ExecuteNonQueryAsync();
                return;
            }
            catch (PostgresException e) when (e.SqlState == PostgresErrorCodes.UndefinedColumn)
            {
                _backlogColumns = false;
            }
        }
        await using var cmd = new NpgsqlCommand(
            "update hardware set last_seen = now() where hardware_id = $1", connection);
        cmd.Parameters.AddWithValue(hardwareId);
        await cmd.ExecuteNonQueryAsync();
    }

    public async Task PublishAsync(string topic, string payload)
    {
        if (_client is null || !_client.IsConnected)
        {
            throw new InvalidOperationException("MQTT client is not connected - cannot publish.");
        }

        var message = new MqttApplicationMessageBuilder()
            .WithTopic(topic)
            .WithPayload(payload)
            .WithQualityOfServiceLevel(MQTTnet.Protocol.MqttQualityOfServiceLevel.AtLeastOnce)
            .Build();

        await _client.PublishAsync(message);
    }
}
