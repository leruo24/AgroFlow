using System.Security.Claims;
using AgroFlow.Api.Auth;
using AgroFlow.Api.Services;
using AgroFlow.Business;
using Npgsql;

namespace AgroFlow.Api.Endpoints;

public record ZoneMaxRunRequest(int? MaxRunMinutes);

// A zone's maximum run time (migration 0052), set by staff in the admin site. Staff only:
// a farmer must not be able to raise the limit on their own pump (zone_farmer_edit_guard
// blocks it in the database too). Audited.
public static class ZoneRunLimitEndpoints
{
    public static void MapZoneRunLimitEndpoints(this WebApplication app)
    {
        app.MapPut("/api/admin/zones/{zoneId:long}/max-run", SetAsync)
            .RequireAuthorization().AddEndpointFilter<AdminOnlyFilter>();
    }

    private static async Task<IResult> SetAsync(
        long zoneId, ZoneMaxRunRequest request, ClaimsPrincipal user,
        NpgsqlDataSource dataSource, IAuditWriter audit, CancellationToken ct)
    {
        if (IrrigationRunRules.CheckMaxRunMinutes(request.MaxRunMinutes) is { } problem)
            return Results.BadRequest(new { error = problem });

        await using var connection = await dataSource.OpenConnectionAsync(ct);
        if (!await ZoneRunLimit.ColumnExistsAsync(connection, ct))
        {
            return Results.Problem(
                title: "Run migration 0052 first.",
                detail: "The database has no zone.max_run_minutes column yet, so every zone stays at 5 minutes.",
                statusCode: StatusCodes.Status409Conflict);
        }

        await using var cmd = new NpgsqlCommand(
            "update zone z set max_run_minutes = $2 from zone old " +
            "where z.id = $1 and old.id = z.id returning old.max_run_minutes, z.farm_id", connection);
        cmd.Parameters.AddWithValue(zoneId);
        cmd.Parameters.AddWithValue(request.MaxRunMinutes!.Value);
        await using var reader = await cmd.ExecuteReaderAsync(ct);
        if (!await reader.ReadAsync(ct)) return Results.NotFound(new { error = "No such zone." });
        var before = reader.GetInt32(0);
        var farmId = reader.GetInt64(1);
        await reader.DisposeAsync();

        await audit.WriteAsync(user, AuditActions.ZoneMaxRunChanged, "zone", zoneId.ToString(), farmId,
            new { from = before, to = request.MaxRunMinutes }, ct);

        return Results.Ok(new
        {
            zoneId,
            maxRunMinutes = request.MaxRunMinutes,
            message = $"Runs on this zone now stop after {request.MaxRunMinutes} min at most. The kit gets the new limit with its next command.",
        });
    }
}
