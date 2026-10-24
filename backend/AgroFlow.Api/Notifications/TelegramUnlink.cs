using System.Security.Claims;
using Npgsql;

namespace AgroFlow.Api.Services;

/// What clearing one farmer's Telegram link found.
public sealed record UnlinkResult(bool Found, bool WasLinked, string? Name);

/// The database half of an admin unlink, behind an interface so the tests can run the
/// rule without a database.
public interface ITelegramLinkStore
{
    /// Clears profile.telegram_chat_id and cancels the farmer's unused link codes, so the
    /// next code anyone issues is the only one that works.
    Task<UnlinkResult> UnlinkAsync(Guid profileId, CancellationToken ct);
}

public sealed class DbTelegramLinkStore : ITelegramLinkStore
{
    private readonly NpgsqlDataSource _dataSource;
    public DbTelegramLinkStore(NpgsqlDataSource dataSource) => _dataSource = dataSource;

    public async Task<UnlinkResult> UnlinkAsync(Guid profileId, CancellationToken ct)
    {
        await using var connection = await _dataSource.OpenConnectionAsync(ct);
        await using var tx = await connection.BeginTransactionAsync(ct);

        // The old value comes back from the same statement, so "was it linked?" cannot race
        // with the farmer linking at that moment.
        await using var clear = new NpgsqlCommand(
            """
            with before as (
                select id, name, telegram_chat_id from profile where id = $1 for update
            )
            update profile p
               set telegram_chat_id = null
              from before b
             where p.id = b.id
            returning b.name, b.telegram_chat_id is not null
            """,
            connection, tx);
        clear.Parameters.AddWithValue(profileId);

        string? name;
        bool wasLinked;
        await using (var reader = await clear.ExecuteReaderAsync(ct))
        {
            if (!await reader.ReadAsync(ct))
            {
                await tx.RollbackAsync(ct);
                return new UnlinkResult(false, false, null);
            }

            name = reader.IsDBNull(0) ? null : reader.GetString(0);
            wasLinked = reader.GetBoolean(1);
        }

        // An unused code from before the unlink (say on a lost phone's screen) must not
        // reconnect the old chat. Expired, not deleted, so the code history stays.
        await using var expire = new NpgsqlCommand(
            "update telegram_onboarding_code set expires_at = now() where profile_id = $1 and used_at is null and expires_at > now()",
            connection, tx);
        expire.Parameters.AddWithValue(profileId);
        await expire.ExecuteNonQueryAsync(ct);

        await tx.CommitAsync(ct);
        return new UnlinkResult(true, wasLinked, name);
    }
}

/// An admin disconnects a farmer's Telegram, e.g. after a lost or changed phone. The farmer
/// then re-links with a new code from the app or the console. Always audited.
public sealed class TelegramUnlinkService
{
    private readonly ITelegramLinkStore _store;
    private readonly IAuditWriter _audit;

    public TelegramUnlinkService(ITelegramLinkStore store, IAuditWriter audit)
    {
        _store = store;
        _audit = audit;
    }

    public async Task<Outcome> UnlinkAsync(ClaimsPrincipal admin, Guid profileId, CancellationToken ct)
    {
        var result = await _store.UnlinkAsync(profileId, ct);
        if (!result.Found) return new Outcome(404, new { error = "No such farmer." });

        var who = string.IsNullOrWhiteSpace(result.Name) ? "This farmer" : result.Name.Trim();

        await _audit.WriteAsync(admin, AuditActions.TelegramUnlinked, "profile", profileId.ToString(),
            details: new { wasLinked = result.WasLinked }, cancellationToken: ct);

        var message = result.WasLinked
            ? $"{who}'s Telegram was disconnected. They can connect again with a new code."
            : $"{who} had no Telegram connected. They can connect with a new code.";

        return new Outcome(200, new { message, wasLinked = result.WasLinked });
    }
}
