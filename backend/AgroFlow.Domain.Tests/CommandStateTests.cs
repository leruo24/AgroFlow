using System;
using System.IO;
using System.Net;
using System.Threading.Tasks;
using AgroFlow.Business;
using Xunit;

namespace AgroFlow.Domain.Tests;

// "Executed" (the kit started the run) and "finished" (the kit reported the run) are two
// different states (migration 0051, docs/irrigate-path.md).
public class CommandStateTests : IClassFixture<ApiHost>
{
    private readonly ApiHost _host;
    public CommandStateTests(ApiHost host) => _host = host;

    private static readonly DateTimeOffset Now = DateTimeOffset.Parse("2026-10-19T08:00:00Z");

    [Fact]
    public void Executed_reads_as_started_never_as_finished()
    {
        Assert.Equal(CommandState.Started, CommandState.Describe("executed", Now.AddMinutes(-1), null, Now));
        Assert.Equal("Kit started watering", CommandState.Label(CommandState.Started));
        Assert.Equal(CommandState.Finished, CommandState.Describe("executed", Now.AddMinutes(-3), Now, Now));
        Assert.Equal("Finished", CommandState.Label(CommandState.Finished));
    }

    [Fact]
    public void A_command_the_kit_has_not_acknowledged_is_sending_then_no_response_after_60_seconds()
    {
        Assert.Equal(CommandState.Sent, CommandState.Describe("pending", Now.AddSeconds(-59), null, Now));
        Assert.Equal("Sending…", CommandState.Label(CommandState.Sent));
        Assert.Equal(CommandState.NoResponse, CommandState.Describe("pending", Now.AddSeconds(-61), null, Now));
        Assert.Equal("Kit didn't respond — check it's online", CommandState.Label(CommandState.NoResponse));
        Assert.Equal(CommandState.Failed, CommandState.Describe("failed", Now.AddHours(-3), null, Now));
        Assert.Equal(TimeSpan.FromSeconds(60), CommandState.AckWait);
    }

    [Fact]
    public void A_reported_run_matches_the_command_started_at_its_start_time()
    {
        var started = Now.AddMinutes(-1);
        Assert.True(RunCompletion.Matches(started, started.AddSeconds(3), 60, Now));          // clocks a little apart
        Assert.True(RunCompletion.Matches(started, started.AddMinutes(-2), 60, Now));         // the margin
        Assert.False(RunCompletion.Matches(started, started.AddMinutes(-3), 60, Now));        // another run
        Assert.False(RunCompletion.Matches(Now.AddHours(-2), Now.AddMinutes(-1), 60, Now));    // an old command
    }

    [Fact]
    public void A_run_with_no_start_time_matches_a_command_started_within_its_length_plus_2_minutes()
    {
        Assert.True(RunCompletion.Matches(Now.AddSeconds(-61), null, 60, Now));
        Assert.True(RunCompletion.Matches(Now.AddMinutes(-3), null, 60, Now));
        Assert.False(RunCompletion.Matches(Now.AddMinutes(-4), null, 60, Now));
    }

    [Fact]
    public void Migration_0051_adds_finished_at_and_keeps_the_status_values_the_cooldown_reads()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir != null && !Directory.Exists(Path.Combine(dir.FullName, "supabase"))) dir = dir.Parent;
        var sql = File.ReadAllText(Path.Combine(dir!.FullName, "supabase", "migrations", "0051_command_finished.sql"));
        Assert.Contains("add column if not exists finished_at timestamptz", sql);
        Assert.Contains("add column if not exists command_id uuid references irrigation_commands (id) on delete set null", sql);
        Assert.DoesNotContain("irrigation_commands_status_check", sql);   // status values unchanged
    }

    [Fact]
    public async Task The_status_routes_need_a_signed_in_farmer()
    {
        var client = _host.CreateClient();
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync($"/api/farmer/commands/{Guid.NewGuid()}")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/farmer/zones/7/commands")).StatusCode);
    }
}
