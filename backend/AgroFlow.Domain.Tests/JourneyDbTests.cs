using System;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using Npgsql;
using Xunit;

namespace AgroFlow.Domain.Tests;

// Part B, the journey, on a real database (the kit simulation's local Postgres; Skipped in a plain
// `dotnet test`): one synthetic farm goes from onboarded to commissioned, and every step is the
// server's record, not the screen's.
public class JourneyDbTests : IClassFixture<SimDbHost>
{
    private readonly SimDbHost _host;
    public JourneyDbTests(SimDbHost host) => _host = host;

    private static readonly Guid Farmer = Guid.Parse("00000000-0000-4000-8000-00000000a001");
    private static readonly Guid Stranger = Guid.Parse("00000000-0000-4000-8000-00000000a002");

    private static async Task<object?> Q(string sql, params object[] args)
    {
        await using var c = new NpgsqlConnection(SimDbHost.ConnectionString);
        await c.OpenAsync();
        await using var cmd = new NpgsqlCommand(sql, c);
        foreach (var a in args) cmd.Parameters.AddWithValue(a);
        return await cmd.ExecuteScalarAsync();
    }

    private async Task<(HttpStatusCode Status, JsonElement Body)> Send(Guid who, HttpMethod method, string path, object? body = null)
    {
        var r = new HttpRequestMessage(method, path);
        r.Headers.Add(ApiHost.TestAuth.Header, who.ToString());
        if (body is not null) r.Content = new StringContent(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json");
        var response = await _host.CreateClient().SendAsync(r);
        var text = await response.Content.ReadAsStringAsync();
        return (response.StatusCode, JsonDocument.Parse(string.IsNullOrWhiteSpace(text) ? "{}" : text).RootElement.Clone());
    }

    private static async Task<(long FarmId, long ZoneId)> SeedAsync(string tag)
    {
        foreach (var (id, email, role) in new[] { (Farmer, $"journey-farmer@example.org", "farm_user"), (Stranger, "journey-stranger@example.org", "farm_user"), (ApiHost.Admin, "journey-admin@agroflow.test", "admin") })
        {
            await Q("insert into auth.users (id, email) values ($1, $2) on conflict do nothing", id, email);
            await Q("insert into profile (id, name, email, role) values ($1, $2, $2, $3) on conflict (id) do update set role = $3", id, email, role);
        }
        await Q("update profile set must_change_password = true where id = $1", Farmer);
        var farmId = (long)(await Q("insert into farm (owner_id, name, location, latitude, longitude, total_area) values ($1, $2, 'Sesobe', -25.0368, 26.4337, 0.02) returning farm_id", Farmer, "Journey " + tag))!;
        // A zone made after 0058: pending, Manual.
        var zoneId = (long)(await Q("insert into zone (farm_id, name, crop_type, max_run_minutes) values ($1, 'Maize', 'maize', 5) returning id", farmId))!;
        return (farmId, zoneId);
    }

    private static string Stage(JsonElement journey) => journey.GetProperty("whereYouAreNow").GetProperty("stage").GetString()!;

    [SimDbFact]
    public async Task A_farm_goes_from_details_to_commissioned_and_only_then_is_offered_automatic()
    {
        var (farmId, zoneId) = await SeedAsync(Guid.NewGuid().ToString()[..6]);
        Assert.Equal("pending", await Q("select commission_state from zone where id = $1", zoneId));
        Assert.Equal("manual", await Q("select irrigation_mode from zone where id = $1", zoneId));

        var (_, j) = await Send(Farmer, HttpMethod.Get, $"/api/farmer/farms/{farmId}/journey");
        Assert.Equal("details", Stage(j));
        Assert.Equal("Your details: 0 of 4", j.GetProperty("setupProgress").GetProperty("label").GetString());
        // Somebody else's farm is not found.
        Assert.Equal(HttpStatusCode.NotFound, (await Send(Stranger, HttpMethod.Get, $"/api/farmer/farms/{farmId}/journey")).Status);

        // Not commissioned: the farmer cannot make it automatic; staff can switch it either way.
        var (refused, refusedBody) = await Send(Farmer, HttpMethod.Put, $"/api/farmer/zones/{zoneId}/settings", new { irrigationMode = "automatic", automationEnabled = true });
        Assert.Equal(HttpStatusCode.Conflict, refused);
        Assert.Equal("not_commissioned", refusedBody.GetProperty("reason").GetString());

        // Staff agree the service.
        await Send(ApiHost.Admin, HttpMethod.Put, $"/api/admin/farms/{farmId}/case", new { serviceAgreed = true, serviceStatus = "sponsored", payer = "Sponsor" });
        Assert.Equal("service_agreed", Stage((await Send(Farmer, HttpMethod.Get, $"/api/farmer/farms/{farmId}/journey")).Body));

        // The preferences task needs the password changed and the terms accepted first.
        var (early, earlyBody) = await Send(Farmer, HttpMethod.Post, $"/api/farmer/farms/{farmId}/tasks/preferences");
        Assert.Equal(HttpStatusCode.BadRequest, early);
        Assert.Contains("password", earlyBody.GetProperty("error").GetString());
        await Q("update profile set must_change_password = false where id = $1", Farmer);
        var (stale, _) = await Send(Farmer, HttpMethod.Post, "/api/farmer/terms/accept", new { accepted = true, termsVersion = "0.0", privacyVersion = "0.0" });
        Assert.Equal(HttpStatusCode.Conflict, stale);
        var (ok, okBody) = await Send(Farmer, HttpMethod.Post, "/api/farmer/terms/accept", new { accepted = true, termsVersion = "0.1-draft", privacyVersion = "0.1-draft" });
        Assert.Equal(HttpStatusCode.OK, ok);
        Assert.True(okBody.GetProperty("accepted").GetBoolean());
        Assert.Equal(2L, await Q("select count(*) from terms_acceptance where profile_id = $1", Farmer));
        Assert.Equal(HttpStatusCode.OK, (await Send(Farmer, HttpMethod.Post, $"/api/farmer/farms/{farmId}/tasks/preferences")).Status);
        Assert.Equal("account_active", Stage((await Send(Farmer, HttpMethod.Get, $"/api/farmer/farms/{farmId}/journey")).Body));

        // Water: refused without a source, accepted once "I don't know - help me" covers it.
        Assert.Equal(HttpStatusCode.BadRequest, (await Send(Farmer, HttpMethod.Post, $"/api/farmer/farms/{farmId}/tasks/water")).Status);
        var (help1, h1) = await Send(Farmer, HttpMethod.Post, $"/api/farmer/farms/{farmId}/help", new { topic = "water_source" });
        var (_, h2) = await Send(Farmer, HttpMethod.Post, $"/api/farmer/farms/{farmId}/help", new { topic = "water_source", note = "Not sure" });
        Assert.Equal(HttpStatusCode.OK, help1);
        Assert.Equal(h1.GetProperty("id").GetInt64(), h2.GetProperty("id").GetInt64());   // asking twice is one request
        foreach (var task in new[] { "farm", "water" })
            Assert.Equal(HttpStatusCode.OK, (await Send(Farmer, HttpMethod.Post, $"/api/farmer/farms/{farmId}/tasks/{task}")).Status);
        await Q("update zone set planting_date = current_date - 20 where id = $1", zoneId);
        var (crops, journeyAfterCrops) = await Send(Farmer, HttpMethod.Post, $"/api/farmer/farms/{farmId}/tasks/crops");
        Assert.Equal(HttpStatusCode.OK, crops);
        Assert.Equal("ready_for_installation", Stage(journeyAfterCrops));
        var where = journeyAfterCrops.GetProperty("whereYouAreNow");
        Assert.Equal("agroflow_staff", where.GetProperty("whoActsNext").GetString());
        Assert.Equal("Waiting for booking", where.GetProperty("dateLabel").GetString());
        Assert.Equal(JsonValueKind.Null, where.GetProperty("knownDate").ValueKind);

        // First installation, booked before any device exists.
        var when = DateTimeOffset.UtcNow.AddDays(3);
        var (booked, _) = await Send(ApiHost.Admin, HttpMethod.Post, $"/api/admin/farms/{farmId}/visits", new { scheduledFor = when, installerName = "Thabo Installer" });
        Assert.Equal(HttpStatusCode.Created, booked);
        var (_, afterBooking) = await Send(Farmer, HttpMethod.Get, $"/api/farmer/farms/{farmId}/journey");
        Assert.Equal("visit_booked", Stage(afterBooking));
        Assert.Equal("installer", afterBooking.GetProperty("whereYouAreNow").GetProperty("whoActsNext").GetString());
        Assert.Equal(JsonValueKind.String, afterBooking.GetProperty("whereYouAreNow").GetProperty("knownDate").ValueKind);

        // The checklist cannot be ticked without the real thing.
        Assert.Equal(HttpStatusCode.Conflict, (await Send(ApiHost.Admin, HttpMethod.Post, $"/api/admin/zones/{zoneId}/checklist/kit_linked", new { provenance = "confirmed" })).Status);
        Assert.Equal(HttpStatusCode.Conflict, (await Send(ApiHost.Admin, HttpMethod.Post, $"/api/admin/zones/{zoneId}/checklist/test_start_stop", new { })).Status);

        await Q("insert into hardware (device_name, device_type, zone_id, enrollment_status, device_id, last_seen) values ('Journey kit', 'ESP32', $1, 'active', $2, now())",
            zoneId, "JRNY" + zoneId);
        await Q("update zone set calibration_wet = 1200, calibration_dry = 2900 where id = $1", zoneId);
        Assert.Equal(HttpStatusCode.OK, (await Send(ApiHost.Admin, HttpMethod.Post, $"/api/admin/zones/{zoneId}/checklist/kit_linked", new { provenance = "confirmed" })).Status);
        Assert.Equal(HttpStatusCode.OK, (await Send(ApiHost.Admin, HttpMethod.Post, $"/api/admin/zones/{zoneId}/checklist/calibration", new { provenance = "measured" })).Status);
        var (flow, flowBody) = await Send(ApiHost.Admin, HttpMethod.Post, $"/api/admin/zones/{zoneId}/checklist/flow_measured", new { provenance = "measured", flowRateLpm = 6.0 });
        Assert.Equal(HttpStatusCode.OK, flow);
        // Who did it is recorded by name, from the login.
        Assert.False(string.IsNullOrEmpty(flowBody.GetProperty("doneBy").GetString()));
        Assert.Equal(6.0, Convert.ToDouble(await Q("select flow_rate_lpm from zone where id = $1", zoneId)));
        Assert.Equal(HttpStatusCode.OK, (await Send(ApiHost.Admin, HttpMethod.Post, $"/api/admin/zones/{zoneId}/checklist/run_limit", new { maxRunMinutes = 5 })).Status);
        Assert.Equal("installing", Stage((await Send(Farmer, HttpMethod.Get, $"/api/farmer/farms/{farmId}/journey")).Body));

        // A test start and stop the kit acknowledged (what Water now 1 min + Stop leave behind).
        await Q("insert into irrigation_commands (zone_id, command, source, duration_seconds, status, executed_at) values ($1, 'start', 'manual', 60, 'executed', now())", zoneId);
        await Q("insert into irrigation_commands (zone_id, command, source, status, executed_at) values ($1, 'stop', 'manual', 'executed', now())", zoneId);
        var (test, testBody) = await Send(ApiHost.Admin, HttpMethod.Post, $"/api/admin/zones/{zoneId}/checklist/test_start_stop", new { });
        Assert.Equal(HttpStatusCode.OK, test);
        Assert.True(testBody.GetProperty("commissionedNow").GetBoolean());
        Assert.Equal("commissioned", await Q("select commission_state from zone where id = $1", zoneId));
        // Still Manual: commissioning never changes the mode by itself.
        Assert.Equal("manual", await Q("select irrigation_mode from zone where id = $1", zoneId));

        var (_, live) = await Send(Farmer, HttpMethod.Get, $"/api/farmer/farms/{farmId}/journey");
        Assert.Equal("commissioned", Stage(live));
        var zone = live.GetProperty("zones").EnumerateArray().Single(z => z.GetProperty("zoneId").GetInt64() == zoneId);
        Assert.True(zone.GetProperty("offerAutomatic").GetBoolean());

        // "Turn on automatic watering?" Yes.
        var (yes, yesBody) = await Send(Farmer, HttpMethod.Post, $"/api/farmer/zones/{zoneId}/automatic-offer", new { answer = "automatic" });
        Assert.Equal(HttpStatusCode.OK, yes);
        Assert.Equal("automatic", yesBody.GetProperty("irrigationMode").GetString());
        var (_, after) = await Send(Farmer, HttpMethod.Get, $"/api/farmer/farms/{farmId}/journey");
        Assert.False(after.GetProperty("zones").EnumerateArray().Single(z => z.GetProperty("zoneId").GetInt64() == zoneId).GetProperty("offerAutomatic").GetBoolean());
    }

    [SimDbFact]
    public async Task Zones_from_before_the_journey_keep_their_mode_and_are_never_blocked()
    {
        var (farmId, zoneId) = await SeedAsync(Guid.NewGuid().ToString()[..6]);
        await Q("update zone set commission_state = 'legacy' where id = $1", zoneId);
        var (status, _) = await Send(Farmer, HttpMethod.Put, $"/api/farmer/zones/{zoneId}/settings", new { irrigationMode = "automatic", automationEnabled = true });
        Assert.Equal(HttpStatusCode.NoContent, status);
        // A legacy zone is not offered automatic again.
        var (_, j) = await Send(Farmer, HttpMethod.Get, $"/api/farmer/farms/{farmId}/journey");
        Assert.False(j.GetProperty("zones")[0].GetProperty("offerAutomatic").GetBoolean());
        // Staff switch any zone.
        var (staff, staffBody) = await Send(ApiHost.Admin, HttpMethod.Put, $"/api/admin/zones/{zoneId}/mode", new { answer = "manual" });
        Assert.Equal(HttpStatusCode.OK, staff);
        Assert.Equal("manual", staffBody.GetProperty("irrigationMode").GetString());
    }

    [SimDbFact]
    public async Task An_enquiry_is_linked_to_an_existing_farmer_without_inventing_a_call()
    {
        var (farmId, _) = await SeedAsync(Guid.NewGuid().ToString()[..6]);
        var enquiryId = (long)(await Q("insert into enquiry (full_name, phone, province, town, best_time, consent_at, status) values ('Linked Farmer', '+27821234567', 'North West', 'Sesobe', 'morning', now(), 'open') returning id"))!;
        var callsBefore = (long)(await Q("select count(*) from enquiry_call where enquiry_id = $1", enquiryId))!;

        var (status, body) = await Send(ApiHost.Admin, HttpMethod.Post, $"/api/admin/enquiries/{enquiryId}/link", new { farmerProfileId = Farmer, farmId });
        Assert.Equal(HttpStatusCode.OK, status);
        Assert.Equal(farmId, body.GetProperty("farmId").GetInt64());
        Assert.Equal("won", await Q("select status from enquiry where id = $1", enquiryId));
        Assert.Equal(callsBefore, await Q("select count(*) from enquiry_call where enquiry_id = $1", enquiryId));
        Assert.Equal(enquiryId, await Q("select enquiry_id from service_case where farm_id = $1", farmId));

        // A second link to a different farmer is refused, not silently moved.
        var (again, _) = await Send(ApiHost.Admin, HttpMethod.Post, $"/api/admin/enquiries/{enquiryId}/link", new { farmerProfileId = Stranger });
        Assert.Equal(HttpStatusCode.Conflict, again);
        // A farmer cannot use the staff route.
        Assert.Equal(HttpStatusCode.Forbidden, (await Send(Farmer, HttpMethod.Post, $"/api/admin/enquiries/{enquiryId}/link", new { farmerProfileId = Farmer })).Status);
    }
}
