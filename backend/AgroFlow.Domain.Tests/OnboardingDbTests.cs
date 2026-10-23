using System;
using System.Net;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using AgroFlow.Api.Services;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Npgsql;
using Xunit;

namespace AgroFlow.Domain.Tests;

// AF-01 / B3-01 on a real database (the kit simulation's local Postgres; Skipped in a plain
// `dotnet test`). The farmer's sign-in is a fake that writes auth.users the way Supabase Auth
// does, so handle_new_auth_user() (0008) makes the profile and farm_member rows as it would live.
public sealed class OnboardingSimHost : SimDbHost
{
    public static readonly FakeAccounts Accounts = new();

    // AGROFLOW_TEST_LOG=1 prints the API's log, to see why a request failed.
    protected override void ConfigureWebHost(Microsoft.AspNetCore.Hosting.IWebHostBuilder builder)
    {
        base.ConfigureWebHost(builder);
        if (Environment.GetEnvironmentVariable("AGROFLOW_TEST_LOG") == "1")
            Microsoft.AspNetCore.Hosting.WebHostBuilderExtensions.ConfigureLogging(builder, l => Microsoft.Extensions.Logging.ConsoleLoggerExtensions.AddConsole(l));
    }

    protected override void ConfigureDatabase(IServiceCollection services)
    {
        base.ConfigureDatabase(services);
        services.RemoveAll<IOnboardingAccounts>();
        services.AddSingleton<IOnboardingAccounts>(Accounts);
    }

    public sealed class FakeAccounts : IOnboardingAccounts
    {
        // Set to make the next account creation fail the way a Supabase outage would.
        public volatile bool FailNext;
        public int Created;

        public async Task<OnboardingAccountResult> CreateAsync(string email, string password, string name, string phone, long farmId, CancellationToken ct)
        {
            if (FailNext)
            {
                FailNext = false;
                return new OnboardingAccountResult(null, "The sign-in service could not be reached. The farm is saved; press Retry to finish.", 503);
            }
            var id = Guid.NewGuid();
            await using var c = new NpgsqlConnection(SimDbHost.ConnectionString);
            await c.OpenAsync(ct);
            await using var cmd = new NpgsqlCommand(
                "insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, jsonb_build_object('invitedFarmId', $3::bigint, 'name', $4::text, 'phone', $5::text))", c);
            cmd.Parameters.AddWithValue(id);
            cmd.Parameters.AddWithValue(email);
            cmd.Parameters.AddWithValue(farmId);
            cmd.Parameters.AddWithValue(name);
            cmd.Parameters.AddWithValue(phone);
            await cmd.ExecuteNonQueryAsync(ct);
            Interlocked.Increment(ref Created);
            return new OnboardingAccountResult(id, null);
        }

        public Task<bool> SetPasswordAsync(Guid userId, string password, CancellationToken ct) => Task.FromResult(true);
    }
}

public class OnboardingDbTests : IClassFixture<OnboardingSimHost>
{
    private readonly OnboardingSimHost _host;
    public OnboardingDbTests(OnboardingSimHost host) => _host = host;

    private static object Sesobe(string email, Guid requestId) => new
    {
        requestId,
        farmer = new { fullName = "Synthetic Sesobe Farmer", email, phone = "082 123 4567" },
        farm = new
        {
            farmName = "Sesobe Test Farm " + requestId.ToString()[..8],
            location = "Sesobe",
            sizeHectares = 0.02,
            latitude = -25.0368,
            longitude = 26.4337,
            province = "North West",
            town = "Sesobe",
            zones = new[]
            {
                new { name = "Maize", sizeHectares = 0.01, cropType = "maize", soilType = "loam", areaM2 = 100.0 },
                new { name = "Spinach", sizeHectares = 0.01, cropType = "leafy_veg", soilType = "loam", areaM2 = 100.0 },
            },
        },
    };

    private async Task<(HttpStatusCode Status, JsonElement Body)> PostAsync(object body)
    {
        var client = _host.CreateClient();
        var r = new HttpRequestMessage(HttpMethod.Post, "/api/farmers/onboard")
        {
            Content = new StringContent(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json"),
        };
        r.Headers.Add(ApiHost.TestAuth.Header, ApiHost.Admin.ToString());
        var response = await client.SendAsync(r);
        var text = await response.Content.ReadAsStringAsync();
        return (response.StatusCode, JsonDocument.Parse(string.IsNullOrEmpty(text) ? "{}" : text).RootElement.Clone());
    }

    private static async Task<object?> ScalarAsync(string sql, params object[] args)
    {
        await using var c = new NpgsqlConnection(SimDbHost.ConnectionString);
        await c.OpenAsync();
        await using var cmd = new NpgsqlCommand(sql, c);
        foreach (var a in args) cmd.Parameters.AddWithValue(a);
        return await cmd.ExecuteScalarAsync();
    }

    private static async Task EnsureAdminAsync()
    {
        await ScalarAsync("insert into auth.users (id, email) values ($1, 'onboard-admin@agroflow.test') on conflict do nothing", ApiHost.Admin);
        await ScalarAsync("insert into profile (id, name, email, role) values ($1, 'Onboard Admin', 'onboard-admin@agroflow.test', 'admin') on conflict (id) do update set role = 'admin'", ApiHost.Admin);
    }

    [SimDbFact]
    public async Task Sesobe_is_onboarded_from_its_coordinates_with_no_town_match_and_a_repeat_creates_nothing()
    {
        await EnsureAdminAsync();
        var id = Guid.NewGuid();
        var email = $"sesobe-{id:N}@example.org";

        var (status, body) = await PostAsync(Sesobe(email, id));
        Assert.True(status == HttpStatusCode.OK, $"{status}: {body}");
        var farmId = body.GetProperty("farmId").GetInt64();
        Assert.False(string.IsNullOrEmpty(body.GetProperty("temporaryPassword").GetString()));
        Assert.Equal("completed", body.GetProperty("operation").GetProperty("status").GetString());

        // The pin is what staff entered, and the place is Sesobe, not a substitute town.
        Assert.Equal(-25.0368, Convert.ToDouble(await ScalarAsync("select latitude from farm where farm_id = $1", farmId)), 4);
        Assert.Equal(26.4337, Convert.ToDouble(await ScalarAsync("select longitude from farm where farm_id = $1", farmId)), 4);
        Assert.Equal("Sesobe", await ScalarAsync("select location from farm where farm_id = $1", farmId));
        Assert.Equal("North West", await ScalarAsync("select province from farm where farm_id = $1", farmId));
        Assert.Equal(2L, await ScalarAsync("select count(*) from zone where farm_id = $1", farmId));
        // New zones start in Manual.
        Assert.Equal(0L, await ScalarAsync("select count(*) from zone where farm_id = $1 and irrigation_mode <> 'manual'", farmId));
        // The farmer owns the farm and must change the temporary password.
        Assert.Equal(true, await ScalarAsync("select f.owner_id is not null from farm f where f.farm_id = $1", farmId));
        Assert.Equal(true, await ScalarAsync("select p.must_change_password from profile p join farm f on f.owner_id = p.id where f.farm_id = $1", farmId));

        // The same submit again (a double click, a lost response): nothing new, no password.
        var (again, againBody) = await PostAsync(Sesobe(email, id));
        Assert.Equal(HttpStatusCode.OK, again);
        Assert.Equal(farmId, againBody.GetProperty("farmId").GetInt64());
        Assert.Equal(JsonValueKind.Null, againBody.GetProperty("temporaryPassword").ValueKind);
        Assert.Equal("done", againBody.GetProperty("operation").GetProperty("offer").GetString());
        Assert.Equal(1L, await ScalarAsync("select count(*) from farm where name = $1", "Sesobe Test Farm " + id.ToString()[..8]));
        Assert.Equal(1L, await ScalarAsync("select count(*) from profile where lower(email) = lower($1)", email));
    }

    [SimDbFact]
    public async Task A_failure_halfway_keeps_the_farm_and_a_retry_continues_the_same_farm_and_farmer()
    {
        await EnsureAdminAsync();
        var id = Guid.NewGuid();
        var email = $"halfway-{id:N}@example.org";

        OnboardingSimHost.Accounts.FailNext = true;
        var (failed, failedBody) = await PostAsync(Sesobe(email, id));
        Assert.NotEqual(HttpStatusCode.OK, failed);
        var op = failedBody.GetProperty("operation");
        Assert.Equal("failed", op.GetProperty("status").GetString());
        Assert.Equal("account", op.GetProperty("lastStep").GetString());
        Assert.True(op.GetProperty("farmSaved").GetBoolean());
        Assert.Equal("retry", op.GetProperty("offer").GetString());
        var farmId = op.GetProperty("farmId").GetInt64();
        Assert.Equal(0L, await ScalarAsync("select count(*) from profile where lower(email) = lower($1)", email));

        var (retried, retriedBody) = await PostAsync(Sesobe(email, id));
        Assert.Equal(HttpStatusCode.OK, retried);
        Assert.Equal(farmId, retriedBody.GetProperty("farmId").GetInt64());
        Assert.Equal(1L, await ScalarAsync("select count(*) from farm where name = $1", "Sesobe Test Farm " + id.ToString()[..8]));
        Assert.Equal(2L, await ScalarAsync("select count(*) from zone where farm_id = $1", farmId));
        Assert.Equal(1L, await ScalarAsync("select count(*) from profile where lower(email) = lower($1)", email));
        Assert.Equal(2, Convert.ToInt32(await ScalarAsync("select attempts from onboarding_request where request_id = $1", id)));
    }

    [SimDbFact]
    public async Task Nothing_is_saved_when_the_location_is_missing_and_a_taken_email_is_refused_before_a_farm_is_made()
    {
        await EnsureAdminAsync();
        var id = Guid.NewGuid();
        var (bad, badBody) = await PostAsync(new
        {
            requestId = id,
            farmer = new { fullName = "No Place", email = $"noplace-{id:N}@example.org", phone = "082 123 4567" },
            farm = new { farmName = "No Place " + id.ToString()[..8], location = "", sizeHectares = 1.0,
                zones = new[] { new { name = "A", sizeHectares = 0.5, cropType = "maize" } } },
        });
        Assert.Equal(HttpStatusCode.BadRequest, bad);
        Assert.Equal("location", badBody.GetProperty("field").GetString());
        Assert.Equal(0L, await ScalarAsync("select count(*) from farm where name = $1", "No Place " + id.ToString()[..8]));

        var (zeros, zerosBody) = await PostAsync(new
        {
            requestId = Guid.NewGuid(),
            farmer = new { fullName = "Zero Phone", email = $"zero-{id:N}@example.org", phone = "000 000 0000" },
            farm = new { farmName = "Zero", location = "Sesobe", sizeHectares = 1.0, latitude = -25.0368, longitude = 26.4337,
                zones = new[] { new { name = "A", sizeHectares = 0.5, cropType = "maize" } } },
        });
        Assert.Equal(HttpStatusCode.BadRequest, zeros);
        Assert.Equal("phone", zerosBody.GetProperty("field").GetString());

        var first = Guid.NewGuid();
        var email = $"taken-{first:N}@example.org";
        Assert.Equal(HttpStatusCode.OK, (await PostAsync(Sesobe(email, first))).Status);
        var (taken, takenBody) = await PostAsync(Sesobe(email, Guid.NewGuid()));
        Assert.Equal(HttpStatusCode.Conflict, taken);
        Assert.Equal("email_taken", takenBody.GetProperty("code").GetString());
    }
}
