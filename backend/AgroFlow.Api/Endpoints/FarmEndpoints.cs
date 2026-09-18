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
    }

    private static async Task<IResult> GetFarmsAsync(
        NpgsqlDataSource dataSource)
    {
        await using var connection = await dataSource.OpenConnectionAsync();

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

        await using var command = new NpgsqlCommand(sql, connection);
        await using var reader = await command.ExecuteReaderAsync();

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
}