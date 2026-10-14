using System.Security.Claims;
using AgroFlow.Api.Auth;
using AgroFlow.Business;
using AgroFlow.Api.Services;

namespace AgroFlow.Api.Endpoints;

public sealed record TankCapacityBody(decimal Litres);
public sealed record TankRefillBody(decimal LitresAdded, decimal? WaterPh, DateTimeOffset? RefilledAt);
public sealed record SoilPhBody(decimal Ph, DateTimeOffset? MeasuredAt, string? Note);

public static class TankPhEndpoints
{
    public static void MapTankPhEndpoints(this WebApplication app)
    {
        var farms = app.MapGroup("/api/farmer/farms/{farmId:long}/tank").RequireAuthorization();
        farms.MapGet("/", GetTank);
        farms.MapPut("/", SetCapacity);
        farms.MapPost("/refills", LogRefill);

        var zones = app.MapGroup("/api/farmer/zones/{zoneId:long}/soil-ph").RequireAuthorization();
        zones.MapGet("/", GetSoilPh);
        zones.MapPost("/", LogSoilPh);

        app.MapGet("/api/admin/farms/{farmId:long}/tank-ph", GetAdminTankPh)
            .RequireAuthorization().AddEndpointFilter<AdminOnlyFilter>();
    }

    private static IResult GetTank(long farmId, ClaimsPrincipal user, TankPhController controller)
    {
        if (!TryUser(user, out var userId)) return Results.Unauthorized();
        if (!controller.CanAccessFarm(farmId, userId)) return Results.NotFound(new { error = "Farm not found." });
        return controller.GetTank(farmId) is { } status
            ? Results.Ok(status)
            : Results.NotFound(new { error = "Farm not found." });
    }

    private static IResult SetCapacity(
        long farmId, TankCapacityBody body, ClaimsPrincipal user, TankPhController controller)
    {
        if (!TryUser(user, out var userId)) return Results.Unauthorized();
        if (!controller.CanAccessFarm(farmId, userId)) return Results.NotFound(new { error = "Farm not found." });
        var error = controller.SetCapacity(farmId, body.Litres);
        return error is null ? Results.Ok(controller.GetTank(farmId)) : Results.BadRequest(new { error });
    }

    private static async Task<IResult> LogRefill(
        long farmId, TankRefillBody body, ClaimsPrincipal user, TankPhController controller,
        TankLowMonitorService monitor, CancellationToken ct)
    {
        if (!TryUser(user, out var userId)) return Results.Unauthorized();
        if (!controller.CanAccessFarm(farmId, userId)) return Results.NotFound(new { error = "Farm not found." });
        var (result, error) = controller.LogRefill(
            farmId, body.LitresAdded, body.WaterPh, body.RefilledAt ?? DateTimeOffset.UtcNow, userId);
        if (error is not null) return Results.BadRequest(new { error });
        await monitor.CheckFarmAsync(farmId, ct);
        return Results.Ok(result);
    }

    private static IResult GetSoilPh(long zoneId, ClaimsPrincipal user, TankPhController controller)
    {
        if (!TryUser(user, out var userId)) return Results.Unauthorized();
        if (!controller.CanAccessZone(zoneId, userId)) return Results.NotFound(new { error = "Zone not found." });
        return Results.Ok(new { zoneId, entries = controller.GetSoilPh(zoneId) });
    }

    private static IResult LogSoilPh(
        long zoneId, SoilPhBody body, ClaimsPrincipal user, TankPhController controller)
    {
        if (!TryUser(user, out var userId)) return Results.Unauthorized();
        if (!controller.CanAccessZone(zoneId, userId)) return Results.NotFound(new { error = "Zone not found." });
        var (entry, error) = controller.LogSoilPh(
            zoneId, body.Ph, body.MeasuredAt ?? DateTimeOffset.UtcNow, body.Note, userId);
        return error is null ? Results.Ok(entry) : Results.BadRequest(new { error });
    }

    private static IResult GetAdminTankPh(long farmId, TankPhController controller)
    {
        var tank = controller.GetTank(farmId);
        if (tank is null) return Results.NotFound(new { error = "Farm not found." });

        var zones = controller.DataForAdmin(farmId);
        return Results.Ok(new { tank, zones });
    }

    private static bool TryUser(ClaimsPrincipal user, out Guid id)
        => Guid.TryParse(user.FindFirstValue("sub") ?? user.FindFirstValue(ClaimTypes.NameIdentifier), out id);
}
