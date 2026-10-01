using System.Collections.Concurrent;
using AgroFlow.Api.Services.Notifications;
using Microsoft.Extensions.Options;
using Npgsql;

namespace AgroFlow.Api.Services;

// Self-service password recovery, delivered over Telegram.
//
// WHY TELEGRAM AND NOT EMAIL
// Supabase's own resetPasswordForEmail needs SMTP, which this project has
// never configured, so the mobile app's forgot-password screen silently did
// nothing. A farmer who forgot their password had no self-service path at all
// and had to find an administrator. Telegram is the one channel AgroFlow can
// actually reach a farmer on.
//
// WHAT IT DELIBERATELY DOES NOT DO
// It never reveals whether an email address belongs to an account, and never
// reveals whether that account has Telegram linked. Every outcome returns the
// same neutral response to the caller - see PasswordResetOutcome. An endpoint
// that answered "no such user" would be an account enumerator: anyone could
// harvest which of their guesses are real AgroFlow farmers.
public sealed class PasswordResetService
{
    private readonly NpgsqlDataSource _dataSource;
    private readonly SupabaseAdminService _supabaseAdmin;
    private readonly INotificationService _notifications;
    private readonly PasswordResetOptions _options;
    private readonly ILogger<PasswordResetService> _logger;

    // Rate limiting is per EMAIL, not per IP: the thing being protected is a
    // particular farmer's Telegram chat from being flooded, and an attacker
    // changing IP must not reset that. Kept in memory, which means the limit
    // is per instance - acceptable because exactly one instance runs, and the
    // ceiling is a courtesy rather than a security boundary (the real
    // protection is that the message only ever goes to the account's OWN
    // linked chat, never to the requester).
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

    // Always returns quietly. The caller must respond identically whatever
    // happened in here.
    public async Task RequestResetAsync(string email, CancellationToken cancellationToken)
    {
        var normalised = email.Trim().ToLowerInvariant();

        if (normalised.Length == 0) return;

        if (!IsWithinRateLimit(normalised))
        {
            // Logged at Information, not Warning: a farmer tapping the button
            // twice is ordinary, not an incident.
            _logger.LogInformation("Password reset for a given email was rate limited.");
            return;
        }

        var profileId = await FindLinkedProfileAsync(normalised, cancellationToken);

        if (profileId is null)
        {
            // Either no such account, or an account with no Telegram linked.
            // Deliberately indistinguishable from here on, and the email is
            // NOT logged - a log line naming addresses that asked for resets
            // is its own small leak.
            _logger.LogInformation(
                "Password reset requested for an address with no linked Telegram chat; nothing sent.");

            return;
        }

        await IssueAndSendAsync(profileId.Value, cancellationToken);
    }

    // The admin-triggered version: the administrator has already identified
    // the farmer, so there is no enumeration concern and the caller gets a
    // real answer about whether it worked.
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
        // Same generator as onboarding, so "temporary password" means one
        // thing across AgroFlow. Generated, sent, forgotten - never stored.
        var password = await _supabaseAdmin.ResetTemporaryPasswordAsync(profileId, cancellationToken);

        if (password is null)
        {
            _logger.LogError(
                "Could not issue a reset password for profile {ProfileId}; their existing password still works.",
                profileId);

            return false;
        }

        // Set BEFORE sending. If the send fails the farmer is no worse off -
        // they simply request again - but a delivered password that did not
        // force a change would sit in a chat history as a working credential.
        await SetMustChangePasswordAsync(profileId, cancellationToken);

        await _notifications.NotifyPasswordResetAsync(profileId, password, cancellationToken);

        _logger.LogInformation("Sent a reset password to profile {ProfileId}.", profileId);

        return true;
    }

    // Only profiles that actually have a chat linked are candidates: without
    // one there is nowhere to deliver to, and resetting the password anyway
    // would lock the farmer out of an account they could still use.
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

        // Keep the dictionary from growing without bound on a long-running
        // process being probed with many distinct addresses.
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
