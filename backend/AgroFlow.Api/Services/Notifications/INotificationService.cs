using AgroFlow.Business;

namespace AgroFlow.Api.Services.Notifications;

// Messages to a farmer, whatever channel carries them. The implementation is
// Telegram, but callers only use this interface, so changing channel is a DI change.
// Only things the farmer must act on, or that the app cannot deliver:
//   - sign-in details they cannot get any other way (onboarding, forgotten password)
//   - weather that could damage the crop
//   - equipment that has stopped working
//   - a zone that needed water and could not be watered automatically
// Routine things (irrigation that worked, history, summaries) stay in the app; if
// this channel gets noisy, farmers mute it and miss the frost warning.
// No method may ever throw: an unlinked farmer, a blocked bot or a Telegram outage
// is logged and ignored, so irrigation, onboarding and ingestion never fail because
// a message did.
// Callers address farmers by AgroFlow ids (profile, zone, farm), never by chat id.
public interface INotificationService
{
    // Sent when a farmer redeems an onboarding code (see TelegramPollingService). A bot
    // cannot message anyone who has not messaged it first, so this is the earliest moment.
    Task NotifyFarmerWelcomeAsync(
        Guid profileId,
        FarmerWelcomeNotification notification,
        CancellationToken cancellationToken);

    // A farmer who forgot their password. The temporary password is created, sent and
    // forgotten; AgroFlow never stores one.
    Task NotifyPasswordResetAsync(
        Guid profileId,
        string temporaryPassword,
        CancellationToken cancellationToken);

    // A zone that went Critical and that AgroFlow could not water itself. If it was
    // watered automatically the farmer has nothing to do, so it stays in the app.
    // See ZoneCriticalReason.
    Task NotifyZoneCriticalAsync(
        long zoneId,
        float moisture,
        ZoneCriticalReason reason,
        CancellationToken cancellationToken);

    // Weather that could damage the crop, from the stored forecast rows.
    Task NotifyWeatherAsync(
        long farmId,
        WeatherAlertNotification notification,
        CancellationToken cancellationToken);

    // Equipment that has stopped working: a quiet device, a pump that never confirmed
    // a command, a zone with nothing able to control it.
    Task NotifySystemFailureAsync(
        long farmId,
        SystemFailureNotification notification,
        CancellationToken cancellationToken);

    // Farm-wide because every member shares the same source tank.
    Task NotifyTankLowAsync(long farmId, CancellationToken cancellationToken);

    // Farmers raise requests in the app; this tells them when an admin moves one along.
    // See RequestStatusNotification for why it has no caller yet.
    Task NotifyRequestStatusAsync(
        Guid profileId,
        RequestStatusNotification notification,
        CancellationToken cancellationToken);

    // A farmer's new-farm / new-zone request moving along: submitted, scheduled for
    // installation, completed. Separate from NotifyRequestStatusAsync because each of
    // these moments needs its own wording about a kit on its way. The wording is in
    // FarmRequestMessages so it can be reviewed and tested in one place.
    // Sent whenever the farmer has a chat id, even if they muted alerts: they still need
    // to know a technician is coming.
    Task NotifyFarmRequestAsync(
        Guid profileId,
        FarmRequestNotification notification,
        CancellationToken cancellationToken);

    // The same submission, to every admin with a linked chat, as a work-queue notice.
    Task NotifyAdminsOfFarmRequestAsync(
        FarmRequestAdminNotification notification,
        CancellationToken cancellationToken);

    // A plain work-queue notice to every admin with a linked chat ("New enquiry: ...").
    // The default body does nothing, so test doubles need no change; Telegram overrides it.
    Task NotifyAdminsAsync(string message, CancellationToken cancellationToken) => Task.CompletedTask;

    // A possible sensor or water supply fault (MoistureFaultService), to every farm member.
    Task NotifyPossibleFaultAsync(long farmId, long zoneId, string message, CancellationToken cancellationToken)
        => Task.CompletedTask;
}

// Why AgroFlow could not water a Critical zone itself. Each value means something
// different for the farmer to do, so each gives a different message.
public enum ZoneCriticalReason
{
    // The zone is on manual: the farmer took control, so only they can start it.
    ManualMode,

    // No active enrolled device on the zone, so there is nothing to send a command to
    // (usually hardware never installed or unassigned).
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

// The temporary password is passed in and never saved. The bot creates a new one at
// redemption, sends it and forgets it (SupabaseAdminService.ResetTemporaryPasswordAsync).
public sealed record FarmerWelcomeNotification(
    string FarmerName,
    string Email,
    string TemporaryPassword,
    string FarmName,
    string FarmLocation);

// Value is the number the threshold was measured against (mm of rain or degrees
// Celsius), so the message can say what is expected.
public sealed record WeatherAlertNotification(
    WeatherAlertKind Kind,
    DateOnly Date,
    double Value,
    string FarmName);

// Subject is what broke, in words the farmer knows (a device or zone name). Detail
// is the supporting fact, such as when it was last heard from.
public sealed record SystemFailureNotification(
    SystemFailureKind Kind,
    string Subject,
    string FarmName,
    string? Detail);

// Matches a farmer request as the app and admin exchange it. Nothing creates this
// yet, so this path is wired but not used.
// Stage decides which of the three messages is sent. ScheduledFor is always null
// (service_request has no date column); adding one later only changes
// FarmRequestMessages.
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

// Used when no channel is configured (no Telegram:BotToken). Every call does
// nothing, so the API runs without a bot token instead of crashing.
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

    public Task NotifyTankLowAsync(long farmId, CancellationToken cancellationToken)
        => LogDiscarded("tank-low", $"farm {farmId}");

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
