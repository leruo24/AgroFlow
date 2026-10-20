using System;
using System.IO;
using AgroFlow.Api.Services.Notifications;
using Xunit;

namespace AgroFlow.Domain.Tests;

// Weather warnings are saved in the app too, not only sent on Telegram.
public class WeatherInAppTests
{
    [Fact]
    public void The_in_app_frost_warning_says_what_when_how_cold_and_what_to_do()
    {
        var text = WeatherAlertService.InAppMessage(WeatherAlertKind.Frost, new DateOnly(2026, 10, 23), 0.5);
        Assert.Equal(
            "Frost expected on Friday 23 October. Expected low: 0.5 C. " +
            "Cover what you can, and avoid watering late in the day before it - wet soil overnight makes frost damage worse.",
            text);
    }

    [Theory]
    [InlineData(WeatherAlertKind.HeavyRain, 42.0, "Heavy rain expected on", "Expected rainfall: 42 mm.")]
    [InlineData(WeatherAlertKind.Heat, 38.4, "Heat expected on", "Expected high: 38.4 C.")]
    public void Rain_and_heat_too(WeatherAlertKind kind, double value, string starts, string figure)
    {
        var text = WeatherAlertService.InAppMessage(kind, new DateOnly(2026, 10, 23), value);
        Assert.StartsWith(starts, text);
        Assert.Contains(figure, text);
        Assert.DoesNotContain("{", text);
    }

    [Fact]
    public void Every_farm_is_checked_and_each_warning_is_saved_as_a_farm_alert_before_Telegram()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir != null && !Directory.Exists(Path.Combine(dir.FullName, "backend", "AgroFlow.Api"))) dir = dir.Parent;
        var src = File.ReadAllText(Path.Combine(dir!.FullName, "backend", "AgroFlow.Api", "Services", "Notifications", "WeatherAlertService.cs"));

        Assert.DoesNotContain("telegram_chat_id is not null", src);   // no longer only farms with Telegram
        Assert.Contains("insert into alert (zone_id, farm_id, severity, message) values (null, $1, 'Warning', $2)", src);
        Assert.True(src.IndexOf("SaveInAppAsync(farmId", StringComparison.Ordinal) <
                    src.IndexOf("_notifications.NotifyWeatherAsync(", StringComparison.Ordinal));
        Assert.True(src.IndexOf("_ledger.TryClaimAsync", StringComparison.Ordinal) <
                    src.IndexOf("SaveInAppAsync(farmId", StringComparison.Ordinal));   // once per farm and day
    }
}
