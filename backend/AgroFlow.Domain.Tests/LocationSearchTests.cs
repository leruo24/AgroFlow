using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Xunit;

namespace AgroFlow.Domain.Tests;

// The admin location picker's town search (docs/drought-community.md, Part 3). Open-Meteo is
// replaced by a fake that answers like it does: names that START with the typed text, from a
// few captured 2026-10-20 results (countryCode=ZA). Nothing leaves the test.
public class LocationSearchTests : IClassFixture<ApiHost>
{
    private readonly ApiHost _host;
    public LocationSearchTests(ApiHost host) => _host = host;

    private sealed record Place(string Name, double Lat, double Lon, string Admin1, string Admin2, string Admin3, string[] AlsoKnownAs);

    // Captured from geocoding-api.open-meteo.com on 2026-10-20.
    private static readonly Place[] Places =
    {
        new("Mahikeng", -25.86522, 25.64421, "North West", "Ngaka Modiri Molema District Municipality", "Mafikeng", new[] { "Mafeking", "Mafikeng" }),
        new("Mafikeng North", -25.75302, 25.61198, "North West", "Ngaka Modiri Molema District Municipality", "Mafikeng", Array.Empty<string>()),
        new("Mafini", -31.5, 29.2, "Eastern Cape", "OR Tambo District Municipality", "Nyandeni", Array.Empty<string>()),
        new("Mafane", -29.1, 26.4, "Free State", "Mangaung Metropolitan Municipality", "Mangaung", Array.Empty<string>()),
        new("Ottoshoop", -25.74916, 25.96766, "North West", "Ngaka Modiri Molema District Municipality", "Ramotshere Moiloa", Array.Empty<string>()),
    };

    private sealed class FakeOpenMeteo : HttpMessageHandler
    {
        public readonly List<string> Asked = new();
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            var q = Uri.UnescapeDataString(System.Web.HttpUtility.ParseQueryString(request.RequestUri!.Query)["name"] ?? "");
            Asked.Add(q);
            var hits = Places.Where(p => new[] { p.Name }.Concat(p.AlsoKnownAs).Any(n => n.StartsWith(q, StringComparison.OrdinalIgnoreCase)))
                .Select(p => new { name = p.Name, latitude = p.Lat, longitude = p.Lon, admin1 = p.Admin1, admin2 = p.Admin2, admin3 = p.Admin3, country = "South Africa" })
                .ToList();
            var json = hits.Count == 0 ? "{}" : JsonSerializer.Serialize(new { results = hits });
            return Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = new StringContent(json, Encoding.UTF8, "application/json") });
        }
    }

    private sealed class Factory : IHttpClientFactory
    {
        private readonly HttpMessageHandler _handler;
        public Factory(HttpMessageHandler handler) => _handler = handler;
        public HttpClient CreateClient(string name) => new(_handler, disposeHandler: false);
    }

    private (HttpClient Client, FakeOpenMeteo Fake) Client()
    {
        var fake = new FakeOpenMeteo();
        var client = _host.WithWebHostBuilder(b => b.ConfigureTestServices(s =>
        {
            s.RemoveAll<IHttpClientFactory>();
            s.AddSingleton<IHttpClientFactory>(new Factory(fake));
        })).CreateClient();
        return (client, fake);
    }

    private static async Task<JsonElement[]> Search(HttpClient client, string q, string? province)
    {
        var url = "/api/admin/locations/search?q=" + Uri.EscapeDataString(q) + (province is null ? "" : "&province=" + Uri.EscapeDataString(province));
        var request = new HttpRequestMessage(HttpMethod.Get, url);
        request.Headers.Add(ApiHost.TestAuth.Header, ApiHost.Admin.ToString());
        var res = await client.SendAsync(request);
        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        return JsonDocument.Parse(await res.Content.ReadAsStringAsync()).RootElement.EnumerateArray().ToArray();
    }

    [Fact]
    public async Task Mafeking_finds_Mahikeng_shown_as_town_district_province()
    {
        var (client, _) = Client();
        var results = await Search(client, "Mafeking", "North West");
        Assert.Equal("Mahikeng", results[0].GetProperty("name").GetString());
        Assert.Equal("Mahikeng, Ngaka Modiri Molema District Municipality, North West", results[0].GetProperty("detail").GetString());
        Assert.Equal(-25.86522, results[0].GetProperty("latitude").GetDouble());
    }

    [Fact]
    public async Task The_province_filter_leaves_out_towns_elsewhere()
    {
        var (client, _) = Client();
        var all = await Search(client, "Maf", null);
        Assert.Contains(all, r => r.GetProperty("name").GetString() == "Mafini");      // Eastern Cape
        var northWest = await Search(client, "Maf", "North West");
        Assert.All(northWest, r => Assert.EndsWith("North West", r.GetProperty("detail").GetString()));
        Assert.DoesNotContain(northWest, r => r.GetProperty("name").GetString() == "Mafini");
    }

    [Fact]
    public async Task A_misspelling_the_provider_does_not_know_falls_back_to_a_shorter_start_and_ranks_by_spelling()
    {
        var (client, fake) = Client();
        var results = await Search(client, "Mahikng", "North West");     // a typo: nothing starts with it
        Assert.Equal("Mahikeng", results[0].GetProperty("name").GetString());
        Assert.Equal("Mahikng", fake.Asked[0]);
        Assert.Contains("Mahik", fake.Asked);                             // the shorter start that found it
    }

    [Fact]
    public async Task A_province_that_is_not_one_of_the_nine_is_refused_and_so_is_a_point_outside_South_Africa()
    {
        var (client, _) = Client();
        var bad = new HttpRequestMessage(HttpMethod.Get, "/api/admin/locations/search?q=Maf&province=Gaborone");
        bad.Headers.Add(ApiHost.TestAuth.Header, ApiHost.Admin.ToString());
        Assert.Equal(HttpStatusCode.BadRequest, (await client.SendAsync(bad)).StatusCode);

        // Harare: outside the rectangle around South Africa. (The rectangle is only a check for
        // typos such as a flipped sign; the province, town search and map pin are the real check.)
        var outside = new HttpRequestMessage(HttpMethod.Get, "/api/admin/locations/reverse?latitude=-17.83&longitude=31.05");
        outside.Headers.Add(ApiHost.TestAuth.Header, ApiHost.Admin.ToString());
        var res = await client.SendAsync(outside);
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
        Assert.Contains("outside South Africa", await res.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task Only_staff_can_search()
    {
        var (client, _) = Client();
        var farmer = new HttpRequestMessage(HttpMethod.Get, "/api/admin/locations/search?q=Maf");
        farmer.Headers.Add(ApiHost.TestAuth.Header, ApiHost.Farmer.ToString());
        Assert.Equal(HttpStatusCode.Forbidden, (await client.SendAsync(farmer)).StatusCode);
    }
}
