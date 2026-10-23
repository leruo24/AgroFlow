using System;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Text.Json;
using System.Threading.Tasks;
using AgroFlow.Api.Services;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using Xunit;

namespace AgroFlow.Domain.Tests;

// The two health checks production reported as failing (Railway, deployment b00f36b1), run
// against the migration replay that matches production (0001-0060, the kit simulation's
// Postgres; run-e2e.mjs and run-db-tests.mjs run these):
//   - Weather: weather_daily.fetched_at is timestamptz (0016); it read as a DateTime and the
//     cast to DateTimeOffset threw InvalidCastException (reference health-weather).
//   - Schema: two probes returned regprocedure, which Npgsql cannot read; that was not a
//     PostgresException, so it escaped the probe loop and the whole check said "could not
//     be checked".
// The weather check reads the latest fetched_at across all farms, so this class runs on its
// own (after the parallel ones), and its rows cannot be mixed with another test's.
[CollectionDefinition(nameof(HealthDbTests), DisableParallelization = true)]
public class HealthChecksRunAlone;

[Collection(nameof(HealthDbTests))]
public class HealthDbTests : IClassFixture<SimDbHost>
{
    private readonly SimDbHost _host;
    public HealthDbTests(SimDbHost host) => _host = host;

    private static async Task<NpgsqlConnection> OpenAsync()
    {
        var c = new NpgsqlConnection(SimDbHost.ConnectionString);
        await c.OpenAsync();
        return c;
    }

    private static async Task ExecAsync(string sql, params object[] args)
    {
        await using var c = await OpenAsync();
        await using var cmd = new NpgsqlCommand(sql, c);
        foreach (var a in args) cmd.Parameters.AddWithValue(a);
        await cmd.ExecuteNonQueryAsync();
    }

    // Production has Supabase Storage with the private "reports" bucket; the replay's stand-in
    // is the same empty table docs/test-evidence/migration-replay/replay.mjs uses.
    private static Task WithStorageBucketAsync() => ExecAsync(
        "create schema if not exists storage; " +
        "create table if not exists storage.buckets (id text primary key, name text, public boolean); " +
        "insert into storage.buckets (id, name, public) values ('reports', 'reports', false) on conflict (id) do nothing");

    private async Task<JsonElement> HealthAsync()
    {
        await ExecAsync("insert into auth.users (id, email) values ($1, 'healthadmin@agroflow.test') on conflict do nothing", ApiHost.Admin);
        await ExecAsync("insert into profile (id, name, email, role) values ($1, 'Health Admin', 'healthadmin@agroflow.test', 'admin') " +
                        "on conflict (id) do update set role = 'admin'", ApiHost.Admin);
        var request = new HttpRequestMessage(HttpMethod.Get, "/api/admin/health");
        request.Headers.Add(ApiHost.TestAuth.Header, ApiHost.Admin.ToString());
        var response = await _host.CreateClient().SendAsync(request);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return JsonDocument.Parse(await response.Content.ReadAsStringAsync()).RootElement;
    }

    private static JsonElement Check(JsonElement health, string key) =>
        health.GetProperty("checks").EnumerateArray().Single(c => c.GetProperty("key").GetString() == key);

    [SimDbFact]
    public async Task The_schema_check_runs_every_probe_on_a_production_like_database_and_finds_everything()
    {
        await WithStorageBucketAsync();
        var schema = _host.Services.GetRequiredService<SchemaCheck>();
        var result = await schema.RunAsync();
        Assert.False(result.CouldNotCheck, result.Problem);
        Assert.Empty(result.Missing);
        Assert.Equal(SchemaCheck.ProbedMigrations.Count, result.Present.Count);

        var health = Check(await HealthAsync(), "schema");
        Assert.Equal("ok", health.GetProperty("status").GetString());
        Assert.StartsWith($"All {result.Present.Count} expected objects are present.", health.GetProperty("detail").GetString());
    }

    [SimDbFact]
    public async Task The_weather_check_reads_fetched_at_as_timestamptz_no_data_fresh_and_stale()
    {
        // Its own farm and no other weather rows, so the latest fetched_at is the one set here.
        await using var c = await OpenAsync();
        await using (var clear = new NpgsqlCommand("delete from weather_daily", c)) await clear.ExecuteNonQueryAsync();

        var none = Check(await HealthAsync(), "weather");
        Assert.Equal("warning", none.GetProperty("status").GetString());
        Assert.StartsWith("No weather has been collected yet.", none.GetProperty("detail").GetString());

        long farmId;
        await using (var farm = new NpgsqlCommand(
            "insert into farm (name, location, latitude, longitude) values ('Health weather farm', 'Nowhere', -25.86, 25.64) returning farm_id", c))
            farmId = (long)(await farm.ExecuteScalarAsync())!;

        async Task Fetched(TimeSpan ago)
        {
            await using var w = new NpgsqlCommand(
                "insert into weather_daily (farm_id, date, fetched_at) values ($1, current_date + (random() * 1000)::int, now() - $2) ", c);
            w.Parameters.AddWithValue(farmId);
            w.Parameters.AddWithValue(ago);
            await w.ExecuteNonQueryAsync();
        }

        await Fetched(TimeSpan.FromHours(13));
        var stale = Check(await HealthAsync(), "weather");
        Assert.Equal("warning", stale.GetProperty("status").GetString());
        Assert.StartsWith("Last refreshed 13 hours ago.", stale.GetProperty("detail").GetString());
        Assert.Contains("stale forecasts", stale.GetProperty("detail").GetString());

        await Fetched(TimeSpan.FromMinutes(30));
        var fresh = Check(await HealthAsync(), "weather");
        Assert.Equal("ok", fresh.GetProperty("status").GetString());
        // The age is worked out in UTC: 30 minutes, not 30 minutes plus a time-zone offset.
        Assert.Equal("Last refreshed 30 minutes ago.", fresh.GetProperty("detail").GetString());
        Assert.DoesNotContain("check itself failed", fresh.GetProperty("detail").GetString());

        await using var tidy = new NpgsqlCommand("delete from farm where farm_id = $1", c);
        tidy.Parameters.AddWithValue(farmId);
        await tidy.ExecuteNonQueryAsync();
    }
}
