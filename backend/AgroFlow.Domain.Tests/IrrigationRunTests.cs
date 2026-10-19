using System;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using AgroFlow.Business;
using Xunit;

namespace AgroFlow.Domain.Tests;

// Release fixes on Water now (docs/irrigate-path.md): the 5-minute cap on the server, and no
// start without a kit that is listening.
public class IrrigationRunTests : IClassFixture<ApiHost>
{
    private readonly ApiHost _host;
    public IrrigationRunTests(ApiHost host) => _host = host;

    [Theory]
    [InlineData("start", 60, null)]
    [InlineData("start", 300, null)]
    [InlineData("stop", null, null)]
    [InlineData("start", 301, IrrigationRunRules.TooLongMessage)]
    [InlineData("start", 3600, IrrigationRunRules.TooLongMessage)]
    [InlineData("start", 0, "Duration must be at least 1 second.")]
    [InlineData("start", null, "A start command requires a duration.")]
    [InlineData("open", 60, "Command must be start or stop.")]
    public void A_manual_run_is_at_most_the_kits_5_minutes(string command, int? seconds, string? problem) =>
        Assert.Equal(problem, IrrigationRunRules.CheckRequest(command, seconds));

    [Fact]
    public void The_cap_is_the_kits_own_safety_cap()
    {
        Assert.Equal(300, IrrigationRunRules.MaxManualRunSeconds);
        // From the sketch's source (never secrets.h).
        Assert.Matches(@"SAFETY_MAX_RUN_MS\s*=\s*5UL \* 60UL \* 1000UL", Sketch());
    }

    private static string Sketch()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir != null && !Directory.Exists(Path.Combine(dir.FullName, "hardware"))) dir = dir.Parent;
        return File.ReadAllText(Path.Combine(dir!.FullName, "hardware", "esp32", "AgroFlowIrrigationNode", "AgroFlowIrrigationNode.ino"));
    }

    [Fact]
    public async Task The_API_refuses_a_run_over_300_seconds_with_the_reason()
    {
        var client = _host.CreateClient();
        var request = new HttpRequestMessage(HttpMethod.Post, "/api/farmer/zones/7/commands")
        {
            Content = new StringContent(JsonSerializer.Serialize(new { command = "start", durationSeconds = 600 }), Encoding.UTF8, "application/json"),
        };
        request.Headers.Add(ApiHost.TestAuth.Header, ApiHost.Farmer.ToString());
        var res = await client.SendAsync(request);
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
        Assert.Contains("at most 5 minutes (300 seconds)", await res.Content.ReadAsStringAsync());
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
}
