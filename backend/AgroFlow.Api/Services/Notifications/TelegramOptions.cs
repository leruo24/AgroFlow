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

    // MUST be true on exactly one running instance, and false everywhere else.
    //
    // Telegram hands each update to a single getUpdates consumer, and a second
    // long-poll on the same token evicts the first with HTTP 409. Two pollers
    // do not share the stream - they steal from each other at random, so an
    // on-site "/start" can silently land in a developer's laptop process and
    // the farmer standing in the field gets nothing at all.
    //
    // Default false, deliberately: the deployed Railway instance sets
    // Telegram__EnablePolling=true, so running the API locally is safe by
    // default and cannot hijack a live onboarding.
    public bool EnablePolling { get; set; }

    // The secret Telegram echoes back in X-Telegram-Bot-Api-Secret-Token on
    // every webhook call, chosen by whoever registers the webhook.
    //
    // POST /api/telegram/webhook is necessarily anonymous - Telegram's
    // servers hold no AgroFlow credential - so this is the ONLY thing
    // standing between that route and anyone who finds the URL. Unset means
    // the webhook refuses everything: failing closed turns a missing Railway
    // variable into a visibly broken webhook rather than an open
    // account-linking endpoint.
    //
    // A credential, so like BotToken it is absent from appsettings.json.
    public string? WebhookSecret { get; set; }

    // How long an onboarding QR code stays redeemable. The code unlocks a
    // message containing login details, so it expires.
    public int OnboardingCodeTtlDays { get; set; } = 7;

    // The app's own "Connect Telegram" button. Much shorter than the
    // onboarding TTL above, because the farmer is holding the phone and taps
    // straight through to Telegram - see IssueCodeAsync's lifetime parameter.
    public int LinkCodeTtlMinutes { get; set; } = 15;

    // Long-poll duration passed to getUpdates. Telegram holds the connection
    // open this long when there is nothing to report, which is what makes
    // polling cheap rather than a busy loop.
    public int LongPollSeconds { get; set; } = 30;

    // Item 4: the admins' group chat, for automatic reports whose schedule
    // asks for a copy there. Configuration only (Telegram__AdminGroupChatId),
    // never stored in the database. Absent means "no group chat".
    public long? AdminGroupChatId { get; set; }

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

    // A command still 'pending' after this long means the pump never
    // acknowledged it. Generous because the device polls for commands rather
    // than being pushed them, so a few minutes of lag is normal operation.
    public int PumpUnresponsiveAfterMinutes { get; set; } = 20;

    // A zone whose newest sensor reading is older than this has a sensor
    // problem, as distinct from a device that has gone off the network
    // entirely. Longer than OfflineAfterMinutes so the two do not both fire
    // for the same underlying outage.
    public int SensorSilentAfterMinutes { get; set; } = 180;
}

// Thresholds for crop-damaging weather, read from the forecast rows
// WeatherCollectionService already stores. All configurable because what
// counts as dangerous is regional: 2C is frost risk in the Western Cape, and
// 20mm in a day is a lot of rain on a slope and nothing on flat veld.
public sealed class WeatherAlertOptions
{
    public const string SectionName = "WeatherAlerts";

    public bool Enabled { get; set; } = true;

    // Millimetres of rain in one day.
    public double HeavyRainMm { get; set; } = 20;

    // Daily minimum at or below which frost is a real risk.
    public double FrostMinC { get; set; } = 2;

    // Daily maximum above which heat stress is a real risk.
    public double HeatMaxC { get; set; } = 35;

    // How far ahead to warn. Open-Meteo gives 8 days; warning about day 8 is
    // not actionable and the forecast is poor that far out.
    public int ForecastDays { get; set; } = 5;

    public int CheckIntervalHours { get; set; } = 6;
}

// Protects the anonymous forgot-password endpoint. Limits are per email
// address, so one person cannot be used to flood another's Telegram, and
// cannot enumerate accounts by timing repeated requests.
public sealed class PasswordResetOptions
{
    public const string SectionName = "PasswordReset";

    public bool Enabled { get; set; } = true;

    // Minimum gap between two resets for the same email.
    public int MinimumIntervalMinutes { get; set; } = 5;

    // Ceiling per email per day, so a slow drip cannot be used to harass.
    public int MaxPerDay { get; set; } = 5;
}
