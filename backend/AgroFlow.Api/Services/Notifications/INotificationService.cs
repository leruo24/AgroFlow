using AgroFlow.Business;

namespace AgroFlow.Api.Services.Notifications;

// Outbound messages to a farmer, independent of the channel that carries them.
// This replaced IEmailService/ResendEmailService; the implementation is
// Telegram, but everything that wants to tell a farmer something talks to this
// interface, so swapping or adding a channel is a DI change in Program.cs
// rather than an edit to every caller.
//
// WHAT BELONGS ON THIS CHANNEL
// Only things the farmer must act on, or that the app physically cannot
// deliver. Specifically:
//   - sign-in details they have no other way of receiving (onboarding, and a
//     forgotten password)
//   - weather that could damage the crop
//   - equipment that has stopped working
//   - a zone that needed watering and could NOT be watered automatically
//
// Everything routine - irrigation that worked, usage history, summaries,
// account changes - stays in the app. The moment this channel carries things
// the farmer does not need to act on, they mute it, and then they miss the
// frost warning. Routine irrigation start/stop notifications were deliberately
// REMOVED for exactly that reason.
//
// THE CONTRACT EVERY IMPLEMENTATION MUST HONOUR: none of these methods may
// throw, ever. A farmer who never linked the bot, a blocked bot, a Telegram
// outage and a malformed chat id are all ordinary, expected conditions - they
// are logged and swallowed. The old Resend service did the opposite: a failed
// send threw, and because the send sat inside farmer onboarding's try block,
// an email outage rolled back a completed on-site onboarding. Nothing in
// irrigation, onboarding or sensor ingestion may ever fail because a message
// did.
//
// Addressing is by AgroFlow identity - a profile id, a zone id, a farm id -
// never by chat id or email address. Resolving that to a channel address, and
// deciding the farmer has no address at all, is the implementation's job.
public interface INotificationService
{
    // Sent by the bot at the moment a farmer redeems an ONBOARDING code - see
    // TelegramPollingService. A bot cannot message anyone who has not messaged
    // it first, so there is no earlier moment at which this could be
    // delivered.
    Task NotifyFarmerWelcomeAsync(
        Guid profileId,
        FarmerWelcomeNotification notification,
        CancellationToken cancellationToken);

    // A farmer who forgot their password. The temporary password is generated,
    // sent and forgotten - AgroFlow never stores one.
    Task NotifyPasswordResetAsync(
        Guid profileId,
        string temporaryPassword,
        CancellationToken cancellationToken);

    // A zone that went Critical AND that AgroFlow could not water itself. A
    // zone that went Critical and was watered automatically is app-only: the
    // farmer has nothing to do, so messaging them trains them to ignore the
    // channel. See ZoneCriticalReason.
    Task NotifyZoneCriticalAsync(
        long zoneId,
        float moisture,
        ZoneCriticalReason reason,
        CancellationToken cancellationToken);

    // Weather that could damage the crop, from the forecast rows
    // WeatherCollectionService already stores.
    Task NotifyWeatherAsync(
        long farmId,
        WeatherAlertNotification notification,
        CancellationToken cancellationToken);

    // Equipment that has stopped working: a device gone quiet, a pump that
    // never acknowledged a command, a zone with nothing able to control it.
    Task NotifySystemFailureAsync(
        long farmId,
        SystemFailureNotification notification,
        CancellationToken cancellationToken);

    // Farmers raise requests (new zone, new farm, a fault) in the mobile app,
    // not over Telegram. This is the tracking half: the admin moves a request
    // along and the farmer hears about it. See RequestStatusNotification for
    // why this currently has no caller.
    Task NotifyRequestStatusAsync(
        Guid profileId,
        RequestStatusNotification notification,
        CancellationToken cancellationToken);

    // A farmer's new-farm / new-zone request moving along: submitted,
    // scheduled for installation, completed.
    //
    // WHY THIS IS A SECOND METHOD AND NOT A REUSE OF THE ONE ABOVE
    // NotifyRequestStatusAsync sends a generic "Update on your request /
    // Status: ..." block for any status whatsoever. These three moments want
    // specific words, because each one tells the farmer something different
    // about a physical kit on its way to their farm, and "Status: Scheduled -
    // a visit has been booked" does not say that a box is coming. The copy
    // lives in FarmRequestMessages so it can be reviewed and tested in one
    // place; the generic method is left exactly as it was for any other
    // status change.
    //
    // Sent only when the farmer has a chat id AND - per the note on
    // NotifyRequestStatusAsync - regardless of telegram_alerts_enabled:
    // somebody who muted weather and equipment messages still needs to know a
    // technician is coming to their farm.
    Task NotifyFarmRequestAsync(
        Guid profileId,
        FarmRequestNotification notification,
        CancellationToken cancellationToken);

    // The same submission, to every admin who has linked a chat. This is a
    // work-queue notice, not farmer-facing copy.
    Task NotifyAdminsOfFarmRequestAsync(
        FarmRequestAdminNotification notification,
        CancellationToken cancellationToken);

    // Item 6c: a plain work-queue notice to every admin with a linked chat
    // ("New enquiry: ..."). A default body, so a channel that has nothing to
    // send with - and every test double - needs no change; Telegram overrides it.
    Task NotifyAdminsAsync(string message, CancellationToken cancellationToken) => Task.CompletedTask;
}

// Why AgroFlow could not water a Critical zone itself. Each value is a
// different thing for the farmer to do, so each produces a different message.
public enum ZoneCriticalReason
{
    // The zone is on manual: the farmer deliberately took control, so only
    // they can start it.
    ManualMode,

    // No active enrolled device is attached to the zone, so there is nothing
    // to send a command to. Usually means hardware was never installed or has
    // been unassigned.
    NoDevice,

    // A command was issued but the pump never acknowledged it.
    PumpUnresponsive,
}

public enum WeatherAlertKind
{
    HeavyRain,
    Frost,
    Heat,
}

public enum SystemFailureKind
{
    DeviceOffline,
    DeviceRecovered,
    PumpUnresponsive,
    SensorSilent,
    ZoneUncontrollable,
}

// The temporary password is passed in and never persisted anywhere. The bot
// generates a fresh one at redemption time (via the Supabase Admin API), sends
// it, and forgets it - see SupabaseAdminService.ResetTemporaryPasswordAsync.
public sealed record FarmerWelcomeNotification(
    string FarmerName,
    string Email,
    string TemporaryPassword,
    string FarmName,
    string FarmLocation);

// Value carries the number the threshold was measured against - millimetres of
// rain, or degrees Celsius - so the message can state what is actually
// expected rather than just "bad weather".
public sealed record WeatherAlertNotification(
    WeatherAlertKind Kind,
    DateOnly Date,
    double Value,
    string FarmName);

// Subject is what broke, in words the farmer recognises: a device name, a zone
// name. Detail is the supporting fact, such as when it was last heard from.
public sealed record SystemFailureNotification(
    SystemFailureKind Kind,
    string Subject,
    string FarmName,
    string? Detail);

// Mirrors the shape of a farmer request as the mobile app and admin will
// exchange it. Nothing constructs this yet: the request table is Luba's work
// and is not on dev at the time of writing, so the notification path is built
// and wired but unreachable.
// Stage decides which of the three messages is sent; the rest is what the
// message has to name. ScheduledFor is always null today - service_request
// (0021) has no date column - and is carried so that adding one later is a
// change in FarmRequestMessages and nowhere else.
public sealed record FarmRequestNotification(
    long RequestId,
    FarmRequestStage Stage,
    string RequestType,
    string? Location,
    DateOnly? ScheduledFor);

public sealed record FarmRequestAdminNotification(
    long RequestId,
    string FarmerName,
    string RequestType,
    string? Location);

public sealed record RequestStatusNotification(
    string RequestType,
    string Description,
    string Status,
    string? ScheduledFor);

// Used when no channel is configured at all (no Telegram:BotToken). Every call
// is a no-op, so a developer running the API with no bot token gets a working
// API with silent notifications rather than a startup crash or a stream of
// errors.
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

    public Task NotifyPasswordResetAsync(
        Guid profileId, string temporaryPassword, CancellationToken cancellationToken)
        => LogDiscarded("password-reset", profileId.ToString());

    public Task NotifyZoneCriticalAsync(
        long zoneId, float moisture, ZoneCriticalReason reason, CancellationToken cancellationToken)
        => LogDiscarded($"zone-critical-{reason}", $"zone {zoneId}");

    public Task NotifyWeatherAsync(
        long farmId, WeatherAlertNotification notification, CancellationToken cancellationToken)
        => LogDiscarded($"weather-{notification.Kind}", $"farm {farmId}");

    public Task NotifySystemFailureAsync(
        long farmId, SystemFailureNotification notification, CancellationToken cancellationToken)
        => LogDiscarded($"system-{notification.Kind}", $"farm {farmId}");

    public Task NotifyRequestStatusAsync(
        Guid profileId, RequestStatusNotification notification, CancellationToken cancellationToken)
        => LogDiscarded("request-status", profileId.ToString());

    public Task NotifyFarmRequestAsync(
        Guid profileId, FarmRequestNotification notification, CancellationToken cancellationToken)
        => LogDiscarded($"farm-request-{notification.Stage}", profileId.ToString());

    public Task NotifyAdminsOfFarmRequestAsync(
        FarmRequestAdminNotification notification, CancellationToken cancellationToken)
        => LogDiscarded("farm-request-admin", $"request {notification.RequestId}");

    private Task LogDiscarded(string kind, string target)
    {
        _logger.LogDebug(
            "Discarded {Kind} notification for {Target}: no notification channel configured.",
            kind, target);

        return Task.CompletedTask;
    }
}
