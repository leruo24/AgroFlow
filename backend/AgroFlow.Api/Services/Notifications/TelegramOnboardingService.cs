using System.Security.Cryptography;
using Microsoft.Extensions.Options;
using Npgsql;

namespace AgroFlow.Api.Services.Notifications;

// Issues and redeems the single-use codes that link a farmer's Telegram to their
// AgroFlow profile. A bot cannot message anyone first, so the admin shows a QR for
// https://t.me/<bot>?start=<code>, and the farmer scanning it creates the chat.
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

    // Creates a new code and cancels any older unused ones for the same farmer, so
    // "Regenerate code" never leaves two working QR codes.
    // Security: purpose (see TelegramCodePurpose) decides what redeeming does to the
    // account. The endpoint picks it, never the farmer, so a link request cannot become
    // a password reset on someone else's account.
    // lifetime defaults to the configured TTL. The app's "Connect Telegram" button uses
    // 15 minutes instead of the onboarding default of 7 days, because the farmer is
    // holding the phone, and a long window means a leaked code stays usable longer.
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

    // Single-use redemption in one statement: `used_at is null and expires_at > now()`
    // with `returning` means two people scanning the same QR at once cannot both win.
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

        // Telegram is for farmers only. A code for a staff account links nothing, and the code
        // is not spent either (rolled back).
        if (await StaffTelegram.IsStaffAsync(connection, profileId, cancellationToken, transaction))
        {
            await transaction.RollbackAsync(cancellationToken);
            _logger.LogWarning("Refused to link Telegram to staff profile {ProfileId}: Telegram is for farmers only.", profileId);
            throw new StaffTelegramRefusedException();
        }

        // profile.telegram_chat_id is unique, so re-linking the same Telegram account (or a
        // phone passed to someone else) would collide. We detach the chat from its old
        // owner first, then attach it here.
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

    // Everything the welcome message needs, read after redemption. Null if the profile
    // has no farm yet (possible via the older /api/farmers/create path).
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

    // Security: sets the flag that makes the app force a password change at first
    // sign-in, because the temporary password now sits in the chat history.
    public async Task SetMustChangePasswordAsync(
        Guid profileId,
        bool mustChange,
        CancellationToken cancellationToken)
    {
        await using var connection = await _dataSource.OpenConnectionAsync(cancellationToken);

        // A temporary password works for 72 hours (EasyPassword.Lifetime); setting the flag
        // starts that clock and clearing it stops it. Before migration 0050 there is no clock.
        await using (var has = new NpgsqlCommand(
            "select exists (select 1 from information_schema.columns where table_name = 'profile' and column_name = 'temp_password_expires_at')",
            connection))
        {
            if (await has.ExecuteScalarAsync(cancellationToken) is true)
            {
                await using var timed = new NpgsqlCommand(
                    "update profile set must_change_password = $1, " +
                    "temp_password_expires_at = case when $1 then now() + interval '72 hours' else null end where id = $2",
                    connection);
                timed.Parameters.AddWithValue(mustChange);
                timed.Parameters.AddWithValue(profileId);
                await timed.ExecuteNonQueryAsync(cancellationToken);
                return;
            }
        }

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

    // Telegram only allows 1-64 characters from [A-Za-z0-9_-] in ?start=, so we use
    // URL-safe base64 of 24 random bytes: 32 characters, no padding, 192 bits of entropy.
    private static string GenerateCode()
    {
        var bytes = RandomNumberGenerator.GetBytes(24);

        return Convert.ToBase64String(bytes)
            .Replace('+', '-')
            .Replace('/', '_')
            .TrimEnd('=');
    }
}

// Why a code was issued, which decides whether redeeming it touches the farmer's
// password. Chosen by the issuing endpoint, never by the farmer.
public enum TelegramCodePurpose
{
    // Issued by an admin (on-site onboarding or "Regenerate code"). The farmer has no
    // usable password yet, so redemption creates one, sends it and forces a change at
    // next sign-in.
    Onboarding,

    // Issued by the farmer from the app's Connect Telegram option. They already have a
    // password, so redemption only links the chat.
    Link,
}

public static class TelegramCodePurposeExtensions
{
    public static string ToDatabaseValue(this TelegramCodePurpose purpose) => purpose switch
    {
        TelegramCodePurpose.Link => "link",
        _ => "onboarding",
    };

    // Anything unknown counts as onboarding, like the column default (0025): an
    // unexpected password change is a nuisance, but never getting credentials leaves
    // the farmer stuck.
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
