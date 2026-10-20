using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using AgroFlow.Api.Endpoints;
using AgroFlow.Api.Services;
using AgroFlow.Api.Services.Notifications;
using AgroFlow.Business;
using AgroFlow.Business.Agronomy.RuleBook;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Npgsql;
using Xunit;

namespace AgroFlow.Domain.Tests;

// The verification follow-ups (docs/drought-community.md): fire directions as words or as the
// compass codes older app builds send; staff never get a Telegram message for drought or
// community alerts; Today's Why says how the zone is watered; and the drought demo only runs
// for a Simulated farm with the drought scenario while Simulation:Enabled is on.
// [Fact]s run in every `dotnet test`; [SimDbFact]s run in hardware/sim/run-e2e.mjs.
public class DroughtCommunityFixTests : IClassFixture<SimDbHost>
{
    private readonly SimDbHost _host;
    public DroughtCommunityFixTests(SimDbHost host) => _host = host;

    // ---- Rules, no database -----------------------------------------------------------------

    [Theory]
    [InlineData("north-east", "north-east")]
    [InlineData("NE", "north-east")]
    [InlineData("ne", "north-east")]
    [InlineData("N", "north")]
    [InlineData("SW", "south-west")]
    [InlineData("North West", "north-west")]
    [InlineData("west", "west")]
    [InlineData("NNE", null)]
    [InlineData("upwards", null)]
    [InlineData("", null)]
    public void Fire_directions_accept_the_words_and_the_compass_codes(string sent, string? saved) =>
        Assert.Equal(saved, CommunityRules.NormaliseDirection(sent));

    [Fact]
    public void The_direction_words_are_the_ones_the_database_allows()
    {
        Assert.Equal(new[] { "north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west" }, CommunityRules.Directions);
        Assert.Equal("north-east", CommunityRules.Compass(45));
    }

    [Theory]
    [InlineData(true, "drought", true, true)]
    [InlineData(true, "drought", false, false)]    // Simulation off
    [InlineData(true, null, true, false)]          // no scenario
    [InlineData(true, "normal", true, false)]      // another scenario
    [InlineData(false, "drought", true, false)]    // a real farm never gets demo values
    [InlineData(false, null, false, false)]
    public void The_drought_demo_needs_a_simulated_farm_the_drought_scenario_and_simulation_on(bool simulated, string? scenario, bool enabled, bool applies) =>
        Assert.Equal(applies, DroughtEvaluator.DemoApplies(simulated, scenario, enabled));

    [Fact]
    public void Todays_why_says_how_the_zone_is_watered_on_a_water_card()
    {
        var why = new Explanation { Summary = "Water today" };
        TodayEndpoints.AddIrrigationFact(why, "water", "drip");
        var fact = Assert.Single(why.Facts);
        Assert.Equal("How the zone is watered", fact.Label);
        Assert.Contains("90%", fact.Value);
        Assert.Equal("FAO irrigation guidance", fact.Source);

        var furrow = new Explanation();
        TodayEndpoints.AddIrrigationFact(furrow, "water", "surface");
        Assert.Contains("60%", Assert.Single(furrow.Facts).Value);
    }

    [Theory]
    [InlineData("skip", "drip")]     // not a water card
    [InlineData("water", "hand")]    // no published efficiency
    [InlineData("water", null)]      // type not set
    public void Todays_why_has_no_watering_fact_otherwise(string kind, string? type)
    {
        var why = new Explanation();
        TodayEndpoints.AddIrrigationFact(why, kind, type);
        Assert.Empty(why.Facts);
        TodayEndpoints.AddIrrigationFact(null, kind, type);   // no Why at all: nothing happens
    }

    // ---- Through the database ---------------------------------------------------------------

    private static readonly Guid F1 = Guid.Parse("00000000-0000-4000-8000-0000000000d1");   // reports a fire
    private static readonly Guid F2 = Guid.Parse("00000000-0000-4000-8000-0000000000d2");   // farmer with Telegram
    private static readonly Guid F3 = Guid.Parse("00000000-0000-4000-8000-0000000000d3");   // owns the demo farms
    private static readonly Guid St = Guid.Parse("00000000-0000-4000-8000-0000000000d9");   // staff with an old Telegram chat

    private static async Task<object?> Q(string sql, params object[] args)
    {
        await using var c = new NpgsqlConnection(SimDbHost.ConnectionString);
        await c.OpenAsync();
        await using var cmd = new NpgsqlCommand(sql, c);
        foreach (var a in args) cmd.Parameters.AddWithValue(a);
        return await cmd.ExecuteScalarAsync();
    }

    private static async Task Person(Guid id, string email, string role, long? chat)
    {
        await Q("insert into auth.users (id, email) values ($1, $2) on conflict do nothing", id, email);
        await Q("insert into profile (id, name, email, role) values ($1, $2, $2, $3) on conflict (id) do update set role = $3", id, email, role);
        if (chat is { } c) await Q("update profile set telegram_chat_id = $2, telegram_alerts_enabled = true where id = $1", id, c);
    }

    private static async Task<long> FarmFor(Guid owner, string name, bool simulated, string? scenario)
    {
        await Q("delete from farm where name = $1", name);
        var id = (long)(await Q(
            "insert into farm (owner_id, name, location, latitude, longitude, water_source, tank_capacity_litres, is_simulated, sim_scenario) " +
            "values ($1, $2, 'Test', -25.86, 25.64, 'tank', 5000, $3, $4) returning farm_id",
            owner, name, simulated, (object?)scenario ?? DBNull.Value))!;
        await Q("insert into tank_refill (farm_id, litres_added, refilled_at) values ($1, 1000, now())", id);   // 20% full
        return id;
    }

    private sealed class FixedWind : IWindProvider
    {
        public Task<(double FromDeg, double SpeedKmh)?> CurrentAsync(double latitude, double longitude, CancellationToken ct) =>
            Task.FromResult<(double, double)?>((270, 20));
    }

    // No background services (the drought monitor, the simulation), so only the call under test
    // runs; a fixed wind; and Simulation:Enabled as asked.
    private HttpClient Client(bool simulationEnabled = false) => _host.WithWebHostBuilder(b =>
    {
        b.UseSetting("Simulation:Enabled", simulationEnabled ? "true" : "false");
        b.ConfigureTestServices(s =>
        {
            s.RemoveAll<IHostedService>();
            s.RemoveAll<IWindProvider>();
            s.AddSingleton<IWindProvider>(new FixedWind());
        });
    }).CreateClient();

    private static HttpRequestMessage As(Guid who, HttpMethod m, string path, object? body = null)
    {
        var r = new HttpRequestMessage(m, path);
        r.Headers.Add(ApiHost.TestAuth.Header, who.ToString());
        if (body is not null) r.Content = new StringContent(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json");
        return r;
    }

    private static async Task<JsonElement> Json(HttpResponseMessage r)
    {
        var body = await r.Content.ReadAsStringAsync();
        if ((int)r.StatusCode >= 400) throw new Xunit.Sdk.XunitException($"{(int)r.StatusCode}: {body}");
        return JsonDocument.Parse(body.Length == 0 ? "{}" : body).RootElement;
    }

    [SimDbFact]
    public async Task A_fire_update_saves_north_east_whether_the_app_sends_NE_or_north_east()
    {
        await Person(F1, "f1@example.org", "farm_user", null);
        await Q("delete from community_report where reporter_profile_id = $1", F1);
        var farm = await FarmFor(F1, "Fire direction farm", false, null);
        var client = Client();
        var report = await Json(await client.SendAsync(As(F1, HttpMethod.Post, "/api/farmer/community/reports",
            new { farmId = farm, category = "fire", subtype = "veld_fire", severity = "high" })));
        var id = report.GetProperty("id").GetInt64();

        foreach (var sent in new[] { "NE", "north-east" })
            await Json(await client.SendAsync(As(F1, HttpMethod.Post, $"/api/farmer/community/reports/{id}/updates", new { kind = "spreading", direction = sent })));
        var bad = await client.SendAsync(As(F1, HttpMethod.Post, $"/api/farmer/community/reports/{id}/updates", new { kind = "spreading", direction = "NNE" }));
        Assert.Equal(HttpStatusCode.BadRequest, bad.StatusCode);

        var saved = new List<string>();
        await using (var c = new NpgsqlConnection(SimDbHost.ConnectionString))
        {
            await c.OpenAsync();
            await using var cmd = new NpgsqlCommand("select direction from community_report_update where report_id = $1 and kind = 'spreading' order by id", c);
            cmd.Parameters.AddWithValue(id);
            await using var r = await cmd.ExecuteReaderAsync();
            while (await r.ReadAsync()) saved.Add(r.GetString(0));
        }
        Assert.Equal(new[] { "north-east", "north-east" }, saved);
    }

    private sealed class CapturingTelegram : HttpMessageHandler
    {
        public readonly List<string> Bodies = new();
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            var body = request.Content == null ? "" : await request.Content.ReadAsStringAsync(ct);
            lock (Bodies) Bodies.Add(body);
            return new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent("{\"ok\":true,\"result\":{}}") };
        }
    }

    private sealed class Factory : IHttpClientFactory
    {
        private readonly HttpMessageHandler _h;
        public Factory(HttpMessageHandler h) => _h = h;
        public HttpClient CreateClient(string name) => new(_h, disposeHandler: false);
    }

    [SimDbFact]
    public async Task Staff_get_no_Telegram_message_for_drought_or_community_alerts()
    {
        // The farm's farmer and a staff member both have a linked chat; the staff member is also
        // on the farm (an installer added as a member). Only the farmer may be messaged.
        await Person(F2, "f2@example.org", "farm_user", 880011);
        await Person(St, "staff2@agroflow.test", "admin", 880099);
        var farm = await FarmFor(F2, "Telegram check farm", false, null);
        await Q("insert into farm_member (farm_id, profile_id) values ($1, $2) on conflict do nothing", farm, St);

        var handler = new CapturingTelegram();
        var telegram = new TelegramClient(new Factory(handler), Options.Create(new TelegramOptions { BotToken = "test-token" }), NullLogger<TelegramClient>.Instance);
        await using var data = NpgsqlDataSource.Create(SimDbHost.ConnectionString!);
        var messenger = new FarmerMessenger(data, telegram, NullLogger<FarmerMessenger>.Instance);

        foreach (var kind in new[] { FarmerMessenger.Kind.Drought, FarmerMessenger.Kind.Community })
        {
            handler.Bodies.Clear();
            var sent = await messenger.TelegramAsync(farm, kind, $"{kind} test", urgent: true, CancellationToken.None);
            Assert.Equal(1, sent);
            var body = Assert.Single(handler.Bodies);
            Assert.Contains("880011", body);
            Assert.DoesNotContain("880099", body);
        }
        await Q("update profile set telegram_chat_id = null where id = any($1)", new[] { F2, St });
    }

    [SimDbFact]
    public async Task The_drought_demo_runs_only_for_a_simulated_drought_farm_with_simulation_on()
    {
        // 20% full and no weather rows: without the demo there is no dry week to see, so drought
        // mode stays off; with it, the demo dry week turns it on.
        await Person(F3, "f3@example.org", "farm_user", null);
        var demo = await FarmFor(F3, "Demo drought farm", true, "drought");
        var real = await FarmFor(F3, "Real farm, drought scenario", false, "drought");
        var other = await FarmFor(F3, "Demo farm, normal scenario", true, "normal");

        async Task<JsonElement> View(HttpClient c, long farmId) =>
            await Json(await c.SendAsync(As(F3, HttpMethod.Get, $"/api/farmer/farms/{farmId}/drought")));

        var on = Client(simulationEnabled: true);
        var demoOn = await View(on, demo);
        Assert.True(demoOn.GetProperty("active").GetBoolean(), demoOn.ToString());
        Assert.StartsWith("Drought mode on: tank about 20% full", demoOn.GetProperty("reason").GetString());
        Assert.False((await View(on, real)).GetProperty("active").GetBoolean());
        Assert.False((await View(on, other)).GetProperty("active").GetBoolean());

        var off = Client(simulationEnabled: false);
        Assert.False((await View(off, demo)).GetProperty("active").GetBoolean());
    }
}
