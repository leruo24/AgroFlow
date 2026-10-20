using AgroFlow.Api.Services.Notifications;
using AgroFlow.Business;
using Npgsql;

namespace AgroFlow.Api.Services;

// Timing says whether the reading was acted on (Live) or only stored (Late, from a kit's
// offline buffer); Duplicate is a buffered reading the server already had.
public record SensorReadingResult(
    string HealthStatus,
    string? CommandIssued,
    ReadingTiming Timing = ReadingTiming.Live,
    bool Duplicate = false);

// The sensor insert, health status and auto-irrigation decision, shared by the HTTP
// endpoint (POST /api/sensor-readings) and the MQTT handler
// (agroflow/farm/+/device/+/sensors). Both find the zoneId their own way and then
// call this, so the decision logic exists once.
public static class SensorReadingProcessor
{
    // How long a manual command takes priority over automatic ones.
    private static readonly TimeSpan ManualCooldown = TimeSpan.FromMinutes(30);

    // notifications is optional so callers (and tests) can leave it out; when null
    // nothing is sent and the decision logic is the same. It never throws (see
    // INotificationService), so a Telegram outage can never block a pump.
    //
    // recordedAt is the kit's own time for a reading it kept while offline (firmware
    // v1.5.0). ReadingAge decides what it may do: a late reading is stored with its own
    // time and goes no further, so no pump is ever started from an old reading.
    public static async Task<SensorReadingResult> ProcessAsync(
        NpgsqlConnection connection, long zoneId, string sensorType, float value,
        INotificationService? notifications = null, CancellationToken cancellationToken = default,
        DateTimeOffset? recordedAt = null, DateTimeOffset? receivedAt = null)
    {
        var arrived = receivedAt ?? DateTimeOffset.UtcNow;
        var timing = ReadingAge.Classify(recordedAt, arrived);

        if (timing == ReadingTiming.Rejected)
        {
            return new SensorReadingResult(await FetchZoneHealthStatusAsync(connection, zoneId) ?? "Unknown", null, timing);
        }

        if (recordedAt is not null)
        {
            // A kit may resend a buffered reading (power cut after sending, before it was
            // removed from flash). Same zone, type and time is the same reading: kept once.
            var stored = await InsertTimedReadingOnceAsync(
                connection, zoneId, sensorType, value, ReadingAge.StoredTime(recordedAt, arrived));
            if (!stored || !ReadingAge.MayDriveLiveDecisions(timing))
            {
                return new SensorReadingResult(
                    await FetchZoneHealthStatusAsync(connection, zoneId) ?? "Unknown", null, timing, Duplicate: !stored);
            }
        }
        else
        {
            await InsertSensorReadingAsync(connection, zoneId, sensorType, value);
        }

        var (moisture, temperature, humidity, moistureThreshold, desiredMoisture) =
            await FetchZoneLatestReadingAsync(connection, zoneId);

        // Read the old status before writing: only the change of status is worth telling
        // anyone about. Alerting on the status itself would message the farmer every ~30 s
        // while a zone stays dry.
        var previousHealthStatus = await FetchZoneHealthStatusAsync(connection, zoneId);

        // The domain class decides the health status; this method only fetches inputs and
        // saves the result.
        var healthStatus = Zone.CalculateHealthStatus(moisture, temperature, humidity);
        await UpdateZoneHealthAsync(connection, zoneId, healthStatus);

        var enteredCritical = healthStatus == "Critical" && previousHealthStatus != "Critical";
        var leftCritical = healthStatus != "Critical" && previousHealthStatus == "Critical";

        if (enteredCritical)
        {
            // Write an alert row for every entry into Critical, so the app and dashboard show
            // everything that happened. Whether the farmer is also messaged is decided further
            // down (see the note there).
            await InsertCriticalAlertAsync(connection, zoneId, moisture, temperature);
        }
        else if (leftCritical)
        {
            // Close the alert opened above, so the admin's open-alert count shows what is wrong now.
            await ResolveCriticalAlertsAsync(connection, zoneId);
        }

        string? commandIssued = null;

        // Why the farmer needs to be told. Null means the zone is fine or AgroFlow is
        // handling it, which stay in the app. See the note above the send at the end.
        ZoneCriticalReason? couldNotActReason = null;

        // Temperature and Humidity readings stop here: they feed the health status but never
        // the irrigation decision. A hot afternoon is no reason to open a valve.
        if (SensorReadingTypes.DrivesIrrigation(sensorType))
        {
            // Respect the zone's irrigation_mode before deciding anything, so a zone the farmer
            // set to Manual is never started by a sensor reading. Read from `zone` because
            // zone_latest_reading (0010) does not include the column.
            var irrigationMode = await FetchIrrigationModeAsync(connection, zoneId);

            if (!IrrigationMode.AllowsAutoCommands(irrigationMode))
            {
                // The health status above is still updated; only the command is skipped.
                // A manual zone that has just gone Critical is the clearest "you need to act" case.
                if (enteredCritical)
                {
                    couldNotActReason = ZoneCriticalReason.ManualMode;
                    await NotifyIfCouldNotActAsync(
                        notifications, zoneId, moisture ?? value, couldNotActReason, cancellationToken);
                }

                return new SensorReadingResult(healthStatus, null);
            }

            // The rule is AutoIrrigationDecision (pure, unit-tested): Automatic zones only,
            // thresholds, a manual run takes priority, and only a change of instruction (every
            // ~30 s reading while still dry must not queue another 'start'). It checks the mode
            // again, so a Manual zone gets no command even if the check above were removed.
            // Uses the value just received rather than re-reading zone_latest_reading, so it
            // does not depend on read-your-writes ordering.
            var desired = AutoIrrigationDecision.Decide(
                irrigationMode, value, moistureThreshold, desiredMoisture,
                manualRunActive: await HasActiveManualOverrideAsync(connection, zoneId),
                lastCommand: await FetchLastCommandAsync(connection, zoneId));

            if (desired is not null)
            {
                await InsertAutoCommandAsync(connection, zoneId, desired);
                commandIssued = desired;
            }
        }

        // Routine irrigation is not messaged: a zone that went dry and was watered
        // automatically is the system working, so it stays in the app history. A noisy
        // channel gets muted and the frost warning goes unread.
        // What is worth a message is a zone that needed water and did not get it. By here
        // the zone is automatic, so the remaining failure is having no device to command.
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

    // A pump that never confirms a command is the third way a zone goes unwatered, but
    // it cannot be seen here (the command was just queued). DeviceStatusMonitorService
    // catches it later as SystemFailureKind.PumpUnresponsive.
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

    // "Active" means enrolled and in service. A zone without one can never be watered by
    // AgroFlow, which is exactly what the farmer must be told.
    private static async Task<bool> HasActiveDeviceAsync(NpgsqlConnection connection, long zoneId)
    {
        await using var cmd = new NpgsqlCommand(
            "select exists (select 1 from hardware where zone_id = $1 and enrollment_status = 'active')",
            connection);

        cmd.Parameters.AddWithValue(zoneId);

        return (bool)(await cmd.ExecuteScalarAsync())!;
    }

    // False when this zone already has this sensor type at exactly this time.
    private static async Task<bool> InsertTimedReadingOnceAsync(
        NpgsqlConnection connection, long zoneId, string sensorType, float value, DateTimeOffset recordedAt)
    {
        await using var cmd = new NpgsqlCommand(
            """
            insert into sensor_reading (zone_id, sensor_type, value, recorded_at)
            select $1, $2, $3, $4
             where not exists (
                select 1 from sensor_reading
                 where zone_id = $1 and sensor_type = $2 and recorded_at = $4)
            """, connection);
        cmd.Parameters.AddWithValue(zoneId);
        cmd.Parameters.AddWithValue(sensorType);
        cmd.Parameters.AddWithValue(value);
        cmd.Parameters.AddWithValue(NpgsqlTypes.NpgsqlDbType.TimestampTz, recordedAt.ToUniversalTime());
        return await cmd.ExecuteNonQueryAsync() == 1;
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

    // Null when the zone has no stored status yet (never had a reading). Null counts as
    // not Critical, so the first critical reading does alert.
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
        // Zone.CalculateHealthStatus reaches Critical on low moisture or high temperature,
        // so the message says which.
        var reasons = new List<string>();
        // A sensor reading, never a %: it may be from before the wet/dry setup.
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

        // The alert's "Why am I seeing this?". A missing explanation table (0039) never
        // stops the alert.
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
            // The alert matters; the explanation is extra until 0039 is applied.
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

    // Null when the zone row is gone (deleted during a reading).
    // IrrigationMode.AllowsAutoCommands treats null as "no", so no pump is started for a
    // zone that no longer exists.
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
