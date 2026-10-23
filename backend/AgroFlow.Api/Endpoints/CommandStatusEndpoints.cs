using System.Security.Claims;
using AgroFlow.Business;
using Npgsql;

namespace AgroFlow.Api.Endpoints;

// One command as the app shows it. State is CommandState's word: sent, started, finished,
// no_response or failed. "started" is the kit's acknowledgement (status 'executed'); only
// "finished" means the kit reported the whole run (finished_at, migration 0051).
public record CommandStatusResponse(
    Guid Id,
    long ZoneId,
    string Command,
    string Source,
    string State,
    string Label,
    int? DurationSeconds,
    DateTimeOffset CreatedAt,
    DateTimeOffset? StartedAt,
    DateTimeOffset? FinishedAt,
    // The audit's words (docs/audit/ui-contracts.md): request_sent, waiting_for_kit,
    // kit_confirmed_start, finished, stop_requested, kit_confirmed_stop, no_response, failed.
    string? Phase = null,
    string? PhaseLabel = null,
    DateTimeOffset? PublishedAt = null,
    // Set when the request was over the zone's maximum and was capped (AF-05).
    int? RequestedDurationSeconds = null,
    bool Capped = false);

// After Irrigate: GET /api/farmer/commands/{id} is polled by the zone screen; the zone's
// recent commands are its history of what was asked and what the kit did.
public static class CommandStatusEndpoints
{
    private const string FarmAccessSql = """
        exists (select 1 from farm f where f.farm_id = z.farm_id and f.owner_id = $1)
        or exists (select 1 from farm_member fm where fm.farm_id = z.farm_id and fm.profile_id = $1)
        """;

    public static void MapCommandStatusEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/farmer").RequireAuthorization();
        group.MapGet("/commands/{commandId:guid}", GetCommandAsync);
        group.MapGet("/zones/{zoneId:long}/commands", ListZoneCommandsAsync);
    }

    private static async Task<IResult> GetCommandAsync(
        Guid commandId, ClaimsPrincipal user, NpgsqlDataSource dataSource, CancellationToken ct)
    {
        if (!TryGetUserId(user, out var userId)) return Results.Unauthorized();
        await using var connection = await dataSource.OpenConnectionAsync(ct);
        // Security: only a member of the zone's farm (FarmAccessSql) sees the command.
        var rows = await QueryAsync(connection, userId, $"c.id = $2 and ({FarmAccessSql})", commandId, 1, ct);
        return rows.Count == 0 ? Results.NotFound(new { error = "No such command." }) : Results.Ok(rows[0]);
    }

    private static async Task<IResult> ListZoneCommandsAsync(
        long zoneId, int? limit, ClaimsPrincipal user, NpgsqlDataSource dataSource, CancellationToken ct)
    {
        if (!TryGetUserId(user, out var userId)) return Results.Unauthorized();
        await using var connection = await dataSource.OpenConnectionAsync(ct);
        // Watering only: change_wifi / open_setup are device chores, not runs.
        // Security: only a member of the zone's farm (FarmAccessSql).
        var rows = await QueryAsync(connection, userId, $"c.zone_id = $2 and c.command in ('start', 'stop') and ({FarmAccessSql})",
            zoneId, Math.Clamp(limit ?? 10, 1, 50), ct);
        return Results.Ok(rows);
    }

    private static async Task<List<CommandStatusResponse>> QueryAsync(
        NpgsqlConnection connection, Guid userId, string where, object key, int limit, CancellationToken ct)
    {
        // Before migration 0051 there is no finished_at: every command reads as at most "started".
        bool hasFinished;
        await using (var has = new NpgsqlCommand(
            "select exists (select 1 from information_schema.columns where table_name = 'irrigation_commands' and column_name = 'finished_at')",
            connection))
        {
            hasFinished = await has.ExecuteScalarAsync(ct) is true;
        }

        var finished = hasFinished ? "c.finished_at" : "null::timestamptz";
        // 0057: when the command was published and what was asked before the cap.
        bool hasPublished;
        await using (var has = new NpgsqlCommand(
            "select exists (select 1 from information_schema.columns where table_name = 'irrigation_commands' and column_name = 'published_at')",
            connection))
        {
            hasPublished = await has.ExecuteScalarAsync(ct) is true;
        }
        var published = hasPublished ? "c.published_at, c.requested_duration_seconds" : "null::timestamptz, null::integer";
        var sql = $"""
            select c.id, c.zone_id, c.command, c.source, c.status, c.duration_seconds,
                   c.created_at, c.executed_at, {finished}, {published}
              from irrigation_commands c
              join zone z on z.id = c.zone_id
             where {where}
             order by c.created_at desc
             limit {limit};
            """;
        await using var cmd = new NpgsqlCommand(sql, connection);
        cmd.Parameters.AddWithValue(userId);
        cmd.Parameters.AddWithValue(key);

        var now = DateTimeOffset.UtcNow;
        var list = new List<CommandStatusResponse>();
        await using var reader = await cmd.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct))
        {
            var status = reader.GetString(4);
            var createdAt = reader.GetFieldValue<DateTimeOffset>(6);
            DateTimeOffset? startedAt = reader.IsDBNull(7) ? null : reader.GetFieldValue<DateTimeOffset>(7);
            DateTimeOffset? finishedAt = reader.IsDBNull(8) ? null : reader.GetFieldValue<DateTimeOffset>(8);
            DateTimeOffset? publishedAt = reader.IsDBNull(9) ? null : reader.GetFieldValue<DateTimeOffset>(9);
            int? requested = reader.IsDBNull(10) ? null : reader.GetInt32(10);
            var state = CommandState.Describe(status, createdAt, finishedAt, now);
            var phase = CommandPhase.Describe(reader.GetString(2), status, createdAt, publishedAt, finishedAt, now);
            list.Add(new CommandStatusResponse(
                reader.GetGuid(0), reader.GetInt64(1), reader.GetString(2), reader.GetString(3),
                state, CommandState.Label(state),
                reader.IsDBNull(5) ? null : reader.GetInt32(5),
                createdAt, startedAt, finishedAt,
                phase, CommandPhase.Label(phase), publishedAt, requested, requested is not null));
        }
        return list;
    }

    private static bool TryGetUserId(ClaimsPrincipal user, out Guid userId) =>
        Guid.TryParse(user.FindFirstValue("sub"), out userId);
}
