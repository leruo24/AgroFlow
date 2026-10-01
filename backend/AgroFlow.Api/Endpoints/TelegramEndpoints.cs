using System.Security.Claims;
using AgroFlow.Api.Auth;
using AgroFlow.Api.Services;
using AgroFlow.Api.Services.Notifications;
using Npgsql;

namespace AgroFlow.Api.Endpoints;

public record TelegramCodeResponse(
    string Code,
    string? DeepLink,
    DateTimeOffset ExpiresAt);

public record TelegramLinkStatusResponse(
    bool Linked,
    bool AlertsEnabled);

public record TelegramAlertsRequest(bool Enabled);

public record TemporaryPasswordResponse(
    string TemporaryPassword,
    string Notice);

// Two audiences, two route groups:
//
//   /api/telegram/admin/*  - admin-only. Regenerating a farmer's QR code for
//                            one that expired or was lost, and resetting a
//                            temporary password for a farmer who has no
//                            Telegram at all.
//
//   /api/telegram/me/*     - any signed-in farmer, acting on themselves.
//                            This is how farmers onboarded before Telegram
//                            existed (john@test.db.za and anyone else already
//                            in the database) link their own chat from the
//                            mobile app's profile screen.
//
// Both sit behind JWT auth; neither is reachable with the device X-Api-Key.
// /api/telegram is listed in Program.cs's isUserRoute check for exactly that
// reason.
public static class TelegramEndpoints
{
    public static void MapTelegramEndpoints(this WebApplication app)
    {
        var admin = app.MapGroup("/api/telegram/admin")
            .RequireAuthorization()
            .AddEndpointFilter<AdminOnlyFilter>();

        admin.MapPost("/codes/{profileId:guid}", IssueCodeForFarmerAsync);
        admin.MapPost("/codes/{profileId:guid}/link", IssueLinkCodeForFarmerAsync);
        admin.MapPost("/password/{profileId:guid}", ResetTemporaryPasswordAsync);
        admin.MapPost("/password/{profileId:guid}/send", SendTemporaryPasswordAsync);

        var me = app.MapGroup("/api/telegram/me")
            .RequireAuthorization();

        me.MapGet("/", GetMyLinkStatusAsync);
        me.MapPost("/code", IssueMyCodeAsync);
        me.MapPost("/alerts", SetMyAlertsAsync);
        me.MapDelete("/", UnlinkMeAsync);
    }

    // ------------------------------------------------------------------
    // ADMIN
    // ------------------------------------------------------------------

    // "Regenerate code". Issuing a new code invalidates the farmer's previous
    // unused one, so an old printed QR stops working the moment a new one is
    // made - see TelegramOnboardingService.IssueCodeAsync.
    private static async Task<IResult> IssueCodeForFarmerAsync(
        Guid profileId,
        TelegramOnboardingService onboarding,
        NpgsqlDataSource dataSource,
        CancellationToken cancellationToken)
    {
        if (!await ProfileExistsAsync(dataSource, profileId, cancellationToken))
        {
            return Results.NotFound(new { error = "No such farmer." });
        }

        // Admin-issued, so redeeming it mints a fresh temporary password and
        // forces a change - the farmer has no usable password of their own yet.
        var issued = await onboarding.IssueCodeAsync(
            profileId, TelegramCodePurpose.Onboarding, cancellationToken);

        return Results.Ok(new TelegramCodeResponse(issued.Code, issued.DeepLink, issued.ExpiresAt));
    }

    // Chasing up a farmer who never connected Telegram, from the admin list.
    //
    // Deliberately a LINK code and not an onboarding one. The farmer already
    // has an account and a password they use; they simply never pressed Start
    // in the bot. Issuing an onboarding code here would reset that working
    // password and force a change they never asked for - exactly the problem
    // migration 0025 exists to prevent. Redeeming this attaches the chat and
    // touches nothing else.
    //
    // Code generation itself is untouched: this calls the same IssueCodeAsync
    // the other paths do, with the other purpose.
    private static async Task<IResult> IssueLinkCodeForFarmerAsync(
        Guid profileId,
        TelegramOnboardingService onboarding,
        NpgsqlDataSource dataSource,
        CancellationToken cancellationToken)
    {
        if (!await ProfileExistsAsync(dataSource, profileId, cancellationToken))
        {
            return Results.NotFound(new { error = "No such farmer." });
        }

        var issued = await onboarding.IssueCodeAsync(
            profileId, TelegramCodePurpose.Link, cancellationToken);

        if (issued.DeepLink is null)
        {
            return Results.Problem(
                title: "Telegram is not configured.",
                detail: "The AgroFlow bot username is not set on the server, so no link can be built.",
                statusCode: StatusCodes.Status503ServiceUnavailable);
        }

        return Results.Ok(new TelegramCodeResponse(issued.Code, issued.DeepLink, issued.ExpiresAt));
    }

    // The fallback for a farmer with no Telegram, and the answer to "what was
    // their password again?" - which cannot be answered, because AgroFlow
    // never stored it. This mints a new one and returns it once.
    private static async Task<IResult> ResetTemporaryPasswordAsync(
        Guid profileId,
        SupabaseAdminService supabaseAdmin,
        TelegramOnboardingService onboarding,
        NpgsqlDataSource dataSource,
        CancellationToken cancellationToken)
    {
        if (!await ProfileExistsAsync(dataSource, profileId, cancellationToken))
        {
            return Results.NotFound(new { error = "No such farmer." });
        }

        var password = await supabaseAdmin.ResetTemporaryPasswordAsync(profileId, cancellationToken);

        if (password is null)
        {
            return Results.Problem(
                title: "Could not reset the temporary password.",
                detail: "Supabase refused the password change. The farmer's existing password still works.",
                statusCode: StatusCodes.Status502BadGateway);
        }

        // Any temporary password must be changed at first sign-in, however it
        // was delivered - read off a screen or sent over Telegram.
        await onboarding.SetMustChangePasswordAsync(profileId, true, cancellationToken);

        return Results.Ok(new TemporaryPasswordResponse(
            password,
            "This password is shown once and is not stored. The farmer must change it when they sign in."));
    }

    // The same thing the farmer gets from "Forgot password?" in the app, but
    // triggered by an administrator - for a farmer who phones in rather than
    // using the app, or who cannot work the screen.
    //
    // Different from ResetTemporaryPasswordAsync above: that one RETURNS the
    // password for the admin to read out, and is the path for a farmer with no
    // Telegram. This one sends it to the farmer's own chat and never shows it
    // to the admin, so the credential goes only to the account's owner.
    private static async Task<IResult> SendTemporaryPasswordAsync(
        Guid profileId,
        PasswordResetService passwordReset,
        NpgsqlDataSource dataSource,
        CancellationToken cancellationToken)
    {
        if (!await ProfileExistsAsync(dataSource, profileId, cancellationToken))
        {
            return Results.NotFound(new { error = "No such farmer." });
        }

        var sent = await passwordReset.ResetForProfileAsync(profileId, cancellationToken);

        if (!sent)
        {
            return Results.BadRequest(new
            {
                error =
                    "This farmer has no Telegram connected, so a password cannot be sent to them. " +
                    "Use Reset password instead and read the new one out to them.",
            });
        }

        return Results.Ok(new
        {
            message = "A new temporary password has been sent to the farmer's Telegram.",
        });
    }

    // ------------------------------------------------------------------
    // FARMER, ACTING ON THEMSELVES
    // ------------------------------------------------------------------

    private static async Task<IResult> GetMyLinkStatusAsync(
        ClaimsPrincipal user,
        NpgsqlDataSource dataSource,
        CancellationToken cancellationToken)
    {
        if (!TryGetUserId(user, out var userId)) return Results.Unauthorized();

        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);

        await using var command = new NpgsqlCommand(
            "select telegram_chat_id is not null, telegram_alerts_enabled from profile where id = $1",
            connection);

        command.Parameters.AddWithValue(userId);

        await using var reader = await command.ExecuteReaderAsync(cancellationToken);

        if (!await reader.ReadAsync(cancellationToken)) return Results.NotFound();

        return Results.Ok(new TelegramLinkStatusResponse(reader.GetBoolean(0), reader.GetBoolean(1)));
    }

    // A farmer generating their own link code. This is the migration path for
    // everyone already in the database before Telegram existed: they open the
    // app, tap Connect Telegram, and the deep link opens the bot with the code
    // already filled in - no admin and no QR scanning needed, because they are
    // holding the phone that will do the linking.
    private static async Task<IResult> IssueMyCodeAsync(
        ClaimsPrincipal user,
        TelegramOnboardingService onboarding,
        CancellationToken cancellationToken)
    {
        if (!TryGetUserId(user, out var userId)) return Results.Unauthorized();

        // Farmer-issued: they are signed in with a password they already use
        // and only want their alerts delivered here, so redeeming this links
        // the chat and leaves the account untouched.
        var issued = await onboarding.IssueCodeAsync(
            userId, TelegramCodePurpose.Link, cancellationToken);

        if (issued.DeepLink is null)
        {
            return Results.Problem(
                title: "Telegram is not configured.",
                detail: "The AgroFlow bot username is not set on the server, so no link can be built.",
                statusCode: StatusCodes.Status503ServiceUnavailable);
        }

        return Results.Ok(new TelegramCodeResponse(issued.Code, issued.DeepLink, issued.ExpiresAt));
    }

    private static async Task<IResult> SetMyAlertsAsync(
        TelegramAlertsRequest request,
        ClaimsPrincipal user,
        TelegramOnboardingService onboarding,
        CancellationToken cancellationToken)
    {
        if (!TryGetUserId(user, out var userId)) return Results.Unauthorized();

        await onboarding.SetAlertsEnabledAsync(userId, request.Enabled, cancellationToken);

        return Results.NoContent();
    }

    // Unlinking clears the chat id only. It does not touch the alerts
    // preference, so re-linking later restores the farmer's previous choice
    // rather than silently turning alerts back on.
    private static async Task<IResult> UnlinkMeAsync(
        ClaimsPrincipal user,
        NpgsqlDataSource dataSource,
        CancellationToken cancellationToken)
    {
        if (!TryGetUserId(user, out var userId)) return Results.Unauthorized();

        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);

        await using var command = new NpgsqlCommand(
            "update profile set telegram_chat_id = null where id = $1", connection);

        command.Parameters.AddWithValue(userId);
        await command.ExecuteNonQueryAsync(cancellationToken);

        return Results.NoContent();
    }

    // ------------------------------------------------------------------

    private static async Task<bool> ProfileExistsAsync(
        NpgsqlDataSource dataSource,
        Guid profileId,
        CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);

        await using var command = new NpgsqlCommand(
            "select exists (select 1 from profile where id = $1)", connection);

        command.Parameters.AddWithValue(profileId);

        return (bool)(await command.ExecuteScalarAsync(cancellationToken))!;
    }

    private static bool TryGetUserId(ClaimsPrincipal user, out Guid userId) =>
        Guid.TryParse(user.FindFirstValue("sub"), out userId);
}
