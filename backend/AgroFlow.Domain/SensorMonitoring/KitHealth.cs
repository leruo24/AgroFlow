#nullable enable
using System;
using System.Collections.Generic;
using System.Linq;

namespace AgroFlow.Business;

// The farmer's Kit tab: one plain status per kit, and a checklist of what is working.
// Every line comes from something the kit or the server really measured: the kit's last contact,
// its readings, its Wi-Fi signal and soil-probe check (firmware 1.7.1+), the last pump-switch
// command and the kit's acknowledgement, its upload backlog, its firmware and the zone's run
// limit. Nothing the kit cannot measure is ever reported: no battery, no water flow, no valve
// position. The app words each line in the farmer's language from its key and state.
public static class KitHealth
{
    public const string AwaitingInstallation = "awaiting_installation";
    public const string NotConnected = "not_connected";
    public const string NeedsAttention = "needs_attention";
    public const string Working = "working";

    // The firmware's lost-connection failsafe (LOST_CONTACT_STOP_MS): a run the server started
    // stops by itself after this long without the server.
    public const int LostContactStopMinutes = 3;

    // Wi-Fi signal bands in dBm. -60 and better is strong; below -70 drops connections.
    public const int StrongRssi = -60;
    public const int WeakBelowRssi = -70;

    public sealed record LastCommand(string Command, string Status, DateTimeOffset CreatedAt, DateTimeOffset? ExecutedAt);

    public sealed record Facts(
        bool HasKit,
        DateTimeOffset? LastContact,
        DateTimeOffset? SoilAt,
        DateTimeOffset? ClimateAt,
        bool? SoilProbeOk,
        int? Rssi,
        LastCommand? Command,
        int? Backlog,
        string? FirmwareVersion,
        bool FirmwareUpdateAvailable,
        string? LatestFirmware,
        int MaxRunMinutes);

    // One checklist line. Tone is how the app colours it: ok, warn, bad or info.
    public sealed record Line(string Key, string State, string Tone, DateTimeOffset? At = null, string? Value = null);

    public sealed record Status(string Overall, IReadOnlyList<Line> Lines);

    public static Status Evaluate(Facts f, DateTimeOffset now)
    {
        if (!f.HasKit) return new Status(AwaitingInstallation, Array.Empty<Line>());

        var online = DeviceLiveness.IsOnline(f.LastContact, now);
        var lines = new List<Line>
        {
            new("connection", online ? "online" : "offline", online ? "ok" : "bad", f.LastContact),
        };

        // Only when the kit reports it (firmware 1.7.1+); otherwise the line is left out.
        if (f.Rssi is { } rssi)
        {
            var band = rssi >= StrongRssi ? "strong" : rssi >= WeakBelowRssi ? "ok" : "weak";
            lines.Add(new("wifi", band, band == "weak" ? "warn" : "ok", Value: rssi.ToString()));
        }

        lines.Add(Soil(f, online, now));
        lines.Add(Climate(f, online, now));
        lines.Add(Pump(f.Command, now));
        if (f.Backlog is { } backlog)
            lines.Add(new("backlog", backlog > 0 ? "waiting" : "none", "info", Value: backlog.ToString()));
        lines.Add(f.FirmwareVersion is null
            ? new("firmware", "unknown", "info")
            : new("firmware", f.FirmwareUpdateAvailable ? "update_available" : "current", "info",
                Value: f.FirmwareUpdateAvailable ? $"{f.FirmwareVersion}|{f.LatestFirmware}" : f.FirmwareVersion));
        lines.Add(new("safety", "limits", "info", Value: $"{f.MaxRunMinutes}|{LostContactStopMinutes}"));

        var overall = !online ? NotConnected
            : lines.Any(l => l.Tone is "warn" or "bad") ? NeedsAttention
            : Working;
        return new Status(overall, lines);
    }

    private static Line Soil(Facts f, bool online, DateTimeOffset now)
    {
        if (f.SoilProbeOk == false) return new("soil", "out_of_range", "warn", f.SoilAt);
        if (f.SoilAt is null) return new("soil", "none", "info");
        if (DeviceLiveness.IsOnline(f.SoilAt, now)) return new("soil", "ok", "ok", f.SoilAt);
        // Online but no recent soil reading: the firmware sends nothing for an out-of-range
        // sample, so an older kit (no soilProbeOk) shows the same problem this way.
        return online ? new("soil", "not_reading", "warn", f.SoilAt) : new("soil", "unknown", "info", f.SoilAt);
    }

    private static Line Climate(Facts f, bool online, DateTimeOffset now)
    {
        if (f.ClimateAt is null) return new("climate", "none", "info");
        if (DeviceLiveness.IsOnline(f.ClimateAt, now)) return new("climate", "ok", "ok", f.ClimateAt);
        // The firmware sends nothing when the DHT11 fails, so a kit that is online with no recent
        // temperature/humidity reading has a sensor error.
        return online ? new("climate", "error", "warn", f.ClimateAt) : new("climate", "unknown", "info", f.ClimateAt);
    }

    // The pump switch: the kit's acknowledgement confirms the relay switched, nothing more.
    private static Line Pump(LastCommand? c, DateTimeOffset now)
    {
        if (c is null) return new("pump", "never", "info");
        if (c.Status == "executed") return new("pump", "confirmed", "ok", c.ExecutedAt ?? c.CreatedAt, c.Command);
        if (c.Status == "pending" && now - c.CreatedAt <= CommandState.AckWait)
            return new("pump", "waiting", "info", c.CreatedAt, c.Command);
        return new("pump", "unconfirmed", "warn", c.CreatedAt, c.Command);
    }

    // "Update available" only when a real newer version has been published: a version number
    // higher than the kit's AND a download address that is a real https address, not the
    // appsettings.json placeholder.
    public static bool FirmwareUpdateAvailable(string? current, string? latest, string? downloadUrl)
    {
        if (!Version.TryParse(current, out var have) || !Version.TryParse(latest, out var newest)) return false;
        if (newest <= have) return false;
        return Uri.TryCreate(downloadUrl, UriKind.Absolute, out var url)
            && url.Scheme == Uri.UriSchemeHttps
            && !url.Host.Contains("YOUR_", StringComparison.OrdinalIgnoreCase)
            && !url.Host.EndsWith(".example", StringComparison.OrdinalIgnoreCase);
    }
}
