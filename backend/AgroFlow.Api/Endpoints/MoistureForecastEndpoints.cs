using System.Security.Claims;
using AgroFlow.Api.Ml;
using AgroFlow.Business;

namespace AgroFlow.Api.Endpoints;

public static class MoistureForecastEndpoints
{
    public static void MapMoistureForecastEndpoints(this WebApplication app)
    {
        // The zone screen's "Forecast (machine learning model)" line. Available=false
        // means the app shows nothing.
        app.MapGet("/api/farmer/zones/{zoneId:long}/moisture-forecast", GetForecast).RequireAuthorization();
    }

    private static IResult GetForecast(
        long zoneId, ClaimsPrincipal user, MoistureMlController controller, MoistureForecastService forecasts)
    {
        if (!Guid.TryParse(user.FindFirstValue("sub") ?? user.FindFirstValue(ClaimTypes.NameIdentifier), out var userId))
            return Results.Unauthorized();
        if (!controller.CanAccessZone(zoneId, userId)) return Results.NotFound(new { error = "Zone not found." });
        return Results.Ok(forecasts.ForZone(zoneId));
    }
}
