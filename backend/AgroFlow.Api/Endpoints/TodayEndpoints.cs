using System.Security.Claims;
using AgroFlow.Business;
using AgroFlow.Business.Agronomy;
using AgroFlow.Business.Agronomy.RuleBook;
using Npgsql;

namespace AgroFlow.Api.Endpoints;

// GET /api/farmer/farms/{farmId}/today: one card per zone with today's action,
// how sure we are, and the setup step that would help most. The mobile Home
// screen and the admin farm page read the same data.
// Read-only: the engine runs without saving anything.
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
        var calculatedAt = DateTimeOffset.UtcNow;

        // Each zone's maximum run time (0052), so the app can say when the advice is longer
        // than one run ("Recommended 66 min — your pump is limited to 5 min per run").
        var maxRun = new Dictionary<long, int>();
        // Each zone's irrigation type (0053): a separate layer that turns the engine's net need
        // into the gross amount to apply (ApplicationEfficiency, FAO Training manual 4).
        var irrigationType = new Dictionary<long, string?>();
        await using (var connection = await dataSource.OpenConnectionAsync(ct))
        {
            var maxExpr = await AgroFlow.Api.Services.ZoneRunLimit.ExpressionAsync(connection, "z", ct);
            await using var hasType = new NpgsqlCommand(
                "select exists (select 1 from information_schema.columns where table_name = 'zone' and column_name = 'irrigation_type')", connection);
            var typeExpr = await hasType.ExecuteScalarAsync(ct) is true ? "z.irrigation_type" : "null::text";
            await using var limits = new NpgsqlCommand($"select z.id, {maxExpr}, {typeExpr} from zone z where z.farm_id = $1", connection);
            limits.Parameters.AddWithValue(farmId);
            await using var lr = await limits.ExecuteReaderAsync(ct);
            while (await lr.ReadAsync(ct))
            {
                maxRun[lr.GetInt64(0)] = IrrigationRunRules.ZoneMaxOrDefault(lr.IsDBNull(1) ? null : lr.GetInt32(1));
                irrigationType[lr.GetInt64(0)] = lr.IsDBNull(2) ? null : lr.GetString(2);
            }
        }

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
                irrigationType.TryGetValue(zone.ZoneId, out var zoneIrrigation);
                var why = action.Why is null ? null : Plain(action.Why, isAdmin);
                double? grossLitres = action.Kind == "water" && result.RecommendedLitres is { } netLitres
                    ? ApplicationEfficiency.Gross(netLitres, zoneIrrigation) : null;
                AddIrrigationFact(why, action.Kind, zoneIrrigation);

                cards.Add(new
                {
                    zoneId = zone.ZoneId,
                    name = zone.ZoneName,
                    action = new { kind = action.Kind, text = action.Text },
                    // The engine's own runtime, read as it is (the engine is not changed): only
                    // for a "water" card, in whole minutes, null when it has no runtime.
                    recommendedMinutes = action.Kind == "water" && result.RecommendedRuntimeSeconds is { } secs
                        ? (int?)Math.Ceiling(secs / 60.0) : null,
                    maxRunMinutes = maxRun.TryGetValue(zone.ZoneId, out var limit) ? limit : IrrigationRunRules.DefaultMaxRunMinutes,
                    why,
                    // The amount to apply with this zone's irrigation (net need / efficiency).
                    grossLitres,
                    irrigationType = zoneIrrigation,
                    efficiencyNote = ApplicationEfficiency.Explain(zoneIrrigation),
                    confidence = new { level = result.Confidence.Key, reason = result.Confidence.Reason },
                    confidenceExplanation = Plain(Explanations.Confidence(result), isAdmin),
                    nextStep = result.NextStep is null ? null : new { field = result.NextStep.Field, ask = result.NextStep.Ask },
                    // What the advice was worked out from (AF-18): the crop the zone is SET to (never its
                    // name), the engine's crop model, the weather dates used and when this ran.
                    provenance = AdviceProvenance.From(input, result, calculatedAt),
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
                // One zone that fails should not empty the whole screen.
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

        // Today's weather for the farm: available, missing or stale, never "dry" when unknown (AF-03).
        var weather = await TodayWeatherAsync(dataSource, farmId, today, ct);

        return Results.Ok(new { farmId, day = today.ToString("yyyy-MM-dd"), calculatedAt, weather, zones = cards });
    }

    // Farmers never see the technical line; admins do.
    // On a "water" card, the Why says how much of the water reaches the roots with this
    // zone's irrigation (FAO field application efficiency) - the reason the amount to apply is
    // more than the crop's need. Not for hand watering (no published value) or other cards.
    public static void AddIrrigationFact(Explanation? why, string kind, string? irrigationType)
    {
        if (why is null || kind != "water" || ApplicationEfficiency.For(irrigationType) is null) return;
        why.Facts.Add(new ExplanationFact("How the zone is watered", ApplicationEfficiency.Explain(irrigationType), "FAO irrigation guidance"));
    }

    private static Explanation Plain(Explanation e, bool isAdmin)
    {
        if (!isAdmin) e.Technical = string.Empty;
        return e;
    }

    public static async Task<WeatherAvailability.Status> TodayWeatherAsync(NpgsqlDataSource dataSource, long farmId, DateOnly today, CancellationToken ct)
    {
        await using var connection = await dataSource.OpenConnectionAsync(ct);
        await using var cmd = new NpgsqlCommand(
            "select precipitation_mm, fetched_at from weather_daily where farm_id = $1 and date = $2 limit 1", connection);
        cmd.Parameters.AddWithValue(farmId);
        cmd.Parameters.AddWithValue(today);
        await using var r = await cmd.ExecuteReaderAsync(ct);
        if (!await r.ReadAsync(ct)) return WeatherAvailability.Evaluate(false, null, null, DateTimeOffset.UtcNow);
        return WeatherAvailability.Evaluate(true,
            r.IsDBNull(0) ? null : Convert.ToDouble(r.GetValue(0)),
            r.IsDBNull(1) ? null : r.GetFieldValue<DateTimeOffset>(1),
            DateTimeOffset.UtcNow);
    }

    private static async Task<bool> IsAdminAsync(NpgsqlDataSource dataSource, Guid userId, CancellationToken ct)
    {
        await using var connection = await dataSource.OpenConnectionAsync(ct);
        await using var cmd = new NpgsqlCommand("select role = 'admin' from profile where id = $1", connection);
        cmd.Parameters.AddWithValue(userId);
        return await cmd.ExecuteScalarAsync(ct) is true;
    }
}
