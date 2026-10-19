using System;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using AgroFlow.Api.Mqtt;
using AgroFlow.Business;
using Xunit;

namespace AgroFlow.Domain.Tests;

// Water now (docs/irrigate-path.md): each zone's maximum run time (migration 0052, default
// 5 min, staff set 1-120), the kit enforcing min(requested, maximum) with a 3-minute
// lost-connection stop, and no start without a kit that is listening.
public class IrrigationRunTests : IClassFixture<ApiHost>
{
    private readonly ApiHost _host;
    public IrrigationRunTests(ApiHost host) => _host = host;

    [Theory]
    [InlineData("start", 60, null)]
    [InlineData("start", 7200, null)]   // the zone's own maximum is checked once the zone is read
    [InlineData("stop", null, null)]
    [InlineData("start", 7201, "A run can be at most 120 minutes.")]
    [InlineData("start", 0, "Duration must be at least 1 second.")]
    [InlineData("start", null, "A start command requires a duration.")]
    [InlineData("open", 60, "Command must be start or stop.")]
    public void A_request_is_never_over_the_kits_120_minute_ceiling(string command, int? seconds, string? problem) =>
        Assert.Equal(problem, IrrigationRunRules.CheckRequest(command, seconds));

    [Fact]
    public void A_run_longer_than_the_zones_maximum_is_refused_with_the_limit_in_plain_words()
    {
        Assert.Null(IrrigationRunRules.CheckAgainstZone(300, 5));
        Assert.Equal(
            "This zone's pump is limited to 5 min per run. Choose 5 minutes or less, and run it again after it finishes.",
            IrrigationRunRules.CheckAgainstZone(301, 5));
        Assert.Null(IrrigationRunRules.CheckAgainstZone(66 * 60, 90));
        Assert.Contains("limited to 30 min", IrrigationRunRules.CheckAgainstZone(31 * 60, 30));
    }

    [Theory]
    [InlineData(1, true)]
    [InlineData(5, true)]
    [InlineData(120, true)]
    [InlineData(0, false)]
    [InlineData(121, false)]
    [InlineData(null, false)]
    public void Staff_set_a_maximum_between_1_and_120_minutes(int? minutes, bool ok) =>
        Assert.Equal(ok ? null : "The maximum run time must be between 1 and 120 minutes.", IrrigationRunRules.CheckMaxRunMinutes(minutes));

    [Fact]
    public void The_default_is_5_minutes_and_a_bad_stored_value_reads_as_the_default()
    {
        Assert.Equal(5, IrrigationRunRules.DefaultMaxRunMinutes);
        Assert.Equal(5, IrrigationRunRules.ZoneMaxOrDefault(null));
        Assert.Equal(5, IrrigationRunRules.ZoneMaxOrDefault(0));
        Assert.Equal(5, IrrigationRunRules.ZoneMaxOrDefault(500));
        Assert.Equal(45, IrrigationRunRules.ZoneMaxOrDefault(45));
    }

    [Theory]
    [InlineData(600, 300, 300)]      // the zone's maximum wins
    [InlineData(120, 300, 120)]      // a shorter request wins
    [InlineData(600, null, 300)]     // an older server sent no maximum: 5 minutes
    [InlineData(9000, 9000, 7200)]   // never past the kit's own 120 minutes
    public void The_kit_runs_the_shortest_of_request_zone_maximum_and_its_ceiling(int requested, int? max, int runs) =>
        Assert.Equal(runs, IrrigationRunRules.EffectiveRunSeconds(requested, max));

    [Fact]
    public void Every_command_sent_to_the_kit_carries_maxRunSeconds()
    {
        var json = JsonSerializer.Serialize(
            new IrrigationCommandNotification(Guid.Empty, 7, "start", 60, "manual") with { MaxRunSeconds = 300 },
            new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase });
        Assert.Contains("\"maxRunSeconds\":300", json);
        Assert.Contains("\"durationSeconds\":60", json);
    }

    [Fact]
    public void The_firmware_enforces_the_zone_maximum_and_stops_after_3_minutes_without_the_server()
    {
        // From the sketch's source (never secrets.h).
        var sketch = Sketch();
        Assert.Contains("cmd[\"maxRunSeconds\"]", sketch);
        Assert.Matches(@"ABSOLUTE_MAX_RUN_MS\s*=\s*120UL \* 60UL \* 1000UL", sketch);
        Assert.Matches(@"DEFAULT_MAX_RUN_MS\s*=\s*5UL \* 60UL \* 1000UL", sketch);
        Assert.Matches(@"LOST_CONTACT_STOP_MS\s*=\s*3UL \* 60UL \* 1000UL", sketch);
        Assert.Contains("#include \"RunLimits.h\"", sketch);
        Assert.Contains("agroflow::effectiveRunMs(", sketch);
        Assert.Contains("agroflow::lostContactShouldStop(", sketch);
        // The local page keeps its own 5 minutes.
        Assert.Matches(@"LOCAL_MAX_RUN_MS\s*=\s*5UL \* 60UL \* 1000UL", sketch);
        Assert.Matches(@"FIRMWARE_VERSION = ""1\.6\.0""", sketch);
    }

    [Fact]
    public void Migration_0052_adds_the_zone_maximum_with_its_range_and_farmers_cannot_change_it()
    {
        var sql = File.ReadAllText(Path.Combine(Root(), "supabase", "migrations", "0052_zone_max_run.sql"));
        Assert.Contains("add column if not exists max_run_minutes integer not null default 5", sql);
        Assert.Contains("check (max_run_minutes between 1 and 120)", sql);
        // The farmer edit guard lists what a farmer may change; the maximum is not in it.
        var guard = File.ReadAllText(Path.Combine(Root(), "supabase", "migrations", "0043_zone_farmer_edit_guard.sql"));
        Assert.DoesNotContain("max_run_minutes", guard);
        Assert.Contains("array[''crop_type'', ''planting_date'', ''soil_type'', ''area_m2'', ''size_value'', ''size_unit'', ''updated_at'']", guard);
    }

    [Fact]
    public async Task Only_staff_can_change_a_zones_maximum()
    {
        var client = _host.CreateClient();
        HttpRequestMessage Put(Guid who, int minutes)
        {
            var r = new HttpRequestMessage(HttpMethod.Put, "/api/admin/zones/7/max-run")
            {
                Content = new StringContent(JsonSerializer.Serialize(new { maxRunMinutes = minutes }), Encoding.UTF8, "application/json"),
            };
            r.Headers.Add(ApiHost.TestAuth.Header, who.ToString());
            return r;
        }
        Assert.Equal(HttpStatusCode.Forbidden, (await client.SendAsync(Put(ApiHost.Farmer, 30))).StatusCode);
        var bad = await client.SendAsync(Put(ApiHost.Admin, 500));
        Assert.Equal(HttpStatusCode.BadRequest, bad.StatusCode);
        Assert.Contains("between 1 and 120 minutes", await bad.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task The_API_refuses_a_run_over_120_minutes_before_reading_anything()
    {
        var client = _host.CreateClient();
        var request = new HttpRequestMessage(HttpMethod.Post, "/api/farmer/zones/7/commands")
        {
            Content = new StringContent(JsonSerializer.Serialize(new { command = "start", durationSeconds = 9000 }), Encoding.UTF8, "application/json"),
        };
        request.Headers.Add(ApiHost.TestAuth.Header, ApiHost.Farmer.ToString());
        var res = await client.SendAsync(request);
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
        Assert.Contains("at most 120 minutes", await res.Content.ReadAsStringAsync());
    }

    [Fact]
    public void A_start_needs_an_enrolled_kit_heard_from_in_the_last_5_minutes()
    {
        var now = DateTimeOffset.Parse("2026-10-19T08:00:00Z");
        Assert.Equal(IrrigationRunRules.KitState.None, IrrigationRunRules.Kit(false, now, now));
        Assert.Equal(IrrigationRunRules.KitState.Online, IrrigationRunRules.Kit(true, now.AddMinutes(-4), now));
        Assert.Equal(IrrigationRunRules.KitState.Offline, IrrigationRunRules.Kit(true, now.AddMinutes(-6), now));
        Assert.Equal(IrrigationRunRules.KitState.Offline, IrrigationRunRules.Kit(true, null, now));   // never heard from
        Assert.Equal(IrrigationRunRules.KitState.Online, IrrigationRunRules.Kit(true, now.AddSeconds(5), now));  // clock skew
        Assert.Equal("No kit connected to this zone.", IrrigationRunRules.NoKitMessage);
        Assert.StartsWith(IrrigationRunRules.NoKitMessage[..^1], IrrigationRunRules.KitOfflineMessage);
    }

    private static string Root()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir != null && !Directory.Exists(Path.Combine(dir.FullName, "hardware"))) dir = dir.Parent;
        return dir!.FullName;
    }

    private static string Sketch() =>
        File.ReadAllText(Path.Combine(Root(), "hardware", "esp32", "AgroFlowIrrigationNode", "AgroFlowIrrigationNode.ino"));
}
