using System.Net;
using Microsoft.Extensions.Options;
using Npgsql;

namespace AgroFlow.Api.Services.Notifications;

// Receives inbound Telegram messages by long-polling getUpdates.
//
// WHY POLLING AND NOT A WEBHOOK
// A webhook would need a public HTTPS endpoint that accepts unauthenticated
// POSTs from Telegram's IP ranges, plus a secret-token check, plus a way to
// keep it out of the device X-Api-Key gate in Program.cs. AgroFlow.Api is
// already always-on on Railway, so an outbound long poll gets the same
// messages with no new public surface at all.
//
// ONLY ONE INSTANCE MAY RUN THIS. Telegram gives each update to a single
// getUpdates consumer, and a second poll on the same token evicts the first
// with HTTP 409. Two pollers steal each other's messages, so a farmer's
// /start can vanish into a developer's laptop. Telegram:EnablePolling
// therefore defaults to FALSE and is set to true only on Railway.
public sealed class TelegramPollingService : BackgroundService
{
    private readonly TelegramClient _client;
    private readonly TelegramOnboardingService _onboarding;
    private readonly INotificationService _notifications;
    private readonly SupabaseAdminService _supabaseAdmin;
    private readonly NpgsqlDataSource _dataSource;
    private readonly TelegramOptions _options;
    private readonly ILogger<TelegramPollingService> _logger;

    // getUpdates is acknowledged by asking for the next id: passing
    // lastUpdateId + 1 is what tells Telegram the previous batch was handled
    // and may be dropped. Held in memory only - on restart Telegram replays
    // anything unacknowledged from the last 24 hours, which is the behaviour
    // we want.
    private long _offset;

    // Telegram renders message text literally, so this is a line break in the
    // chat. Deliberately not Environment.NewLine, which would be CRLF on a
    // Windows developer machine and LF on the deployed Linux container.
    private const string NewLine = "\n";

    public TelegramPollingService(
        TelegramClient client,
        TelegramOnboardingService onboarding,
        INotificationService notifications,
        SupabaseAdminService supabaseAdmin,
        NpgsqlDataSource dataSource,
        IOptions<TelegramOptions> options,
        ILogger<TelegramPollingService> logger)
    {
        _client = client;
        _onboarding = onboarding;
        _notifications = notifications;
        _supabaseAdmin = supabaseAdmin;
        _dataSource = dataSource;
        _options = options.Value;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!_options.IsConfigured || !_options.EnablePolling)
        {
            _logger.LogInformation(
                "Telegram polling is off (BotToken configured: {Configured}, EnablePolling: {Enabled}). " +
                "Outbound messages still work; inbound /start will not be received by this instance.",
                _options.IsConfigured, _options.EnablePolling);

            return;
        }

        _logger.LogInformation("Telegram polling started. This must be the only instance polling this bot token.");

        var consecutiveFailures = 0;

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                var updates = await _client.GetUpdatesAsync(_offset, stoppingToken);
                consecutiveFailures = 0;

                foreach (var update in updates)
                {
                    // Advance the offset BEFORE handling, so one poisonous
                    // message cannot be redelivered forever and wedge the
                    // loop. A dropped message is far cheaper than a bot that
                    // stops responding to everyone.
                    _offset = Math.Max(_offset, update.UpdateId + 1);

                    try
                    {
                        await HandleUpdateAsync(update, stoppingToken);
                    }
                    catch (Exception ex) when (ex is not OperationCanceledException)
                    {
                        _logger.LogError(ex, "Failed to handle Telegram update {UpdateId}.", update.UpdateId);
                    }
                }
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (TelegramApiException ex) when (ex.StatusCode == HttpStatusCode.Unauthorized)
            {
                // A 401 means the token does not match any bot: wrong value,
                // revoked, or a deleted bot. No amount of retrying fixes that,
                // and retrying anyway is how one bad token produced 11,320
                // identical warnings over a week - noise that buried every
                // real event in the log.
                //
                // Stop polling. The next deploy restarts this service, which
                // is exactly when a corrected token would arrive.
                _logger.LogCritical(
                    "Telegram rejected the bot token (401 Unauthorized). INBOUND MESSAGES ARE NOW OFF: " +
                    "farmers scanning an onboarding QR code will get no reply until this is fixed. " +
                    "Check Telegram__BotToken against @BotFather (/mybots -> API Token); a token that " +
                    "has been revoked gives exactly this. Polling will not retry until the next restart.");

                return;
            }
            catch (TelegramApiException ex) when (ex.StatusCode == HttpStatusCode.Conflict)
            {
                // The single most likely cause of "onboarding silently did
                // nothing", so it is logged as an error with the remedy in
                // the message rather than as a generic failure.
                _logger.LogError(
                    "Telegram returned 409 Conflict: another process is polling this same bot token. " +
                    "Two pollers steal each other's messages. Stop the local API, or unset " +
                    "Telegram__EnablePolling there, and leave polling on exactly one instance. {Message}",
                    ex.Message);

                consecutiveFailures++;
            }
            catch (Exception ex)
            {
                consecutiveFailures++;
                _logger.LogWarning(ex, "Telegram getUpdates failed (attempt {Attempt}).", consecutiveFailures);
            }

            if (consecutiveFailures > 0)
            {
                // Capped exponential backoff: 2s, 4s, 8s ... 60s. Keeps a
                // Telegram outage or a token typo from turning into a hot
                // loop against their API.
                var delay = TimeSpan.FromSeconds(Math.Min(60, Math.Pow(2, Math.Min(consecutiveFailures, 6))));

                try
                {
                    await Task.Delay(delay, stoppingToken);
                }
                catch (OperationCanceledException)
                {
                    break;
                }
            }
        }

        _logger.LogInformation("Telegram polling stopped.");
    }

    // PUBLIC so POST /api/telegram/webhook can hand this the same update
    // Telegram would otherwise have been long-polled for. Both inbound routes
    // then run identical handling - /start, /status, /alerts and /help behave
    // the same whichever way the update arrived - rather than a webhook
    // growing a second, drifting copy of the same switch.
    //
    // Safe to call while the poller is also running: nothing below touches
    // _offset (that is getUpdates' own acknowledgement bookkeeping, and the
    // webhook has no equivalent), and every state change it makes goes
    // through TelegramOnboardingService, where single-use code redemption is
    // already one atomic statement. A code delivered twice redeems once.
    public async Task HandleUpdateAsync(TelegramUpdate update, CancellationToken cancellationToken)
    {
        var chatId = update.Message?.Chat?.Id;
        var text = update.Message?.Text?.Trim();

        if (chatId is null || string.IsNullOrEmpty(text)) return;

        // "/start CODE" or "/start@AgroFlowBot CODE" - Telegram appends the
        // bot username when a command is sent in a group.
        var parts = text.Split(' ', 2, StringSplitOptions.RemoveEmptyEntries);
        var command = parts[0].Split('@')[0].ToLowerInvariant();
        var argument = parts.Length > 1 ? parts[1].Trim() : null;

        switch (command)
        {
            case "/start":
                await HandleStartAsync(chatId.Value, argument, cancellationToken);
                break;

            case "/status":
                await HandleStatusAsync(chatId.Value, cancellationToken);
                break;

            case "/alerts":
                await HandleAlertsAsync(chatId.Value, argument, cancellationToken);
                break;

            case "/help":
                await SendHelpAsync(chatId.Value, cancellationToken);
                break;

            default:
                await SendHelpAsync(chatId.Value, cancellationToken);
                break;
        }
    }

    // ------------------------------------------------------------------
    // /start - the only path that links a chat to a profile
    // ------------------------------------------------------------------

    private async Task HandleStartAsync(long chatId, string? code, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(code))
        {
            var existing = await _onboarding.GetProfileIdForChatAsync(chatId, cancellationToken);

            await _client.SendMessageAsync(
                chatId,
                existing is null
                    // Tells the farmer what they can do THEMSELVES first. The old
                    // wording sent everyone to an installer - a phone call and a wait -
                    // when most people reading it are holding the app that can link
                    // them in two taps.
                    ? "Hello from AgroFlow. This chat isn't linked to an account yet. " +
                      "In the AgroFlow app, go to Settings → Connect Telegram, or ask your " +
                      "installer for a link code."
                    : "This chat is already linked to your AgroFlow account.\n\n" +
                      "Send /status to see your open requests, or /help for what else I can do.",
                cancellationToken);

            return;
        }

        var redemption = await _onboarding.RedeemCodeAsync(code, chatId, cancellationToken);

        if (redemption is null)
        {
            _logger.LogInformation("Rejected a Telegram onboarding code from chat {ChatId}.", chatId);

            await _client.SendMessageAsync(
                chatId,
                "That link has already been used, or it has expired.\n\n" +
                "Please ask your AgroFlow installer to generate a new QR code for you.",
                cancellationToken);

            return;
        }

        var profileId = redemption.ProfileId;

        // A farmer who linked from the app already has an account and a
        // password they use every day. They asked for their alerts to arrive
        // here, nothing more - so the chat is linked and the account is left
        // completely alone. Resetting their password here would invalidate a
        // working one and force a change they never asked for, which is what
        // every existing farmer would have hit when connecting for alerts.
        if (redemption.Purpose == TelegramCodePurpose.Link)
        {
            await _client.SendMessageAsync(
                chatId,
                string.Join(NewLine, new[]
                {
                    "Your AgroFlow account is now connected.",
                    "",
                    "This is where I will message you when a zone gets too dry, when",
                    "irrigation starts or stops, and when one of your requests moves along.",
                    "",
                    "Your sign-in details have not changed.",
                    "",
                    "Send /alerts off at any time to stop the zone and device messages,",
                    "or /help to see everything I can do.",
                }),
                cancellationToken);

            return;
        }

        var farmer = await _onboarding.GetFarmerContextAsync(profileId, cancellationToken);

        if (farmer is null)
        {
            _logger.LogWarning(
                "Redeemed a code for profile {ProfileId} but found no profile row to describe.", profileId);

            await _client.SendMessageAsync(
                chatId,
                "Your Telegram is now linked to AgroFlow, but we could not load your account details. " +
                "Please contact your AgroFlow installer.",
                cancellationToken);

            return;
        }

        // A NEW temporary password is minted here rather than replayed from
        // onboarding, because AgroFlow never stores the one the admin saw.
        // The consequence is deliberate and is spelled out on the admin
        // screen: once the farmer links Telegram, the password shown at
        // onboarding stops working and this one takes over.
        var temporaryPassword = await _supabaseAdmin.ResetTemporaryPasswordAsync(profileId, cancellationToken);

        if (temporaryPassword is null)
        {
            await _client.SendMessageAsync(
                chatId,
                "Your Telegram is now linked to AgroFlow.\n\n" +
                "We could not issue your password just now. Please ask your AgroFlow installer " +
                "for it - your account itself is fine.",
                cancellationToken);

            return;
        }

        await _onboarding.SetMustChangePasswordAsync(profileId, true, cancellationToken);

        await _notifications.NotifyFarmerWelcomeAsync(
            profileId,
            new FarmerWelcomeNotification(
                farmer.Name,
                farmer.Email,
                temporaryPassword,
                string.IsNullOrWhiteSpace(farmer.FarmName) ? "your farm" : farmer.FarmName,
                string.IsNullOrWhiteSpace(farmer.FarmLocation) ? "not set" : farmer.FarmLocation),
            cancellationToken);
    }

    // ------------------------------------------------------------------
    // /status - request tracking
    // ------------------------------------------------------------------

    private async Task HandleStatusAsync(long chatId, CancellationToken cancellationToken)
    {
        var profileId = await _onboarding.GetProfileIdForChatAsync(chatId, cancellationToken);

        if (profileId is null)
        {
            await _client.SendMessageAsync(
                chatId,
                "This chat isn't linked to an account yet. " +
                "In the AgroFlow app, go to Settings → Connect Telegram, or ask your " +
                "installer for a link code.",
                cancellationToken);

            return;
        }

        var requests = await FetchOpenRequestsAsync(profileId.Value, cancellationToken);

        if (requests is null)
        {
            await _client.SendMessageAsync(
                chatId,
                "Request tracking is not switched on yet.\n\n" +
                "Once it is, you will be able to send requests from the AgroFlow app " +
                "and I will message you here every time one moves along.",
                cancellationToken);

            return;
        }

        if (requests.Count == 0)
        {
            await _client.SendMessageAsync(
                chatId,
                "You have no open requests.\n\n" +
                "You can send a new one - a new zone, a new farm, or a fault - from the AgroFlow app.",
                cancellationToken);

            return;
        }

        var lines = new List<string> { "Your open requests", "" };

        foreach (var request in requests)
        {
            lines.Add($"{request.RequestType}: {TelegramNotificationService.DescribeRequestStatus(request.Status)}");

            if (!string.IsNullOrWhiteSpace(request.Description))
            {
                lines.Add($"  {request.Description}");
            }

            lines.Add("");
        }

        await _client.SendMessageAsync(chatId, string.Join("\n", lines), cancellationToken);
    }

    // ------------------------------------------------------------------
    // THE ONE PLACE TO CHANGE WHEN LUBA'S REQUEST TABLE LANDS ON dev
    // ------------------------------------------------------------------
    // Farmers raise requests in the MOBILE APP, not over Telegram - the bot
    // only tracks them. That table is not on dev at the time of writing, so
    // this returns null, meaning "the feature does not exist yet" (as opposed
    // to an empty list, which means "you have none"), and /status says so
    // honestly rather than claiming the farmer has nothing open.
    //
    // To switch it on: replace the body below with a query against the real
    // table, filtered to this profile and to not-yet-closed statuses. The
    // admin's status-change write then needs one call to
    // INotificationService.NotifyRequestStatusAsync - nothing else in this
    // file or in TelegramNotificationService has to change.
    //
    // The existence probe means a half-deployed database (migration applied,
    // code not yet redeployed, or the reverse) degrades to the "coming soon"
    // message instead of throwing inside the polling loop.
    private async Task<List<OpenRequest>?> FetchOpenRequestsAsync(
        Guid profileId,
        CancellationToken cancellationToken)
    {
        await using var connection = await _dataSource.OpenConnectionAsync(cancellationToken);

        await using var probe = new NpgsqlCommand(
            "select to_regclass('public.request') is not null", connection);

        var exists = await probe.ExecuteScalarAsync(cancellationToken);

        if (exists is not true)
        {
            return null;
        }

        _logger.LogInformation(
            "A public.request table now exists, but FetchOpenRequestsAsync has not been pointed at it yet " +
            "(profile {ProfileId} asked for /status). See the comment above this method.",
            profileId);

        return null;
    }

    private sealed record OpenRequest(string RequestType, string Description, string Status);

    // ------------------------------------------------------------------
    // /alerts on|off
    // ------------------------------------------------------------------

    private async Task HandleAlertsAsync(long chatId, string? argument, CancellationToken cancellationToken)
    {
        var profileId = await _onboarding.GetProfileIdForChatAsync(chatId, cancellationToken);

        if (profileId is null)
        {
            await _client.SendMessageAsync(
                chatId,
                "This chat isn't linked to an account yet. " +
                "In the AgroFlow app, go to Settings → Connect Telegram, or ask your " +
                "installer for a link code.",
                cancellationToken);

            return;
        }

        var wanted = argument?.Trim().ToLowerInvariant();

        if (wanted is not ("on" or "off"))
        {
            await _client.SendMessageAsync(
                chatId,
                "Send /alerts on to get weather and equipment messages here, or " +
                "/alerts off to stop them." + NewLine + NewLine +
                "Your sign-in details and updates about your requests are always sent, " +
                "either way.",
                cancellationToken);

            return;
        }

        var enabled = wanted == "on";
        await _onboarding.SetAlertsEnabledAsync(profileId.Value, enabled, cancellationToken);

        await _client.SendMessageAsync(
            chatId,
            enabled
                ? "Alerts are on. I will message you about weather that could damage your " +
                  "crop, equipment that stops working, and any zone that needs water but " +
                  "cannot be watered automatically."
                : "Alerts are off. I will not message you about weather or equipment. " +
                  "Your sign-in details and updates about your requests will still come through.",
            cancellationToken);
    }

    private Task SendHelpAsync(long chatId, CancellationToken cancellationToken) =>
        _client.SendMessageAsync(
            chatId,
            string.Join(NewLine, new[]
            {
                "AgroFlow bot",
                "",
                "I only message you about things that need you:",
                "- your sign-in details",
                "- weather that could damage your crop",
                "- equipment that has stopped working",
                "- a zone that needed water and could not be watered automatically",
                "",
                "Everything else - watering that worked, your usage and your history -",
                "is in the AgroFlow app.",
                "",
                "/status - your open requests",
                "/alerts on - weather and equipment messages on",
                "/alerts off - weather and equipment messages off",
                "/help - this message",
                "",
                "To send a new request, use the AgroFlow app on your phone.",
            }),
            cancellationToken);
}
