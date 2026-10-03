using AgroFlow.Business;
using Npgsql;

namespace AgroFlow.Api.Services;

// The device this request came from, resolved from its own credential.
//
// This is the point of the whole v1.3.0 token change. Every device endpoint
// used to take the board's word for which device it was - the ACK endpoint
// read a deviceId out of the request body and compared it to the zone's
// hardware row, which is only as trustworthy as the shared X-Api-Key that
// every board carried. Now the identity comes OUT of the credential, so a
// board can only ever act as itself.
public sealed record AuthenticatedDevice(
    long HardwareId,
    string DeviceId,
    long ZoneId,
    long FarmId,
    bool IsLegacyApiKey);

// Resolves X-Device-Token (or, while Devices:LegacyApiKeyEnabled is on, the
// old shared X-Api-Key) to a specific board.
//
// WHY A SERVICE AND NOT AN ENDPOINT FILTER
// ----------------------------------------
// An IEndpointFilter would be the tidier ASP.NET shape, but every device
// endpoint needs the RESOLVED DEVICE, not just a yes/no - the ACK needs its
// zone, the credential endpoint needs its device_id, firmware-check needs to
// record its version. Passing that through filter metadata would be more
// indirection than four call sites are worth.
public sealed class DeviceAuthService
{
    public const string TokenHeader = "X-Device-Token";
    public const string LegacyApiKeyHeader = "X-Api-Key";

    private readonly NpgsqlDataSource _dataSource;
    private readonly IConfiguration _configuration;
    private readonly ILogger<DeviceAuthService> _logger;

    public DeviceAuthService(
        NpgsqlDataSource dataSource, IConfiguration configuration, ILogger<DeviceAuthService> logger)
    {
        _dataSource = dataSource;
        _configuration = configuration;
        _logger = logger;
    }

    // Default TRUE. Two boards are in the field on v1.1.0 with no token at
    // all, and flipping this to false before they are re-enrolled would take
    // them offline - including their ability to report the readings that are
    // the only evidence they need re-enrolling. See the report for how to
    // retire it.
    public bool LegacyApiKeyEnabled =>
        !bool.TryParse(_configuration["Devices:LegacyApiKeyEnabled"], out var enabled) || enabled;

    // Null means "refuse this request". The caller returns a bare 401 with no
    // detail: which of the failure modes it was is useful in the log here and
    // useless to the board, which reacts identically to all of them.
    public async Task<AuthenticatedDevice?> AuthenticateAsync(
        HttpContext context, CancellationToken cancellationToken = default)
    {
        var presented = context.Request.Headers[TokenHeader].ToString();

        if (DeviceToken.LooksLikeToken(presented))
        {
            var device = await ResolveByTokenAsync(presented, cancellationToken);
            if (device is not null) return device;

            // A well-formed token that resolved to nothing is either revoked
            // or unknown; ResolveByTokenAsync has already logged which.
            return null;
        }

        // No usable token header. Fall back to the shared key only while the
        // flag allows it.
        if (!LegacyApiKeyEnabled)
        {
            _logger.LogWarning(
                "Refused a device request to {Path} with no usable {Header} - " +
                "Devices:LegacyApiKeyEnabled is off, so the shared key is no longer accepted.",
                context.Request.Path, TokenHeader);

            return null;
        }

        return await ResolveByLegacyApiKeyAsync(context, cancellationToken);
    }

    private async Task<AuthenticatedDevice?> ResolveByTokenAsync(
        string presentedToken, CancellationToken cancellationToken)
    {
        var hash = DeviceToken.Hash(presentedToken);

        await using var connection = await _dataSource.OpenConnectionAsync(cancellationToken);

        // Resolves the board AND its zone/farm in one hop, because every
        // caller needs all three. token_revoked_at comes back rather than
        // being filtered in SQL so that a revoked token can be logged as
        // revoked instead of as unknown - the two mean different things to
        // whoever is reading the log.
        await using var cmd = new NpgsqlCommand(
            "select h.hardware_id, h.device_id, h.zone_id, z.farm_id, h.token_revoked_at " +
            "from hardware h join zone z on z.id = h.zone_id " +
            "where h.device_token_hash = $1", connection);
        cmd.Parameters.AddWithValue(hash);

        await using var reader = await cmd.ExecuteReaderAsync(cancellationToken);

        if (!await reader.ReadAsync(cancellationToken))
        {
            // Deliberately does not log the token or its hash. A hash is a
            // verifiable fingerprint of a live credential and has no business
            // in a log aggregator.
            _logger.LogWarning("Refused a device request: unknown {Header}.", TokenHeader);
            return null;
        }

        var hardwareId = reader.GetInt64(0);
        var deviceId = reader.IsDBNull(1) ? null : reader.GetString(1);
        var zoneId = reader.GetInt64(2);
        var farmId = reader.GetInt64(3);
        var revokedAt = reader.IsDBNull(4) ? (DateTimeOffset?)null : reader.GetFieldValue<DateTimeOffset>(4);

        if (revokedAt.HasValue)
        {
            _logger.LogWarning(
                "Refused device {DeviceId} (hardware {HardwareId}): token was revoked at {RevokedAt}. " +
                "Three consecutive 401s make the board wipe its credentials and reopen its setup page.",
                deviceId, hardwareId, revokedAt);

            return null;
        }

        if (deviceId is null)
        {
            // A token exists but the row has no device_id. Not reachable
            // through the claim path, which sets both in one statement -
            // guarded because the ACK's ownership check keys off device_id.
            _logger.LogError(
                "Hardware {HardwareId} has a device token but no device_id - refusing the request.", hardwareId);

            return null;
        }

        return new AuthenticatedDevice(hardwareId, deviceId, zoneId, farmId, IsLegacyApiKey: false);
    }

    // The v1.1.0 path. The shared key proves "a genuine AgroFlow board" and
    // nothing more, so the device cannot be resolved from the credential -
    // the caller has to fall back to trusting a deviceId in the request, the
    // way it always did. That is exactly the weakness the token removes, and
    // it is why this is logged every single time rather than once.
    private async Task<AuthenticatedDevice?> ResolveByLegacyApiKeyAsync(
        HttpContext context, CancellationToken cancellationToken)
    {
        var configuredKey = _configuration["ApiKey"];
        var presentedKey = context.Request.Headers[LegacyApiKeyHeader].ToString();

        if (string.IsNullOrEmpty(configuredKey) ||
            !string.Equals(presentedKey, configuredKey, StringComparison.Ordinal))
        {
            _logger.LogWarning(
                "Refused a device request to {Path}: no valid {Token} and no valid {Legacy}.",
                context.Request.Path, TokenHeader, LegacyApiKeyHeader);

            return null;
        }

        _logger.LogWarning(
            "Device request to {Path} authenticated with the LEGACY shared {Legacy} header. " +
            "This board has no per-device token - re-enrol it on firmware 1.3.0, then set " +
            "Devices:LegacyApiKeyEnabled=false to close this path.",
            context.Request.Path, LegacyApiKeyHeader);

        // Shared-key callers are not resolved to a device at all. Zeroes are
        // deliberate: a caller that needs a real identity must check
        // IsLegacyApiKey and fall back to its own (weaker) resolution, rather
        // than silently acting on hardware 0.
        await Task.CompletedTask;

        return new AuthenticatedDevice(0, string.Empty, 0, 0, IsLegacyApiKey: true);
    }

    // Records what a board says it is running. Used by the Kit screen, the
    // admin hardware page, and the decision to retire the legacy flag.
    public async Task RecordFirmwareVersionAsync(
        long hardwareId, string? firmwareVersion, CancellationToken cancellationToken = default)
    {
        if (hardwareId <= 0 || string.IsNullOrWhiteSpace(firmwareVersion)) return;

        try
        {
            await using var connection = await _dataSource.OpenConnectionAsync(cancellationToken);

            await using var cmd = new NpgsqlCommand(
                "update hardware set firmware_version = $1, last_seen = now() where hardware_id = $2", connection);
            cmd.Parameters.AddWithValue(firmwareVersion.Trim());
            cmd.Parameters.AddWithValue(hardwareId);

            await cmd.ExecuteNonQueryAsync(cancellationToken);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // Bookkeeping. A board must never fail to report a reading or
            // acknowledge a command because we could not write down its
            // version number.
            _logger.LogWarning(ex, "Could not record the firmware version for hardware {HardwareId}.", hardwareId);
        }
    }
}
