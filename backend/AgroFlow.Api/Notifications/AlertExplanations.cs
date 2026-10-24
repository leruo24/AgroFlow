using System.Globalization;
using AgroFlow.Business;
using AgroFlow.Business.Agronomy.RuleBook;

namespace AgroFlow.Api.Services.Notifications;

// "Why am I seeing this?" for the Telegram alerts, built from the same thresholds
// that fired the alert, so changing a threshold changes its explanation. Plain
// words only; the technical line names the rule for admins.
public static class AlertExplanations
{
    private static readonly CultureInfo Inv = CultureInfo.InvariantCulture;
    private const string Trusted = "High: this comes straight from your kit and the weather forecast.";

    public static Explanation ZoneCritical(string zoneName, float reading, ZoneCriticalReason reason)
    {
        var why = reason switch
        {
            ZoneCriticalReason.ManualMode => "the zone is on manual, so AgroFlow left the watering to you",
            ZoneCriticalReason.NoDevice => "there is no working device on the zone to water it",
            _ => "the pump did not answer when AgroFlow asked it to water",
        };

        return new Explanation
        {
            Summary = $"{zoneName} reached its critical level, and {why}.",
            Rule = $"We message you only when a zone is critical AND AgroFlow could not water it itself. A zone is critical when its soil sensor reads below {Zone.MoistureCriticalMax.ToString("0.#", Inv)}, or the kit measures {Zone.TemperatureCriticalMin.ToString("0.#", Inv)} °C or hotter.",
            Confidence = Trusted,
            WhatWouldChangeIt = reason == ZoneCriticalReason.ManualMode
                ? "Watering the zone, or switching it back to automatic."
                : "Watering the zone, and getting its pump or device working again.",
            Technical = $"Zone.CalculateHealthStatus = Critical (moisture < {Zone.MoistureCriticalMax} or temperature >= {Zone.TemperatureCriticalMin}), reason {reason}.",
        }
        .Fact("Zone", zoneName, Explanations.FromSetup)
        .Fact("Soil sensor reading", reading.ToString("0.#", Inv), Explanations.FromSensor)
        .Fact("Why AgroFlow didn't water it", why, Explanations.FromKit);
    }

    public static Explanation Weather(WeatherAlertNotification n, WeatherAlertOptions o)
    {
        var day = n.Date.ToString("dddd d MMM", Inv);
        var (what, rule, value) = n.Kind switch
        {
            WeatherAlertKind.HeavyRain => ("heavy rain", $"We warn when the forecast shows {o.HeavyRainMm.ToString("0.#", Inv)} mm of rain or more in a day.", n.Value.ToString("0.#", Inv) + " mm"),
            WeatherAlertKind.Frost => ("frost", $"We warn when the forecast low is {o.FrostMinC.ToString("0.#", Inv)} °C or colder.", n.Value.ToString("0.#", Inv) + " °C"),
            _ => ("heat", $"We warn when the forecast high is above {o.HeatMaxC.ToString("0.#", Inv)} °C.", n.Value.ToString("0.#", Inv) + " °C"),
        };

        return new Explanation
        {
            Summary = $"The weather forecast for {n.FarmName} shows {what} on {day}.",
            Rule = rule + $" We look {o.ForecastDays} days ahead and tell you once per day of weather.",
            Confidence = "Medium: weather forecasts can change, especially more than two days ahead.",
            WhatWouldChangeIt = "If the forecast changes, we won't send this again for that day.",
            Technical = $"WeatherAlertService: {n.Kind} threshold from WeatherAlerts options; one per farm/kind/date (notification_sent).",
        }
        .Fact("Day", day, Explanations.FromWeather)
        .Fact("Forecast", value, Explanations.FromWeather);
    }

    public static Explanation SystemFailure(SystemFailureNotification n, DeviceMonitorOptions o)
    {
        var (summary, rule, change) = n.Kind switch
        {
            SystemFailureKind.DeviceOffline => (
                $"{n.Subject} has stopped sending readings.",
                $"We call a device offline when we hear nothing from it for {o.OfflineAfterMinutes} minutes. It normally reports every 30 seconds.",
                "It clears as soon as the device sends a reading. Check it has power and WiFi."),
            SystemFailureKind.DeviceRecovered => (
                $"{n.Subject} is sending readings again.",
                "We tell you when a device that was offline comes back, so you know you can stop checking it.",
                "Nothing - this is good news."),
            SystemFailureKind.PumpUnresponsive => (
                $"The pump on {n.Subject} didn't confirm a watering instruction.",
                $"A device checks for instructions every few minutes. One still waiting after {o.PumpUnresponsiveAfterMinutes} minutes means the pump never confirmed it.",
                "It clears when the pump confirms its next instruction."),
            SystemFailureKind.SensorSilent => (
                $"The soil sensor on {n.Subject} has stopped reporting.",
                $"We call a sensor silent when its zone has no new reading for {o.SensorSilentAfterMinutes / 60.0:0.#} hours, while the device itself may still be online.",
                "It clears when the sensor reports again. Check it is plugged in and in the soil."),
            _ => (
                $"{n.Subject} has no working device to water it.",
                "A zone needs a working device assigned to it before AgroFlow can water it.",
                "It clears once a working device is assigned to the zone."),
        };

        var e = new Explanation
        {
            Summary = summary,
            Rule = rule,
            Confidence = Trusted,
            WhatWouldChangeIt = change,
            Technical = $"DeviceStatusMonitorService: {n.Kind}.",
        }
        .Fact("Farm", n.FarmName, Explanations.FromSetup)
        .Fact(n.Kind == SystemFailureKind.DeviceOffline || n.Kind == SystemFailureKind.DeviceRecovered ? "Device" : "Zone", n.Subject, Explanations.FromSetup);

        if (!string.IsNullOrWhiteSpace(n.Detail)) e.Fact("Detail", n.Detail!, Explanations.FromKit);
        return e;
    }
}
