using Npgsql;

namespace AgroFlow.Api.Auth;

// Applied to admin-facing endpoints alongside .RequireAuthorization(). JWT
// bearer validation (configured in Program.cs) only proves the caller is a
// genuine, logged-in Supabase Auth user - it says nothing about their role,
// since that lives in our own profile table, not in the token. This filter
// does the actual admin-role check via a DB lookup rather than trusting a
// role claim embedded in the JWT, which would require extra Supabase-side
// custom-claims configuration this project doesn't have set up.
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

// Who has which role, from the profile table. An interface only so the API's
// own contract tests can play a farmer without a database (Part 2); the API
// registers the database one, and the filter falls back to it regardless.
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
