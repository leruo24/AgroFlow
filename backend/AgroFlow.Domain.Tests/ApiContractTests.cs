using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;
using Xunit;
using Xunit.Abstractions;

namespace AgroFlow.Domain.Tests;

// Part 2: API contract and permission tests on the REAL route table (ApiHost:
// in memory, no live service reachable).
public class ApiContractTests : IClassFixture<ApiHost>
{
    private readonly ApiHost _host;
    private readonly ITestOutputHelper _out;

    public ApiContractTests(ApiHost host, ITestOutputHelper output)
    {
        _host = host;
        _out = output;
    }

    public sealed record Route(string Method, string Pattern, bool Authorized, bool Anonymous);

    private List<Route> Routes()
    {
        _host.CreateClient().Dispose(); // builds the app
        var sources = _host.Services.GetServices<EndpointDataSource>();
        return sources.SelectMany(s => s.Endpoints).OfType<RouteEndpoint>()
            .SelectMany(e =>
            {
                var methods = e.Metadata.GetMetadata<HttpMethodMetadata>()?.HttpMethods ?? new[] { "GET" };
                var auth = e.Metadata.GetOrderedMetadata<IAuthorizeData>().Any();
                var anon = e.Metadata.GetMetadata<IAllowAnonymous>() != null;
                // A group's "" route reads "/api/x/"; routing treats it as "/api/x".
                var pattern = "/" + (e.RoutePattern.RawText ?? "").Trim('/');
                return methods.Select(m => new Route(m, pattern, auth && !anon, anon));
            })
            .Where(r => r.Pattern.StartsWith("/api/", StringComparison.Ordinal))
            .Distinct()
            .OrderBy(r => r.Pattern, StringComparer.Ordinal).ThenBy(r => r.Method, StringComparer.Ordinal)
            .ToList();
    }

    private static string Concrete(string pattern) =>
        Regex.Replace(pattern, @"\{([^}:]+)(:([^}]+))?\}", m => m.Groups[3].Value switch
        {
            "long" or "int" => "1",
            "guid" => "00000000-0000-4000-8000-000000000001",
            _ => "x",
        });

    private async Task<HttpResponseMessage> Send(Route r, Guid? user, string? body = "{}", string? apiKey = null)
    {
        var client = _host.CreateClient();
        var req = new HttpRequestMessage(new HttpMethod(r.Method), Concrete(r.Pattern));
        if (user is { } u) req.Headers.Add(ApiHost.TestAuth.Header, u.ToString());
        if (apiKey != null) req.Headers.Add("X-Api-Key", apiKey);
        if (r.Method is "POST" or "PUT" or "PATCH" && body != null) req.Content = new StringContent(body, Encoding.UTF8, "application/json");
        return await client.SendAsync(req);
    }

    [Fact]
    public void Every_baseline_route_still_exists()
    {
        var baseline = File.ReadAllText(Path.Combine(RepoRoot(), "docs", "reports", "actionable", "baseline.md"));
        var block = baseline.Split("## API routes")[1].Split("```")[1];
        var expected = block.Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Select(l => Regex.Match(l, @"^(GET|POST|PUT|DELETE|PATCH)\s+(\S+)$"))
            .Where(m => m.Success)
            .Select(m => $"{m.Groups[1].Value} {m.Groups[2].Value}")
            .ToList();
        Assert.Equal(73, expected.Count);

        var now = Routes().Select(r => $"{r.Method} {r.Pattern}").ToHashSet();
        foreach (var r in now.OrderBy(x => x, StringComparer.Ordinal)) _out.WriteLine(r);
        var missing = expected.Where(e => !now.Contains(e)).ToList();
        Assert.Empty(missing);
        _out.WriteLine($"{now.Count} routes now; all {expected.Count} baseline routes present.");
    }

    // Every route anyone can call with no login. A new one must be added
    // here on purpose - an accidentally open route fails this test.
    private static readonly string[] ExpectedOpen =
    {
        "GET /api/devices/config",
        "GET /api/devices/firmware-check",
        "GET /api/devices/mqtt-credentials",
        "GET /api/public/legal",
        "GET /api/public/legal/{key}",
        "GET /api/public/service-price",
        "GET /api/public/ping",
        "POST /api/auth/forgot-password",
        "POST /api/auth/one-tap",
        "POST /api/auth/reset-password",
        "POST /api/devices/claim",
        "POST /api/devices/commands/{id}/executed",
        "POST /api/irrigation-events",
        "POST /api/public/enquiries",
        "POST /api/sensor-readings",
        "POST /api/telegram/webhook",
    };

    [Fact]
    public void Only_the_known_routes_are_open_without_a_login()
    {
        var open = Routes().Where(r => !r.Authorized).Select(r => $"{r.Method} {r.Pattern}").OrderBy(x => x, StringComparer.Ordinal).ToList();
        foreach (var o in open) _out.WriteLine(o);
        Assert.Equal(ExpectedOpen.OrderBy(x => x, StringComparer.Ordinal), open);
    }

    [Fact]
    public async Task Without_a_login_every_protected_route_answers_401()
    {
        var wrong = new List<string>();
        foreach (var r in Routes().Where(r => r.Authorized))
        {
            var res = await Send(r, user: null);
            if (res.StatusCode != HttpStatusCode.Unauthorized) wrong.Add($"{r.Method} {r.Pattern} -> {(int)res.StatusCode}");
        }
        Assert.Empty(wrong);
    }

    /// Admin-only areas: the console's routes.
    private static bool IsAdminArea(string p) =>
        p.StartsWith("/api/admin", StringComparison.Ordinal) ||
        p.StartsWith("/api/farms", StringComparison.Ordinal) ||
        p.StartsWith("/api/users", StringComparison.Ordinal) ||
        p.StartsWith("/api/farmers/", StringComparison.Ordinal) ||
        p.StartsWith("/api/telegram/admin", StringComparison.Ordinal) ||
        p == "/api/devices/enroll";

    [Fact]
    public async Task A_farmer_gets_403_from_every_admin_route()
    {
        var routes = Routes().Where(r => r.Authorized && IsAdminArea(r.Pattern)).ToList();
        Assert.True(routes.Count >= 50, $"only {routes.Count} admin routes found");

        var wrong = new List<string>();
        foreach (var r in routes)
        {
            var res = await Send(r, ApiHost.Farmer);
            if (res.StatusCode != HttpStatusCode.Forbidden) wrong.Add($"{r.Method} {r.Pattern} -> {(int)res.StatusCode}");
        }
        foreach (var w in wrong) _out.WriteLine(w);
        Assert.Empty(wrong);
    }

    [Fact]
    public async Task The_public_enquiry_form_is_reachable_without_a_login_or_device_key()
    {
        // The honeypot path answers before any database work, so this proves
        // the request gets through every gate to the endpoint itself.
        var r = new Route("POST", "/api/public/enquiries", false, true);
        var res = await Send(r, user: null, body: "{\"website\":\"http://bot.example\",\"consent\":true}");
        var text = await res.Content.ReadAsStringAsync();
        Assert.True(res.StatusCode == HttpStatusCode.OK, $"{(int)res.StatusCode}: {text}");
        Assert.Contains("a representative will call you", text);
    }

    [Fact]
    public async Task Device_data_without_the_device_key_is_refused()
    {
        var r = new Route("POST", "/api/sensor-readings", false, false);
        Assert.Equal(HttpStatusCode.Unauthorized, (await Send(r, user: null)).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await Send(r, user: null, apiKey: "wrong-key")).StatusCode);
    }

    // AGROFLOW_WRITE_EVIDENCE=1: the route table as evidence (the contract audit).
    [Fact]
    public void Writes_the_route_list_when_asked()
    {
        if (Environment.GetEnvironmentVariable("AGROFLOW_WRITE_EVIDENCE") != "1") return;
        var routes = Routes();
        var lines = new List<string>
        {
            "# API routes (contract audit)", "",
            $"{routes.Count} routes, read from the running API's own route table by `ApiContractTests`. "
            + "All 73 baseline routes are present (`Every_baseline_route_still_exists`).", "",
            "| Method | Route | Who may call it |", "|---|---|---|",
        };
        foreach (var r in routes)
        {
            var who = !r.Authorized ? "anyone (device key/token or public by design)"
                : IsAdminArea(r.Pattern) ? "admins only (403 for a farmer)" : "any signed-in user, their own data only";
            lines.Add($"| {r.Method} | `{r.Pattern}` | {who} |");
        }
        File.WriteAllLines(Path.Combine(RepoRoot(), "docs", "test-evidence", "api-routes.md"), lines);
    }

    private static string RepoRoot()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir != null && !Directory.Exists(Path.Combine(dir.FullName, "docs", "reports", "actionable"))) dir = dir.Parent;
        return dir!.FullName;
    }
}
