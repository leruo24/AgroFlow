using System.Security.Claims;
using Npgsql;
using NpgsqlTypes;
using AgroFlow.Business.Agronomy;

namespace AgroFlow.Api.Endpoints;

public static class ReportEndpoints
{
    // South Africa has no daylight saving, so a fixed zone is safe for day boundaries.
    private const string ReportTimeZone = "Africa/Johannesburg";
    private const int MaxRangeDays = 366;

    public static void MapReportEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/farmer/reports").RequireAuthorization();
        group.MapGet("/water-usage", GetWaterUsageAsync);
    }

    private static bool TryGetUserId(ClaimsPrincipal user, out Guid userId) =>
        Guid.TryParse(user.FindFirstValue("sub"), out userId);

    private static async Task<IResult> GetWaterUsageAsync(
        ClaimsPrincipal user, NpgsqlDataSource dataSource, long? farmId, DateOnly? from, DateOnly? to)
    {
        if (!TryGetUserId(user, out var userId)) return Results.Unauthorized();

        if (farmId is null) return Results.BadRequest(new { error = "farmId is required." });
        if (from is null || to is null) return Results.BadRequest(new { error = "from and to dates are required (yyyy-MM-dd)." });
        if (from > to) return Results.BadRequest(new { error = "from must not be after to." });
        if (to.Value.DayNumber - from.Value.DayNumber >= MaxRangeDays)
            return Results.BadRequest(new { error = $"Date range must not exceed {MaxRangeDays} days." });

        await using var connection = await dataSource.OpenConnectionAsync();

        // 1. Ownership gate. Not found and not allowed look identical on purpose.
        const string farmSql = """
            select f.name from farm f
            where f.farm_id = $1
              and (f.owner_id = $2 or exists (
                select 1 from farm_member fm where fm.farm_id = f.farm_id and fm.profile_id = $2));
            """;
        string farmName;
        await using (var farmCmd = new NpgsqlCommand(farmSql, connection))
        {
            farmCmd.Parameters.AddWithValue(farmId.Value);
            farmCmd.Parameters.AddWithValue(userId);
            var result = await farmCmd.ExecuteScalarAsync();
            if (result is null) return Results.NotFound(new { error = "Farm not found." });
            farmName = result as string ?? "";
        }

        // 2. Zones of that farm (already access-checked above) with per-day runtime.
        //    Litres are NOT read from irrigation_event.estimated_litres (seeded/stale);
        //    they are derived from runtime and zone.flow_rate_lpm.
        const string usageSql = """
            select z.id, z.name, z.flow_rate_lpm, d.usage_date, d.event_count, d.runtime_seconds_total
            from zone z
            left join lateral (
                select (e.started_at at time zone 'Africa/Johannesburg')::date as usage_date,
                       count(*)               as event_count,
                       sum(e.runtime_seconds) as runtime_seconds_total
                from irrigation_event e
                where e.zone_id = z.id
                  and e.started_at >= $2::date::timestamp at time zone 'Africa/Johannesburg'
                  and e.started_at <  ($3::date + 1)::timestamp at time zone 'Africa/Johannesburg'
                group by 1
            ) d on true
            where z.farm_id = $1
            order by z.id, d.usage_date;
            """;

        var zones = new List<ZoneUsage>();
        await using (var cmd = new NpgsqlCommand(usageSql, connection))
        {
            cmd.Parameters.AddWithValue(farmId.Value);
            cmd.Parameters.AddWithValue(NpgsqlDbType.Date, from.Value);
            cmd.Parameters.AddWithValue(NpgsqlDbType.Date, to.Value);
            await using var reader = await cmd.ExecuteReaderAsync();
            while (await reader.ReadAsync())
            {
                var zoneId = reader.GetInt64(0);
                var zone = zones.Find(z => z.ZoneId == zoneId);
                if (zone is null)
                {
                    zone = new ZoneUsage(
                        zoneId,
                        reader.IsDBNull(1) ? $"Zone {zoneId}" : reader.GetString(1),
                        reader.IsDBNull(2) ? null : reader.GetFloat(2));
                    zones.Add(zone);
                }
                if (reader.IsDBNull(3)) continue; // zone had no events in range
                var runtime = reader.GetInt64(5);
                zone.Days.Add(new DayUsage(
                    reader.GetFieldValue<DateOnly>(3).ToString("yyyy-MM-dd"),
                    reader.GetInt64(4),
                    runtime,
                    Litres(runtime, zone.FlowRateLpm)));
            }
        }

        var zoneDtos = zones.Select(z =>
        {
            var runtimeTotal = z.Days.Sum(d => d.RuntimeSeconds);
            var status = z.Days.Count == 0 ? "no_events"
                       : z.FlowRateLpm is null ? "no_flow_rate"
                       : "ok";
            return new
            {
                zoneId = z.ZoneId,
                name = z.Name,
                flowRateLpm = z.FlowRateLpm,
                status,
                message = status switch
                {
                    "no_events" => "Not enough data yet: no irrigation recorded in this period.",
                    "no_flow_rate" => "Not enough data yet: set this zone's flow rate to estimate water use.",
                    _ => (string?)null,
                },
                eventCount = z.Days.Sum(d => d.EventCount),
                runtimeSecondsTotal = runtimeTotal,
                estimatedLitres = status == "ok" ? Litres(runtimeTotal, z.FlowRateLpm) : null,
                days = z.Days,
            };
        });

        return Results.Ok(new
        {
            farmId,
            farmName,
            from = from.Value.ToString("yyyy-MM-dd"),
            to = to.Value.ToString("yyyy-MM-dd"),
            generatedAt = DateTimeOffset.UtcNow,
            isEstimate = true,
            estimateNote = "Estimated: pump run time x zone flow rate. No flow meter is installed.",
            zones = zoneDtos,
        });
    }

    
    private static double? Litres(long runtimeSeconds, float? flowRateLpm)
    {
        var estimate = WaterUsageEstimator.EstimateEventLitres(          // <-- changed
            (int)Math.Min(runtimeSeconds, int.MaxValue), flowRateLpm);   // <-- changed
        return estimate is null ? null : Math.Round(estimate.Litres, 2); // <-- changed
    }

    private sealed record DayUsage(string Date, long EventCount, long RuntimeSeconds, double? EstimatedLitres);

    private sealed class ZoneUsage(long zoneId, string name, float? flowRateLpm)
    {
        public long ZoneId { get; } = zoneId;
        public string Name { get; } = name;
        public float? FlowRateLpm { get; } = flowRateLpm;
        public List<DayUsage> Days { get; } = new();
    }
}