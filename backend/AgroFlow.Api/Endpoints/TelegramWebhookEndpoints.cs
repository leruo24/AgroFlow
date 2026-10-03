using System.Security.Claims;
using AgroFlow.Api.Services.Notifications;
using AgroFlow.Business;
using Microsoft.Extensions.Options;

namespace AgroFlow.Api.Endpoints;

public record TelegramLinkCodeResponse(string Code, string? DeepLink, DateTimeOffset ExpiresAt);

// Step 7: the webhook half of Telegram linking, and the app-facing endpoint
// that starts it.
//
// WHAT WAS ALREADY HERE
// ---------------------
// Linking a farmer's Telegram already worked, end to end: TelegramEndpoints
// issues a single-use code, TelegramOnboardingService redeems it, and
// TelegramPollingService receives the "/start <code>" by long-polling
// getUpdates. So this adds a second DELIVERY ROUTE for inbound updates, not
// a second linking mechanism - the webhook hands the update to the same
// TelegramPollingService.HandleUpdateAsync the poller calls, and every reply
// the farmer sees is unchanged.
//
// WHY ADD IT AT ALL
// -----------------
// Polling has a hazard that is written up at length in TelegramPollingService
// and in Program.cs: Telegram gives each update to exactly ONE getUpdates
// consumer, so a developer running the API locally with
// Telegram__EnablePolling=true silently steals the /start of a farmer
// standing in a field. That is why the flag defaults to false and must be
// true on exactly one instance. A webhook has no such mode - Telegram pushes
// to one URL, and a second instance cannot take delivery by accident.
//
// Both routes can safely be live at once. Nothing in the handler touches the
// poller's offset bookkeeping, and code redemption is a single atomic
// statement, so an update delivered twice links once.
public static class TelegramWebhookEndpoints
{
    public static void MapTelegramWebhookEndpoints(this WebApplication app)
    {
        // NOT RequireAuthorization: Telegram's servers hold no AgroFlow
        // credential, so this cannot carry a JWT. The secret header is the
        // whole gate - see TelegramWebhookAuth, which fails closed when the
        // secret is unset.
        //
        // Already exempt from the device X-Api-Key middleware, because
        // /api/telegram is in Program.cs's isUserRoute list.
        app.MapPost("/api/telegram/webhook", WebhookAsync);

        // The app's own Connect Telegram button. Under /api/farmer/telegram
        // rather than beside the existing /api/telegram/me/code so the mobile
        // app's whole surface stays on one prefix; it does the same thing
        // with a 15-minute code.
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
            // 401 and nothing else. A forged "/start <code>" would attach the
            // caller's own chat to a farmer's account, so this is the one
            // check that matters on this route.
            //
            // The secret itself is never logged, and neither is the presented
            // value - a near-miss in a log is a near-miss handed to whoever
            // reads logs.
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
            // Telegram RETRIES a non-2xx webhook call, and it does so for a
            // while. An update this code cannot process - a message type the
            // handler does not understand, a transient database error - would
            // then be redelivered indefinitely. Logging and acknowledging
            // drops that one update instead of turning it into a retry loop.
            logger.LogError(ex, "A Telegram webhook update failed to process; acknowledging it anyway.");
        }

        // Always 200. Telegram treats the response body as an optional reply
        // to send; an empty 200 just means "received".
        return Results.Ok();
    }

    // The app gets a one-time code, opens https://t.me/<bot>?start=<code>,
    // and the farmer pressing Start is what creates the chat the bot is then
    // allowed to use. A bot cannot message anyone first, so there is no way
    // to do this without the farmer initiating it.
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

        // Purpose.Link, never Onboarding. This farmer is signed in with a
        // password they already use and only wants their alerts delivered to
        // Telegram; an onboarding code would reset that working password and
        // force a change they never asked for - which is precisely what
        // migration 0025 exists to prevent.
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
