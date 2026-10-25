using AgroFlow.Api.Services;
using AgroFlow.Api.Services.Notifications;
using AgroFlow.Business;
using Microsoft.Extensions.Options;
using Npgsql;

namespace AgroFlow.Api.Endpoints;

// The farmer's welcome page for someone without Telegram: the same onboarding link as the QR,
// opened in a browser (/welcome?code=... on the public site). It shows what the bot would send.
// The temporary password is shown on the first open only; after that the page says so.
public static class WelcomeEndpoints
{
    public static void MapWelcomeEndpoints(this WebApplication app)
    {
        // POST, not GET: a link preview fetching the address must not use up the first open.
        // Security: the code is 192 random bits, single use for Telegram, 24 hours, onboarding only.
        app.MapPost("/api/public/welcome/{code}/open", OpenAsync).AllowAnonymous();
    }

    private static async Task<IResult> OpenAsync(
        string code,
        NpgsqlDataSource dataSource,
        PasswordResetFlow passwords,
        TelegramOnboardingService onboarding,
        IOptions<ApkOptions> apk,
        IConfiguration configuration,
        ILoggerFactory loggerFactory,
        CancellationToken ct)
    {
        await using var connection = await dataSource.OpenConnectionAsync(ct);

        Guid profileId;
        string name, email, language;
        bool expired, used, mustChange;
        await using (var find = new NpgsqlCommand("""
            select c.profile_id, c.expires_at <= now(), c.used_at is not null,
                   coalesce(nullif(p.name, ''), ''), p.email, p.must_change_password, coalesce(p.language, 'en')
              from telegram_onboarding_code c join profile p on p.id = c.profile_id
             where c.code = $1 and c.purpose = 'onboarding'
            """, connection))
        {
            find.Parameters.AddWithValue(code);
            await using var r = await find.ExecuteReaderAsync(ct);
            if (!await r.ReadAsync(ct)) return Results.NotFound(new { status = "invalid" });
            profileId = r.GetGuid(0);
            expired = r.GetBoolean(1);
            used = r.GetBoolean(2);
            name = r.GetString(3);
            email = r.GetString(4);
            mustChange = r.GetBoolean(5);
            language = r.GetString(6);
        }

        // Polite, and nothing personal: the admin can make a new QR code.
        if (expired) return Results.Ok(new { status = "expired" });
        if (used) return Results.Ok(new { status = "used" });

        // The first open wins the password (one statement, so two tabs cannot both get one).
        bool firstOpen;
        await using (var mark = new NpgsqlCommand(
            "update telegram_onboarding_code set web_opened_at = now() where code = $1 and web_opened_at is null returning 1",
            connection))
        {
            mark.Parameters.AddWithValue(code);
            firstOpen = await mark.ExecuteScalarAsync(ct) is not null;
        }

        string? password = null;
        if (firstOpen && mustChange)
        {
            // A new temporary password (72 hours, changed at first sign-in), like the bot's
            // welcome: AgroFlow never stores one, so it is made at the moment it is shown.
            password = await passwords.IssueTemporaryAsync(profileId, ct);
            if (password is null)
                loggerFactory.CreateLogger("AgroFlow.Api.Welcome").LogWarning(
                    "Could not set a temporary password for {ProfileId} on the welcome page.", profileId);
        }

        var signInBase = configuration["SignIn:LinkBaseUrl"]?.Trim().TrimEnd('/');
        return Results.Ok(new
        {
            status = "ok",
            name,
            email,
            language = BotText.Normalise(language),
            password = password is null ? null : EasyPassword.Display(password),
            passwordShownBefore = !firstOpen,
            passwordUnchanged = firstOpen && !mustChange,
            telegramLink = onboarding.BuildDeepLink(code),
            androidUrl = string.IsNullOrWhiteSpace(apk.Value.DownloadUrl) ? null : apk.Value.DownloadUrl,
            webAppUrl = string.IsNullOrWhiteSpace(signInBase) ? null : signInBase + "/login",
        });
    }
}
