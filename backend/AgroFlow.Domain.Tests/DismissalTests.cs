using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Claims;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using AgroFlow.Api.Services;
using Xunit;

namespace AgroFlow.Domain.Tests;

// Admin polish, item 1: dismiss, history and restore - who and when from the
// login, never deleted, admin steps audited, farmers only on their own farm.
public class DismissalTests
{
    private static readonly Guid Admin = Guid.Parse("00000000-0000-4000-8000-0000000000ad");
    private static readonly Guid FarmerA = Guid.Parse("00000000-0000-4000-8000-0000000000a1");
    private static readonly Guid FarmerB = Guid.Parse("00000000-0000-4000-8000-0000000000b1");
    private const long FarmA = 1, FarmB = 2;

    private static ClaimsPrincipal User(Guid id) => new(new ClaimsIdentity(new[] { new Claim("sub", id.ToString()) }, "test"));

    private sealed class FakeStore : IDismissalStore
    {
        public bool Ready = true;
        public readonly List<(DismissalRow Row, Guid By)> Rows = new();
        public readonly List<(string Key, Guid? By, bool Dismissed)> InsightSync = new();
        public readonly Dictionary<Guid, long> FarmOf = new() { [FarmerA] = FarmA, [FarmerB] = FarmB };

        public Task<bool> IsReadyAsync(CancellationToken ct) => Task.FromResult(Ready);

        public Task<FarmerItem?> FindFarmerItemAsync(string kind, string itemKey, CancellationToken ct) =>
            Task.FromResult<FarmerItem?>(itemKey switch
            {
                "10" => new FarmerItem(FarmA, "Kit offline on Tub 1", DateTimeOffset.Parse("2026-10-06T06:00:00Z"), true),
                "20" => new FarmerItem(FarmB, "Farm B's alert", null, false),
                "7:water_now:2026-10-06" => new FarmerItem(FarmA, "Water Tub 1 now", null, true),
                _ => null,
            });

        public Task<bool> CanAccessFarmAsync(Guid profileId, long farmId, CancellationToken ct) =>
            Task.FromResult(FarmOf.TryGetValue(profileId, out var f) && f == farmId);

        public Task<long> InsertAsync(NewDismissal d, Guid actor, CancellationToken ct)
        {
            var id = Rows.Count + 1L;
            Rows.Add((new DismissalRow(id, d.Audience, d.Kind, d.ItemKey, d.FarmId, d.Title, d.RaisedAt, d.Critical, d.ConditionKey,
                $"name-of-{actor}", DateTimeOffset.UtcNow, d.Note, null, null), actor));
            return Task.FromResult(id);
        }

        public Task<DismissalRow?> GetAsync(long id, CancellationToken ct) =>
            Task.FromResult(Rows.Select(r => r.Row).FirstOrDefault(r => r.Id == id));

        public Task RestoreAsync(long id, Guid actor, CancellationToken ct)
        {
            var i = Rows.FindIndex(r => r.Row.Id == id);
            Rows[i] = (Rows[i].Row with { RestoredAt = DateTimeOffset.UtcNow, RestoredByName = $"name-of-{actor}" }, Rows[i].By);
            return Task.CompletedTask;
        }

        public Task ClearAsync(long id, CancellationToken ct)
        {
            var i = Rows.FindIndex(r => r.Row.Id == id);
            Rows[i] = (Rows[i].Row with { RestoredAt = DateTimeOffset.UtcNow, RestoredByName = DismissalService.ClearedBy }, Rows[i].By);
            return Task.CompletedTask;
        }

        public Task<IReadOnlyList<DismissalRow>> ListAsync(string audience, long? farmId, CancellationToken ct) =>
            Task.FromResult<IReadOnlyList<DismissalRow>>(Rows.Select(r => r.Row)
                .Where(r => r.Audience == audience && (farmId is null || r.FarmId == farmId)).ToList());

        public Task SetInsightDismissedAsync(string itemKey, Guid? by, bool dismissed, CancellationToken ct)
        {
            InsightSync.Add((itemKey, by, dismissed));
            return Task.CompletedTask;
        }
    }

    private sealed class FakeAudit : IAuditWriter
    {
        public readonly List<(string Actor, string Action, string? EntityId)> Rows = new();
        public Task WriteAsync(ClaimsPrincipal user, string action, string entityType, string? entityId = null,
            long? farmId = null, object? details = null, CancellationToken cancellationToken = default)
        {
            Rows.Add((user.FindFirst("sub")!.Value, action, entityId));
            return Task.CompletedTask;
        }
    }

    private static (DismissalService S, FakeStore Store, FakeAudit Audit) Make()
    {
        var store = new FakeStore();
        var audit = new FakeAudit();
        return (new DismissalService(store, audit), store, audit);
    }

    private static DismissRequest AdminReq(string kind, string key, bool critical = false, string? note = null) =>
        new(kind, key, "Kits offline or faulty: 2", DateTimeOffset.UtcNow, critical, critical ? "hw:4,9" : null, note);

    [Fact]
    public async Task An_admin_dismissal_is_recorded_with_who_and_audited_and_restore_is_too()
    {
        var (s, store, audit) = Make();
        var res = await s.AdminDismissAsync(User(Admin), AdminReq("attention", "go-kits-offline", critical: true, note: "Technician booked"), default);
        Assert.Equal(200, res.Status);

        var (row, by) = Assert.Single(store.Rows);
        Assert.Equal(Admin, by);                                 // from the login
        Assert.Equal("admin", row.Audience);
        Assert.Equal("Technician booked", row.Note);
        Assert.Equal("hw:4,9", row.ConditionKey);
        Assert.Equal((Admin.ToString(), "notification.dismissed", "1"), Assert.Single(audit.Rows));

        Assert.Equal(200, (await s.AdminRestoreAsync(User(Admin), 1, default)).Status);
        Assert.NotNull(store.Rows[0].Row.RestoredAt);
        Assert.Equal("notification.restored", audit.Rows[1].Action);

        // Restoring twice changes nothing and is not audited twice.
        await s.AdminRestoreAsync(User(Admin), 1, default);
        Assert.Equal(2, audit.Rows.Count);
        Assert.Single(store.Rows);                               // never deleted
    }

    [Theory]
    [InlineData("insight")]   // not an admin-side kind
    [InlineData("anything")]
    [InlineData(null)]
    public async Task Admin_kinds_are_checked(string? kind)
    {
        var (s, store, _) = Make();
        Assert.Equal(400, (await s.AdminDismissAsync(User(Admin), new DismissRequest(kind, "x", "t", null, false, null, null), default)).Status);
        Assert.Empty(store.Rows);
    }

    [Fact]
    public async Task Long_notes_and_a_missing_migration_are_refused_plainly()
    {
        var (s, store, _) = Make();
        Assert.Equal(400, (await s.AdminDismissAsync(User(Admin), AdminReq("health", "mqtt", note: new string('x', 501)), default)).Status);
        store.Ready = false;
        var res = await s.AdminDismissAsync(User(Admin), AdminReq("health", "mqtt"), default);
        Assert.Equal(409, res.Status);
        Assert.Empty(store.Rows);
    }

    [Fact]
    public async Task A_farmer_dismisses_their_own_alert_with_its_real_title_and_no_admin_audit()
    {
        var (s, store, audit) = Make();
        // The body's title is ignored: it comes from the alert itself.
        var res = await s.FarmerDismissAsync(User(FarmerA), new DismissRequest("alert", "10", "made-up title", null, false, null, "Fixed the plug"), default);
        Assert.Equal(200, res.Status);
        var row = Assert.Single(store.Rows).Row;
        Assert.Equal(("farmer", FarmA, "Kit offline on Tub 1", true), (row.Audience, row.FarmId!.Value, row.Title, row.Critical));
        Assert.Empty(audit.Rows);
    }

    [Fact]
    public async Task A_farmer_cannot_dismiss_or_restore_another_farm_s_items()
    {
        var (s, store, _) = Make();
        Assert.Equal(403, (await s.FarmerDismissAsync(User(FarmerA), new DismissRequest("alert", "20", null, null, false, null, null), default)).Status);
        Assert.Empty(store.Rows);

        await s.FarmerDismissAsync(User(FarmerB), new DismissRequest("alert", "20", null, null, false, null, null), default);
        Assert.Equal(403, (await s.FarmerRestoreAsync(User(FarmerA), 1, default)).Status);
        Assert.Null(store.Rows[0].Row.RestoredAt);

        // Nor list it, nor reach an admin dismissal.
        Assert.Equal(403, (await s.FarmerListAsync(User(FarmerA), FarmB, default)).Status);
        await s.AdminDismissAsync(User(Admin), AdminReq("health", "mqtt"), default);
        Assert.Equal(404, (await s.FarmerRestoreAsync(User(FarmerA), 2, default)).Status);
    }

    [Fact]
    public async Task Dismissing_an_insight_keeps_dismissed_at_in_step_and_restoring_clears_it()
    {
        var (s, store, _) = Make();
        var key = DismissalService.InsightKey(7, "water_now", new DateOnly(2026, 10, 6));
        Assert.Equal("7:water_now:2026-10-06", key);

        await s.FarmerDismissAsync(User(FarmerA), new DismissRequest("insight", key, null, null, false, null, null), default);
        await s.FarmerRestoreAsync(User(FarmerA), 1, default);
        Assert.Equal(new[] { (key, (Guid?)FarmerA, true), (key, (Guid?)null, false) }, store.InsightSync);
    }

    [Fact]
    public async Task Unknown_items_are_404_and_the_body_names_no_actor()
    {
        var (s, _, _) = Make();
        Assert.Equal(404, (await s.FarmerDismissAsync(User(FarmerA), new DismissRequest("alert", "999", null, null, false, null, null), default)).Status);
        Assert.DoesNotContain(typeof(DismissRequest).GetProperties(), p => p.Name.Contains("By") || p.Name.Contains("Actor") || p.Name.Contains("Profile"));
    }

    // ---- RLS and the old route ----------------------------------------------

    private static string Root()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir != null && !Directory.Exists(Path.Combine(dir.FullName, "supabase"))) dir = dir.Parent;
        return dir!.FullName;
    }

    [Fact]
    public void RLS_lets_admins_read_all_farmers_only_their_farms_and_nobody_write()
    {
        var sql = File.ReadAllText(Path.Combine(Root(), "supabase", "migrations", "0045_dismissal.sql"));
        Assert.Contains("alter table dismissal enable row level security", sql);
        Assert.Matches(new Regex(@"dismissal_select_admin\s+on dismissal\s+for select\s+to authenticated\s+using \(app_is_admin\(\)\)"), sql);
        Assert.Matches(new Regex(@"using \(audience = 'farmer' and farm_id is not null and app_can_access_farm\(farm_id\)\)"), sql);
        Assert.DoesNotMatch(new Regex(@"for (insert|update|delete|all)", RegexOptions.IgnoreCase), sql);
        Assert.DoesNotMatch(new Regex(@"grant (insert|update|delete)", RegexOptions.IgnoreCase), sql);
        Assert.DoesNotMatch(new Regex(@"\bdrop (table|column)\b|delete from", RegexOptions.IgnoreCase), sql);
    }

    [Fact]
    public void The_app_s_old_dismiss_route_no_longer_deletes_the_insight()
    {
        var src = File.ReadAllText(Path.Combine(Root(), "backend", "AgroFlow.Api", "Endpoints", "Fao56EngineEndpoints.cs"));
        var body = src[src.IndexOf("DismissInsight(", src.IndexOf("private static", StringComparison.Ordinal), StringComparison.Ordinal)..];
        body = body[..body.IndexOf("private static bool TryGetUserId", StringComparison.Ordinal)];
        Assert.DoesNotContain("ClearInsight", body);
        Assert.Contains("FarmerDismissAsync", body);
    }

    [Fact]
    public async Task A_critical_dismissal_closes_when_its_condition_clears_so_a_recurrence_shows()
    {
        var (s, store, audit) = Make();
        await s.AdminDismissAsync(User(Admin), AdminReq("health", "mqtt", critical: true), default);
        await s.AdminDismissAsync(User(Admin), AdminReq("attention", "go-zones-setup"), default);

        Assert.Equal(200, (await s.AdminClearAsync(User(Admin), 1, default)).Status);
        Assert.Equal(DismissalService.ClearedBy, store.Rows[0].Row.RestoredByName);   // AgroFlow, not the viewer
        Assert.Equal("notification.condition_cleared", audit.Rows.Last().Action);
        Assert.Equal(2, store.Rows.Count);                                            // nothing deleted

        // Only critical ones close by themselves.
        Assert.Equal(400, (await s.AdminClearAsync(User(Admin), 2, default)).Status);
        Assert.Null(store.Rows[1].Row.RestoredAt);
    }
}
