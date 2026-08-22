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

        var dataSource = context.HttpContext.RequestServices.GetRequiredService<NpgsqlDataSource>();
        await using var connection = await dataSource.OpenConnectionAsync();
        await using var cmd = new NpgsqlCommand("select role from profile where id = $1", connection);
        cmd.Parameters.AddWithValue(userGuid);
        var role = await cmd.ExecuteScalarAsync() as string;

        if (role != "admin")
        {
            return Results.Json(new { error = "Admin role required." }, statusCode: StatusCodes.Status403Forbidden);
        }

        return await next(context);
    }
}
