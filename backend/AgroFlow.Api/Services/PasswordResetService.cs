using System.Collections.Concurrent;
using AgroFlow.Api.Services.Notifications;
using Microsoft.Extensions.Options;
using Npgsql;

namespace AgroFlow.Api.Services;

// Password recovery over Telegram, because Supabase's email reset needs SMTP and we
// have none; Telegram is the one channel we can reach farmers on.
// Security: it never reveals whether an email belongs to an account or whether that
// account has Telegram. Every outcome gives the same neutral response (see
// PasswordResetOutcome); otherwise anyone could find out which emails are real farmers.
public sealed class PasswordResetService
{
    private readonly NpgsqlDataSource _dataSource;
    private readonly SupabaseAdminService _supabaseAdmin;
    private readonly INotificationService _notifications;
    private readonly PasswordResetOptions _options;
    private readonly ILogger<PasswordResetService> _logger;

    // Rate limited per email, not per IP: we are protecting one farmer's chat from being
    // flooded, and changing IP must not get around that. In memory, per instance, which
    // is fine with one instance. The real protection is that the message only goes to
    // the account's own linked chat.
    private static readonly ConcurrentDictionary<string, List<DateTimeOffset>> Attempts = new();

    public PasswordResetService(
        NpgsqlDataSource dataSource,
        SupabaseAdminService supabaseAdmin,
        INotificationService notifications,
        IOptions<PasswordResetOptions> options,
        ILogger<PasswordResetService> logger)
    {
        _dataSource = dataSource;
        _supabaseAdmin = supabaseAdmin;
        _notifications = notifications;
        _options = options.Value;
        _logger = logger;
    }

    // Always returns quietly; the caller must respond the same whatever happened here.
    public async Task RequestResetAsync(string email, CancellationToken cancellationToken)
    {
        var normalised = email.Trim().ToLowerInvariant();

        if (normalised.Length == 0) return;

        if (!IsWithinRateLimit(normalised))
        {
            // Information, not Warning: tapping the button twice is normal.
            _logger.LogInformation("Password reset for a given email was rate limited.");
            return;
        }

        var profileId = await FindLinkedProfileAsync(normalised, cancellationToken);

        if (profileId is null)
        {
            // No such account, or no Telegram linked: both look the same from here on.
            // Security: the email is not logged.
            _logger.LogInformation(
                "Password reset requested for an address with no linked Telegram chat; nothing sent.");

            return;
        }

        await IssueAndSendAsync(profileId.Value, cancellationToken);
    }

    // The admin-triggered version: the admin has already identified the farmer, so the
    // caller can get a real answer.
    public async Task<bool> ResetForProfileAsync(Guid profileId, CancellationToken cancellationToken)
    {
        await using var connection = await _dataSource.OpenConnectionAsync(cancellationToken);

        await using var check = new NpgsqlCommand(
            "select telegram_chat_id is not null from profile where id = $1", connection);

        check.Parameters.AddWithValue(profileId);

        if (await check.ExecuteScalarAsync(cancellationToken) is not true)
        {
            return false;
        }

        return await IssueAndSendAsync(profileId, cancellationToken);
    }

    private async Task<bool> IssueAndSendAsync(Guid profileId, CancellationToken cancellationToken)
    {
        // Same generator as onboarding. Created, sent and forgotten, never stored.
        var password = await _supabaseAdmin.ResetTemporaryPasswordAsync(profileId, cancellationToken);

        if (password is null)
        {
            _logger.LogError(
                "Could not issue a reset password for profile {ProfileId}; their existing password still works.",
                profileId);

            return false;
        }

        // Security: set before sending. A failed send just means the farmer asks again,
        // but a delivered password without a forced change would stay usable in the chat.
        await SetMustChangePasswordAsync(profileId, cancellationToken);

        await _notifications.NotifyPasswordResetAsync(profileId, password, cancellationToken);

        _logger.LogInformation("Sent a reset password to profile {ProfileId}.", profileId);

        return true;
    }

    // Only profiles with a linked chat count: without one there is nowhere to send it,
    // and resetting anyway would lock the farmer out.
    private async Task<Guid?> FindLinkedProfileAsync(string email, CancellationToken cancellationToken)
    {
        await using var connection = await _dataSource.OpenConnectionAsync(cancellationToken);

        await using var command = new NpgsqlCommand(
            "select id from profile where lower(email) = $1 and telegram_chat_id is not null",
            connection);

        command.Parameters.AddWithValue(email);

        var result = await command.ExecuteScalarAsync(cancellationToken);

        return result is Guid profileId ? profileId : null;
    }

    private async Task SetMustChangePasswordAsync(Guid profileId, CancellationToken cancellationToken)
    {
        await using var connection = await _dataSource.OpenConnectionAsync(cancellationToken);

        await using var command = new NpgsqlCommand(
            "update profile set must_change_password = true where id = $1", connection);

        command.Parameters.AddWithValue(profileId);

        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    private bool IsWithinRateLimit(string email)
    {
        if (!_options.Enabled) return false;

        var now = DateTimeOffset.UtcNow;
        var minimumGap = TimeSpan.FromMinutes(Math.Max(1, _options.MinimumIntervalMinutes));

        var allowed = false;

        Attempts.AddOrUpdate(
            email,
            _ =>
            {
                allowed = true;
                return [now];
            },
            (_, history) =>
            {
                lock (history)
                {
                    history.RemoveAll(at => now - at > TimeSpan.FromDays(1));

                    if (history.Count >= _options.MaxPerDay) return history;
                    if (history.Count > 0 && now - history[^1] < minimumGap) return history;

                    history.Add(now);
                    allowed = true;
                    return history;
                }
            });

        // Stop the dictionary growing forever if many addresses are tried.
        if (Attempts.Count > 10_000)
        {
            foreach (var stale in Attempts.Where(e => e.Value.Count == 0 || now - e.Value[^1] > TimeSpan.FromDays(1)))
            {
                Attempts.TryRemove(stale.Key, out _);
            }
        }

        return allowed;
    }
}
