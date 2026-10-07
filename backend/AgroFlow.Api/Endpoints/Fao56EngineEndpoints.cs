using System.Security.Claims;
using AgroFlow.Business;
using AgroFlow.Business.Agronomy;
using AgroFlow.Business.Agronomy.RuleBook;

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

        // ADMIN: "Run advice now" on a zone.
        //
        // Exists so the engine can be PROVEN to work, live, during setup and
        // during the presentation - rather than everyone waiting until just
        // after midnight for the nightly pass and hoping. It writes the
        // normal zone_water_balance and ai_recommendation rows, exactly as
        // that pass does, and never touches the pump: advisory only.
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
            // The same call the nightly pass makes, so what an admin sees
            // here is what the farmer will get - not a parallel code path
            // that could disagree with it.
            insights = engine.RunZoneAndWriteInsights(zone, today);
            result = engine.RunZone(zone, today, persist: false);
        }
        catch (Exception ex)
        {
            // An engine fault during a live demonstration should say what
            // broke, not vanish into a 500.
            logger.LogError(ex, "Run-advice failed for zone {ZoneId}.", zoneId);

            return Results.Problem(
                title: "The advice engine could not run for this zone.",
                detail: ex.Message,
                statusCode: StatusCodes.Status500InternalServerError);
        }

        logger.LogInformation(
            "Ran advice for zone {ZoneId} ({Name}): {Count} insight(s), {Missing} setup item(s) missing.",
            zoneId, zone.ZoneName, insights.Count, result.MissingSetup.Count);

        // Advisory, but it WRITES - new zone_water_balance and
        // ai_recommendation rows - so "why did this zone's advice change on
        // Tuesday?" should have an answer. Fire-and-forget: this handler is
        // synchronous by the engine's DB/XDB/Controller pattern, and an audit
        // row must not be what makes it async.
        _ = audit.WriteAsync(
            user, AgroFlow.Api.Services.AuditActions.ZoneAdviceRun,
            "zone", zoneId.ToString(), farmId: zone.FarmId,
            details: new { insights = insights.Count, setupMissing = result.MissingSetup.Count });

        return Results.Ok(new
        {
            zoneId,
            zoneName = zone.ZoneName,
            ranFor = today.ToString("yyyy-MM-dd"),

            // The headline numbers, in the order somebody checking the
            // engine reads them.
            stage = result.Stage is { } st ? Fao56EngineReference.StageLabel(st) : null,
            dayOfSeason = result.DayOfSeason,
            crop = result.Crop?.Label,
            soil = result.Soil.Label,
            soilWasDefaulted = result.SoilWasDefaulted,

            // "Water need" - what the crop used today and what is owed.
            etcTodayMm = Round(result.EtcTodayMm),
            etoTodayMm = Round(result.EtoTodayMm),
            depletionMm = Round(result.DepletionMm),
            readilyAvailableMm = Round(result.RawMm),
            totalAvailableMm = Round(result.TawMm),
            recommendedLitres = Round(result.RecommendedLitres),
            recommendedMinutes = result.RecommendedMinutes,

            daysToNextWatering = result.DaysToNextWatering,
            nextWateringDate = result.NextWateringDate?.ToString("yyyy-MM-dd"),

            moisturePercent = Round(result.RelativeMoisturePercent),
            balanceRan = result.BalanceRan,

            // Why the engine could NOT answer, when it could not. This is the
            // half that makes the action useful during setup: it names the
            // missing field instead of leaving a blank screen.
            setupMissing = result.MissingSetup,
            limitations = result.Limitations,

            insights = insights.Select(i => new
            {
                insightType = i.InsightType,
                severity = i.Severity,
                message = i.Message,
                // Item 2c: admins see the full explanation, technical part included.
                explanation = i.Explanation,
            }),
        });
    }

    private static double? Round(double? value) =>
        value is { } v ? Math.Round(v, 1) : null;

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

                // ADDITIVE (item 2c): the explanation stored with the insight,
                // exactly as it was when written. Null for rows written before
                // explanations existed. Farmers never get the technical part.
                explanation = StoredExplanation(i, includeTechnical: false),
            }),

            // ADDITIVE: the growth summary, so one call fills both the
            // insights card and the growth bar on the zone screen.
            //
            // It is served here rather than read from zone_water_balance.
            // That table has `stage` and `day_of_season` but NOT the season
            // length, and the growth bar needs all three - "day 62" with no
            // total is not a progress bar. The length comes from the crop's
            // Table 11 stage lengths, which only the knowledge base has, so
            // computing it here is the only place all three exist at once.
            //
            // Null when the crop or the planting date is unknown, and the
            // component renders nothing at all in that case rather than an
            // empty bar - an empty bar reads as "the season has not started",
            // which is a claim the app cannot make.
            growth = BuildGrowthSummary(engine, zoneId, today),

            // ADDITIVE (item 2): how sure today's advice is, and the ONE
            // step that would improve it. Null if the engine could not run;
            // older app builds ignore both fields.
            confidence = advice?.Confidence is { } c ? new { level = c.Key, reason = c.Reason } : null,
            nextStep = advice?.NextStep is { } s ? new { field = s.Field, ask = s.Ask } : null,
            stageAssumed = advice?.StageAssumed,

            // ADDITIVE (item 2c): "Why am I seeing this?" for the confidence
            // badge, from the same setup state ConfidenceRules judged.
            confidenceExplanation = advice is null ? null : WithoutTechnical(Explanations.Confidence(advice)),
        });
    }

    // Farmers never get the technical line; it is for admins and appendices.
    private static Explanation WithoutTechnical(Explanation e)
    {
        e.Technical = string.Empty;
        return e;
    }

    // Item 2c: the explanation saved in ai_recommendation.data, or null.
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

    // Item 2: a read-only engine run for the confidence badge. Never persists;
    // a failure leaves the insights themselves untouched.
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

        // Day 1 is the planting date itself, matching
        // zone_water_balance.day_of_season.
        var dayOfSeason = today.DayNumber - zone.PlantingDate.Value.DayNumber + 1;

        // A planting date in the future is a typo or a crop not yet in the
        // ground. Either way there is no season to show progress through.
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

    // Dismissing is a farmer write, so it goes through RLS from the app rather
    // than here. This endpoint exists only so the app has one path for it when it
    // is already holding an API token.
    // Admin polish: this used to DELETE the insight row. It now dismisses it
    // like every other notification - recorded, never deleted, restorable.
    // The route and its answer are unchanged for older apps.
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
