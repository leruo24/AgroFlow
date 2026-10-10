using System.Security.Claims;
using AgroFlow.Api.Auth;
using AgroFlow.Api.Services;
using AgroFlow.Business;
using AgroFlow.Business.Agronomy;
using AgroFlow.Business.Agronomy.RuleBook;
using Npgsql;
using NpgsqlTypes;

namespace AgroFlow.Api.Endpoints;

// What was changed, never who: the person comes from the login.
public record CropChangeBody(string? CropType, DateOnly? PlantingDate);

// The register-farm wizard's card, before the zone exists.
public record RecommendationPreviewBody(
    string? CropType, string? SoilType, double? AreaM2, double? FlowRateLpm,
    double? RootDepthLimitM, DateOnly? PlantingDate, string? Location);

// "Recommended for you", and the farmer changing the crop.
//
// GET  /api/farmer/zones/{id}/recommended-settings - the card for a zone.
// POST /api/admin/recommended-settings/preview     - the wizard's card.
// PUT  /api/farmer/zones/{id}/crop                  - crop and planting date.
// "Use these settings" is POST .../reset-recommended, which saves the same
// threshold this card shows.
public static class RecommendationEndpoints
{
    public static void MapRecommendationEndpoints(this WebApplication app)
    {
        var farmer = app.MapGroup("/api/farmer/zones/{zoneId:long}").RequireAuthorization();
        farmer.MapGet("/recommended-settings", GetForZoneAsync);
        farmer.MapPut("/crop", ChangeCropAsync);

        app.MapPost("/api/admin/recommended-settings/preview", Preview)
            .RequireAuthorization()
            .AddEndpointFilter<AdminOnlyFilter>();
    }

    /// The crop must be one the engine knows; the date not in the future and at most
    /// two years back (same limits as registration).
    public static string? CheckCropChange(CropChangeBody body, DateOnly today)
    {
        if (Fao56EngineReference.TryResolveCrop(body.CropType) is null)
            return "Choose a crop from the list.";
        return ZoneSetupFields.Check("This zone", double.MaxValue, null, null, body.PlantingDate, null, null, today)
            ?.Replace("Zone 'This zone': ", "");
    }

    /// Security: someone else's zone gets 403, never a silent no-op; a missing zone
    /// gets 404. Null = go ahead.
    public static IResult? Refusal(bool zoneExists, bool canAccess)
    {
        if (!zoneExists) return Results.NotFound(new { error = "Zone not found." });
        if (!canAccess)
            return Results.Json(new { error = "You can only change the crop on your own zones." }, statusCode: StatusCodes.Status403Forbidden);
        return null;
    }

    public static object ToDto(Recommendation r, bool calibrated) => new
    {
        available = true,
        crop = r.CropKey,
        cropLabel = r.CropLabel,
        soilLabel = r.SoilLabel,
        soilAssumed = r.SoilAssumed,
        stageAssumed = r.StageAssumed,
        thresholdPercent = r.ThresholdPercent,
        stopPercent = r.StopPercent,
        intervalDaysLow = r.IntervalDaysLow,
        intervalDaysHigh = r.IntervalDaysHigh,
        minutes = r.Minutes,
        litres = r.Litres is { } l ? Math.Round(l, 1) : (double?)null,
        etoBasis = r.EtoBasis,
        text = r.Text,
        confidence = new { level = r.Confidence.Key, reason = r.Confidence.Reason },
        // "Use these settings" saves thresholds in the sensor's own units, which needs
        // the wet/dry setup. Without it the button explains that.
        canApply = calibrated,
        applyNote = calibrated ? null : "Do the wet and dry soil setup first; then Use these settings saves this level.",
    };

    private static int? DayOfSeason(DateOnly? planted, DateOnly today) =>
        planted is { } p && p <= today ? today.DayNumber - p.DayNumber + 1 : null;

    private static async Task<IResult> GetForZoneAsync(
        long zoneId, ClaimsPrincipal user, NpgsqlDataSource dataSource, Fao56EngineController engine, CancellationToken ct)
    {
        if (!TryGetUserId(user, out var userId)) return Results.Unauthorized();
        if (!engine.Data.CanAccessZone(userId, zoneId, out var farmId)) return Results.NotFound(new { error = "Zone not found." });

        var zone = engine.Data.GetZone(zoneId);
        if (zone is null) return Results.NotFound(new { error = "Zone not found." });

        var today = Fao56EngineController.TodayInSast();
        var (eto, basis) = engine.Data.GetRecommendationEto(farmId, today);
        var place = await FarmLocationAsync(dataSource, farmId, ct);

        var r = RecommendationRules.For(zone.CropType, zone.SoilType, DayOfSeason(zone.PlantingDate, today), eto, basis,
            zone.AreaM2, zone.FlowRateLpm, zone.RootDepthLimitM, place, today);

        if (r is null)
            return Results.Ok(new { available = false, text = "Choose this zone's crop to see recommended settings." });

        return Results.Ok(ToDto(r, zone.CalibrationWet.HasValue && zone.CalibrationDry.HasValue));
    }

    // A farm that does not exist yet has no weather: RAW uses Table 22's own ETc
    // basis, and the card says how often watering will follow (RecommendationRules).
    private static IResult Preview(RecommendationPreviewBody body)
    {
        var today = Fao56EngineController.TodayInSast();
        var r = RecommendationRules.For(body.CropType, body.SoilType, DayOfSeason(body.PlantingDate, today), null, null,
            body.AreaM2, body.FlowRateLpm, body.RootDepthLimitM, body.Location, today);
        if (r is null) return Results.Ok(new { available = false, text = "Choose a crop to see recommended settings." });
        return Results.Ok(ToDto(r, calibrated: false));
    }

    private static async Task<IResult> ChangeCropAsync(
        long zoneId, CropChangeBody body, ClaimsPrincipal user, NpgsqlDataSource dataSource,
        Fao56EngineController engine, AuditLog audit, CancellationToken ct)
    {
        if (!TryGetUserId(user, out var userId)) return Results.Unauthorized();

        var zone = engine.Data.GetZone(zoneId);
        var canAccess = engine.Data.CanAccessZone(userId, zoneId, out var farmId);
        if (Refusal(zone is not null, canAccess) is { } refused) return refused;

        var today = Fao56EngineController.TodayInSast();
        if (CheckCropChange(body, today) is { } problem) return Results.BadRequest(new { error = problem });

        var newCrop = Fao56EngineReference.TryResolveCrop(body.CropType)!;
        zone = zone!;
        var oldCrop = Fao56EngineReference.TryResolveCrop(zone.CropType);

        await using (var connection = await dataSource.OpenConnectionAsync(ct))
        await using (var cmd = new NpgsqlCommand(
            "update zone set crop_type = $2, planting_date = $3 where id = $1", connection))
        {
            cmd.Parameters.AddWithValue(zoneId);
            cmd.Parameters.AddWithValue(newCrop.Key);
            cmd.Parameters.AddWithValue(NpgsqlDbType.Date, body.PlantingDate is { } p ? (object)p : DBNull.Value);
            await cmd.ExecuteNonQueryAsync(ct);
        }

        var isAdmin = await IsAdminAsync(dataSource, userId, ct);
        if (zone.CropType != newCrop.Key || zone.PlantingDate != body.PlantingDate)
        {
            await audit.WriteAsync(user, AuditActions.ZoneCropChanged, "zone", zoneId.ToString(), farmId, new
            {
                from = zone.CropType,
                to = newCrop.Key,
                fromLabel = oldCrop?.Label ?? zone.CropType,
                toLabel = newCrop.Label,
                fromPlanting = zone.PlantingDate?.ToString("yyyy-MM-dd"),
                toPlanting = body.PlantingDate?.ToString("yyyy-MM-dd"),
                actorRole = isAdmin ? "admin" : "farm_user",
            }, ct);
        }

        var (eto, basis) = engine.Data.GetRecommendationEto(farmId, today);
        var place = await FarmLocationAsync(dataSource, farmId, ct);
        var r = RecommendationRules.For(newCrop.Key, zone.SoilType, DayOfSeason(body.PlantingDate, today), eto, basis,
            zone.AreaM2, zone.FlowRateLpm, zone.RootDepthLimitM, place, today)!;

        return Results.Ok(new
        {
            message = $"Saved: {newCrop.Label}. Today's advice now uses it.",
            recommendation = ToDto(r, zone.CalibrationWet.HasValue && zone.CalibrationDry.HasValue),
        });
    }

    private static async Task<string?> FarmLocationAsync(NpgsqlDataSource dataSource, long farmId, CancellationToken ct)
    {
        await using var connection = await dataSource.OpenConnectionAsync(ct);
        await using var cmd = new NpgsqlCommand("select location from farm where farm_id = $1", connection);
        cmd.Parameters.AddWithValue(farmId);
        var value = await cmd.ExecuteScalarAsync(ct) as string;
        // "Ceres, Western Cape" -> "Ceres": the town is what a farmer calls home.
        return string.IsNullOrWhiteSpace(value) ? null : value.Split(',')[0].Trim();
    }

    private static async Task<bool> IsAdminAsync(NpgsqlDataSource dataSource, Guid userId, CancellationToken ct)
    {
        await using var connection = await dataSource.OpenConnectionAsync(ct);
        await using var cmd = new NpgsqlCommand("select role = 'admin' from profile where id = $1", connection);
        cmd.Parameters.AddWithValue(userId);
        return await cmd.ExecuteScalarAsync(ct) is true;
    }

    private static bool TryGetUserId(ClaimsPrincipal user, out Guid userId) =>
        Guid.TryParse(user.FindFirstValue("sub") ?? user.FindFirstValue(ClaimTypes.NameIdentifier), out userId);
}
