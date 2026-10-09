using System.Security.Claims;
using AgroFlow.Business;
using AgroFlow.Business.Agronomy;
using AgroFlow.Business.Agronomy.RuleBook;
using Npgsql;

namespace AgroFlow.Api.Endpoints;

// GET /api/farmer/farms/{farmId}/today: one card per zone with today's single
// action, how sure we are, and the one setup step that would help. The mobile Home screen and the admin farm page
// read the same thing, so an officer on the phone sees what the farmer sees.
//
// Read-only: the engine is run without persisting, exactly like the
// confidence badge on the insights endpoint.
public static class TodayEndpoints
{
    public static void MapTodayEndpoints(this WebApplication app)
    {
        app.MapGet("/api/farmer/farms/{farmId:long}/today", GetTodayAsync).RequireAuthorization();
    }

    private static async Task<IResult> GetTodayAsync(
        long farmId, ClaimsPrincipal user, NpgsqlDataSource dataSource, Fao56EngineController engine,
        ILoggerFactory loggerFactory, CancellationToken ct)
    {
        if (!Guid.TryParse(user.FindFirstValue("sub") ?? user.FindFirstValue(ClaimTypes.NameIdentifier), out var userId))
        {
            return Results.Unauthorized();
        }

        // 1. Only the farm's owner, a member or an admin may see this farm.
        await using (var connection = await dataSource.OpenConnectionAsync(ct))
        await using (var cmd = new NpgsqlCommand(
            """
            select exists (
              select 1 from farm f
               where f.farm_id = $1
                 and (f.owner_id = $2
                   or exists (select 1 from farm_member fm where fm.farm_id = f.farm_id and fm.profile_id = $2)
                   or exists (select 1 from profile p where p.id = $2 and p.role = 'admin')))
            """, connection))
        {
            cmd.Parameters.AddWithValue(farmId);
            cmd.Parameters.AddWithValue(userId);
            if (await cmd.ExecuteScalarAsync(ct) is not true) return Results.NotFound(new { error = "Farm not found." });
        }

        var isAdmin = await IsAdminAsync(dataSource, userId, ct);
        var today = Fao56EngineController.TodayInSast();
        var logger = loggerFactory.CreateLogger("AgroFlow.Api.Today");
        var cards = new List<object>();

        // 2. Run the engine for each zone: the XDB loads the rows, the
        //    controller builds the input, and Fao56Engine works out the advice.
        foreach (var zone in engine.Data.GetZonesForFarm(farmId))
        {
            try
            {
                var input = engine.BuildInput(zone, today);
                var result = Fao56Engine.Run(input);
                var insights = ZoneInsightBuilder.Build(input, result, engine.BuildFaultSignals(zone, today));

                // 3. Turn the result into the plain-language card the app shows.
                var action = TodayRules.For(result, insights);

                cards.Add(new
                {
                    zoneId = zone.ZoneId,
                    name = zone.ZoneName,
                    action = new { kind = action.Kind, text = action.Text },
                    why = action.Why is null ? null : Plain(action.Why, isAdmin),
                    confidence = new { level = result.Confidence.Key, reason = result.Confidence.Reason },
                    confidenceExplanation = Plain(Explanations.Confidence(result), isAdmin),
                    nextStep = result.NextStep is null ? null : new { field = result.NextStep.Field, ask = result.NextStep.Ask },
                    // The "Finish setup" checklist ticks these off.
                    setup = new
                    {
                        crop = result.Setup.CropKnown,
                        plantingDate = result.Setup.PlantingDateKnown,
                        soil = result.Setup.SoilSet,
                        area = result.Setup.AreaSet,
                        flowRate = result.Setup.FlowRateSet,
                        calibrated = result.Setup.Calibrated,
                        hasKit = result.Setup.HasKit,
                    },
                });
            }
            catch (Exception ex)
            {
                // One zone the engine cannot read must not empty the screen.
                logger.LogWarning(ex, "Could not work out today's action for zone {ZoneId}.", zone.ZoneId);
                cards.Add(new
                {
                    zoneId = zone.ZoneId,
                    name = zone.ZoneName,
                    action = new { kind = "setup", text = "Advice for this zone could not be worked out right now" },
                    why = (object?)null,
                    confidence = (object?)null,
                    confidenceExplanation = (object?)null,
                    nextStep = (object?)null,
                    setup = (object?)null,
                });
            }
        }

        return Results.Ok(new { farmId, day = today.ToString("yyyy-MM-dd"), zones = cards });
    }

    // Farmers never get the technical line; admins do.
    private static Explanation Plain(Explanation e, bool isAdmin)
    {
        if (!isAdmin) e.Technical = string.Empty;
        return e;
    }

    private static async Task<bool> IsAdminAsync(NpgsqlDataSource dataSource, Guid userId, CancellationToken ct)
    {
        await using var connection = await dataSource.OpenConnectionAsync(ct);
        await using var cmd = new NpgsqlCommand("select role = 'admin' from profile where id = $1", connection);
        cmd.Parameters.AddWithValue(userId);
        return await cmd.ExecuteScalarAsync(ct) is true;
    }
}
