namespace AgroFlow.Api.Services.Notifications;

// Outbound messages to a farmer, independent of the channel that carries
// them. This replaces IEmailService/ResendEmailService: AgroFlow now reaches
// farmers over a Telegram bot instead of email, but everything that wants to
// tell a farmer something still talks to this interface, so swapping the
// channel back (or adding a second one) is a DI registration change in
// Program.cs rather than an edit to every caller.
//
// THE CONTRACT EVERY IMPLEMENTATION MUST HONOUR: none of these methods may
// throw, ever. A farmer who never linked the bot, a blocked bot, a Telegram
// outage and a malformed chat id are all ordinary, expected conditions - they
// are logged and swallowed. The old Resend service did the opposite: a failed
// send threw, and because the send sat inside farmer onboarding's try block,
// an email outage rolled back a completed on-site onboarding (the Auth user,
// the farm and every zone were deleted). Nothing in irrigation, onboarding or
// sensor ingestion may ever fail because a message did.
//
// Addressing is by AgroFlow identity - a profile id, a zone id, a hardware id
// - never by chat id or email address. Resolving that to a channel address,
// and deciding the farmer has no address at all, is the implementation's job.
public interface INotificationService
{
    // Sent by the bot at the moment a farmer redeems their onboarding code,
    // not by the onboarding endpoint - see TelegramPollingService. A bot
    // cannot message anyone who has not messaged it first, so there is no
    // earlier moment at which this could be delivered.
    Task NotifyFarmerWelcomeAsync(
        Guid profileId,
        FarmerWelcomeNotification notification,
        CancellationToken cancellationToken);

    // Fired only on the transition INTO Critical, never on every reading
    // while a zone stays dry - see SensorReadingProcessor.
    Task NotifyZoneCriticalAsync(
        long zoneId,
        float moisture,
        CancellationToken cancellationToken);

    // command is "start" or "stop"; source is "auto" or "manual", as stored
    // on irrigation_commands.
    Task NotifyIrrigationAsync(
        long zoneId,
        string command,
        string source,
        CancellationToken cancellationToken);

    // Both directions: online=false when a device stops reporting, and
    // online=true when it comes back. Transition-only, from
    // DeviceStatusMonitorService.
    Task NotifyDeviceStatusAsync(
        long hardwareId,
        bool online,
        DateTimeOffset? lastSeen,
        CancellationToken cancellationToken);

    // Farmers raise requests (new zone, new farm, a fault) in the mobile app,
    // not over Telegram. This is the tracking half: the admin moves a request
    // along and the farmer hears about it. See RequestStatusNotification for
    // why this currently has no caller.
    Task NotifyRequestStatusAsync(
        Guid profileId,
        RequestStatusNotification notification,
        CancellationToken cancellationToken);
}

// The temporary password is passed in and never persisted anywhere. The bot
// generates a fresh one at redemption time (via the Supabase Admin API),
// sends it here, and forgets it - see SupabaseAdminService.ResetPasswordAsync.
public sealed record FarmerWelcomeNotification(
    string FarmerName,
    string Email,
    string TemporaryPassword,
    string FarmName,
    string FarmLocation);

// Mirrors the shape of a farmer request as the mobile app and admin will
// exchange it. Nothing constructs this yet: the request table is Luba's work
// and is not on dev at the time of writing, so the notification path is built
// and wired but unreachable. When that table lands, the admin's
// status-change write is the only place that needs to call
// NotifyRequestStatusAsync - everything downstream of it already works.
public sealed record RequestStatusNotification(
    string RequestType,
    string Description,
    string Status,
    string? ScheduledFor);

// Used when no channel is configured at all (no Telegram:BotToken). Every
// call is a no-op, so a developer running the API with no bot token gets a
// working API with silent notifications rather than a startup crash or a
// stream of errors.
public sealed class NullNotificationService : INotificationService
{
    private readonly ILogger<NullNotificationService> _logger;

    public NullNotificationService(ILogger<NullNotificationService> logger)
    {
        _logger = logger;

        _logger.LogWarning(
            "No notification channel is configured (Telegram:BotToken is not set). " +
            "Farmer notifications will be discarded.");
    }

    public Task NotifyFarmerWelcomeAsync(
        Guid profileId, FarmerWelcomeNotification notification, CancellationToken cancellationToken)
        => LogDiscarded("welcome", profileId.ToString());

    public Task NotifyZoneCriticalAsync(long zoneId, float moisture, CancellationToken cancellationToken)
        => LogDiscarded("zone-critical", $"zone {zoneId}");

    public Task NotifyIrrigationAsync(long zoneId, string command, string source, CancellationToken cancellationToken)
        => LogDiscarded($"irrigation-{command}", $"zone {zoneId}");

    public Task NotifyDeviceStatusAsync(long hardwareId, bool online, DateTimeOffset? lastSeen, CancellationToken cancellationToken)
        => LogDiscarded(online ? "device-online" : "device-offline", $"hardware {hardwareId}");

    public Task NotifyRequestStatusAsync(Guid profileId, RequestStatusNotification notification, CancellationToken cancellationToken)
        => LogDiscarded("request-status", profileId.ToString());

    private Task LogDiscarded(string kind, string target)
    {
        _logger.LogDebug(
            "Discarded {Kind} notification for {Target}: no notification channel configured.",
            kind, target);

        return Task.CompletedTask;
    }
}
