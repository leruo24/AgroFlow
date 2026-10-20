using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using AgroFlow.Api.Services;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Logging.Abstractions;
using Npgsql;
using Xunit;

namespace AgroFlow.Domain.Tests;

// Drought mode, community alerts and the wizard's farm settings, through the real API on the
// kit simulation's Postgres (every migration applied). Skipped in a plain `dotnet test`
// (see SimDbHost); hardware/sim/run-e2e.mjs runs them.
public class DroughtCommunityDbTests : IClassFixture<SimDbHost>
{
    private readonly SimDbHost _host;
    public DroughtCommunityDbTests(SimDbHost host) => _host = host;

    // Farmers: A reports at Mahikeng; B is at Ottoshoop (about 35 km east); C is next to B but
    // opted out; D and E are near Ottoshoop and confirm; S is staff.
    private static readonly Guid A = Guid.Parse("00000000-0000-4000-8000-0000000000c1");
    private static readonly Guid B = Guid.Parse("00000000-0000-4000-8000-0000000000c2");
    private static readonly Guid Cc = Guid.Parse("00000000-0000-4000-8000-0000000000c3");
    private static readonly Guid D = Guid.Parse("00000000-0000-4000-8000-0000000000c4");
    private static readonly Guid E = Guid.Parse("00000000-0000-4000-8000-0000000000c5");
    private static readonly Guid Staff = ApiHost.Admin;

    private sealed record Seeded(long FarmA, long FarmB, long FarmC, long FarmD, long FarmE, long ZoneA);
    private static Seeded? _seeded;
    private static readonly SemaphoreSlim Gate = new(1, 1);

    private static async Task<object?> Q(string sql, params object[] args)
    {
        await using var c = new NpgsqlConnection(SimDbHost.ConnectionString);
        await c.OpenAsync();
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
            foreach (var (id, email) in new[] { (A, "a@example.org"), (B, "b@example.org"), (Cc, "c@example.org"), (D, "d@example.org"), (E, "e@example.org") })
            {
                await Q("insert into auth.users (id, email) values ($1, $2) on conflict do nothing", id, email);
                await Q("insert into profile (id, name, email, role) values ($1, $2, $2, 'farm_user') on conflict (id) do update set role = 'farm_user'", id, email);
            }
            await Q("insert into auth.users (id, email) values ($1, 'staff@agroflow.test') on conflict do nothing", Staff);
            await Q("insert into profile (id, name, email, role) values ($1, 'Staff', 'staff@agroflow.test', 'admin') on conflict (id) do update set role = 'admin'", Staff);
            async Task<long> Farm(Guid owner, string name, double lat, double lon) => (long)(await Q(
                "insert into farm (owner_id, name, location, latitude, longitude, water_source, tank_capacity_litres) values ($1, $2, 'Test', $3, $4, 'tank', 5000) returning farm_id",
                owner, name, lat, lon))!;
            var fa = await Farm(A, "A farm", -25.86522, 25.64421);
            var fb = await Farm(B, "B farm", -25.74916, 25.96766);
            var fc = await Farm(Cc, "C farm", -25.75, 25.97);
            var fd = await Farm(D, "D farm", -25.76, 25.95);
            var fe = await Farm(E, "E farm", -25.77, 25.96);
            await Q("insert into notification_preference (profile_id, community_opt_in) values ($1, false) on conflict (profile_id) do update set community_opt_in = false", Cc);
            var za = (long)(await Q("insert into zone (farm_id, name, crop_type, planting_date, soil_type, area_m2, flow_rate_lpm, irrigation_type) values ($1, 'Maize bed', 'maize', current_date - 55, 'loam', 50, 6, 'drip') returning id", fa))!;
            return _seeded = new Seeded(fa, fb, fc, fd, fe, za);
        }
        finally { Gate.Release(); }
    }

    private sealed class FixedWind : IWindProvider
    {
        public double From = 270;   // from the west: blows towards the east (Ottoshoop)
        public Task<(double FromDeg, double SpeedKmh)?> CurrentAsync(double latitude, double longitude, CancellationToken ct) =>
            Task.FromResult<(double, double)?>((From, 20));
    }

    private static readonly FixedWind Wind = new();

    private HttpClient Client() => _host.WithWebHostBuilder(b => b.ConfigureTestServices(s =>
    {
        s.RemoveAll<IWindProvider>();
        s.AddSingleton<IWindProvider>(Wind);
    })).CreateClient();

    private static HttpRequestMessage As(Guid who, HttpMethod m, string path, object? body = null)
    {
        var r = new HttpRequestMessage(m, path);
        r.Headers.Add(ApiHost.TestAuth.Header, who.ToString());
        if (body is not null) r.Content = new StringContent(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json");
        return r;
    }

    // A refusal fails the test with what the server said, instead of a missing-key error later.
    private static async Task<JsonElement> Json(HttpResponseMessage r)
    {
        var body = await r.Content.ReadAsStringAsync();
        if ((int)r.StatusCode >= 500 || (r.StatusCode == HttpStatusCode.Conflict && !body.Contains("\"error\"")))
            throw new Xunit.Sdk.XunitException($"{(int)r.StatusCode}: {body}");
        return JsonDocument.Parse(body.Length == 0 ? "{}" : body).RootElement;
    }

    private static async Task ClearReportsAsync() => await Q("delete from community_report where reporter_profile_id = any($1)", new[] { A, B, Cc, D, E });

    // ---- Community ----------------------------------------------------------------------

    [SimDbFact]
    public async Task Two_reports_per_36_hours_the_third_is_refused_and_confirming_does_not_count()
    {
        var s = await SeedAsync();
        await ClearReportsAsync();
        var client = Client();
        object Pest(long farm) => new { farmId = farm, category = "pest", subtype = "aphids", severity = "low" };
        Assert.Equal(HttpStatusCode.Created, (await client.SendAsync(As(A, HttpMethod.Post, "/api/farmer/community/reports", Pest(s.FarmA)))).StatusCode);
        var second = await client.SendAsync(As(A, HttpMethod.Post, "/api/farmer/community/reports", Pest(s.FarmA)));
        Assert.Equal(HttpStatusCode.Created, second.StatusCode);
        var third = await client.SendAsync(As(A, HttpMethod.Post, "/api/farmer/community/reports", Pest(s.FarmA)));
        Assert.Equal((HttpStatusCode)429, third.StatusCode);
        Assert.StartsWith("You can add up to 2 reports every 36 hours. You can add another after ", (await Json(third)).GetProperty("error").GetString());

        // B confirms A's report: B can still add 2 of their own.
        var reportId = (await Json(second)).GetProperty("id").GetInt64();
        Assert.Equal(HttpStatusCode.OK, (await client.SendAsync(As(B, HttpMethod.Post, $"/api/farmer/community/reports/{reportId}/confirm", new { farmId = s.FarmB }))).StatusCode);
        var limitB = await Json(await client.SendAsync(As(B, HttpMethod.Get, "/api/farmer/community/limit")));
        Assert.True(limitB.GetProperty("allowed").GetBoolean());

        // 36 hours later A may report again (a clock moved forward).
        var later = new CommunityService(_host.Services.GetRequiredService<NpgsqlDataSource>(), _host.Services.GetRequiredService<AppSettingsStore>(),
            Wind, _host.Services.GetRequiredService<FarmerMessenger>(), _host.Services.GetRequiredService<IAuditWriter>(),
            NullLogger<CommunityService>.Instance, () => DateTimeOffset.UtcNow.AddHours(36.1));
        Assert.True((await later.LimitAsync(A, CancellationToken.None)).Allowed);
    }

    [SimDbFact]
    public async Task Nearby_opted_in_farms_are_told_with_distance_only_and_never_the_reporter()
    {
        var s = await SeedAsync();
        await ClearReportsAsync();
        var client = Client();
        var res = await client.SendAsync(As(A, HttpMethod.Post, "/api/farmer/community/reports",
            new { farmId = s.FarmA, category = "pest", subtype = "fall_armyworm", severity = "moderate", description = "In the maize rows" }));
        Assert.Equal(HttpStatusCode.Created, res.StatusCode);
        var id = (await Json(res)).GetProperty("id").GetInt64();

        // Stored point: the farm's, rounded to 2 decimals (about 1 km).
        Assert.Equal(-25.87m, await Q("select latitude_rounded from community_report where id = $1", id));
        Assert.Equal(25.64m, await Q("select longitude_rounded from community_report where id = $1", id));
        Assert.Equal(1L, await Q("select count(*) from community_notification where report_id = $1 and farm_id = $2", id, s.FarmB));
        Assert.Equal(0L, await Q("select count(*) from community_notification where report_id = $1 and farm_id = $2", id, s.FarmC));   // opted out
        Assert.Equal(0L, await Q("select count(*) from community_notification where report_id = $1 and farm_id = $2", id, s.FarmA));   // the reporter
        var alert = (string)(await Q("select message from alert where farm_id = $1 and message like 'Community alert:%' order by id desc limit 1", s.FarmB))!;
        Assert.Contains("Fall armyworm reported about 35 km from your farm.", alert);
        Assert.Contains("This is a community report and has not been independently verified.", alert);

        var list = await Client().SendAsync(As(B, HttpMethod.Get, $"/api/farmer/farms/{s.FarmB}/community"));
        var text = await list.Content.ReadAsStringAsync();
        Assert.DoesNotContain("a@example.org", text);
        Assert.DoesNotContain(A.ToString(), text);
        Assert.DoesNotContain("-25.865", text);   // never the exact point
        var report = JsonDocument.Parse(text).RootElement.GetProperty("reports").EnumerateArray().First(r => r.GetProperty("reportId").GetInt64() == id);
        Assert.Equal(35.0, Math.Round(report.GetProperty("distanceKm").GetDouble()));
        Assert.False(report.GetProperty("mine").GetBoolean());

        // "I'm seeing this too": once each.
        Assert.Equal(HttpStatusCode.OK, (await client.SendAsync(As(B, HttpMethod.Post, $"/api/farmer/community/reports/{id}/confirm", new { farmId = s.FarmB }))).StatusCode);
        Assert.Equal(HttpStatusCode.Conflict, (await client.SendAsync(As(B, HttpMethod.Post, $"/api/farmer/community/reports/{id}/confirm", new { farmId = s.FarmB }))).StatusCode);
        var again = await Json(await Client().SendAsync(As(B, HttpMethod.Get, $"/api/farmer/farms/{s.FarmB}/community")));
        Assert.Equal(2, again.GetProperty("reports").EnumerateArray().First(r => r.GetProperty("reportId").GetInt64() == id).GetProperty("similarFarms").GetInt32());
    }

    [SimDbFact]
    public async Task A_fire_marks_downwind_farms_escalates_at_three_confirmations_and_out_closes_it()
    {
        var s = await SeedAsync();
        await ClearReportsAsync();
        await Q("update app_setting set value = '30' where key = 'community.radius_km.fire'");   // 35 km is outside 30
        try
        {
            Wind.From = 270;
            var client = Client();
            var res = await client.SendAsync(As(A, HttpMethod.Post, "/api/farmer/community/reports",
                new { farmId = s.FarmA, category = "fire", subtype = "veld_fire", severity = "high" }));
            Assert.Equal(HttpStatusCode.Created, res.StatusCode);
            var id = (await Json(res)).GetProperty("id").GetInt64();
            Assert.Equal("downwind", await Q("select priority from community_notification where report_id = $1 and farm_id = $2 and kind = 'report'", id, s.FarmB));
            var msg = (string)(await Q("select message from community_notification where report_id = $1 and farm_id = $2", id, s.FarmB))!;
            Assert.StartsWith("Fire reported about 35 km away — the wind is blowing towards your farm.", msg);
            Assert.Contains("If you're in danger, leave and call your local emergency number (112 from a mobile phone).", msg);
            Assert.Equal("Critical", await Q("select severity from alert where farm_id = $1 and message like 'Community alert: Fire%' order by id desc limit 1", s.FarmB));

            foreach (var (who, farm) in new[] { (B, s.FarmB), (D, s.FarmD), (E, s.FarmE) })
                Assert.Equal(HttpStatusCode.OK, (await client.SendAsync(As(who, HttpMethod.Post, $"/api/farmer/community/reports/{id}/confirm", new { farmId = farm }))).StatusCode);
            Assert.Equal(true, await Q("select escalated from community_report where id = $1", id));
            Assert.Equal(45.0m, await Q("select radius_km from community_report where id = $1", id));

            // An update re-notifies; a farmer who neither reported nor confirmed cannot post one.
            Assert.Equal(HttpStatusCode.Forbidden, (await client.SendAsync(As(Cc, HttpMethod.Post, $"/api/farmer/community/reports/{id}/updates", new { kind = "spreading", direction = "east" }))).StatusCode);
            var spread = await client.SendAsync(As(A, HttpMethod.Post, $"/api/farmer/community/reports/{id}/updates", new { kind = "spreading", direction = "east" }));
            Assert.Equal(HttpStatusCode.OK, spread.StatusCode);
            var update = (string)(await Q("select message from community_notification where report_id = $1 and farm_id = $2 and kind = 'update'", id, s.FarmB))!;
            Assert.StartsWith("Update: the fire reported about 35 km from your farm is spreading towards the east.", update);

            var outRes = await client.SendAsync(As(B, HttpMethod.Post, $"/api/farmer/community/reports/{id}/updates", new { kind = "out" }));
            Assert.Equal(HttpStatusCode.OK, outRes.StatusCode);
            Assert.Equal("closed", await Q("select status from community_report where id = $1", id));
            Assert.Equal(HttpStatusCode.NotFound, (await client.SendAsync(As(Cc, HttpMethod.Post, $"/api/farmer/community/reports/{id}/confirm", new { farmId = s.FarmC }))).StatusCode);
        }
        finally
        {
            await Q("update app_setting set value = '50' where key = 'community.radius_km.fire'");
        }
    }

    [SimDbFact]
    public async Task Staff_hide_a_report_with_a_reason_it_stops_notifying_and_reports_expire()
    {
        var s = await SeedAsync();
        await ClearReportsAsync();
        var client = Client();
        var res = await client.SendAsync(As(A, HttpMethod.Post, "/api/farmer/community/reports", new { farmId = s.FarmA, category = "water", subtype = "burst_pipe", severity = "low" }));
        var id = (await Json(res)).GetProperty("id").GetInt64();
        Assert.Equal(HttpStatusCode.Forbidden, (await client.SendAsync(As(A, HttpMethod.Post, $"/api/admin/community/reports/{id}/hide", new { reason = "x" }))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.SendAsync(As(Staff, HttpMethod.Post, $"/api/admin/community/reports/{id}/hide", new { reason = "" }))).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await client.SendAsync(As(Staff, HttpMethod.Post, $"/api/admin/community/reports/{id}/hide", new { reason = "Not a real problem" }))).StatusCode);
        Assert.Equal("hidden", await Q("select status from community_report where id = $1", id));
        Assert.Equal(1L, await Q("select count(*) from admin_audit_log where action = 'community.report_hidden' and entity_id = $1", id.ToString()));
        Assert.Equal(HttpStatusCode.NotFound, (await client.SendAsync(As(B, HttpMethod.Post, $"/api/farmer/community/reports/{id}/confirm", new { farmId = s.FarmB }))).StatusCode);
        var adminList = await Json(await client.SendAsync(As(Staff, HttpMethod.Get, "/api/admin/community/reports")));
        var row = adminList.EnumerateArray().First(r => r.GetProperty("id").GetInt64() == id);
        Assert.Equal("a@example.org", row.GetProperty("reporterEmail").GetString());   // staff see who
        Assert.True(row.GetProperty("reporterHiddenCount").GetInt64() >= 1);

        var res2 = await client.SendAsync(As(B, HttpMethod.Post, "/api/farmer/community/reports", new { farmId = s.FarmB, category = "weather", subtype = "hail", severity = "high" }));
        var id2 = (await Json(res2)).GetProperty("id").GetInt64();
        var later = new CommunityService(_host.Services.GetRequiredService<NpgsqlDataSource>(), _host.Services.GetRequiredService<AppSettingsStore>(),
            Wind, _host.Services.GetRequiredService<FarmerMessenger>(), _host.Services.GetRequiredService<IAuditWriter>(),
            NullLogger<CommunityService>.Instance, () => DateTimeOffset.UtcNow.AddHours(25));
        Assert.True(await later.ExpireAsync(CancellationToken.None) >= 1);
        Assert.Equal("expired", await Q("select status from community_report where id = $1", id2));
    }

    [SimDbFact]
    public async Task Staff_cannot_make_community_reports()
    {
        var s = await SeedAsync();
        var res = await Client().SendAsync(As(Staff, HttpMethod.Post, "/api/farmer/community/reports", new { farmId = s.FarmA, category = "pest", subtype = "aphids", severity = "low" }));
        Assert.True(res.StatusCode is HttpStatusCode.NotFound or HttpStatusCode.Forbidden);
    }

    // ---- Drought ------------------------------------------------------------------------

    [SimDbFact]
    public async Task Drought_mode_turns_on_from_the_farms_own_data_with_a_budget_and_zone_priorities_and_by_hand()
    {
        var s = await SeedAsync();
        await Q("delete from tank_refill where farm_id = $1", s.FarmA);
        await Q("insert into tank_refill (farm_id, litres_added, refilled_at) values ($1, 1000, now())", s.FarmA);   // 20%
        await Q("delete from weather_daily where farm_id = $1", s.FarmA);
        await Q("insert into weather_daily (farm_id, date, tmin_c, tmax_c, precipitation_mm, eto_mm, is_forecast) " +
                "select $1, current_date + g, 15, 33, 0, 6.5, true from generate_series(0, 6) g", s.FarmA);
        await Q("insert into weather_daily (farm_id, date, tmin_c, tmax_c, precipitation_mm, eto_mm, is_forecast) " +
                "select $1, current_date - g, 12, 28, 0, 4.5, false from generate_series(1, 30) g", s.FarmA);
        await Q("update farm set drought_override = null where farm_id = $1", s.FarmA);
        var client = Client();

        var view = await Json(await client.SendAsync(As(A, HttpMethod.Get, $"/api/farmer/farms/{s.FarmA}/drought")));
        Assert.True(view.GetProperty("active").GetBoolean());
        Assert.StartsWith("Drought mode on: tank about 20% full", view.GetProperty("reason").GetString());
        Assert.Contains("not a drought prediction or an official drought declaration", view.GetProperty("honesty").GetString());
        Assert.StartsWith("You have about 1 000 L.", view.GetProperty("budget").GetProperty("text").GetString());
        var zone = view.GetProperty("zones").EnumerateArray().First(z => z.GetProperty("zoneId").GetInt64() == s.ZoneA);
        Assert.Equal("drip", zone.GetProperty("irrigationType").GetString());
        Assert.Contains("FAO Ky", zone.GetProperty("why").GetString());
        Assert.Equal(HttpStatusCode.NotFound, (await client.SendAsync(As(B, HttpMethod.Get, $"/api/farmer/farms/{s.FarmA}/drought"))).StatusCode);

        // By hand, and back to automatic.
        var off = await Json(await client.SendAsync(As(A, HttpMethod.Put, $"/api/farmer/farms/{s.FarmA}/drought", new { mode = "off" })));
        Assert.False(off.GetProperty("active").GetBoolean());
        Assert.False(off.GetProperty("automatic").GetBoolean());
        var auto = await Json(await client.SendAsync(As(A, HttpMethod.Put, $"/api/farmer/farms/{s.FarmA}/drought", new { mode = "auto" })));
        Assert.True(auto.GetProperty("active").GetBoolean());
        Assert.True((long)(await Q("select count(*) from drought_event where farm_id = $1", s.FarmA))! >= 2);

        // Staff see drought farms.
        var farms = await Json(await client.SendAsync(As(Staff, HttpMethod.Get, "/api/admin/drought-farms")));
        Assert.Contains(farms.EnumerateArray(), f => f.GetProperty("farmId").GetInt64() == s.FarmA);

        // More rain than the line: off again (automatic).
        await Q("update weather_daily set precipitation_mm = 3 where farm_id = $1 and is_forecast and date = current_date", s.FarmA);
        await Q("update weather_daily set precipitation_mm = 3 where farm_id = $1 and is_forecast and date = current_date + 1", s.FarmA);
        var rained = await Json(await client.SendAsync(As(A, HttpMethod.Get, $"/api/farmer/farms/{s.FarmA}/drought")));
        Assert.False(rained.GetProperty("active").GetBoolean());
    }

    [SimDbFact]
    public async Task Staff_change_thresholds_within_bounds_audited_and_farmers_cannot()
    {
        await SeedAsync();
        var client = Client();
        Assert.Equal(HttpStatusCode.Forbidden, (await client.SendAsync(As(A, HttpMethod.Get, "/api/admin/settings/drought-community"))).StatusCode);
        var list = await Json(await client.SendAsync(As(Staff, HttpMethod.Get, "/api/admin/settings/drought-community")));
        Assert.True(list.GetArrayLength() >= 26);
        var bad = await client.SendAsync(As(Staff, HttpMethod.Put, "/api/admin/settings/drought-community", new { settings = new[] { new { key = "drought.tank_low_fraction", value = 5 } } }));
        Assert.Equal(HttpStatusCode.BadRequest, bad.StatusCode);
        var ok = await client.SendAsync(As(Staff, HttpMethod.Put, "/api/admin/settings/drought-community", new { settings = new[] { new { key = "fire.emergency_text", value = (object)"10177 or 112 from a mobile phone" } } }));
        Assert.Equal(HttpStatusCode.OK, ok.StatusCode);
        Assert.True((long)(await Q("select count(*) from admin_audit_log where action = 'settings.changed' and entity_id = 'fire.emergency_text'"))! >= 1);
        await Q("update app_setting set value = '\"your local emergency number (112 from a mobile phone)\"' where key = 'fire.emergency_text'");
    }

    // ---- The wizard's farm settings --------------------------------------------------------

    [SimDbFact]
    public async Task The_wizard_saves_water_source_irrigation_type_and_alert_choices_and_flags_a_wrong_location_for_staff()
    {
        var s = await SeedAsync();
        var client = Client();
        Assert.Equal(HttpStatusCode.OK, (await client.SendAsync(As(A, HttpMethod.Put, $"/api/farmer/farms/{s.FarmA}/water-source", new { waterSource = "borehole" }))).StatusCode);
        Assert.Equal("borehole", await Q("select water_source from farm where farm_id = $1", s.FarmA));
        Assert.Equal(HttpStatusCode.NotFound, (await client.SendAsync(As(B, HttpMethod.Put, $"/api/farmer/farms/{s.FarmA}/water-source", new { waterSource = "tank" }))).StatusCode);
        await Q("update farm set water_source = 'tank' where farm_id = $1", s.FarmA);

        var type = await client.SendAsync(As(A, HttpMethod.Put, $"/api/farmer/zones/{s.ZoneA}/irrigation-type", new { irrigationType = "sprinkler" }));
        Assert.Contains("about 75% of the water reaches the roots", await type.Content.ReadAsStringAsync());
        Assert.Equal("sprinkler", await Q("select irrigation_type from zone where id = $1", s.ZoneA));
        await Q("update zone set irrigation_type = 'drip' where id = $1", s.ZoneA);

        var setup = await Json(await client.SendAsync(As(A, HttpMethod.Get, $"/api/farmer/farms/{s.FarmA}/setup")));
        Assert.Equal(-25.86522, setup.GetProperty("farm").GetProperty("latitude").GetDouble());
        Assert.Equal(5, setup.GetProperty("zones")[0].GetProperty("maxRunMinutes").GetInt32());

        var prefs = new { wateringTelegram = true, lowTankTelegram = false, droughtTelegram = true, communityTelegram = false, weatherTelegram = true, communityOptIn = true, quietStart = "21:00", quietEnd = "06:00" };
        Assert.Equal(HttpStatusCode.OK, (await client.SendAsync(As(A, HttpMethod.Put, "/api/farmer/notification-preferences", prefs))).StatusCode);
        var back = await Json(await client.SendAsync(As(A, HttpMethod.Get, "/api/farmer/notification-preferences")));
        Assert.False(back.GetProperty("communityTelegram").GetBoolean());
        Assert.Equal("21:00", back.GetProperty("quietStart").GetString());

        var flag = await client.SendAsync(As(A, HttpMethod.Post, $"/api/farmer/farms/{s.FarmA}/location-problem", new { note = "The pin is on the neighbour's farm" }));
        Assert.Equal(HttpStatusCode.OK, flag.StatusCode);
        var notices = await Json(await client.SendAsync(As(Staff, HttpMethod.Get, "/api/admin/staff-notices")));
        var notice = notices.EnumerateArray().First(n => n.GetProperty("farmId").GetInt64() == s.FarmA);
        Assert.Contains("neighbour's farm", notice.GetProperty("message").GetString());
        Assert.Equal(HttpStatusCode.OK, (await client.SendAsync(As(Staff, HttpMethod.Post, $"/api/admin/staff-notices/{notice.GetProperty("id").GetInt64()}/resolve"))).StatusCode);

        // Staff set the location: validated, audited.
        Assert.Equal(HttpStatusCode.BadRequest, (await client.SendAsync(As(Staff, HttpMethod.Put, $"/api/admin/farms/{s.FarmA}/location", new { province = "North West", town = "Mahikeng", latitude = 25.86, longitude = 25.64 }))).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await client.SendAsync(As(Staff, HttpMethod.Put, $"/api/admin/farms/{s.FarmA}/location", new { province = "North West", town = "Mahikeng", latitude = -25.86522, longitude = 25.64421 }))).StatusCode);
        Assert.Equal("Mahikeng", await Q("select town from farm where farm_id = $1", s.FarmA));
        Assert.Equal(HttpStatusCode.Forbidden, (await client.SendAsync(As(A, HttpMethod.Put, $"/api/admin/farms/{s.FarmA}/location", new { province = "North West", town = "X", latitude = -25.8, longitude = 25.6 }))).StatusCode);
    }

    [Fact]
    public void Farmer_messages_never_go_to_staff_and_respect_choices_and_quiet_hours()
    {
        var dir = new System.IO.DirectoryInfo(AppContext.BaseDirectory);
        while (dir != null && !System.IO.Directory.Exists(System.IO.Path.Combine(dir.FullName, "backend", "AgroFlow.Api"))) dir = dir.Parent;
        var src = System.IO.File.ReadAllText(System.IO.Path.Combine(dir!.FullName, "backend", "AgroFlow.Api", "Services", "AppSettingsStore.cs"));
        Assert.Contains("p.telegram_alerts_enabled and {StaffTelegram.NotStaffSql}", src);
        Assert.Contains("coalesce(np.community_opt_in, true)", src);
        var nine = DateTimeOffset.Parse("2026-10-20T19:30:00Z");   // 21:30 in South Africa
        Assert.True(FarmerMessenger.InQuietHours(new TimeOnly(21, 0), new TimeOnly(6, 0), nine));
        Assert.False(FarmerMessenger.InQuietHours(new TimeOnly(21, 0), new TimeOnly(6, 0), nine.AddHours(10)));
        Assert.False(FarmerMessenger.InQuietHours(null, null, nine));
    }
}
