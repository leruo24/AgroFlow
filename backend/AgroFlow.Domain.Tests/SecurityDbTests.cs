using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using Npgsql;
using Xunit;
using Xunit.Abstractions;

namespace AgroFlow.Domain.Tests;

// Part D of the audit fixes: a farmer cannot read or change another farmer's farms, zones,
// readings, alerts, commands, requests or reports, and cannot call staff routes. Checked two ways
// on a real database (the kit simulation's Postgres; Skipped in a plain `dotnet test`):
//   1. through the API, as farmer B asking for farmer A's things by id;
//   2. straight against Postgres as the `authenticated` role with farmer B's JWT claims (what
//      the apps' Supabase client does), and as `anon`, so Row Level Security and grants are tested.
// It also writes docs/audit/rls-inventory.md: every table, whether RLS is on, its policies and
// what anon / authenticated are granted.
public class SecurityDbTests : IClassFixture<SimDbHost>
{
    private readonly SimDbHost _host;
    private readonly ITestOutputHelper _out;
    public SecurityDbTests(SimDbHost host, ITestOutputHelper output) { _host = host; _out = output; }

    // Each probe line is also saved under docs/audit/evidence (git-ignored), to read after a run.
    private readonly List<string> _lines = new();
    private void Log(string line) { _out.WriteLine(line); _lines.Add(line); }
    private void Save(string name)
    {
        var root = new DirectoryInfo(AppContext.BaseDirectory);
        while (root != null && !Directory.Exists(Path.Combine(root.FullName, "docs", "audit"))) root = root.Parent;
        var dir = Path.Combine(root!.FullName, "docs", "audit", "evidence");
        Directory.CreateDirectory(dir);
        File.WriteAllLines(Path.Combine(dir, $"security-{name}.txt"), _lines);
    }

    private static readonly Guid A = Guid.Parse("00000000-0000-4000-8000-00000000c00a");
    private static readonly Guid B = Guid.Parse("00000000-0000-4000-8000-00000000c00b");

    private sealed record Victim(long FarmId, long ZoneId, long AlertId, Guid CommandId, long RequestId);
    private static Victim? _victim;

    private static async Task<object?> Q(string sql, params object[] args)
    {
        await using var c = new NpgsqlConnection(SimDbHost.ConnectionString);
        await c.OpenAsync();
        await using var cmd = new NpgsqlCommand(sql, c);
        foreach (var a in args) cmd.Parameters.AddWithValue(a);
        return await cmd.ExecuteScalarAsync();
    }

    private static async Task<Victim> SeedAsync()
    {
        if (_victim is not null) return _victim;
        foreach (var (id, email) in new[] { (A, "victim-a@example.org"), (B, "other-b@example.org") })
        {
            await Q("insert into auth.users (id, email) values ($1, $2) on conflict do nothing", id, email);
            await Q("insert into profile (id, name, email, role) values ($1, $2, $2, 'farm_user') on conflict (id) do update set role = 'farm_user'", id, email);
        }
        var farmA = (long)(await Q("insert into farm (owner_id, name, location, latitude, longitude) values ($1, 'Victim farm', 'Sesobe', -25.0368, 26.4337) returning farm_id", A))!;
        await Q("insert into farm (owner_id, name, location) values ($1, 'Other farm', 'Elsewhere')", B);
        var zoneA = (long)(await Q("insert into zone (farm_id, name, crop_type) values ($1, 'Victim zone', 'maize') returning id", farmA))!;
        await Q("insert into sensor_reading (zone_id, sensor_type, value) values ($1, 'SoilMoisture', 41)", zoneA);
        await Q("insert into irrigation_event (zone_id, runtime_seconds, estimated_litres, trigger_source, sync_status) values ($1, 60, 6, 'manual', 'synced')", zoneA);
        var alert = (long)(await Q("insert into alert (zone_id, farm_id, severity, message) values ($1, $2, 'warning', 'Victim alert') returning id", zoneA, farmA))!;
        var command = (Guid)(await Q("insert into irrigation_commands (zone_id, command, source, duration_seconds, status) values ($1, 'start', 'manual', 60, 'failed') returning id", zoneA))!;
        var request = (long)(await Q("insert into service_request (farmer_id, farm_id, request_type, crop_type) values ($1, $2, 'new_zone', 'maize') returning id", A, farmA))!;
        return _victim = new Victim(farmA, zoneA, alert, command, request);
    }

    private async Task<HttpStatusCode> As(Guid who, HttpMethod method, string path, object? body = null)
    {
        var r = new HttpRequestMessage(method, path);
        r.Headers.Add(ApiHost.TestAuth.Header, who.ToString());
        if (body is not null) r.Content = new StringContent(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json");
        var response = await _host.CreateClient().SendAsync(r);
        // A 200 must never carry the other farmer's data.
        if (response.IsSuccessStatusCode)
        {
            var text = await response.Content.ReadAsStringAsync();
            Assert.DoesNotContain("Victim", text);
        }
        return response.StatusCode;
    }

    [SimDbFact]
    public async Task A_farmer_cannot_read_or_change_another_farmers_things_through_the_API()
    {
        var v = await SeedAsync();
        var today = DateTime.UtcNow.ToString("yyyy-MM-dd");
        var reads = new[]
        {
            $"/api/farmer/dashboard?farmId={v.FarmId}",
            $"/api/farmer/farms/{v.FarmId}/today",
            $"/api/farmer/farms/{v.FarmId}/journey",
            $"/api/farmer/farms/{v.FarmId}/tank",
            $"/api/farmer/farms/{v.FarmId}/setup",
            $"/api/farmer/farms/{v.FarmId}/drought",
            $"/api/farmer/forecast?zoneId={v.ZoneId}",
            $"/api/farmer/zones/{v.ZoneId}/commands",
            $"/api/farmer/commands/{v.CommandId}",
            $"/api/farmer/zones/{v.ZoneId}/hardware",
            $"/api/farmer/zones/{v.ZoneId}/soil-ph",
            $"/api/farmer/reports/water-usage?farmId={v.FarmId}&from={today}&to={today}",
            $"/api/farmer/reports/water-usage/pdf?farmId={v.FarmId}&from={today}&to={today}",
            $"/api/farmer/service?farmId={v.FarmId}",
        };
        var leaks = new List<string>();
        foreach (var path in reads)
        {
            var status = await As(B, HttpMethod.Get, path);
            Log($"GET {path} as another farmer -> {(int)status}");
            if (status is HttpStatusCode.OK) leaks.Add(path);   // a 200 is allowed only without the data (checked in As)
        }

        var writes = new (HttpMethod Method, string Path, object Body)[]
        {
            (HttpMethod.Put, $"/api/farmer/zones/{v.ZoneId}/settings", new { name = "Taken over" }),
            (HttpMethod.Post, $"/api/farmer/zones/{v.ZoneId}/commands", new { command = "start", durationSeconds = 60 }),
            (HttpMethod.Post, $"/api/farmer/alerts/{v.AlertId}/read", new { }),
            (HttpMethod.Post, $"/api/farmer/farms/{v.FarmId}/tasks/water", new { }),
            (HttpMethod.Post, $"/api/farmer/farms/{v.FarmId}/help", new { topic = "other" }),
            (HttpMethod.Put, $"/api/farmer/farms/{v.FarmId}/tank", new { litres = 9999 }),
            (HttpMethod.Post, $"/api/farmer/zones/{v.ZoneId}/automatic-offer", new { answer = "automatic" }),
            (HttpMethod.Post, $"/api/farmer/requests", new { requestType = "new_zone", farmId = v.FarmId, cropType = "maize" }),
        };
        foreach (var (method, path, body) in writes)
        {
            var status = await As(B, method, path, body);
            Log($"{method} {path} as another farmer -> {(int)status}");
            Assert.True((int)status >= 400, $"{method} {path} answered {(int)status}");
        }

        // Nothing changed.
        Assert.Equal("Victim zone", await Q("select name from zone where id = $1", v.ZoneId));
        Assert.Equal(1L, await Q("select count(*) from irrigation_commands where zone_id = $1", v.ZoneId));
        Assert.Equal(DBNull.Value, await Q("select read_at from alert where id = $1", v.AlertId));
        Assert.Equal(0L, await Q("select count(*) from help_request where farm_id = $1", v.FarmId));
        Assert.Equal(DBNull.Value, await Q("select tank_capacity_litres from farm where farm_id = $1", v.FarmId));
        Log($"200 answers (allowed only without the other farmer's data, checked): {(leaks.Count == 0 ? "none" : string.Join(", ", leaks))}");
        Save("api-isolation");
    }

    [SimDbFact]
    public async Task A_farmer_cannot_call_staff_routes()
    {
        var v = await SeedAsync();
        foreach (var (method, path) in new[]
        {
            (HttpMethod.Get, "/api/farms"),
            (HttpMethod.Get, $"/api/admin/farms/{v.FarmId}/case"),
            (HttpMethod.Post, $"/api/admin/farms/{v.FarmId}/visits"),
            (HttpMethod.Post, $"/api/admin/zones/{v.ZoneId}/checklist/kit_linked"),
            (HttpMethod.Put, $"/api/admin/zones/{v.ZoneId}/mode"),
            (HttpMethod.Get, "/api/admin/health"),
            (HttpMethod.Get, "/api/admin/enquiries"),
            (HttpMethod.Post, "/api/farmers/onboard"),
            (HttpMethod.Get, "/api/users"),
        })
        {
            var status = await As(A, method, path, new { });
            Log($"{method} {path} as a farmer -> {(int)status}");
            Assert.True(status is HttpStatusCode.Forbidden or HttpStatusCode.NotFound, $"{method} {path} answered {(int)status} to a farmer");
        }
        Save("staff-routes");
    }

    // Straight against Postgres, as the apps' Supabase client: role authenticated, farmer B's claims.
    private static async Task<(long Rows, string? Error)> AsClientAsync(string role, Guid? who, string sql, params object[] args)
    {
        await using var c = new NpgsqlConnection(SimDbHost.ConnectionString);
        await c.OpenAsync();
        await using var tx = await c.BeginTransactionAsync();
        await using (var set = new NpgsqlCommand($"set local role {role}", c, tx)) await set.ExecuteNonQueryAsync();
        await using (var claims = new NpgsqlCommand("select set_config('request.jwt.claims', $1, true)", c, tx))
        {
            claims.Parameters.AddWithValue(who is null ? "" : JsonSerializer.Serialize(new { sub = who.ToString(), role }));
            await claims.ExecuteNonQueryAsync();
        }
        try
        {
            await using var cmd = new NpgsqlCommand(sql, c, tx);
            foreach (var a in args) cmd.Parameters.AddWithValue(a);
            var isSelect = sql.TrimStart().StartsWith("select", StringComparison.OrdinalIgnoreCase);
            var rows = isSelect ? Convert.ToInt64(await cmd.ExecuteScalarAsync() ?? 0L) : await cmd.ExecuteNonQueryAsync();
            return (rows, null);
        }
        catch (PostgresException e)
        {
            return (0, e.SqlState);   // 42501: permission denied (no grant)
        }
        finally
        {
            await tx.RollbackAsync();
        }
    }

    [SimDbFact]
    public async Task Row_level_security_keeps_each_farmer_to_their_own_rows()
    {
        var v = await SeedAsync();
        // The owner sees their own rows (so the check below is not passing by accident).
        Assert.Equal(1L, (await AsClientAsync("authenticated", A, "select count(*) from zone where id = $1", v.ZoneId)).Rows);

        var reads = new (string Table, string Sql, object Arg)[]
        {
            ("farm", "select count(*) from farm where farm_id = $1", v.FarmId),
            ("zone", "select count(*) from zone where id = $1", v.ZoneId),
            ("sensor_reading", "select count(*) from sensor_reading where zone_id = $1", v.ZoneId),
            ("irrigation_event", "select count(*) from irrigation_event where zone_id = $1", v.ZoneId),
            ("irrigation_commands", "select count(*) from irrigation_commands where zone_id = $1", v.ZoneId),
            ("alert", "select count(*) from alert where id = $1", v.AlertId),
            ("service_request", "select count(*) from service_request where id = $1", v.RequestId),
            ("report_request", "select count(*) from report_request where farm_id = $1", v.FarmId),
            ("profile", "select count(*) from profile where id = $1", A),
            ("onboarding_request", "select count(*) from onboarding_request where farm_id = $1", v.FarmId),
            ("help_request", "select count(*) from help_request where farm_id = $1", v.FarmId),
            ("terms_acceptance", "select count(*) from terms_acceptance where profile_id = $1", A),
            ("service_case", "select count(*) from service_case where farm_id = $1", v.FarmId),
        };
        foreach (var (table, sql, arg) in reads)
        {
            foreach (var (role, who) in new[] { ("authenticated", (Guid?)B), ("anon", (Guid?)null) })
            {
                var (rows, error) = await AsClientAsync(role, who, sql, arg);
                Log($"{role} reading another farmer's {table}: {(error is null ? $"{rows} row(s)" : $"refused ({error})")}");
                Assert.True(rows == 0, $"{role} read {rows} of another farmer's {table} rows");
            }
        }

        var writes = new (string What, string Sql, object[] Args)[]
        {
            ("rename another farmer's zone", "update zone set name = 'x' where id = $1", new object[] { v.ZoneId }),
            ("start another farmer's pump", "insert into irrigation_commands (zone_id, command, source, duration_seconds) values ($1, 'start', 'manual', 60)", new object[] { v.ZoneId }),
            ("mark another farmer's alert read", "update alert set read_at = now() where id = $1", new object[] { v.AlertId }),
            ("delete another farmer's farm", "delete from farm where farm_id = $1", new object[] { v.FarmId }),
            ("make themselves admin", "update profile set role = 'admin' where id = $1", new object[] { B }),
        };
        foreach (var (what, sql, args) in writes)
        {
            var (rows, error) = await AsClientAsync("authenticated", B, sql, args);
            Log($"authenticated tries to {what}: {(error is null ? $"{rows} row(s)" : $"refused ({error})")}");
            Assert.True(rows == 0, $"a farmer could {what}");
        }
        Assert.Equal("farm_user", await Q("select role from profile where id = $1", B));
        Save("rls");
    }

    [SimDbFact]
    public async Task Every_table_has_rls_on_and_nothing_is_open_to_anon_and_the_inventory_is_written()
    {
        var rows = new List<(string Table, bool Rls, long Policies, string Anon, string Authenticated)>();
        await using (var c = new NpgsqlConnection(SimDbHost.ConnectionString))
        {
            await c.OpenAsync();
            await using var cmd = new NpgsqlCommand("""
                select c.relname, c.relrowsecurity,
                       (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname),
                       coalesce((select string_agg(privilege_type, ', ' order by privilege_type) from information_schema.role_table_grants g
                                  where g.table_schema = 'public' and g.table_name = c.relname and g.grantee = 'anon'), ''),
                       coalesce((select string_agg(privilege_type, ', ' order by privilege_type) from information_schema.role_table_grants g
                                  where g.table_schema = 'public' and g.table_name = c.relname and g.grantee = 'authenticated'), '')
                  from pg_class c join pg_namespace n on n.oid = c.relnamespace
                 where n.nspname = 'public' and c.relkind in ('r', 'p')
                 order by c.relname
                """, c);
            await using var r = await cmd.ExecuteReaderAsync();
            while (await r.ReadAsync()) rows.Add((r.GetString(0), r.GetBoolean(1), r.GetInt64(2), r.GetString(3), r.GetString(4)));
        }

        var lines = new List<string>
        {
            "# Row Level Security and grants: every table",
            "",
            "Generated by `SecurityDbTests` from a database with every migration applied (the kit simulation's",
            "Postgres), 0001 to the latest. Re-run `node hardware/sim/run-db-tests.mjs` to refresh it.",
            "The API connects as the table owner and checks access itself; these are the rules for the",
            "apps' own Supabase logins (`authenticated`) and for no login at all (`anon`).",
            "",
            "| Table | RLS | Policies | anon may | authenticated may |",
            "|---|---|---|---|---|",
        };
        lines.AddRange(rows.Select(x => $"| `{x.Table}` | {(x.Rls ? "on" : "**off**")} | {x.Policies} | {(x.Anon.Length == 0 ? "nothing" : x.Anon)} | {(x.Authenticated.Length == 0 ? "nothing" : x.Authenticated)} |"));
        var root = new DirectoryInfo(AppContext.BaseDirectory);
        while (root != null && !Directory.Exists(Path.Combine(root.FullName, "docs", "audit"))) root = root.Parent;
        File.WriteAllLines(Path.Combine(root!.FullName, "docs", "audit", "rls-inventory.md"), lines);
        foreach (var l in lines) _out.WriteLine(l);

        // irrigation_schedule: dropped by 0010 on the live database; kept off-RLS only where it survives.
        var withoutRls = rows.Where(x => !x.Rls && x.Table != "irrigation_schedule").Select(x => x.Table).ToList();
        Assert.True(withoutRls.Count == 0, "RLS off: " + string.Join(", ", withoutRls));
        var anonWrites = rows.Where(x => x.Anon.Contains("INSERT") || x.Anon.Contains("UPDATE") || x.Anon.Contains("DELETE")).Select(x => x.Table).ToList();
        Assert.True(anonWrites.Count == 0, "anon may write: " + string.Join(", ", anonWrites));
    }
}
