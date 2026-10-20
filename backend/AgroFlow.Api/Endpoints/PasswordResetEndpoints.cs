using System.Security.Claims;
using AgroFlow.Api.Auth;
using AgroFlow.Api.Services;

namespace AgroFlow.Api.Endpoints;

// RedirectTo: only used for staff with no Telegram, who keep Supabase's email reset (the admin
// site's ?reset=1 page).
public record ForgotPasswordRequest(string? Email, string? RedirectTo = null);
public record ForgotPasswordResponse(string Message);
public record ResetPasswordRequest(string? Email, string? Code, string? NewPassword);
public record OneTapRequest(string? Token);
public record OneTapResponse(string Email, string TokenHash);
public record AdminPasswordResetResponse(bool SentByTelegram, string? TemporaryPassword, string Message);

// Signing in and resetting a password without email (docs/password-reset.md).
// Security: the three /api/auth routes are anonymous (someone who forgot their password
// cannot log in). They stay safe because:
//   - forgot-password answers the same in every case, so it cannot find accounts, and the
//     code only goes to the Telegram chat already linked to that account;
//   - a code works once, for 10 minutes, with 5 tries, and at most 3 are sent an hour;
//   - one-tap needs a 256-bit token that works once, for 24 hours.
public static class PasswordResetEndpoints
{
    public const string StaffPasswordResetMessage =
        "Staff reset their own password with Forgot password on the admin site sign-in page. AgroFlow emails a link (check the spam folder too).";

    public static void MapPasswordResetEndpoints(this WebApplication app)
    {
        app.MapPost("/api/auth/forgot-password", ForgotPasswordAsync).AllowAnonymous();
        app.MapPost("/api/auth/reset-password", ResetPasswordAsync).AllowAnonymous();
        app.MapPost("/api/auth/one-tap", OneTapAsync).AllowAnonymous();

        app.MapPost("/api/admin/farmers/{profileId:guid}/reset-password", AdminResetAsync)
            .RequireAuthorization().AddEndpointFilter<AdminOnlyFilter>();
    }

    private static async Task<IResult> ForgotPasswordAsync(
        ForgotPasswordRequest request, PasswordResetFlow flow, CancellationToken ct)
    {
        await flow.RequestAsync(request.Email, request.RedirectTo, ct);
        return Results.Ok(new ForgotPasswordResponse(PasswordResetFlow.NeutralReply));
    }

    private static async Task<IResult> ResetPasswordAsync(
        ResetPasswordRequest request, PasswordResetFlow flow, CancellationToken ct)
    {
        return await flow.ConfirmAsync(request.Email, request.Code, request.NewPassword, ct) switch
        {
            ConfirmResult.Changed => Results.Ok(new { message = "Your password was changed. Sign in with your new password." }),
            ConfirmResult.WeakPassword => Results.BadRequest(new { error = "Use at least 8 characters for your new password." }),
            ConfirmResult.TooManyAttempts => Results.Json(new { error = "Too many tries. Ask for a new code." }, statusCode: StatusCodes.Status429TooManyRequests),
            _ => Results.BadRequest(new { error = "That code is not right, or it has expired. Check it, or ask for a new one." }),
        };
    }

    private static async Task<IResult> OneTapAsync(OneTapRequest request, PasswordResetFlow flow, CancellationToken ct)
    {
        var redeemed = await flow.RedeemSignInLinkAsync(request.Token, ct);
        return redeemed is { } r
            ? Results.Ok(new OneTapResponse(r.Email, r.TokenHash))
            : Results.BadRequest(new { error = "This sign-in link has expired or was already used. Sign in with your temporary password instead." });
    }

    // "Reset password" on a farmer's page: a new easy temporary password, sent by Telegram if
    // linked, otherwise shown once to the admin. Audited.
    internal static async Task<IResult> AdminResetAsync(
        Guid profileId, ClaimsPrincipal user, PasswordResetFlow flow, CancellationToken ct)
    {
        AdminResetResult result;
        try
        {
            result = await flow.AdminResetAsync(user, profileId, ct);
        }
        catch (InvalidOperationException)
        {
            return Results.Problem(title: "Could not reset the password.",
                detail: "Supabase refused the new password. The farmer's current password still works.",
                statusCode: StatusCodes.Status502BadGateway);
        }
        if (!result.Found) return Results.NotFound(new { error = "No such farmer." });
        // Staff reset their own password by email (Forgot password on the admin site), never
        // with a temporary password read out or sent on Telegram.
        if (result.StaffRefused)
            return Results.Json(new { error = StaffPasswordResetMessage }, statusCode: StatusCodes.Status409Conflict);
        return Results.Ok(result.SentByTelegram
            ? new AdminPasswordResetResponse(true, null,
                "A new temporary password was sent to the farmer's Telegram. It works for 72 hours.")
            : new AdminPasswordResetResponse(false, result.ShownOnce,
                "Shown once, not stored. Read it to the farmer: it works for 72 hours and must be changed at first sign-in."));
    }
}
