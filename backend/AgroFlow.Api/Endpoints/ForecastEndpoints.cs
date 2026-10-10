using System.Globalization;
using System.Security.Claims;
using AgroFlow.Business;
using AgroFlow.Business.Agronomy;
using Npgsql;
using NpgsqlTypes;

namespace AgroFlow.Api.Endpoints;

public record ForecastDayResponse(
    string Date,
    string Weekday,
    double? MinC,
    double? MaxC,
    double? RainMm,
    double? HumidityPercent,
    string Icon,
    string? Advice,
    string? Action = null,
    double? RequiredDepthMm = null,
    double? Litres = null,
    double? RuntimeSeconds = null,
    string? Confidence = null,
    bool Tentative = false);

public record ForecastResponse(
    long FarmId,
    long? ZoneId,
    string? ZoneName,
    IReadOnlyList<ForecastDayResponse> Days,
    string Source,
    string? Message);

// The farmer's 7-day forecast and, when a zone is named, what the engine says to
// do each day. This is a server endpoint because the advice needs the engine;
// keeping both here means rain and advice always come from the same place.
public static class ForecastEndpoints
{
    public static void MapForecastEndpoints(this WebApplication app)
    {
        app.MapGet("/api/farmer/forecast", GetForecastAsync).RequireAuthorization();
    }

    private static async Task<IResult> GetForecastAsync(
        ClaimsPrincipal user,
        NpgsqlDataSource dataSource,
        AgroFlow.Business.Fao56EngineController engine,
        long? farmId,
        long? zoneId,
        CancellationToken cancellationToken)
    {
        if (!TryGetUserId(user, out var userId)) return Results.Unauthorized();

        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);

        // 1. Ownership. Taken from the zone when one is named, so a farmer cannot pair
        //    their own farmId with someone else's zone. Archived farms (0036) are left out.
        long resolvedFarmId;
        string? zoneName = null;
        double? latitude;

        const string byZoneSql = """
            select z.farm_id, coalesce(nullif(z.name, ''), 'this zone'), f.latitude
              from zone z
              join farm f on f.farm_id = z.farm_id
             where z.id = $2
               and lower(coalesce(f.status, 'active')) <> 'inactive'
               and (f.owner_id = $1
                 or exists (select 1 from farm_member fm
                             where fm.farm_id = z.farm_id and fm.profile_id = $1)
                 or exists (select 1 from profile p where p.id = $1 and p.role = 'admin'))
            """;

        const string byFarmSql = """
            select f.farm_id, null::text, f.latitude
              from farm f
             where f.farm_id = $2
               and lower(coalesce(f.status, 'active')) <> 'inactive'
               and (f.owner_id = $1
                 or exists (select 1 from farm_member fm
                             where fm.farm_id = f.farm_id and fm.profile_id = $1)
                 or exists (select 1 from profile p where p.id = $1 and p.role = 'admin'))
            """;

        // With neither, use the farmer's own first farm, so Home can link here without
        // knowing a farm id.
        const string ownFarmSql = """
            select f.farm_id, null::text, f.latitude
              from farm f
             where lower(coalesce(f.status, 'active')) <> 'inactive'
               and (f.owner_id = $1
                 or exists (select 1 from farm_member fm
                             where fm.farm_id = f.farm_id and fm.profile_id = $1))
             order by case when f.owner_id = $1 then 0 else 1 end, f.farm_id
             limit 1
            """;

        var (sql, parameter) = zoneId is not null
            ? (byZoneSql, zoneId.Value)
            : farmId is not null ? (byFarmSql, farmId.Value) : (ownFarmSql, 0L);

        await using (var cmd = new NpgsqlCommand(sql, connection))
        {
            cmd.Parameters.AddWithValue(userId);
            if (!ReferenceEquals(sql, ownFarmSql)) cmd.Parameters.AddWithValue(parameter);

            await using var reader = await cmd.ExecuteReaderAsync(cancellationToken);

            // Not found and not allowed look the same, like the report endpoints.
            if (!await reader.ReadAsync(cancellationToken))
            {
                return Results.NotFound(new { error = "Farm not found." });
            }

            resolvedFarmId = reader.GetInt64(0);
            zoneName = reader.IsDBNull(1) ? null : reader.GetString(1);
            latitude = reader.IsDBNull(2) ? null : Convert.ToDouble(reader.GetValue(2));
        }

        // 2. The forecast rows: today onward, forecast only, at most 7.
        //    We check both is_forecast and date >= today, because a day that has just
        //    passed can still be flagged as forecast.
        var today = DateOnly.FromDateTime(DateTime.UtcNow.AddHours(2)); // SAST, no DST
        var weatherByDate = new Dictionary<DateOnly, DailyWeather>();

        const string weatherSql = """
            select w.date, w.tmin_c, w.tmax_c, w.precipitation_mm, w.humidity_mean
              from weather_daily w
             where w.farm_id = $1
               and w.is_forecast = true
               and w.date >= $2
             order by w.date
             limit $3
            """;

        var days = new List<(DateOnly Date, double? Min, double? Max, double? Rain, double? Humidity)>();

        await using (var cmd = new NpgsqlCommand(weatherSql, connection))
        {
            cmd.Parameters.AddWithValue(resolvedFarmId);
            cmd.Parameters.AddWithValue(NpgsqlDbType.Date, today);
            cmd.Parameters.AddWithValue(ForecastOutlook.MaxForecastDays);

            await using var reader = await cmd.ExecuteReaderAsync(cancellationToken);
            while (await reader.ReadAsync(cancellationToken))
            {
                var date = reader.GetFieldValue<DateOnly>(0);
                double? min = reader.IsDBNull(1) ? null : Convert.ToDouble(reader.GetValue(1));
                double? max = reader.IsDBNull(2) ? null : Convert.ToDouble(reader.GetValue(2));
                double? rain = reader.IsDBNull(3) ? null : Convert.ToDouble(reader.GetValue(3));
                double? hum = reader.IsDBNull(4) ? null : Convert.ToDouble(reader.GetValue(4));

                days.Add((date, min, max, rain, hum));

                // The advisor needs the whole set as DailyWeather either way, so we build it here.
                if (min.HasValue && max.HasValue)
                {
                    weatherByDate[date] = new DailyWeather(date, min.Value, max.Value, rain ?? 0, true);
                }
            }
        }

        if (days.Count == 0)
        {
            // A clear message instead of an empty list, so the app does not look broken.
            return Results.Ok(new ForecastResponse(
                resolvedFarmId, zoneId, zoneName,
                Array.Empty<ForecastDayResponse>(),
                ForecastOutlook.SourceLine,
                ForecastOutlook.NoForecastMessage));
        }

        // 3. Per-day advice, when a zone was named, from the same engine the schedule
        //    report uses. Only today uses the real soil reading.
        var planPerDay = new Dictionary<DateOnly, RollingIrrigationDay>();

        if (zoneId is not null)
        {
            planPerDay = BuildZoneAdvice(engine, zoneId.Value, today);
        }

        var response = days.Select(d =>
        {
            var icon = ForecastOutlook.PickIcon(d.Rain, d.Humidity);

            planPerDay.TryGetValue(d.Date, out var plan);
            return new ForecastDayResponse(
                d.Date.ToString("yyyy-MM-dd"),
                // Named on the server so every client shows the same weekday name, whatever
                // the phone's locale.
                d.Date.ToDateTime(TimeOnly.MinValue).ToString("ddd", CultureInfo.InvariantCulture),
                d.Min is { } mn ? Math.Round(mn, 0) : null,
                d.Max is { } mx ? Math.Round(mx, 0) : null,
                d.Rain is { } rn ? Math.Round(rn, 1) : null,
                d.Humidity is { } hm ? Math.Round(hm, 0) : null,
                ForecastOutlook.IconName(icon),
                plan?.Advice,
                plan?.Action.ToString(),
                plan?.RequiredDepthMm,
                plan?.Litres,
                plan?.RuntimeSeconds,
                plan?.Confidence,
                plan?.Tentative ?? false);
        }).ToList();

        return Results.Ok(new ForecastResponse(
            resolvedFarmId, zoneId, zoneName, response, ForecastOutlook.SourceLine, null));
    }

    private static Dictionary<DateOnly, RollingIrrigationDay> BuildZoneAdvice(
        AgroFlow.Business.Fao56EngineController engine,
        long zoneId,
        DateOnly today)
    {
        var result = new Dictionary<DateOnly, RollingIrrigationDay>();
        try
        {
            var engineZone = engine.Data.GetZone(zoneId);
            if (engineZone == null) return result;
            return engine.RunZone(engineZone, today, persist: false)
                .Outlook.ToDictionary(d => d.Date);
        }
        catch (Exception)
        {
            return result;
        }
    }

    private static bool TryGetUserId(ClaimsPrincipal user, out Guid userId) =>
        Guid.TryParse(user.FindFirstValue("sub"), out userId);
}
