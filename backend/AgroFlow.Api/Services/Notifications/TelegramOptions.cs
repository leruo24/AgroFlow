namespace AgroFlow.Api.Services.Notifications;

// Bound from the "Telegram" configuration section. On Railway these arrive as
// the double-underscore environment variables Telegram__BotToken,
// Telegram__BotUsername and Telegram__EnablePolling; locally they come from
// .NET user-secrets. The token is a credential and is never committed - there
// is no Telegram section in appsettings.json for exactly that reason.
public sealed class TelegramOptions
{
    public const string SectionName = "Telegram";

    // From @BotFather. Format is <numeric id>:<35-char secret>. Absent means
    // "no channel configured": Program.cs registers NullNotificationService
    // and skips the poller entirely.
    public string? BotToken { get; set; }

    // Without the leading @. Only used to build the t.me deep link the admin
    // screen turns into a QR code.
    public string? BotUsername { get; set; }

    // MUST be true on exactly one running instance, and false everywhere
    // else.
    //
    // Telegram hands each update to a single getUpdates consumer, and a
    // second long-poll on the same token evicts the first with HTTP 409. Two
    // pollers do not share the stream - they steal from each other at random,
    // so an on-site "/start" can silently land in a developer's laptop
    // process and the farmer standing in the field gets nothing at all.
    //
    // Default false, deliberately: the deployed Railway instance sets
    // Telegram__EnablePolling=true, so running the API locally is safe by
    // default and cannot hijack a live onboarding.
    public bool EnablePolling { get; set; }

    // How long an onboarding QR code stays redeemable. The code unlocks a
    // message containing login details, so it expires.
    public int OnboardingCodeTtlDays { get; set; } = 7;

    // Long-poll duration passed to getUpdates. Telegram holds the connection
    // open this long when there is nothing to report, which is what makes
    // polling cheap rather than a busy loop.
    public int LongPollSeconds { get; set; } = 30;

    public bool IsConfigured => !string.IsNullOrWhiteSpace(BotToken);
}

// Where the farmer app is downloaded from. Separate section because it is not
// a Telegram concept - it is just the other thing a new farmer needs to be
// told. Unset until the APK is actually published, in which case the bot says
// the app is coming soon instead of sending a broken link.
public sealed class ApkOptions
{
    public const string SectionName = "Apk";

    public string? DownloadUrl { get; set; }
}

// Thresholds for the device staleness poller. Defaults are deliberately
// generous relative to the ~30s sensor cadence: a single missed reading, a
// brief Wi-Fi drop or an MQTT reconnect must not page the farmer.
public sealed class DeviceMonitorOptions
{
    public const string SectionName = "DeviceMonitor";

    public bool Enabled { get; set; } = true;

    // No reading for this long => Offline.
    public int OfflineAfterMinutes { get; set; } = 30;

    // How often the poller re-evaluates every device.
    public int CheckIntervalMinutes { get; set; } = 5;
}
