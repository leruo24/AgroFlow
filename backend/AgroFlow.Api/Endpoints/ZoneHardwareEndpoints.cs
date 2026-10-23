using System.Security.Claims;
using AgroFlow.Api.Auth;
using AgroFlow.Api.Services;
using AgroFlow.Business;
using Npgsql;

namespace AgroFlow.Api.Endpoints;

// What the farmer's Kit screen and the admin hardware page need about one zone's device.
// SensorWorking is per sensor, not one "healthy" flag: a dead DHT11 with a working
// soil probe is common, and the kit still waters correctly.
public record ZoneHardwareResponse(
    long? HardwareId,
    string? DeviceId,
    string? DeviceName,
    bool Online,
    DateTimeOffset? LastSeen,
    string? FirmwareVersion,
    bool SoilSensorWorking,
    DateTimeOffset? SoilLastReadingAt,
    bool TemperatureSensorWorking,
    DateTimeOffset? TemperatureLastReadingAt,
    bool HumiditySensorWorking,
    DateTimeOffset? HumidityLastReadingAt,
    string TokenStatus,
    string? SetupNetworkName,
    string? SetupNetworkPassword,
    // Readings the kit still had waiting to upload at its latest reading (firmware 1.7.0+;
    // migration 0060). Null: not reported.
    int? OfflineBacklog = null);

public record ChangeWifiResponse(Guid CommandId, string SetupNetworkName, string SetupNetworkPassword);

// One row of the admin hardware page.
// Security: the API works out MqttUsername and TokenStatus because the browser
// cannot read them: 0028 hides device_token_hash and token_revoked_at from clients,
// and 0029 gives no client access to mqtt_credential_pool.
public record AdminHardwareRow(
    long HardwareId,
    string? DeviceId,
    string DeviceName,
    long? ZoneId,
    string? ZoneName,
    string? FarmName,
    bool Online,
    DateTimeOffset? LastSeen,
    string? FirmwareVersion,
    string EnrollmentStatus,
    string TokenStatus,
    string? MqttUsername,
    int? OfflineBacklog = null);

// Device commands (change WiFi, open setup) and the screens that use them.
public static class ZoneHardwareEndpoints
{
    // The same ownership check as FarmerEndpoints, against z (the zone row).
    private const string FarmAccessSql = """
        exists (select 1 from farm f where f.farm_id = z.farm_id and f.owner_id = $1)
        or exists (select 1 from farm_member fm where fm.farm_id = z.farm_id and fm.profile_id = $1)
        """;

    public static void MapZoneHardwareEndpoints(this WebApplication app)
    {
        var farmer = app.MapGroup("/api/farmer/zones/{zoneId:long}/hardware").RequireAuthorization();

        farmer.MapGet("/", (long zoneId, ClaimsPrincipal user, NpgsqlDataSource ds, CancellationToken ct) =>
            GetZoneHardwareAsync(zoneId, user, ds, requireFarmAccess: true, ct));

        farmer.MapPost("/change-wifi", ChangeWifiAsync);

        // Admin versions: the same actions plus revoke, on any zone, behind the admin role check.
        var admin = app.MapGroup("/api/admin/zones/{zoneId:long}/hardware")
            .RequireAuthorization()
            .AddEndpointFilter<AdminOnlyFilter>();

        admin.MapGet("/", (long zoneId, ClaimsPrincipal user, NpgsqlDataSource ds, CancellationToken ct) =>
            GetZoneHardwareAsync(zoneId, user, ds, requireFarmAccess: false, ct));

        admin.MapPost("/change-wifi", AdminChangeWifiAsync);
        admin.MapPost("/open-setup", AdminOpenSetupAsync);
        admin.MapPost("/revoke", AdminRevokeAsync);

        // The whole fleet, for the admin hardware table (not scoped to one zone).
        app.MapGet("/api/admin/hardware", ListAllHardwareAsync)
            .RequireAuthorization()
            .AddEndpointFilter<AdminOnlyFilter>();
    }

    // Admin fleet list

    private static async Task<IResult> ListAllHardwareAsync(
        NpgsqlDataSource dataSource, CancellationToken cancellationToken)
    {
        var rows = new List<AdminHardwareRow>();

        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);

        var backlog = await HardwareBacklog.ExpressionAsync(connection, "h", cancellationToken);

        // The MQTT username comes from a left join, so any fleet size is one query. Burned
        // entries are left out because that login is retired.
        await using var cmd = new NpgsqlCommand(
            $"""
            select h.hardware_id, h.device_id, h.device_name, h.zone_id, z.name, f.name,
                   greatest(h.last_seen, coalesce(r.recorded_at, h.last_seen)),
                   h.firmware_version, h.enrollment_status,
                   h.device_token_hash is not null, h.token_revoked_at,
                   p.username, {backlog}
              from hardware h
              left join zone z on z.id = h.zone_id
              left join farm f on f.farm_id = z.farm_id
              left join lateral (
                select max(x.recorded_at) as recorded_at from sensor_reading x
                 where x.zone_id = h.zone_id) r on true
              left join mqtt_credential_pool p
                on p.assigned_device_id = h.device_id and p.burned_at is null
             order by f.name nulls last, z.name nulls last, h.hardware_id
            """,
            connection);

        var now = DateTimeOffset.UtcNow;

        await using var reader = await cmd.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            var hardwareId = reader.GetInt64(0);
            var lastSeen = reader.IsDBNull(6) ? (DateTimeOffset?)null : reader.GetFieldValue<DateTimeOffset>(6);
            var hasToken = !reader.IsDBNull(9) && reader.GetBoolean(9);
            var revokedAt = reader.IsDBNull(10) ? (DateTimeOffset?)null : reader.GetFieldValue<DateTimeOffset>(10);

            rows.Add(new AdminHardwareRow(
                hardwareId,
                reader.IsDBNull(1) ? null : reader.GetString(1),
                reader.IsDBNull(2) ? "" : reader.GetString(2),
                reader.IsDBNull(3) ? null : reader.GetInt64(3),
                reader.IsDBNull(4) ? null : reader.GetString(4),
                reader.IsDBNull(5) ? null : reader.GetString(5),
                DeviceLiveness.IsOnline(lastSeen, now),
                lastSeen,
                reader.IsDBNull(7) ? null : reader.GetString(7),
                reader.IsDBNull(8) ? "unregistered" : reader.GetString(8),
                DescribeTokenStatus(hardwareId, hasToken, revokedAt),
                reader.IsDBNull(11) ? null : reader.GetString(11),
                reader.IsDBNull(12) ? null : reader.GetInt32(12)));
        }

        return Results.Ok(rows);
    }

    // Read

    private static async Task<IResult> GetZoneHardwareAsync(
        long zoneId,
        ClaimsPrincipal user,
        NpgsqlDataSource dataSource,
        bool requireFarmAccess,
        CancellationToken cancellationToken)
    {
        if (!TryGetUserId(user, out var userId)) return Results.Unauthorized();

        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);

        var accessClause = requireFarmAccess ? $"and ({FarmAccessSql})" : "";

        var backlog = await HardwareBacklog.ExpressionAsync(connection, "h", cancellationToken);

        // One query for the whole screen. The three lateral joins give each sensor's
        // "last heard from" time, to decide "working" or "not responding".
        var sql = $"""
            select h.hardware_id, h.device_id, h.device_name, h.last_seen, h.firmware_version,
                   h.device_token_hash is not null, h.token_revoked_at,
                   soil.recorded_at, temp.recorded_at, hum.recorded_at, {backlog}
              from zone z
              left join hardware h
                on h.zone_id = z.id and h.enrollment_status = 'active'
              left join lateral (
                select r.recorded_at from sensor_reading r
                 where r.zone_id = z.id and r.sensor_type = 'SoilMoisture'
                 order by r.recorded_at desc limit 1) soil on true
              left join lateral (
                select r.recorded_at from sensor_reading r
                 where r.zone_id = z.id and r.sensor_type = 'Temperature'
                 order by r.recorded_at desc limit 1) temp on true
              left join lateral (
                select r.recorded_at from sensor_reading r
                 where r.zone_id = z.id and r.sensor_type = 'Humidity'
                 order by r.recorded_at desc limit 1) hum on true
             where z.id = $2 {accessClause}
             order by h.last_seen desc nulls last
             limit 1;
            """;

        await using var cmd = new NpgsqlCommand(sql, connection);
        cmd.Parameters.AddWithValue(userId);
        cmd.Parameters.AddWithValue(zoneId);

        await using var reader = await cmd.ExecuteReaderAsync(cancellationToken);

        // No row means the zone does not exist or this farmer cannot see it; both get the
        // same answer, like the report endpoints.
        if (!await reader.ReadAsync(cancellationToken))
        {
            return Results.NotFound(new { error = "Zone not found." });
        }

        var hardwareId = reader.IsDBNull(0) ? (long?)null : reader.GetInt64(0);
        var deviceId = reader.IsDBNull(1) ? null : reader.GetString(1);
        var deviceName = reader.IsDBNull(2) ? null : reader.GetString(2);
        var lastSeen = reader.IsDBNull(3) ? (DateTimeOffset?)null : reader.GetFieldValue<DateTimeOffset>(3);
        var firmwareVersion = reader.IsDBNull(4) ? null : reader.GetString(4);
        var hasToken = !reader.IsDBNull(5) && reader.GetBoolean(5);
        var revokedAt = reader.IsDBNull(6) ? (DateTimeOffset?)null : reader.GetFieldValue<DateTimeOffset>(6);
        var soilAt = reader.IsDBNull(7) ? (DateTimeOffset?)null : reader.GetFieldValue<DateTimeOffset>(7);
        var tempAt = reader.IsDBNull(8) ? (DateTimeOffset?)null : reader.GetFieldValue<DateTimeOffset>(8);
        var humAt = reader.IsDBNull(9) ? (DateTimeOffset?)null : reader.GetFieldValue<DateTimeOffset>(9);
        var offlineBacklog = reader.IsDBNull(10) ? (int?)null : reader.GetInt32(10);

        var now = DateTimeOffset.UtcNow;

        // "Online" uses the newest contact by any route (an MQTT reading or an HTTP call
        // that updated last_seen), so a board with a failed sensor still shows online.
        var newestContact = Newest(lastSeen, Newest(soilAt, Newest(tempAt, humAt)));

        return Results.Ok(new ZoneHardwareResponse(
            hardwareId,
            deviceId,
            deviceName,
            DeviceLiveness.IsOnline(newestContact, now),
            newestContact,
            firmwareVersion,
            DeviceLiveness.IsOnline(soilAt, now),
            soilAt,
            DeviceLiveness.IsOnline(tempAt, now),
            tempAt,
            DeviceLiveness.IsOnline(humAt, now),
            humAt,
            DescribeTokenStatus(hardwareId, hasToken, revokedAt),
            deviceId is null ? null : DeviceSetupCommands.SetupNetworkName(deviceId),
            deviceId is null ? null : DeviceSetupCommands.SetupNetworkPassword(deviceId),
            offlineBacklog));
    }

    // active / revoked / legacy key, as shown on the admin hardware page.
    private static string DescribeTokenStatus(long? hardwareId, bool hasToken, DateTimeOffset? revokedAt)
    {
        if (hardwareId is null) return "no device";
        if (revokedAt.HasValue) return "revoked";

        // A claimed board with no token is an old board on the shared key; showing it
        // tells us when Devices:LegacyApiKeyEnabled can be turned off.
        return hasToken ? "active" : "legacy key";
    }

    private static DateTimeOffset? Newest(DateTimeOffset? a, DateTimeOffset? b)
    {
        if (!a.HasValue) return b;
        if (!b.HasValue) return a;

        return a.Value >= b.Value ? a : b;
    }

    // Change WiFi (farmer)

    private static Task<IResult> ChangeWifiAsync(
        long zoneId, ClaimsPrincipal user, NpgsqlDataSource dataSource,
        AuditLog audit, ILoggerFactory loggerFactory, CancellationToken cancellationToken)
        => IssueSetupCommandAsync(
            zoneId, user, dataSource, audit, loggerFactory, DeviceSetupCommands.ChangeWifi,
            requireFarmAccess: true, requireOnline: true,
            cancellationToken: cancellationToken);

    // Admin

    private static Task<IResult> AdminChangeWifiAsync(
        long zoneId, ClaimsPrincipal user, NpgsqlDataSource dataSource,
        AuditLog audit, ILoggerFactory loggerFactory, CancellationToken cancellationToken)
        => IssueSetupCommandAsync(
            zoneId, user, dataSource, audit, loggerFactory, DeviceSetupCommands.ChangeWifi,
            requireFarmAccess: false, requireOnline: true,
            cancellationToken: cancellationToken);

    // open_setup keeps the WiFi, so for an offline board the command waits and the
    // replay sweep sends it later. Only admins can queue it; a farmer needs an
    // answer straight away.
    private static Task<IResult> AdminOpenSetupAsync(
        long zoneId, ClaimsPrincipal user, NpgsqlDataSource dataSource,
        AuditLog audit, ILoggerFactory loggerFactory, CancellationToken cancellationToken)
        => IssueSetupCommandAsync(
            zoneId, user, dataSource, audit, loggerFactory, DeviceSetupCommands.OpenSetup,
            requireFarmAccess: false, requireOnline: false,
            cancellationToken: cancellationToken);

    // Security: cuts one board off. Sets token_revoked_at, so every device endpoint
    // returns 401 (and after three the board wipes its own credentials), and burns
    // its pooled MQTT login.
    private static async Task<IResult> AdminRevokeAsync(
        long zoneId,
        ClaimsPrincipal user,
        NpgsqlDataSource dataSource,
        MqttCredentialPoolService pool,
        AuditLog audit,
        ILoggerFactory loggerFactory,
        CancellationToken cancellationToken)
    {
        var logger = loggerFactory.CreateLogger("AgroFlow.Api.DeviceRevoke");

        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);

        string? deviceId;
        long hardwareId;

        await using (var cmd = new NpgsqlCommand(
            "update hardware set token_revoked_at = now(), status = 'Offline' " +
            "where zone_id = $1 and enrollment_status = 'active' and token_revoked_at is null " +
            "returning hardware_id, device_id", connection))
        {
            cmd.Parameters.AddWithValue(zoneId);

            await using var reader = await cmd.ExecuteReaderAsync(cancellationToken);
            if (!await reader.ReadAsync(cancellationToken))
            {
                return Results.NotFound(new
                {
                    error = "No active device on this zone with a live token.",
                });
            }

            hardwareId = reader.GetInt64(0);
            deviceId = reader.IsDBNull(1) ? null : reader.GetString(1);
        }

        var burnedUsername = deviceId is null
            ? null
            : await pool.BurnForDeviceAsync(deviceId, cancellationToken);

        logger.LogWarning(
            "Revoked device {DeviceId} (hardware {HardwareId}) on zone {ZoneId}. Burned MQTT login: {Username}.",
            deviceId, hardwareId, zoneId, burnedUsername ?? "none");

        // Cannot be undone, so it is audit-logged.
        await audit.WriteAsync(
            user, AuditActions.DeviceRevoked, "hardware", hardwareId.ToString(),
            details: new { zoneId, deviceId, burnedMqttUsername = burnedUsername },
            cancellationToken: cancellationToken);

        return Results.Ok(new
        {
            hardwareId,
            deviceId,
            burnedMqttUsername = burnedUsername,
            // The admin still has to delete the login in HiveMQ by hand (the free tier has no
            // API), so the response says so instead of implying the job is done.
            notice = burnedUsername is null
                ? "This device had no pooled MQTT login, so only its device token was revoked."
                : $"Change this password in the HiveMQ console, then re-add it to the pool. (Login: {burnedUsername})",
        });
    }

    // The shared insert

    // One path for both commands and both audiences. The row goes into
    // irrigation_commands so it uses the normal pipeline: trigger -> pg_notify ->
    // IrrigationCommandNotifyService -> the device's .../commands topic, with a uuid
    // the firmware confirms (migration 0030).
    private static async Task<IResult> IssueSetupCommandAsync(
        long zoneId,
        ClaimsPrincipal user,
        NpgsqlDataSource dataSource,
        AuditLog audit,
        ILoggerFactory loggerFactory,
        string command,
        bool requireFarmAccess,
        bool requireOnline,
        CancellationToken cancellationToken)
    {
        if (!TryGetUserId(user, out var userId)) return Results.Unauthorized();

        var logger = loggerFactory.CreateLogger("AgroFlow.Api.ZoneHardware");

        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);

        var accessClause = requireFarmAccess ? $"and ({FarmAccessSql})" : "";

        // Find the device and when we last heard from it in one query, using the same
        // "heard from by any route" rule as the read endpoint.
        var lookupSql = $"""
            select h.device_id,
                   greatest(h.last_seen, coalesce(r.recorded_at, h.last_seen))
              from zone z
              join hardware h on h.zone_id = z.id and h.enrollment_status = 'active'
              left join lateral (
                select max(x.recorded_at) as recorded_at from sensor_reading x
                 where x.zone_id = z.id) r on true
             where z.id = $2 {accessClause}
               and h.device_id is not null
             order by h.last_seen desc
             limit 1;
            """;

        string deviceId;
        DateTimeOffset? lastContact;

        await using (var lookup = new NpgsqlCommand(lookupSql, connection))
        {
            lookup.Parameters.AddWithValue(userId);
            lookup.Parameters.AddWithValue(zoneId);

            await using var reader = await lookup.ExecuteReaderAsync(cancellationToken);
            if (!await reader.ReadAsync(cancellationToken))
            {
                return Results.NotFound(new { error = "This zone has no kit installed." });
            }

            deviceId = reader.GetString(0);
            lastContact = reader.IsDBNull(1) ? null : reader.GetFieldValue<DateTimeOffset>(1);
        }

        if (requireOnline && !DeviceLiveness.IsOnline(lastContact, DateTimeOffset.UtcNow))
        {
            // 409: the request is valid and allowed, but the kit's current state conflicts
            // with it. The useful part is telling the farmer to power-cycle three times,
            // which reopens setup with no app, admin or internet.
            return Results.Json(
                new
                {
                    error = DeviceLiveness.OfflineMessage,
                    hint = DeviceLiveness.OfflineRouterChangedHint,
                    setupNetworkName = DeviceSetupCommands.SetupNetworkName(deviceId),
                    setupNetworkPassword = DeviceSetupCommands.SetupNetworkPassword(deviceId),
                    lastSeen = lastContact,
                },
                statusCode: StatusCodes.Status409Conflict);
        }

        // duration_seconds stays null: neither command runs for a length of time, and
        // 0030 requires null for these two.
        await using var insert = new NpgsqlCommand(
            "insert into irrigation_commands (zone_id, command, source) values ($1, $2, 'manual') returning id",
            connection);
        insert.Parameters.AddWithValue(zoneId);
        insert.Parameters.AddWithValue(command);

        var commandId = (Guid)(await insert.ExecuteScalarAsync(cancellationToken))!;

        // Audit-logged for farmers and admins alike, so "why did this kit go offline on
        // Tuesday?" has one answer.
        await audit.WriteAsync(
            user,
            command == DeviceSetupCommands.ChangeWifi
                ? AuditActions.DeviceChangeWifi
                : AuditActions.DeviceOpenSetup,
            "zone", zoneId.ToString(),
            details: new { deviceId, command, commandId },
            cancellationToken: cancellationToken);

        logger.LogInformation(
            "Queued {Command} for device {DeviceId} on zone {ZoneId} as command {CommandId}.",
            command, deviceId, zoneId, commandId);

        return Results.Accepted(value: new ChangeWifiResponse(
            commandId,
            DeviceSetupCommands.SetupNetworkName(deviceId),
            DeviceSetupCommands.SetupNetworkPassword(deviceId)));
    }

    private static bool TryGetUserId(ClaimsPrincipal user, out Guid userId) =>
        Guid.TryParse(user.FindFirstValue("sub"), out userId);
}
