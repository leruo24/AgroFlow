using AgroFlow.Api.Auth;
using Npgsql;

namespace AgroFlow.Api.Endpoints;

public static class FarmEndpoints
{
    public static void MapFarmEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/farms")
            .RequireAuthorization()
            .AddEndpointFilter<AdminOnlyFilter>();

        group.MapGet("", GetFarmsAsync);
        group.MapPost("/register", RegisterFarmAsync);
        group.MapDelete("/{id:long}", DeleteFarmAsync);
    }
    
    
public record RegisterFarmRequest(
    Guid OwnerId,
    RegisterFarmDetails Farm
);

public record RegisterFarmDetails(
    string FarmName,
    string Location,
    double SizeHectares,
    List<RegisterFarmZone> Zones
);

public record RegisterFarmZone(
    string Name,
    double SizeHectares,
    string CropType
);

private static async Task<IResult> RegisterFarmAsync(
    RegisterFarmRequest request,
    NpgsqlDataSource dataSource,
    ILoggerFactory loggerFactory)
{
    var logger =
        loggerFactory.CreateLogger("FarmEndpoints");

    if (request.OwnerId == Guid.Empty)
    {
        return Results.BadRequest(new
        {
            message = "A farmer / owner must be selected."
        });
    }

    if (request.Farm is null)
    {
        return Results.BadRequest(new
        {
            message = "Farm details are required."
        });
    }

    if (string.IsNullOrWhiteSpace(request.Farm.FarmName))
    {
        return Results.BadRequest(new
        {
            message = "Farm name is required."
        });
    }

    if (string.IsNullOrWhiteSpace(request.Farm.Location))
    {
        return Results.BadRequest(new
        {
            message = "Farm location is required."
        });
    }

    if (request.Farm.SizeHectares <= 0)
    {
        return Results.BadRequest(new
        {
            message = "Farm size must be greater than 0."
        });
    }

    if (request.Farm.Zones is null ||
        request.Farm.Zones.Count == 0)
    {
        return Results.BadRequest(new
        {
            message = "At least one irrigation zone is required."
        });
    }

    if (request.Farm.Zones.Count > 50)
    {
        return Results.BadRequest(new
        {
            message = "A maximum of 50 zones can be registered."
        });
    }

    var totalZoneArea =
        request.Farm.Zones.Sum(z => z.SizeHectares);

    if (totalZoneArea > request.Farm.SizeHectares)
    {
        return Results.BadRequest(new
        {
            message =
                "The total area of the irrigation zones cannot exceed the farm size."
        });
    }

    foreach (var zone in request.Farm.Zones)
    {
        if (string.IsNullOrWhiteSpace(zone.Name))
        {
            return Results.BadRequest(new
            {
                message = "Every zone must have a name."
            });
        }

        if (zone.SizeHectares <= 0)
        {
            return Results.BadRequest(new
            {
                message =
                    $"Zone '{zone.Name}' must have a size greater than 0."
            });
        }

        if (string.IsNullOrWhiteSpace(zone.CropType))
        {
            return Results.BadRequest(new
            {
                message =
                    $"Zone '{zone.Name}' must have a crop type."
            });
        }
    }

    await using var connection =
        await dataSource.OpenConnectionAsync();

    await using var transaction =
        await connection.BeginTransactionAsync();

    try
    {
        const string ownerSql = """
            select id
            from profile
            where id = $1
              and role = 'farm_user'
            """;

        await using var ownerCommand =
            new NpgsqlCommand(
                ownerSql,
                connection,
                transaction);

        ownerCommand.Parameters.AddWithValue(
            request.OwnerId);

        var ownerExists =
            await ownerCommand.ExecuteScalarAsync();

        if (ownerExists is null)
        {
            await transaction.RollbackAsync();

            return Results.BadRequest(new
            {
                message =
                    "The selected farmer does not exist."
            });
        }

        const string insertFarmSql = """
            insert into farm (
                owner_id,
                name,
                location,
                total_area,
                status
            )
            values (
                $1,
                $2,
                $3,
                $4,
                'Active'
            )
            returning farm_id
            """;

        await using var farmCommand =
            new NpgsqlCommand(
                insertFarmSql,
                connection,
                transaction);

        farmCommand.Parameters.AddWithValue(
            request.OwnerId);

        farmCommand.Parameters.AddWithValue(
            request.Farm.FarmName.Trim());

        farmCommand.Parameters.AddWithValue(
            request.Farm.Location.Trim());

        farmCommand.Parameters.AddWithValue(
            request.Farm.SizeHectares);

        var farmIdObject =
            await farmCommand.ExecuteScalarAsync();

        if (farmIdObject is null)
        {
            await transaction.RollbackAsync();

            return Results.Problem(
                "The farm could not be created.");
        }

        var farmId =
            Convert.ToInt64(farmIdObject);

        const string insertMemberSql = """
            insert into farm_member (
                farm_id,
                profile_id
            )
            values (
                $1,
                $2
            )
            """;

        await using var memberCommand =
            new NpgsqlCommand(
                insertMemberSql,
                connection,
                transaction);

        memberCommand.Parameters.AddWithValue(farmId);
        memberCommand.Parameters.AddWithValue(
            request.OwnerId);

        await memberCommand.ExecuteNonQueryAsync();

        const string insertZoneSql = """
            insert into zone (
                farm_id,
                name,
                size_value,
                size_unit,
                location,
                crop_type
            )
            values (
                $1,
                $2,
                $3,
                'ha',
                $4,
                $5
            )
            """;

        foreach (var zone in request.Farm.Zones)
        {
            await using var zoneCommand =
                new NpgsqlCommand(
                    insertZoneSql,
                    connection,
                    transaction);

            zoneCommand.Parameters.AddWithValue(farmId);
            zoneCommand.Parameters.AddWithValue(
                zone.Name.Trim());
            zoneCommand.Parameters.AddWithValue(
                zone.SizeHectares);
            zoneCommand.Parameters.AddWithValue(
                request.Farm.Location.Trim());
            zoneCommand.Parameters.AddWithValue(
                zone.CropType.Trim());

            await zoneCommand.ExecuteNonQueryAsync();
        }

        await transaction.CommitAsync();

        logger.LogInformation(
            "Registered farm {FarmId} for existing farmer {OwnerId}.",
            farmId,
            request.OwnerId);

        return Results.Ok(new
        {
            farm_id = farmId,
            owner_id = request.OwnerId,
            message = "Farm registered successfully."
        });
    }
    catch (Exception ex)
    {
        await transaction.RollbackAsync();

        logger.LogError(
            ex,
            "Failed to register farm for farmer {OwnerId}.",
            request.OwnerId);

        return Results.Problem(
            "The farm could not be registered.");
    }
}


    private static async Task<IResult> GetFarmsAsync(
        NpgsqlDataSource dataSource)
    {
        await using var connection =
            await dataSource.OpenConnectionAsync();

        const string sql = """
            select
                f.farm_id,
                f.name,
                f.owner_id,
                p.name as owner_name,
                f.location,
                f.total_area,
                f.status,
                f.updated_at
            from farm f
            left join profile p
                on p.id = f.owner_id
            order by f.farm_id
            """;

        await using var command =
            new NpgsqlCommand(sql, connection);

        await using var reader =
            await command.ExecuteReaderAsync();

        var farms = new List<object>();

        while (await reader.ReadAsync())
        {
            Guid? ownerId = reader.IsDBNull(2)
                ? null
                : reader.GetGuid(2);

            farms.Add(new
            {
                farm_id = reader.GetInt64(0),
                name = reader.GetString(1),
                owner_id = ownerId,
                owner_name = reader.IsDBNull(3)
                    ? null
                    : reader.GetString(3),
                location = reader.IsDBNull(4)
                    ? ""
                    : reader.GetString(4),
                total_area = reader.IsDBNull(5)
                    ? 0
                    : reader.GetFloat(5),
                status = reader.IsDBNull(6)
                    ? null
                    : reader.GetString(6),
                updated_at = reader.IsDBNull(7)
                    ? (DateTime?)null
                    : reader.GetDateTime(7)
            });
        }

        return Results.Ok(farms);
    }

    private static async Task<IResult> DeleteFarmAsync(
        long id,
        NpgsqlDataSource dataSource,
        ILoggerFactory loggerFactory)
    {
        var logger =
            loggerFactory.CreateLogger("FarmEndpoints");

        await using var connection =
            await dataSource.OpenConnectionAsync();

        await using var transaction =
            await connection.BeginTransactionAsync();

        try
        {
            const string findFarmSql = """
                select name
                from farm
                where farm_id = $1
                """;

            await using var findFarmCommand =
                new NpgsqlCommand(
                    findFarmSql,
                    connection,
                    transaction);

            findFarmCommand.Parameters.AddWithValue(id);

            var farmName =
                await findFarmCommand.ExecuteScalarAsync();

            if (farmName is null)
            {
                await transaction.RollbackAsync();

                return Results.NotFound(new
                {
                    message = "Farm not found."
                });
            }

            /*
             * Hardware is linked to a zone with ON DELETE SET NULL.
             * For farm deletion, we intentionally remove that hardware
             * before deleting the farm so no hardware remains associated
             * with the deleted farm's zones.
             */
            const string deleteHardwareSql = """
                delete from hardware
                where zone_id in (
                    select id
                    from zone
                    where farm_id = $1
                )
                """;

            await using var deleteHardwareCommand =
                new NpgsqlCommand(
                    deleteHardwareSql,
                    connection,
                    transaction);

            deleteHardwareCommand.Parameters.AddWithValue(id);

            var hardwareDeleted =
                await deleteHardwareCommand.ExecuteNonQueryAsync();

            /*
             * Deleting the farm triggers the database's existing
             * ON DELETE CASCADE relationships:
             *
             * farm_member
             * zone
             * sensor_reading
             * irrigation_event
             * irrigation_commands
             */
            const string deleteFarmSql = """
                delete from farm
                where farm_id = $1
                """;

            await using var deleteFarmCommand =
                new NpgsqlCommand(
                    deleteFarmSql,
                    connection,
                    transaction);

            deleteFarmCommand.Parameters.AddWithValue(id);

            var farmsDeleted =
                await deleteFarmCommand.ExecuteNonQueryAsync();

            if (farmsDeleted != 1)
            {
                await transaction.RollbackAsync();

                return Results.Problem(
                    "The farm could not be deleted.");
            }

            await transaction.CommitAsync();

            logger.LogInformation(
                "Deleted farm {FarmId} ({FarmName}) and {HardwareCount} associated hardware record(s).",
                id,
                farmName,
                hardwareDeleted);

            return Results.Ok(new
            {
                message =
                    "Farm and all associated farm data were deleted successfully.",
                hardware_deleted = hardwareDeleted
            });
        }
        catch (Exception ex)
        {
            await transaction.RollbackAsync();

            logger.LogError(
                ex,
                "Failed to delete farm {FarmId}.",
                id);

            return Results.Problem(
                "The farm could not be deleted.");
        }
    }
}