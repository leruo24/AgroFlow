using AgroFlow.Business;
using Npgsql;

namespace AgroFlow.Api.Services;

// A login handed to a board, and where it came from.
public sealed record MqttCredential(string Username, string Password, MqttCredentialSource Source);

// One row of the admin "MQTT logins" page. Note what is absent: the password.
// It is never returned by this service to anything except the device that
// owns it.
public sealed record MqttPoolEntry(
    long Id,
    string Username,
    string Status,
    string? AssignedDeviceId,
    DateTimeOffset? AssignedAt,
    DateTimeOffset? BurnedAt,
    DateTimeOffset CreatedAt);

public sealed record MqttPoolSummary(
    IReadOnlyList<MqttPoolEntry> Entries, int FreeCount, int AssignedCount, int BurnedCount, bool RunningLow);

// Hands out the hand-created HiveMQ logins in mqtt_credential_pool
// (migration 0029).
//
// WHY THIS IS NOT JUST A QUERY
// ----------------------------
// Assignment has to be exactly-once under concurrency. Two boards claiming
// within the same second - which happens on an install day when an engineer
// powers up a batch - must not be handed the same login, because the second
// board's connection would evict the first from the broker and the two would
// then fight over the session indefinitely. `for update skip locked` is what
// makes that impossible: each transaction locks a different row, and a
// transaction that finds every candidate locked takes the next one rather
// than blocking.
public sealed class MqttCredentialPoolService
{
    private readonly NpgsqlDataSource _dataSource;
    private readonly IConfiguration _configuration;
    private readonly ILogger<MqttCredentialPoolService> _logger;

    public MqttCredentialPoolService(
        NpgsqlDataSource dataSource, IConfiguration configuration, ILogger<MqttCredentialPoolService> logger)
    {
        _dataSource = dataSource;
        _configuration = configuration;
        _logger = logger;
    }

    // Resolved per call rather than cached, so rotating Mqtt:PoolEncryptionKey
    // on Railway takes effect on the next request instead of the next deploy.
    private byte[] EncryptionKey => MqttPoolSecretBox.ParseKey(_configuration["Mqtt:PoolEncryptionKey"]);

    public bool IsConfigured => !string.IsNullOrWhiteSpace(_configuration["Mqtt:PoolEncryptionKey"]);

    // ------------------------------------------------------------------
    // CLAIM-TIME ASSIGNMENT
    // ------------------------------------------------------------------

    // Assigns the oldest free, non-burned login to this device, INSIDE the
    // caller's claim transaction. Returns null when the pool is empty - the
    // caller then falls back to the shared credential and raises the alert,
    // because a claim that fails outright leaves an engineer standing in a
    // field with a kit that will not enrol.
    public async Task<MqttCredential?> AssignToDeviceAsync(
        NpgsqlConnection connection,
        NpgsqlTransaction transaction,
        string deviceId,
        CancellationToken cancellationToken = default)
    {
        if (!IsConfigured)
        {
            _logger.LogWarning(
                "Mqtt:PoolEncryptionKey is not set, so no pooled MQTT login can be read. " +
                "Device {DeviceId} will use the shared credential.", deviceId);

            return null;
        }

        // A re-enrolled or factory-reset board claims again. It must end up
        // with exactly one login, so an existing assignment is REUSED rather
        // than a second one taken - otherwise every factory reset would eat
        // another entry out of a pool that has to be refilled by hand.
        //
        // A burned row is excluded: that password is loose in the world and
        // must be rotated in the HiveMQ console before it is used again, so
        // the board gets a fresh assignment below instead.
        await using (var existing = new NpgsqlCommand(
            "select id, username, password_encrypted from mqtt_credential_pool " +
            "where assigned_device_id = $1 and burned_at is null", connection, transaction))
        {
            existing.Parameters.AddWithValue(deviceId);

            await using var reader = await existing.ExecuteReaderAsync(cancellationToken);
            if (await reader.ReadAsync(cancellationToken))
            {
                var id = reader.GetInt64(0);
                var username = reader.GetString(1);
                var encrypted = reader.GetString(2);
                await reader.CloseAsync();

                var reused = TryDecrypt(id, encrypted);
                if (reused is not null)
                {
                    _logger.LogInformation(
                        "Device {DeviceId} re-claimed and kept its existing MQTT login (pool entry {Id}).",
                        deviceId, id);

                    return new MqttCredential(username, reused, MqttCredentialSource.Pool);
                }

                // Undecryptable: the key was rotated without re-pasting the
                // pool. Fall through and take a fresh entry rather than
                // handing the board a password we cannot read.
                _logger.LogError(
                    "Pool entry {Id} is assigned to device {DeviceId} but could not be decrypted - " +
                    "taking a fresh entry instead. Re-paste the pool after rotating Mqtt:PoolEncryptionKey.",
                    id, deviceId);
            }
        }

        // Oldest free, non-burned entry. `skip locked` is the part that makes
        // concurrent claims safe; `limit 1` without it would have two
        // transactions queue on the same row and the loser would then see it
        // already assigned.
        long poolId;
        string poolUsername;
        string poolEncrypted;

        await using (var pick = new NpgsqlCommand(
            "select id, username, password_encrypted from mqtt_credential_pool " +
            "where assigned_device_id is null and burned_at is null " +
            "order by created_at, id " +
            "for update skip locked limit 1", connection, transaction))
        {
            await using var reader = await pick.ExecuteReaderAsync(cancellationToken);
            if (!await reader.ReadAsync(cancellationToken))
            {
                await reader.CloseAsync();

                _logger.LogWarning(
                    "{Alert} Device {DeviceId} claimed with no pooled login available and will use the " +
                    "shared credential. Create more logins in the HiveMQ console and paste them into " +
                    "the admin MQTT logins page.",
                    MqttCredentialResolution.PoolEmptyAlert, deviceId);

                return null;
            }

            poolId = reader.GetInt64(0);
            poolUsername = reader.GetString(1);
            poolEncrypted = reader.GetString(2);
            await reader.CloseAsync();
        }

        // Release any login this device held before (a factory-reset board
        // whose old entry was burned, say), so the one-login-per-device
        // partial unique index in 0029 cannot be violated by the update
        // below.
        await using (var release = new NpgsqlCommand(
            "update mqtt_credential_pool set assigned_device_id = null, assigned_at = null " +
            "where assigned_device_id = $1 and id <> $2 and burned_at is null", connection, transaction))
        {
            release.Parameters.AddWithValue(deviceId);
            release.Parameters.AddWithValue(poolId);
            await release.ExecuteNonQueryAsync(cancellationToken);
        }

        await using (var assign = new NpgsqlCommand(
            "update mqtt_credential_pool set assigned_device_id = $1, assigned_at = now() " +
            "where id = $2 and assigned_device_id is null and burned_at is null", connection, transaction))
        {
            assign.Parameters.AddWithValue(deviceId);
            assign.Parameters.AddWithValue(poolId);

            if (await assign.ExecuteNonQueryAsync(cancellationToken) == 0)
            {
                // The row changed under the lock. Should be unreachable with
                // `for update`, but a claim must never report a login it did
                // not actually get.
                _logger.LogWarning(
                    "Pool entry {Id} was taken by another claim before device {DeviceId} could be assigned " +
                    "it; falling back to the shared credential for this claim.", poolId, deviceId);

                return null;
            }
        }

        var password = TryDecrypt(poolId, poolEncrypted);
        if (password is null)
        {
            // Assigned but unreadable. The assignment stands - the row is
            // genuinely spoken for - but this board cannot be given the
            // password, so it falls back for now and gets the right one on
            // its next boot once the key is fixed.
            return null;
        }

        _logger.LogInformation(
            "Assigned MQTT pool entry {Id} to device {DeviceId}.", poolId, deviceId);

        return new MqttCredential(poolUsername, password, MqttCredentialSource.Pool);
    }

    // ------------------------------------------------------------------
    // GET /api/devices/mqtt-credentials
    // ------------------------------------------------------------------

    // The board's own login, or the shared one if it has none. Called on
    // every boot, which is what makes a password rotation reach the fleet
    // with no reflash.
    public async Task<MqttCredential> ResolveForDeviceAsync(
        string deviceId, CancellationToken cancellationToken = default)
    {
        string? assignedUsername = null;
        string? assignedPassword = null;

        if (IsConfigured && !string.IsNullOrWhiteSpace(deviceId))
        {
            await using var connection = await _dataSource.OpenConnectionAsync(cancellationToken);

            await using var cmd = new NpgsqlCommand(
                "select id, username, password_encrypted from mqtt_credential_pool " +
                "where assigned_device_id = $1 and burned_at is null", connection);
            cmd.Parameters.AddWithValue(deviceId);

            await using var reader = await cmd.ExecuteReaderAsync(cancellationToken);
            if (await reader.ReadAsync(cancellationToken))
            {
                var id = reader.GetInt64(0);
                assignedUsername = reader.GetString(1);
                assignedPassword = TryDecrypt(id, reader.GetString(2));

                if (assignedPassword is null) assignedUsername = null;
            }
        }

        var sharedUsername = _configuration["Mqtt:Username"];
        var sharedPassword = _configuration["Mqtt:Password"];

        var source = MqttCredentialResolution.Resolve(
            assignedUsername, assignedPassword, sharedUsername, sharedPassword);

        switch (source)
        {
            case MqttCredentialSource.Pool:
                return new MqttCredential(assignedUsername!, assignedPassword!, MqttCredentialSource.Pool);

            case MqttCredentialSource.Shared:
                _logger.LogInformation(
                    "Device {DeviceId} has no pooled MQTT login; serving the shared credential.", deviceId);

                return new MqttCredential(sharedUsername!, sharedPassword!, MqttCredentialSource.Shared);

            default:
                _logger.LogError(
                    "Device {DeviceId} has no pooled MQTT login AND no shared Mqtt:Username/Mqtt:Password is " +
                    "configured - it cannot reach the broker at all.", deviceId);

                return new MqttCredential(string.Empty, string.Empty, MqttCredentialSource.None);
        }
    }

    // ------------------------------------------------------------------
    // ADMIN
    // ------------------------------------------------------------------

    // Adds hand-created logins. Returns how many were stored and how many
    // were already in the pool - pasting the same batch twice is a realistic
    // accident and must not be an error.
    public async Task<(int Added, int Duplicates)> AddAsync(
        IEnumerable<(string Username, string Password)> credentials,
        CancellationToken cancellationToken = default)
    {
        var key = EncryptionKey;
        var added = 0;
        var duplicates = 0;

        await using var connection = await _dataSource.OpenConnectionAsync(cancellationToken);

        foreach (var (username, password) in credentials)
        {
            if (string.IsNullOrWhiteSpace(username) || string.IsNullOrWhiteSpace(password)) continue;

            await using var cmd = new NpgsqlCommand(
                "insert into mqtt_credential_pool (username, password_encrypted) values ($1, $2) " +
                "on conflict (username) do nothing returning id", connection);

            cmd.Parameters.AddWithValue(username.Trim());
            cmd.Parameters.AddWithValue(MqttPoolSecretBox.Encrypt(password, key));

            if (await cmd.ExecuteScalarAsync(cancellationToken) is null) duplicates++;
            else added++;
        }

        // Usernames are safe to log; the password never appears in any log
        // line in this file.
        _logger.LogInformation(
            "MQTT login pool: {Added} added, {Duplicates} already present.", added, duplicates);

        return (added, duplicates);
    }

    public async Task<MqttPoolSummary> ListAsync(CancellationToken cancellationToken = default)
    {
        var entries = new List<MqttPoolEntry>();

        await using var connection = await _dataSource.OpenConnectionAsync(cancellationToken);

        // password_encrypted is deliberately NOT selected. The admin page has
        // no use for it, and a value that is never read cannot be leaked by
        // a logging change or a serialisation mistake later.
        await using var cmd = new NpgsqlCommand(
            "select p.id, p.username, p.assigned_device_id, p.assigned_at, p.burned_at, p.created_at, " +
            "       h.device_name, z.name " +
            "from mqtt_credential_pool p " +
            "left join hardware h on h.device_id = p.assigned_device_id " +
            "left join zone z on z.id = h.zone_id " +
            "order by p.burned_at nulls first, p.assigned_at nulls first, p.created_at", connection);

        await using var reader = await cmd.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            var assignedDeviceId = reader.IsDBNull(2) ? null : reader.GetString(2);
            var burnedAt = reader.IsDBNull(4) ? (DateTimeOffset?)null : reader.GetFieldValue<DateTimeOffset>(4);
            var deviceName = reader.IsDBNull(6) ? null : reader.GetString(6);
            var zoneName = reader.IsDBNull(7) ? null : reader.GetString(7);

            // "assigned to kit X" wants a name a person recognises, so the
            // zone or device name is preferred over the efuse ID. The ID is
            // returned separately for the cases where that is what you need.
            var kit = zoneName ?? deviceName ?? assignedDeviceId;

            var status = burnedAt.HasValue
                ? "burned"
                : assignedDeviceId is null ? "free" : $"assigned to {kit}";

            entries.Add(new MqttPoolEntry(
                reader.GetInt64(0),
                reader.GetString(1),
                status,
                assignedDeviceId,
                reader.IsDBNull(3) ? null : reader.GetFieldValue<DateTimeOffset>(3),
                burnedAt,
                reader.GetFieldValue<DateTimeOffset>(5)));
        }

        var free = entries.Count(e => e.Status == "free");
        var burned = entries.Count(e => e.Status == "burned");

        return new MqttPoolSummary(
            entries, free, entries.Count - free - burned, burned,
            MqttCredentialResolution.PoolIsRunningLow(free));
    }

    // Burns and unassigns whatever login a revoked device held.
    //
    // Burned rather than returned to the pool: the board that held this
    // password was just cut off, usually because it was lost or stolen, so
    // the password has to be treated as known to whoever has the board.
    // Handing it to the next kit would re-expose the broker. The admin
    // rotates it in the HiveMQ console and re-adds it as a new row.
    public async Task<string?> BurnForDeviceAsync(
        string deviceId, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(deviceId)) return null;

        await using var connection = await _dataSource.OpenConnectionAsync(cancellationToken);

        await using var cmd = new NpgsqlCommand(
            "update mqtt_credential_pool set burned_at = now(), assigned_device_id = null, assigned_at = null " +
            "where assigned_device_id = $1 and burned_at is null returning username", connection);
        cmd.Parameters.AddWithValue(deviceId);

        var username = await cmd.ExecuteScalarAsync(cancellationToken) as string;

        if (username is not null)
        {
            _logger.LogWarning(
                "Burned MQTT pool login {Username} after revoking device {DeviceId}. " +
                "Change this password in the HiveMQ console, then re-add it to the pool.",
                username, deviceId);
        }

        return username;
    }

    // Returns null and logs rather than throwing. A single corrupt or
    // stale-keyed row must not take down the admin page or a claim.
    private string? TryDecrypt(long poolId, string encrypted)
    {
        try
        {
            return MqttPoolSecretBox.Decrypt(encrypted, EncryptionKey);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex,
                "Could not decrypt MQTT pool entry {Id}. Either Mqtt:PoolEncryptionKey has changed since it " +
                "was stored, or the row is corrupt. Re-paste this login from the HiveMQ console.", poolId);

            return null;
        }
    }
}
