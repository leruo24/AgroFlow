using System;
using System.Collections.Concurrent;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using AgroFlow.Api.Mqtt;
using AgroFlow.Api.Services.Notifications;
using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Npgsql;
using Xunit;

namespace AgroFlow.Domain.Tests;

// Kit linking (October 2026) against the migration replay (0001-0063), through the real API:
// a kit linked to an EXISTING farmer's Live zone (the reported bug), replacing a kit, expired and
// used codes, a retried claim, the MQTT details in the answer, the admin's live stages, and the
// farmer's welcome link (used and expired tokens).
public class KitLinkHost : SimDbHost
{
    public sealed class RecordingPublisher : IMqttPublisher
    {
        public readonly ConcurrentQueue<(string Topic, string Payload)> Sent = new();
        public bool IsConnected => true;
        public event Action? Connected { add { } remove { } }
        public Task PublishAsync(string topic, string payload)
        {
            Sent.Enqueue((topic, payload));
            return Task.CompletedTask;
        }
    }

    public RecordingPublisher Mqtt { get; } = new();
    public readonly ConcurrentQueue<long> KitWorking = new();

    private sealed class WorkingNotifications(ConcurrentQueue<long> working) : INotificationService
    {
        public Task NotifyKitWorkingAsync(long zoneId, CancellationToken ct) { working.Enqueue(zoneId); return Task.CompletedTask; }
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

    // Test values only: the claim hands out whatever login the API itself is configured with.
    public const string MqttUser = "kit-test-user";
    public const string MqttPass = "kit-test-password";

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        base.ConfigureWebHost(builder);
        builder.UseSetting("Mqtt:Username", MqttUser);
        builder.UseSetting("Mqtt:Password", MqttPass);
        builder.UseSetting("Mqtt:Host", "broker.test.example");
        builder.UseSetting("Mqtt:Port", "8883");
    }

    protected override void ConfigureDatabase(IServiceCollection services)
    {
        base.ConfigureDatabase(services);
        services.RemoveAll<IMqttPublisher>();
        services.AddSingleton<IMqttPublisher>(Mqtt);
        services.RemoveAll<INotificationService>();
        services.AddSingleton<INotificationService>(new WorkingNotifications(KitWorking));
    }
}

public class KitLinkDbTests : IClassFixture<KitLinkHost>
{
    private readonly KitLinkHost _host;
    public KitLinkDbTests(KitLinkHost host) => _host = host;

    private static readonly Guid OldFarmer = Guid.Parse("00000000-0000-4000-8000-00000000d201");
    private static readonly Guid Existing = Guid.Parse("00000000-0000-4000-8000-00000000d202");

    private static async Task<object?> Q(string sql, params object[] args)
    {
        await using var c = new NpgsqlConnection(SimDbHost.ConnectionString);
        await c.OpenAsync();
        await using var cmd = new NpgsqlCommand(sql, c);
        foreach (var a in args) cmd.Parameters.AddWithValue(a);
        return await cmd.ExecuteScalarAsync();
    }

    private static async Task EnsurePeopleAsync()
    {
        foreach (var (id, role) in new[] { (ApiHost.Admin, "admin"), (OldFarmer, "farm_user"), (Existing, "farm_user") })
        {
            await Q("insert into auth.users (id, email) values ($1, $2) on conflict do nothing", id, $"{id}@kitlink.test");
            await Q("insert into profile (id, name, email, role) values ($1, 'Kit link test', $2, $3) on conflict (id) do nothing", id, $"{id}@kitlink.test", role);
        }
    }

    // A farm with one zone, owned by the farmer. live: commissioned, like a farmer already using AgroFlow.
    private static async Task<(long Farm, long Zone)> FarmAsync(Guid owner, string name, bool live)
    {
        await EnsurePeopleAsync();
        var farm = (long)(await Q("insert into farm (owner_id, name, location) values ($1, $2, 'Test') returning farm_id", owner, name))!;
        await Q("insert into farm_member (farm_id, profile_id) values ($1, $2) on conflict do nothing", farm, owner);
        var zone = (long)(await Q(
            "insert into zone (farm_id, name, crop_type, irrigation_mode, commission_state) values ($1, $2, 'spinach', 'manual', $3) returning id",
            farm, name + " bed", live ? "commissioned" : "pending"))!;
        return (farm, zone);
    }

    private static string NewDevice() => Guid.NewGuid().ToString("N")[..12].ToUpperInvariant();

    private HttpRequestMessage Admin(HttpMethod method, string path, object? body = null)
    {
        var request = new HttpRequestMessage(method, path);
        request.Headers.Add(ApiHost.TestAuth.Header, ApiHost.Admin.ToString());
        if (body is not null) request.Content = new StringContent(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json");
        return request;
    }

    private async Task<JsonElement> AdminJson(HttpMethod method, string path, object? body = null)
    {
        var response = await _host.CreateClient().SendAsync(Admin(method, path, body));
        var text = await response.Content.ReadAsStringAsync();
        Assert.True(response.IsSuccessStatusCode, $"{method} {path} -> {(int)response.StatusCode} {text}");
        return JsonDocument.Parse(text).RootElement.Clone();
    }

    private async Task<string> NewCodeAsync(long zone) => (await AdminJson(HttpMethod.Post, $"/api/admin/zones/{zone}/kit-code")).GetProperty("code").GetString()!;

    private async Task<(HttpStatusCode Status, JsonElement Body)> ClaimAsync(string device, string code)
    {
        var response = await _host.CreateClient().PostAsync("/api/devices/claim", new StringContent(
            JsonSerializer.Serialize(new { deviceId = device, enrollmentCode = code, firmwareVersion = "1.7.2" }), Encoding.UTF8, "application/json"));
        return (response.StatusCode, JsonDocument.Parse(await response.Content.ReadAsStringAsync()).RootElement.Clone());
    }

    // An already-linked kit: what the old firmware flow left behind (an active row with this device).
    private static async Task<long> LinkedKitAsync(long zone, string device) =>
        (long)(await Q("insert into hardware (device_name, device_type, zone_id, device_id, enrollment_status, status, last_seen) " +
                       "values ('Old kit', 'ESP32', $1, $2, 'active', 'Online', now()) returning hardware_id", zone, device))!;

    [SimDbFact]
    public async Task A_kit_that_was_linked_before_can_be_linked_to_an_existing_farmers_live_zone_and_its_history_stays()
    {
        var device = NewDevice();
        var old = await FarmAsync(OldFarmer, "Old test farm", live: true);
        var existing = await FarmAsync(Existing, "Existing farmer farm", live: true);
        var oldRow = await LinkedKitAsync(old.Zone, device);
        await Q("insert into sensor_reading (zone_id, hardware_id, sensor_type, value) values ($1, $2, 'SoilMoisture', 44)", old.Zone, oldRow);

        // Add kit on the existing farmer's zone: a 6-digit code, 30 minutes.
        var issued = await AdminJson(HttpMethod.Post, $"/api/admin/zones/{existing.Zone}/kit-code");
        var code = issued.GetProperty("code").GetString()!;
        Assert.Matches("^[0-9]{6}$", code);
        var minutes = (issued.GetProperty("expiresAt").GetDateTimeOffset() - DateTimeOffset.UtcNow).TotalMinutes;
        Assert.InRange(minutes, 29, 30.1);
        var hardwareId = issued.GetProperty("hardwareId").GetInt64();

        // Still linked to the old farm: a clear refusal (it used to be a 503 "cannot reach its database").
        var refused = await ClaimAsync(device, code);
        Assert.Equal(HttpStatusCode.Conflict, refused.Status);
        Assert.Equal("kit_linked_elsewhere", refused.Body.GetProperty("code").GetString());
        Assert.Contains("Old test farm", refused.Body.GetProperty("error").GetString());
        var waiting = await AdminJson(HttpMethod.Get, $"/api/admin/kit-link/{hardwareId}");
        Assert.Equal("waiting", waiting.GetProperty("stage").GetString());
        Assert.Equal("kit_linked_elsewhere", waiting.GetProperty("refused").GetProperty("code").GetString());

        // Staff unlink it there; the kit is told to forget its link.
        await AdminJson(HttpMethod.Post, $"/api/admin/hardware/{oldRow}/unlink");
        Assert.Contains(_host.Mqtt.Sent, m => m.Topic == $"agroflow/{device}/cmd" && m.Payload.Contains("\"unlink\""));

        var linked = await ClaimAsync(device, code);
        Assert.Equal(HttpStatusCode.OK, linked.Status);
        Assert.Equal(existing.Zone, linked.Body.GetProperty("zoneId").GetInt64());
        Assert.Equal("Existing farmer farm", linked.Body.GetProperty("farmName").GetString());
        Assert.Equal("replaced", await Q("select enrollment_status from hardware where hardware_id = $1", oldRow));
        Assert.Equal(device, await Q("select device_id from hardware where hardware_id = $1", oldRow));   // history keeps its kit
        Assert.Equal(1L, await Q("select count(*) from sensor_reading where hardware_id = $1", oldRow));
        Assert.Equal(1L, await Q("select count(*) from hardware where device_id = $1 and enrollment_status = 'active'", device));
        Assert.Equal("linked", (await AdminJson(HttpMethod.Get, $"/api/admin/kit-link/{hardwareId}")).GetProperty("stage").GetString());
    }

    [SimDbFact]
    public async Task Moving_a_kit_between_zones_of_the_same_farm_needs_no_unlink()
    {
        var device = NewDevice();
        var farm = await FarmAsync(Existing, "Two zone farm", live: false);
        var second = (long)(await Q("insert into zone (farm_id, name, crop_type, irrigation_mode) values ($1, 'Second bed', 'maize', 'manual') returning id", farm.Farm))!;
        var oldRow = await LinkedKitAsync(farm.Zone, device);
        var claim = await ClaimAsync(device, await NewCodeAsync(second));
        Assert.Equal(HttpStatusCode.OK, claim.Status);
        Assert.Equal(second, claim.Body.GetProperty("zoneId").GetInt64());
        Assert.Equal("replaced", await Q("select enrollment_status from hardware where hardware_id = $1", oldRow));
    }

    [SimDbFact]
    public async Task A_new_kit_replaces_the_zones_old_kit_which_keeps_its_history_and_is_told_to_unlink()
    {
        var (oldDevice, newDevice) = (NewDevice(), NewDevice());
        var farm = await FarmAsync(Existing, "Replacement farm", live: true);
        var oldRow = await LinkedKitAsync(farm.Zone, oldDevice);
        await Q("update hardware set device_token_hash = 'old-hash' where hardware_id = $1", oldRow);
        await Q("insert into sensor_reading (zone_id, hardware_id, sensor_type, value) values ($1, $2, 'Temperature', 21)", farm.Zone, oldRow);

        var claim = await ClaimAsync(newDevice, await NewCodeAsync(farm.Zone));
        Assert.Equal(HttpStatusCode.OK, claim.Status);
        Assert.Equal("replaced", await Q("select enrollment_status from hardware where hardware_id = $1", oldRow));
        Assert.Equal(true, await Q("select token_revoked_at is not null from hardware where hardware_id = $1", oldRow));
        Assert.Equal(1L, await Q("select count(*) from sensor_reading where hardware_id = $1", oldRow));
        Assert.Equal(newDevice, await Q("select device_id from hardware where zone_id = $1 and enrollment_status = 'active'", farm.Zone));
        Assert.Contains(_host.Mqtt.Sent, m => m.Topic == $"agroflow/{oldDevice}/cmd" && m.Payload.Contains("\"unlink\""));
    }

    [SimDbFact]
    public async Task An_expired_code_says_so()
    {
        var farm = await FarmAsync(Existing, "Expired code farm", live: false);
        await Q("insert into hardware (device_name, device_type, zone_id, enrollment_status, enrollment_code, enrollment_code_expires_at) " +
                "values ('k', 'ESP32', $1, 'enrolled', '000417', now() - interval '1 minute')", farm.Zone);
        var claim = await ClaimAsync(NewDevice(), "000 417");
        Assert.Equal(HttpStatusCode.Unauthorized, claim.Status);
        Assert.Equal("code_expired", claim.Body.GetProperty("code").GetString());
    }

    [SimDbFact]
    public async Task A_used_code_refuses_another_kit_but_the_same_kit_retrying_gets_the_same_link()
    {
        var (first, second) = (NewDevice(), NewDevice());
        var farm = await FarmAsync(Existing, "Used code farm", live: false);
        var code = await NewCodeAsync(farm.Zone);

        var one = await ClaimAsync(first, code);
        var again = await ClaimAsync(first, code);   // the kit's page retried, or the answer was lost
        Assert.Equal(HttpStatusCode.OK, one.Status);
        Assert.Equal(HttpStatusCode.OK, again.Status);
        Assert.Equal(one.Body.GetProperty("hardwareId").GetInt64(), again.Body.GetProperty("hardwareId").GetInt64());
        Assert.NotEqual(one.Body.GetProperty("deviceToken").GetString(), again.Body.GetProperty("deviceToken").GetString());
        Assert.Equal(1L, await Q("select count(*) from hardware where zone_id = $1 and enrollment_status = 'active'", farm.Zone));

        var other = await ClaimAsync(second, code);
        Assert.Equal(HttpStatusCode.Conflict, other.Status);
        Assert.Equal("code_used", other.Body.GetProperty("code").GetString());
        Assert.Equal(first, await Q("select device_id from hardware where zone_id = $1 and enrollment_status = 'active'", farm.Zone));
    }

    [SimDbFact]
    public async Task The_claim_answer_carries_the_existing_MQTT_login_broker_and_the_kits_own_topics()
    {
        var device = NewDevice();
        var farm = await FarmAsync(Existing, "MQTT details farm", live: false);
        var body = (await ClaimAsync(device, await NewCodeAsync(farm.Zone))).Body;
        Assert.Equal(KitLinkHost.MqttUser, body.GetProperty("mqttUsername").GetString());
        Assert.Equal(KitLinkHost.MqttPass, body.GetProperty("mqttPassword").GetString());
        Assert.Equal("broker.test.example", body.GetProperty("mqttHost").GetString());
        Assert.Equal(8883, body.GetProperty("mqttPort").GetInt32());
        Assert.True(body.GetProperty("mqttTls").GetBoolean());
        var topics = body.GetProperty("topics");
        Assert.Equal($"agroflow/{device}/telemetry", topics.GetProperty("telemetry").GetString());
        Assert.Equal($"agroflow/{device}/cmd", topics.GetProperty("cmd").GetString());
        Assert.Equal($"agroflow/{device}/ack", topics.GetProperty("ack").GetString());
        Assert.Equal($"agroflow/{device}/status", topics.GetProperty("status").GetString());
        Assert.False(string.IsNullOrEmpty(body.GetProperty("deviceToken").GetString()));
        // Only a hash of the token is kept; the MQTT password is never stored per kit.
        Assert.Equal(false, await Q("select device_token_hash = $2 from hardware where device_id = $1 and enrollment_status = 'active'",
            device, body.GetProperty("deviceToken").GetString()!));
    }

    [SimDbFact]
    public async Task Regenerate_replaces_the_waiting_code_on_the_same_row()
    {
        var farm = await FarmAsync(Existing, "Regenerate farm", live: false);
        var first = await AdminJson(HttpMethod.Post, $"/api/admin/zones/{farm.Zone}/kit-code");
        var second = await AdminJson(HttpMethod.Post, $"/api/admin/zones/{farm.Zone}/kit-code");
        Assert.Equal(first.GetProperty("hardwareId").GetInt64(), second.GetProperty("hardwareId").GetInt64());
        var old = await ClaimAsync(NewDevice(), first.GetProperty("code").GetString()!);
        if (first.GetProperty("code").GetString() != second.GetProperty("code").GetString())
            Assert.Equal("code_invalid", old.Body.GetProperty("code").GetString());
    }

    [SimDbFact]
    public async Task The_pump_test_runs_ten_seconds_and_the_last_check_commissions_the_zone_and_tells_the_farmer()
    {
        var device = NewDevice();
        var farm = await FarmAsync(Existing, "Guided check farm", live: false);
        Assert.Equal(HttpStatusCode.OK, (await ClaimAsync(device, await NewCodeAsync(farm.Zone))).Status);

        var start = await AdminJson(HttpMethod.Post, $"/api/admin/zones/{farm.Zone}/pump-test", new { action = "start" });
        Assert.Equal(10, start.GetProperty("seconds").GetInt32());
        Assert.Equal(10, await Q("select duration_seconds from irrigation_commands where id = $1", Guid.Parse(start.GetProperty("commandId").GetString()!)));
        var stop = await AdminJson(HttpMethod.Post, $"/api/admin/zones/{farm.Zone}/pump-test", new { action = "stop" });
        // The kit acknowledges both (over MQTT on 1.7.2; the database effect is the same).
        foreach (var id in new[] { start, stop }.Select(x => Guid.Parse(x.GetProperty("commandId").GetString()!)))
            await Q("update irrigation_commands set status = 'executed', executed_at = now() where id = $1", id);
        await Q("update zone set calibration_dry = 20, calibration_wet = 70 where id = $1", farm.Zone);

        foreach (var (item, body) in new (string, object)[]
        {
            ("kit_linked", new { provenance = "confirmed" }),
            ("calibration", new { provenance = "measured" }),
            ("test_start_stop", new { provenance = "measured" }),
        })
            await AdminJson(HttpMethod.Post, $"/api/admin/zones/{farm.Zone}/checklist/{item}", body);
        Assert.Empty(_host.KitWorking.Where(z => z == farm.Zone));

        // Bucket: 5 litres in 50 seconds = 6 L/min. "Commission".
        var done = await AdminJson(HttpMethod.Post, $"/api/admin/zones/{farm.Zone}/checklist/flow_measured",
            new { provenance = "measured", flowRateLpm = 6.0, valueText = "5 L in 50 s" });
        Assert.True(done.GetProperty("commissionedNow").GetBoolean());
        Assert.Equal("commissioned", await Q("select commission_state from zone where id = $1", farm.Zone));
        Assert.Single(_host.KitWorking.Where(z => z == farm.Zone));
    }

    // ----- The farmer's welcome link ----------------------------------------------------

    private async Task<JsonElement> OpenWelcomeAsync(string code)
    {
        var response = await _host.CreateClient().PostAsync($"/api/public/welcome/{code}/open", null);
        return JsonDocument.Parse(await response.Content.ReadAsStringAsync()).RootElement.Clone();
    }

    private static async Task<string> WelcomeCodeAsync(Guid farmer, string expires = "now() + interval '24 hours'", bool used = false)
    {
        await EnsurePeopleAsync();
        var code = "welcome" + Guid.NewGuid().ToString("N");
        await Q($"insert into telegram_onboarding_code (code, profile_id, expires_at, purpose, used_at) values ($1, $2, {expires}, 'onboarding', {(used ? "now()" : "null")})",
            code, farmer);
        return code;
    }

    [SimDbFact]
    public async Task A_used_or_expired_welcome_link_answers_politely_and_shows_nothing_personal()
    {
        var used = await OpenWelcomeAsync(await WelcomeCodeAsync(Existing, used: true));
        Assert.Equal("used", used.GetProperty("status").GetString());
        Assert.False(used.TryGetProperty("email", out _));
        var expired = await OpenWelcomeAsync(await WelcomeCodeAsync(Existing, expires: "now() - interval '1 minute'"));
        Assert.Equal("expired", expired.GetProperty("status").GetString());

        // Telegram: a used token links nothing.
        var onboarding = _host.Services.GetRequiredService<TelegramOnboardingService>();
        Assert.Null(await onboarding.RedeemCodeAsync(await WelcomeCodeAsync(Existing, used: true), 7_700_001, CancellationToken.None));
    }

    [SimDbFact]
    public async Task The_welcome_page_counts_its_first_open_and_redeeming_turns_alerts_on()
    {
        await Q("update profile set must_change_password = false, telegram_alerts_enabled = false where id = $1", Existing);
        var code = await WelcomeCodeAsync(Existing);
        var first = await OpenWelcomeAsync(code);
        Assert.Equal("ok", first.GetProperty("status").GetString());
        Assert.False(first.GetProperty("passwordShownBefore").GetBoolean());
        Assert.True(first.GetProperty("passwordUnchanged").GetBoolean());   // they already chose a password: no reset
        var second = await OpenWelcomeAsync(code);
        Assert.True(second.GetProperty("passwordShownBefore").GetBoolean());
        Assert.Equal(JsonValueKind.Null, second.GetProperty("password").ValueKind);

        var onboarding = _host.Services.GetRequiredService<TelegramOnboardingService>();
        var redeemed = await onboarding.RedeemCodeAsync(code, 7_700_002, CancellationToken.None);
        Assert.NotNull(redeemed);
        Assert.True(redeemed!.WebOpened);
        Assert.Equal(true, await Q("select telegram_alerts_enabled from profile where id = $1", Existing));
        Assert.Null(await onboarding.RedeemCodeAsync(code, 7_700_002, CancellationToken.None));   // single use
        Assert.Equal("used", (await OpenWelcomeAsync(code)).GetProperty("status").GetString());
    }
}
