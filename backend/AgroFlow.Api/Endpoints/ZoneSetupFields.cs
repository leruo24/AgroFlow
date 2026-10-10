using System.Security.Claims;
using AgroFlow.Business;
using Npgsql;
using NpgsqlTypes;

namespace AgroFlow.Api.Endpoints;

// The mobile "Finish setup" checklist saves these one at a time.
public record ZoneSetupBody(DateOnly? PlantingDate, double? AreaM2, double? FlowRateLpm);

// The setup a zone's advice needs, asked for when the farm is registered. All
// optional so older admin builds still work; the wizard always sends soil and area.
public static class ZoneSetupFields
{
    public static readonly string[] SoilTypes = { "sandy", "loam", "clay" };

    // DATA RULES: limits that catch a typo, not real zones.
    public const double MaxRootDepthM = 3;      // deeper than any crop on the list roots
    public const double MaxFlowRateLpm = 1000;  // a large farm line
    public const int MaxPlantedYearsAgo = 2;    // older than this is a perennial's planting, not a season

    /// Null = fine. The message names the zone.
    public static string? Check(
        string zoneName, double sizeHectares, string? soilType, double? areaM2,
        DateOnly? plantingDate, double? rootDepthLimitM, double? flowRateLpm, DateOnly today)
    {
        if (soilType is not null && !SoilTypes.Contains(soilType.Trim().ToLowerInvariant()))
            return $"Zone '{zoneName}': soil must be sandy, loam or clay.";

        if (areaM2 is { } a)
        {
            if (a <= 0) return $"Zone '{zoneName}': the watered area must be more than 0 m².";
            // 1 ha = 10 000 m²; a small allowance for rounding.
            if (a > sizeHectares * 10_000 * 1.001)
                return $"Zone '{zoneName}': the watered area ({a:0.##} m²) is bigger than the zone ({sizeHectares:0.####} ha).";
        }

        if (plantingDate is { } p)
        {
            if (p > today) return $"Zone '{zoneName}': the planting date is in the future.";
            if (p < today.AddYears(-MaxPlantedYearsAgo)) return $"Zone '{zoneName}': the planting date is more than {MaxPlantedYearsAgo} years ago.";
        }

        if (rootDepthLimitM is { } r && (r <= 0 || r > MaxRootDepthM))
            return $"Zone '{zoneName}': the soil depth must be between 1 cm and {MaxRootDepthM:0} m.";

        if (flowRateLpm is { } f && (f <= 0 || f > MaxFlowRateLpm))
            return $"Zone '{zoneName}': the flow rate must be between 0.1 and {MaxFlowRateLpm:0} litres a minute.";

        return null;
    }

    public static void MapZoneSetupEndpoints(this WebApplication app)
    {
        app.MapPut("/api/farmer/zones/{zoneId:long}/setup", SaveSetupAsync).RequireAuthorization();
    }

    // Only what was sent changes. The zone's size in hectares is not editable here,
    // so the area is checked on its own.
    private static async Task<IResult> SaveSetupAsync(
        long zoneId, ZoneSetupBody body, ClaimsPrincipal user,
        NpgsqlDataSource dataSource, Fao56EngineController engine, CancellationToken ct)
    {
        if (!Guid.TryParse(user.FindFirstValue("sub") ?? user.FindFirstValue(ClaimTypes.NameIdentifier), out var userId))
            return Results.Unauthorized();
        if (!engine.Data.CanAccessZone(userId, zoneId, out _)) return Results.NotFound(new { error = "Zone not found." });
        if (body.PlantingDate is null && body.AreaM2 is null && body.FlowRateLpm is null)
            return Results.BadRequest(new { error = "Nothing to save." });

        if (Check("This zone", double.MaxValue, null, body.AreaM2, body.PlantingDate, null, body.FlowRateLpm,
                Fao56EngineController.TodayInSast()) is { } problem)
            return Results.BadRequest(new { error = problem.Replace("Zone 'This zone': ", "") });

        await using var connection = await dataSource.OpenConnectionAsync(ct);
        await using var cmd = new NpgsqlCommand(
            """
            update zone set planting_date = coalesce($2, planting_date),
                            area_m2 = coalesce($3, area_m2),
                            flow_rate_lpm = coalesce($4, flow_rate_lpm)
             where id = $1
            """, connection);
        cmd.Parameters.AddWithValue(zoneId);
        cmd.Parameters.AddWithValue(NpgsqlDbType.Date, body.PlantingDate is { } p ? (object)p : DBNull.Value);
        cmd.Parameters.AddWithValue(NpgsqlDbType.Numeric, body.AreaM2 is { } a ? (object)(decimal)a : DBNull.Value);
        cmd.Parameters.AddWithValue(NpgsqlDbType.Real, body.FlowRateLpm is { } f ? (object)(float)f : DBNull.Value);
        await cmd.ExecuteNonQueryAsync(ct);

        return Results.Ok(new { message = "Saved. Today's advice now uses it." });
    }
}
