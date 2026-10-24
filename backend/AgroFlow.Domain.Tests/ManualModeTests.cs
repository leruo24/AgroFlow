using System;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Reflection;
using System.Text.Json;
using System.Threading.Tasks;
using AgroFlow.Api.Endpoints;
using AgroFlow.Business;
using Xunit;

namespace AgroFlow.Domain.Tests;

// Part 0: Manual, Scheduled and Automatic read the same everywhere, and a Manual zone is
// never watered automatically: not by a sensor reading on the server, not by the schedule
// job, and not by an offline kit on its own.
public class ManualModeTests : IClassFixture<ApiHost>
{
    private readonly ApiHost _host;
    public ManualModeTests(ApiHost host) => _host = host;

    // Mode mapping (the API side; the app's is lib/irrigationMode.ts)

    [Theory]
    [InlineData("automatic", "automatic")]
    [InlineData("scheduled", "scheduled")]
    [InlineData("manual", "manual")]
    [InlineData("Manual", "manual")]
    [InlineData(" AUTOMATIC ", "automatic")]
    [InlineData(null, "manual")]       // unknown never reads as Automatic
    [InlineData("", "manual")]
    [InlineData("eco", "manual")]
    public void The_stored_mode_reads_as_one_of_three_names(string? stored, string expected) =>
        Assert.Equal(expected, IrrigationMode.Canonical(stored));

    [Theory]
    [InlineData("automatic")]
    [InlineData("scheduled")]
    [InlineData("manual")]
    public void Each_name_round_trips(string mode)
    {
        Assert.True(IrrigationMode.IsRecognised(mode));
        Assert.Equal(mode, IrrigationMode.Canonical(IrrigationMode.Canonical(mode)));
    }

    // The automatic-command rule

    [Theory]
    [InlineData("manual")]
    [InlineData("scheduled")]
    [InlineData(null)]
    [InlineData("eco")]
    public void A_zone_that_is_not_automatic_never_gets_an_automatic_command(string? mode)
    {
        // Bone dry, thresholds set, no manual run, no previous command: everything that would
        // start the pump on an Automatic zone.
        Assert.Null(AutoIrrigationDecision.Decide(mode, reading: 2, moistureThreshold: 30, desiredMoisture: 60,
            manualRunActive: false, lastCommand: null));
        // And soaking wet, nothing either.
        Assert.Null(AutoIrrigationDecision.Decide(mode, reading: 95, moistureThreshold: 30, desiredMoisture: 60,
            manualRunActive: false, lastCommand: "start"));
    }

    [Fact]
    public void An_automatic_zone_starts_when_dry_and_stops_when_wet()
    {
        Assert.Equal("start", AutoIrrigationDecision.Decide("automatic", 12, 30, 60, false, null));
        Assert.Equal("stop", AutoIrrigationDecision.Decide("automatic", 70, 30, 60, false, "start"));
        Assert.Null(AutoIrrigationDecision.Decide("automatic", 45, 30, 60, false, null));     // in between
        Assert.Null(AutoIrrigationDecision.Decide("automatic", 12, 30, 60, false, "start"));  // already started
        Assert.Null(AutoIrrigationDecision.Decide("automatic", 12, 30, 60, true, null));      // manual run wins
        Assert.Null(AutoIrrigationDecision.Decide("automatic", 12, null, null, false, null)); // no thresholds
    }

    [Fact]
    public void The_processor_uses_the_rule_and_checks_the_mode_first()
    {
        var src = File.ReadAllText(Path.Combine(RepoRoot(), "backend", "AgroFlow.Api", "SensorMonitoring", "SensorReadingProcessor.cs"));
        var gate = src.IndexOf("if (!IrrigationMode.AllowsAutoCommands(irrigationMode))", StringComparison.Ordinal);
        var decide = src.IndexOf("AutoIrrigationDecision.Decide(", StringComparison.Ordinal);
        var insert = src.IndexOf("await InsertAutoCommandAsync(connection, zoneId, desired);", StringComparison.Ordinal);
        Assert.True(gate > 0 && decide > gate && insert > decide);
        // Only one place inserts an automatic command.
        Assert.Single(System.Text.RegularExpressions.Regex.Matches(src, "InsertAutoCommandAsync\\(connection").Cast<object>());
    }

    [Fact]
    public void The_schedule_job_only_fires_scheduled_zones()
    {
        var sql = File.ReadAllText(Path.Combine(RepoRoot(), "supabase", "migrations", "0010_zone_schema_realignment.sql"));
        var fn = sql[sql.IndexOf("create or replace function fire_due_irrigation_schedules()", StringComparison.Ordinal)..];
        Assert.Contains("where z.irrigation_mode = 'scheduled'", fn[..fn.IndexOf("loop", StringComparison.Ordinal)]);
    }

    // The kit's offline fallback

    [Fact]
    public void Only_an_automatic_zone_lets_an_offline_kit_water_by_itself()
    {
        Assert.True(IrrigationMode.AllowsKitFallback("automatic"));
        Assert.False(IrrigationMode.AllowsKitFallback("manual"));
        Assert.False(IrrigationMode.AllowsKitFallback("scheduled"));
        Assert.False(IrrigationMode.AllowsKitFallback(null));
    }

    [Fact]
    public void The_firmware_asks_for_the_mode_and_its_fallback_obeys_it()
    {
        var sketch = File.ReadAllText(Path.Combine(RepoRoot(), "hardware", "esp32", "AgroFlowIrrigationNode", "AgroFlowIrrigationNode.ino"));
        Assert.Contains("\"/api/devices/config\"", sketch);
        Assert.Contains("r[\"autoWateringAllowed\"] | false", sketch);   // missing field = not allowed
        Assert.Contains("bool autoWateringAllowed = false;", sketch);     // fails closed before any answer
        var fallback = sketch[sketch.IndexOf("void runOfflineFallback()", StringComparison.Ordinal)..];
        fallback = fallback[..fallback.IndexOf("// Command ACK", StringComparison.Ordinal)];
        var gate = fallback.IndexOf("if (!autoWateringAllowed)", StringComparison.Ordinal);
        var start = fallback.IndexOf("startPumpCycle(", StringComparison.Ordinal);
        Assert.True(gate > 0 && start > gate, "the fallback must check the zone mode before it can start the pump");
        // The fields the firmware reads are the ones the API sends.
        var fields = typeof(DeviceConfigResponse).GetProperties(BindingFlags.Public | BindingFlags.Instance)
            .Select(p => JsonNamingPolicy.CamelCase.ConvertName(p.Name)).ToArray();
        Assert.Contains("autoWateringAllowed", fields);
        Assert.Contains("irrigationMode", fields);
        // Pins unchanged.
        Assert.Contains("const int MOISTURE_PIN = 32;", sketch);
        Assert.Contains("const int RELAY_PIN    = 25;", sketch);
        Assert.Contains("const int DHT_PIN      = 27;", sketch);
    }

    [Fact]
    public async Task The_config_route_needs_the_kits_own_token()
    {
        var client = _host.CreateClient();
        var none = await client.GetAsync("/api/devices/config");
        Assert.Equal(HttpStatusCode.Unauthorized, none.StatusCode);
        var req = new HttpRequestMessage(HttpMethod.Get, "/api/devices/config");
        req.Headers.Add("X-Device-Token", "not-a-real-token");
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.SendAsync(req)).StatusCode);
    }

    [Fact]
    public void The_admin_zone_list_carries_the_mode()
    {
        var src = File.ReadAllText(Path.Combine(RepoRoot(), "backend", "AgroFlow.Api", "Endpoints", "ReportEndpoints.cs"));
        Assert.Contains("irrigationMode = AgroFlow.Business.IrrigationMode.Canonical(", src);
    }

    private static string RepoRoot()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir != null && !Directory.Exists(Path.Combine(dir.FullName, "hardware"))) dir = dir.Parent;
        return dir!.FullName;
    }
}
