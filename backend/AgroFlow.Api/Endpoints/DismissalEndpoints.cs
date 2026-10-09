using System.Security.Claims;
using AgroFlow.Api.Auth;
using AgroFlow.Api.Services;

namespace AgroFlow.Api.Endpoints;

// Dismiss, history and restore for notifications. The rules are in
// DismissalService; these only route.
public static class DismissalEndpoints
{
    public static void MapDismissalEndpoints(this WebApplication app)
    {
        var admin = app.MapGroup("/api/admin/dismissals").RequireAuthorization().AddEndpointFilter<AdminOnlyFilter>();
        admin.MapGet("", async (DismissalService s, CancellationToken ct) => (await s.AdminListAsync(ct)).ToResult());
        admin.MapPost("", async (DismissRequest body, ClaimsPrincipal user, DismissalService s, CancellationToken ct) =>
            (await s.AdminDismissAsync(user, body, ct)).ToResult());
        admin.MapPost("/{id:long}/restore", async (long id, ClaimsPrincipal user, DismissalService s, CancellationToken ct) =>
            (await s.AdminRestoreAsync(user, id, ct)).ToResult());
        admin.MapPost("/{id:long}/condition-cleared", async (long id, ClaimsPrincipal user, DismissalService s, CancellationToken ct) =>
            (await s.AdminClearAsync(user, id, ct)).ToResult());

        var farmer = app.MapGroup("/api/farmer/dismissals").RequireAuthorization();
        farmer.MapGet("", async (long farmId, ClaimsPrincipal user, DismissalService s, CancellationToken ct) =>
            (await s.FarmerListAsync(user, farmId, ct)).ToResult());
        farmer.MapPost("", async (DismissRequest body, ClaimsPrincipal user, DismissalService s, CancellationToken ct) =>
            (await s.FarmerDismissAsync(user, body, ct)).ToResult());
        farmer.MapPost("/{id:long}/restore", async (long id, ClaimsPrincipal user, DismissalService s, CancellationToken ct) =>
            (await s.FarmerRestoreAsync(user, id, ct)).ToResult());
    }
}
