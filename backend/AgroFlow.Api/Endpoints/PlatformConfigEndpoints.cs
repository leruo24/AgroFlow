using AgroFlow.Api.Auth;
using AgroFlow.Api.Services.Notifications;
using Microsoft.Extensions.Options;

namespace AgroFlow.Api.Endpoints;

/// The thresholds the platform really runs on (device offline time, weather
/// alerts and so on), read from the same IOptions the services use, so the
/// Settings page always matches.
/// Read-only: they are environment variables on the deployment and need a restart.
/// The page says where to change them.
public static class PlatformConfigEndpoints
{
    public record ConfigValue(string Label, string Value, string Explains);

    public record ConfigGroup(string Title, string SetIn, IReadOnlyList<ConfigValue> Values);

    public record PlatformConfigResponse(IReadOnlyList<ConfigGroup> Groups);

    public static void MapPlatformConfigEndpoints(this WebApplication app)
    {
        app.MapGet("/api/admin/platform-config", GetPlatformConfig)
            .RequireAuthorization()
            .AddEndpointFilter<AdminOnlyFilter>();
    }

    private static IResult GetPlatformConfig(
        IOptions<DeviceMonitorOptions> deviceMonitor,
        IOptions<WeatherAlertOptions> weatherAlerts,
        IOptions<TelegramOptions> telegram)
    {
        var device = deviceMonitor.Value;
        var weather = weatherAlerts.Value;

        var groups = new List<ConfigGroup>
        {
            new(
                "Kit monitoring",
                "DeviceMonitor__* environment variables on the API deployment",
                new List<ConfigValue>
                {
                    new("Watching kits",
                        device.Enabled ? "On" : "Off",
                        "When off, nothing marks a silent kit as offline and no farmer is told."),

                    new("A kit is offline after",
                        $"{device.OfflineAfterMinutes} minutes with no reading",
                        "Generous next to the ~30 second sensor cadence, so one missed reading or a brief Wi-Fi drop does not alarm a farmer."),

                    new("Checked every",
                        $"{device.CheckIntervalMinutes} minutes",
                        "How often every kit is re-evaluated."),

                    new("A pump is unresponsive after",
                        $"{device.PumpUnresponsiveAfterMinutes} minutes",
                        "A command still unacknowledged after this never reached the pump. Generous, because kits poll for commands rather than being pushed them."),

                    new("A sensor is silent after",
                        $"{device.SensorSilentAfterMinutes} minutes",
                        "Longer than the offline threshold on purpose, so one outage does not raise two different alerts."),
                }),

            new(
                "Weather warnings",
                "WeatherAlerts__* environment variables on the API deployment",
                new List<ConfigValue>
                {
                    new("Warning farmers about weather",
                        weather.Enabled ? "On" : "Off",
                        "When off, no frost, heat or heavy-rain warning is sent."),

                    new("Heavy rain",
                        $"{weather.HeavyRainMm:0.#} mm in a day",
                        "Regional by nature: 20 mm is a lot on a slope and nothing on flat veld."),

                    new("Frost risk",
                        $"{weather.FrostMinC:0.#} °C or below",
                        "Daily minimum at or under which frost is a real risk."),

                    new("Heat stress",
                        $"above {weather.HeatMaxC:0.#} °C",
                        "Daily maximum above which heat stress is a real risk."),
                }),

            new(
                "Farmer messaging",
                "Telegram__* environment variables on the API deployment",
                new List<ConfigValue>
                {
                    // Security: the token is never returned; we only say whether one is set.
                    new("Telegram bot",
                        string.IsNullOrWhiteSpace(telegram.Value.BotToken)
                            ? "Not configured - farmers receive nothing"
                            : "Configured",
                        "Every alert, weather warning and password reset reaches farmers through this."),
                }),
        };

        return Results.Ok(new PlatformConfigResponse(groups));
    }
}
