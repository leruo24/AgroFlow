namespace AgroFlow.Api.Services.Notifications;

// Bound from the "Telegram" config section: on Railway Telegram__BotToken,
// Telegram__BotUsername and Telegram__EnablePolling, locally .NET user-secrets.
// Security: the token is a credential, so there is no Telegram section in
// appsettings.json.
public sealed class TelegramOptions
{
    public const string SectionName = "Telegram";

    // From @BotFather: <numeric id>:<35-char secret>. Missing means no channel:
    // Program.cs uses NullNotificationService and skips the poller.
    public string? BotToken { get; set; }

    // Without the leading @. Only used for the t.me link shown as a QR code.
    public string? BotUsername { get; set; }

    // Must be true on exactly one running instance. Telegram gives each update to one
    // getUpdates consumer and a second poller kicks off the first (HTTP 409), so a
    // farmer's /start could end up on a developer's laptop. Defaults to false; only
    // Railway sets Telegram__EnablePolling=true.
    public bool EnablePolling { get; set; }

    // Security: the secret Telegram sends back in X-Telegram-Bot-Api-Secret-Token on
    // every webhook call. POST /api/telegram/webhook has to be anonymous, so this is
    // the only protection. If unset the webhook refuses everything (fails closed).
    // It is a credential, so it is not in appsettings.json.
    public string? WebhookSecret { get; set; }

    // How long an onboarding QR code works. It unlocks login details, so it expires.
    public int OnboardingCodeTtlDays { get; set; } = 7;

    // The app's "Connect Telegram" button: much shorter than onboarding, because the
    // farmer taps straight through on their own phone.
    public int LinkCodeTtlMinutes { get; set; } = 15;

    // Long-poll duration for getUpdates. Telegram holds the connection open this long
    // when nothing is happening, so polling is cheap.
    public int LongPollSeconds { get; set; } = 30;

    // The admins' group chat, for automatic reports that ask for a copy there. Config
    // only (Telegram__AdminGroupChatId), never in the database. Missing means no group chat.
    public long? AdminGroupChatId { get; set; }

    public bool IsConfigured => !string.IsNullOrWhiteSpace(BotToken);
}

// Where the farmer app is downloaded from. Until the APK is published this is unset
// and the bot says the app is coming soon instead of sending a broken link.
public sealed class ApkOptions
{
    public const string SectionName = "Apk";

    public string? DownloadUrl { get; set; }
}

// Thresholds for the device staleness check. Generous compared with the ~30 s
// sensor cadence, so one missed reading or a short WiFi drop never alerts the farmer.
public sealed class DeviceMonitorOptions
{
    public const string SectionName = "DeviceMonitor";

    public bool Enabled { get; set; } = true;

    // No reading for this long => Offline.
    public int OfflineAfterMinutes { get; set; } = 30;

    // How often the poller re-evaluates every device.
    public int CheckIntervalMinutes { get; set; } = 5;

    // A command still 'pending' after this long means the pump never confirmed it.
    // Generous because the device polls for commands, so a few minutes' delay is normal.
    public int PumpUnresponsiveAfterMinutes { get; set; } = 20;

    // A zone with no reading for this long has a sensor problem. Longer than
    // OfflineAfterMinutes so both do not fire for the same outage.
    public int SensorSilentAfterMinutes { get; set; } = 180;
}

// Thresholds for crop-damaging weather, read from the stored forecast. Configurable
// because danger is regional: 2 C is frost risk in the Western Cape, and 20 mm in
// a day matters on a slope but not on flat veld.
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

    // How far ahead to warn. Open-Meteo gives 8 days, but day 8 is not actionable and
    // the forecast is poor that far out.
    public int ForecastDays { get; set; } = 5;

    public int CheckIntervalHours { get; set; } = 6;
}

// Security: limits for the anonymous forgot-password endpoint, per email address,
// so nobody can flood another farmer's Telegram or find accounts by timing.
public sealed class PasswordResetOptions
{
    public const string SectionName = "PasswordReset";

    public bool Enabled { get; set; } = true;

    // Minimum gap between two resets for the same email.
    public int MinimumIntervalMinutes { get; set; } = 5;

    // Maximum per email per day, so a slow drip cannot be used to harass.
    public int MaxPerDay { get; set; } = 5;
}
