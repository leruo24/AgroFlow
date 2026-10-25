using System.Security.Claims;
using AgroFlow.Api.Services;
using AgroFlow.Business;
using Npgsql;

namespace AgroFlow.Api.Endpoints;

// One kit card on the farmer's Kit tab. Zones with no kit are listed too ("Awaiting
// installation"). The setup Wi-Fi is the kit's own hotspot, worked out from its device ID the
// same way the firmware does; it is low-sensitivity (a sticker on the box) and shown always.
public record KitCard(
    long ZoneId,
    string ZoneName,
    bool HasKit,
    string? DeviceId,
    string? DeviceName,
    string? SetupNetworkName,
    string? SetupNetworkPassword,
    string Overall,
    IReadOnlyList<KitHealth.Line> Lines);

public static class KitStatusEndpoints
{
    // The same ownership check as FarmerEndpoints, against z (the zone row).
    private const string FarmAccessSql = """
        exists (select 1 from farm f where f.farm_id = z.farm_id and f.owner_id = $1)
        or exists (select 1 from farm_member fm where fm.farm_id = z.farm_id and fm.profile_id = $1)
        """;

    public static void MapKitStatusEndpoints(this WebApplication app)
    {
        app.MapGet("/api/farmer/farms/{farmId:long}/kits", GetFarmKitsAsync).RequireAuthorization();
    }

    private static async Task<IResult> GetFarmKitsAsync(
        long farmId, ClaimsPrincipal user, NpgsqlDataSource dataSource, IConfiguration configuration, CancellationToken ct)
    {
        if (!TryGetUserId(user, out var userId)) return Results.Unauthorized();

        await using var connection = await dataSource.OpenConnectionAsync(ct);

        await using (var access = new NpgsqlCommand(
            "select exists (select 1 from farm f where f.farm_id = $2 and f.owner_id = $1) " +
            "or exists (select 1 from farm_member fm where fm.farm_id = $2 and fm.profile_id = $1)", connection))
        {
            access.Parameters.AddWithValue(userId);
            access.Parameters.AddWithValue(farmId);
            if (await access.ExecuteScalarAsync(ct) is not true) return Results.NotFound(new { error = "Farm not found." });
        }

        var maxRun = await ZoneRunLimit.ExpressionAsync(connection, "z", ct);
        var backlog = await HardwareBacklog.ExpressionAsync(connection, "h", ct);
        var report = await KitReportColumns.SelectAsync(connection, "h", ct);

        // One row per zone. The lateral joins give the newest reading of each kind and the last
        // pump-switch command (start or stop; setup commands are not the pump).
        var sql = $"""
            select z.id, z.name, h.hardware_id, h.device_id, h.device_name, h.firmware_version,
                   greatest(h.last_seen, coalesce(r.recorded_at, h.last_seen)),
                   soil.recorded_at, climate.recorded_at,
                   {report}, {backlog}, {maxRun},
                   c.command, c.status, c.created_at, c.executed_at
              from zone z
              left join hardware h on h.zone_id = z.id and h.enrollment_status = 'active'
              left join lateral (select max(x.recorded_at) as recorded_at from sensor_reading x
                                  where x.zone_id = z.id) r on true
              left join lateral (select max(x.recorded_at) as recorded_at from sensor_reading x
                                  where x.zone_id = z.id and x.sensor_type = 'SoilMoisture') soil on true
              left join lateral (select max(x.recorded_at) as recorded_at from sensor_reading x
                                  where x.zone_id = z.id and x.sensor_type in ('Temperature', 'Humidity')) climate on true
              left join lateral (select ic.command, ic.status, ic.created_at, ic.executed_at from irrigation_commands ic
                                  where ic.zone_id = z.id and ic.command in ('start', 'stop')
                                  order by ic.created_at desc limit 1) c on true
             where z.farm_id = $2 and ({FarmAccessSql})
             order by z.id
            """;

        await using var cmd = new NpgsqlCommand(sql, connection);
        cmd.Parameters.AddWithValue(userId);
        cmd.Parameters.AddWithValue(farmId);

        var latest = configuration["Firmware:LatestVersion"];
        var downloadUrl = configuration["Firmware:DownloadUrl"];
        var now = DateTimeOffset.UtcNow;
        var cards = new List<KitCard>();

        await using var reader = await cmd.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct))
        {
            DateTimeOffset? At(int i) => reader.IsDBNull(i) ? null : reader.GetFieldValue<DateTimeOffset>(i);
            var hasKit = !reader.IsDBNull(2);
            var deviceId = reader.IsDBNull(3) ? null : reader.GetString(3);
            var firmware = reader.IsDBNull(5) ? null : reader.GetString(5);
            // Columns 13-16: the last pump-switch command (command, status, created_at, executed_at).
            var command = reader.IsDBNull(13) ? null : new KitHealth.LastCommand(
                reader.GetString(13), reader.GetString(14), reader.GetFieldValue<DateTimeOffset>(15), At(16));

            var facts = new KitHealth.Facts(
                HasKit: hasKit,
                LastContact: At(6),
                SoilAt: At(7),
                ClimateAt: At(8),
                SoilProbeOk: reader.IsDBNull(10) ? null : reader.GetBoolean(10),
                Rssi: reader.IsDBNull(9) ? null : reader.GetInt32(9),
                Command: command,
                Backlog: reader.IsDBNull(11) ? null : reader.GetInt32(11),
                FirmwareVersion: firmware,
                FirmwareUpdateAvailable: KitHealth.FirmwareUpdateAvailable(firmware, latest, downloadUrl),
                LatestFirmware: latest,
                MaxRunMinutes: IrrigationRunRules.ZoneMaxOrDefault(reader.IsDBNull(12) ? null : reader.GetInt32(12)));

            var status = KitHealth.Evaluate(facts, now);
            cards.Add(new KitCard(
                reader.GetInt64(0),
                reader.IsDBNull(1) ? "" : reader.GetString(1),
                hasKit,
                deviceId,
                reader.IsDBNull(4) ? null : reader.GetString(4),
                deviceId is null ? null : DeviceSetupCommands.SetupNetworkName(deviceId),
                deviceId is null ? null : DeviceSetupCommands.SetupNetworkPassword(deviceId),
                status.Overall,
                status.Lines));
        }

        return Results.Ok(cards);
    }

    private static bool TryGetUserId(ClaimsPrincipal user, out Guid userId) =>
        Guid.TryParse(user.FindFirstValue("sub"), out userId);
}
