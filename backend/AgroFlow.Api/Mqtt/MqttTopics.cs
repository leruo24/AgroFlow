namespace AgroFlow.Api.Mqtt;

// Topic structure - full write-up in hardware/shared/MQTT_TOPICS.md (also documents
// how future device types should extend this).
//
//   Device -> backend: agroflow/farm/{farmId}/device/{deviceId}/sensors
//   Backend -> device: agroflow/farm/{farmId}/device/{deviceId}/commands
//
// {deviceId} is hardware.device_id (ESP.getEfuseMac(), not WiFi MAC).
// zoneId/farmId/deviceId are never duplicated inside payloads - they're
// already in the topic.
public static class MqttTopics
{
    public const string SensorTopicFilter = "agroflow/farm/+/device/+/sensors";

    public static string CommandsTopic(long farmId, string deviceId) =>
        $"agroflow/farm/{farmId}/device/{deviceId}/commands";

    // Parses "agroflow/farm/{farmId}/device/{deviceId}/sensors" (or any
    // topic following the same farm/device shape, regardless of the
    // trailing channel segment - see the "extending this" note in
    // hardware/shared/MQTT_TOPICS.md). Returns null for anything that doesn't
    // match, rather than throwing - a malformed/unexpected topic should be
    // logged and ignored, not crash the subscriber.
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
