using System.Security.Cryptography;
using AgroFlow.Api.Auth;
using AgroFlow.Api.Services;
using AgroFlow.Business;
using Npgsql;

namespace AgroFlow.Api.Endpoints;

public record EnrollDeviceRequest(
    long ZoneId, string? DeviceId, string? DeviceName, string? DeviceType = null);
public record EnrollDeviceResponse(long HardwareId, string EnrollmentCode, DateTimeOffset ExpiresAt);

// Kit types whose firmware can complete a claim. Checked so a hardware row never
// sits at 'enrolled' forever. Matches KIT_TYPES in the admin's agroFlowApi.ts.
internal static class EnrollableKitTypes
{
    public const string Default = "ESP32";

    public static readonly string[] Supported = { Default };
}

// FirmwareVersion is what the board runs at claim time (shown on the Kit screen).
// Optional so older boards can still claim.
public record ClaimDeviceRequest(string DeviceId, string EnrollmentCode, string? FirmwareVersion);

// FarmId is returned with ZoneId because the firmware needs both for its MQTT
// topics (see hardware/shared/MQTT_TOPICS.md).
// Security: DeviceToken is returned only once, here. The server keeps only its
// SHA-256 hash, so a board that loses it needs a new enrollment code.
// The MQTT login may be empty if the pool is used up; the board then asks
// GET /api/devices/mqtt-credentials on first connect.
public record ClaimDeviceResponse(
    long ZoneId,
    long FarmId,
    long HardwareId,
    string DeviceToken,
    string MqttUsername,
    string MqttPassword);

// MqttHost/MqttPort are optional: the server leaves them out when Mqtt:Host /
// Mqtt:Port are unset, and the board then uses its compiled-in broker.
// This lets us move brokers (HiveMQ Cloud Serverless retires on 31 Dec 2026)
// with a Railway setting instead of reflashing every board.
// They are nullable so "not set" stays visible; the firmware treats null and
// missing the same.
public record MqttCredentialsResponse(
    string MqttUsername,
    string MqttPassword,
    string? MqttHost,
    int? MqttPort);

public record FirmwareCheckResponse(bool UpdateAvailable, string? LatestVersion, string? DownloadUrl);

public static class DeviceEnrollmentEndpoints
{
    // Security: how long an unused enrollment code stays valid. Codes are single-use
    // anyway; this limits how long a code on a stored kit remains a live secret.
    private static readonly TimeSpan EnrollmentCodeLifetime = TimeSpan.FromHours(24);

    // No 0/O/1/I/L, which are easy to confuse when copying a code by hand.
    private const string CodeAlphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
    private const int CodeLength = 8;

    public static void MapDeviceEnrollmentEndpoints(this WebApplication app)
    {
        // Security: admin only (Supabase JWT + profile.role = 'admin' via
        // AdminOnlyFilter). Exempt from the device-key middleware because a person calls it.
        app.MapPost("/api/devices/enroll", EnrollAsync)
            .RequireAuthorization()
            .AddEndpointFilter<AdminOnlyFilter>();

        // Security: device-facing, and the enrollment code is the only authorisation.
        // A newly flashed board has no credentials until this call answers, so we cannot
        // require a device key. The code is one-time and expires after 24 hours, and
        // ClaimRateLimiter protects against brute force.
        app.MapPost("/api/devices/claim", ClaimAsync);

        // Called on every boot, so a new MQTT password reaches all boards without a
        // reflash. The board keeps it in RAM only.
        app.MapGet("/api/devices/mqtt-credentials", MqttCredentialsAsync);

        app.MapGet("/api/devices/firmware-check", FirmwareCheckAsync);
    }

    private static async Task<IResult> EnrollAsync(
        EnrollDeviceRequest request,
        System.Security.Claims.ClaimsPrincipal user,
        NpgsqlDataSource dataSource,
        AgroFlow.Api.Services.AuditLog audit)
    {
        if (request.ZoneId <= 0)
        {
            return Results.BadRequest("zoneId is required.");
        }

        var deviceType = string.IsNullOrWhiteSpace(request.DeviceType)
            ? EnrollableKitTypes.Default
            : request.DeviceType.Trim();

        if (!EnrollableKitTypes.Supported.Contains(deviceType, StringComparer.OrdinalIgnoreCase))
        {
            return Results.BadRequest(new
            {
                error = $"'{deviceType}' is not a kit AgroFlow can enrol. " +
                        $"Supported: {string.Join(", ", EnrollableKitTypes.Supported)}.",
            });
        }

        var code = GenerateEnrollmentCode();
        var expiresAt = DateTimeOffset.UtcNow.Add(EnrollmentCodeLifetime);

        await using var connection = await dataSource.OpenConnectionAsync();
        await using var cmd = new NpgsqlCommand(
            "insert into hardware (device_name, device_type, zone_id, device_id, enrollment_status, enrollment_code, enrollment_code_expires_at) " +
            "values ($1, $2, $3, $4, 'enrolled', $5, $6) returning hardware_id", connection);
        cmd.Parameters.AddWithValue(request.DeviceName ?? $"Zone {request.ZoneId} {deviceType}");
        cmd.Parameters.AddWithValue(deviceType);
        cmd.Parameters.AddWithValue(request.ZoneId);
        cmd.Parameters.AddWithValue((object?)request.DeviceId?.Trim().ToUpperInvariant() ?? DBNull.Value);
        cmd.Parameters.AddWithValue(code);
        cmd.Parameters.AddWithValue(expiresAt);

        var hardwareId = (long)(await cmd.ExecuteScalarAsync())!;

        // Security: the code itself is never logged, because it is a live credential.
        // We log who created it, for which zone and when.
        await audit.WriteAsync(
            user, AgroFlow.Api.Services.AuditActions.EnrollmentCodeCreated,
            "hardware", hardwareId.ToString(),
            details: new { zoneId = request.ZoneId, deviceType, expiresAt });

        return Results.Ok(new EnrollDeviceResponse(hardwareId, code, expiresAt));
    }

    private static async Task<IResult> ClaimAsync(
        ClaimDeviceRequest request,
        HttpContext context,
        NpgsqlDataSource dataSource,
        MqttCredentialPoolService pool,
        ClaimRateLimiter rateLimiter,
        ILoggerFactory loggerFactory,
        AgroFlow.Api.Services.Notifications.INotificationService notifications,
        CancellationToken cancellationToken)
    {
        var logger = loggerFactory.CreateLogger("AgroFlow.Api.DeviceClaim");
        var address = ClaimRateLimiter.ResolveAddress(context);
        var now = DateTimeOffset.UtcNow;

        // Checked before reading the body, so a blocked address cannot keep using the database.
        if (rateLimiter.IsBlocked(address, now))
        {
            return Results.Json(
                new { error = "Too many failed enrollment codes from this address. Try again in a few minutes." },
                statusCode: StatusCodes.Status429TooManyRequests);
        }

        if (string.IsNullOrWhiteSpace(request.DeviceId) || string.IsNullOrWhiteSpace(request.EnrollmentCode))
        {
            // A malformed body is a bug or a probe, not a wrong code, so it does not count
            // against the limit (a broken board must not lock out the installer).
            return Results.BadRequest("deviceId and enrollmentCode are required.");
        }

        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);

        long hardwareId;
        long zoneId;
        long farmId;
        string? existingDeviceId;

        // Row lock so two claims with the same code (e.g. a retry) cannot both succeed.
        // Joined to zone for farm_id, which the firmware needs for its MQTT topics.
        await using (var lookupCmd = new NpgsqlCommand(
            "select h.hardware_id, h.zone_id, z.farm_id, h.device_id " +
            "from hardware h join zone z on z.id = h.zone_id " +
            "where h.enrollment_code = $1 and h.enrollment_status = 'enrolled' " +
            "and h.enrollment_code_expires_at > now() for update", connection, transaction))
        {
            lookupCmd.Parameters.AddWithValue(request.EnrollmentCode.Trim().ToUpperInvariant());
            await using var reader = await lookupCmd.ExecuteReaderAsync(cancellationToken);
            if (!await reader.ReadAsync(cancellationToken))
            {
                await reader.CloseAsync();
                await transaction.RollbackAsync(cancellationToken);

                rateLimiter.RecordFailure(address, now);

                return Results.Json(new { error = "Invalid, expired, or already-used enrollment code." },
                    statusCode: StatusCodes.Status401Unauthorized);
            }

            hardwareId = reader.GetInt64(0);
            zoneId = reader.GetInt64(1);
            farmId = reader.GetInt64(2);
            existingDeviceId = reader.IsDBNull(3) ? null : reader.GetString(3);
        }

        var claimedDeviceId = request.DeviceId.Trim().ToUpperInvariant();

        // Security: if the admin entered the device ID when enrolling, it must match, so
        // a leaked code cannot be used by a different board. If they used a placeholder
        // (the usual case, since ESP32 IDs are not printed on the board), we store the ID
        // the device sends.
        if (existingDeviceId is not null && existingDeviceId != claimedDeviceId)
        {
            await transaction.RollbackAsync(cancellationToken);

            rateLimiter.RecordFailure(address, now);

            return Results.Json(new { error = "Device ID does not match the device this code was issued for." },
                statusCode: StatusCodes.Status401Unauthorized);
        }

        // Security: the token is created here, returned once and stored only as a hash.
        var deviceToken = DeviceToken.Generate();
        var deviceTokenHash = DeviceToken.Hash(deviceToken);

        await using (var updateCmd = new NpgsqlCommand(
            "update hardware set device_id = $1, enrollment_status = 'active', " +
            "enrollment_code = null, enrollment_code_expires_at = null, status = 'Online', last_seen = now(), " +
            // A re-enrolled board gets a new token and its revocation is cleared. The old
            // token stops working as soon as this row changes.
            "device_token_hash = $3, token_issued_at = now(), token_revoked_at = null, " +
            "firmware_version = coalesce($4, firmware_version) " +
            "where hardware_id = $2", connection, transaction))
        {
            updateCmd.Parameters.AddWithValue(claimedDeviceId);
            updateCmd.Parameters.AddWithValue(hardwareId);
            updateCmd.Parameters.AddWithValue(deviceTokenHash);
            updateCmd.Parameters.AddWithValue((object?)request.FirmwareVersion?.Trim() ?? DBNull.Value);
            await updateCmd.ExecuteNonQueryAsync(cancellationToken);
        }

        // The MQTT login is assigned in the same transaction as the claim, so either
        // both are saved or neither is.
        MqttCredential? assigned = null;
        try
        {
            assigned = await pool.AssignToDeviceAsync(connection, transaction, claimedDeviceId, cancellationToken);
        }
        catch (Exception ex)
        {
            // The claim must not fail. A board without a pooled login still works on the
            // shared login and can get its own later; a board that cannot enrol needs a site visit.
            logger.LogError(ex,
                "Could not assign a pooled MQTT login to device {DeviceId}; completing the claim with the " +
                "shared credential.", claimedDeviceId);
        }

        await transaction.CommitAsync(cancellationToken);

        rateLimiter.RecordSuccess(address);

        // Once per claim (a code works once): the zone's farmers learn the kit is connected and
        // its setup Wi-Fi. Never the enrollment code.
        await notifications.NotifyKitConnectedAsync(zoneId, claimedDeviceId, cancellationToken);

        // Falls back to the shared login outside the transaction (it is only a config read).
        var credential = assigned;
        if (credential is null)
        {
            credential = await pool.ResolveForDeviceAsync(claimedDeviceId, cancellationToken);

            // Admin warning when the pool is used up, worded like the admin page so
            // searching one finds the other.
            logger.LogWarning(
                "ADMIN ALERT: {Alert} Device {DeviceId} on zone {ZoneId} enrolled with the shared MQTT " +
                "credential. Create logins in the HiveMQ console and paste them into the admin MQTT logins page.",
                MqttCredentialResolution.PoolEmptyAlert, claimedDeviceId, zoneId);
        }

        logger.LogInformation(
            "Device {DeviceId} claimed zone {ZoneId} on farm {FarmId}, firmware {Firmware}, MQTT login from {Source}.",
            claimedDeviceId, zoneId, farmId, request.FirmwareVersion ?? "unreported", credential.Source);

        return Results.Ok(new ClaimDeviceResponse(
            zoneId, farmId, hardwareId, deviceToken, credential.Username, credential.Password));
    }

    // Security: the board asks for this on every boot and keeps it in RAM only.
    // It needs a valid device token because the answer is a live broker password,
    // so legacy shared-key boards cannot get one.
    private static async Task<IResult> MqttCredentialsAsync(
        HttpContext context,
        DeviceAuthService deviceAuth,
        MqttCredentialPoolService pool,
        IConfiguration configuration,
        CancellationToken cancellationToken)
    {
        var device = await deviceAuth.AuthenticateAsync(context, cancellationToken);

        if (device is null || device.IsLegacyApiKey)
        {
            return Results.Json(
                new { error = "A valid X-Device-Token is required." },
                statusCode: StatusCodes.Status401Unauthorized);
        }

        var credential = await pool.ResolveForDeviceAsync(device.DeviceId, cancellationToken);

        if (credential.Source == MqttCredentialSource.None)
        {
            // Nothing to give: 503 instead of empty values, so the board retries instead of
            // connecting with an empty username (rc=4).
            return Results.Problem(
                title: "No MQTT credential is available.",
                detail: "The login pool is empty and no shared Mqtt:Username/Mqtt:Password is configured.",
                statusCode: StatusCodes.Status503ServiceUnavailable);
        }

        // The same keys MqttConnectionService uses, so the API and the boards always
        // point at the same broker. A bad address is worse than none (the board would
        // retry forever), so MqttBrokerAddress checks it.
        var (brokerHost, brokerPort) = MqttBrokerAddress.Resolve(
            configuration["Mqtt:Host"], configuration["Mqtt:Port"]);

        return Results.Ok(new MqttCredentialsResponse(
            credential.Username, credential.Password, brokerHost, brokerPort));
    }

    // LatestVersion and DownloadUrl come from appsettings.json: update both for each
    // release. This endpoint does not host firmware.
    // It needs X-Device-Token, and since boards call every 4 hours we also record
    // which firmware each board runs.
    private static async Task<IResult> FirmwareCheckAsync(
        string? currentVersion,
        HttpContext context,
        DeviceAuthService deviceAuth,
        IConfiguration configuration,
        CancellationToken cancellationToken)
    {
        var device = await deviceAuth.AuthenticateAsync(context, cancellationToken);

        if (device is null)
        {
            return Results.Json(
                new { error = "A valid X-Device-Token is required." },
                statusCode: StatusCodes.Status401Unauthorized);
        }

        if (!device.IsLegacyApiKey)
        {
            await deviceAuth.RecordFirmwareVersionAsync(device.HardwareId, currentVersion, cancellationToken);
        }

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
