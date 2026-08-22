using AgroFlow.Business;
using Npgsql;

namespace AgroFlow.Api.Services;

public record SensorReadingResult(string HealthStatus, string? CommandIssued);

// The actual sensor-insert + health/auto-irrigation decision logic, shared
// between the HTTP endpoint (POST /api/sensor-readings) and the MQTT
// handler (MqttConnectionService, subscribed to
// agroflow/farm/+/device/+/sensors) - both transports resolve their own way
// to a zoneId and then call the exact same method, so the decision logic
// only exists once.
public static class SensorReadingProcessor
{
    // Must match the cooldown the removed Postgres trigger used - how long a
    // manual command holds the floor against auto-issued ones.
    private static readonly TimeSpan ManualCooldown = TimeSpan.FromMinutes(30);

    public static async Task<SensorReadingResult> ProcessAsync(
        NpgsqlConnection connection, long zoneId, string sensorType, float value)
    {
        await InsertSensorReadingAsync(connection, zoneId, sensorType, value);

        var (moisture, temperature, humidity, dryThreshold, wetThreshold) =
            await FetchZoneLatestReadingAsync(connection, zoneId);

        // The domain layer decides the health status - this method's job is
        // just to fetch inputs and persist the result.
        var healthStatus = Zone.CalculateHealthStatus(moisture, temperature, humidity);
        await UpdateZoneHealthAsync(connection, zoneId, healthStatus);

        string? commandIssued = null;

        if (sensorType == "SoilMoisture")
        {
            var zone = new Zone
            {
                MoistureDryThreshold = dryThreshold,
                MoistureWetThreshold = wetThreshold,
            };

            // Use the just-received value directly for the decision (matches
            // the removed trigger's use of NEW.value) rather than re-reading
            // zone_latest_reading, which avoids depending on read-your-writes
            // ordering for a value already in hand.
            string? desired = null;
            if (zone.ShouldStartIrrigation(value)) desired = "start";
            else if (zone.ShouldStopIrrigation(value)) desired = "stop";

            if (desired is not null && !await HasActiveManualOverrideAsync(connection, zoneId))
            {
                // Only insert if this actually changes what was last
                // instructed - otherwise every ~30s reading while still dry
                // would queue a duplicate 'start' command.
                var lastCommand = await FetchLastCommandAsync(connection, zoneId);
                if (lastCommand != desired)
                {
                    await InsertAutoCommandAsync(connection, zoneId, desired);
                    commandIssued = desired;
                }
            }
        }

        return new SensorReadingResult(healthStatus, commandIssued);
    }

    private static async Task InsertSensorReadingAsync(
        NpgsqlConnection connection, long zoneId, string sensorType, float value)
    {
        await using var cmd = new NpgsqlCommand(
            "insert into sensor_reading (zone_id, sensor_type, value) values ($1, $2, $3)", connection);
        cmd.Parameters.AddWithValue(zoneId);
        cmd.Parameters.AddWithValue(sensorType);
        cmd.Parameters.AddWithValue(value);
        await cmd.ExecuteNonQueryAsync();
    }

    private static async Task<(float? Moisture, float? Temperature, float? Humidity, float? DryThreshold, float? WetThreshold)>
        FetchZoneLatestReadingAsync(NpgsqlConnection connection, long zoneId)
    {
        await using var cmd = new NpgsqlCommand(
            "select moisture, temperature, humidity, moisture_dry_threshold, moisture_wet_threshold " +
            "from zone_latest_reading where zone_id = $1", connection);
        cmd.Parameters.AddWithValue(zoneId);

        await using var reader = await cmd.ExecuteReaderAsync();
        if (!await reader.ReadAsync())
        {
            return (null, null, null, null, null);
        }

        return (
            reader.IsDBNull(0) ? null : reader.GetFloat(0),
            reader.IsDBNull(1) ? null : reader.GetFloat(1),
            reader.IsDBNull(2) ? null : reader.GetFloat(2),
            reader.IsDBNull(3) ? null : reader.GetFloat(3),
            reader.IsDBNull(4) ? null : reader.GetFloat(4)
        );
    }

    private static async Task UpdateZoneHealthAsync(NpgsqlConnection connection, long zoneId, string healthStatus)
    {
        await using var cmd = new NpgsqlCommand(
            "update zone set health_status = $1 where id = $2", connection);
        cmd.Parameters.AddWithValue(healthStatus);
        cmd.Parameters.AddWithValue(zoneId);
        await cmd.ExecuteNonQueryAsync();
    }

    private static async Task<bool> HasActiveManualOverrideAsync(NpgsqlConnection connection, long zoneId)
    {
        await using var cmd = new NpgsqlCommand(
            "select exists (" +
            "  select 1 from irrigation_commands " +
            "  where zone_id = $1 and source = 'manual' " +
            "    and (status = 'pending' or (status = 'executed' and executed_at > now() - $2))" +
            ")", connection);
        cmd.Parameters.AddWithValue(zoneId);
        cmd.Parameters.AddWithValue(ManualCooldown);
        return (bool)(await cmd.ExecuteScalarAsync())!;
    }

    private static async Task<string?> FetchLastCommandAsync(NpgsqlConnection connection, long zoneId)
    {
        await using var cmd = new NpgsqlCommand(
            "select command from irrigation_commands where zone_id = $1 order by created_at desc limit 1", connection);
        cmd.Parameters.AddWithValue(zoneId);
        var result = await cmd.ExecuteScalarAsync();
        return result as string;
    }

    private static async Task InsertAutoCommandAsync(NpgsqlConnection connection, long zoneId, string command)
    {
        await using var cmd = new NpgsqlCommand(
            "insert into irrigation_commands (zone_id, command, source) values ($1, $2, 'auto')", connection);
        cmd.Parameters.AddWithValue(zoneId);
        cmd.Parameters.AddWithValue(command);
        await cmd.ExecuteNonQueryAsync();
    }
}
