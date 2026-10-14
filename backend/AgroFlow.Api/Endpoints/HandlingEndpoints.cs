using System.Globalization;
using System.Security.Claims;
using AgroFlow.Api.Auth;
using AgroFlow.Api.Services;
using AgroFlow.Business;
using Npgsql;
using NpgsqlTypes;

namespace AgroFlow.Api.Endpoints;

// Security: the body says what was done, never who did it. The actor is always
// the logged-in user.
public record TakeOverBody(string? Reason);
public record HandlingActionBody(string? Action, string? Note, string? Date);
public record CreateMaintenanceBody(long? HardwareId, long? FarmId, string? Description, string? Date);

public record HandlingState(
    string Id,
    string? HandledBy,
    string? HandledByName,
    string? ClaimedAt,
    string? ResolvedBy,
    string? ResolvedByName,
    string? ResolvedAt,
    string? EscalatedAt);

// "I'll handle this", "Take over", "Release", and the real actions on alerts and
// maintenance: one set of routes for requests, alerts and maintenance.
// Every step is saved under the caller's own name and written to
// admin_audit_log, which gives each item its timeline.
public static class HandlingEndpoints
{
    private sealed record Kind(string Table, string IdColumn, string EntityType, string? ResolvedColumn, string? ResolvedAtColumn, string FarmSql);

    private static readonly Dictionary<string, Kind> Kinds = new()
    {
        ["requests"] = new("service_request", "id", "service_request", "completed_by_profile_id", "completed_at",
            "select farm_id from service_request where id = $1"),
        ["alerts"] = new("alert", "id", "alert", "resolved_by_profile_id", "resolved_at",
            "select coalesce(a.farm_id, z.farm_id) from alert a left join zone z on z.id = a.zone_id where a.id = $1"),
        ["maintenance"] = new("maintenance", "maintenance_id", "maintenance", "completed_by_profile_id", "completed_at",
            "select farm_id from maintenance where maintenance_id = $1"),
    };

    public const string NeedsMigration =
        "Handling and resolving on the record needs database migration 0041, which has not been applied yet.";

    public static void MapHandlingEndpoints(this WebApplication app)
    {
        var admin = app.MapGroup("/api/admin/handling")
            .RequireAuthorization()
            .AddEndpointFilter<AdminOnlyFilter>();

        admin.MapGet("/{kind}", ListAsync);
        admin.MapPost("/maintenance", CreateMaintenanceAsync);
        admin.MapPost("/{kind}/{id:long}/claim", ClaimAsync);
        admin.MapPost("/{kind}/{id:long}/take-over", TakeOverAsync);
        admin.MapPost("/{kind}/{id:long}/release", ReleaseAsync);
        admin.MapPost("/{kind}/{id:long}/action", ActionAsync);
    }

    // Who is handling what, for list pages. Read through jsonb so a database without
    // 0041 answers "nobody".
    private static async Task<IResult> ListAsync(string kind, NpgsqlDataSource dataSource, CancellationToken ct)
    {
        if (!Kinds.TryGetValue(kind, out var k)) return Results.NotFound(new { error = "No such kind." });

        await using var connection = await dataSource.OpenConnectionAsync(ct);
        await using var cmd = new NpgsqlCommand(
            $"""
            select t.{k.IdColumn},
                   (to_jsonb(t) ->> 'handled_by_profile_id'),
                   (select coalesce(nullif(p.name, ''), p.email) from profile p where p.id = (to_jsonb(t) ->> 'handled_by_profile_id')::uuid),
                   (to_jsonb(t) ->> 'claimed_at')::timestamptz,
                   (to_jsonb(t) ->> '{k.ResolvedColumn}'),
                   (select coalesce(nullif(p.name, ''), p.email) from profile p where p.id = (to_jsonb(t) ->> '{k.ResolvedColumn}')::uuid),
                   (to_jsonb(t) ->> '{k.ResolvedAtColumn}')::timestamptz,
                   (to_jsonb(t) ->> 'escalated_at')::timestamptz
              from {k.Table} t
             where (to_jsonb(t) ->> 'handled_by_profile_id') is not null
                or (to_jsonb(t) ->> '{k.ResolvedColumn}') is not null
                or (to_jsonb(t) ->> 'escalated_at') is not null
            """,
            connection);

        var rows = new List<HandlingState>();
        await using var reader = await cmd.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct))
        {
            rows.Add(new HandlingState(
                reader.GetInt64(0).ToString(CultureInfo.InvariantCulture),
                reader.IsDBNull(1) ? null : reader.GetString(1),
                reader.IsDBNull(2) ? null : reader.GetString(2),
                Iso(reader, 3),
                reader.IsDBNull(4) ? null : reader.GetString(4),
                reader.IsDBNull(5) ? null : reader.GetString(5),
                Iso(reader, 6),
                Iso(reader, 7)));
        }

        return Results.Ok(rows);
    }

    private static async Task<IResult> ClaimAsync(
        string kind, long id, ClaimsPrincipal user, NpgsqlDataSource dataSource, AuditLog audit, CancellationToken ct)
    {
        if (!Kinds.TryGetValue(kind, out var k)) return Results.NotFound(new { error = "No such kind." });
        if (!TryGetUserId(user, out var caller)) return Results.Unauthorized();

        await using var connection = await dataSource.OpenConnectionAsync(ct);
        if (!await MigrationAppliedAsync(connection, k, ct)) return Results.Conflict(new { error = NeedsMigration });

        var current = await CurrentHandlerAsync(connection, k, id, ct);
        if (current is null) return Results.NotFound(new { error = "No such item." });

        var outcome = HandlingRules.Claim(current.Value.Handler, caller);
        if (outcome == HandlingOutcome.HeldByOther)
        {
            return Results.Conflict(new { error = $"{current.Value.Name} is already handling this. Use Take over, with a reason, if you need to." });
        }

        if (outcome == HandlingOutcome.Claimed)
        {
            // Atomic: only claims an item nobody holds, so two admins cannot both win.
            var claimed = await ExecAsync(connection,
                $"update {k.Table} set handled_by_profile_id = $2, claimed_at = now() where {k.IdColumn} = $1 and handled_by_profile_id is null",
                ct, id, caller);
            if (claimed == 0) return Results.Conflict(new { error = "Somebody claimed this a moment ago. Refresh to see who." });

            await audit.WriteAsync(user, "handling.claimed", k.EntityType, id.ToString(CultureInfo.InvariantCulture),
                farmId: await FarmOfAsync(connection, k, id, ct), cancellationToken: ct);
        }

        return Results.Ok(new { message = "You are handling this." });
    }

    private static async Task<IResult> TakeOverAsync(
        string kind, long id, TakeOverBody body, ClaimsPrincipal user, NpgsqlDataSource dataSource, AuditLog audit, CancellationToken ct)
    {
        if (!Kinds.TryGetValue(kind, out var k)) return Results.NotFound(new { error = "No such kind." });
        if (!TryGetUserId(user, out var caller)) return Results.Unauthorized();

        await using var connection = await dataSource.OpenConnectionAsync(ct);
        if (!await MigrationAppliedAsync(connection, k, ct)) return Results.Conflict(new { error = NeedsMigration });

        var current = await CurrentHandlerAsync(connection, k, id, ct);
        if (current is null) return Results.NotFound(new { error = "No such item." });

        switch (HandlingRules.TakeOver(current.Value.Handler, caller, body.Reason))
        {
            case HandlingOutcome.NothingToTakeOver:
                return Results.BadRequest(new { error = "Nobody is handling this - use I'll handle this." });
            case HandlingOutcome.AlreadyYours:
                return Results.Ok(new { message = "You are already handling this." });
            case HandlingOutcome.ReasonRequired:
                return Results.BadRequest(new { error = "Say why you are taking this over - the reason goes on the record with both names." });
        }

        var taken = await ExecAsync(connection,
            $"update {k.Table} set handled_by_profile_id = $2, claimed_at = now() where {k.IdColumn} = $1 and handled_by_profile_id = $3",
            ct, id, caller, current.Value.Handler!.Value);
        if (taken == 0) return Results.Conflict(new { error = "This changed hands a moment ago. Refresh and try again." });

        await audit.WriteAsync(user, "handling.taken_over", k.EntityType, id.ToString(CultureInfo.InvariantCulture),
            farmId: await FarmOfAsync(connection, k, id, ct),
            details: new { from = current.Value.Name, fromProfileId = current.Value.Handler, reason = body.Reason!.Trim() },
            cancellationToken: ct);

        return Results.Ok(new { message = $"You took this over from {current.Value.Name}." });
    }

    private static async Task<IResult> ReleaseAsync(
        string kind, long id, ClaimsPrincipal user, NpgsqlDataSource dataSource, AuditLog audit, CancellationToken ct)
    {
        if (!Kinds.TryGetValue(kind, out var k)) return Results.NotFound(new { error = "No such kind." });
        if (!TryGetUserId(user, out var caller)) return Results.Unauthorized();

        await using var connection = await dataSource.OpenConnectionAsync(ct);
        if (!await MigrationAppliedAsync(connection, k, ct)) return Results.Conflict(new { error = NeedsMigration });

        var current = await CurrentHandlerAsync(connection, k, id, ct);
        if (current is null) return Results.NotFound(new { error = "No such item." });

        switch (HandlingRules.Release(current.Value.Handler, caller))
        {
            case HandlingOutcome.NothingToRelease:
                return Results.Ok(new { message = "Nobody was handling this." });
            case HandlingOutcome.NotYours:
                return Results.StatusCode(StatusCodes.Status403Forbidden);
        }

        await ExecAsync(connection,
            $"update {k.Table} set handled_by_profile_id = null, claimed_at = null where {k.IdColumn} = $1 and handled_by_profile_id = $2",
            ct, id, caller);
        await audit.WriteAsync(user, "handling.released", k.EntityType, id.ToString(CultureInfo.InvariantCulture),
            farmId: await FarmOfAsync(connection, k, id, ct), cancellationToken: ct);

        return Results.Ok(new { message = "You are no longer handling this." });
    }

    private static async Task<IResult> ActionAsync(
        string kind, long id, HandlingActionBody body, ClaimsPrincipal user, NpgsqlDataSource dataSource, AuditLog audit, CancellationToken ct)
    {
        if (!Kinds.TryGetValue(kind, out var k)) return Results.NotFound(new { error = "No such kind." });
        if (!TryGetUserId(user, out var caller)) return Results.Unauthorized();

        var action = body.Action?.Trim().ToLowerInvariant();
        if (!HandlingRules.ActionAllowed(kind, action))
        {
            return Results.BadRequest(new { error = $"Allowed here: {string.Join(", ", HandlingRules.ActionsFor(kind))}." });
        }

        var note = string.IsNullOrWhiteSpace(body.Note) ? null : body.Note.Trim();
        if (action == "note" && note is null) return Results.BadRequest(new { error = "Write the note first." });

        await using var connection = await dataSource.OpenConnectionAsync(ct);
        if (!await MigrationAppliedAsync(connection, k, ct)) return Results.Conflict(new { error = NeedsMigration });

        int changed;
        string done;
        switch (kind, action)
        {
            case (_, "note"):
                changed = await ExistsAsync(connection, k, id, ct) ? 1 : 0;
                done = "Note added.";
                break;

            case ("alerts", "resolve"):
            case ("alerts", "close"):
                changed = await ExecAsync(connection,
                    "update alert set status = 'Resolved', resolved_by_profile_id = $2, resolved_at = now(), updated_at = now() where id = $1",
                    ct, id, caller);
                done = action == "close" ? "Closed." : "Resolved.";
                break;

            case ("alerts", "reopen"):
                // resolved_by is kept (it was resolved by that person); the timeline shows it was reopened.
                changed = await ExecAsync(connection,
                    "update alert set status = 'Open', updated_at = now() where id = $1", ct, id);
                done = "Reopened.";
                break;

            case ("alerts", "escalate"):
                changed = await ExecAsync(connection,
                    "update alert set escalated_at = now(), updated_at = now() where id = $1", ct, id);
                done = "Escalated.";
                break;

            case ("maintenance", "schedule"):
                if (!DateOnly.TryParseExact(body.Date, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var date))
                {
                    return Results.BadRequest(new { error = "Pick a visit date." });
                }
                await using (var cmd = new NpgsqlCommand(
                    "update maintenance set scheduled_date = $2, status = 'Scheduled', updated_at = now() where maintenance_id = $1", connection))
                {
                    cmd.Parameters.AddWithValue(id);
                    cmd.Parameters.AddWithValue(NpgsqlDbType.TimestampTz, new DateTimeOffset(date.ToDateTime(new TimeOnly(8, 0)), TimeSpan.FromHours(2)));
                    changed = await cmd.ExecuteNonQueryAsync(ct);
                }
                done = $"Visit booked for {date.ToString("ddd d MMM", CultureInfo.InvariantCulture)}.";
                break;

            case ("maintenance", "complete"):
                changed = await ExecAsync(connection,
                    "update maintenance set status = 'Completed', completed_by_profile_id = $2, completed_at = now(), updated_at = now() where maintenance_id = $1",
                    ct, id, caller);
                done = "Completed.";
                break;

            default:
                return Results.BadRequest(new { error = "Not an action for this item." });
        }

        if (changed == 0) return Results.NotFound(new { error = "No such item." });

        await audit.WriteAsync(user, $"{k.EntityType}.{Past(action!)}", k.EntityType, id.ToString(CultureInfo.InvariantCulture),
            farmId: await FarmOfAsync(connection, k, id, ct),
            details: new { note, date = body.Date },
            cancellationToken: ct);

        return Results.Ok(new { message = done });
    }

    // A new maintenance job, booked by the caller, who is then handling it.
    private static async Task<IResult> CreateMaintenanceAsync(
        CreateMaintenanceBody body, ClaimsPrincipal user, NpgsqlDataSource dataSource, AuditLog audit, CancellationToken ct)
    {
        if (!TryGetUserId(user, out var caller)) return Results.Unauthorized();
        var description = body.Description?.Trim();
        if (string.IsNullOrEmpty(description)) return Results.BadRequest(new { error = "Say what needs doing." });
        if (body.HardwareId is null && body.FarmId is null) return Results.BadRequest(new { error = "Choose the kit or the farm." });
        if (!DateOnly.TryParseExact(body.Date, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var date))
        {
            return Results.BadRequest(new { error = "Pick a visit date." });
        }

        await using var connection = await dataSource.OpenConnectionAsync(ct);
        var k = Kinds["maintenance"];
        var handled = await MigrationAppliedAsync(connection, k, ct);

        await using var cmd = new NpgsqlCommand(
            handled
                ? "insert into maintenance (farm_id, hardware_id, scheduled_date, description, status, handled_by_profile_id, claimed_at) " +
                  "values (coalesce($1, (select farm_id from hardware where hardware_id = $2)), $2, $3, $4, 'Scheduled', $5, now()) returning maintenance_id, farm_id"
                : "insert into maintenance (farm_id, hardware_id, scheduled_date, description, status) " +
                  "values (coalesce($1, (select farm_id from hardware where hardware_id = $2)), $2, $3, $4, 'Scheduled') returning maintenance_id, farm_id",
            connection);
        cmd.Parameters.AddWithValue(NpgsqlDbType.Bigint, (object?)body.FarmId ?? DBNull.Value);
        cmd.Parameters.AddWithValue(NpgsqlDbType.Bigint, (object?)body.HardwareId ?? DBNull.Value);
        cmd.Parameters.AddWithValue(NpgsqlDbType.TimestampTz, new DateTimeOffset(date.ToDateTime(new TimeOnly(8, 0)), TimeSpan.FromHours(2)));
        cmd.Parameters.AddWithValue(description);
        if (handled) cmd.Parameters.AddWithValue(caller);

        long id;
        long? farmId;
        await using (var reader = await cmd.ExecuteReaderAsync(ct))
        {
            await reader.ReadAsync(ct);
            id = reader.GetInt64(0);
            farmId = reader.IsDBNull(1) ? null : reader.GetInt64(1);
        }

        await audit.WriteAsync(user, "maintenance.created", "maintenance", id.ToString(CultureInfo.InvariantCulture),
            farmId: farmId, details: new { description, date = body.Date, hardwareId = body.HardwareId }, cancellationToken: ct);

        return Results.Ok(new { id, message = $"Maintenance booked for {date.ToString("ddd d MMM", CultureInfo.InvariantCulture)}." });
    }

    // ------------------------------------------------------------------

    public static string Past(string action) => action switch
    {
        "note" => "note_added",
        "resolve" => "resolved",
        "close" => "closed",
        "reopen" => "reopened",
        "escalate" => "escalated",
        "schedule" => "scheduled",
        "complete" => "completed",
        _ => action,
    };

    private static async Task<(Guid? Handler, string Name)?> CurrentHandlerAsync(
        NpgsqlConnection connection, Kind k, long id, CancellationToken ct)
    {
        await using var cmd = new NpgsqlCommand(
            $"select t.handled_by_profile_id, (select coalesce(nullif(p.name, ''), p.email, 'another admin') from profile p where p.id = t.handled_by_profile_id) " +
            $"from {k.Table} t where t.{k.IdColumn} = $1", connection);
        cmd.Parameters.AddWithValue(id);
        await using var reader = await cmd.ExecuteReaderAsync(ct);
        if (!await reader.ReadAsync(ct)) return null;
        return (reader.IsDBNull(0) ? null : reader.GetGuid(0), reader.IsDBNull(1) ? "another admin" : reader.GetString(1));
    }

    private static async Task<bool> ExistsAsync(NpgsqlConnection connection, Kind k, long id, CancellationToken ct)
    {
        await using var cmd = new NpgsqlCommand($"select exists (select 1 from {k.Table} where {k.IdColumn} = $1)", connection);
        cmd.Parameters.AddWithValue(id);
        return await cmd.ExecuteScalarAsync(ct) is true;
    }

    private static async Task<long?> FarmOfAsync(NpgsqlConnection connection, Kind k, long id, CancellationToken ct)
    {
        try
        {
            await using var cmd = new NpgsqlCommand(k.FarmSql, connection);
            cmd.Parameters.AddWithValue(id);
            return await cmd.ExecuteScalarAsync(ct) as long?;
        }
        catch (PostgresException)
        {
            return null;
        }
    }

    private static async Task<bool> MigrationAppliedAsync(NpgsqlConnection connection, Kind k, CancellationToken ct)
    {
        await using var cmd = new NpgsqlCommand(
            "select exists (select 1 from information_schema.columns where table_name = $1 and column_name = 'handled_by_profile_id')",
            connection);
        cmd.Parameters.AddWithValue(k.Table);
        return await cmd.ExecuteScalarAsync(ct) is true;
    }

    private static async Task<int> ExecAsync(NpgsqlConnection connection, string sql, CancellationToken ct, params object[] args)
    {
        await using var cmd = new NpgsqlCommand(sql, connection);
        foreach (var a in args) cmd.Parameters.AddWithValue(a);
        return await cmd.ExecuteNonQueryAsync(ct);
    }

    private static string? Iso(NpgsqlDataReader reader, int i) =>
        reader.IsDBNull(i) ? null : reader.GetFieldValue<DateTimeOffset>(i).ToString("o", CultureInfo.InvariantCulture);

    private static bool TryGetUserId(ClaimsPrincipal user, out Guid userId) =>
        Guid.TryParse(user.FindFirstValue("sub") ?? user.FindFirstValue(ClaimTypes.NameIdentifier), out userId);
}
