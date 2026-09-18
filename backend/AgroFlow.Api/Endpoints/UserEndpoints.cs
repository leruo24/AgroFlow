using AgroFlow.Api.Auth;
using Npgsql;

namespace AgroFlow.Api.Endpoints;

public static class UserEndpoints
{
    public static void MapUserEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/users")
            .RequireAuthorization()
            .AddEndpointFilter<AdminOnlyFilter>();

        group.MapGet("", GetUsersAsync);
    }

    private static async Task<IResult> GetUsersAsync(
        NpgsqlDataSource dataSource)
    {
        await using var connection = await dataSource.OpenConnectionAsync();

        const string sql = """
            select
                p.id,
                p.name,
                p.email,
                p.phone,
                p.role,
                p.created_at,
                fm.farm_id,
                f.name as farm_name
            from profile p
            left join farm_member fm
                on fm.profile_id = p.id
            left join farm f
                on f.farm_id = fm.farm_id
            where p.role = 'farm_user'
            order by p.created_at desc
            """;

        await using var command = new NpgsqlCommand(sql, connection);
        await using var reader = await command.ExecuteReaderAsync();

        var users = new List<object>();

        while (await reader.ReadAsync())
        {
            long? farmId = reader.IsDBNull(6)
                ? null
                : reader.GetInt64(6);

            users.Add(new
            {
                id = reader.GetGuid(0),
                name = reader.IsDBNull(1)
                    ? ""
                    : reader.GetString(1),
                email = reader.IsDBNull(2)
                    ? ""
                    : reader.GetString(2),
                phone = reader.IsDBNull(3)
                    ? null
                    : reader.GetString(3),
                role = reader.IsDBNull(4)
                    ? null
                    : reader.GetString(4),
                created_at = reader.IsDBNull(5)
                    ? (DateTime?)null
                    : reader.GetDateTime(5),
                farm_id = farmId,
                farm_name = reader.IsDBNull(7)
                    ? null
                    : reader.GetString(7)
            });
        }

        return Results.Ok(users);
    }
}