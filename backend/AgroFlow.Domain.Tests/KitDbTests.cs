using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using AgroFlow.Api.Services.Notifications;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Npgsql;
using Xunit;

namespace AgroFlow.Domain.Tests;

// The kit setup info and Kit tab (fix/kit-setup-info) against the migration replay (0001-0061):
// the Telegram message when a kit is claimed, and the farmer's GET /api/farmer/farms/{id}/kits.
public class KitClaimHost : SimDbHost
{
    public sealed class RecordingNotifications : INotificationService
    {
        public readonly ConcurrentQueue<(long ZoneId, string DeviceId)> KitConnected = new();
        public Task NotifyKitConnectedAsync(long zoneId, string deviceId, CancellationToken ct)
        {
            KitConnected.Enqueue((zoneId, deviceId));
            return Task.CompletedTask;
        }
        public Task NotifyFarmerWelcomeAsync(Guid profileId, FarmerWelcomeNotification notification, CancellationToken ct) => Task.CompletedTask;
        public Task NotifyPasswordResetAsync(Guid profileId, string temporaryPassword, CancellationToken ct) => Task.CompletedTask;
        public Task NotifyZoneCriticalAsync(long zoneId, float moisture, ZoneCriticalReason reason, CancellationToken ct) => Task.CompletedTask;
        public Task NotifyWeatherAsync(long farmId, WeatherAlertNotification notification, CancellationToken ct) => Task.CompletedTask;
        public Task NotifySystemFailureAsync(long farmId, SystemFailureNotification notification, CancellationToken ct) => Task.CompletedTask;
        public Task NotifyTankLowAsync(long farmId, CancellationToken ct) => Task.CompletedTask;
        public Task NotifyRequestStatusAsync(Guid profileId, RequestStatusNotification notification, CancellationToken ct) => Task.CompletedTask;
        public Task NotifyFarmRequestAsync(Guid profileId, FarmRequestNotification notification, CancellationToken ct) => Task.CompletedTask;
        public Task NotifyAdminsOfFarmRequestAsync(FarmRequestAdminNotification notification, CancellationToken ct) => Task.CompletedTask;
    }

    public RecordingNotifications Notifications { get; } = new();

    // The claim hands out the API's own MQTT login (test values here).
    protected override void ConfigureWebHost(Microsoft.AspNetCore.Hosting.IWebHostBuilder builder)
    {
        base.ConfigureWebHost(builder);
        builder.UseSetting("Mqtt:Username", "kit-test-user");
        builder.UseSetting("Mqtt:Password", "kit-test-password");
    }

    protected override void ConfigureDatabase(IServiceCollection services)
    {
        base.ConfigureDatabase(services);
        services.RemoveAll<INotificationService>();
        services.AddSingleton<INotificationService>(Notifications);
    }
}

public class KitDbTests : IClassFixture<KitClaimHost>
{
    private readonly KitClaimHost _host;
    public KitDbTests(KitClaimHost host) => _host = host;

    private static readonly Guid Owner = Guid.Parse("00000000-0000-4000-8000-00000000c101");
    private static readonly Guid Muted = Guid.Parse("00000000-0000-4000-8000-00000000c102");
    private static readonly Guid Staff = Guid.Parse("00000000-0000-4000-8000-00000000c103");
    private static readonly Guid Unlinked = Guid.Parse("00000000-0000-4000-8000-00000000c104");
    private static readonly Guid Stranger = Guid.Parse("00000000-0000-4000-8000-00000000c105");

    private static async Task<object?> Q(string sql, params object[] args)
    {
        await using var c = new NpgsqlConnection(SimDbHost.ConnectionString);
        await c.OpenAsync();
        await using var cmd = new NpgsqlCommand(sql, c);
        foreach (var a in args) cmd.Parameters.AddWithValue(a);
        return await cmd.ExecuteScalarAsync();
    }

    private static readonly SemaphoreSlim Gate = new(1, 1);
    private static (long FarmId, long KitZone, long EmptyZone)? _seeded;

    // One farm: an opted-in owner (Afrikaans), a member who turned Telegram alerts off, a staff
    // member on the farm, and a member who never linked Telegram. Two zones: one with a kit.
    private static async Task<(long FarmId, long KitZone, long EmptyZone)> SeedAsync()
    {
        await Gate.WaitAsync();
        try
        {
            if (_seeded is { } s) return s;
            foreach (var (id, role, chat, alerts, lang) in new (Guid, string, long?, bool, string)[]
            {
                (Owner, "farm_user", 9001, true, "af"),
                (Muted, "farm_user", 9002, false, "en"),
                (Staff, "admin", 9003, true, "en"),
                (Unlinked, "farm_user", null, true, "en"),
                (Stranger, "farm_user", 9005, true, "en"),
            })
            {
                await Q("insert into auth.users (id, email) values ($1, $2) on conflict do nothing", id, $"{id}@kit.test");
                await Q("insert into profile (id, name, email, role, telegram_alerts_enabled, language) values ($1, 'Kit person', $2, $3, $4, $5) " +
                        "on conflict (id) do update set role = $3, telegram_alerts_enabled = $4, language = $5", id, $"{id}@kit.test", role, alerts, lang);
                await Q(chat is null ? "update profile set telegram_chat_id = null where id = $1" : $"update profile set telegram_chat_id = {chat} where id = $1", id);
            }
            var farmId = (long)(await Q("insert into farm (owner_id, name, location) values ($1, 'Kit Farm', 'Nowhere') returning farm_id", Owner))!;
            foreach (var member in new[] { Muted, Staff, Unlinked })
                await Q("insert into farm_member (farm_id, profile_id) values ($1, $2) on conflict do nothing", farmId, member);
            var kitZone = (long)(await Q("insert into zone (farm_id, name, crop_type, irrigation_mode, max_run_minutes) values ($1, 'Tunnel 1', 'spinach', 'manual', 7) returning id", farmId))!;
            var emptyZone = (long)(await Q("insert into zone (farm_id, name, crop_type, irrigation_mode) values ($1, 'Tunnel 2', 'spinach', 'manual') returning id", farmId))!;
            return (_seeded = (farmId, kitZone, emptyZone)).Value;
        }
        finally { Gate.Release(); }
    }

    private sealed class RecordingHandler : HttpMessageHandler
    {
        public readonly List<JsonElement> Sent = new();
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            if (request.RequestUri!.AbsolutePath.EndsWith("/sendMessage"))
            {
                var body = JsonDocument.Parse(await request.Content!.ReadAsStringAsync(ct)).RootElement.Clone();
                lock (Sent) Sent.Add(body);
            }
            return new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent("{\"ok\":true}", Encoding.UTF8, "application/json") };
        }
    }

    private sealed class Factory(HttpMessageHandler handler) : IHttpClientFactory
    {
        public HttpClient CreateClient(string name) => new(handler, disposeHandler: false);
    }

    [SimDbFact]
    public async Task A_claimed_kit_tells_only_the_zones_opted_in_farmers_in_their_language_and_never_the_enrollment_code()
    {
        var s = await SeedAsync();
        var handler = new RecordingHandler();
        var telegram = new TelegramNotificationService(
            new TelegramClient(new Factory(handler), Options.Create(new TelegramOptions { BotToken = "123:test" }), NullLogger<TelegramClient>.Instance),
            _host.Services.GetRequiredService<NpgsqlDataSource>(),
            Options.Create(new ApkOptions()),
            _host.Services.GetRequiredService<IExplanationStore>(),
            Options.Create(new WeatherAlertOptions()),
            Options.Create(new DeviceMonitorOptions()),
            NullLogger<TelegramNotificationService>.Instance);

        await telegram.NotifyKitConnectedAsync(s.KitZone, "0123456789AB", CancellationToken.None);

        // Only the owner: the muted member, the staff member and the unlinked member get nothing.
        var only = Assert.Single(handler.Sent);
        Assert.Equal(9001, only.GetProperty("chat_id").GetInt64());
        var text = only.GetProperty("text").GetString()!;
        Assert.Equal("Jou AgroFlow-stel vir Tunnel 1 is gekoppel. As jy ooit jou Wi-Fi verander, is sy opstelnetwerk AgroFlow-Setup-89AB, " +
                     "wagwoord AF-6789AB. Maak die toepassing oop → Stel vir die stappe.", text);
        Assert.DoesNotMatch("[A-HJ-NP-Z2-9]{8}", text.Replace("AgroFlow", ""));   // nothing shaped like an enrollment code
    }

    // Since kit linking (October 2026) the farmer hears when the installer has commissioned the
    // zone ("Your kit in <zone> is working"), not at the claim; and the same kit retrying the same
    // code is answered again, while another kit is refused.
    [SimDbFact]
    public async Task The_claim_sends_no_kit_message_and_a_retry_by_the_same_kit_is_answered_again()
    {
        var s = await SeedAsync();
        await Q("insert into hardware (device_name, device_type, zone_id, enrollment_status, enrollment_code, enrollment_code_expires_at) " +
                "values ('Tunnel kit', 'ESP32', $1, 'enrolled', 'KITCODE9', now() + interval '1 hour')", s.KitZone);
        var client = _host.CreateClient();
        async Task<HttpStatusCode> Claim() => (await client.PostAsync("/api/devices/claim", new StringContent(
            JsonSerializer.Serialize(new { deviceId = "0123456789AB", enrollmentCode = "KITCODE9", firmwareVersion = "1.7.1" }),
            Encoding.UTF8, "application/json"))).StatusCode;

        var before = _host.Notifications.KitConnected.Count;
        Assert.Equal(HttpStatusCode.OK, await Claim());
        Assert.Equal(HttpStatusCode.OK, await Claim());   // the same kit, the same code: a retry
        var other = await client.PostAsync("/api/devices/claim", new StringContent(
            JsonSerializer.Serialize(new { deviceId = "BA9876543210", enrollmentCode = "KITCODE9" }), Encoding.UTF8, "application/json"));
        Assert.Equal(HttpStatusCode.Conflict, other.StatusCode);   // another kit: the code is used
        Assert.Empty(_host.Notifications.KitConnected.Skip(before));
    }

    [SimDbFact]
    public async Task The_Kit_tab_gives_one_card_per_zone_from_real_data_and_only_to_the_farms_people()
    {
        var s = await SeedAsync();
        // The kit (from the claim test, or made here if that one has not run yet), online with a
        // strong signal, a working probe, fresh readings and a confirmed pump command.
        await Q("insert into hardware (device_name, device_type, zone_id, enrollment_status, device_id, last_seen) " +
                "select 'Tunnel kit', 'ESP32', $1, 'active', '0123456789AB', now() where not exists " +
                "(select 1 from hardware where zone_id = $1 and enrollment_status = 'active')", s.KitZone);
        await Q("update hardware set last_seen = now(), firmware_version = '1.7.1', wifi_rssi = -55, soil_probe_ok = true, " +
                "kit_report_at = now(), offline_backlog = 0 where zone_id = $1 and enrollment_status = 'active'", s.KitZone);
        foreach (var type in new[] { "SoilMoisture", "Temperature", "Humidity" })
            await Q("insert into sensor_reading (zone_id, sensor_type, value) values ($1, $2, 40)", s.KitZone, type);
        await Q("insert into irrigation_commands (zone_id, command, source, duration_seconds, status, executed_at) " +
                "values ($1, 'start', 'manual', 60, 'executed', now())", s.KitZone);

        var request = new HttpRequestMessage(HttpMethod.Get, $"/api/farmer/farms/{s.FarmId}/kits");
        request.Headers.Add(ApiHost.TestAuth.Header, Owner.ToString());
        var response = await _host.CreateClient().SendAsync(request);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var cards = JsonDocument.Parse(await response.Content.ReadAsStringAsync()).RootElement.EnumerateArray().ToList();
        Assert.Equal(2, cards.Count);

        var kit = cards.Single(c => c.GetProperty("zoneId").GetInt64() == s.KitZone);
        Assert.Equal("working", kit.GetProperty("overall").GetString());
        Assert.Equal("AgroFlow-Setup-89AB", kit.GetProperty("setupNetworkName").GetString());
        Assert.Equal("AF-6789AB", kit.GetProperty("setupNetworkPassword").GetString());
        string State(string key) => kit.GetProperty("lines").EnumerateArray().Single(l => l.GetProperty("key").GetString() == key).GetProperty("state").GetString()!;
        Assert.Equal(("online", "strong", "ok", "ok", "confirmed"), (State("connection"), State("wifi"), State("soil"), State("climate"), State("pump")));
        Assert.Equal("7|3", kit.GetProperty("lines").EnumerateArray().Single(l => l.GetProperty("key").GetString() == "safety").GetProperty("value").GetString());

        var empty = cards.Single(c => c.GetProperty("zoneId").GetInt64() == s.EmptyZone);
        Assert.Equal("awaiting_installation", empty.GetProperty("overall").GetString());
        Assert.Empty(empty.GetProperty("lines").EnumerateArray());

        // Someone with no access to the farm: not found, nothing about the kit.
        var other = new HttpRequestMessage(HttpMethod.Get, $"/api/farmer/farms/{s.FarmId}/kits");
        other.Headers.Add(ApiHost.TestAuth.Header, Stranger.ToString());
        Assert.Equal(HttpStatusCode.NotFound, (await _host.CreateClient().SendAsync(other)).StatusCode);
    }
}
