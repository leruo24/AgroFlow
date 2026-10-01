using AgroFlow.Api.Services;

namespace AgroFlow.Api.Endpoints;

public record ForgotPasswordRequest(string Email);

public record ForgotPasswordResponse(string Message);

// The only anonymous endpoint in AgroFlow.
//
// It has to be: a farmer who has forgotten their password cannot authenticate
// to ask for a new one, and cannot present the device X-Api-Key either.
// /api/auth is therefore listed in Program.cs's isUserRoute check so the
// device shared-secret gate skips it, and the route has no RequireAuthorization.
//
// Everything that makes that safe lives behind it, not in front of it:
//
//   - The new password is NEVER returned to the caller. It goes only to the
//     Telegram chat already linked to that account, which the requester can
//     only read if they are that farmer.
//   - The response is byte-for-byte identical whether the address exists, has
//     no Telegram linked, or was rate limited. Otherwise this endpoint would
//     be an account enumerator.
//   - Rate limited per email address, so it cannot be used to flood somebody
//     else's Telegram.
public static class PasswordResetEndpoints
{
    // Deliberately vague, and deliberately the same in every case.
    private const string NeutralResponse =
        "If that email address belongs to an AgroFlow account with Telegram connected, " +
        "a new temporary password has been sent to that Telegram chat. " +
        "If nothing arrives, please contact your administrator.";

    public static void MapPasswordResetEndpoints(this WebApplication app)
    {
        app.MapPost("/api/auth/forgot-password", ForgotPasswordAsync).AllowAnonymous();
    }

    private static async Task<IResult> ForgotPasswordAsync(
        ForgotPasswordRequest request,
        PasswordResetService passwordReset,
        CancellationToken cancellationToken)
    {
        // Even a malformed address returns the neutral response rather than a
        // validation error: "that is not a valid email" versus "sent" is still
        // a difference an attacker can measure.
        if (!string.IsNullOrWhiteSpace(request.Email))
        {
            await passwordReset.RequestResetAsync(request.Email, cancellationToken);
        }

        return Results.Ok(new ForgotPasswordResponse(NeutralResponse));
    }
}
