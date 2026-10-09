using Npgsql;

namespace AgroFlow.Api.Auth;

// Security: used on admin endpoints together with .RequireAuthorization().
// The JWT only proves the caller is a logged-in Supabase user; the role lives in
// our profile table, so this filter looks it up in the database.
public class AdminOnlyFilter : IEndpointFilter
{
    public async ValueTask<object?> InvokeAsync(EndpointFilterInvocationContext context, EndpointFilterDelegate next)
    {
        var userId = context.HttpContext.User.FindFirst("sub")?.Value;
        if (string.IsNullOrEmpty(userId) || !Guid.TryParse(userId, out var userGuid))
        {
            return Results.Unauthorized();
        }

        var services = context.HttpContext.RequestServices;
        var roles = services.GetService<IProfileRoles>() ?? new DbProfileRoles(services.GetRequiredService<NpgsqlDataSource>());
        var role = await roles.RoleOfAsync(userGuid, context.HttpContext.RequestAborted);

        if (role != "admin")
        {
            return Results.Json(new { error = "Admin role required." }, statusCode: StatusCodes.Status403Forbidden);
        }

        return await next(context);
    }
}

// Who has which role, from the profile table. An interface only so the contract
// tests can act as a farmer without a database.
public interface IProfileRoles
{
    Task<string?> RoleOfAsync(Guid profileId, CancellationToken ct);
}

public sealed class DbProfileRoles : IProfileRoles
{
    private readonly NpgsqlDataSource _dataSource;
    public DbProfileRoles(NpgsqlDataSource dataSource) => _dataSource = dataSource;

    public async Task<string?> RoleOfAsync(Guid profileId, CancellationToken ct)
    {
        await using var connection = await _dataSource.OpenConnectionAsync(ct);
        await using var cmd = new NpgsqlCommand("select role from profile where id = $1", connection);
        cmd.Parameters.AddWithValue(profileId);
        return await cmd.ExecuteScalarAsync(ct) as string;
    }
}
