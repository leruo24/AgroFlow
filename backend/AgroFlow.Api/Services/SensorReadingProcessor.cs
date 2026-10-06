using AgroFlow.Api.Services.Notifications;
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

    // notifications is optional so the two transports can opt in without
    // every existing caller (and every test) having to hand one over. When it
    // is null nothing is sent and the decision logic is completely unchanged.
    // It is also, by contract, a service that never throws - see
    // INotificationService - so no call below needs its own try/catch and a
    // dead Telegram can never block a pump.
    public static async Task<SensorReadingResult> ProcessAsync(
        NpgsqlConnection connection, long zoneId, string sensorType, float value,
        INotificationService? notifications = null, CancellationToken cancellationToken = default)
    {
        await InsertSensorReadingAsync(connection, zoneId, sensorType, value);

        var (moisture, temperature, humidity, moistureThreshold, desiredMoisture) =
            await FetchZoneLatestReadingAsync(connection, zoneId);

        // Read before the write: the difference between the stored status and
        // the newly calculated one is the transition, and it is the only
        // thing worth telling anyone about. Alerting on the status itself
        // would message the farmer every ~30s for as long as a zone stayed
        // dry, which is how farmers learn to ignore alerts.
        var previousHealthStatus = await FetchZoneHealthStatusAsync(connection, zoneId);

        // The domain layer decides the health status - this method's job is
        // just to fetch inputs and persist the result.
        var healthStatus = Zone.CalculateHealthStatus(moisture, temperature, humidity);
        await UpdateZoneHealthAsync(connection, zoneId, healthStatus);

        var enteredCritical = healthStatus == "Critical" && previousHealthStatus != "Critical";
        var leftCritical = healthStatus != "Critical" && previousHealthStatus == "Critical";

        if (enteredCritical)
        {
            // The alert table has existed since 0003 with nothing anywhere in
            // the codebase writing to it, which is why the admin dashboard's
            // alerts page has only ever shown an empty state. This is its
            // first writer.
            //
            // The alert row is written for EVERY entry into Critical, because
            // the app and the admin dashboard should show everything that
            // happened. Whether the farmer is also messaged is decided further
            // down, and is a much narrower question - see the note there.
            await InsertCriticalAlertAsync(connection, zoneId, moisture, temperature);
        }
        else if (leftCritical)
        {
            // Close the alert the transition above opened, so the admin's
            // open-alert count reflects what is actually wrong right now
            // rather than everything that has ever been wrong.
            await ResolveCriticalAlertsAsync(connection, zoneId);
        }

        string? commandIssued = null;

        // Why the farmer could not be left to AgroFlow on this one. Null means
        // either the zone is fine, or AgroFlow is handling it - both of which
        // are app-only. See the note above the send at the end of this method.
        ZoneCriticalReason? couldNotActReason = null;

        // Temperature and Humidity readings stop here: they are inserted
        // above and feed the health status, but must never reach the
        // irrigation decision. A hot afternoon is not a reason to open a
        // valve.
        if (SensorReadingTypes.DrivesIrrigation(sensorType))
        {
            // Respect the zone's irrigation_mode BEFORE deciding anything.
            //
            // This check used to be missing entirely, which meant a zone the
            // farmer had deliberately set to Manual could still have its pump
            // started by an incoming sensor reading. irrigation_mode is read
            // straight off `zone` rather than from zone_latest_reading, because
            // 0010's view does not carry the column and widening the view would
            // mean another migration for no gain.
            var irrigationMode = await FetchIrrigationModeAsync(connection, zoneId);

            if (!IrrigationMode.AllowsAutoCommands(irrigationMode))
            {
                // Health status above is still updated - observing a zone is
                // always allowed. Only the command is suppressed.
                //
                // A zone the farmer put on manual that has just gone Critical
                // is the clearest case of "something needs you": nobody else
                // is going to water it.
                if (enteredCritical)
                {
                    couldNotActReason = ZoneCriticalReason.ManualMode;
                    await NotifyIfCouldNotActAsync(
                        notifications, zoneId, moisture ?? value, couldNotActReason, cancellationToken);
                }

                return new SensorReadingResult(healthStatus, null);
            }

            var zone = new Zone
            {
                MoistureThreshold = moistureThreshold,
                DesiredMoisture = desiredMoisture,
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

        // ROUTINE IRRIGATION IS NOT MESSAGED. A zone that went dry and was
        // watered automatically is the system working, and there is nothing
        // for the farmer to do about it - it belongs in the app, with the rest
        // of their usage history. This used to send a message on every auto
        // start and stop; it was removed deliberately, because a channel that
        // carries things you do not need to act on gets muted, and then the
        // frost warning goes unread too.
        //
        // What IS worth a message is a zone that needed water and did not get
        // it. By this point the zone is on automatic, so the remaining way
        // AgroFlow can fail to act is having nothing to send the command to.
        if (enteredCritical && couldNotActReason is null)
        {
            if (!await HasActiveDeviceAsync(connection, zoneId))
            {
                couldNotActReason = ZoneCriticalReason.NoDevice;
            }
        }

        await NotifyIfCouldNotActAsync(
            notifications, zoneId, moisture ?? value, couldNotActReason, cancellationToken);

        return new SensorReadingResult(healthStatus, commandIssued);
    }

    // A pump that was sent a command and never acknowledged it is the third
    // way AgroFlow can fail to water a zone, but it cannot be detected from
    // here - the command has only just been queued. DeviceStatusMonitorService
    // picks that up once the acknowledgement is overdue and raises
    // SystemFailureKind.PumpUnresponsive.
    private static async Task NotifyIfCouldNotActAsync(
        INotificationService? notifications,
        long zoneId,
        float moisture,
        ZoneCriticalReason? reason,
        CancellationToken cancellationToken)
    {
        if (notifications is null || reason is null) return;

        await notifications.NotifyZoneCriticalAsync(zoneId, moisture, reason.Value, cancellationToken);
    }

    // "Active" means enrolled and in service. A zone whose only device was
    // unassigned or never enrolled cannot be watered by AgroFlow however dry
    // it gets, which is precisely the failure the farmer needs telling about.
    private static async Task<bool> HasActiveDeviceAsync(NpgsqlConnection connection, long zoneId)
    {
        await using var cmd = new NpgsqlCommand(
            "select exists (select 1 from hardware where zone_id = $1 and enrollment_status = 'active')",
            connection);

        cmd.Parameters.AddWithValue(zoneId);

        return (bool)(await cmd.ExecuteScalarAsync())!;
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

    private static async Task<(float? Moisture, float? Temperature, float? Humidity, float? MoistureThreshold, float? DesiredMoisture)>
        FetchZoneLatestReadingAsync(NpgsqlConnection connection, long zoneId)
    {
        await using var cmd = new NpgsqlCommand(
            "select moisture, temperature, humidity, moisture_threshold, desired_moisture " +
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

    // Null when the zone row has no stored status yet (a zone that has never
    // had a reading). Null is treated as "not Critical", so the first reading
    // that lands in the critical range does alert - which is right: that
    // farmer genuinely has a dry zone.
    private static async Task<string?> FetchZoneHealthStatusAsync(NpgsqlConnection connection, long zoneId)
    {
        await using var cmd = new NpgsqlCommand(
            "select health_status from zone where id = $1", connection);
        cmd.Parameters.AddWithValue(zoneId);
        var result = await cmd.ExecuteScalarAsync();
        return result as string;
    }

    private static async Task InsertCriticalAlertAsync(
        NpgsqlConnection connection, long zoneId, float? moisture, float? temperature)
    {
        // Zone.CalculateHealthStatus reaches Critical on either low moisture
        // or high temperature, so the message says which one it was rather
        // than assuming dryness.
        var reasons = new List<string>();
        // Item 2: a sensor reading, never a % - it may predate the wet/dry setup.
        if (moisture is not null && moisture < Zone.MoistureCriticalMax)
            reasons.Add($"soil sensor reading {moisture:0.#}");
        if (temperature is not null && temperature >= Zone.TemperatureCriticalMin)
            reasons.Add($"temperature {temperature:0.#}C");

        var message = reasons.Count > 0
            ? $"Zone entered Critical: {string.Join(", ", reasons)}."
            : "Zone entered Critical.";

        long alertId;
        await using (var cmd = new NpgsqlCommand(
            "insert into alert (zone_id, severity, message) values ($1, 'Critical', $2) returning id", connection))
        {
            cmd.Parameters.AddWithValue(zoneId);
            cmd.Parameters.AddWithValue(message);
            alertId = (long)(await cmd.ExecuteScalarAsync())!;
        }

        // Item 2c: the alert's "Why am I seeing this?". Never lets a missing
        // explanation table (migration 0039) get in the way of the alert.
        var explanation = AgroFlow.Business.Agronomy.RuleBook.Explanations.CriticalAlert(
            moisture, temperature, Zone.MoistureCriticalMax, Zone.TemperatureCriticalMin);
        await SaveAlertExplanationAsync(connection, zoneId, alertId, "alert_critical", explanation);
    }

    internal static async Task SaveAlertExplanationAsync(
        NpgsqlConnection connection, long zoneId, long alertId, string kind,
        AgroFlow.Business.Agronomy.RuleBook.Explanation explanation)
    {
        try
        {
            await using var cmd = new NpgsqlCommand(
                "insert into explanation (farm_id, zone_id, alert_id, kind, explanation) " +
                "select z.farm_id, z.id, $2, $3, $4::jsonb from zone z where z.id = $1", connection);
            cmd.Parameters.AddWithValue(zoneId);
            cmd.Parameters.AddWithValue(alertId);
            cmd.Parameters.AddWithValue(kind);
            cmd.Parameters.AddWithValue(System.Text.Json.JsonSerializer.Serialize(explanation));
            await cmd.ExecuteNonQueryAsync();
        }
        catch (PostgresException)
        {
            // The alert is what matters; its explanation is a bonus until
            // migration 0039 is applied.
        }
    }

    private static async Task ResolveCriticalAlertsAsync(NpgsqlConnection connection, long zoneId)
    {
        await using var cmd = new NpgsqlCommand(
            "update alert set status = 'Resolved' " +
            "where zone_id = $1 and severity = 'Critical' and status = 'Open'", connection);
        cmd.Parameters.AddWithValue(zoneId);
        await cmd.ExecuteNonQueryAsync();
    }

    private static async Task UpdateZoneHealthAsync(NpgsqlConnection connection, long zoneId, string healthStatus)
    {
        await using var cmd = new NpgsqlCommand(
            "update zone set health_status = $1 where id = $2", connection);
        cmd.Parameters.AddWithValue(healthStatus);
        cmd.Parameters.AddWithValue(zoneId);
        await cmd.ExecuteNonQueryAsync();
    }

    // Null when the zone row is gone (a delete racing an in-flight reading).
    // IrrigationMode.AllowsAutoCommands fails closed on null, so that race
    // ends in "no command issued" rather than in a pump start for a zone that
    // no longer exists.
    private static async Task<string?> FetchIrrigationModeAsync(NpgsqlConnection connection, long zoneId)
    {
        await using var cmd = new NpgsqlCommand(
            "select irrigation_mode from zone where id = $1", connection);
        cmd.Parameters.AddWithValue(zoneId);
        var result = await cmd.ExecuteScalarAsync();
        return result as string;
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
