using Microsoft.Extensions.Options;
using Npgsql;

namespace AgroFlow.Api.Services.Notifications;

// Telegram implementation of INotificationService. Resolves an AgroFlow
// identity (profile / zone / hardware) to the linked Telegram chats, composes
// a plain-language message and sends it.
//
// EVERY PUBLIC METHOD SWALLOWS EVERYTHING. See the contract on
// INotificationService: a failed message must never propagate into
// onboarding, sensor ingestion or irrigation. The catch blocks here are the
// single place that guarantees it, which is why they are this broad.
public sealed class TelegramNotificationService : INotificationService
{
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
    // WELCOME
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

            await _client.SendMessageAsync(
                chatId.Value,
                ComposeWelcome(notification),
                cancellationToken);
        }
        catch (Exception ex)
        {
            LogSwallowed(ex, "welcome", profileId.ToString());
        }
    }

    private string ComposeWelcome(FarmerWelcomeNotification n)
    {
        // The APK may not exist yet. Saying so plainly beats sending a link
        // that 404s on a farmer standing in a field with the installer
        // already packing up.
        var appLine = string.IsNullOrWhiteSpace(_apkOptions.DownloadUrl)
            ? "The AgroFlow app download is coming soon. We will send you the link here as soon as it is ready."
            : "Download the AgroFlow app here:\n" + _apkOptions.DownloadUrl;

        return string.Join("\n", new[]
        {
            $"Welcome to AgroFlow, {n.FarmerName}.",
            "",
            "Your account is ready.",
            "",
            $"Farm: {n.FarmName}",
            $"Location: {n.FarmLocation}",
            "",
            "Sign in with:",
            $"Email: {n.Email}",
            $"Temporary password: {n.TemporaryPassword}",
            "",
            appLine,
            "",
            "You will be asked to choose your own password the first time you sign in.",
            "Please do that as soon as you can - the temporary password above stays in this chat.",
            "",
            "From now on this chat is where AgroFlow will message you about your zones,",
            "your irrigation, and any requests you send us.",
        });
    }

    // ------------------------------------------------------------------
    // ZONE / IRRIGATION / DEVICE ALERTS
    // ------------------------------------------------------------------

    public async Task NotifyZoneCriticalAsync(
        long zoneId,
        float moisture,
        CancellationToken cancellationToken)
    {
        try
        {
            var zone = await GetZoneContextAsync(zoneId, cancellationToken);
            if (zone is null) return;

            var message = string.Join("\n", new[]
            {
                "Low soil moisture",
                "",
                $"Farm: {zone.FarmName}",
                $"Zone: {zone.ZoneName}",
                $"Soil moisture: {moisture:0.#}%",
                "",
                "This zone has dropped into the critical range. If it is set to",
                "automatic irrigation, AgroFlow has already asked it to water.",
                "If it is on manual, it needs your attention.",
            });

            await BroadcastToFarmAsync(zone.FarmId, message, alertsOnly: true, cancellationToken);
        }
        catch (Exception ex)
        {
            LogSwallowed(ex, "zone-critical", $"zone {zoneId}");
        }
    }

    public async Task NotifyIrrigationAsync(
        long zoneId,
        string command,
        string source,
        CancellationToken cancellationToken)
    {
        try
        {
            var zone = await GetZoneContextAsync(zoneId, cancellationToken);
            if (zone is null) return;

            var started = string.Equals(command, "start", StringComparison.OrdinalIgnoreCase);

            var reason = string.Equals(source, "manual", StringComparison.OrdinalIgnoreCase)
                ? "This was a manual instruction."
                : "AgroFlow did this automatically, based on the soil moisture reading.";

            var message = string.Join("\n", new[]
            {
                started ? "Irrigation started" : "Irrigation stopped",
                "",
                $"Farm: {zone.FarmName}",
                $"Zone: {zone.ZoneName}",
                "",
                reason,
            });

            await BroadcastToFarmAsync(zone.FarmId, message, alertsOnly: true, cancellationToken);
        }
        catch (Exception ex)
        {
            LogSwallowed(ex, $"irrigation-{command}", $"zone {zoneId}");
        }
    }

    public async Task NotifyDeviceStatusAsync(
        long hardwareId,
        bool online,
        DateTimeOffset? lastSeen,
        CancellationToken cancellationToken)
    {
        try
        {
            var device = await GetDeviceContextAsync(hardwareId, cancellationToken);
            if (device is null) return;

            var where = string.IsNullOrWhiteSpace(device.ZoneName)
                ? device.FarmName
                : $"{device.FarmName}, {device.ZoneName}";

            var message = online
                ? string.Join("\n", new[]
                {
                    "Device back online",
                    "",
                    $"Device: {device.DeviceName}",
                    $"Location: {where}",
                    "",
                    "It is sending readings again. Nothing further is needed.",
                })
                : string.Join("\n", new[]
                {
                    "Device offline",
                    "",
                    $"Device: {device.DeviceName}",
                    $"Location: {where}",
                    $"Last reading: {FormatLastSeen(lastSeen)}",
                    "",
                    "AgroFlow has stopped hearing from this device, so its zone is not",
                    "being monitored, and it will not water automatically right now.",
                    "Please check that it has power and signal.",
                    "We will message you here when it comes back.",
                });

            await BroadcastToFarmAsync(device.FarmId, message, alertsOnly: true, cancellationToken);
        }
        catch (Exception ex)
        {
            LogSwallowed(ex, online ? "device-online" : "device-offline", $"hardware {hardwareId}");
        }
    }

    private static string FormatLastSeen(DateTimeOffset? lastSeen)
    {
        if (lastSeen is null) return "unknown";

        var age = DateTimeOffset.UtcNow - lastSeen.Value;

        if (age < TimeSpan.FromMinutes(90)) return $"about {(int)age.TotalMinutes} minutes ago";
        if (age < TimeSpan.FromHours(48)) return $"about {(int)age.TotalHours} hours ago";

        return $"about {(int)age.TotalDays} days ago";
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
            // someone who muted sensor chatter still needs to know that a
            // technician is on the way to their farm.
            await _client.SendMessageAsync(chatId.Value, string.Join("\n", lines), cancellationToken);
        }
        catch (Exception ex)
        {
            LogSwallowed(ex, "request-status", profileId.ToString());
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
    // has linked a chat. A farm can legitimately have several people on it,
    // and a device going offline concerns all of them.
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

    private sealed record DeviceContext(long FarmId, string FarmName, string? ZoneName, string DeviceName);

    private async Task<DeviceContext?> GetDeviceContextAsync(long hardwareId, CancellationToken cancellationToken)
    {
        await using var connection = await _dataSource.OpenConnectionAsync(cancellationToken);

        await using var command = new NpgsqlCommand(
            """
            select f.farm_id, f.name, z.name, coalesce(nullif(h.device_name, ''), 'Unnamed device')
              from hardware h
              join zone z on z.id = h.zone_id
              join farm f on f.farm_id = z.farm_id
             where h.hardware_id = $1
            """,
            connection);

        command.Parameters.AddWithValue(hardwareId);

        await using var reader = await command.ExecuteReaderAsync(cancellationToken);

        // An unassigned device (no zone, therefore no farm and nobody to
        // tell), or one that has since been deleted.
        if (!await reader.ReadAsync(cancellationToken)) return null;

        return new DeviceContext(
            reader.GetInt64(0),
            reader.GetString(1),
            reader.IsDBNull(2) ? null : reader.GetString(2),
            reader.GetString(3));
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
