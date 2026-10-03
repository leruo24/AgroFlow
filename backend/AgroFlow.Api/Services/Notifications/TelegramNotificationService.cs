using AgroFlow.Business;
using Microsoft.Extensions.Options;
using Npgsql;

namespace AgroFlow.Api.Services.Notifications;

// Telegram implementation of INotificationService. Resolves an AgroFlow
// identity (profile / zone / farm) to the linked Telegram chats, composes a
// plain-language message and sends it.
//
// EVERY PUBLIC METHOD SWALLOWS EVERYTHING. See the contract on
// INotificationService: a failed message must never propagate into onboarding,
// sensor ingestion or irrigation. The catch blocks here are the single place
// that guarantees it, which is why they are this broad.
//
// MESSAGE STYLE. Every alert names the farm, says what is expected and when,
// and ends with what the farmer should do. A farmer reads these standing in a
// field on a phone, so there is no jargon, no percentages without units, and
// no mention of zones or devices by database id.
public sealed class TelegramNotificationService : INotificationService
{
    private const string NewLine = "\n";

    private readonly TelegramClient _client;
    private readonly NpgsqlDataSource _dataSource;
    private readonly ApkOptions _apkOptions;
    private readonly ILogger<TelegramNotificationService> _logger;

    public TelegramNotificationService(
        TelegramClient client,
        NpgsqlDataSource dataSource,
        IOptions<ApkOptions> apkOptions,
        ILogger<TelegramNotificationService> logger)
    {
        _client = client;
        _dataSource = dataSource;
        _apkOptions = apkOptions.Value;
        _logger = logger;
    }

    // ------------------------------------------------------------------
    // SIGN-IN DETAILS
    // ------------------------------------------------------------------

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

            // The APK may not exist yet. Saying so plainly beats sending a
            // link that 404s on a farmer standing in a field with the
            // installer already packing up.
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

    // ------------------------------------------------------------------
    // A ZONE AGROFLOW COULD NOT WATER ITSELF
    // ------------------------------------------------------------------

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

            // Each reason is a different thing for the farmer to do. A message
            // that just said "this zone is dry" would leave them to work out
            // why nothing happened about it.
            var (cause, action) = reason switch
            {
                ZoneCriticalReason.ManualMode => (
                    "This zone is set to manual, so AgroFlow has not watered it.",
                    "Start it from the app, or switch the zone back to automatic."),

                ZoneCriticalReason.NoDevice => (
                    "There is no working device on this zone, so AgroFlow cannot water it.",
                    "Please water it yourself and tell us the device needs attention."),

                _ => (
                    "AgroFlow asked the pump to water this zone and it did not respond.",
                    "Please check the pump, and water the zone yourself if you can."),
            };

            var message = Compose(
                "This zone needs water",
                "",
                $"Farm: {zone.FarmName}",
                $"Zone: {zone.ZoneName}",
                $"Soil moisture: {moisture:0.#}%",
                "",
                cause,
                "",
                action);

            await BroadcastToFarmAsync(zone.FarmId, message, alertsOnly: true, cancellationToken);
        }
        catch (Exception ex)
        {
            LogSwallowed(ex, $"zone-critical-{reason}", $"zone {zoneId}");
        }
    }

    // ------------------------------------------------------------------
    // WEATHER
    // ------------------------------------------------------------------

    public async Task NotifyWeatherAsync(
        long farmId,
        WeatherAlertNotification notification,
        CancellationToken cancellationToken)
    {
        try
        {
            var when = DescribeDay(notification.Date);

            var lines = notification.Kind switch
            {
                WeatherAlertKind.HeavyRain => new[]
                {
                    "Heavy rain expected",
                    "",
                    $"Farm: {notification.FarmName}",
                    $"When: {when}",
                    $"Expected rainfall: {notification.Value:0.#} mm",
                    "",
                    "AgroFlow does not pause automatic watering for rain yet, so zones on",
                    "automatic will still water on their own soil moisture readings.",
                    "",
                    "If you do not want that, switch those zones to manual in the app",
                    "before then. Check your drainage and anything that could wash away.",
                },

                WeatherAlertKind.Frost => new[]
                {
                    "Frost expected",
                    "",
                    $"Farm: {notification.FarmName}",
                    $"When: {when}",
                    $"Expected low: {notification.Value:0.#} C",
                    "",
                    "Frost can damage or kill young plants overnight.",
                    "",
                    "Cover what you can, and avoid watering late in the day before it -",
                    "wet soil overnight makes frost damage worse.",
                },

                _ => new[]
                {
                    "Heat expected",
                    "",
                    $"Farm: {notification.FarmName}",
                    $"When: {when}",
                    $"Expected high: {notification.Value:0.#} C",
                    "",
                    "Crops lose a lot of water on days like this and can scorch.",
                    "",
                    "Water early in the morning rather than in the heat of the day, and",
                    "check on young or shallow-rooted zones.",
                },
            };

            await BroadcastToFarmAsync(farmId, Compose(lines), alertsOnly: true, cancellationToken);
        }
        catch (Exception ex)
        {
            LogSwallowed(ex, $"weather-{notification.Kind}", $"farm {farmId}");
        }
    }

    // "tomorrow" beats "2026-10-02" for someone reading on a phone, but only
    // for the next few days - past that an actual date is clearer.
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

    // ------------------------------------------------------------------
    // EQUIPMENT
    // ------------------------------------------------------------------

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

            await BroadcastToFarmAsync(farmId, Compose(lines), alertsOnly: true, cancellationToken);
        }
        catch (Exception ex)
        {
            LogSwallowed(ex, $"system-{notification.Kind}", $"farm {farmId}");
        }
    }

    // ------------------------------------------------------------------
    // REQUEST STATUS
    // ------------------------------------------------------------------

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

            // Request updates deliberately ignore telegram_alerts_enabled:
            // someone who muted weather and equipment messages still needs to
            // know a technician is on the way to their farm.
            await _client.SendMessageAsync(chatId.Value, Compose(lines.ToArray()), cancellationToken);
        }
        catch (Exception ex)
        {
            LogSwallowed(ex, "request-status", profileId.ToString());
        }
    }

    // ------------------------------------------------------------------
    // FARM / ZONE REQUESTS (step 7)
    // ------------------------------------------------------------------

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
                // Not an error. A farmer who has never pressed Start in the
                // bot has no chat for anything to be sent to, and a bot
                // cannot message anyone first - so this is the ordinary state
                // for part of the user base, logged and skipped.
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

            // Deliberately NOT gated on telegram_alerts_enabled - same
            // reasoning as NotifyRequestStatusAsync above: someone who muted
            // weather and equipment messages still needs to know a technician
            // is coming to their farm.
            await _client.SendMessageAsync(chatId.Value, message, cancellationToken);
        }
        catch (Exception ex)
        {
            LogSwallowed(ex, $"farm-request-{notification.Stage}", profileId.ToString());
        }
    }

    public async Task NotifyAdminsOfFarmRequestAsync(
        FarmRequestAdminNotification notification,
        CancellationToken cancellationToken)
    {
        try
        {
            var message = FarmRequestMessages.AdminSubmitted(
                notification.FarmerName, notification.RequestType, notification.Location);

            // Every admin with a linked chat. Not filtered on
            // telegram_alerts_enabled: that preference is about weather and
            // equipment noise on a farmer's phone, and an admin who linked
            // the bot at all did so to receive exactly this.
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

            // Sequential, for the same reason BroadcastToFarmAsync is: a
            // handful of recipients, and Telegram rate-limits bots.
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

    // Maps whatever the admin stores to something a farmer reads without
    // having to interpret it. Unknown values pass through unchanged rather
    // than being hidden, so a status added later still reaches the farmer.
    public static string DescribeRequestStatus(string status) => status.Trim().ToLowerInvariant() switch
    {
        "received" or "pending" or "open" => "Received - we have it and will be in touch",
        "scheduled" => "Scheduled - a visit has been booked",
        "on the way" or "on_the_way" or "dispatched" => "A technician is on the way",
        "completed" or "done" or "resolved" => "Completed",
        "rejected" or "cancelled" or "canceled" => "Closed without action - contact us if this is wrong",
        _ => status,
    };

    // ------------------------------------------------------------------
    // RECIPIENT RESOLUTION
    // ------------------------------------------------------------------

    // Blank entries are dropped rather than producing double blank lines, so
    // an absent optional detail does not leave a hole in the message.
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

    // Everyone attached to the farm - the owner and every farm_member - who
    // has linked a chat and has alerts switched on. A farm can legitimately
    // have several people on it, and equipment failing concerns all of them.
    private async Task BroadcastToFarmAsync(
        long farmId,
        string message,
        bool alertsOnly,
        CancellationToken cancellationToken)
    {
        const string sql =
            """
            select distinct p.telegram_chat_id
              from profile p
             where p.telegram_chat_id is not null
               and (not $2 or p.telegram_alerts_enabled)
               and (
                     exists (select 1 from farm f where f.farm_id = $1 and f.owner_id = p.id)
                  or exists (select 1 from farm_member fm where fm.farm_id = $1 and fm.profile_id = p.id)
               )
            """;

        var chatIds = new List<long>();

        await using (var connection = await _dataSource.OpenConnectionAsync(cancellationToken))
        {
            await using var command = new NpgsqlCommand(sql, connection);
            command.Parameters.AddWithValue(farmId);
            command.Parameters.AddWithValue(alertsOnly);

            await using var reader = await command.ExecuteReaderAsync(cancellationToken);

            while (await reader.ReadAsync(cancellationToken))
            {
                chatIds.Add(reader.GetInt64(0));
            }
        }

        if (chatIds.Count == 0)
        {
            _logger.LogDebug("No linked Telegram chats for farm {FarmId}; nothing sent.", farmId);
            return;
        }

        // Sequential on purpose. Telegram rate-limits bots at roughly 30
        // messages a second overall, and an AgroFlow farm has a handful of
        // members rather than thousands - a parallel fan-out would buy nothing
        // and risk 429s.
        foreach (var chatId in chatIds)
        {
            await _client.SendMessageAsync(chatId, message, cancellationToken);
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

        // Null when the zone was deleted between the reading and the
        // notification - nothing to say, and nobody to say it to.
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
