using System.Text.Json;
using AgroFlow.Business;
using AgroFlow.Api.Services;
using AgroFlow.Api.Services.Notifications;
using MQTTnet;
using Npgsql;

namespace AgroFlow.Api.Mqtt;

public record SensorMqttPayload(string SensorType, float Value);

public interface IMqttPublisher
{
    Task PublishAsync(string topic, string payload);

    // True only while the single shared MQTT connection is up. Callers that
    // publish opportunistically (the irrigation-command replay sweep) check
    // this instead of catching the "not connected" exception per message.
    bool IsConnected { get; }

    // Raised after a connection is established AND the subscription is in
    // place - on first connect and on every reconnect after a drop.
    //
    // This is what lets IrrigationCommandNotifyService flush commands that
    // piled up while the broker was unreachable. Handlers are invoked on the
    // connect path, so they must not block: the handler kicks off its own task
    // and returns.
    event Action? Connected;
}

// Owns the single MQTT connection to HiveMQ Cloud for the whole API process:
// subscribes to agroflow/farm/+/device/+/sensors on startup and runs each
// message through the same SensorReadingProcessor the HTTP endpoint uses,
// and exposes PublishAsync so IrrigationCommandNotifyService can push
// commands out over the same connection rather than opening a second one.
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

    // Part 2: since when the broker has been out of reach (from start-up until
    // the first connection, and from each drop until the next), so health can
    // tell a blip from a broker that is gone.
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

        _options = new MqttClientOptionsBuilder()
            .WithTcpServer(host, port)
            .WithTlsOptions(o => o.UseTls())
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

                // MQTTnet manages message receipt itself. This loop owns all
                // reconnect attempts so a failed ConnectAsync and its
                // Disconnected event cannot start overlapping retry loops.
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
                _disconnectedSinceUtc = null;
                _logger.LogInformation("MQTT connected, subscribed to {Topic}", MqttTopics.SensorTopicFilter);

                // Announce only once the subscription is actually in place, so
                // a handler that immediately publishes is not racing a
                // half-ready connection. A throwing handler must not kill the
                // connect loop and strand the whole MQTT path.
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

    // Every sensor reading a board publishes arrives here: work out which
    // device sent it from the topic, then hand it to SensorReadingProcessor.
    private async Task OnMessageReceivedAsync(MqttApplicationMessageReceivedEventArgs args)
    {
        try
        {
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

            // v1.3.0 boards publish Temperature and Humidity from the DHT11
            // alongside SoilMoisture, on this same topic and in this same
            // shape. All three are already allowed by sensor_reading's CHECK
            // constraint (0002_relationships.sql), so they need no migration
            // and no special case below - they simply flow through
            // SensorReadingProcessor like any other reading.
            //
            // What this guard adds is the rejection of anything OUTSIDE that
            // set. Without it an unrecognised sensorType reached Postgres,
            // violated the CHECK and surfaced as a logged exception for every
            // such message. One warning and a drop is the right answer to a
            // malformed payload - the same thing this handler already does
            // with an unparseable topic.
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

            // The only place in AgroFlow that knows which physical device a
            // reading came from, so it is the only place that can stamp
            // last_seen accurately. DeviceStatusMonitorService reads this to
            // decide a device has gone quiet; without it, liveness could only
            // ever be guessed from the zone.
            await TouchDeviceLastSeenAsync(connection, device.Value.HardwareId);

            await SensorReadingProcessor.ProcessAsync(
                connection, device.Value.ZoneId, payload.SensorType, payload.Value, _notifications);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to process MQTT sensor message on topic {Topic}", args.ApplicationMessage.Topic);
        }
    }

    // Validates the topic's claimed farmId actually matches this device's
    // real zone/farm rather than just trusting whatever the topic says - a
    // device publishing to the wrong farm's topic (misconfigured or
    // otherwise) is ignored, not silently trusted.
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

    private static async Task TouchDeviceLastSeenAsync(NpgsqlConnection connection, long hardwareId)
    {
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
