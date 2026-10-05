using System.Security.Claims;
using AgroFlow.Api.Auth;
using AgroFlow.Api.Services;
using AgroFlow.Business;
using Npgsql;

namespace AgroFlow.Api.Endpoints;

// What the farmer's Kit screen and the admin hardware page both need to
// describe one zone's device.
//
// SensorWorking flags are deliberately per-sensor rather than one "healthy"
// boolean. A DHT11 that has stopped responding while the soil probe still
// works is a real and common state - the kit keeps watering correctly and
// the app falls back to weather-app temperature - and it is useless to the
// farmer if it is reported as the whole kit being broken.
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
    string? SetupNetworkPassword);

public record ChangeWifiResponse(Guid CommandId, string SetupNetworkName, string SetupNetworkPassword);

// One row of the admin hardware page.
//
// MqttUsername and TokenStatus are the reason this endpoint exists at all.
// The dashboard reads most tables straight from Supabase under RLS, but
// migration 0028 deliberately revoked the whole-table select on hardware and
// granted an explicit column list that EXCLUDES device_token_hash and
// token_revoked_at - and 0029 gives no client role any grant on
// mqtt_credential_pool whatsoever. Neither value can be reached from the
// browser by design, so the API derives them.
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
    string? MqttUsername);

// Step 5: the two new device commands, and the screens that drive them.
//
// WHY A SEPARATE FILE
// -------------------
// FarmerEndpoints.cs and FarmEndpoints.cs are both actively worked on
// elsewhere. Nothing here touches irrigation, onboarding or reports, so it
// lives on its own rather than widening a file somebody else is editing -
// the same reasoning DeviceCommandEndpoints.cs records for itself.
public static class ZoneHardwareEndpoints
{
    // The same ownership test FarmerEndpoints uses, against z (the zone row).
    // Copied rather than shared because it is three lines of SQL and lifting
    // it into a shared constant would mean editing that file.
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

        // Admin equivalents. Same three actions plus revoke, on any zone,
        // behind the real admin role check rather than farm membership.
        var admin = app.MapGroup("/api/admin/zones/{zoneId:long}/hardware")
            .RequireAuthorization()
            .AddEndpointFilter<AdminOnlyFilter>();

        admin.MapGet("/", (long zoneId, ClaimsPrincipal user, NpgsqlDataSource ds, CancellationToken ct) =>
            GetZoneHardwareAsync(zoneId, user, ds, requireFarmAccess: false, ct));

        admin.MapPost("/change-wifi", AdminChangeWifiAsync);
        admin.MapPost("/open-setup", AdminOpenSetupAsync);
        admin.MapPost("/revoke", AdminRevokeAsync);

        // The whole fleet, for the admin hardware table. Not under the
        // per-zone group - it is not scoped to a zone.
        app.MapGet("/api/admin/hardware", ListAllHardwareAsync)
            .RequireAuthorization()
            .AddEndpointFilter<AdminOnlyFilter>();
    }

    // ------------------------------------------------------------------
    // ADMIN FLEET LIST
    // ------------------------------------------------------------------

    private static async Task<IResult> ListAllHardwareAsync(
        NpgsqlDataSource dataSource, CancellationToken cancellationToken)
    {
        var rows = new List<AdminHardwareRow>();

        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);

        // The MQTT username comes from a left join rather than a second
        // query, so a fleet of any size is one round trip. A burned entry is
        // excluded: it is no longer this board's login, and showing it would
        // suggest the kit is still using a password that has been retired.
        await using var cmd = new NpgsqlCommand(
            """
            select h.hardware_id, h.device_id, h.device_name, h.zone_id, z.name, f.name,
                   greatest(h.last_seen, coalesce(r.recorded_at, h.last_seen)),
                   h.firmware_version, h.enrollment_status,
                   h.device_token_hash is not null, h.token_revoked_at,
                   p.username
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
                reader.IsDBNull(11) ? null : reader.GetString(11)));
        }

        return Results.Ok(rows);
    }

    // ------------------------------------------------------------------
    // READ
    // ------------------------------------------------------------------

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

        // One query for everything the screen shows. The three lateral joins
        // are the per-sensor "last heard from" timestamps - the same
        // newest-row-per-sensor_type shape zone_latest_reading uses, except
        // that this needs the TIMESTAMPS (to decide "working" vs "not
        // responding"), and that view carries only the values.
        var sql = $"""
            select h.hardware_id, h.device_id, h.device_name, h.last_seen, h.firmware_version,
                   h.device_token_hash is not null, h.token_revoked_at,
                   soil.recorded_at, temp.recorded_at, hum.recorded_at
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

        // No row at all means the zone does not exist OR this farmer cannot
        // see it. Identical responses on purpose - the same choice the
        // reports endpoints make.
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

        var now = DateTimeOffset.UtcNow;

        // "Online" is the newest thing we have heard from this kit by ANY
        // route - a reading on MQTT, or an HTTP call that touched last_seen.
        // Taking only last_seen would call a kit offline between the events
        // that write it; taking only readings would miss a board that is
        // online but whose sensor has failed.
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
            deviceId is null ? null : DeviceSetupCommands.SetupNetworkPassword(deviceId)));
    }

    // active / revoked / legacy key - what the admin hardware page shows.
    private static string DescribeTokenStatus(long? hardwareId, bool hasToken, DateTimeOffset? revokedAt)
    {
        if (hardwareId is null) return "no device";
        if (revokedAt.HasValue) return "revoked";

        // A claimed board with no token hash is a v1.1.0 board still running
        // on the shared key. Naming it explicitly is what tells you whether
        // Devices:LegacyApiKeyEnabled can be retired yet.
        return hasToken ? "active" : "legacy key";
    }

    private static DateTimeOffset? Newest(DateTimeOffset? a, DateTimeOffset? b)
    {
        if (!a.HasValue) return b;
        if (!b.HasValue) return a;

        return a.Value >= b.Value ? a : b;
    }

    // ------------------------------------------------------------------
    // CHANGE WIFI (farmer)
    // ------------------------------------------------------------------

    private static Task<IResult> ChangeWifiAsync(
        long zoneId, ClaimsPrincipal user, NpgsqlDataSource dataSource,
        AuditLog audit, ILoggerFactory loggerFactory, CancellationToken cancellationToken)
        => IssueSetupCommandAsync(
            zoneId, user, dataSource, audit, loggerFactory, DeviceSetupCommands.ChangeWifi,
            requireFarmAccess: true, requireOnline: true,
            cancellationToken: cancellationToken);

    // ------------------------------------------------------------------
    // ADMIN
    // ------------------------------------------------------------------

    private static Task<IResult> AdminChangeWifiAsync(
        long zoneId, ClaimsPrincipal user, NpgsqlDataSource dataSource,
        AuditLog audit, ILoggerFactory loggerFactory, CancellationToken cancellationToken)
        => IssueSetupCommandAsync(
            zoneId, user, dataSource, audit, loggerFactory, DeviceSetupCommands.ChangeWifi,
            requireFarmAccess: false, requireOnline: true,
            cancellationToken: cancellationToken);

    // open_setup keeps the WiFi, so an offline board is not a hard stop the
    // way it is for change_wifi: the command sits pending and the replay
    // sweep delivers it when the board comes back, which is a reasonable
    // thing for an admin to queue deliberately. The farmer has no equivalent,
    // because "nothing visible happened, maybe later" is not an answer to
    // give someone standing in a field.
    private static Task<IResult> AdminOpenSetupAsync(
        long zoneId, ClaimsPrincipal user, NpgsqlDataSource dataSource,
        AuditLog audit, ILoggerFactory loggerFactory, CancellationToken cancellationToken)
        => IssueSetupCommandAsync(
            zoneId, user, dataSource, audit, loggerFactory, DeviceSetupCommands.OpenSetup,
            requireFarmAccess: false, requireOnline: false,
            cancellationToken: cancellationToken);

    // Cuts one board off. Sets token_revoked_at (so every device endpoint
    // 401s it, and three of those make the board wipe its own credentials)
    // and burns its pooled MQTT login.
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

        // Irreversible and destructive, so it is exactly the kind of action
        // the record exists for.
        await audit.WriteAsync(
            user, AuditActions.DeviceRevoked, "hardware", hardwareId.ToString(),
            details: new { zoneId, deviceId, burnedMqttUsername = burnedUsername },
            cancellationToken: cancellationToken);

        return Results.Ok(new
        {
            hardwareId,
            deviceId,
            burnedMqttUsername = burnedUsername,
            // The admin has to do the HiveMQ half by hand - this system
            // cannot change a password on the free tier. Spelled out in the
            // response so the dashboard shows it rather than implying the job
            // is finished.
            notice = burnedUsername is null
                ? "This device had no pooled MQTT login, so only its device token was revoked."
                : $"Change this password in the HiveMQ console, then re-add it to the pool. (Login: {burnedUsername})",
        });
    }

    // ------------------------------------------------------------------
    // The shared insert
    // ------------------------------------------------------------------

    // One path for both commands and both audiences. The insert goes into
    // irrigation_commands so it travels the existing pipeline: trigger ->
    // pg_notify -> IrrigationCommandNotifyService -> the device's own
    // .../commands topic, with a uuid the firmware ACKs. See migration 0030.
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

        // Resolve the device and its liveness in one go. `greatest` over the
        // reading timestamp and last_seen is the same "heard from by any
        // route" rule the read endpoint applies.
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
            // 409, not 503 or 400: the request is well-formed and the farmer
            // is allowed to make it - the kit's current state is what
            // conflicts with it.
            //
            // Telling them to power-cycle three times is the whole value of
            // this response. It is the one route back into a board that
            // cannot be reached over the network, and it needs no app, no
            // admin and no internet.
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

        // duration_seconds is left null - neither command runs anything for a
        // length of time, and 0030 constrains it to null for exactly these
        // two values.
        await using var insert = new NpgsqlCommand(
            "insert into irrigation_commands (zone_id, command, source) values ($1, $2, 'manual') returning id",
            connection);
        insert.Parameters.AddWithValue(zoneId);
        insert.Parameters.AddWithValue(command);

        var commandId = (Guid)(await insert.ExecuteScalarAsync(cancellationToken))!;

        // Recorded for BOTH audiences: a farmer pressing Change WiFi in the
        // app and an admin doing it from the console write the same row, so
        // "why did this kit drop off the network on Tuesday?" has one answer
        // rather than two half-answers.
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
