using System;
using System.Linq;
using AgroFlow.Business;
using Xunit;

namespace AgroFlow.Domain.Tests;

// The farmer's Kit tab (KitHealth): each status line from real data, with the fixtures the brief
// names (healthy, sensor out of range, offline, unconfirmed command, no kit).
public class KitHealthTests
{
    private static readonly DateTimeOffset Now = new(2026, 10, 23, 8, 0, 0, TimeSpan.Zero);

    private static KitHealth.Facts Healthy(Func<KitHealth.Facts, KitHealth.Facts>? change = null)
    {
        var f = new KitHealth.Facts(
            HasKit: true,
            LastContact: Now.AddMinutes(-1),
            SoilAt: Now.AddMinutes(-1),
            ClimateAt: Now.AddMinutes(-1),
            SoilProbeOk: true,
            Rssi: -55,
            Command: new KitHealth.LastCommand("start", "executed", Now.AddHours(-2), Now.AddHours(-2).AddSeconds(3)),
            Backlog: 0,
            FirmwareVersion: "1.7.1",
            FirmwareUpdateAvailable: false,
            LatestFirmware: "1.7.1",
            MaxRunMinutes: 5);
        return change is null ? f : change(f);
    }

    private static KitHealth.Line Line(KitHealth.Status s, string key) => s.Lines.Single(l => l.Key == key);

    [Fact]
    public void A_healthy_kit_is_Working_with_every_line_ok()
    {
        var s = KitHealth.Evaluate(Healthy(), Now);
        Assert.Equal(KitHealth.Working, s.Overall);
        Assert.Equal(new[] { "connection", "wifi", "soil", "climate", "pump", "backlog", "firmware", "safety" }, s.Lines.Select(l => l.Key));
        Assert.Equal("online", Line(s, "connection").State);
        Assert.Equal("strong", Line(s, "wifi").State);
        Assert.Equal("ok", Line(s, "soil").State);
        Assert.Equal("ok", Line(s, "climate").State);
        var pump = Line(s, "pump");
        Assert.Equal("confirmed", pump.State);
        Assert.Equal(Now.AddHours(-2).AddSeconds(3), pump.At);   // the kit's acknowledgement time
        Assert.Equal("none", Line(s, "backlog").State);
        Assert.Equal("current", Line(s, "firmware").State);
        Assert.Equal("5|3", Line(s, "safety").Value);            // the run limit and the 3-minute stop
    }

    [Fact]
    public void A_soil_probe_out_of_range_needs_attention()
    {
        var s = KitHealth.Evaluate(Healthy(f => f with { SoilProbeOk = false }), Now);
        Assert.Equal(KitHealth.NeedsAttention, s.Overall);
        Assert.Equal("out_of_range", Line(s, "soil").State);

        // An older kit (no soilProbeOk): online, but no soil reading for a while.
        var old = KitHealth.Evaluate(Healthy(f => f with { SoilProbeOk = null, SoilAt = Now.AddMinutes(-30) }), Now);
        Assert.Equal("not_reading", Line(old, "soil").State);
        Assert.Equal(KitHealth.NeedsAttention, old.Overall);
    }

    [Fact]
    public void An_offline_kit_is_Not_connected_and_its_sensors_are_unknown_not_faulty()
    {
        var s = KitHealth.Evaluate(Healthy(f => f with
        {
            LastContact = Now.AddHours(-3), SoilAt = Now.AddHours(-3), ClimateAt = Now.AddHours(-3),
        }), Now);
        Assert.Equal(KitHealth.NotConnected, s.Overall);
        Assert.Equal("offline", Line(s, "connection").State);
        Assert.Equal(Now.AddHours(-3), Line(s, "connection").At);
        Assert.Equal("unknown", Line(s, "soil").State);
        Assert.Equal("unknown", Line(s, "climate").State);
    }

    [Fact]
    public void A_command_the_kit_never_confirmed_needs_attention_and_a_fresh_one_is_waiting()
    {
        var unconfirmed = KitHealth.Evaluate(Healthy(f => f with
        {
            Command = new KitHealth.LastCommand("start", "pending", Now.AddMinutes(-5), null),
        }), Now);
        Assert.Equal("unconfirmed", Line(unconfirmed, "pump").State);
        Assert.Equal(KitHealth.NeedsAttention, unconfirmed.Overall);

        var failed = KitHealth.Evaluate(Healthy(f => f with { Command = new KitHealth.LastCommand("stop", "failed", Now.AddHours(-1), null) }), Now);
        Assert.Equal("unconfirmed", Line(failed, "pump").State);

        var waiting = KitHealth.Evaluate(Healthy(f => f with
        {
            Command = new KitHealth.LastCommand("start", "pending", Now.AddSeconds(-20), null),
        }), Now);
        Assert.Equal("waiting", Line(waiting, "pump").State);
        Assert.Equal(KitHealth.Working, waiting.Overall);

        var never = KitHealth.Evaluate(Healthy(f => f with { Command = null }), Now);
        Assert.Equal("never", Line(never, "pump").State);
    }

    [Fact]
    public void A_zone_with_no_kit_is_awaiting_installation_with_no_fault_lines()
    {
        var s = KitHealth.Evaluate(new KitHealth.Facts(false, null, null, null, null, null, null, null, null, false, null, 5), Now);
        Assert.Equal(KitHealth.AwaitingInstallation, s.Overall);
        Assert.Empty(s.Lines);
    }

    [Fact]
    public void The_Wi_Fi_line_appears_only_when_the_kit_reports_its_signal()
    {
        Assert.DoesNotContain(KitHealth.Evaluate(Healthy(f => f with { Rssi = null }), Now).Lines, l => l.Key == "wifi");
        Assert.Equal("ok", Line(KitHealth.Evaluate(Healthy(f => f with { Rssi = -65 }), Now), "wifi").State);
        var weak = KitHealth.Evaluate(Healthy(f => f with { Rssi = -82 }), Now);
        Assert.Equal("weak", Line(weak, "wifi").State);
        Assert.Equal(KitHealth.NeedsAttention, weak.Overall);
    }

    [Fact]
    public void A_dead_temperature_sensor_on_an_online_kit_is_an_error_and_never_seen_is_no_reading()
    {
        Assert.Equal("error", Line(KitHealth.Evaluate(Healthy(f => f with { ClimateAt = Now.AddMinutes(-40) }), Now), "climate").State);
        Assert.Equal("none", Line(KitHealth.Evaluate(Healthy(f => f with { ClimateAt = null }), Now), "climate").State);
        Assert.Equal("none", Line(KitHealth.Evaluate(Healthy(f => f with { SoilAt = null, SoilProbeOk = null }), Now), "soil").State);
    }

    [Fact]
    public void The_backlog_and_firmware_lines_say_what_is_real()
    {
        var s = KitHealth.Evaluate(Healthy(f => f with { Backlog = 42, FirmwareVersion = "1.6.0", FirmwareUpdateAvailable = true, LatestFirmware = "1.7.1" }), Now);
        Assert.Equal(("waiting", "42"), (Line(s, "backlog").State, Line(s, "backlog").Value));
        Assert.Equal(("update_available", "1.6.0|1.7.1"), (Line(s, "firmware").State, Line(s, "firmware").Value));
        Assert.DoesNotContain(KitHealth.Evaluate(Healthy(f => f with { Backlog = null }), Now).Lines, l => l.Key == "backlog");
    }

    [Theory]
    // A real newer version, published at a real https address: yes.
    [InlineData("1.7.0", "1.7.1", "https://firmware.agroflow.co.za/AgroFlowIrrigationNode-1.7.1.bin", true)]
    // The appsettings.json placeholder address: no.
    [InlineData("1.7.0", "1.7.1", "https://YOUR_FIRMWARE_HOST/AgroFlowIrrigationNode-1.7.1.bin", false)]
    // Not newer (the live setting today is 1.4.0): no.
    [InlineData("1.7.1", "1.4.0", "https://firmware.agroflow.co.za/x.bin", false)]
    [InlineData("1.7.1", "1.7.1", "https://firmware.agroflow.co.za/x.bin", false)]
    // No address, plain http, or nothing to compare: no.
    [InlineData("1.7.0", "1.7.1", null, false)]
    [InlineData("1.7.0", "1.7.1", "http://firmware.agroflow.co.za/x.bin", false)]
    [InlineData(null, "1.7.1", "https://firmware.agroflow.co.za/x.bin", false)]
    public void Update_available_only_for_a_real_newer_published_version(string? current, string latest, string? url, bool expected) =>
        Assert.Equal(expected, KitHealth.FirmwareUpdateAvailable(current, latest, url));

    [Fact]
    public void Nothing_the_kit_cannot_measure_is_ever_a_line()
    {
        var keys = KitHealth.Evaluate(Healthy(), Now).Lines.Select(l => l.Key).ToList();
        foreach (var never in new[] { "battery", "flow", "valve", "water_flow" }) Assert.DoesNotContain(never, keys);
    }

    [Fact]
    public void The_setup_card_values_for_a_known_device_ID()
    {
        Assert.Equal("AgroFlow-Setup-89AB", DeviceSetupCommands.SetupNetworkName("0123456789AB"));
        Assert.Equal("AF-6789AB", DeviceSetupCommands.SetupNetworkPassword("0123456789AB"));
    }
}
