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
    public async Task<TelegramOnboardingCode> IssueCodeAsync(
        Guid profileId,
        CancellationToken cancellationToken)
    {
        var code = GenerateCode();
        var expiresAt = DateTimeOffset.UtcNow.AddDays(Math.Max(1, _options.OnboardingCodeTtlDays));

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
            "insert into telegram_onboarding_code (code, profile_id, expires_at) values ($1, $2, $3)",
            connection, transaction))
        {
            insert.Parameters.AddWithValue(code);
            insert.Parameters.AddWithValue(profileId);
            insert.Parameters.AddWithValue(expiresAt);
            await insert.ExecuteNonQueryAsync(cancellationToken);
        }

        await transaction.CommitAsync(cancellationToken);

        _logger.LogInformation(
            "Issued a Telegram onboarding code for profile {ProfileId}, valid until {ExpiresAt}.",
            profileId, expiresAt);

        return new TelegramOnboardingCode(code, expiresAt, BuildDeepLink(code));
    }

    // Single-use redemption in one statement. The `used_at is null and
    // expires_at > now()` predicate plus `returning` means two farmers
    // scanning the same QR at the same moment cannot both win: Postgres
    // serialises the update and the loser gets zero rows back.
    public async Task<Guid?> RedeemCodeAsync(
        string code,
        long chatId,
        CancellationToken cancellationToken)
    {
        await using var connection = await _dataSource.OpenConnectionAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);

        Guid profileId;

        await using (var redeem = new NpgsqlCommand(
            "update telegram_onboarding_code set used_at = now() " +
            "where code = $1 and used_at is null and expires_at > now() " +
            "returning profile_id",
            connection, transaction))
        {
            redeem.Parameters.AddWithValue(code);

            var result = await redeem.ExecuteScalarAsync(cancellationToken);

            if (result is not Guid redeemed)
            {
                await transaction.RollbackAsync(cancellationToken);
                return null;
            }

            profileId = redeemed;
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
            "Telegram chat linked to profile {ProfileId}.", profileId);

        return profileId;
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

public sealed record TelegramOnboardingCode(
    string Code,
    DateTimeOffset ExpiresAt,
    string? DeepLink);

public sealed record FarmerContext(
    string Name,
    string Email,
    string FarmName,
    string FarmLocation);
