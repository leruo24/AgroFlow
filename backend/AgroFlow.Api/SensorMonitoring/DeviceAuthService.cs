using AgroFlow.Business;
using Npgsql;

namespace AgroFlow.Api.Services;

// Security: the device a request came from, taken from its own credential, so a
// board can only ever act as itself (not as whatever deviceId it sends).
public sealed record AuthenticatedDevice(
    long HardwareId,
    string DeviceId,
    long ZoneId,
    long FarmId,
    bool IsLegacyApiKey);

// Resolves X-Device-Token (or, while Devices:LegacyApiKeyEnabled is on, the old
// shared X-Api-Key) to a specific board. A service instead of an endpoint filter
// because each endpoint needs the resolved device, not just a yes/no.
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

    // Defaults to true: two boards in the field still run old firmware with no token,
    // and turning this off before they are re-enrolled would take them offline.
    public bool LegacyApiKeyEnabled =>
        !bool.TryParse(_configuration["Devices:LegacyApiKeyEnabled"], out var enabled) || enabled;

    // Security: null means refuse. The caller returns a bare 401; the reason is only
    // logged here, since the board reacts the same to every case.
    public async Task<AuthenticatedDevice?> AuthenticateAsync(
        HttpContext context, CancellationToken cancellationToken = default)
    {
        var presented = context.Request.Headers[TokenHeader].ToString();

        if (DeviceToken.LooksLikeToken(presented))
        {
            var device = await ResolveByTokenAsync(presented, cancellationToken);
            if (device is not null) return device;

            // A valid-looking token that matched nothing is revoked or unknown;
            // ResolveByTokenAsync has already logged which.
            return null;
        }

        // No usable token: fall back to the shared key only while the flag allows it.
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

        // Finds the board and its zone/farm in one query, since every caller needs all
        // three. token_revoked_at is returned, not filtered in SQL, so a revoked token is
        // logged as revoked instead of unknown.
        await using var cmd = new NpgsqlCommand(
            "select h.hardware_id, h.device_id, h.zone_id, z.farm_id, h.token_revoked_at " +
            "from hardware h join zone z on z.id = h.zone_id " +
            "where h.device_token_hash = $1", connection);
        cmd.Parameters.AddWithValue(hash);

        await using var reader = await cmd.ExecuteReaderAsync(cancellationToken);

        if (!await reader.ReadAsync(cancellationToken))
        {
            // Security: never log the token or its hash; a hash is a fingerprint of a live credential.
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
            // A token with no device_id. The claim path sets both together, but we guard it
            // because the ACK ownership check relies on device_id.
            _logger.LogError(
                "Hardware {HardwareId} has a device token but no device_id - refusing the request.", hardwareId);

            return null;
        }

        return new AuthenticatedDevice(hardwareId, deviceId, zoneId, farmId, IsLegacyApiKey: false);
    }

    // The old shared-key path. The key only proves "a real AgroFlow board", not which
    // one, so the caller must trust the deviceId in the request. That is the weakness
    // the token removes, so we log every use.
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

        // Shared-key callers get no device identity. The zeroes are on purpose: a caller
        // that needs a real identity must check IsLegacyApiKey instead of acting on hardware 0.
        await Task.CompletedTask;

        return new AuthenticatedDevice(0, string.Empty, 0, 0, IsLegacyApiKey: true);
    }

    // Records the firmware version a board reports, for the Kit screen, the admin
    // hardware page and deciding when to turn off the legacy flag.
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
            // Bookkeeping only: a board must never fail a reading or ACK because we could
            // not record its version.
            _logger.LogWarning(ex, "Could not record the firmware version for hardware {HardwareId}.", hardwareId);
        }
    }
}
