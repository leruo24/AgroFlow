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

        // Archive / restore. Deliberately next to Delete so the difference is
        // visible in one place: Delete removes the farm and cascades to every
        // zone, reading, event and alert it owns; Archive removes NOTHING and
        // is reversible. Test data should go through Archive.
        group.MapPost("/{id:long}/archive", ArchiveFarmAsync);
        group.MapPost("/{id:long}/restore", RestoreFarmAsync);
    }

    // Hides a farm and its zones from default lists, reports and automatic
    // reports, keeping every row. See migration 0036.
    private static async Task<IResult> ArchiveFarmAsync(
        long id, NpgsqlDataSource dataSource, ILoggerFactory loggerFactory)
    {
        return await SetArchivedAsync(id, archived: true, dataSource, loggerFactory);
    }

    private static async Task<IResult> RestoreFarmAsync(
        long id, NpgsqlDataSource dataSource, ILoggerFactory loggerFactory)
    {
        return await SetArchivedAsync(id, archived: false, dataSource, loggerFactory);
    }

    private static async Task<IResult> SetArchivedAsync(
        long id, bool archived, NpgsqlDataSource dataSource, ILoggerFactory loggerFactory)
    {
        var logger = loggerFactory.CreateLogger("AgroFlow.Api.Endpoints.FarmEndpoints");

        await using var connection = await dataSource.OpenConnectionAsync();

        // Existence is checked first so "no such farm" is a 404 rather than a
        // silent success - archiving a farm id that does not exist should not
        // report that it worked.
        await using (var exists = new NpgsqlCommand(
            "select name from farm where farm_id = $1", connection))
        {
            exists.Parameters.AddWithValue(id);

            if (await exists.ExecuteScalarAsync() is not string name)
            {
                return Results.NotFound(new { error = "No such farm." });
            }

            logger.LogWarning(
                "{Action} farm {FarmId} ({Name}) and its zones. Nothing is deleted.",
                archived ? "Archiving" : "Restoring", id, name);
        }

        // The function moves the farm and its zones together - a farm archived
        // while its zones stayed active would still feed the auto-report
        // scheduler's zone lookup.
        await using (var cmd = new NpgsqlCommand(
            archived ? "select archive_farm($1)" : "select restore_farm($1)", connection))
        {
            cmd.Parameters.AddWithValue(id);
            await cmd.ExecuteNonQueryAsync();
        }

        return Results.Ok(new
        {
            farmId = id,
            archived,
            message = archived
                ? "Farm archived. Nothing was deleted - its zones, readings and history are all still there."
                : "Farm restored.",
        });
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
        loggerFactory.CreateLogger("AgroFlow.Api.Endpoints.FarmEndpoints");

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
        NpgsqlDataSource dataSource,
        // "Show archived" on the admin farms page. Opt-in, so every existing
        // caller keeps seeing only live farms without being changed.
        bool? includeArchived)
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
            -- Archived farms are EXCLUDED by default and returned only when
            -- the caller asks. lower() because farm.status has no CHECK
            -- constraint and has always defaulted to 'Active' with a capital
            -- A, so both spellings exist in the live data - see 0036's note.
            -- Comparing case-insensitively is cheaper and safer than
            -- rewriting every row.
            where $1 or lower(coalesce(f.status, 'active')) <> 'inactive'
            order by f.farm_id
            """;

        await using var command =
            new NpgsqlCommand(sql, connection);
        command.Parameters.AddWithValue(includeArchived ?? false);

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
            loggerFactory.CreateLogger("AgroFlow.Api.Endpoints.FarmEndpoints");

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