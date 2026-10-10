using System.Security.Claims;
using AgroFlow.Business;
using AgroFlow.Business.Agronomy;
using AgroFlow.Business.Agronomy.RuleBook;

namespace AgroFlow.Api.Endpoints;

public record SoilTypeRequest(string? Soil_Type);
public record CalibrationRequest(string? Point);

// Farmer-facing engine endpoints: reset a zone's watering levels to the FAO-56
// recommendation, save a wet/dry calibration point, and set the soil type.
// Security: each one checks the caller can reach the zone's farm (owner, member
// or admin), the same rule as the report endpoints.
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

        // Admin: "Run advice now" on a zone, so we can show the engine working without
        // waiting for the nightly run. It writes the same zone_water_balance and
        // ai_recommendation rows and never touches the pump.
        app.MapPost("/api/admin/zones/{zoneId:long}/run-advice", RunAdviceNow)
            .RequireAuthorization()
            .AddEndpointFilter<AgroFlow.Api.Auth.AdminOnlyFilter>();
    }

    private static IResult RunAdviceNow(
        long zoneId,
        ClaimsPrincipal user,
        Fao56EngineController engine,
        AgroFlow.Api.Services.AuditLog audit,
        ILoggerFactory loggerFactory)
    {
        var logger = loggerFactory.CreateLogger("AgroFlow.Api.RunAdvice");

        var zone = engine.Data.GetZone(zoneId);
        if (zone is null) return Results.NotFound(new { error = "Zone not found." });

        var today = Fao56EngineController.TodayInSast();

        ZoneEngineResult result;
        List<ZoneInsight> insights;

        try
        {
            // The same call the nightly run makes, so the admin sees what the farmer will get.
            insights = engine.RunZoneAndWriteInsights(zone, today);
            result = engine.RunZone(zone, today, persist: false);
        }
        catch (Exception ex)
        {
            // An engine error should say what broke, not turn into a 500.
            logger.LogError(ex, "Run-advice failed for zone {ZoneId}.", zoneId);

            return Results.Problem(
                title: "The advice engine could not run for this zone.",
                detail: ex.Message,
                statusCode: StatusCodes.Status500InternalServerError);
        }

        logger.LogInformation(
            "Ran advice for zone {ZoneId} ({Name}): {Count} insight(s), {Missing} setup item(s) missing.",
            zoneId, zone.ZoneName, insights.Count, result.MissingSetup.Count);

        // It writes new rows, so we audit it. Fire-and-forget because this handler is
        // synchronous (DB/XDB/Controller pattern).
        _ = audit.WriteAsync(
            user, AgroFlow.Api.Services.AuditActions.ZoneAdviceRun,
            "zone", zoneId.ToString(), farmId: zone.FarmId,
            details: new { insights = insights.Count, setupMissing = result.MissingSetup.Count });

        return Results.Ok(new
        {
            zoneId,
            zoneName = zone.ZoneName,
            ranFor = today.ToString("yyyy-MM-dd"),

            // The main numbers, in the order someone checking the engine reads them.
            stage = result.Stage is { } st ? Fao56EngineReference.StageLabel(st) : null,
            dayOfSeason = result.DayOfSeason,
            crop = result.Crop?.Label,
            soil = result.Soil.Label,
            soilWasDefaulted = result.SoilWasDefaulted,

            // "Water need": what the crop used today and what is owed.
            etcTodayMm = Round(result.EtcTodayMm),
            etoTodayMm = Round(result.EtoTodayMm),
            depletionMm = Round(result.DepletionMm),
            readilyAvailableMm = Round(result.RawMm),
            totalAvailableMm = Round(result.TawMm),
            recommendedLitres = Round(result.RecommendedLitres),
            recommendedMinutes = result.RecommendedMinutes,
            recommendedRuntimeSeconds = Round(result.RecommendedRuntimeSeconds),
            recommendedDepthMm = Round(result.RecommendedDepthMm),
            primaryAction = result.PrimaryAction.ToString(),
            forecastRainTodayMm = Round(result.ForecastRainTodayMm),
            projectedPostRainDepletionMm = Round(result.ProjectedPostRainDepletionMm),
            equipmentWarning = result.EquipmentWarning,

            daysToNextWatering = result.DaysToNextWatering,
            nextWateringDate = result.NextWateringDate?.ToString("yyyy-MM-dd"),

            moisturePercent = Round(result.RelativeMoisturePercent),
            sensorDomain = result.SensorDomain.ToString(),
            sensorModifier = result.SensorModifier,
            balanceRan = result.BalanceRan,
            confidence = new { level = result.Confidence.Key, reason = result.Confidence.Reason },

            outlook = result.Outlook.Select(d => new
            {
                date = d.Date.ToString("yyyy-MM-dd"),
                action = d.Action.ToString(),
                requiredDepthMm = Round(d.RequiredDepthMm),
                litres = Round(d.Litres),
                runtimeSeconds = Round(d.RuntimeSeconds),
                forecastRainMm = Round(d.ForecastRainMm),
                projectedDepletionMm = Round(d.ProjectedDepletionMm),
                confidence = d.Confidence,
                tentative = d.Tentative,
                advice = d.Advice,
            }),

            // Why the engine could not answer, if it could not: the missing fields.
            setupMissing = result.MissingSetup,
            limitations = result.Limitations,

            insights = insights.Select(i => new
            {
                insightType = i.InsightType,
                severity = i.Severity,
                message = i.Message,
                // Admins see the full explanation, including the technical part.
                explanation = i.Explanation,
            }),
        });
    }

    private static double? Round(double? value) =>
        value is { } v ? Math.Round(v, 1) : null;

    // Synchronous handlers: the engine's data layer is synchronous (DB/XDB/Controller
    // pattern), and Minimal APIs accept a non-Task return.
    private static IResult ResetRecommended(
        long zoneId, ClaimsPrincipal user, Fao56EngineController engine)
    {
        if (!TryGetUserId(user, out var userId)) return Results.Unauthorized();
        if (!engine.Data.CanAccessZone(userId, zoneId, out _)) return Results.NotFound(new { error = "Zone not found." });

        var outcome = engine.ResetToRecommended(zoneId);

        // A missing crop or calibration is a normal answer, so it is a 400 with the
        // plain message for the farmer.
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

    // Today's insights for a zone. The app could read ai_recommendation under RLS,
    // but this way it does not need to know the severity order or the day boundary.
    private static IResult GetInsights(
        long zoneId, ClaimsPrincipal user, Fao56EngineController engine)
    {
        if (!TryGetUserId(user, out var userId)) return Results.Unauthorized();
        if (!engine.Data.CanAccessZone(userId, zoneId, out _)) return Results.NotFound(new { error = "Zone not found." });

        var today = Fao56EngineController.TodayInSast();
        var insights = engine.Data.GetInsights(zoneId, today, includeDismissed: false);
        var advice = TryRunAdvice(engine, zoneId, today);

        return Results.Ok(new
        {
            zoneId,
            day = today.ToString("yyyy-MM-dd"),
            insights = insights.Select(i => new
            {
                insightType = i.InsightType,
                severity = i.Severity,
                message = i.Message,

                // The explanation stored with the insight, as it was when written (null for
                // older rows). Farmers never get the technical part.
                explanation = StoredExplanation(i, includeTechnical: false),
            }),

            // The growth summary, so one call fills both the insights card and the growth bar.
            // zone_water_balance has the stage and day but not the season length, which only
            // the crop knowledge (Table 11) has, so we build it here.
            // Null when the crop or planting date is unknown, and the app then shows nothing.
            growth = BuildGrowthSummary(engine, zoneId, today),

            // How sure today's advice is and the one step that would improve it.
            // Null if the engine could not run.
            confidence = advice?.Confidence is { } c ? new { level = c.Key, reason = c.Reason } : null,
            nextStep = advice?.NextStep is { } s ? new { field = s.Field, ask = s.Ask } : null,
            stageAssumed = advice?.StageAssumed,

            // "Why am I seeing this?" for the confidence badge, from the same setup state
            // ConfidenceRules used.
            confidenceExplanation = advice is null ? null : WithoutTechnical(Explanations.Confidence(advice)),
        });
    }

    // Farmers never get the technical line; it is for admins and report appendices.
    private static Explanation WithoutTechnical(Explanation e)
    {
        e.Technical = string.Empty;
        return e;
    }

    // The explanation saved in ai_recommendation.data, or null.
    internal static System.Text.Json.Nodes.JsonObject? StoredExplanation(ZoneInsight insight, bool includeTechnical)
    {
        if (!insight.Data.TryGetValue("raw", out var raw) || raw is not string json) return null;

        try
        {
            var node = System.Text.Json.Nodes.JsonNode.Parse(json) as System.Text.Json.Nodes.JsonObject;
            if (node?["explanation"] is not System.Text.Json.Nodes.JsonObject explanation) return null;

            var copy = (System.Text.Json.Nodes.JsonObject)explanation.DeepClone();
            if (!includeTechnical) copy.Remove("technical");
            return copy;
        }
        catch (System.Text.Json.JsonException)
        {
            return null;
        }
    }

    // A read-only engine run for the confidence badge. Never saves; a failure leaves
    // the insights untouched.
    private static ZoneEngineResult? TryRunAdvice(Fao56EngineController engine, long zoneId, DateOnly today)
    {
        try
        {
            var zone = engine.Data.GetZone(zoneId);
            return zone is null ? null : engine.RunZone(zone, today, persist: false);
        }
        catch (Exception)
        {
            return null;
        }
    }

    private sealed record GrowthSummary(
        string Stage, int DayOfSeason, int TotalDays, string CropLabel);

    private static GrowthSummary? BuildGrowthSummary(
        Fao56EngineController engine, long zoneId, DateOnly today)
    {
        var zone = engine.Data.GetZone(zoneId);
        if (zone?.PlantingDate is null) return null;

        var crop = Fao56Knowledge.TryResolve(zone.CropType);
        if (crop is null) return null;

        var lengths = crop.StageLengths;
        var totalDays = lengths.InitialDays + lengths.DevelopmentDays
                      + lengths.MidSeasonDays + lengths.LateSeasonDays;

        if (totalDays <= 0) return null;

        // Day 1 is the planting date itself, matching zone_water_balance.day_of_season.
        var dayOfSeason = today.DayNumber - zone.PlantingDate.Value.DayNumber + 1;

        // A future planting date is a typo or a crop not yet planted: no season to show.
        if (dayOfSeason < 1) return null;

        var stage = SoilWaterBalance.Stage(
            lengths.InitialDays, lengths.DevelopmentDays,
            lengths.MidSeasonDays, lengths.LateSeasonDays, dayOfSeason);

        return new GrowthSummary(
            Fao56EngineReference.StageLabel(stage),
            dayOfSeason,
            totalDays,
            crop.DisplayName);
    }

    // Dismissing normally goes through RLS from the app; this route is for when the
    // app already holds an API token. It records the dismissal (never deletes) so it
    // can be restored.
    private static async Task<IResult> DismissInsight(
        string insightType, long zoneId, ClaimsPrincipal user, Fao56EngineController engine,
        AgroFlow.Api.Services.DismissalService dismissals, CancellationToken ct)
    {
        if (!TryGetUserId(user, out var userId)) return Results.Unauthorized();
        if (!engine.Data.CanAccessZone(userId, zoneId, out _)) return Results.NotFound(new { error = "Zone not found." });

        var key = AgroFlow.Api.Services.DismissalService.InsightKey(zoneId, insightType, Fao56EngineController.TodayInSast());
        var outcome = await dismissals.FarmerDismissAsync(user,
            new AgroFlow.Api.Services.DismissRequest("insight", key, null, null, false, null, null), ct);
        return outcome.Status == 200 ? Results.Ok(new { message = "Dismissed." }) : outcome.ToResult();
    }

    private static bool TryGetUserId(ClaimsPrincipal user, out Guid userId) =>
        Guid.TryParse(user.FindFirstValue(ClaimTypes.NameIdentifier) ?? user.FindFirstValue("sub"), out userId);
}
