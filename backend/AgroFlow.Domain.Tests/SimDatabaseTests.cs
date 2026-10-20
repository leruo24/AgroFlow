using System;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using AgroFlow.Api.Services;
using AgroFlow.Api.Services.Notifications;
using AgroFlow.Business;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Npgsql;
using Xunit;

namespace AgroFlow.Domain.Tests;

// The real API against a real Postgres with every migration applied: the kit simulation's
// local database (hardware/sim/run-e2e.mjs sets AGROFLOW_SIM_DB and runs these at the end).
// In a plain `dotnet test` there is no such database, so these report as Skipped, with the
// reason. SAFETY: only a 127.0.0.1 / localhost connection string is ever used.
public sealed class SimDbHost : ApiHost
{
    public static string? ConnectionString
    {
        get
        {
            var cs = Environment.GetEnvironmentVariable("AGROFLOW_SIM_DB");
            return cs is not null && (cs.Contains("Host=127.0.0.1") || cs.Contains("Host=localhost")) ? cs : null;
        }
    }

    protected override void ConfigureDatabase(IServiceCollection services)
    {
        if (ConnectionString is not { } cs) return;
        services.RemoveAll<NpgsqlDataSource>();
        services.AddSingleton(NpgsqlDataSource.Create(cs));
        // These hold a connection string of their own (DB/XDB/Controller pattern).
        services.RemoveAll<AgroFlow.Business.Fao56EngineController>();
        services.AddSingleton(new AgroFlow.Business.Fao56EngineController(cs));
        services.RemoveAll<AgroFlow.Business.TankPhController>();
        services.AddSingleton(new AgroFlow.Business.TankPhController(cs));
        services.RemoveAll<AgroFlow.Business.SimulationController>();
        services.AddSingleton(new AgroFlow.Business.SimulationController(cs));
    }
}

public sealed class SimDbFactAttribute : FactAttribute
{
    public SimDbFactAttribute()
    {
        if (SimDbHost.ConnectionString is null)
            Skip = "Needs the kit simulation's local Postgres: run hardware/sim/run-e2e.mjs, which runs these at the end.";
    }
}

public class SimDatabaseTests : IClassFixture<SimDbHost>
{
    private readonly SimDbHost _host;
    public SimDatabaseTests(SimDbHost host) => _host = host;

    private static readonly Guid Farmer = ApiHost.Farmer;
    private static readonly Guid OtherFarmer = Guid.Parse("00000000-0000-4000-8000-0000000000fb");
    private static readonly Guid Officer = Guid.Parse("00000000-0000-4000-8000-0000000000f1");
    private const string OnlineToken = "sim-db-online-kit-token-0000000000000000001";
    private const string OnlineDevice = "SIMDBONLINE1";

    private sealed record Seeded(long FarmId, long OnlineZone, long NoKitZone, long OfflineZone);
    private static Seeded? _seeded;
    private static readonly SemaphoreSlim Gate = new(1, 1);

    private static async Task<NpgsqlConnection> OpenAsync()
    {
        var c = new NpgsqlConnection(SimDbHost.ConnectionString);
        await c.OpenAsync();
        return c;
    }

    private static async Task<object?> ScalarAsync(string sql, params object[] args)
    {
        await using var c = await OpenAsync();
        await using var cmd = new NpgsqlCommand(sql, c);
        foreach (var a in args) cmd.Parameters.AddWithValue(a);
        return await cmd.ExecuteScalarAsync();
    }

    private static async Task<Seeded> SeedAsync()
    {
        await Gate.WaitAsync();
        try
        {
            if (_seeded is not null) return _seeded;
            await using var c = await OpenAsync();
            async Task<object?> Q(string sql, params object[] args)
            {
                await using var cmd = new NpgsqlCommand(sql, c);
                foreach (var a in args) cmd.Parameters.AddWithValue(a);
                return await cmd.ExecuteScalarAsync();
            }
            foreach (var (id, email, role, name) in new[]
            {
                (Farmer, "dbfarmer@example.org", "farm_user", "Db Farmer"),
                (OtherFarmer, "other@example.org", "farm_user", "Other Farmer"),
                (ApiHost.Admin, "dbadmin@agroflow.test", "admin", "Db Admin"),
                // A second staff account. (profile_role_check allows only admin and farm_user today,
                // so a field officer cannot be stored yet; StaffRoles covers both.)
                (Officer, "officer@agroflow.test", "admin", "Second Admin"),
            })
            {
                await Q("insert into auth.users (id, email) values ($1, $2) on conflict do nothing", id, email);
                await Q("insert into profile (id, name, email, role) values ($1, $4, $2, $3) on conflict (id) do update set role = $3, name = $4", id, email, role, name);
            }
            // The second admin still has an old Telegram chat (before the cleanup runs).
            await Q("update profile set telegram_chat_id = 777000111 where id = $1", Officer);

            var farmId = (long)(await Q("insert into farm (owner_id, name, location) values ($1, 'Db Farm', 'Nowhere') returning farm_id", Farmer))!;
            async Task<long> Zone(string name, int max) => (long)(await Q(
                "insert into zone (farm_id, name, crop_type, irrigation_mode, max_run_minutes, flow_rate_lpm) values ($1, $2, 'spinach', 'manual', $3, 1.5) returning id",
                farmId, name, max))!;
            var online = await Zone("Online bed", 3);
            var noKit = await Zone("No kit bed", 5);
            var offline = await Zone("Offline bed", 5);
            await Q("insert into hardware (device_name, device_type, zone_id, enrollment_status, device_id, device_token_hash, last_seen) " +
                    "values ('Online kit', 'ESP32', $1, 'active', $2, $3, now())", online, OnlineDevice, DeviceToken.Hash(OnlineToken));
            await Q("insert into hardware (device_name, device_type, zone_id, enrollment_status, device_id, last_seen) " +
                    "values ('Quiet kit', 'ESP32', $1, 'active', 'SIMDBQUIET01', now() - interval '1 hour')", offline);
            return _seeded = new Seeded(farmId, online, noKit, offline);
        }
        finally { Gate.Release(); }
    }

    private HttpRequestMessage As(Guid who, HttpMethod method, string path, object? body = null)
    {
        var r = new HttpRequestMessage(method, path);
        r.Headers.Add(ApiHost.TestAuth.Header, who.ToString());
        if (body is not null) r.Content = new StringContent(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json");
        return r;
    }

    private static async Task<JsonElement> Json(HttpResponseMessage res) =>
        JsonDocument.Parse(await res.Content.ReadAsStringAsync()).RootElement;

    [SimDbFact]
    public async Task A_zone_with_no_kit_is_refused_at_once_and_nothing_is_queued()
    {
        var s = await SeedAsync();
        var client = _host.CreateClient();
        var res = await client.SendAsync(As(Farmer, HttpMethod.Post, $"/api/farmer/zones/{s.NoKitZone}/commands", new { command = "start", durationSeconds = 60 }));
        Assert.Equal(HttpStatusCode.Conflict, res.StatusCode);
        var body = await Json(res);
        Assert.Equal("No kit connected to this zone.", body.GetProperty("error").GetString());
        Assert.Equal("no_kit", body.GetProperty("reason").GetString());
        Assert.Equal(0L, await ScalarAsync("select count(*) from irrigation_commands where zone_id = $1", s.NoKitZone));
    }

    [SimDbFact]
    public async Task A_kit_not_heard_from_in_5_minutes_is_refused_too()
    {
        var s = await SeedAsync();
        var res = await _host.CreateClient().SendAsync(As(Farmer, HttpMethod.Post, $"/api/farmer/zones/{s.OfflineZone}/commands", new { command = "start", durationSeconds = 60 }));
        Assert.Equal(HttpStatusCode.Conflict, res.StatusCode);
        Assert.Equal("kit_offline", (await Json(res)).GetProperty("reason").GetString());
    }

    [SimDbFact]
    public async Task A_run_above_the_zones_maximum_is_refused_and_one_at_it_is_accepted()
    {
        var s = await SeedAsync();
        var client = _host.CreateClient();
        var over = await client.SendAsync(As(Farmer, HttpMethod.Post, $"/api/farmer/zones/{s.OnlineZone}/commands", new { command = "start", durationSeconds = 240 }));
        Assert.Equal(HttpStatusCode.BadRequest, over.StatusCode);
        var body = await Json(over);
        Assert.StartsWith("This zone's pump is limited to 3 min per run.", body.GetProperty("error").GetString());
        Assert.Equal(3, body.GetProperty("maxRunMinutes").GetInt32());

        var at = await client.SendAsync(As(Farmer, HttpMethod.Post, $"/api/farmer/zones/{s.OnlineZone}/commands", new { command = "start", durationSeconds = 180 }));
        Assert.Equal(HttpStatusCode.Accepted, at.StatusCode);
        // Not the farmer's farm: no such zone.
        var other = await client.SendAsync(As(OtherFarmer, HttpMethod.Post, $"/api/farmer/zones/{s.OnlineZone}/commands", new { command = "start", durationSeconds = 60 }));
        Assert.Equal(HttpStatusCode.NotFound, other.StatusCode);
    }

    [SimDbFact]
    public async Task Irrigate_reads_sent_then_started_on_the_ack_then_finished_on_the_run_report()
    {
        var s = await SeedAsync();
        var client = _host.CreateClient();
        var start = await client.SendAsync(As(Farmer, HttpMethod.Post, $"/api/farmer/zones/{s.OnlineZone}/commands", new { command = "start", durationSeconds = 60 }));
        Assert.Equal(HttpStatusCode.Accepted, start.StatusCode);
        var id = (await Json(start)).GetProperty("id").GetGuid();

        async Task<JsonElement> Status() => await Json(await client.SendAsync(As(Farmer, HttpMethod.Get, $"/api/farmer/commands/{id}")));
        var sent = await Status();
        Assert.Equal("sent", sent.GetProperty("state").GetString());
        Assert.Equal("Sending…", sent.GetProperty("label").GetString());
        Assert.Equal(HttpStatusCode.NotFound, (await client.SendAsync(As(OtherFarmer, HttpMethod.Get, $"/api/farmer/commands/{id}"))).StatusCode);

        // The kit's ACK, through the real device route.
        var executedAt = DateTimeOffset.UtcNow;
        var ack = new HttpRequestMessage(HttpMethod.Post, $"/api/devices/commands/{id}/executed")
        {
            Content = new StringContent(JsonSerializer.Serialize(new { deviceId = OnlineDevice, executedAt }), Encoding.UTF8, "application/json"),
        };
        ack.Headers.Add("X-Device-Token", OnlineToken);
        Assert.Equal(HttpStatusCode.OK, (await client.SendAsync(ack)).StatusCode);
        var started = await Status();
        Assert.Equal("started", started.GetProperty("state").GetString());
        Assert.Equal("Kit started watering", started.GetProperty("label").GetString());

        // The kit's report of the finished run.
        var run = new HttpRequestMessage(HttpMethod.Post, "/api/irrigation-events")
        {
            Content = new StringContent(JsonSerializer.Serialize(new { zoneId = s.OnlineZone, runtimeSeconds = 60, triggerSource = "manual", syncStatus = "synced", startedAt = executedAt }), Encoding.UTF8, "application/json"),
        };
        run.Headers.Add("X-Device-Token", OnlineToken);
        Assert.Equal(HttpStatusCode.OK, (await client.SendAsync(run)).StatusCode);
        var finished = await Status();
        Assert.Equal("finished", finished.GetProperty("state").GetString());
        Assert.Equal("Finished", finished.GetProperty("label").GetString());
        Assert.Equal(JsonValueKind.String, finished.GetProperty("finishedAt").ValueKind);

        // History: the event names its command, and the zone's command list says finished.
        Assert.Equal(id, await ScalarAsync("select command_id from irrigation_event where zone_id = $1 and command_id is not null", s.OnlineZone));
        var list = await Json(await client.SendAsync(As(Farmer, HttpMethod.Get, $"/api/farmer/zones/{s.OnlineZone}/commands")));
        Assert.Contains(list.EnumerateArray(), c => c.GetProperty("id").GetGuid() == id && c.GetProperty("state").GetString() == "finished");
    }

    [SimDbFact]
    public async Task Staff_set_a_zones_maximum_in_range_and_farmers_cannot()
    {
        var s = await SeedAsync();
        var client = _host.CreateClient();
        Assert.Equal(5, await ScalarAsync("select max_run_minutes from zone where id = $1", s.NoKitZone));   // the default
        Assert.Equal(HttpStatusCode.Forbidden, (await client.SendAsync(As(Farmer, HttpMethod.Put, $"/api/admin/zones/{s.NoKitZone}/max-run", new { maxRunMinutes = 60 }))).StatusCode);
        var ok = await client.SendAsync(As(ApiHost.Admin, HttpMethod.Put, $"/api/admin/zones/{s.NoKitZone}/max-run", new { maxRunMinutes = 45 }));
        Assert.Equal(HttpStatusCode.OK, ok.StatusCode);
        Assert.Equal(45, await ScalarAsync("select max_run_minutes from zone where id = $1", s.NoKitZone));
        Assert.Equal(1L, await ScalarAsync("select count(*) from admin_audit_log where action = 'zone.max_run_changed' and entity_id = $1", s.NoKitZone.ToString()));
        // The database refuses out-of-range values too (0052's check).
        await Assert.ThrowsAsync<PostgresException>(() => ScalarAsync("update zone set max_run_minutes = 121 where id = $1", s.NoKitZone));
        await Assert.ThrowsAsync<PostgresException>(() => ScalarAsync("update zone set max_run_minutes = 0 where id = $1", s.NoKitZone));
    }

    [SimDbFact]
    public async Task A_link_code_for_staff_links_nothing_and_already_linked_staff_are_unlinked_and_audited()
    {
        await SeedAsync();
        using var scope = _host.Services.CreateScope();
        var sp = scope.ServiceProvider;

        await ScalarAsync("insert into telegram_onboarding_code (code, profile_id, expires_at, purpose) values ('STAFFCODE1', $1, now() + interval '1 hour', 'link')", Officer);
        var onboarding = sp.GetRequiredService<TelegramOnboardingService>();
        await Assert.ThrowsAsync<StaffTelegramRefusedException>(() => onboarding.RedeemCodeAsync("STAFFCODE1", 888000222, CancellationToken.None));
        Assert.Equal(DBNull.Value, await ScalarAsync("select used_at from telegram_onboarding_code where code = 'STAFFCODE1'") ?? DBNull.Value);

        var cleanup = sp.GetRequiredService<StaffTelegramCleanupService>();
        var first = await cleanup.UnlinkStaffAsync(CancellationToken.None);
        Assert.Contains(first, u => u.Id == Officer && u.Email == "officer@agroflow.test");
        Assert.Equal(DBNull.Value, await ScalarAsync("select telegram_chat_id from profile where id = $1", Officer) ?? DBNull.Value);
        Assert.True((long)(await ScalarAsync("select count(*) from admin_audit_log where action = 'telegram.staff_unlinked' and entity_id = $1", Officer.ToString()))! >= 1);
        Assert.Empty(await cleanup.UnlinkStaffAsync(CancellationToken.None));   // once only
    }

    [SimDbFact]
    public async Task A_staff_account_cannot_be_given_a_temporary_password()
    {
        await SeedAsync();
        var res = await _host.CreateClient().SendAsync(As(ApiHost.Admin, HttpMethod.Post, $"/api/admin/farmers/{Officer}/reset-password"));
        Assert.Equal(HttpStatusCode.Conflict, res.StatusCode);
        Assert.Contains("Staff reset their own password", await res.Content.ReadAsStringAsync());
    }

    [SimDbFact]
    public async Task A_frost_warning_is_saved_in_the_app_once_for_a_farm_without_Telegram()
    {
        var s = await SeedAsync();
        var tomorrow = DateOnly.FromDateTime(DateTime.UtcNow.AddHours(2)).AddDays(1);
        await ScalarAsync("insert into weather_daily (farm_id, date, tmin_c, tmax_c, precipitation_mm, is_forecast) values ($1, $2, -1.5, 14, 0, true)", s.FarmId, tomorrow);

        var sweep = ActivatorUtilities.CreateInstance<WeatherAlertService>(_host.Services);
        await sweep.SweepAsync(CancellationToken.None);
        await sweep.SweepAsync(CancellationToken.None);   // the forecast refreshes: still one

        await using var c = await OpenAsync();
        await using var cmd = new NpgsqlCommand("select message, zone_id is null, severity from alert where farm_id = $1 and message like 'Frost expected on %'", c);
        cmd.Parameters.AddWithValue(s.FarmId);
        await using var r = await cmd.ExecuteReaderAsync();
        Assert.True(await r.ReadAsync());
        Assert.Contains("Expected low: -1.5 C.", r.GetString(0));
        Assert.True(r.GetBoolean(1));          // farm-wide
        Assert.Equal("Warning", r.GetString(2));
        Assert.False(await r.ReadAsync());     // once
    }
}
