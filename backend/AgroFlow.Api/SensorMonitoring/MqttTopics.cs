namespace AgroFlow.Api.Mqtt;

// Topic structure (details in hardware/shared/MQTT_TOPICS.md):
//
//   Device -> backend: agroflow/farm/{farmId}/device/{deviceId}/sensors
//   Backend -> device: agroflow/farm/{farmId}/device/{deviceId}/commands
//
// {deviceId} is hardware.device_id (ESP.getEfuseMac(), not the WiFi MAC).
// The ids are in the topic, so payloads never repeat them.
public static class MqttTopics
{
    public const string SensorTopicFilter = "agroflow/farm/+/device/+/sensors";

    public static string CommandsTopic(long farmId, string deviceId) =>
        $"agroflow/farm/{farmId}/device/{deviceId}/commands";

    // Parses "agroflow/farm/{farmId}/device/{deviceId}/<channel>". Returns null for
    // anything else instead of throwing, so a bad topic is logged and ignored.
    public static (long FarmId, string DeviceId)? ParseFarmAndDevice(string topic)
    {
        var segments = topic.Split('/');
        // ["agroflow", "farm", "{farmId}", "device", "{deviceId}", "<channel>"]
        if (segments.Length < 5 ||
            segments[0] != "agroflow" ||
            segments[1] != "farm" ||
            segments[3] != "device")
        {
            return null;
        }

        if (!long.TryParse(segments[2], out var farmId) || string.IsNullOrEmpty(segments[4]))
        {
            return null;
        }

        return (farmId, segments[4]);
    }
}
