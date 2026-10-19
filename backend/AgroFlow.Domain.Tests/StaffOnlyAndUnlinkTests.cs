using System;
using System.Collections.Generic;
using System.Net;
using System.Net.Http;
using System.Security.Claims;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using AgroFlow.Api.Auth;
using AgroFlow.Api.Services;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Xunit;

namespace AgroFlow.Domain.Tests;

// Sponsor feedback, Part A items 3 and 6: only staff get into the admin API, and an
// admin can disconnect a farmer's Telegram (audited) so they re-link with a new code.
public class StaffOnlyAndUnlinkTests : IClassFixture<ApiHost>
{
    private readonly ApiHost _host;
    public StaffOnlyAndUnlinkTests(ApiHost host) => _host = host;

    private static readonly Guid Linked = Guid.Parse("00000000-0000-4000-8000-00000000011a");
    private static readonly Guid NotLinked = Guid.Parse("00000000-0000-4000-8000-00000000011b");

    private sealed class FakeLinks : ITelegramLinkStore
    {
        public readonly List<Guid> Calls = new();
        public Task<UnlinkResult> UnlinkAsync(Guid profileId, CancellationToken ct)
        {
            Calls.Add(profileId);
            return Task.FromResult(
                profileId == Linked ? new UnlinkResult(true, true, "Thandi Nkosi")
                : profileId == NotLinked ? new UnlinkResult(true, false, null)
                : new UnlinkResult(false, false, null));
        }
    }

    private sealed class FakeAudit : IAuditWriter
    {
        public readonly List<(string? Actor, string Action, string EntityType, string? EntityId)> Rows = new();
        public Task WriteAsync(ClaimsPrincipal user, string action, string entityType, string? entityId = null,
            long? farmId = null, object? details = null, CancellationToken cancellationToken = default)
        {
            Rows.Add((user.FindFirst("sub")?.Value, action, entityType, entityId));
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

    private static HttpRequestMessage Req(HttpMethod method, string path, Guid? user)
    {
        var req = new HttpRequestMessage(method, path);
        if (user is { } u) req.Headers.Add(ApiHost.TestAuth.Header, u.ToString());
        return req;
    }

    private static async Task<JsonElement> Json(HttpResponseMessage res) =>
        JsonDocument.Parse(await res.Content.ReadAsStringAsync()).RootElement;

    // Staff only

    [Theory]
    [InlineData("admin", true)]
    [InlineData("field_officer", true)]
    [InlineData("farm_user", false)]
    [InlineData("", false)]
    [InlineData(null, false)]
    [InlineData("Admin", false)] // roles are exact; a case trick does not get in
    public void Only_staff_roles_count_as_staff(string? role, bool staff) =>
        Assert.Equal(staff, StaffRoles.IsStaff(role));

    [Fact]
    public async Task A_farmer_is_told_the_console_is_for_staff()
    {
        var (client, _, _) = Client();
        var res = await client.SendAsync(Req(HttpMethod.Get, "/api/admin/health", ApiHost.Farmer));

        Assert.Equal(HttpStatusCode.Forbidden, res.StatusCode);
        Assert.Equal(StaffRoles.StaffOnlyMessage, (await Json(res)).GetProperty("error").GetString());
    }

    [Fact]
    public async Task A_field_officer_gets_past_the_staff_check()
    {
        var (client, links, _) = Client();
        var res = await client.SendAsync(Req(HttpMethod.Delete, $"/api/telegram/admin/link/{Linked}", ApiHost.FieldOfficer));

        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        Assert.Equal(new[] { Linked }, links.Calls);
    }

    // Unlink Telegram

    [Fact]
    public async Task An_admin_unlinks_a_farmer_and_it_is_audited()
    {
        var (client, links, audit) = Client();
        var res = await client.SendAsync(Req(HttpMethod.Delete, $"/api/telegram/admin/link/{Linked}", ApiHost.Admin));

        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        var body = await Json(res);
        Assert.True(body.GetProperty("wasLinked").GetBoolean());
        Assert.Equal("Thandi Nkosi's Telegram was disconnected. They can connect again with a new code.",
            body.GetProperty("message").GetString());

        Assert.Equal(new[] { Linked }, links.Calls);
        var row = Assert.Single(audit.Rows);
        Assert.Equal(ApiHost.Admin.ToString(), row.Actor);
        Assert.Equal("telegram.unlinked", row.Action);
        Assert.Equal("profile", row.EntityType);
        Assert.Equal(Linked.ToString(), row.EntityId);
    }

    [Fact]
    public async Task Unlinking_a_farmer_with_no_telegram_says_so_and_is_still_audited()
    {
        var (client, _, audit) = Client();
        var res = await client.SendAsync(Req(HttpMethod.Delete, $"/api/telegram/admin/link/{NotLinked}", ApiHost.Admin));

        Assert.Equal(HttpStatusCode.OK, res.StatusCode);
        var body = await Json(res);
        Assert.False(body.GetProperty("wasLinked").GetBoolean());
        Assert.Equal("This farmer had no Telegram connected. They can connect with a new code.",
            body.GetProperty("message").GetString());
        Assert.Single(audit.Rows);
    }

    [Fact]
    public async Task Unlinking_someone_who_does_not_exist_is_404_and_not_audited()
    {
        var (client, _, audit) = Client();
        var res = await client.SendAsync(Req(HttpMethod.Delete,
            "/api/telegram/admin/link/00000000-0000-4000-8000-000000000999", ApiHost.Admin));

        Assert.Equal(HttpStatusCode.NotFound, res.StatusCode);
        Assert.Empty(audit.Rows);
    }

    [Fact]
    public async Task A_farmer_cannot_unlink_anyone()
    {
        var (client, links, audit) = Client();
        var res = await client.SendAsync(Req(HttpMethod.Delete, $"/api/telegram/admin/link/{Linked}", ApiHost.Farmer));

        Assert.Equal(HttpStatusCode.Forbidden, res.StatusCode);
        Assert.Empty(links.Calls);
        Assert.Empty(audit.Rows);
    }

    [Fact]
    public async Task Unlinking_needs_a_login()
    {
        var (client, links, _) = Client();
        var res = await client.SendAsync(Req(HttpMethod.Delete, $"/api/telegram/admin/link/{Linked}", user: null));

        Assert.Equal(HttpStatusCode.Unauthorized, res.StatusCode);
        Assert.Empty(links.Calls);
    }
}
