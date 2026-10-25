using System.Security.Claims;
using AgroFlow.Api.Auth;
using AgroFlow.Api.Mqtt;
using AgroFlow.Api.Services;
using AgroFlow.Business;
using Npgsql;

namespace AgroFlow.Api.Endpoints;

public sealed record PumpTestBody(string? Action);

// The admin's "Add kit" panel (firmware 1.7.2): a 6-digit code for a zone, the live stages
// Waiting for kit -> Linked -> Online -> First reading received, the installer's guided check,
// and unlinking a kit. Works on any farmer's zone, new or Live; a new kit on a zone replaces the
// old one and keeps its history.
public static class KitLinkEndpoints
{
    public static void MapKitLinkEndpoints(this WebApplication app)
    {
        var admin = app.MapGroup("/api/admin").RequireAuthorization().AddEndpointFilter<AdminOnlyFilter>();
        admin.MapPost("/zones/{zoneId:long}/kit-code", IssueCodeAsync);
        admin.MapGet("/kit-link/{hardwareId:long}", StatusAsync);
        admin.MapPost("/hardware/{hardwareId:long}/unlink", UnlinkAsync);
        admin.MapPost("/zones/{zoneId:long}/pump-test", PumpTestAsync);
    }

    // "Add kit" and "Regenerate": one waiting code per zone, 30 minutes.
    private static async Task<IResult> IssueCodeAsync(long zoneId, ClaimsPrincipal user, NpgsqlDataSource dataSource, AuditLog audit, CancellationToken ct)
    {
        await using var connection = await dataSource.OpenConnectionAsync(ct);
        string zoneName, farmName;
        long farmId;
        await using (var zone = new NpgsqlCommand("""
            select coalesce(nullif(z.name, ''), 'Zone ' || z.id), f.name, f.farm_id
              from zone z join farm f on f.farm_id = z.farm_id where z.id = $1
            """, connection))
        {
            zone.Parameters.AddWithValue(zoneId);
            await using var r = await zone.ExecuteReaderAsync(ct);
            if (!await r.ReadAsync(ct)) return Results.NotFound(new { error = "No such zone." });
            zoneName = r.GetString(0);
            farmName = r.GetString(1);
            farmId = r.GetInt64(2);
        }

        var issued = await KitCodes.IssueAsync(connection, zoneId, $"{zoneName} kit", EnrollableKitTypes.Default, null, ct);
        if (issued is null) return Results.NotFound(new { error = "No such zone." });
        var (hardwareId, code, expiresAt) = issued.Value;

        // The kit this one would replace, so the panel can say so.
        string? currentDevice = null;
        await using (var current = new NpgsqlCommand(
            "select device_id from hardware where zone_id = $1 and enrollment_status = 'active' order by hardware_id desc limit 1", connection))
        {
            current.Parameters.AddWithValue(zoneId);
            currentDevice = await current.ExecuteScalarAsync(ct) as string;
        }

        // Never the code itself in the log: it is a live credential for 30 minutes.
        await audit.WriteAsync(user, AuditActions.EnrollmentCodeCreated, "hardware", hardwareId.ToString(), farmId,
            new { zoneId, expiresAt, replaces = currentDevice }, ct);

        return Results.Ok(new { hardwareId, code, expiresAt, zoneId, zoneName, farmId, farmName, replacesDeviceId = currentDevice });
    }

    // What the panel shows, asked every few seconds while it is open.
    private static async Task<IResult> StatusAsync(long hardwareId, NpgsqlDataSource dataSource, KitLinkAttempts attempts, CancellationToken ct)
    {
        await using var connection = await dataSource.OpenConnectionAsync(ct);
        long zoneId, farmId;
        string enrollment, zoneName, farmName, commissionState, mode;
        string? deviceId, code, firmware;
        bool online, hasReading;
        int? rssi;
        DateTimeOffset? expiresAt, lastSeen;
        double? dry, wet, flow;
        await using (var cmd = new NpgsqlCommand("""
            select h.zone_id, z.farm_id, h.enrollment_status, coalesce(nullif(z.name, ''), 'Zone ' || z.id), f.name,
                   h.device_id, case when h.enrollment_status = 'enrolled' then h.enrollment_code end, h.enrollment_code_expires_at,
                   h.firmware_version, h.wifi_rssi, h.last_seen,
                   h.status = 'Online' and h.status_reported_at is not null,
                   exists (select 1 from sensor_reading sr where sr.hardware_id = h.hardware_id),
                   z.calibration_dry::float8, z.calibration_wet::float8, z.flow_rate_lpm::float8, z.commission_state, z.irrigation_mode
              from hardware h join zone z on z.id = h.zone_id join farm f on f.farm_id = z.farm_id
             where h.hardware_id = $1
            """, connection))
        {
            cmd.Parameters.AddWithValue(hardwareId);
            await using var r = await cmd.ExecuteReaderAsync(ct);
            if (!await r.ReadAsync(ct)) return Results.NotFound(new { error = "No such kit link." });
            zoneId = r.GetInt64(0);
            farmId = r.GetInt64(1);
            enrollment = r.GetString(2);
            zoneName = r.GetString(3);
            farmName = r.GetString(4);
            deviceId = r.IsDBNull(5) ? null : r.GetString(5);
            code = r.IsDBNull(6) ? null : r.GetString(6);
            expiresAt = r.IsDBNull(7) ? null : r.GetFieldValue<DateTimeOffset>(7);
            firmware = r.IsDBNull(8) ? null : r.GetString(8);
            rssi = r.IsDBNull(9) ? null : r.GetInt16(9);
            lastSeen = r.IsDBNull(10) ? null : r.GetFieldValue<DateTimeOffset>(10);
            online = r.GetBoolean(11);
            hasReading = r.GetBoolean(12);
            dry = r.IsDBNull(13) ? null : r.GetDouble(13);
            wet = r.IsDBNull(14) ? null : r.GetDouble(14);
            flow = r.IsDBNull(15) ? null : r.GetDouble(15);
            commissionState = r.GetString(16);
            mode = r.GetString(17);
        }

        // The latest soil reading on the zone (for the dry and wet steps) and the pump test's commands.
        double? soil = null;
        DateTimeOffset? soilAt = null;
        await using (var latest = new NpgsqlCommand(
            "select value::float8, recorded_at from sensor_reading where zone_id = $1 and sensor_type = 'SoilMoisture' order by recorded_at desc limit 1",
            connection))
        {
            latest.Parameters.AddWithValue(zoneId);
            await using var r = await latest.ExecuteReaderAsync(ct);
            if (await r.ReadAsync(ct)) { soil = r.GetDouble(0); soilAt = r.GetFieldValue<DateTimeOffset>(1); }
        }

        var facts = (await JourneyStore.ZonesAsync(connection, farmId, ct)).FirstOrDefault(z => z.ZoneId == zoneId)?.Facts;
        var refused = enrollment == "enrolled" ? attempts.Last(hardwareId) : null;

        return Results.Ok(new
        {
            hardwareId,
            zoneId,
            zoneName,
            farmId,
            farmName,
            enrollmentStatus = enrollment,
            stage = KitLink.Stage(enrollment, online, hasReading),
            code,
            expiresAt,
            deviceId,
            firmware,
            rssi,
            lastSeen,
            refused = refused is null ? null : new { code = refused.Code, message = refused.Message, deviceId = refused.DeviceId, at = refused.At },
            check = new
            {
                soil,
                soilAt,
                dry,
                wet,
                calibrated = facts?.HasDryReading == true && facts.HasWetReading,
                flowLpm = flow,
                flowMeasured = facts?.FlowRecordedAsMeasured == true,
                testDone = facts?.TestAcknowledged == true,
                commissioned = commissionState == "commissioned",
                commissionState,
                irrigationMode = mode,
            },
        });
    }

    // Ends a link (or cancels a waiting code). The kit forgets its link and reopens its setup
    // hotspot; its readings and history stay on the zone.
    private static async Task<IResult> UnlinkAsync(long hardwareId, ClaimsPrincipal user, NpgsqlDataSource dataSource, IMqttPublisher mqtt,
        AuditLog audit, ILoggerFactory loggerFactory, CancellationToken ct)
    {
        await using var connection = await dataSource.OpenConnectionAsync(ct);
        string? deviceId;
        long zoneId;
        string previous;
        await using (var cmd = new NpgsqlCommand("""
            with before as (select hardware_id, enrollment_status from hardware where hardware_id = $1 for update)
            update hardware h set enrollment_status = 'replaced', status = 'Offline', token_revoked_at = now(), enrollment_code = null
              from before b
             where h.hardware_id = b.hardware_id and b.enrollment_status in ('active', 'enrolled')
            returning h.device_id, h.zone_id, b.enrollment_status
            """, connection))
        {
            cmd.Parameters.AddWithValue(hardwareId);
            await using var r = await cmd.ExecuteReaderAsync(ct);
            if (!await r.ReadAsync(ct)) return Results.NotFound(new { error = "This kit is not linked." });
            deviceId = r.IsDBNull(0) ? null : r.GetString(0);
            zoneId = r.GetInt64(1);
            previous = r.GetString(2);
        }

        if (previous == "active" && deviceId is not null)
            await KitCommands.SendUnlinkAsync(mqtt, deviceId, loggerFactory.CreateLogger("AgroFlow.Api.KitLink"));

        await audit.WriteAsync(user, "kit.unlinked", "hardware", hardwareId.ToString(), null, new { zoneId, deviceId, previous }, ct);
        return Results.Ok(new
        {
            hardwareId,
            message = previous == "active"
                ? "Unlinked. The kit forgets this zone and opens its setup hotspot; its history stays."
                : "The waiting code is cancelled.",
        });
    }

    // The guided check's pump test: water for 10 seconds, then stop. The kit acknowledges both,
    // which is what the commissioning check "test start and stop" looks for.
    public const int PumpTestSeconds = 10;

    private static async Task<IResult> PumpTestAsync(long zoneId, PumpTestBody body, ClaimsPrincipal user, NpgsqlDataSource dataSource,
        AuditLog audit, CancellationToken ct)
    {
        var action = body.Action?.Trim().ToLowerInvariant();
        if (action is not ("start" or "stop")) return Results.BadRequest(new { error = "The action is start or stop." });

        await using var connection = await dataSource.OpenConnectionAsync(ct);
        await using (var kit = new NpgsqlCommand(
            "select 1 from hardware where zone_id = $1 and enrollment_status = 'active' and device_id is not null", connection))
        {
            kit.Parameters.AddWithValue(zoneId);
            if (await kit.ExecuteScalarAsync(ct) is null)
                return Results.Conflict(new { error = "No kit is linked to this zone yet." });
        }

        await using var insert = new NpgsqlCommand(action == "start"
            ? "insert into irrigation_commands (zone_id, command, source, duration_seconds, requested_duration_seconds) values ($1, 'start', 'manual', $2, $2) returning id"
            : "insert into irrigation_commands (zone_id, command, source) values ($1, 'stop', 'manual') returning id", connection);
        insert.Parameters.AddWithValue(zoneId);
        if (action == "start") insert.Parameters.AddWithValue(PumpTestSeconds);
        var commandId = (Guid)(await insert.ExecuteScalarAsync(ct))!;

        await audit.WriteAsync(user, "kit.pump_test", "zone", zoneId.ToString(), null, new { action, commandId }, ct);
        return Results.Ok(new { commandId, action, seconds = action == "start" ? PumpTestSeconds : 0 });
    }
}
