using System.Security.Claims;
using AgroFlow.Api.Services.Notifications;
using AgroFlow.Business;
using Microsoft.Extensions.Options;

namespace AgroFlow.Api.Endpoints;

public record TelegramLinkCodeResponse(string Code, string? DeepLink, DateTimeOffset ExpiresAt);

// The webhook route for Telegram updates, and the app endpoint that starts linking.
// It is a second way to receive updates, not a second linking system: the webhook
// passes each update to the same TelegramPollingService.HandleUpdateAsync.
// We add it because with polling only one getUpdates consumer gets each update, so
// a developer polling locally could steal a farmer's /start. A webhook pushes to
// one URL. Both can run at once: code redemption is one atomic statement, so an
// update delivered twice links once.
public static class TelegramWebhookEndpoints
{
    public static void MapTelegramWebhookEndpoints(this WebApplication app)
    {
        // Security: no RequireAuthorization because Telegram's servers have no AgroFlow
        // credential. The secret header is the only gate (TelegramWebhookAuth fails closed
        // when it is unset). Already exempt from the device key (/api/telegram is in
        // isUserRoute).
        app.MapPost("/api/telegram/webhook", WebhookAsync);

        // The app's Connect Telegram button, under /api/farmer like the rest of the
        // app's routes. Same as /api/telegram/me/code, with a 15-minute code.
        app.MapPost("/api/farmer/telegram/link-code", IssueLinkCodeAsync)
            .RequireAuthorization();
    }

    private static async Task<IResult> WebhookAsync(
        TelegramUpdate update,
        HttpContext context,
        TelegramPollingService handler,
        IOptions<TelegramOptions> options,
        ILoggerFactory loggerFactory,
        CancellationToken cancellationToken)
    {
        var logger = loggerFactory.CreateLogger("AgroFlow.Api.TelegramWebhook");

        var presented = context.Request.Headers[TelegramWebhookAuth.HeaderName].ToString();

        if (!TelegramWebhookAuth.IsAuthorised(presented, options.Value.WebhookSecret))
        {
            // Security: 401 and nothing else. A forged "/start <code>" would attach someone
            // else's chat to a farmer's account. Neither the secret nor the value sent is
            // ever logged.
            logger.LogWarning(
                "Refused a Telegram webhook call with a missing or wrong {Header}.",
                TelegramWebhookAuth.HeaderName);

            return Results.Unauthorized();
        }

        try
        {
            await handler.HandleUpdateAsync(update, cancellationToken);
        }
        catch (Exception ex)
        {
            // Telegram retries failed webhook calls for a long time, so we log the error and
            // still acknowledge, dropping that one update instead of looping.
            logger.LogError(ex, "A Telegram webhook update failed to process; acknowledging it anyway.");
        }

        // Always 200; an empty 200 means "received".
        return Results.Ok();
    }

    // The app gets a one-time code and opens https://t.me/<bot>?start=<code>. A bot
    // cannot message anyone first, so the farmer pressing Start creates the chat.
    private static async Task<IResult> IssueLinkCodeAsync(
        ClaimsPrincipal user,
        TelegramOnboardingService onboarding,
        IOptions<TelegramOptions> options,
        CancellationToken cancellationToken)
    {
        if (!Guid.TryParse(user.FindFirstValue("sub"), out var userId))
        {
            return Results.Unauthorized();
        }

        // Purpose.Link, never Onboarding: the farmer already has a password, and an
        // onboarding code would reset it (what migration 0025 prevents).
        var issued = await onboarding.IssueCodeAsync(
            userId,
            TelegramCodePurpose.Link,
            cancellationToken,
            TimeSpan.FromMinutes(Math.Max(1, options.Value.LinkCodeTtlMinutes)));

        if (issued.DeepLink is null)
        {
            return Results.Problem(
                title: "Telegram is not configured.",
                detail: "The AgroFlow bot username is not set on the server, so no link can be built.",
                statusCode: StatusCodes.Status503ServiceUnavailable);
        }

        return Results.Ok(new TelegramLinkCodeResponse(issued.Code, issued.DeepLink, issued.ExpiresAt));
    }
}
