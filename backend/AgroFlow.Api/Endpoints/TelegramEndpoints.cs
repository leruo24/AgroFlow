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
//   /api/telegram/admin/*  - admin only: regenerate a farmer's QR code, or reset
//                            a temporary password for a farmer without Telegram.
//
//   /api/telegram/me/*     - any signed-in farmer, acting on themselves: how
//                            existing farmers link their own chat from the
//                            app's profile screen.
//
// Security: both need a JWT and neither accepts the device X-Api-Key
// (/api/telegram is in Program.cs's isUserRoute list).
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
        admin.MapDelete("/link/{profileId:guid}", UnlinkFarmerAsync);

        var me = app.MapGroup("/api/telegram/me")
            .RequireAuthorization();

        me.MapGet("/", GetMyLinkStatusAsync);
        me.MapPost("/code", IssueMyCodeAsync);
        me.MapPost("/alerts", SetMyAlertsAsync);
        me.MapDelete("/", UnlinkMeAsync);
    }

    // Admin

    // "Regenerate code". A new code cancels the farmer's old unused one, so an old
    // printed QR stops working (see TelegramOnboardingService.IssueCodeAsync).
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

        // Admin-issued, so redeeming it creates a new temporary password and forces a
        // change: the farmer has no password of their own yet.
        var issued = await onboarding.IssueCodeAsync(
            profileId, TelegramCodePurpose.Onboarding, cancellationToken);

        return Results.Ok(new TelegramCodeResponse(issued.Code, issued.DeepLink, issued.ExpiresAt));
    }

    // Following up a farmer who never connected Telegram.
    // A link code, not an onboarding code: the farmer already has a working password,
    // and an onboarding code would reset it (what migration 0025 prevents). Redeeming
    // this only attaches the chat.
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

    // The two older admin routes, kept so old links work. Both now do the same as
    // POST /api/admin/farmers/{id}/reset-password: a new easy temporary password (72 hours,
    // changed at first sign-in), sent by Telegram if linked, otherwise shown once. Audited.
    private static Task<IResult> ResetTemporaryPasswordAsync(
        Guid profileId, ClaimsPrincipal user, PasswordResetFlow flow, CancellationToken cancellationToken) =>
        PasswordResetEndpoints.AdminResetAsync(profileId, user, flow, cancellationToken);

    private static Task<IResult> SendTemporaryPasswordAsync(
        Guid profileId, ClaimsPrincipal user, PasswordResetFlow flow, CancellationToken cancellationToken) =>
        PasswordResetEndpoints.AdminResetAsync(profileId, user, flow, cancellationToken);

    // "Unlink Telegram" on a farmer's profile: lost or changed phone. Clears the chat and
    // any unused codes, so they re-link with a new code. Audited.
    private static async Task<IResult> UnlinkFarmerAsync(
        Guid profileId,
        ClaimsPrincipal user,
        TelegramUnlinkService unlink,
        CancellationToken cancellationToken) =>
        (await unlink.UnlinkAsync(user, profileId, cancellationToken)).ToResult();

    // Farmer, acting on themselves

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

    // A farmer creating their own link code: they tap Connect Telegram and the
    // deep link opens the bot with the code filled in. No admin or QR needed.
    private static async Task<IResult> IssueMyCodeAsync(
        ClaimsPrincipal user,
        TelegramOnboardingService onboarding,
        CancellationToken cancellationToken)
    {
        if (!TryGetUserId(user, out var userId)) return Results.Unauthorized();

        // Farmer-issued: they already have a password, so redeeming only links the chat.
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

    // Unlinking clears the chat id only, so re-linking later keeps the farmer's
    // alerts preference. The same service as the admin's Unlink Telegram: it also expires
    // the farmer's unused codes and records it in the activity log.
    private static async Task<IResult> UnlinkMeAsync(
        ClaimsPrincipal user,
        TelegramUnlinkService unlink,
        CancellationToken cancellationToken)
    {
        if (!TryGetUserId(user, out var userId)) return Results.Unauthorized();

        var outcome = await unlink.UnlinkAsync(user, userId, cancellationToken);
        return outcome.Status == StatusCodes.Status200OK ? Results.NoContent() : outcome.ToResult();
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
