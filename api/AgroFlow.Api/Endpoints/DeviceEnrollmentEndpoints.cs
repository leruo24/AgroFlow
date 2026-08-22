using System.Security.Cryptography;
using AgroFlow.Api.Auth;
using Npgsql;

namespace AgroFlow.Api.Endpoints;

public record EnrollDeviceRequest(long ZoneId, string? DeviceId, string? DeviceName);
public record EnrollDeviceResponse(long HardwareId, string EnrollmentCode, DateTimeOffset ExpiresAt);

public record ClaimDeviceRequest(string DeviceId, string EnrollmentCode);
// FarmId is included alongside ZoneId because the firmware needs both to
// build its MQTT topics (agroflow/farm/{farmId}/device/{deviceId}/...) - see
// hardware/MQTT_TOPICS.md. Both are persisted to flash on claim.
public record ClaimDeviceResponse(long ZoneId, long FarmId, long HardwareId);

public record FirmwareCheckResponse(bool UpdateAvailable, string? LatestVersion, string? DownloadUrl);

public static class DeviceEnrollmentEndpoints
{
    // How long an enrollment code stays valid if the device is never
    // physically powered on. Codes are single-use regardless of this - it
    // just bounds how long an unused one remains a live secret (e.g. printed
    // on a sticker in a box sitting in storage).
    private static readonly TimeSpan EnrollmentCodeLifetime = TimeSpan.FromHours(24);

    // No 0/O/1/I/L - characters that are easy to mistype or confuse when a
    // human is copying this off a screen or a QR-code fallback label.
    private const string CodeAlphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
    private const int CodeLength = 8;

    public static void MapDeviceEnrollmentEndpoints(this WebApplication app)
    {
        // Admin-only: real Supabase Auth JWT + a profile.role='admin' check
        // (AdminOnlyFilter). Exempted from the device shared-secret
        // middleware in Program.cs - this is a human admin action, not a
        // device call.
        app.MapPost("/api/devices/enroll", EnrollAsync)
            .RequireAuthorization()
            .AddEndpointFilter<AdminOnlyFilter>();

        // Device-facing: no user auth, per the design - the enrollment code
        // itself is the single-use credential. Still behind the shared
        // X-Api-Key device secret like every other device endpoint (defense
        // in depth: a stranger without the firmware's baked-in key can't even
        // attempt to brute-force codes).
        app.MapPost("/api/devices/claim", ClaimAsync);

        app.MapGet("/api/devices/firmware-check", FirmwareCheckAsync);
    }

    private static async Task<IResult> EnrollAsync(EnrollDeviceRequest request, NpgsqlDataSource dataSource)
    {
        if (request.ZoneId <= 0)
        {
            return Results.BadRequest("zoneId is required.");
        }

        var code = GenerateEnrollmentCode();
        var expiresAt = DateTimeOffset.UtcNow.Add(EnrollmentCodeLifetime);

        await using var connection = await dataSource.OpenConnectionAsync();
        await using var cmd = new NpgsqlCommand(
            "insert into hardware (device_name, device_type, zone_id, device_id, enrollment_status, enrollment_code, enrollment_code_expires_at) " +
            "values ($1, 'ESP32', $2, $3, 'enrolled', $4, $5) returning hardware_id", connection);
        cmd.Parameters.AddWithValue(request.DeviceName ?? $"Zone {request.ZoneId} ESP32");
        cmd.Parameters.AddWithValue(request.ZoneId);
        cmd.Parameters.AddWithValue((object?)request.DeviceId?.Trim().ToUpperInvariant() ?? DBNull.Value);
        cmd.Parameters.AddWithValue(code);
        cmd.Parameters.AddWithValue(expiresAt);

        var hardwareId = (long)(await cmd.ExecuteScalarAsync())!;

        return Results.Ok(new EnrollDeviceResponse(hardwareId, code, expiresAt));
    }

    private static async Task<IResult> ClaimAsync(ClaimDeviceRequest request, NpgsqlDataSource dataSource)
    {
        if (string.IsNullOrWhiteSpace(request.DeviceId) || string.IsNullOrWhiteSpace(request.EnrollmentCode))
        {
            return Results.BadRequest("deviceId and enrollmentCode are required.");
        }

        await using var connection = await dataSource.OpenConnectionAsync();
        await using var transaction = await connection.BeginTransactionAsync();

        long hardwareId;
        long zoneId;
        long farmId;
        string? existingDeviceId;

        // Row lock so two near-simultaneous claim attempts against the same
        // code (e.g. a retried request from a flaky connection) can't both
        // succeed. Joined to zone for farm_id - the firmware needs it for
        // MQTT topics, not just zoneId.
        await using (var lookupCmd = new NpgsqlCommand(
            "select h.hardware_id, h.zone_id, z.farm_id, h.device_id " +
            "from hardware h join zone z on z.id = h.zone_id " +
            "where h.enrollment_code = $1 and h.enrollment_status = 'enrolled' " +
            "and h.enrollment_code_expires_at > now() for update", connection, transaction))
        {
            lookupCmd.Parameters.AddWithValue(request.EnrollmentCode.Trim().ToUpperInvariant());
            await using var reader = await lookupCmd.ExecuteReaderAsync();
            if (!await reader.ReadAsync())
            {
                await transaction.RollbackAsync();
                return Results.Json(new { error = "Invalid, expired, or already-used enrollment code." },
                    statusCode: StatusCodes.Status401Unauthorized);
            }

            hardwareId = reader.GetInt64(0);
            zoneId = reader.GetInt64(1);
            farmId = reader.GetInt64(2);
            existingDeviceId = reader.IsDBNull(3) ? null : reader.GetString(3);
        }

        var claimedDeviceId = request.DeviceId.Trim().ToUpperInvariant();

        // If the admin already knew the device ID at enroll time, it must
        // match - extra safety against a leaked code being used by a
        // different physical board than the one it was issued for. If the
        // admin enrolled a placeholder (device ID unknown at the time -
        // ESP32 efuse IDs aren't usually printed on the board, so this is
        // the common case), whatever ID the device presents now is accepted
        // and stored.
        if (existingDeviceId is not null && existingDeviceId != claimedDeviceId)
        {
            await transaction.RollbackAsync();
            return Results.Json(new { error = "Device ID does not match the device this code was issued for." },
                statusCode: StatusCodes.Status401Unauthorized);
        }

        await using (var updateCmd = new NpgsqlCommand(
            "update hardware set device_id = $1, enrollment_status = 'active', " +
            "enrollment_code = null, enrollment_code_expires_at = null, status = 'Online', last_seen = now() " +
            "where hardware_id = $2", connection, transaction))
        {
            updateCmd.Parameters.AddWithValue(claimedDeviceId);
            updateCmd.Parameters.AddWithValue(hardwareId);
            await updateCmd.ExecuteNonQueryAsync();
        }

        await transaction.CommitAsync();

        return Results.Ok(new ClaimDeviceResponse(zoneId, farmId, hardwareId));
    }

    // TODO: LatestVersion/DownloadUrl are plain config values (see
    // appsettings.json) - bump LatestVersion and point DownloadUrl at a
    // freshly-compiled .bin every time you cut a release. This endpoint does
    // not host or build firmware itself; see the OTA section of the summary
    // for where the .bin actually needs to live.
    private static IResult FirmwareCheckAsync(string? currentVersion, IConfiguration configuration)
    {
        var latestVersion = configuration["Firmware:LatestVersion"];
        var downloadUrl = configuration["Firmware:DownloadUrl"];

        var updateAvailable = !string.IsNullOrEmpty(latestVersion) &&
                               !string.Equals(latestVersion, currentVersion, StringComparison.OrdinalIgnoreCase);

        return Results.Ok(new FirmwareCheckResponse(
            updateAvailable,
            latestVersion,
            updateAvailable ? downloadUrl : null));
    }

    private static string GenerateEnrollmentCode()
    {
        Span<char> code = stackalloc char[CodeLength];
        for (var i = 0; i < code.Length; i++)
        {
            code[i] = CodeAlphabet[RandomNumberGenerator.GetInt32(CodeAlphabet.Length)];
        }
        return new string(code);
    }
}
