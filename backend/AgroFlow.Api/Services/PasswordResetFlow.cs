using System.Security.Claims;
using AgroFlow.Api.Services.Notifications;
using AgroFlow.Business;
using Npgsql;
using NpgsqlTypes;

namespace AgroFlow.Api.Services;

// Signing in and resetting a password without email (docs/password-reset.md):
//   - Forgot password: the bot sends a 6-digit code (ResetCode rules); the farmer enters it
//     with a new password; the server sets it, ends other sessions and the bot confirms.
//     The request ALWAYS gets the same reply, so nobody learns which emails are farmers or
//     who has Telegram. Staff with no Telegram get Supabase's email reset instead.
//   - Admin reset: a new easy temporary password (EasyPassword), sent by Telegram if linked,
//     otherwise shown once to the admin. Audited.
//   - First sign-in: the welcome message carries a single-use "Sign in to AgroFlow" link.
//   - Temporary passwords expire after 72 hours (ExpireTemporaryPasswordsAsync).
// The database, Supabase Admin and Telegram are behind interfaces so the rules are tested
// with fakes (PasswordResetFlowTests).

public sealed record ResetAccount(Guid ProfileId, string Role, string Email, long? ChatId, string Language, string? Name);
public sealed record StoredCode(long Id, string Hash, string Salt, DateTimeOffset ExpiresAt, DateTimeOffset? UsedAt, int Attempts);
public sealed record StoredSignInLink(Guid ProfileId, string Email, DateTimeOffset ExpiresAt, DateTimeOffset? UsedAt);

public interface IPasswordResetStore
{
    Task<ResetAccount?> FindByEmailAsync(string email, CancellationToken ct);
    Task<ResetAccount?> FindByIdAsync(Guid profileId, CancellationToken ct);
    Task<int> CodesSinceAsync(Guid profileId, DateTimeOffset since, CancellationToken ct);
    Task SaveCodeAsync(Guid profileId, string hash, string salt, DateTimeOffset expiresAt, CancellationToken ct);
    Task<StoredCode?> LatestCodeAsync(Guid profileId, CancellationToken ct);
    Task CountAttemptAsync(long codeId, CancellationToken ct);
    // Marks this code used and every other unused one for the account expired.
    Task UseCodeAsync(Guid profileId, long codeId, CancellationToken ct);
    Task MarkTemporaryAsync(Guid profileId, DateTimeOffset expiresAt, CancellationToken ct);
    Task ClearTemporaryAsync(Guid profileId, CancellationToken ct);
    Task EndSessionsAsync(Guid profileId, CancellationToken ct);
    Task SaveSignInLinkAsync(Guid profileId, string tokenHash, DateTimeOffset expiresAt, CancellationToken ct);
    // Uses the link if it is still good (one statement, so it cannot be used twice).
    Task<StoredSignInLink?> UseSignInLinkAsync(string tokenHash, DateTimeOffset now, CancellationToken ct);
    Task<IReadOnlyList<Guid>> ExpiredTemporaryAsync(DateTimeOffset now, CancellationToken ct);
}

public interface IAuthAdmin
{
    Task<bool> SetPasswordAsync(Guid userId, string password, CancellationToken ct);
    Task<string?> MagicLinkTokenHashAsync(string email, CancellationToken ct);
    Task SendRecoveryEmailAsync(string email, string? redirectTo, CancellationToken ct);
}

public interface IResetMessenger
{
    Task<bool> SendAsync(long chatId, string text, CancellationToken ct);
    Task<bool> SendWithLinkAsync(long chatId, string text, string buttonText, string url, CancellationToken ct);
}

public enum ConfirmResult
{
    Changed,
    WrongOrExpired,
    TooManyAttempts,
    WeakPassword,
}

// StaffRefused: the account is staff, who reset by email only (nothing was changed).
public sealed record AdminResetResult(bool Found, bool SentByTelegram, string? ShownOnce, bool StaffRefused = false);

public sealed class PasswordResetFlow
{
    public const string NeutralReply =
        "If this account has Telegram linked, we've sent a code. No Telegram? Ask your AgroFlow field officer to reset it.";

    private readonly IPasswordResetStore _store;
    private readonly IAuthAdmin _auth;
    private readonly IResetMessenger _messenger;
    private readonly IAuditWriter _audit;
    private readonly Func<DateTimeOffset> _clock;
    private readonly string? _signInBaseUrl;

    public PasswordResetFlow(IPasswordResetStore store, IAuthAdmin auth, IResetMessenger messenger, IAuditWriter audit,
        IConfiguration? configuration = null, Func<DateTimeOffset>? clock = null)
    {
        _store = store;
        _auth = auth;
        _messenger = messenger;
        _audit = audit;
        _clock = clock ?? (() => DateTimeOffset.UtcNow);
        _signInBaseUrl = configuration?["SignIn:LinkBaseUrl"]?.Trim().TrimEnd('/');
    }

    // "Forgot password?". Never tells the caller what happened.
    public async Task RequestAsync(string? email, string? staffRedirectTo, CancellationToken ct)
    {
        var normalised = email?.Trim().ToLowerInvariant() ?? "";
        if (normalised.Length == 0) return;

        var account = await _store.FindByEmailAsync(normalised, ct);
        if (account is null) return;

        // Staff never use Telegram: their reset is always Supabase's email (to the admin site's
        // ?reset=1 page), even if an old chat is still on the account.
        if (AgroFlow.Api.Auth.StaffRoles.IsStaff(account.Role))
        {
            await _auth.SendRecoveryEmailAsync(account.Email, staffRedirectTo, ct);
            return;
        }

        // A farmer with no Telegram gets nothing sent: the field officer resets it.
        if (account.ChatId is null) return;

        var now = _clock();
        if (!ResetCode.CanRequest(await _store.CodesSinceAsync(account.ProfileId, now.AddHours(-1), ct))) return;

        var code = ResetCode.Generate();
        var salt = ResetCode.NewSalt();
        await _store.SaveCodeAsync(account.ProfileId, ResetCode.Hash(code, salt), salt, now + ResetCode.Lifetime, ct);
        await _messenger.SendAsync(account.ChatId.Value, BotText.Get(account.Language, "reset.code", ("code", code)), ct);
    }

    // Code + new password. Wrong codes count towards the 5 tries.
    public async Task<ConfirmResult> ConfirmAsync(string? email, string? code, string? newPassword, CancellationToken ct)
    {
        if (newPassword is null || newPassword.Length < 8) return ConfirmResult.WeakPassword;

        var account = await _store.FindByEmailAsync(email?.Trim().ToLowerInvariant() ?? "", ct);
        if (account is null) return ConfirmResult.WrongOrExpired;

        var stored = await _store.LatestCodeAsync(account.ProfileId, ct);
        var check = ResetCode.Check(stored?.Hash, stored?.Salt, stored?.ExpiresAt, stored?.UsedAt, stored?.Attempts ?? 0, code, _clock());

        switch (check)
        {
            case CodeCheck.TooManyAttempts:
                return ConfirmResult.TooManyAttempts;
            case CodeCheck.Wrong:
                await _store.CountAttemptAsync(stored!.Id, ct);
                return stored.Attempts + 1 >= ResetCode.MaxAttempts ? ConfirmResult.TooManyAttempts : ConfirmResult.WrongOrExpired;
            case CodeCheck.Ok:
                break;
            default:
                return ConfirmResult.WrongOrExpired;
        }

        if (!await _auth.SetPasswordAsync(account.ProfileId, newPassword, ct)) return ConfirmResult.WrongOrExpired;

        await _store.UseCodeAsync(account.ProfileId, stored!.Id, ct);
        await _store.ClearTemporaryAsync(account.ProfileId, ct);
        await _store.EndSessionsAsync(account.ProfileId, ct);
        if (account.ChatId is { } chat) await _messenger.SendAsync(chat, BotText.Get(account.Language, "reset.done"), ct);
        await _audit.WriteAsync(AsUser(account.ProfileId), AuditActions.UserPasswordResetSelf, "profile",
            account.ProfileId.ToString(), details: new { via = "telegram_code" }, cancellationToken: ct);
        return ConfirmResult.Changed;
    }

    // "Reset password" on a farmer's page in the console.
    public async Task<AdminResetResult> AdminResetAsync(ClaimsPrincipal admin, Guid profileId, CancellationToken ct)
    {
        var account = await _store.FindByIdAsync(profileId, ct);
        if (account is null) return new AdminResetResult(false, false, null);

        // Staff reset their own password by email, never with a temporary one.
        if (AgroFlow.Api.Auth.StaffRoles.IsStaff(account.Role)) return new AdminResetResult(true, false, null, StaffRefused: true);

        var password = await IssueTemporaryAsync(account.ProfileId, ct);
        if (password is null) throw new InvalidOperationException("Supabase refused the new password.");

        var sent = account.ChatId is { } chat && await _messenger.SendAsync(chat,
            BotText.Get(account.Language, "reset.admin", ("password", EasyPassword.Display(password)), ("email", account.Email)), ct);

        await _audit.WriteAsync(admin, AuditActions.UserPasswordReset, "profile", profileId.ToString(),
            details: new { sentByTelegram = sent }, cancellationToken: ct);

        return new AdminResetResult(true, sent, sent ? null : EasyPassword.Display(password));
    }

    // A new temporary password: set in Supabase, must be changed at first sign-in, 72 hours.
    public async Task<string?> IssueTemporaryAsync(Guid profileId, CancellationToken ct)
    {
        var password = EasyPassword.Generate();
        if (!await _auth.SetPasswordAsync(profileId, password, ct)) return null;
        await _store.MarkTemporaryAsync(profileId, EasyPassword.ExpiresAt(_clock()), ct);
        return password;
    }

    // The welcome after a farmer links Telegram: a temporary password, plus a one-tap
    // "Sign in to AgroFlow" link when SignIn:LinkBaseUrl is set (the farmer web app).
    // issuePassword: false when the farmer already has their password (they chose one, or the
    // welcome web page showed it), so the message never changes a password they are using.
    public async Task<bool> SendWelcomeAsync(Guid profileId, string farmName, string farmLocation, string? appLink, CancellationToken ct,
        bool issuePassword = true)
    {
        var account = await _store.FindByIdAsync(profileId, ct);
        if (account?.ChatId is not { } chat) return false;
        string? password = null;
        if (issuePassword)
        {
            password = await IssueTemporaryAsync(profileId, ct);
            if (password is null) return false;
        }

        var lang = account.Language;
        var lines = new List<string>
        {
            BotText.Get(lang, "welcome.title", ("name", account.Name ?? "")),
            "",
            BotText.Get(lang, "farm", ("name", farmName)),
            BotText.Get(lang, "welcome.location", ("location", farmLocation)),
            "",
            BotText.Get(lang, "welcome.signin"),
            BotText.Get(lang, "welcome.email", ("email", account.Email)),
        };
        if (password is not null)
        {
            lines.Add(BotText.Get(lang, "welcome.password", ("password", EasyPassword.Display(password))));
            lines.Add("");
            lines.Add(BotText.Get(lang, "welcome.change"));
        }
        else
        {
            lines.Add(BotText.Get(lang, "welcome.password.kept"));
        }
        // The Android app and the web app (our existing addresses), then what happens next.
        if (!string.IsNullOrWhiteSpace(appLink)) { lines.Add(""); lines.Add(BotText.Get(lang, "welcome.app", ("link", appLink))); }
        if (!string.IsNullOrWhiteSpace(_signInBaseUrl))
        {
            if (string.IsNullOrWhiteSpace(appLink)) lines.Add("");
            lines.Add(BotText.Get(lang, "welcome.webapp", ("link", _signInBaseUrl.TrimEnd('/') + "/login")));
        }
        lines.Add("");
        lines.Add(BotText.Get(lang, "welcome.installer"));

        var link = await NewSignInLinkAsync(profileId, ct);
        if (link is null) return await _messenger.SendAsync(chat, string.Join("\n", lines), ct);

        lines.Add("");
        lines.Add(BotText.Get(lang, "welcome.button.hint"));
        return await _messenger.SendWithLinkAsync(chat, string.Join("\n", lines), BotText.Get(lang, "welcome.button"), link, ct);
    }

    public async Task<string?> NewSignInLinkAsync(Guid profileId, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(_signInBaseUrl)) return null;
        var token = SignInLink.NewToken();
        await _store.SaveSignInLinkAsync(profileId, SignInLink.Hash(token), _clock() + SignInLink.Lifetime, ct);
        return $"{_signInBaseUrl}/signin?token={Uri.EscapeDataString(token)}";
    }

    // The app opens the link and swaps it for a Supabase sign-in (verifyOtp). Once only.
    public async Task<(string Email, string TokenHash)?> RedeemSignInLinkAsync(string? token, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(token)) return null;
        var link = await _store.UseSignInLinkAsync(SignInLink.Hash(token), _clock(), ct);
        if (link is null) return null;
        var hash = await _auth.MagicLinkTokenHashAsync(link.Email, ct);
        return hash is null ? null : (link.Email, hash);
    }

    // Temporary passwords not changed within 72 hours stop working: replaced with a long
    // random password nobody knows. The farmer asks for a new one (admin reset).
    public async Task<int> ExpireTemporaryPasswordsAsync(CancellationToken ct)
    {
        var expired = await _store.ExpiredTemporaryAsync(_clock(), ct);
        var count = 0;
        foreach (var profileId in expired)
        {
            // 43 random characters nobody knows (Supabase allows up to 72).
            if (await _auth.SetPasswordAsync(profileId, SignInLink.NewToken(), ct))
            {
                await _store.MarkTemporaryAsync(profileId, DateTimeOffset.MaxValue, ct);   // done; never matched again
                count++;
            }
        }
        return count;
    }

    private static ClaimsPrincipal AsUser(Guid profileId) =>
        new(new ClaimsIdentity(new[] { new Claim("sub", profileId.ToString()) }, "self"));
}

public sealed class TelegramResetMessenger : IResetMessenger
{
    private readonly TelegramClient _client;
    public TelegramResetMessenger(TelegramClient client) => _client = client;
    public Task<bool> SendAsync(long chatId, string text, CancellationToken ct) => _client.SendMessageAsync(chatId, text, null, ct);
    public Task<bool> SendWithLinkAsync(long chatId, string text, string buttonText, string url, CancellationToken ct) =>
        _client.SendMessageWithLinkAsync(chatId, text, buttonText, url, ct);
}

public sealed class SupabaseAuthAdmin : IAuthAdmin
{
    private readonly SupabaseAdminService _admin;
    public SupabaseAuthAdmin(SupabaseAdminService admin) => _admin = admin;
    public Task<bool> SetPasswordAsync(Guid userId, string password, CancellationToken ct) => _admin.SetPasswordAsync(userId, password, ct);
    public Task<string?> MagicLinkTokenHashAsync(string email, CancellationToken ct) => _admin.MagicLinkTokenHashAsync(email, ct);
    public Task SendRecoveryEmailAsync(string email, string? redirectTo, CancellationToken ct) => _admin.SendRecoveryEmailAsync(email, redirectTo, ct);
}

public sealed class DbPasswordResetStore : IPasswordResetStore
{
    private readonly NpgsqlDataSource _db;
    private readonly ILogger<DbPasswordResetStore> _logger;
    public DbPasswordResetStore(NpgsqlDataSource db, ILogger<DbPasswordResetStore> logger) { _db = db; _logger = logger; }

    // One connection per call, always disposed with it.
    private async Task<T> Run<T>(string sql, object?[] args, Func<NpgsqlCommand, Task<T>> body, CancellationToken ct)
    {
        await using var connection = await _db.OpenConnectionAsync(ct);
        await using var cmd = new NpgsqlCommand(sql, connection);
        foreach (var a in args)
        {
            cmd.Parameters.Add(a is DateTimeOffset or null
                ? new NpgsqlParameter { NpgsqlDbType = NpgsqlDbType.TimestampTz, Value = a ?? DBNull.Value }
                : new NpgsqlParameter { Value = a });
        }
        return await body(cmd);
    }

    private Task<int> Exec(string sql, CancellationToken ct, params object?[] args) =>
        Run(sql, args, c => c.ExecuteNonQueryAsync(ct), ct);

    private Task<bool> HasLanguageAsync(CancellationToken ct) =>
        Run("select exists (select 1 from information_schema.columns where table_name = 'profile' and column_name = 'language')",
            Array.Empty<object?>(), async c => await c.ExecuteScalarAsync(ct) is true, ct);

    private async Task<ResetAccount?> FindAsync(string where, object arg, CancellationToken ct)
    {
        var lang = await HasLanguageAsync(ct) ? "coalesce(p.language, 'en')" : "'en'";
        return await Run($"select p.id, p.role, p.email, p.telegram_chat_id, {lang}, p.name from profile p where {where} limit 1",
            new[] { arg }, async c =>
            {
                await using var r = await c.ExecuteReaderAsync(ct);
                if (!await r.ReadAsync(ct)) return null;
                return new ResetAccount(r.GetGuid(0), r.IsDBNull(1) ? "farm_user" : r.GetString(1), r.IsDBNull(2) ? "" : r.GetString(2),
                    r.IsDBNull(3) ? null : r.GetInt64(3), r.GetString(4), r.IsDBNull(5) ? null : r.GetString(5));
            }, ct);
    }

    public Task<ResetAccount?> FindByEmailAsync(string email, CancellationToken ct) => FindAsync("lower(p.email) = $1", email, ct);
    public Task<ResetAccount?> FindByIdAsync(Guid profileId, CancellationToken ct) => FindAsync("p.id = $1", profileId, ct);

    public Task<int> CodesSinceAsync(Guid profileId, DateTimeOffset since, CancellationToken ct) =>
        Run("select count(*)::int from password_reset_code where profile_id = $1 and created_at > $2",
            new object?[] { profileId, since }, async c => (int)(await c.ExecuteScalarAsync(ct))!, ct);

    public Task SaveCodeAsync(Guid profileId, string hash, string salt, DateTimeOffset expiresAt, CancellationToken ct) =>
        Exec("insert into password_reset_code (profile_id, code_hash, salt, expires_at) values ($1, $2, $3, $4)", ct, profileId, hash, salt, expiresAt);

    public Task<StoredCode?> LatestCodeAsync(Guid profileId, CancellationToken ct) =>
        Run("select id, code_hash, salt, expires_at, used_at, attempts from password_reset_code where profile_id = $1 order by created_at desc limit 1",
            new object?[] { profileId }, async c =>
            {
                await using var r = await c.ExecuteReaderAsync(ct);
                if (!await r.ReadAsync(ct)) return null;
                return new StoredCode(r.GetInt64(0), r.GetString(1), r.GetString(2), r.GetFieldValue<DateTimeOffset>(3),
                    r.IsDBNull(4) ? null : r.GetFieldValue<DateTimeOffset>(4), r.GetInt32(5));
            }, ct);

    public Task CountAttemptAsync(long codeId, CancellationToken ct) =>
        Exec("update password_reset_code set attempts = attempts + 1 where id = $1", ct, codeId);

    public async Task UseCodeAsync(Guid profileId, long codeId, CancellationToken ct)
    {
        await Exec("update password_reset_code set used_at = now() where id = $1", ct, codeId);
        await Exec("update password_reset_code set expires_at = least(expires_at, now()) where profile_id = $1 and used_at is null", ct, profileId);
    }

    // DateTimeOffset.MaxValue: a temporary password that was already retired, so there is no
    // expiry left to act on (stored as null).
    public Task MarkTemporaryAsync(Guid profileId, DateTimeOffset expiresAt, CancellationToken ct) =>
        Exec("update profile set must_change_password = true, temp_password_expires_at = $2 where id = $1", ct,
            profileId, expiresAt == DateTimeOffset.MaxValue ? null : expiresAt);

    public Task ClearTemporaryAsync(Guid profileId, CancellationToken ct) =>
        Exec("update profile set must_change_password = false, temp_password_expires_at = null where id = $1", ct, profileId);

    // Signs the account out everywhere: Supabase keeps sessions in auth.sessions (refresh
    // tokens go with them). Access tokens already issued last until they expire (1 hour).
    public async Task EndSessionsAsync(Guid profileId, CancellationToken ct)
    {
        try
        {
            await Exec("delete from auth.sessions where user_id = $1", ct, profileId);
        }
        catch (PostgresException ex)
        {
            _logger.LogWarning(ex, "Could not end other sessions for {ProfileId} (auth.sessions not reachable for this role).", profileId);
        }
    }

    public Task SaveSignInLinkAsync(Guid profileId, string tokenHash, DateTimeOffset expiresAt, CancellationToken ct) =>
        Exec("insert into sign_in_link (profile_id, token_hash, expires_at) values ($1, $2, $3)", ct, profileId, tokenHash, expiresAt);

    public Task<StoredSignInLink?> UseSignInLinkAsync(string tokenHash, DateTimeOffset now, CancellationToken ct) =>
        Run("update sign_in_link l set used_at = now() from profile p " +
            "where l.token_hash = $1 and l.used_at is null and l.expires_at > $2 and p.id = l.profile_id " +
            "returning l.profile_id, p.email, l.expires_at, l.used_at",
            new object?[] { tokenHash, now }, async c =>
            {
                await using var r = await c.ExecuteReaderAsync(ct);
                if (!await r.ReadAsync(ct)) return null;
                return new StoredSignInLink(r.GetGuid(0), r.IsDBNull(1) ? "" : r.GetString(1), r.GetFieldValue<DateTimeOffset>(2), r.GetFieldValue<DateTimeOffset>(3));
            }, ct);

    public Task<IReadOnlyList<Guid>> ExpiredTemporaryAsync(DateTimeOffset now, CancellationToken ct) =>
        Run("select id from profile where must_change_password and temp_password_expires_at is not null and temp_password_expires_at <= $1",
            new object?[] { now }, async c =>
            {
                var list = new List<Guid>();
                await using var r = await c.ExecuteReaderAsync(ct);
                while (await r.ReadAsync(ct)) list.Add(r.GetGuid(0));
                return (IReadOnlyList<Guid>)list;
            }, ct);
}

// Every 15 minutes: retire temporary passwords older than 72 hours.
public sealed class TemporaryPasswordExpiryService : BackgroundService
{
    private readonly IServiceProvider _services;
    private readonly ILogger<TemporaryPasswordExpiryService> _logger;
    public TemporaryPasswordExpiryService(IServiceProvider services, ILogger<TemporaryPasswordExpiryService> logger) { _services = services; _logger = logger; }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromMinutes(15));
        do
        {
            try
            {
                var flow = _services.GetRequiredService<PasswordResetFlow>();
                var n = await flow.ExpireTemporaryPasswordsAsync(stoppingToken);
                if (n > 0) _logger.LogInformation("Retired {Count} expired temporary password(s).", n);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                // Before 0050 the column is missing; nothing to do until it is applied.
                _logger.LogDebug(ex, "Temporary password expiry sweep skipped.");
            }
        }
        while (await timer.WaitForNextTickAsync(stoppingToken));
    }
}
