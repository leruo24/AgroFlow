using System.Net;
using Microsoft.Extensions.Options;
using Npgsql;

namespace AgroFlow.Api.Services.Notifications;

// Receives Telegram messages by long-polling getUpdates. The API is always on, so
// an outbound poll needs no new public endpoint.
// Only one instance may run this: Telegram gives each update to one consumer and a
// second poller kicks off the first (HTTP 409), so two pollers steal each other's
// messages. Telegram:EnablePolling defaults to false and is only true on Railway.
public sealed class TelegramPollingService : BackgroundService
{
    private readonly TelegramClient _client;
    private readonly TelegramOnboardingService _onboarding;
    private readonly INotificationService _notifications;
    private readonly SupabaseAdminService _supabaseAdmin;
    private readonly NpgsqlDataSource _dataSource;
    private readonly TelegramWhyHandler _why;
    private readonly TelegramOptions _options;
    private readonly ILogger<TelegramPollingService> _logger;
    private readonly PasswordResetFlow? _passwords;
    private readonly ApkOptions _apk;

    // We acknowledge updates by asking for the next id (lastUpdateId + 1). Kept in
    // memory only; after a restart Telegram resends anything unacknowledged from the
    // last 24 hours, which is what we want.
    private long _offset;

    // When getUpdates last succeeded. GET /api/admin/health uses it to tell a quiet
    // bot from one that stopped polling. Only set on success.
    public DateTimeOffset? LastSuccessfulPollUtc { get; private set; }

    // A line break in the chat. Not Environment.NewLine, which differs between Windows
    // and the Linux container.
    private const string NewLine = "\n";

    public TelegramPollingService(
        TelegramClient client,
        TelegramOnboardingService onboarding,
        INotificationService notifications,
        SupabaseAdminService supabaseAdmin,
        NpgsqlDataSource dataSource,
        TelegramWhyHandler why,
        IOptions<TelegramOptions> options,
        ILogger<TelegramPollingService> logger,
        PasswordResetFlow? passwords = null,
        IOptions<ApkOptions>? apk = null)
    {
        // Optional only so tests that do not reach onboarding can leave them out.
        _passwords = passwords;
        _apk = apk?.Value ?? new ApkOptions();
        _why = why;
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

                // Only set on success, so the health check can tell "nobody is messaging" from
                // "stopped polling".
                LastSuccessfulPollUtc = DateTimeOffset.UtcNow;

                foreach (var update in updates)
                {
                    // Move the offset forward before handling, so one bad message cannot be resent
                    // forever and jam the loop. Losing one message is better than a stuck bot.
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
                // 401 means the token matches no bot (wrong, revoked or deleted). Retrying never
                // helps and once filled the log with 11,320 identical warnings, so we stop polling;
                // the next deploy restarts this with the fixed token.
                _logger.LogCritical(
                    "Telegram rejected the bot token (401 Unauthorized). INBOUND MESSAGES ARE NOW OFF: " +
                    "farmers scanning an onboarding QR code will get no reply until this is fixed. " +
                    "Check Telegram__BotToken against @BotFather (/mybots -> API Token); a token that " +
                    "has been revoked gives exactly this. Polling will not retry until the next restart.");

                return;
            }
            catch (TelegramApiException ex) when (ex.StatusCode == HttpStatusCode.Conflict)
            {
                // The most likely cause of "onboarding silently did nothing", so we log it as an
                // error with the fix in the message.
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
                // Capped exponential backoff: 2s, 4s, 8s ... 60s, so an outage or a token typo does
                // not become a hot loop against Telegram.
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

    // Public so POST /api/telegram/webhook can pass in the same update, and both routes
    // handle /start, /status, /alerts and /help the same way.
    // Safe to call while the poller runs: nothing here touches _offset, and code
    // redemption in TelegramOnboardingService is one atomic statement, so an update
    // delivered twice links once.
    public async Task HandleUpdateAsync(TelegramUpdate update, CancellationToken cancellationToken)
    {
        // A tap on "Why am I seeing this?". Only answered to a chat on the farm the
        // explanation belongs to (see TelegramWhyHandler).
        if (update.CallbackQuery is { } callback)
        {
            var callbackChat = callback.Message?.Chat?.Id;
            if (callbackChat is null)
            {
                await _client.AnswerCallbackQueryAsync(callback.Id, null, cancellationToken);
                return;
            }

            await _why.HandleCallbackAsync(callback.Id, callbackChat.Value, callback.Data, cancellationToken);
            return;
        }

        var chatId = update.Message?.Chat?.Id;
        var text = update.Message?.Text?.Trim();

        if (chatId is null || string.IsNullOrEmpty(text)) return;

        // "/start CODE" or "/start@AgroFlowBot CODE": Telegram adds the bot username in groups.
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

            // Fallback for the "Why am I seeing this?" button: /why <id>.
            case "/why":
                await _why.HandleWhyCommandAsync(chatId.Value, argument, cancellationToken);
                break;

            default:
                await SendHelpAsync(chatId.Value, cancellationToken);
                break;
        }
    }

    // /start: the only path that links a chat to a profile

    private async Task HandleStartAsync(long chatId, string? code, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(code))
        {
            var existing = await _onboarding.GetProfileIdForChatAsync(chatId, cancellationToken);

            await _client.SendMessageAsync(
                chatId,
                existing is null
                    // Tell the farmer what they can do themselves first: most people reading this have
                    // the app, which can link them in two taps.
                    ? "Hello from AgroFlow. This chat isn't linked to an account yet. " +
                      "In the AgroFlow app, go to Settings → Connect Telegram, or ask your " +
                      "installer for a link code."
                    : "This chat is already linked to your AgroFlow account.\n\n" +
                      "Send /status to see your open requests, or /help for what else I can do.",
                cancellationToken);

            return;
        }

        TelegramRedemption? redemption;
        try
        {
            redemption = await _onboarding.RedeemCodeAsync(code, chatId, cancellationToken);
        }
        catch (StaffTelegramRefusedException)
        {
            // Telegram is for farmers only.
            await _client.SendMessageAsync(chatId, StaffTelegram.RefusedMessage, cancellationToken);
            return;
        }

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

        // A farmer who linked from the app already has a password, so we only link the
        // chat and leave the account alone; resetting would break a working password.
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

        // We create a new temporary password here because AgroFlow never stores the one
        // the admin saw. The admin screen explains that once the farmer links Telegram, the
        // onboarding password stops working and this one replaces it. The welcome also carries
        // a one-tap "Sign in to AgroFlow" link (SignIn:LinkBaseUrl), in the farmer's language.
        var sent = _passwords is not null && await _passwords.SendWelcomeAsync(
            profileId,
            string.IsNullOrWhiteSpace(farmer.FarmName) ? "your farm" : farmer.FarmName,
            string.IsNullOrWhiteSpace(farmer.FarmLocation) ? "not set" : farmer.FarmLocation,
            string.IsNullOrWhiteSpace(_apk.DownloadUrl) ? null : _apk.DownloadUrl,
            cancellationToken);

        if (!sent)
        {
            await _client.SendMessageAsync(
                chatId,
                "Your Telegram is now linked to AgroFlow.\n\n" +
                "We could not issue your password just now. Please ask your AgroFlow installer " +
                "for it - your account itself is fine.",
                cancellationToken);
        }
    }

    // /status: request tracking

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

    // Farmers raise requests in the app; the bot only tracks them. Until the request
    // table is on dev this returns null ("feature not ready", unlike an empty list,
    // "you have none"), and /status says so.
    // To turn it on: query the real table here, filtered to this profile and open
    // statuses, and call INotificationService.NotifyRequestStatusAsync when an admin
    // changes a status. Nothing else needs to change.
    // The existence check means a half-deployed database shows the "coming soon" message
    // instead of throwing inside the polling loop.
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

    // /alerts on|off

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
                "/why <number> - why I sent you a message (or tap its button)",
                "/help - this message",
                "",
                "To send a new request, use the AgroFlow app on your phone.",
            }),
            cancellationToken);
}
