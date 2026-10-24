using AgroFlow.Api.Auth;
using AgroFlow.Api.Mqtt;
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

// FarmId is returned with ZoneId because firmware up to 1.7.1 needs both for its MQTT
// topics (see hardware/shared/MQTT_TOPICS.md). Firmware 1.7.2 uses Topics instead.
// Security: DeviceToken is returned only once per claim. The server keeps only its
// SHA-256 hash. The MQTT login is AgroFlow's existing one (Mqtt:Username/Password, the same
// the API connects with): nothing is created in the HiveMQ console. The kit keeps it in NVS
// and never prints it.
public record ClaimDeviceResponse(
    long ZoneId,
    long FarmId,
    long HardwareId,
    string DeviceToken,
    string MqttUsername,
    string MqttPassword,
    string? MqttHost = null,
    int? MqttPort = null,
    bool MqttTls = true,
    KitLink.Topics? Topics = null,
    string? FarmName = null,
    string? ZoneName = null);

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
    public static void MapDeviceEnrollmentEndpoints(this WebApplication app)
    {
        // Security: admin only (Supabase JWT + profile.role = 'admin' via
        // AdminOnlyFilter). Exempt from the device-key middleware because a person calls it.
        app.MapPost("/api/devices/enroll", EnrollAsync)
            .RequireAuthorization()
            .AddEndpointFilter<AdminOnlyFilter>();

        // Security: device-facing, and the setup code is the only authorisation.
        // A newly flashed board has no credentials until this call answers, so we cannot
        // require a device key. The code links one kit, expires after 30 minutes, and
        // ClaimRateLimiter protects against guessing.
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

        await using var connection = await dataSource.OpenConnectionAsync();
        var issued = await KitCodes.IssueAsync(connection, request.ZoneId,
            request.DeviceName ?? $"Zone {request.ZoneId} {deviceType}", deviceType,
            request.DeviceId?.Trim().ToUpperInvariant());
        if (issued is null) return Results.NotFound(new { error = "No such zone." });
        var (hardwareId, code, expiresAt) = issued.Value;

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
        IConfiguration configuration,
        ClaimRateLimiter rateLimiter,
        KitLinkAttempts attempts,
        IMqttPublisher mqtt,
        ILoggerFactory loggerFactory,
        CancellationToken cancellationToken)
    {
        var logger = loggerFactory.CreateLogger("AgroFlow.Api.DeviceClaim");
        var address = ClaimRateLimiter.ResolveAddress(context);
        var now = DateTimeOffset.UtcNow;

        // Checked before reading the body, so a blocked address cannot keep using the database.
        if (rateLimiter.IsBlocked(address, now))
        {
            return Results.Json(
                new { error = "Too many wrong codes from this network. Wait 15 minutes and try again.", code = "rate_limited" },
                statusCode: StatusCodes.Status429TooManyRequests);
        }

        if (string.IsNullOrWhiteSpace(request.DeviceId) || string.IsNullOrWhiteSpace(request.EnrollmentCode))
        {
            // A malformed body is a bug or a probe, not a wrong code, so it does not count
            // against the limit (a broken board must not lock out the installer).
            return Results.BadRequest("deviceId and enrollmentCode are required.");
        }

        // The kit gets AgroFlow's existing MQTT login and broker: the ones the API itself uses.
        var mqttUser = configuration["Mqtt:Username"];
        var mqttPass = configuration["Mqtt:Password"];
        if (string.IsNullOrWhiteSpace(mqttUser) || string.IsNullOrWhiteSpace(mqttPass))
        {
            logger.LogError("A kit tried to link but Mqtt:Username/Mqtt:Password are not set on the API.");
            return Results.Json(new { error = "AgroFlow's MQTT login is not set up. Tell AgroFlow staff.", code = "mqtt_not_configured" },
                statusCode: StatusCodes.Status503ServiceUnavailable);
        }
        var (brokerHost, brokerPort) = MqttBrokerAddress.Resolve(configuration["Mqtt:Host"], configuration["Mqtt:Port"]);
        var useTls = !string.Equals(configuration["Mqtt:UseTls"], "false", StringComparison.OrdinalIgnoreCase);

        var code = KitLink.NormaliseCode(request.EnrollmentCode);
        var deviceId = request.DeviceId.Trim().ToUpperInvariant();

        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);

        // The code's row, even when expired or used, so the kit can say which. Locked, so two
        // claims with the same code (a retry) run one after the other.
        long hardwareId = 0, zoneId = 0, farmId = 0;
        string farmName = "", zoneName = "";
        KitLink.CodeRow? row = null;
        await using (var lookup = new NpgsqlCommand("""
            select h.hardware_id, h.zone_id, z.farm_id, h.device_id, h.enrollment_status, h.enrollment_code_expires_at,
                   f.name, coalesce(nullif(z.name, ''), 'Zone ' || z.id)
              from hardware h join zone z on z.id = h.zone_id join farm f on f.farm_id = z.farm_id
             where h.enrollment_code = $1
             for update of h
            """, connection, transaction))
        {
            lookup.Parameters.AddWithValue(code);
            await using var reader = await lookup.ExecuteReaderAsync(cancellationToken);
            if (await reader.ReadAsync(cancellationToken))
            {
                hardwareId = reader.GetInt64(0);
                zoneId = reader.GetInt64(1);
                farmId = reader.GetInt64(2);
                farmName = reader.GetString(6);
                zoneName = reader.GetString(7);
                row = new KitLink.CodeRow(
                    reader.GetString(4),
                    reader.IsDBNull(3) ? null : reader.GetString(3),
                    reader.IsDBNull(5) ? null : reader.GetFieldValue<DateTimeOffset>(5),
                    farmId);
            }
        }

        // Where this kit is linked now (another row), if anywhere.
        long? currentFarmId = null;
        string? currentFarmName = null;
        await using (var current = new NpgsqlCommand("""
            select z.farm_id, f.name from hardware h join zone z on z.id = h.zone_id join farm f on f.farm_id = z.farm_id
             where h.device_id = $1 and h.enrollment_status = 'active' and h.hardware_id <> $2
             limit 1
            """, connection, transaction))
        {
            current.Parameters.AddWithValue(deviceId);
            current.Parameters.AddWithValue(hardwareId);
            await using var reader = await current.ExecuteReaderAsync(cancellationToken);
            if (await reader.ReadAsync(cancellationToken))
            {
                currentFarmId = reader.GetInt64(0);
                currentFarmName = reader.GetString(1);
            }
        }

        var outcome = KitLink.Decide(row, deviceId, currentFarmId, now);
        if (outcome is not (KitLink.ClaimOutcome.Link or KitLink.ClaimOutcome.Retry))
        {
            await transaction.RollbackAsync(cancellationToken);
            // A wrong, expired or wrong-kit code counts towards the limit. A real code that is used,
            // or a kit still linked elsewhere, does not: the installer has the right code.
            if (outcome is KitLink.ClaimOutcome.CodeInvalid or KitLink.ClaimOutcome.CodeExpired or KitLink.ClaimOutcome.WrongKit)
                rateLimiter.RecordFailure(address, now);
            var (status, reason, message) = KitLink.Refusal(outcome, currentFarmName);
            if (row is not null) attempts.Record(hardwareId, reason, message, deviceId, now);
            logger.LogInformation("Kit {DeviceId} claim refused: {Reason}.", deviceId, reason);
            return Results.Json(new { error = message, code = reason }, statusCode: status);
        }

        // Security: a new token on every claim, returned once and stored only as a hash.
        var deviceToken = DeviceToken.Generate();
        var replacedKits = new List<string>();

        if (outcome == KitLink.ClaimOutcome.Link)
        {
            // The links this one ends: this kit elsewhere on the same farm (moved), and another kit
            // on this zone (replaced). Their rows, readings and history stay; their tokens stop working.
            await using var end = new NpgsqlCommand("""
                update hardware set enrollment_status = 'replaced', status = 'Offline', token_revoked_at = now()
                 where enrollment_status = 'active' and hardware_id <> $1 and (device_id = $2 or zone_id = $3)
                returning device_id
                """, connection, transaction);
            end.Parameters.AddWithValue(hardwareId);
            end.Parameters.AddWithValue(deviceId);
            end.Parameters.AddWithValue(zoneId);
            await using var reader = await end.ExecuteReaderAsync(cancellationToken);
            while (await reader.ReadAsync(cancellationToken))
                if (!reader.IsDBNull(0) && reader.GetString(0) != deviceId) replacedKits.Add(reader.GetString(0));
        }

        // The code stays on the row until it expires, so the same kit sending it again (its page
        // retried, or the answer was lost) is answered again instead of told "already used".
        await using (var link = new NpgsqlCommand("""
            update hardware set device_id = $1, enrollment_status = 'active', status = 'Online', last_seen = now(),
                   status_reported_at = case when enrollment_status = 'active' then status_reported_at end,
                   device_token_hash = $3, token_issued_at = now(), token_revoked_at = null,
                   firmware_version = coalesce($4, firmware_version)
             where hardware_id = $2
            """, connection, transaction))
        {
            link.Parameters.AddWithValue(deviceId);
            link.Parameters.AddWithValue(hardwareId);
            link.Parameters.AddWithValue(DeviceToken.Hash(deviceToken));
            link.Parameters.AddWithValue((object?)request.FirmwareVersion?.Trim() ?? DBNull.Value);
            await link.ExecuteNonQueryAsync(cancellationToken);
        }

        await transaction.CommitAsync(cancellationToken);
        rateLimiter.RecordSuccess(address);
        attempts.Clear(hardwareId);

        // The replaced kit forgets its link and reopens its setup hotspot (firmware 1.7.2). An older
        // kit ignores the message; its revoked token makes it reset itself after three refusals.
        foreach (var old in replacedKits) await KitCommands.SendUnlinkAsync(mqtt, old, logger);

        logger.LogInformation(
            "Kit {DeviceId} {Outcome} zone {ZoneId} on farm {FarmId}, firmware {Firmware}.",
            deviceId, outcome == KitLink.ClaimOutcome.Retry ? "re-confirmed on" : "linked to", zoneId, farmId,
            request.FirmwareVersion ?? "unreported");

        return Results.Ok(new ClaimDeviceResponse(
            zoneId, farmId, hardwareId, deviceToken, mqttUser, mqttPass,
            brokerHost, brokerPort, useTls, KitLink.TopicsFor(deviceId), farmName, zoneName));
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
}
