using System.Globalization;
using System.Security.Claims;
using Npgsql;
using NpgsqlTypes;

namespace AgroFlow.Api.Services;

// Dismiss and history for notifications.
// A dismissal only hides one notification; it never deletes anything. Each one is a
// row (migration 0045) with who and when from the login, an optional note, and who
// restored it and when. Admin dismissals and restores also go to admin_audit_log.
// Security: a farmer may only dismiss or restore items on their own farms.

/// What the client asks to dismiss, never who: that comes from the login.
public sealed record DismissRequest(
    string? Kind, string? ItemKey, string? Title, DateTimeOffset? RaisedAt,
    bool Critical, string? ConditionKey, string? Note);

public sealed record DismissalRow(
    long Id, string Audience, string Kind, string ItemKey, long? FarmId, string Title, DateTimeOffset? RaisedAt,
    bool Critical, string? ConditionKey, string DismissedByName, DateTimeOffset DismissedAt, string? Note,
    string? RestoredByName, DateTimeOffset? RestoredAt);

/// A farmer's item as the database knows it: which farm, what it said, when.
public sealed record FarmerItem(long FarmId, string Title, DateTimeOffset? RaisedAt, bool Critical);

public sealed record NewDismissal(
    string Audience, string Kind, string ItemKey, long? FarmId, string Title, DateTimeOffset? RaisedAt,
    bool Critical, string? ConditionKey, string? Note);

public interface IDismissalStore
{
    Task<bool> IsReadyAsync(CancellationToken ct);
    Task<FarmerItem?> FindFarmerItemAsync(string kind, string itemKey, CancellationToken ct);
    Task<bool> CanAccessFarmAsync(Guid profileId, long farmId, CancellationToken ct);
    Task<long> InsertAsync(NewDismissal row, Guid actor, CancellationToken ct);
    Task<DismissalRow?> GetAsync(long id, CancellationToken ct);
    Task RestoreAsync(long id, Guid actor, CancellationToken ct);

    /// Closes a critical dismissal once its condition has cleared, so the next time it
    /// happens it shows again. Recorded as AgroFlow, not a person.
    Task ClearAsync(long id, CancellationToken ct);
    Task<IReadOnlyList<DismissalRow>> ListAsync(string audience, long? farmId, CancellationToken ct);

    /// Keeps ai_recommendation.dismissed_at in step for an insight.
    Task SetInsightDismissedAsync(string itemKey, Guid? by, bool dismissed, CancellationToken ct);
}

/// The audit log as the dismissal rules use it, so tests can watch it.
public interface IAuditWriter
{
    Task WriteAsync(ClaimsPrincipal user, string action, string entityType, string? entityId = null,
        long? farmId = null, object? details = null, CancellationToken cancellationToken = default);
}

public sealed record Outcome(int Status, object Body)
{
    public IResult ToResult() => Results.Json(Body, statusCode: Status);
}

public sealed class DismissalService
{
    public const string NeedsMigration = "Dismissing needs database migration 0045, which has not been applied yet.";
    public static readonly string[] AdminKinds = { "alert", "attention", "health" };
    public static readonly string[] FarmerKinds = { "alert", "insight" };
    public const int MaxNote = 500;

    private readonly IDismissalStore _store;
    private readonly IAuditWriter _audit;

    public DismissalService(IDismissalStore store, IAuditWriter audit)
    {
        _store = store;
        _audit = audit;
    }

    private static bool TryUser(ClaimsPrincipal user, out Guid id) =>
        Guid.TryParse(user.FindFirstValue("sub") ?? user.FindFirstValue(ClaimTypes.NameIdentifier), out id);

    private static Outcome Bad(string error) => new(400, new { error });
    private static Outcome Forbidden(string error) => new(403, new { error });
    private static Outcome NotFound() => new(404, new { error = "That notification could not be found." });

    /// The key that names one day's insight for one zone.
    public static string InsightKey(long zoneId, string insightType, DateOnly validFor) =>
        $"{zoneId}:{insightType}:{validFor.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)}";

    private static string? CheckCommon(DismissRequest r)
    {
        if (string.IsNullOrWhiteSpace(r.ItemKey) || r.ItemKey.Length > 200) return "Which notification?";
        if ((r.Note?.Length ?? 0) > MaxNote) return $"Keep the note under {MaxNote} characters.";
        return null;
    }

    // Admin

    public async Task<Outcome> AdminDismissAsync(ClaimsPrincipal user, DismissRequest r, CancellationToken ct)
    {
        if (!TryUser(user, out var me)) return new(401, new { error = "Sign in again." });
        if (r.Kind is null || !AdminKinds.Contains(r.Kind)) return Bad("Unknown kind of notification.");
        if (CheckCommon(r) is { } problem) return Bad(problem);
        if (string.IsNullOrWhiteSpace(r.Title) || r.Title.Length > 300) return Bad("Say what the notification was.");
        if (!await _store.IsReadyAsync(ct)) return new(409, new { error = NeedsMigration });

        var id = await _store.InsertAsync(new NewDismissal("admin", r.Kind, r.ItemKey!.Trim(), null, r.Title.Trim(), r.RaisedAt,
            r.Critical, r.ConditionKey, string.IsNullOrWhiteSpace(r.Note) ? null : r.Note.Trim()), me, ct);
        await _audit.WriteAsync(user, "notification.dismissed", "dismissal", id.ToString(CultureInfo.InvariantCulture),
            details: new { kind = r.Kind, itemKey = r.ItemKey, title = r.Title, note = r.Note }, cancellationToken: ct);
        return new(200, new { id, message = "Dismissed. It is in History if you need it back." });
    }

    public async Task<Outcome> AdminRestoreAsync(ClaimsPrincipal user, long id, CancellationToken ct)
    {
        if (!TryUser(user, out var me)) return new(401, new { error = "Sign in again." });
        if (!await _store.IsReadyAsync(ct)) return new(409, new { error = NeedsMigration });
        var row = await _store.GetAsync(id, ct);
        if (row is null || row.Audience != "admin") return NotFound();
        if (row.RestoredAt is not null) return new(200, new { id, message = "Already restored." });

        await _store.RestoreAsync(id, me, ct);
        await _audit.WriteAsync(user, "notification.restored", "dismissal", id.ToString(CultureInfo.InvariantCulture),
            details: new { kind = row.Kind, itemKey = row.ItemKey, title = row.Title }, cancellationToken: ct);
        return new(200, new { id, message = "Restored." });
    }

    public const string ClearedBy = "AgroFlow (the condition cleared)";

    /// A critical item's condition has gone (the kit is back, the check is OK), so its
    /// dismissal is closed and it shows again if it recurs.
    public async Task<Outcome> AdminClearAsync(ClaimsPrincipal user, long id, CancellationToken ct)
    {
        if (!TryUser(user, out _)) return new(401, new { error = "Sign in again." });
        if (!await _store.IsReadyAsync(ct)) return new(409, new { error = NeedsMigration });
        var row = await _store.GetAsync(id, ct);
        if (row is null || row.Audience != "admin") return NotFound();
        if (!row.Critical) return Bad("Only a critical item's dismissal closes when its condition clears.");
        if (row.RestoredAt is not null) return new(200, new { id, message = "Already closed." });

        await _store.ClearAsync(id, ct);
        await _audit.WriteAsync(user, "notification.condition_cleared", "dismissal", id.ToString(CultureInfo.InvariantCulture),
            details: new { kind = row.Kind, itemKey = row.ItemKey, title = row.Title }, cancellationToken: ct);
        return new(200, new { id, message = "Closed: the condition cleared." });
    }

    public async Task<Outcome> AdminListAsync(CancellationToken ct) =>
        !await _store.IsReadyAsync(ct)
            ? new(200, Array.Empty<DismissalRow>())
            : new(200, await _store.ListAsync("admin", null, ct));

    // Farmer

    public async Task<Outcome> FarmerDismissAsync(ClaimsPrincipal user, DismissRequest r, CancellationToken ct)
    {
        if (!TryUser(user, out var me)) return new(401, new { error = "Sign in again." });
        if (r.Kind is null || !FarmerKinds.Contains(r.Kind)) return Bad("Unknown kind of notification.");
        if (CheckCommon(r) is { } problem) return Bad(problem);
        if (!await _store.IsReadyAsync(ct)) return new(409, new { error = NeedsMigration });

        var key = r.ItemKey!.Trim();
        var item = await _store.FindFarmerItemAsync(r.Kind, key, ct);
        if (item is null) return NotFound();
        if (!await _store.CanAccessFarmAsync(me, item.FarmId, ct))
            return Forbidden("You can only dismiss notifications for your own farm.");

        // Security: title, time and criticality come from the item itself, not the body.
        var id = await _store.InsertAsync(new NewDismissal("farmer", r.Kind, key, item.FarmId, item.Title, item.RaisedAt,
            item.Critical, null, string.IsNullOrWhiteSpace(r.Note) ? null : r.Note.Trim()), me, ct);
        if (r.Kind == "insight") await _store.SetInsightDismissedAsync(key, me, true, ct);
        return new(200, new { id, message = "Dismissed." });
    }

    public async Task<Outcome> FarmerRestoreAsync(ClaimsPrincipal user, long id, CancellationToken ct)
    {
        if (!TryUser(user, out var me)) return new(401, new { error = "Sign in again." });
        if (!await _store.IsReadyAsync(ct)) return new(409, new { error = NeedsMigration });
        var row = await _store.GetAsync(id, ct);
        if (row is null || row.Audience != "farmer" || row.FarmId is null) return NotFound();
        if (!await _store.CanAccessFarmAsync(me, row.FarmId.Value, ct))
            return Forbidden("You can only restore notifications for your own farm.");
        if (row.RestoredAt is not null) return new(200, new { id, message = "Already restored." });

        await _store.RestoreAsync(id, me, ct);
        if (row.Kind == "insight") await _store.SetInsightDismissedAsync(row.ItemKey, null, false, ct);
        return new(200, new { id, message = "Restored." });
    }

    public async Task<Outcome> FarmerListAsync(ClaimsPrincipal user, long farmId, CancellationToken ct)
    {
        if (!TryUser(user, out var me)) return new(401, new { error = "Sign in again." });
        if (!await _store.CanAccessFarmAsync(me, farmId, ct)) return Forbidden("That is not your farm.");
        if (!await _store.IsReadyAsync(ct)) return new(200, Array.Empty<DismissalRow>());
        return new(200, await _store.ListAsync("farmer", farmId, ct));
    }
}

// The database side. Without 0045 the lists are empty and writes answer 409
// "needs migration 0045".
public sealed class DbDismissalStore : IDismissalStore
{
    private readonly NpgsqlDataSource _dataSource;
    public DbDismissalStore(NpgsqlDataSource dataSource) => _dataSource = dataSource;

    public async Task<bool> IsReadyAsync(CancellationToken ct)
    {
        await using var c = await _dataSource.OpenConnectionAsync(ct);
        await using var cmd = new NpgsqlCommand("select to_regclass('public.dismissal') is not null", c);
        return await cmd.ExecuteScalarAsync(ct) is true;
    }

    public async Task<FarmerItem?> FindFarmerItemAsync(string kind, string itemKey, CancellationToken ct)
    {
        await using var c = await _dataSource.OpenConnectionAsync(ct);
        NpgsqlCommand cmd;
        if (kind == "alert")
        {
            if (!long.TryParse(itemKey, NumberStyles.None, CultureInfo.InvariantCulture, out var alertId)) return null;
            cmd = new NpgsqlCommand(
                """
                select coalesce(a.farm_id, z.farm_id), coalesce(a.message, 'Alert'), a.created_at,
                       coalesce(a.severity, '') in ('Critical', 'High', 'critical', 'high')
                  from alert a left join zone z on z.id = a.zone_id
                 where a.id = $1
                """, c);
            cmd.Parameters.AddWithValue(alertId);
        }
        else
        {
            var parts = itemKey.Split(':');
            if (parts.Length != 3 || !long.TryParse(parts[0], out var zoneId)
                || !DateOnly.TryParseExact(parts[2], "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var day)) return null;
            cmd = new NpgsqlCommand(
                """
                select z.farm_id, r.message, r.valid_for::timestamptz, r.severity = 'act_now'
                  from ai_recommendation r join zone z on z.id = r.zone_id
                 where r.zone_id = $1 and r.insight_type = $2 and r.valid_for = $3
                """, c);
            cmd.Parameters.AddWithValue(zoneId);
            cmd.Parameters.AddWithValue(parts[1]);
            cmd.Parameters.AddWithValue(NpgsqlDbType.Date, day);
        }
        await using (cmd)
        await using (var r = await cmd.ExecuteReaderAsync(ct))
        {
            if (!await r.ReadAsync(ct)) return null;
            return new FarmerItem(r.GetInt64(0), r.IsDBNull(1) ? "Notification" : r.GetString(1),
                r.IsDBNull(2) ? null : r.GetFieldValue<DateTimeOffset>(2), !r.IsDBNull(3) && r.GetBoolean(3));
        }
    }

    public async Task<bool> CanAccessFarmAsync(Guid profileId, long farmId, CancellationToken ct)
    {
        await using var c = await _dataSource.OpenConnectionAsync(ct);
        await using var cmd = new NpgsqlCommand(
            """
            select exists (select 1 from farm f where f.farm_id = $1 and f.owner_id = $2)
                or exists (select 1 from farm_member fm where fm.farm_id = $1 and fm.profile_id = $2)
            """, c);
        cmd.Parameters.AddWithValue(farmId);
        cmd.Parameters.AddWithValue(profileId);
        return await cmd.ExecuteScalarAsync(ct) is true;
    }

    public async Task<long> InsertAsync(NewDismissal d, Guid actor, CancellationToken ct)
    {
        await using var c = await _dataSource.OpenConnectionAsync(ct);
        await using var cmd = new NpgsqlCommand(
            """
            insert into dismissal (audience, item_kind, item_key, farm_id, title, raised_at, critical, condition_key, note,
                                   dismissed_by_profile_id, dismissed_by_name)
            values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
                    coalesce((select coalesce(nullif(name, ''), email) from profile where id = $10), 'Unknown'))
            returning id
            """, c);
        cmd.Parameters.AddWithValue(d.Audience);
        cmd.Parameters.AddWithValue(d.Kind);
        cmd.Parameters.AddWithValue(d.ItemKey);
        cmd.Parameters.AddWithValue(NpgsqlDbType.Bigint, (object?)d.FarmId ?? DBNull.Value);
        cmd.Parameters.AddWithValue(d.Title);
        cmd.Parameters.AddWithValue(NpgsqlDbType.TimestampTz, d.RaisedAt is { } t ? t.ToUniversalTime() : DBNull.Value);
        cmd.Parameters.AddWithValue(d.Critical);
        cmd.Parameters.AddWithValue(NpgsqlDbType.Text, (object?)d.ConditionKey ?? DBNull.Value);
        cmd.Parameters.AddWithValue(NpgsqlDbType.Text, (object?)d.Note ?? DBNull.Value);
        cmd.Parameters.AddWithValue(actor);
        return (long)(await cmd.ExecuteScalarAsync(ct))!;
    }

    private const string Columns =
        "id, audience, item_kind, item_key, farm_id, title, raised_at, critical, condition_key, dismissed_by_name, " +
        "dismissed_at, note, restored_by_name, restored_at";

    private static DismissalRow Read(NpgsqlDataReader r) => new(
        r.GetInt64(0), r.GetString(1), r.GetString(2), r.GetString(3), r.IsDBNull(4) ? null : r.GetInt64(4), r.GetString(5),
        r.IsDBNull(6) ? null : r.GetFieldValue<DateTimeOffset>(6), r.GetBoolean(7), r.IsDBNull(8) ? null : r.GetString(8),
        r.GetString(9), r.GetFieldValue<DateTimeOffset>(10), r.IsDBNull(11) ? null : r.GetString(11),
        r.IsDBNull(12) ? null : r.GetString(12), r.IsDBNull(13) ? null : r.GetFieldValue<DateTimeOffset>(13));

    public async Task<DismissalRow?> GetAsync(long id, CancellationToken ct)
    {
        await using var c = await _dataSource.OpenConnectionAsync(ct);
        await using var cmd = new NpgsqlCommand($"select {Columns} from dismissal where id = $1", c);
        cmd.Parameters.AddWithValue(id);
        await using var r = await cmd.ExecuteReaderAsync(ct);
        return await r.ReadAsync(ct) ? Read(r) : null;
    }

    public async Task RestoreAsync(long id, Guid actor, CancellationToken ct)
    {
        await using var c = await _dataSource.OpenConnectionAsync(ct);
        await using var cmd = new NpgsqlCommand(
            """
            update dismissal
               set restored_at = now(), restored_by_profile_id = $2,
                   restored_by_name = coalesce((select coalesce(nullif(name, ''), email) from profile where id = $2), 'Unknown')
             where id = $1 and restored_at is null
            """, c);
        cmd.Parameters.AddWithValue(id);
        cmd.Parameters.AddWithValue(actor);
        await cmd.ExecuteNonQueryAsync(ct);
    }

    public async Task ClearAsync(long id, CancellationToken ct)
    {
        await using var c = await _dataSource.OpenConnectionAsync(ct);
        await using var cmd = new NpgsqlCommand(
            "update dismissal set restored_at = now(), restored_by_name = $2 where id = $1 and restored_at is null", c);
        cmd.Parameters.AddWithValue(id);
        cmd.Parameters.AddWithValue(DismissalService.ClearedBy);
        await cmd.ExecuteNonQueryAsync(ct);
    }

    public async Task<IReadOnlyList<DismissalRow>> ListAsync(string audience, long? farmId, CancellationToken ct)
    {
        await using var c = await _dataSource.OpenConnectionAsync(ct);
        await using var cmd = new NpgsqlCommand(
            $"select {Columns} from dismissal where audience = $1 and ($2::bigint is null or farm_id = $2) " +
            "order by dismissed_at desc limit 500", c);
        cmd.Parameters.AddWithValue(audience);
        cmd.Parameters.AddWithValue(NpgsqlDbType.Bigint, (object?)farmId ?? DBNull.Value);
        var rows = new List<DismissalRow>();
        await using var r = await cmd.ExecuteReaderAsync(ct);
        while (await r.ReadAsync(ct)) rows.Add(Read(r));
        return rows;
    }

    public async Task SetInsightDismissedAsync(string itemKey, Guid? by, bool dismissed, CancellationToken ct)
    {
        var parts = itemKey.Split(':');
        if (parts.Length != 3 || !long.TryParse(parts[0], out var zoneId)
            || !DateOnly.TryParseExact(parts[2], "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var day)) return;
        await using var c = await _dataSource.OpenConnectionAsync(ct);
        await using var cmd = new NpgsqlCommand(
            """
            update ai_recommendation
               set dismissed_at = case when $4 then now() else null end,
                   dismissed_by_profile_id = $5
             where zone_id = $1 and insight_type = $2 and valid_for = $3
            """, c);
        cmd.Parameters.AddWithValue(zoneId);
        cmd.Parameters.AddWithValue(parts[1]);
        cmd.Parameters.AddWithValue(NpgsqlDbType.Date, day);
        cmd.Parameters.AddWithValue(dismissed);
        cmd.Parameters.AddWithValue(NpgsqlDbType.Uuid, (object?)by ?? DBNull.Value);
        await cmd.ExecuteNonQueryAsync(ct);
    }
}
