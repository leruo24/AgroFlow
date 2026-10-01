
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
        group.MapGet("/farmers", GetFarmersAsync);
        group.MapDelete("/{id:guid}", DeleteUserAsync);
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
                f.name as farm_name,

                -- Read-only, for the admin list's "is this farmer actually
                -- reachable?" column. A farmer who never pressed Start in the
                -- bot has no chat id and receives nothing, and until now there
                -- was no way for anyone to notice that until a storm warning
                -- failed to arrive.
                p.telegram_chat_id is not null as telegram_linked,
                p.telegram_alerts_enabled
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
                    : reader.GetString(7),

                telegram_linked = !reader.IsDBNull(8) && reader.GetBoolean(8),

                // The column is NOT NULL DEFAULT TRUE, so null is only
                // reachable through an outer join that did not match. Reading
                // it as "alerts on" keeps an unlinked farmer from also looking
                // like one who deliberately muted their alerts - those are
                // different problems with different follow-ups.
                telegram_alerts_enabled = reader.IsDBNull(9) || reader.GetBoolean(9)
            });
        }

        return Results.Ok(users);
    }

    private static async Task<IResult> DeleteUserAsync(
        Guid id,
        NpgsqlDataSource dataSource,
        IHttpClientFactory httpClientFactory,
        IConfiguration configuration,
        ILoggerFactory loggerFactory)
    {
        var logger = loggerFactory.CreateLogger("AgroFlow.Api.Endpoints.UserEndpoints");

        await using var connection = await dataSource.OpenConnectionAsync();

        const string findUserSql = """
            select role, email
            from profile
            where id = $1
            """;

        await using var findCommand =
            new NpgsqlCommand(findUserSql, connection);

        findCommand.Parameters.AddWithValue(id);

        await using var reader =
            await findCommand.ExecuteReaderAsync();

        if (!await reader.ReadAsync())
        {
            return Results.NotFound(new
            {
                message = "Farmer account not found."
            });
        }

        var role = reader.IsDBNull(0)
            ? null
            : reader.GetString(0);

        var email = reader.IsDBNull(1)
            ? ""
            : reader.GetString(1);

        await reader.DisposeAsync();

        if (role != "farm_user")
        {
            return Results.BadRequest(new
            {
                message = "Only farmer accounts can be deleted."
            });
        }

        var supabaseUrl =
            configuration["Supabase:Url"];

        var serviceRoleKey =
            configuration["Supabase:ServiceRoleKey"];

        if (string.IsNullOrWhiteSpace(supabaseUrl) ||
            string.IsNullOrWhiteSpace(serviceRoleKey))
        {
            logger.LogError(
                "Supabase Auth deletion is not configured."
            );

            return Results.Problem(
                "Supabase Auth deletion is not configured."
            );
        }

        var client =
            httpClientFactory.CreateClient();

        client.DefaultRequestHeaders.Add(
            "apikey",
            serviceRoleKey
        );

        client.DefaultRequestHeaders.Add(
            "Authorization",
            $"Bearer {serviceRoleKey}"
        );

        using var response =
            await client.DeleteAsync(
                $"{supabaseUrl.TrimEnd('/')}/auth/v1/admin/users/{id}"
            );

        if (!response.IsSuccessStatusCode)
        {
            var error =
                await response.Content.ReadAsStringAsync();

            logger.LogError(
                "Failed to delete Supabase Auth user {UserId} ({Email}). Status: {StatusCode}. Response: {Response}",
                id,
                email,
                response.StatusCode,
                error
            );

            return Results.Problem(
                "The farmer account could not be deleted."
            );
        }

        logger.LogInformation(
            "Deleted farmer Auth user {UserId} ({Email}). Farm data was retained.",
            id,
            email
        );

        return Results.Ok(new
        {
            message = "Farmer account deleted successfully. Farm data was retained."
        });
    }
    private static async Task<IResult> GetFarmersAsync(
    NpgsqlDataSource dataSource)
{
    await using var connection =
        await dataSource.OpenConnectionAsync();

    const string sql = """
        select
            p.id,
            p.name,
            p.email,
            p.phone
        from profile p
        where p.role = 'farm_user'
        order by p.name, p.email
        """;

    await using var command =
        new NpgsqlCommand(sql, connection);

    await using var reader =
        await command.ExecuteReaderAsync();

    var farmers = new List<object>();

    while (await reader.ReadAsync())
    {
        farmers.Add(new
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
                : reader.GetString(3)
        });
    }

    return Results.Ok(farmers);
}
}
