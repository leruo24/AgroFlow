using System.Collections.Concurrent;
using AgroFlow.Api.Mqtt;
using AgroFlow.Business;
using Npgsql;

namespace AgroFlow.Api.Services;

// The 6-digit setup code a kit is linked with (KitLink.CodeLifetime, 30 minutes).
public static class KitCodes
{
    // A zone has at most one waiting code: "Regenerate" replaces it on the same hardware row,
    // so the admin page keeps watching one row. Returns null when the zone does not exist.
    public static async Task<(long HardwareId, string Code, DateTimeOffset ExpiresAt)?> IssueAsync(
        NpgsqlConnection connection, long zoneId, string deviceName, string deviceType, string? presetDeviceId,
        CancellationToken ct = default)
    {
        await using (var zone = new NpgsqlCommand("select 1 from zone where id = $1", connection))
        {
            zone.Parameters.AddWithValue(zoneId);
            if (await zone.ExecuteScalarAsync(ct) is null) return null;
        }

        // Codes a day past their expiry free their digits for new codes (the column is unique).
        await using (var tidy = new NpgsqlCommand(
            "update hardware set enrollment_code = null where enrollment_code is not null and enrollment_code_expires_at < now() - interval '1 day'",
            connection))
        {
            await tidy.ExecuteNonQueryAsync(ct);
        }

        var expiresAt = DateTimeOffset.UtcNow.Add(KitLink.CodeLifetime);
        for (var attempt = 0; ; attempt++)
        {
            var code = KitLink.NewCode();
            try
            {
                await using var cmd = new NpgsqlCommand("""
                    with waiting as (
                        update hardware set enrollment_code = $3, enrollment_code_expires_at = $4,
                               device_id = coalesce($5, device_id), updated_at = now()
                         where hardware_id = (select hardware_id from hardware where zone_id = $1 and enrollment_status = 'enrolled'
                                               order by hardware_id desc limit 1)
                        returning hardware_id
                    ), fresh as (
                        insert into hardware (device_name, device_type, zone_id, device_id, enrollment_status, enrollment_code, enrollment_code_expires_at)
                        select $2, $6, $1, $5, 'enrolled', $3, $4 where not exists (select 1 from waiting)
                        returning hardware_id
                    )
                    select hardware_id from waiting union all select hardware_id from fresh
                    """, connection);
                cmd.Parameters.AddWithValue(zoneId);
                cmd.Parameters.AddWithValue(deviceName);
                cmd.Parameters.AddWithValue(code);
                cmd.Parameters.AddWithValue(expiresAt);
                cmd.Parameters.AddWithValue(NpgsqlTypes.NpgsqlDbType.Text, (object?)presetDeviceId ?? DBNull.Value);
                cmd.Parameters.AddWithValue(deviceType);
                var hardwareId = (long)(await cmd.ExecuteScalarAsync(ct))!;
                return (hardwareId, code, expiresAt);
            }
            catch (PostgresException e) when (e.SqlState == PostgresErrorCodes.UniqueViolation && attempt < 8)
            {
                // Another live code has these six digits: draw again.
            }
        }
    }
}

// Messages AgroFlow sends a kit directly, outside irrigation_commands.
public static class KitCommands
{
    // "unlink": the kit forgets its farm, zone and logins and reopens its setup hotspot
    // (firmware 1.7.2). Sent on both topic families; each kit listens on one.
    public static async Task SendUnlinkAsync(IMqttPublisher mqtt, string deviceId, ILogger logger)
    {
        var payload = System.Text.Json.JsonSerializer.Serialize(new { id = Guid.NewGuid(), command = "unlink" });
        try
        {
            await mqtt.PublishAsync(KitLink.Topic(deviceId, KitLink.Command), payload);
        }
        catch (Exception ex)
        {
            // Not fatal: the kit's token is already revoked, so it resets itself after three refusals.
            logger.LogWarning(ex, "Could not send unlink to kit {DeviceId}; its revoked token will reset it.", deviceId);
        }
    }
}

// The last refused link attempt per waiting code, for the admin's live panel ("This kit is still
// linked to Old farm"). In memory: it only matters while someone is watching the panel.
public sealed class KitLinkAttempts
{
    public sealed record Attempt(string Code, string Message, string DeviceId, DateTimeOffset At);

    private readonly ConcurrentDictionary<long, Attempt> _byHardware = new();

    public void Record(long hardwareId, string code, string message, string deviceId, DateTimeOffset at)
    {
        if (_byHardware.Count > 5_000) _byHardware.Clear();
        _byHardware[hardwareId] = new Attempt(code, message, deviceId, at);
    }

    public void Clear(long hardwareId) => _byHardware.TryRemove(hardwareId, out _);

    public Attempt? Last(long hardwareId) => _byHardware.TryGetValue(hardwareId, out var a) ? a : null;
}
