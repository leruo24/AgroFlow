using System;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using AgroFlow.Api.Services;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace AgroFlow.Domain.Tests;

// Admin polish, item 8: one CORS policy from Cors:AllowedOrigins plus the
// local dev origins, applied once - and error answers keep the header, or a
// browser shows "Failed to fetch" instead of the API's sentence.
public class CorsTests : IClassFixture<ApiHost>
{
    private const string Listed = "https://admin.agroflow.example";
    private const string Unlisted = "https://evil.example";

    private readonly WebApplicationFactory<Program> _app;

    public CorsTests(ApiHost host)
    {
        _app = host.WithWebHostBuilder(b =>
        {
            b.UseSetting("Cors:AllowedOrigins:0", Listed + "/");   // a trailing slash is forgiven
            // A route that fails the way a bug does, to see a real 500.
            b.ConfigureTestServices(s => s.AddSingleton<IStartupFilter>(new BoomFilter()));
        });
    }

    private sealed class BoomFilter : IStartupFilter
    {
        public Action<IApplicationBuilder> Configure(Action<IApplicationBuilder> next) => app =>
        {
            next(app);
            app.Run(ctx => ctx.Request.Path == "/test/boom"
                ? throw new InvalidOperationException("boom")
                : Task.CompletedTask);
        };
    }

    private async Task<HttpResponseMessage> Get(string path, string origin, string? apiKey = null)
    {
        var req = new HttpRequestMessage(HttpMethod.Get, path);
        req.Headers.Add("Origin", origin);
        if (apiKey != null) req.Headers.Add("X-Api-Key", apiKey);
        return await _app.CreateClient().SendAsync(req);
    }

    private static string? AllowOrigin(HttpResponseMessage res) =>
        res.Headers.TryGetValues("Access-Control-Allow-Origin", out var v) ? v.Single() : null;

    [Fact]
    public async Task A_listed_origin_is_allowed_and_an_unlisted_one_is_not()
    {
        var ok = await Get("/api/public/ping", Listed);
        Assert.Equal(HttpStatusCode.OK, ok.StatusCode);
        Assert.Equal(Listed, AllowOrigin(ok));

        var other = await Get("/api/public/ping", Unlisted);
        Assert.Null(AllowOrigin(other));
    }

    [Fact]
    public async Task The_local_dev_origins_are_allowed()
    {
        foreach (var origin in CorsSetup.LocalDevOrigins)
            Assert.Equal(origin, AllowOrigin(await Get("/api/public/ping", origin)));
    }

    [Fact]
    public async Task A_preflight_from_a_listed_origin_allows_the_headers_the_apps_send()
    {
        var req = new HttpRequestMessage(HttpMethod.Options, "/api/admin/dismissals");
        req.Headers.Add("Origin", Listed);
        req.Headers.Add("Access-Control-Request-Method", "POST");
        req.Headers.Add("Access-Control-Request-Headers", "authorization,content-type");
        var res = await _app.CreateClient().SendAsync(req);

        Assert.True(res.IsSuccessStatusCode, ((int)res.StatusCode).ToString());
        Assert.Equal(Listed, AllowOrigin(res));
        var headers = string.Join(",", res.Headers.GetValues("Access-Control-Allow-Headers")).ToLowerInvariant();
        Assert.Contains("authorization", headers);
        Assert.Contains("content-type", headers);

        var refused = new HttpRequestMessage(HttpMethod.Options, "/api/admin/dismissals");
        refused.Headers.Add("Origin", Unlisted);
        refused.Headers.Add("Access-Control-Request-Method", "POST");
        Assert.Null(AllowOrigin(await _app.CreateClient().SendAsync(refused)));
    }

    [Fact]
    public async Task A_401_still_carries_the_header()
    {
        var res = await Get("/api/admin/dismissals", Listed);
        Assert.Equal(HttpStatusCode.Unauthorized, res.StatusCode);
        Assert.Equal(Listed, AllowOrigin(res));
    }

    [Fact]
    public async Task A_500_still_carries_the_header()
    {
        // The device key gets it past the shared-key gate to the failing route.
        var res = await Get("/test/boom", Listed, ApiHost.ApiKey);
        Assert.Equal(HttpStatusCode.InternalServerError, res.StatusCode);
        Assert.Contains("Something went wrong on our side", await res.Content.ReadAsStringAsync());
        Assert.Equal(Listed, AllowOrigin(res));
    }

    [Fact]
    public async Task A_503_from_a_dead_database_still_carries_the_header()
    {
        var req = new HttpRequestMessage(HttpMethod.Post, "/api/public/enquiries")
        {
            Content = new StringContent(
                "{\"fullName\":\"Thandi Nkosi\",\"phone\":\"082 123 4567\",\"province\":\"Gauteng\",\"town\":\"Soweto\","
                + "\"crops\":[\"maize\"],\"bestTime\":\"morning\",\"consent\":true,\"website\":\"\"}",
                Encoding.UTF8, "application/json"),
        };
        req.Headers.Add("Origin", Listed);
        var res = await _app.CreateClient().SendAsync(req);
        Assert.Equal(HttpStatusCode.ServiceUnavailable, res.StatusCode);
        Assert.Equal(Listed, AllowOrigin(res));
    }

    [Fact]
    public void Program_registers_and_applies_CORS_exactly_once()
    {
        var program = File.ReadAllText(Path.Combine(RepoRoot(), "backend", "AgroFlow.Api", "Program.cs"));
        var code = Regex.Replace(program, @"//.*", "");   // comments may mention them
        Assert.Equal(0, Regex.Matches(code, @"\.AddCors\(").Count);
        Assert.Equal(1, Regex.Matches(code, @"\.AddAgroFlowCors\(").Count);
        Assert.Equal(1, Regex.Matches(code, @"\.UseCors\(").Count);
        Assert.Contains("UseCors(CorsSetup.PolicyName)", code);
    }

    private static string RepoRoot()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir != null && !Directory.Exists(Path.Combine(dir.FullName, "supabase", "migrations"))) dir = dir.Parent;
        return dir?.FullName ?? throw new InvalidOperationException("repo root not found");
    }
}
