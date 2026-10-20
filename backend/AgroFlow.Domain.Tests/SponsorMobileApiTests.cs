using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Security.Claims;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using AgroFlow.Api.Services;
using AgroFlow.Api.Services.Notifications;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Xunit;

namespace AgroFlow.Domain.Tests;

// Sponsor feedback, Part B: the farmer's own Telegram unlink, the language setting and the
// translated Telegram messages.
public class SponsorMobileApiTests : IClassFixture<ApiHost>
{
    private readonly ApiHost _host;
    public SponsorMobileApiTests(ApiHost host) => _host = host;

    private sealed class FakeLinks : ITelegramLinkStore
    {
        public readonly List<Guid> Calls = new();
        public Task<UnlinkResult> UnlinkAsync(Guid profileId, CancellationToken ct)
        {
            Calls.Add(profileId);
            return Task.FromResult(new UnlinkResult(true, true, "Thandi"));
        }
    }

    private sealed class FakeAudit : IAuditWriter
    {
        public readonly List<(string? Actor, string Action, string? EntityId)> Rows = new();
        public Task WriteAsync(ClaimsPrincipal user, string action, string entityType, string? entityId = null,
            long? farmId = null, object? details = null, CancellationToken cancellationToken = default)
        {
            Rows.Add((user.FindFirst("sub")?.Value, action, entityId));
            return Task.CompletedTask;
        }
    }

    private (HttpClient Client, FakeLinks Links, FakeAudit Audit) Client()
    {
        var links = new FakeLinks();
        var audit = new FakeAudit();
        var client = _host.WithWebHostBuilder(b => b.ConfigureTestServices(s =>
        {
            s.RemoveAll<ITelegramLinkStore>();
            s.AddSingleton<ITelegramLinkStore>(links);
            s.RemoveAll<IAuditWriter>();
            s.AddSingleton<IAuditWriter>(audit);
        })).CreateClient();
        return (client, links, audit);
    }

    private static HttpRequestMessage Req(HttpMethod method, string path, Guid? user, string? body = null)
    {
        var req = new HttpRequestMessage(method, path);
        if (user is { } u) req.Headers.Add(ApiHost.TestAuth.Header, u.ToString());
        if (body != null) req.Content = new StringContent(body, Encoding.UTF8, "application/json");
        return req;
    }

    // Unlink Telegram from the app (Settings)

    [Fact]
    public async Task A_farmer_unlinks_their_own_telegram_through_the_shared_service()
    {
        var (client, links, audit) = Client();
        var res = await client.SendAsync(Req(HttpMethod.Delete, "/api/telegram/me", ApiHost.Farmer));

        Assert.Equal(HttpStatusCode.NoContent, res.StatusCode);
        Assert.Equal(new[] { ApiHost.Farmer }, links.Calls);   // only their own row
        var row = Assert.Single(audit.Rows);
        Assert.Equal(ApiHost.Farmer.ToString(), row.Actor);
        Assert.Equal("telegram.unlinked", row.Action);
        Assert.Equal(ApiHost.Farmer.ToString(), row.EntityId);
    }

    [Fact]
    public async Task Unlinking_your_own_telegram_needs_a_login()
    {
        var (client, links, _) = Client();
        var res = await client.SendAsync(Req(HttpMethod.Delete, "/api/telegram/me", user: null));
        Assert.Equal(HttpStatusCode.Unauthorized, res.StatusCode);
        Assert.Empty(links.Calls);
    }

    // Language

    [Theory]
    [InlineData("{\"language\":\"fr\"}")]
    [InlineData("{\"language\":\"\"}")]
    [InlineData("{}")]
    public async Task Only_english_afrikaans_and_setswana_are_accepted(string body)
    {
        var (client, _, _) = Client();
        var res = await client.SendAsync(Req(HttpMethod.Put, "/api/farmer/language", ApiHost.Farmer, body));
        Assert.Equal(HttpStatusCode.BadRequest, res.StatusCode);
        Assert.Contains("Setswana (tn)", await res.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task Setting_the_language_needs_a_login()
    {
        var (client, _, _) = Client();
        var res = await client.SendAsync(Req(HttpMethod.Put, "/api/farmer/language", user: null, "{\"language\":\"af\"}"));
        Assert.Equal(HttpStatusCode.Unauthorized, res.StatusCode);
    }

    [Fact]
    public void The_language_migration_is_idempotent_and_matches_the_api()
    {
        var sql = File.ReadAllText(Path.Combine(RepoRoot(), "supabase", "migrations", "0049_profile_language.sql"));
        Assert.Contains("add column if not exists language", sql);
        Assert.Contains("if not exists (", sql);
        Assert.Contains("check (language in ('en', 'af', 'tn'))", sql);
        Assert.Contains("enable row level security", sql);
        Assert.DoesNotContain("grant update", sql, StringComparison.OrdinalIgnoreCase);   // no new client write
        Assert.Equal(new[] { "en", "af", "tn" }, BotText.Languages);
    }

    // Telegram messages

    [Fact]
    public void Every_telegram_text_exists_in_all_three_languages_with_the_same_placeholders()
    {
        var english = BotText.Catalogue["en"];
        foreach (var lang in new[] { "af", "tn" })
        {
            var draft = BotText.Catalogue[lang];
            Assert.Equal(english.Keys.OrderBy(k => k), draft.Keys.OrderBy(k => k));
            foreach (var (key, text) in english)
            {
                Assert.Equal(Placeholders(text), Placeholders(draft[key]));
                Assert.False(string.IsNullOrWhiteSpace(draft[key]), $"{lang}:{key}");
            }
        }
    }

    [Fact]
    public void A_message_is_written_in_the_farmers_language_with_english_as_the_fallback()
    {
        Assert.Equal("This zone needs water", BotText.Get("en", "zone.title"));
        Assert.Equal("Hierdie sone het water nodig", BotText.Get("af", "zone.title"));
        Assert.Equal("Karolo eno e tlhoka metsi", BotText.Get("tn", "zone.title"));
        Assert.Equal("Farm: Nkosi Farm", BotText.Get("en", "farm", ("name", "Nkosi Farm")));
        Assert.Equal("Plaas: Nkosi Farm", BotText.Get("af", "farm", ("name", "Nkosi Farm")));
        // Unknown or missing language: English.
        Assert.Equal("This zone needs water", BotText.Get("fr", "zone.title"));
        Assert.Equal("This zone needs water", BotText.Get(null, "zone.title"));
        Assert.Equal("en", BotText.Normalise("xx"));
        // The tank alert in English is the same sentence the app shows.
        Assert.Equal(AgroFlow.Business.TankPhRules.LowTankMessage, BotText.Get("en", "tank.low"));
    }

    [Fact]
    public void Queued_entries_from_the_phone_are_stored_once()
    {
        // Source-level guard for the three writes the app may resend from its offline queue.
        var root = RepoRoot();
        var manual = File.ReadAllText(Path.Combine(root, "backend", "AgroFlow.Api", "Endpoints", "ManualLogEndpoints.cs"));
        Assert.Contains("where not exists (select 1 from existing)", manual);
        var tank = File.ReadAllText(Path.Combine(root, "backend", "AgroFlow.Domain", "TankPhController.cs"));
        Assert.Contains("db.RefillAlreadyLogged(farmId, at, litres)", tank);
        Assert.Contains("db.FindSoilPh(zoneId, at, ph) ?? db.InsertSoilPh(", tank);
    }

    private static string[] Placeholders(string text) =>
        Regex.Matches(text, @"\{(\w+)\}").Select(m => m.Groups[1].Value).OrderBy(x => x).ToArray();

    private static string RepoRoot()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir != null && !Directory.Exists(Path.Combine(dir.FullName, "supabase", "migrations"))) dir = dir.Parent;
        return dir!.FullName;
    }
}
