using System.Security.Cryptography;
using Microsoft.Extensions.Options;
using Npgsql;

namespace AgroFlow.Api.Services.Notifications;

// Issues and redeems the single-use codes that link a farmer's Telegram
// account to their AgroFlow profile.
//
// The whole design exists because a Telegram bot cannot message anyone first.
// The admin generates a code, shows it as a QR for
// https://t.me/<bot>?start=<code>, and the farmer scanning it is what creates
// a chat the bot may use from then on.
public sealed class TelegramOnboardingService
{
    private readonly NpgsqlDataSource _dataSource;
    private readonly TelegramOptions _options;
    private readonly ILogger<TelegramOnboardingService> _logger;

    public TelegramOnboardingService(
        NpgsqlDataSource dataSource,
        IOptions<TelegramOptions> options,
        ILogger<TelegramOnboardingService> logger)
    {
        _dataSource = dataSource;
        _options = options.Value;
        _logger = logger;
    }

    // Mints a fresh code and invalidates any earlier unused ones for the same
    // farmer, so "Regenerate code" cannot leave two live QR codes pointing at
    // one profile - the older printout stops working the moment a new one is
    // produced.
    //
    // purpose decides what redeeming it does to the farmer's account - see
    // TelegramCodePurpose. It is chosen by the endpoint that issues the code,
    // never by the farmer, so somebody cannot turn a link request into a
    // password reset on someone else's account.
    // lifetime is optional and defaults to the configured TTL, so every
    // existing caller is unchanged.
    //
    // It exists for the app's own "Connect Telegram" button, which wants
    // FIFTEEN MINUTES rather than the onboarding default of seven days. The
    // two are different situations: an onboarding QR is printed or shown
    // on-site and may sit in a box for days, while a link code is generated
    // by a farmer who is holding the phone and about to tap straight through
    // to Telegram. A week-long window for that is a week in which a code
    // sitting in a log or a screenshot can attach someone else's chat to
    // their account.
    public async Task<TelegramOnboardingCode> IssueCodeAsync(
        Guid profileId,
        TelegramCodePurpose purpose,
        CancellationToken cancellationToken,
        TimeSpan? lifetime = null)
    {
        var code = GenerateCode();
        var expiresAt = lifetime.HasValue
            ? DateTimeOffset.UtcNow.Add(lifetime.Value)
            : DateTimeOffset.UtcNow.AddDays(Math.Max(1, _options.OnboardingCodeTtlDays));

        await using var connection = await _dataSource.OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);

        await using (var expire = new NpgsqlCommand(
            "update telegram_onboarding_code set used_at = now() " +
            "where profile_id = $1 and used_at is null",
            connection, transaction))
        {
            expire.Parameters.AddWithValue(profileId);
            await expire.ExecuteNonQueryAsync(cancellationToken);
        }

        await using (var insert = new NpgsqlCommand(
            "insert into telegram_onboarding_code (code, profile_id, expires_at, purpose) values ($1, $2, $3, $4)",
            connection, transaction))
        {
            insert.Parameters.AddWithValue(code);
            insert.Parameters.AddWithValue(profileId);
            insert.Parameters.AddWithValue(expiresAt);
            insert.Parameters.AddWithValue(purpose.ToDatabaseValue());
            await insert.ExecuteNonQueryAsync(cancellationToken);
        }

        await transaction.CommitAsync(cancellationToken);

        _logger.LogInformation(
            "Issued a {Purpose} Telegram code for profile {ProfileId}, valid until {ExpiresAt}.",
            purpose.ToDatabaseValue(), profileId, expiresAt);

        return new TelegramOnboardingCode(code, expiresAt, BuildDeepLink(code));
    }

    // Single-use redemption in one statement. The `used_at is null and
    // expires_at > now()` predicate plus `returning` means two farmers
    // scanning the same QR at the same moment cannot both win: Postgres
    // serialises the update and the loser gets zero rows back.
    public async Task<TelegramRedemption?> RedeemCodeAsync(
        string code,
        long chatId,
        CancellationToken cancellationToken)
    {
        await using var connection = await _dataSource.OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);

        Guid profileId;
        TelegramCodePurpose purpose;

        await using (var redeem = new NpgsqlCommand(
            "update telegram_onboarding_code set used_at = now() " +
            "where code = $1 and used_at is null and expires_at > now() " +
            "returning profile_id, purpose",
            connection, transaction))
        {
            redeem.Parameters.AddWithValue(code);

            await using var reader = await redeem.ExecuteReaderAsync(cancellationToken);

            if (!await reader.ReadAsync(cancellationToken))
            {
                await reader.CloseAsync();
                await transaction.RollbackAsync(cancellationToken);
                return null;
            }

            profileId = reader.GetGuid(0);
            purpose = TelegramCodePurposeExtensions.FromDatabaseValue(reader.GetString(1));

            await reader.CloseAsync();
        }

        // profile.telegram_chat_id is uniquely indexed, so a farmer who
        // re-links from the same Telegram account - or one phone handed to a
        // different person - would otherwise collide. Detach the chat from
        // whoever held it before, then attach it here.
        await using (var detach = new NpgsqlCommand(
            "update profile set telegram_chat_id = null where telegram_chat_id = $1 and id <> $2",
            connection, transaction))
        {
            detach.Parameters.AddWithValue(chatId);
            detach.Parameters.AddWithValue(profileId);
            await detach.ExecuteNonQueryAsync(cancellationToken);
        }

        await using (var attach = new NpgsqlCommand(
            "update profile set telegram_chat_id = $1 where id = $2",
            connection, transaction))
        {
            attach.Parameters.AddWithValue(chatId);
            attach.Parameters.AddWithValue(profileId);
            await attach.ExecuteNonQueryAsync(cancellationToken);
        }

        await transaction.CommitAsync(cancellationToken);

        _logger.LogInformation(
            "Telegram chat linked to profile {ProfileId} from a {Purpose} code.",
            profileId, purpose.ToDatabaseValue());

        return new TelegramRedemption(profileId, purpose);
    }

    // Everything the welcome message needs, read after redemption. Returns
    // null if the profile has no farm yet - possible for a farmer created
    // through the older /api/farmers/create path.
    public async Task<FarmerContext?> GetFarmerContextAsync(
        Guid profileId,
        CancellationToken cancellationToken)
    {
        await using var connection = await _dataSource.OpenConnectionAsync(cancellationToken);

        await using var command = new NpgsqlCommand(
            """
            select coalesce(nullif(p.name, ''), 'there'),
                   p.email,
                   coalesce(f.name, ''),
                   coalesce(f.location, '')
              from profile p
              left join farm f
                on f.owner_id = p.id
                or f.farm_id = (select fm.farm_id from farm_member fm where fm.profile_id = p.id limit 1)
             where p.id = $1
             order by case when f.owner_id = p.id then 0 else 1 end
             limit 1
            """,
            connection);

        command.Parameters.AddWithValue(profileId);

        await using var reader = await command.ExecuteReaderAsync(cancellationToken);

        if (!await reader.ReadAsync(cancellationToken)) return null;

        return new FarmerContext(
            reader.GetString(0),
            reader.GetString(1),
            reader.GetString(2),
            reader.GetString(3));
    }

    // Sets the flag the mobile app reads to force a password change at first
    // sign-in. Called right after the bot sends a temporary password, since
    // that password then lives in the farmer's chat history indefinitely.
    public async Task SetMustChangePasswordAsync(
        Guid profileId,
        bool mustChange,
        CancellationToken cancellationToken)
    {
        await using var connection = await _dataSource.OpenConnectionAsync(cancellationToken);

        await using var command = new NpgsqlCommand(
            "update profile set must_change_password = $1 where id = $2",
            connection);

        command.Parameters.AddWithValue(mustChange);
        command.Parameters.AddWithValue(profileId);

        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    public async Task<Guid?> GetProfileIdForChatAsync(
        long chatId,
        CancellationToken cancellationToken)
    {
        await using var connection = await _dataSource.OpenConnectionAsync(cancellationToken);

        await using var command = new NpgsqlCommand(
            "select id from profile where telegram_chat_id = $1",
            connection);

        command.Parameters.AddWithValue(chatId);

        var result = await command.ExecuteScalarAsync(cancellationToken);

        return result is Guid profileId ? profileId : null;
    }

    public async Task SetAlertsEnabledAsync(
        Guid profileId,
        bool enabled,
        CancellationToken cancellationToken)
    {
        await using var connection = await _dataSource.OpenConnectionAsync(cancellationToken);

        await using var command = new NpgsqlCommand(
            "update profile set telegram_alerts_enabled = $1 where id = $2",
            connection);

        command.Parameters.AddWithValue(enabled);
        command.Parameters.AddWithValue(profileId);

        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    public string? BuildDeepLink(string code) =>
        string.IsNullOrWhiteSpace(_options.BotUsername)
            ? null
            : $"https://t.me/{_options.BotUsername.TrimStart('@')}?start={code}";

    // Telegram restricts the ?start= payload to 1-64 characters from
    // [A-Za-z0-9_-], which rules out ordinary base64. URL-safe base64 of 24
    // random bytes gives 32 characters in that alphabet with no padding, and
    // 192 bits of entropy - not guessable in the week a code stays live.
    private static string GenerateCode()
    {
        var bytes = RandomNumberGenerator.GetBytes(24);

        return Convert.ToBase64String(bytes)
            .Replace('+', '-')
            .Replace('/', '_')
            .TrimEnd('=');
    }
}

// Why a code was issued, which is what decides whether redeeming it touches
// the farmer's password. Chosen by the issuing endpoint, never by the farmer.
public enum TelegramCodePurpose
{
    // Issued by an admin: on-site farmer onboarding, or "Regenerate code" for
    // a QR that expired or was lost. The farmer has no usable password yet (or
    // the one they were given is loose in the world), so redemption mints a
    // fresh one, sends it, and forces a change at next sign-in.
    Onboarding,

    // Issued by the farmer themselves from the mobile app's Connect Telegram
    // option. They are already signed in with a password they know, and they
    // only want their alerts here - so redemption links the chat and leaves
    // the account completely alone.
    Link,
}

public static class TelegramCodePurposeExtensions
{
    public static string ToDatabaseValue(this TelegramCodePurpose purpose) => purpose switch
    {
        TelegramCodePurpose.Link => "link",
        _ => "onboarding",
    };

    // Anything unrecognised falls back to onboarding, matching the column
    // default in migration 0025: the louder behaviour is the safer default,
    // because a farmer who unexpectedly has to set a password is a nuisance,
    // while one who silently never receives their credentials is stuck.
    public static TelegramCodePurpose FromDatabaseValue(string value) =>
        string.Equals(value, "link", StringComparison.OrdinalIgnoreCase)
            ? TelegramCodePurpose.Link
            : TelegramCodePurpose.Onboarding;
}

public sealed record TelegramRedemption(
    Guid ProfileId,
    TelegramCodePurpose Purpose);

public sealed record TelegramOnboardingCode(
    string Code,
    DateTimeOffset ExpiresAt,
    string? DeepLink);

public sealed record FarmerContext(
    string Name,
    string Email,
    string FarmName,
    string FarmLocation);
