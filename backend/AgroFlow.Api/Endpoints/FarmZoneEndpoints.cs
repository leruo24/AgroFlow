using System.Security.Claims;
using AgroFlow.Api.Auth;
using AgroFlow.Api.Services;
using Npgsql;
using NpgsqlTypes;

namespace AgroFlow.Api.Endpoints;

public record AddZonesRequest(List<FarmEndpoints.RegisterFarmZone> Zones);

// Item 6c: add zones to a farm that already exists - what a farmer's
// "new zone" request asks for. Until now the console could only create zones
// with a new farm, so such a request could not be carried out from it.
// Same zone fields and checks as registering a farm (item 6).
public static class FarmZoneEndpoints
{
    public static void MapFarmZoneEndpoints(this WebApplication app)
    {
        app.MapPost("/api/farms/{farmId:long}/zones", AddZonesAsync)
            .RequireAuthorization()
            .AddEndpointFilter<AdminOnlyFilter>();
    }

    /// Null = fine. The zones must have names, sizes and crops; fit in the
    /// farm with the zones it already has; and not repeat a name.
    public static string? CheckNewZones(
        IReadOnlyList<FarmEndpoints.RegisterFarmZone>? zones, double farmHectares, double existingHectares,
        IReadOnlyCollection<string> existingNames, DateOnly today)
    {
        if (zones is null || zones.Count == 0) return "Add at least one zone.";
        if (zones.Count > 50) return "A maximum of 50 zones can be added at once.";

        var names = new HashSet<string>(existingNames.Select(n => n.Trim().ToLowerInvariant()));
        foreach (var z in zones)
        {
            if (string.IsNullOrWhiteSpace(z.Name)) return "Every zone must have a name.";
            if (!names.Add(z.Name.Trim().ToLowerInvariant())) return $"This farm already has a zone called '{z.Name.Trim()}'.";
            if (z.SizeHectares <= 0) return $"Zone '{z.Name}' must have a size greater than 0.";
            if (string.IsNullOrWhiteSpace(z.CropType)) return $"Zone '{z.Name}' must have a crop type.";
            if (ZoneSetupFields.Check(z.Name, z.SizeHectares, z.SoilType, z.AreaM2, z.PlantingDate,
                    z.RootDepthLimitM, z.FlowRateLpm, today) is { } problem) return problem;
        }

        var total = existingHectares + zones.Sum(z => z.SizeHectares);
        if (farmHectares > 0 && total > farmHectares * 1.0001)
            return $"With these, the zones add up to {total:0.##} ha, more than the farm's {farmHectares:0.##} ha.";

        return null;
    }

    private static async Task<IResult> AddZonesAsync(
        long farmId, AddZonesRequest request, ClaimsPrincipal user,
        NpgsqlDataSource dataSource, AuditLog audit, CancellationToken ct)
    {
        await using var connection = await dataSource.OpenConnectionAsync(ct);

        double farmHectares;
        string location;
        await using (var cmd = new NpgsqlCommand("select coalesce(total_area, 0), coalesce(location, '') from farm where farm_id = $1", connection))
        {
            cmd.Parameters.AddWithValue(farmId);
            await using var reader = await cmd.ExecuteReaderAsync(ct);
            if (!await reader.ReadAsync(ct)) return Results.NotFound(new { message = "No such farm." });
            farmHectares = Convert.ToDouble(reader.GetValue(0));
            location = reader.GetString(1);
        }

        var existingNames = new List<string>();
        double existingHectares = 0;
        await using (var cmd = new NpgsqlCommand(
            "select coalesce(name, ''), case when size_unit = 'ha' then coalesce(size_value, 0) else 0 end from zone where farm_id = $1", connection))
        {
            cmd.Parameters.AddWithValue(farmId);
            await using var reader = await cmd.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct))
            {
                existingNames.Add(reader.GetString(0));
                existingHectares += Convert.ToDouble(reader.GetValue(1));
            }
        }

        if (CheckNewZones(request.Zones, farmHectares, existingHectares, existingNames, AgroFlow.Business.Fao56EngineController.TodayInSast()) is { } problem)
            return Results.BadRequest(new { message = problem });

        await using var tx = await connection.BeginTransactionAsync(ct);
        foreach (var zone in request.Zones)
        {
            await using var cmd = new NpgsqlCommand(
                """
                insert into zone (farm_id, name, size_value, size_unit, location, crop_type,
                                  soil_type, area_m2, planting_date, root_depth_limit_m, flow_rate_lpm)
                values ($1, $2, $3, 'ha', $4, $5, coalesce($6, 'loam'), $7, $8, $9, $10)
                """, connection, tx);
            cmd.Parameters.AddWithValue(farmId);
            cmd.Parameters.AddWithValue(zone.Name.Trim());
            cmd.Parameters.AddWithValue(zone.SizeHectares);
            cmd.Parameters.AddWithValue(location);
            cmd.Parameters.AddWithValue(zone.CropType.Trim());
            cmd.Parameters.AddWithValue(NpgsqlDbType.Text, (object?)zone.SoilType?.Trim().ToLowerInvariant() ?? DBNull.Value);
            cmd.Parameters.AddWithValue(NpgsqlDbType.Numeric, zone.AreaM2 is { } a ? (object)(decimal)a : DBNull.Value);
            cmd.Parameters.AddWithValue(NpgsqlDbType.Date, zone.PlantingDate is { } p ? (object)p : DBNull.Value);
            cmd.Parameters.AddWithValue(NpgsqlDbType.Numeric, zone.RootDepthLimitM is { } d ? (object)(decimal)d : DBNull.Value);
            cmd.Parameters.AddWithValue(NpgsqlDbType.Real, zone.FlowRateLpm is { } f ? (object)(float)f : DBNull.Value);
            await cmd.ExecuteNonQueryAsync(ct);
        }
        await tx.CommitAsync(ct);

        await audit.WriteAsync(user, AuditActions.ZonesAdded, "farm", farmId.ToString(), farmId,
            new { zones = request.Zones.Select(z => z.Name.Trim()).ToArray() }, ct);

        var n = request.Zones.Count;
        return Results.Ok(new { message = n == 1 ? "Zone added." : $"{n} zones added." });
    }
}
