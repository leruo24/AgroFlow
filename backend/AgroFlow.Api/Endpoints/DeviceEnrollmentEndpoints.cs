using System.Security.Cryptography;
using AgroFlow.Api.Auth;
using AgroFlow.Api.Services;
using AgroFlow.Business;
using Npgsql;

namespace AgroFlow.Api.Endpoints;

public record EnrollDeviceRequest(long ZoneId, string? DeviceId, string? DeviceName);
public record EnrollDeviceResponse(long HardwareId, string EnrollmentCode, DateTimeOffset ExpiresAt);

// FirmwareVersion is new in v1.3.0 - the board reports what it is running at
// claim time, which is what the Kit screen shows and what tells you when
// Devices:LegacyApiKeyEnabled can be retired. Optional, so a v1.1.0 board
// claiming with an old sketch still works.
public record ClaimDeviceRequest(string DeviceId, string EnrollmentCode, string? FirmwareVersion);

// FarmId is included alongside ZoneId because the firmware needs both to
// build its MQTT topics (agroflow/farm/{farmId}/device/{deviceId}/...) - see
// hardware/shared/MQTT_TOPICS.md. Both are persisted to flash on claim.
//
// DeviceToken is returned EXACTLY ONCE, here. The server keeps only its
// SHA-256 hash, so there is no endpoint that can ever return it again - a
// board that loses it needs a fresh enrollment code. MqttUsername/
// MqttPassword may be empty when the pool is exhausted; the firmware treats
// them as optional and falls back to GET /api/devices/mqtt-credentials on
// its first connect.
public record ClaimDeviceResponse(
    long ZoneId,
    long FarmId,
    long HardwareId,
    string DeviceToken,
    string MqttUsername,
    string MqttPassword);

// MqttHost/MqttPort are new in firmware v1.4.0 and are OPTIONAL in both
// directions: the server omits them when Mqtt:Host / Mqtt:Port are unset, and
// the board falls back to its compiled-in MQTT_HOST/MQTT_PORT when they are
// absent from the response.
//
// WHY THE BROKER ADDRESS IS NOW SERVER-SIDE
// HiveMQ Cloud Serverless is retired on 31 December 2026. Before this, the
// broker hostname was a compiled-in constant, so moving to another broker -
// or to HiveMQ's replacement tier - meant reflashing every board in the
// field, by hand, over USB. It is now a Railway variable: change Mqtt__Host,
// restart the boards, done.
//
// They are nullable rather than defaulted so that "not configured" and
// "configured to something" stay distinguishable. System.Text.Json omits a
// null here only if told to; JsonIgnoreCondition on the properties would be
// one way, but the firmware reads `r["mqttHost"] | ""` and treats an empty or
// absent value identically, so a null serialises to null and the board falls
// back exactly as it would on an absent key.
public record MqttCredentialsResponse(
    string MqttUsername,
    string MqttPassword,
    string? MqttHost,
    int? MqttPort);

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

        // Device-facing and deliberately UNAUTHENTICATED beyond the code
        // itself (v1.3.0; see the Program.cs middleware exemption).
        //
        // It used to also require the shared X-Api-Key. That is exactly the
        // compiled-in fleet secret this release removes from the firmware
        // image, so requiring it here would make the claim impossible: a
        // freshly flashed board has no credential of any kind until this
        // call answers. The one-time, single-use, 24-hour enrollment code IS
        // the authorisation, and every check it used to get it still gets -
        // see ClaimAsync. ClaimRateLimiter replaces the shared key's
        // defence-in-depth role against brute force.
        app.MapPost("/api/devices/claim", ClaimAsync);

        // Called on every boot. This is what lets an MQTT password rotation
        // reach the whole fleet with no reflash - the board holds the answer
        // in RAM only.
        app.MapGet("/api/devices/mqtt-credentials", MqttCredentialsAsync);

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

    private static async Task<IResult> ClaimAsync(
        ClaimDeviceRequest request,
        HttpContext context,
        NpgsqlDataSource dataSource,
        MqttCredentialPoolService pool,
        ClaimRateLimiter rateLimiter,
        ILoggerFactory loggerFactory,
        CancellationToken cancellationToken)
    {
        var logger = loggerFactory.CreateLogger("AgroFlow.Api.DeviceClaim");
        var address = ClaimRateLimiter.ResolveAddress(context);
        var now = DateTimeOffset.UtcNow;

        // Checked before the body is looked at, so a blocked address cannot
        // keep spending database round trips.
        if (rateLimiter.IsBlocked(address, now))
        {
            return Results.Json(
                new { error = "Too many failed enrollment codes from this address. Try again in a few minutes." },
                statusCode: StatusCodes.Status429TooManyRequests);
        }

        if (string.IsNullOrWhiteSpace(request.DeviceId) || string.IsNullOrWhiteSpace(request.EnrollmentCode))
        {
            // A malformed body is a bug or a probe, not a wrong code. It is
            // not counted against the limit, because counting it would let a
            // broken board lock out the installer standing next to it.
            return Results.BadRequest("deviceId and enrollmentCode are required.");
        }

        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);

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

        // If the admin already knew the device ID at enroll time, it must
        // match - extra safety against a leaked code being used by a
        // different physical board than the one it was issued for. If the
        // admin enrolled a placeholder (device ID unknown at the time -
        // ESP32 efuse IDs aren't usually printed on the board, so this is
        // the common case), whatever ID the device presents now is accepted
        // and stored.
        if (existingDeviceId is not null && existingDeviceId != claimedDeviceId)
        {
            await transaction.RollbackAsync(cancellationToken);

            rateLimiter.RecordFailure(address, now);

            return Results.Json(new { error = "Device ID does not match the device this code was issued for." },
                statusCode: StatusCodes.Status401Unauthorized);
        }

        // ------------------------------------------------------------------
        // The token. Minted here, returned once, stored only as a hash.
        // ------------------------------------------------------------------
        var deviceToken = DeviceToken.Generate();
        var deviceTokenHash = DeviceToken.Hash(deviceToken);

        await using (var updateCmd = new NpgsqlCommand(
            "update hardware set device_id = $1, enrollment_status = 'active', " +
            "enrollment_code = null, enrollment_code_expires_at = null, status = 'Online', last_seen = now(), " +
            // A re-enrolled board gets a brand new token and its revocation
            // is cleared: the whole point of re-enrolling is that this board
            // is trusted again. The OLD token stops working the instant this
            // row is updated, because the hash it matched is gone.
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

        // ------------------------------------------------------------------
        // The MQTT login, assigned in THIS transaction (step 4).
        //
        // Same transaction on purpose: a claim that commits without an
        // assignment, or an assignment that commits without a claim, both
        // leave a row that has to be reconciled by hand. Either both land or
        // neither does.
        // ------------------------------------------------------------------
        MqttCredential? assigned = null;
        try
        {
            assigned = await pool.AssignToDeviceAsync(connection, transaction, claimedDeviceId, cancellationToken);
        }
        catch (Exception ex)
        {
            // The claim is the part that must not fail. A board that enrols
            // without a pooled login still works on the shared credential and
            // can pick up its own on any later boot; a board that cannot
            // enrol at all is a site visit.
            logger.LogError(ex,
                "Could not assign a pooled MQTT login to device {DeviceId}; completing the claim with the " +
                "shared credential.", claimedDeviceId);
        }

        await transaction.CommitAsync(cancellationToken);

        rateLimiter.RecordSuccess(address);

        // Falls back to the shared credential outside the transaction - it is
        // a config read, not a write, and the claim is already safe.
        var credential = assigned;
        if (credential is null)
        {
            credential = await pool.ResolveForDeviceAsync(claimedDeviceId, cancellationToken);

            // The admin alert for an exhausted pool. Logged at the point the
            // fallback actually happens, with the exact words the admin page
            // shows, so searching either one finds the other.
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

    // The board asks for this on every boot and keeps the answer in RAM only.
    // Requires a valid device token: the password it returns is a live broker
    // credential, so there is no anonymous or shared-key route to it even
    // while Devices:LegacyApiKeyEnabled is on - a legacy board cannot be
    // resolved to a device, and handing out "some device's" password would
    // defeat the per-device split entirely.
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
            // Nothing to hand over. 503 rather than 200-with-blanks, so the
            // board retries instead of attempting a broker connection with an
            // empty username and reporting a confusing rc=4.
            return Results.Problem(
                title: "No MQTT credential is available.",
                detail: "The login pool is empty and no shared Mqtt:Username/Mqtt:Password is configured.",
                statusCode: StatusCodes.Status503ServiceUnavailable);
        }

        // The same two keys MqttConnectionService already connects with, read
        // here rather than duplicated into a new section - the API and the
        // boards must never be able to point at different brokers.
        // A board given a BAD address is worse off than one given none: with
        // none it falls back to its compiled-in host and keeps working, but
        // with "" or port 0 it retries forever. MqttBrokerAddress is where
        // that rule lives.
        var (brokerHost, brokerPort) = MqttBrokerAddress.Resolve(
            configuration["Mqtt:Host"], configuration["Mqtt:Port"]);

        return Results.Ok(new MqttCredentialsResponse(
            credential.Username, credential.Password, brokerHost, brokerPort));
    }

    // TODO: LatestVersion/DownloadUrl are plain config values (see
    // appsettings.json) - bump LatestVersion and point DownloadUrl at a
    // freshly-compiled .bin every time you cut a release. This endpoint does
    // not host or build firmware itself; see the OTA section of the summary
    // for where the .bin actually needs to live.
    //
    // v1.3.0: now authenticated by X-Device-Token, which also makes this the
    // cheapest place to record what each board is running - it calls in every
    // 4 hours whether or not an update exists.
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
