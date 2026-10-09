using AgroFlow.Api.Services;

namespace AgroFlow.Api.Endpoints;

public record ForgotPasswordRequest(string Email);

public record ForgotPasswordResponse(string Message);

// Security: the only anonymous endpoint in AgroFlow, because a farmer who forgot
// their password cannot log in. /api/auth is skipped by the device-key gate in
// Program.cs and has no RequireAuthorization. It stays safe because:
//   - the new password is never returned; it only goes to the Telegram chat already
//     linked to that account
//   - the response is identical whether the address exists, has no Telegram, or was
//     rate limited, so it cannot be used to find accounts
//   - it is rate limited per email, so it cannot flood someone's Telegram
public static class PasswordResetEndpoints
{
    // Security: vague on purpose, and the same in every case.
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
        // Security: even a malformed address gets the neutral response, so an attacker
        // cannot tell the cases apart.
        if (!string.IsNullOrWhiteSpace(request.Email))
        {
            await passwordReset.RequestResetAsync(request.Email, cancellationToken);
        }

        return Results.Ok(new ForgotPasswordResponse(NeutralResponse));
    }
}
