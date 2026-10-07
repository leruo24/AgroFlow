using System.Net;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using Xunit;
using Xunit.Abstractions;

namespace AgroFlow.Domain.Tests;

// Part 2: when what the API depends on is gone - in ApiHost the database and
// the MQTT broker are unreachable by construction - the API still answers,
// health says what is down, and a person gets a sentence, never a bare 500.
public class DependencyFailureTests : IClassFixture<ApiHost>
{
    private readonly ApiHost _host;
    private readonly ITestOutputHelper _out;

    public DependencyFailureTests(ApiHost host, ITestOutputHelper output)
    {
        _host = host;
        _out = output;
    }

    [Fact]
    public async Task Health_answers_and_names_the_database_and_broker_as_down()
    {
        var client = _host.CreateClient();
        var req = new HttpRequestMessage(HttpMethod.Get, "/api/admin/health");
        req.Headers.Add(ApiHost.TestAuth.Header, ApiHost.Admin.ToString());
        var res = await client.SendAsync(req);
        var body = await res.Content.ReadAsStringAsync();
        _out.WriteLine(body);

        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        using var doc = JsonDocument.Parse(body);
        Assert.Equal("down", doc.RootElement.GetProperty("overall").GetString());

        string StatusOf(string key)
        {
            foreach (var c in doc.RootElement.GetProperty("checks").EnumerateArray())
                if (c.GetProperty("key").GetString() == key) return c.GetProperty("status").GetString()!;
            return "missing";
        }

        Assert.Equal("down", StatusOf("database"));
        Assert.NotEqual("ok", StatusOf("mqtt"));
        Assert.Equal("ok", StatusOf("api"));
    }

    [Fact]
    public async Task An_enquiry_while_the_database_is_down_gets_a_sentence_not_a_bare_500()
    {
        var client = _host.CreateClient();
        var form = "{\"fullName\":\"Thandi Nkosi\",\"phone\":\"082 123 4567\",\"province\":\"Gauteng\",\"town\":\"Soweto\","
                   + "\"crops\":[\"maize\"],\"bestTime\":\"morning\",\"consent\":true,\"website\":\"\"}";
        var res = await client.PostAsync("/api/public/enquiries", new StringContent(form, Encoding.UTF8, "application/json"));
        var body = await res.Content.ReadAsStringAsync();
        _out.WriteLine($"{(int)res.StatusCode} {body}");

        Assert.Equal(HttpStatusCode.ServiceUnavailable, res.StatusCode);
        Assert.Contains("try again", body);
    }

    [Fact]
    public void An_unreachable_broker_is_down_after_two_minutes_a_blip_is_amber()
    {
        var now = System.DateTimeOffset.UtcNow;
        Assert.Equal("ok", AgroFlow.Api.Endpoints.HealthEndpoints.MqttCheck(true, null, now).Status);
        Assert.Equal("warning", AgroFlow.Api.Endpoints.HealthEndpoints.MqttCheck(false, now.AddSeconds(-30), now).Status);
        Assert.Equal("warning", AgroFlow.Api.Endpoints.HealthEndpoints.MqttCheck(false, now.AddSeconds(-119), now).Status);
        var down = AgroFlow.Api.Endpoints.HealthEndpoints.MqttCheck(false, now.AddMinutes(-5), now);
        Assert.Equal("down", down.Status);
        Assert.Contains("5 minutes", down.Detail);
    }

    [Fact]
    public async Task Any_route_with_the_database_down_answers_503_with_a_sentence()
    {
        var client = _host.CreateClient();
        var req = new HttpRequestMessage(HttpMethod.Get, "/api/farmer/dashboard");
        req.Headers.Add(ApiHost.TestAuth.Header, ApiHost.Farmer.ToString());
        var res = await client.SendAsync(req);
        var body = await res.Content.ReadAsStringAsync();
        _out.WriteLine($"{(int)res.StatusCode} {body}");

        Assert.Equal(HttpStatusCode.ServiceUnavailable, res.StatusCode);
        Assert.Contains("cannot reach its database", body);
        Assert.DoesNotContain("Npgsql", body);      // no internals to the caller
    }
}
