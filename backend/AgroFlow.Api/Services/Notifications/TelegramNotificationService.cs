using AgroFlow.Business;
using Microsoft.Extensions.Options;
using Npgsql;

namespace AgroFlow.Api.Services.Notifications;

// Telegram implementation of INotificationService: finds the Telegram chats for a
// profile, zone or farm, writes a plain-language message and sends it.
// Every public method catches everything (see INotificationService): a failed
// message must never break onboarding, sensor ingestion or irrigation.
// Every alert names the farm, says what is expected and when, and ends with what
// to do. No jargon, no percentages without units, no database ids.
public sealed class TelegramNotificationService : INotificationService
{
    private const string NewLine = "\n";

    private readonly TelegramClient _client;
    private readonly NpgsqlDataSource _dataSource;
    private readonly ApkOptions _apkOptions;
    private readonly IExplanationStore _explanations;
    private readonly WeatherAlertOptions _weatherOptions;
    private readonly DeviceMonitorOptions _deviceOptions;
    private readonly ILogger<TelegramNotificationService> _logger;

    public TelegramNotificationService(
        TelegramClient client,
        NpgsqlDataSource dataSource,
        IOptions<ApkOptions> apkOptions,
        IExplanationStore explanations,
        IOptions<WeatherAlertOptions> weatherOptions,
        IOptions<DeviceMonitorOptions> deviceOptions,
        ILogger<TelegramNotificationService> logger)
    {
        _client = client;
        _dataSource = dataSource;
        _apkOptions = apkOptions.Value;
        _explanations = explanations;
        _weatherOptions = weatherOptions.Value;
        _deviceOptions = deviceOptions.Value;
        _logger = logger;
    }

    // Every alert ends with a short "Why: ..." line and a "Why am I seeing this?"
    // button. The explanation is saved first so the button can point at it; if that
    // fails the alert still goes, with the Why line but no button.
    private async Task<(string Message, long? WhyId)> WithWhyAsync(
        string message, long farmId, long? zoneId, string kind,
        AgroFlow.Business.Agronomy.RuleBook.Explanation explanation,
        CancellationToken cancellationToken)
    {
        var id = await _explanations.SaveAsync(farmId, zoneId, kind, explanation, cancellationToken);
        return (message + NewLine + NewLine + "Why: " + explanation.Summary, id);
    }

    // Sign-in details

    public async Task NotifyFarmerWelcomeAsync(
        Guid profileId,
        FarmerWelcomeNotification notification,
        CancellationToken cancellationToken)
    {
        try
        {
            var chatId = await GetChatIdAsync(profileId, cancellationToken);

            if (chatId is null)
            {
                _logger.LogWarning(
                    "No Telegram chat is linked to profile {ProfileId}; welcome message not sent.",
                    profileId);

                return;
            }

            // The APK may not be published yet; saying so is better than sending a link that 404s.
            var appLine = string.IsNullOrWhiteSpace(_apkOptions.DownloadUrl)
                ? "The AgroFlow app download is coming soon. We will send you the link here as soon as it is ready."
                : "Download the AgroFlow app here:" + NewLine + _apkOptions.DownloadUrl;

            var message = Compose(
                $"Welcome to AgroFlow, {notification.FarmerName}.",
                "",
                "Your account is ready.",
                "",
                $"Farm: {notification.FarmName}",
                $"Location: {notification.FarmLocation}",
                "",
                "Sign in with:",
                $"Email: {notification.Email}",
                $"Temporary password: {notification.TemporaryPassword}",
                "",
                appLine,
                "",
                "You will be asked to choose your own password the first time you sign in.",
                "Please do that as soon as you can - the temporary password above stays in this chat.",
                "",
                "I will only message you here about things that need you: your sign-in",
                "details, weather that could damage your crop, and equipment that has",
                "stopped working. Everything else is in the app.");

            await _client.SendMessageAsync(chatId.Value, message, cancellationToken);
        }
        catch (Exception ex)
        {
            LogSwallowed(ex, "welcome", profileId.ToString());
        }
    }

    public async Task NotifyPasswordResetAsync(
        Guid profileId,
        string temporaryPassword,
        CancellationToken cancellationToken)
    {
        try
        {
            var chatId = await GetChatIdAsync(profileId, cancellationToken);

            if (chatId is null)
            {
                _logger.LogWarning(
                    "No Telegram chat is linked to profile {ProfileId}; password reset not delivered.",
                    profileId);

                return;
            }

            var message = Compose(
                "Your AgroFlow password has been reset.",
                "",
                $"Temporary password: {temporaryPassword}",
                "",
                "Sign in with this, and the app will ask you to choose your own password",
                "straight away. Please do that as soon as you can - this one stays in",
                "this chat.",
                "",
                "If you did not ask for this, tell your AgroFlow administrator: somebody",
                "else may have requested it using your email address.");

            await _client.SendMessageAsync(chatId.Value, message, cancellationToken);
        }
        catch (Exception ex)
        {
            LogSwallowed(ex, "password-reset", profileId.ToString());
        }
    }

    public async Task NotifyTankLowAsync(long farmId, CancellationToken cancellationToken)
    {
        try
        {
            // In each member's own language (BotText); TankPhRules.LowTankMessage stays the
            // English alert text in the app.
            await BroadcastToFarmAsync(
                farmId, lang => BotText.Get(lang, "tank.low"), alertsOnly: true, cancellationToken);
        }
        catch (Exception ex)
        {
            LogSwallowed(ex, "tank-low", farmId.ToString());
        }
    }

    public async Task NotifyPossibleFaultAsync(
        long farmId, long zoneId, string message, CancellationToken cancellationToken)
    {
        try
        {
            await BroadcastToFarmAsync(farmId, message, alertsOnly: true, cancellationToken);
        }
        catch (Exception ex)
        {
            LogSwallowed(ex, "possible-fault", zoneId.ToString());
        }
    }

    // A zone AgroFlow could not water itself

    public async Task NotifyZoneCriticalAsync(
        long zoneId,
        float moisture,
        ZoneCriticalReason reason,
        CancellationToken cancellationToken)
    {
        try
        {
            var zone = await GetZoneContextAsync(zoneId, cancellationToken);
            if (zone is null) return;

            // Each reason means something different for the farmer to do, so the message
            // says why nothing happened.
            var reasonKey = reason switch
            {
                ZoneCriticalReason.ManualMode => "zone.manual",
                ZoneCriticalReason.NoDevice => "zone.nodevice",
                _ => "zone.pump",
            };

            var explanation = AlertExplanations.ZoneCritical(zone.ZoneName, moisture, reason);
            var whyId = await _explanations.SaveAsync(zone.FarmId, zoneId, "zone_critical", explanation, cancellationToken);

            // Written in each recipient's language (BotText); the Why summary is English for now.
            string MessageFor(string lang) => Compose(
                BotText.Get(lang, "zone.title"),
                "",
                BotText.Get(lang, "farm", ("name", zone.FarmName)),
                BotText.Get(lang, "zone", ("name", zone.ZoneName)),
                // Never a %: the sensor's wet/dry setup may not be done.
                BotText.Get(lang, "zone.reading", ("value", moisture.ToString("0.#", System.Globalization.CultureInfo.InvariantCulture))),
                "",
                BotText.Get(lang, reasonKey + ".cause"),
                "",
                BotText.Get(lang, reasonKey + ".action"),
                "",
                BotText.Get(lang, "why", ("summary", explanation.Summary)));

            await BroadcastToFarmAsync(zone.FarmId, MessageFor, alertsOnly: true, cancellationToken, whyId);
        }
        catch (Exception ex)
        {
            LogSwallowed(ex, $"zone-critical-{reason}", $"zone {zoneId}");
        }
    }

    // Weather

    public async Task NotifyWeatherAsync(
        long farmId,
        WeatherAlertNotification notification,
        CancellationToken cancellationToken)
    {
        try
        {
            var when = DescribeDay(notification.Date);
            var prefix = notification.Kind switch
            {
                WeatherAlertKind.HeavyRain => "rain",
                WeatherAlertKind.Frost => "frost",
                _ => "heat",
            };
            var value = notification.Value.ToString("0.#", System.Globalization.CultureInfo.InvariantCulture);

            var explanation = AlertExplanations.Weather(notification, _weatherOptions);
            var whyId = await _explanations.SaveAsync(farmId, null,
                "weather_" + notification.Kind.ToString().ToLowerInvariant(), explanation, cancellationToken);

            // In each recipient's language (BotText). The day ("tomorrow", "Monday") and the Why
            // summary are still English.
            string MessageFor(string lang) => Compose(
                BotText.Get(lang, prefix + ".title"),
                "",
                BotText.Get(lang, "farm", ("name", notification.FarmName)),
                BotText.Get(lang, "when", ("when", when)),
                BotText.Get(lang, prefix + ".value", ("value", value)),
                "",
                BotText.Get(lang, prefix + ".body"),
                "",
                BotText.Get(lang, prefix + ".action"),
                "",
                BotText.Get(lang, "why", ("summary", explanation.Summary)));

            await BroadcastToFarmAsync(farmId, MessageFor, alertsOnly: true, cancellationToken, whyId);
        }
        catch (Exception ex)
        {
            LogSwallowed(ex, $"weather-{notification.Kind}", $"farm {farmId}");
        }
    }

    // "tomorrow" is easier to read on a phone than "2026-10-02", but only for the next
    // few days; after that a real date is clearer.
    private static string DescribeDay(DateOnly date)
    {
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var days = date.DayNumber - today.DayNumber;

        return days switch
        {
            <= 0 => "today",
            1 => "tomorrow",
            < 7 => $"{date:dddd} ({date:d MMM})",
            _ => date.ToString("dddd d MMM"),
        };
    }

    // Equipment

    public async Task NotifySystemFailureAsync(
        long farmId,
        SystemFailureNotification notification,
        CancellationToken cancellationToken)
    {
        try
        {
            var detail = string.IsNullOrWhiteSpace(notification.Detail)
                ? null
                : notification.Detail;

            var lines = notification.Kind switch
            {
                SystemFailureKind.DeviceOffline => new[]
                {
                    "Device offline",
                    "",
                    $"Farm: {notification.FarmName}",
                    $"Device: {notification.Subject}",
                    detail is null ? "" : $"Last reading: {detail}",
                    "",
                    "AgroFlow has stopped hearing from this device, so its zone is not being",
                    "monitored and will not water automatically.",
                    "",
                    "Please check that it has power and signal. I will message you when it",
                    "comes back.",
                },

                SystemFailureKind.DeviceRecovered => new[]
                {
                    "Device back online",
                    "",
                    $"Farm: {notification.FarmName}",
                    $"Device: {notification.Subject}",
                    "",
                    "It is sending readings again and its zone is being watched as normal.",
                    "Nothing further is needed.",
                },

                SystemFailureKind.PumpUnresponsive => new[]
                {
                    "Pump not responding",
                    "",
                    $"Farm: {notification.FarmName}",
                    $"Zone: {notification.Subject}",
                    detail is null ? "" : detail,
                    "",
                    "AgroFlow sent this zone a watering instruction and the pump never",
                    "confirmed it, so the zone may not have been watered.",
                    "",
                    "Please check the pump and its power, and water the zone yourself if",
                    "you can.",
                },

                SystemFailureKind.SensorSilent => new[]
                {
                    "Sensor has stopped reporting",
                    "",
                    $"Farm: {notification.FarmName}",
                    $"Zone: {notification.Subject}",
                    detail is null ? "" : detail,
                    "",
                    "Without readings AgroFlow cannot tell when this zone needs water, so",
                    "it will not water it automatically.",
                    "",
                    "Please check the sensor on this zone, and keep an eye on it yourself",
                    "until it is reporting again.",
                },

                _ => new[]
                {
                    "Zone cannot be controlled",
                    "",
                    $"Farm: {notification.FarmName}",
                    $"Zone: {notification.Subject}",
                    detail is null ? "" : detail,
                    "",
                    "There is no working device assigned to this zone, so AgroFlow cannot",
                    "water it however dry it gets.",
                    "",
                    "Please water it yourself and tell us it needs a device.",
                },
            };

            var (withWhy, whyId) = await WithWhyAsync(Compose(lines), farmId, null,
                "system_" + notification.Kind.ToString().ToLowerInvariant(),
                AlertExplanations.SystemFailure(notification, _deviceOptions), cancellationToken);

            await BroadcastToFarmAsync(farmId, withWhy, alertsOnly: true, cancellationToken, whyId);
        }
        catch (Exception ex)
        {
            LogSwallowed(ex, $"system-{notification.Kind}", $"farm {farmId}");
        }
    }

    // Request status

    public async Task NotifyRequestStatusAsync(
        Guid profileId,
        RequestStatusNotification notification,
        CancellationToken cancellationToken)
    {
        try
        {
            var chatId = await GetChatIdAsync(profileId, cancellationToken);
            if (chatId is null) return;

            var lines = new List<string>
            {
                "Update on your request",
                "",
                $"Request: {notification.RequestType}",
                notification.Description,
                "",
                $"Status: {DescribeRequestStatus(notification.Status)}",
            };

            if (!string.IsNullOrWhiteSpace(notification.ScheduledFor))
            {
                lines.Add($"Planned for: {notification.ScheduledFor}");
            }

            lines.Add("");
            lines.Add("Send /status at any time to see all your open requests.");

            // Request updates ignore telegram_alerts_enabled: someone who muted weather and
            // equipment messages still needs to know a technician is coming.
            await _client.SendMessageAsync(chatId.Value, Compose(lines.ToArray()), cancellationToken);
        }
        catch (Exception ex)
        {
            LogSwallowed(ex, "request-status", profileId.ToString());
        }
    }

    // Farm / zone requests

    public async Task NotifyFarmRequestAsync(
        Guid profileId,
        FarmRequestNotification notification,
        CancellationToken cancellationToken)
    {
        try
        {
            var chatId = await GetChatIdAsync(profileId, cancellationToken);

            if (chatId is null)
            {
                // Not an error: a farmer who never pressed Start has no chat, and a bot cannot
                // message first, so we log it and skip.
                _logger.LogInformation(
                    "Skipped the {Stage} message for request {RequestId}: profile {ProfileId} has no linked Telegram chat.",
                    notification.Stage, notification.RequestId, profileId);

                return;
            }

            var message = notification.Stage switch
            {
                FarmRequestStage.Submitted =>
                    FarmRequestMessages.Submitted(notification.RequestType, notification.Location),
                FarmRequestStage.Scheduled =>
                    FarmRequestMessages.Scheduled(notification.ScheduledFor),
                FarmRequestStage.Completed =>
                    FarmRequestMessages.Completed(notification.RequestType),
                _ => null,
            };

            if (message is null) return;

            // Not limited by telegram_alerts_enabled, for the same reason as
            // NotifyRequestStatusAsync: they still need to know a technician is coming.
            await _client.SendMessageAsync(chatId.Value, message, cancellationToken);
        }
        catch (Exception ex)
        {
            LogSwallowed(ex, $"farm-request-{notification.Stage}", profileId.ToString());
        }
    }

    // Work-queue notices for staff (a new enquiry, a call-back). Staff never use Telegram
    // (StaffTelegram): these are on the admin site's Home "needs attention" list and its bell,
    // which read the same rows, so nothing is sent here. Kept so callers need not change.
    public Task NotifyAdminsAsync(string message, CancellationToken cancellationToken)
    {
        _logger.LogInformation("Staff notice shown in the admin site (needs attention, bell), not sent on Telegram: {Message}", message);
        return Task.CompletedTask;
    }

    // The old Telegram version, kept for reference only; never called.
    private async Task NotifyAdminsOnTelegramAsync(string message, CancellationToken cancellationToken)
    {
        try
        {
            var chatIds = new List<long>();
            await using (var connection = await _dataSource.OpenConnectionAsync(cancellationToken))
            {
                await using var command = new NpgsqlCommand(
                    "select distinct p.telegram_chat_id from profile p " +
                    "where p.role = 'admin' and p.telegram_chat_id is not null", connection);
                await using var reader = await command.ExecuteReaderAsync(cancellationToken);
                while (await reader.ReadAsync(cancellationToken)) chatIds.Add(reader.GetInt64(0));
            }

            foreach (var chatId in chatIds)
            {
                await _client.SendMessageAsync(chatId, message, cancellationToken);
            }
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _logger.LogWarning(ex, "Could not send an admin notice on Telegram.");
        }
    }

    // A new farm / zone request. Shown to staff in the admin site (Requests, Home "needs
    // attention" and the bell); staff never use Telegram, so nothing is sent here.
    public Task NotifyAdminsOfFarmRequestAsync(
        FarmRequestAdminNotification notification,
        CancellationToken cancellationToken)
    {
        _logger.LogInformation(
            "Farm request {RequestId} is shown to staff in the admin site, not on Telegram.", notification.RequestId);
        return Task.CompletedTask;
    }

    // The old Telegram version, kept for reference only; never called.
    private async Task NotifyAdminsOfFarmRequestOnTelegramAsync(
        FarmRequestAdminNotification notification,
        CancellationToken cancellationToken)
    {
        try
        {
            var message = FarmRequestMessages.AdminSubmitted(
                notification.FarmerName, notification.RequestType, notification.Location);

            // Every admin with a linked chat, whatever telegram_alerts_enabled says: that
            // preference is about a farmer's alert noise, and an admin linked the bot for this.
            var chatIds = new List<long>();

            await using (var connection = await _dataSource.OpenConnectionAsync(cancellationToken))
            {
                await using var command = new NpgsqlCommand(
                    "select distinct p.telegram_chat_id from profile p " +
                    "where p.role = 'admin' and p.telegram_chat_id is not null", connection);

                await using var reader = await command.ExecuteReaderAsync(cancellationToken);
                while (await reader.ReadAsync(cancellationToken))
                {
                    chatIds.Add(reader.GetInt64(0));
                }
            }

            if (chatIds.Count == 0)
            {
                _logger.LogInformation(
                    "No admin has a linked Telegram chat; request {RequestId} was not announced.",
                    notification.RequestId);

                return;
            }

            // One by one, like BroadcastToFarmAsync: only a few recipients, and Telegram
            // rate-limits bots.
            foreach (var chatId in chatIds)
            {
                await _client.SendMessageAsync(chatId, message, cancellationToken);
            }
        }
        catch (Exception ex)
        {
            LogSwallowed(ex, "farm-request-admin", $"request {notification.RequestId}");
        }
    }

    // Turns the stored status into words a farmer understands. Unknown values pass
    // through unchanged, so a new status still reaches the farmer.
    public static string DescribeRequestStatus(string status) => status.Trim().ToLowerInvariant() switch
    {
        "received" or "pending" or "open" => "Received - we have it and will be in touch",
        "scheduled" => "Scheduled - a visit has been booked",
        "on the way" or "on_the_way" or "dispatched" => "A technician is on the way",
        "completed" or "done" or "resolved" => "Completed",
        "rejected" or "cancelled" or "canceled" => "Closed without action - contact us if this is wrong",
        _ => status,
    };

    // Recipient resolution

    // Blank entries are dropped, so a missing optional detail does not leave a gap.
    private static string Compose(params string[] lines)
    {
        var cleaned = new List<string>(lines.Length);

        foreach (var line in lines)
        {
            if (line.Length == 0 && cleaned.Count > 0 && cleaned[^1].Length == 0) continue;
            cleaned.Add(line);
        }

        while (cleaned.Count > 0 && cleaned[^1].Length == 0) cleaned.RemoveAt(cleaned.Count - 1);

        return string.Join(NewLine, cleaned);
    }

    private async Task<long?> GetChatIdAsync(Guid profileId, CancellationToken cancellationToken)
    {
        await using var connection = await _dataSource.OpenConnectionAsync(cancellationToken);

        await using var command = new NpgsqlCommand(
            "select telegram_chat_id from profile where id = $1 and telegram_chat_id is not null",
            connection);

        command.Parameters.AddWithValue(profileId);

        var result = await command.ExecuteScalarAsync(cancellationToken);

        return result is long chatId ? chatId : null;
    }

    // Everyone on the farm (the owner and every farm_member) who has linked a chat and
    // has alerts on: equipment failing concerns all of them.
    private Task BroadcastToFarmAsync(
        long farmId,
        string message,
        bool alertsOnly,
        CancellationToken cancellationToken,
        long? whyExplanationId = null) =>
        BroadcastToFarmAsync(farmId, _ => message, alertsOnly, cancellationToken, whyExplanationId);

    // True once profile.language exists (0049). Until then everyone gets English. Only a yes is
    // remembered, so applying the migration takes effect without a restart.
    private static bool _languageColumnSeen;

    private static async Task<bool> HasLanguageColumnAsync(NpgsqlConnection connection, CancellationToken ct)
    {
        if (_languageColumnSeen) return true;
        await using var check = new NpgsqlCommand(
            "select exists (select 1 from information_schema.columns where table_name = 'profile' and column_name = 'language')",
            connection);
        _languageColumnSeen = await check.ExecuteScalarAsync(ct) is true;
        return _languageColumnSeen;
    }

    // The same, with the message written in each recipient's language.
    private async Task BroadcastToFarmAsync(
        long farmId,
        Func<string, string> messageFor,
        bool alertsOnly,
        CancellationToken cancellationToken,
        long? whyExplanationId = null)
    {
        const string sqlTemplate =
            """
            select distinct p.telegram_chat_id, {language}
              from profile p
             where p.telegram_chat_id is not null
               and (not $2 or p.telegram_alerts_enabled)
               and {notStaff}
               and (
                     exists (select 1 from farm f where f.farm_id = $1 and f.owner_id = p.id)
                  or exists (select 1 from farm_member fm where fm.farm_id = $1 and fm.profile_id = p.id)
               )
            """;

        var chatIds = new List<(long ChatId, string Language)>();

        await using (var connection = await _dataSource.OpenConnectionAsync(cancellationToken))
        {
            var language = await HasLanguageColumnAsync(connection, cancellationToken)
                ? "coalesce(p.language, 'en')"
                : "'en'";
            // Farmers only: a staff member on the farm (a field officer as a member) is never messaged.
            await using var command = new NpgsqlCommand(
                sqlTemplate.Replace("{language}", language).Replace("{notStaff}", StaffTelegram.NotStaffSql), connection);
            command.Parameters.AddWithValue(farmId);
            command.Parameters.AddWithValue(alertsOnly);

            await using var reader = await command.ExecuteReaderAsync(cancellationToken);

            while (await reader.ReadAsync(cancellationToken))
            {
                chatIds.Add((reader.GetInt64(0), reader.GetString(1)));
            }
        }

        if (chatIds.Count == 0)
        {
            _logger.LogDebug("No linked Telegram chats for farm {FarmId}; nothing sent.", farmId);
            return;
        }

        // One by one on purpose: Telegram allows about 30 bot messages a second, and a farm
        // has only a few members, so sending in parallel gains nothing and risks 429s.
        foreach (var (chatId, lang) in chatIds)
        {
            await _client.SendMessageAsync(chatId, messageFor(BotText.Normalise(lang)), whyExplanationId, cancellationToken);
        }
    }

    private sealed record ZoneContext(long FarmId, string FarmName, string ZoneName);

    private async Task<ZoneContext?> GetZoneContextAsync(long zoneId, CancellationToken cancellationToken)
    {
        await using var connection = await _dataSource.OpenConnectionAsync(cancellationToken);

        await using var command = new NpgsqlCommand(
            """
            select f.farm_id, f.name, coalesce(nullif(z.name, ''), 'Unnamed zone')
              from zone z
              join farm f on f.farm_id = z.farm_id
             where z.id = $1
            """,
            connection);

        command.Parameters.AddWithValue(zoneId);

        await using var reader = await command.ExecuteReaderAsync(cancellationToken);

        // Null when the zone was deleted between the reading and this message: nothing to say.
        if (!await reader.ReadAsync(cancellationToken)) return null;

        return new ZoneContext(reader.GetInt64(0), reader.GetString(1), reader.GetString(2));
    }

    private void LogSwallowed(Exception ex, string kind, string target)
    {
        _logger.LogWarning(
            ex,
            "Telegram {Kind} notification for {Target} failed and was swallowed. " +
            "A failed notification never fails the operation that triggered it.",
            kind, target);
    }
}
