using System.Security.Claims;
using AgroFlow.Business;
using AgroFlow.Business.Agronomy;

namespace AgroFlow.Api.Endpoints;

public record SoilTypeRequest(string? Soil_Type);
public record CalibrationRequest(string? Point);

// The farmer-facing engine endpoints: reset a zone's watering levels to the
// FAO-56 recommendation, save a wet/dry calibration point, and set the soil type.
//
// These are NEW endpoints in a NEW file. Luba's
// PUT /api/farmer/zones/{zoneId}/settings is in flight and is deliberately not
// touched or extended - the soil type gets its own PUT rather than another field
// on hers.
//
// Every one checks that the caller can reach the zone's farm, using the same rule
// the report endpoints use: owner, farm member, or an admin profile.
public static class Fao56EngineEndpoints
{
    public static void MapFao56EngineEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/farmer").RequireAuthorization();

        group.MapPost("/zones/{zoneId:long}/reset-recommended", ResetRecommended);
        group.MapPost("/zones/{zoneId:long}/calibration", SaveCalibration);
        group.MapPut("/zones/{zoneId:long}/soil", SaveSoilType);
        group.MapGet("/zones/{zoneId:long}/insights", GetInsights);
        group.MapPost("/insights/{insightType}/dismiss", DismissInsight);
    }

    // Synchronous bodies: the engine's data layer is synchronous by the project's
    // DB/XDB/Controller pattern. Minimal APIs accept a non-Task return directly.
    private static IResult ResetRecommended(
        long zoneId, ClaimsPrincipal user, Fao56EngineController engine)
    {
        if (!TryGetUserId(user, out var userId)) return Results.Unauthorized();
        if (!engine.Data.CanAccessZone(userId, zoneId, out _)) return Results.NotFound(new { error = "Zone not found." });

        var outcome = engine.ResetToRecommended(zoneId);

        // A missing crop or calibration is a normal answer, not a server fault, so
        // it comes back 400 with the plain message the farmer should see.
        return outcome.Ok
            ? Results.Ok(new { message = outcome.Message, threshold = outcome.Threshold, desired = outcome.Desired })
            : Results.BadRequest(new { error = outcome.Message });
    }

    private static IResult SaveCalibration(
        long zoneId, CalibrationRequest request, ClaimsPrincipal user, Fao56EngineController engine)
    {
        if (!TryGetUserId(user, out var userId)) return Results.Unauthorized();
        if (!engine.Data.CanAccessZone(userId, zoneId, out _)) return Results.NotFound(new { error = "Zone not found." });

        var outcome = engine.SaveCalibrationPoint(zoneId, request.Point ?? "");

        return outcome.Ok
            ? Results.Ok(new { message = outcome.Message, reading = outcome.Reading })
            : Results.BadRequest(new { error = outcome.Message });
    }

    private static IResult SaveSoilType(
        long zoneId, SoilTypeRequest request, ClaimsPrincipal user, Fao56EngineController engine)
    {
        if (!TryGetUserId(user, out var userId)) return Results.Unauthorized();
        if (!engine.Data.CanAccessZone(userId, zoneId, out _)) return Results.NotFound(new { error = "Zone not found." });

        var outcome = engine.SaveSoilType(zoneId, request.Soil_Type);

        return outcome.Ok
            ? Results.Ok(new { message = outcome.Message, soilType = outcome.SoilType })
            : Results.BadRequest(new { error = outcome.Message });
    }

    // Today's insights for a zone. The app can also read ai_recommendation
    // directly under RLS; this exists so the app does not have to know the
    // severity ordering or the day boundary.
    private static IResult GetInsights(
        long zoneId, ClaimsPrincipal user, Fao56EngineController engine)
    {
        if (!TryGetUserId(user, out var userId)) return Results.Unauthorized();
        if (!engine.Data.CanAccessZone(userId, zoneId, out _)) return Results.NotFound(new { error = "Zone not found." });

        var today = Fao56EngineController.TodayInSast();
        var insights = engine.Data.GetInsights(zoneId, today, includeDismissed: false);

        return Results.Ok(new
        {
            zoneId,
            day = today.ToString("yyyy-MM-dd"),
            insights = insights.Select(i => new
            {
                insightType = i.InsightType,
                severity = i.Severity,
                message = i.Message,
            }),
        });
    }

    // Dismissing is a farmer write, so it goes through RLS from the app rather
    // than here. This endpoint exists only so the app has one path for it when it
    // is already holding an API token.
    private static IResult DismissInsight(
        string insightType, long zoneId, ClaimsPrincipal user, Fao56EngineController engine)
    {
        if (!TryGetUserId(user, out var userId)) return Results.Unauthorized();
        if (!engine.Data.CanAccessZone(userId, zoneId, out _)) return Results.NotFound(new { error = "Zone not found." });

        engine.Data.ClearInsight(zoneId, insightType, Fao56EngineController.TodayInSast());
        return Results.Ok(new { message = "Dismissed." });
    }

    private static bool TryGetUserId(ClaimsPrincipal user, out Guid userId) =>
        Guid.TryParse(user.FindFirstValue(ClaimTypes.NameIdentifier) ?? user.FindFirstValue("sub"), out userId);
}
