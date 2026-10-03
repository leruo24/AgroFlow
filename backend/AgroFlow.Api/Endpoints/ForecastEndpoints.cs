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
    string? Advice);

public record ForecastResponse(
    long FarmId,
    long? ZoneId,
    string? ZoneName,
    IReadOnlyList<ForecastDayResponse> Days,
    string Source,
    string? Message);

// The farmer's 7-day forecast, and - when a zone is named - what the engine
// says to do about each day.
//
// WHY A SERVER ENDPOINT AND NOT A DIRECT SUPABASE READ
// ----------------------------------------------------
// The weather rows themselves could be read straight from `weather_daily`
// under RLS, the way the app already reads insights. The ADVICE cannot: it
// needs the FAO-56 crop coefficients, the zone's planting date and soil, and
// the farm's latitude, all of which live in the engine. Splitting the screen
// across two sources would mean a day could show rain from one place and
// advice from another, so both come from here.
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

        // ------------------------------------------------------------------
        // 1. Ownership. Resolved from the ZONE when one is named, so a farmer
        //    cannot pair their own farmId with someone else's zoneId and read
        //    that zone's advice. Archived farms are excluded (0036) - an
        //    archived farm is not something to plan irrigation for.
        // ------------------------------------------------------------------
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

        // With neither, fall back to the farmer's own first farm, so Home can
        // link here without already knowing a farm id.
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

            // Not found and not allowed look identical, the same choice the
            // report endpoints make.
            if (!await reader.ReadAsync(cancellationToken))
            {
                return Results.NotFound(new { error = "Farm not found." });
            }

            resolvedFarmId = reader.GetInt64(0);
            zoneName = reader.IsDBNull(1) ? null : reader.GetString(1);
            latitude = reader.IsDBNull(2) ? null : Convert.ToDouble(reader.GetValue(2));
        }

        // ------------------------------------------------------------------
        // 2. The forecast rows. Today onward, forecast only, at most 7.
        //
        //    `is_forecast = true` and `date >= today` are both applied: the
        //    collector overwrites a past day's row with is_forecast = false
        //    once observations exist, but a row can legitimately still be
        //    flagged forecast for a day that has just passed, and a "forecast"
        //    for yesterday is not a forecast.
        // ------------------------------------------------------------------
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

                // The advisor wants the whole set as DailyWeather regardless
                // of whether a zone was asked for - building it here avoids a
                // second pass.
                if (min.HasValue && max.HasValue)
                {
                    weatherByDate[date] = new DailyWeather(date, min.Value, max.Value, rain ?? 0, true);
                }
            }
        }

        if (days.Count == 0)
        {
            // An explicit message rather than an empty list. A farmer who
            // opens Forecast and sees nothing assumes the app is broken.
            return Results.Ok(new ForecastResponse(
                resolvedFarmId, zoneId, zoneName,
                Array.Empty<ForecastDayResponse>(),
                ForecastOutlook.SourceLine,
                ForecastOutlook.NoForecastMessage));
        }

        // ------------------------------------------------------------------
        // 3. Per-day advice, when a zone was named.
        //
        //    Uses IrrigationAdvisor - the same engine the schedule report
        //    drives - rather than a second set of rules. Day 0 gets the
        //    zone's real soil reading and the full water balance; later days
        //    have no reading and never get a guessed one.
        // ------------------------------------------------------------------
        var advicePerDay = new Dictionary<DateOnly, string?>();

        if (zoneId is not null)
        {
            advicePerDay = await BuildZoneAdviceAsync(
                connection, engine, zoneId.Value, latitude, today, weatherByDate, days, cancellationToken);
        }

        var response = days.Select(d =>
        {
            var icon = ForecastOutlook.PickIcon(d.Rain, d.Humidity);

            return new ForecastDayResponse(
                d.Date.ToString("yyyy-MM-dd"),
                // Named on the server so every client shows the same word, and
                // so an English weekday name does not depend on the phone's
                // locale producing one.
                d.Date.ToDateTime(TimeOnly.MinValue).ToString("ddd", CultureInfo.InvariantCulture),
                d.Min is { } mn ? Math.Round(mn, 0) : null,
                d.Max is { } mx ? Math.Round(mx, 0) : null,
                d.Rain is { } rn ? Math.Round(rn, 1) : null,
                d.Humidity is { } hm ? Math.Round(hm, 0) : null,
                ForecastOutlook.IconName(icon),
                advicePerDay.TryGetValue(d.Date, out var advice) ? advice : null);
        }).ToList();

        return Results.Ok(new ForecastResponse(
            resolvedFarmId, zoneId, zoneName, response, ForecastOutlook.SourceLine, null));
    }

    private static async Task<Dictionary<DateOnly, string?>> BuildZoneAdviceAsync(
        NpgsqlConnection connection,
        AgroFlow.Business.Fao56EngineController engine,
        long zoneId,
        double? latitude,
        DateOnly today,
        Dictionary<DateOnly, DailyWeather> weatherByDate,
        List<(DateOnly Date, double? Min, double? Max, double? Rain, double? Humidity)> days,
        CancellationToken cancellationToken)
    {
        var result = new Dictionary<DateOnly, string?>();

        string? crop = null;
        DateOnly? planted = null;
        double? threshold = null;
        double? moisture = null;
        DateTime? readAt = null;

        const string zoneSql = """
            select z.crop_type, z.planting_date, z.moisture_threshold, m.value, m.recorded_at
              from zone z
              left join lateral (
                select r.value, r.recorded_at from sensor_reading r
                 where r.zone_id = z.id and r.sensor_type = 'SoilMoisture'
                 order by r.recorded_at desc limit 1) m on true
             where z.id = $1
            """;

        await using (var cmd = new NpgsqlCommand(zoneSql, connection))
        {
            cmd.Parameters.AddWithValue(zoneId);

            await using var reader = await cmd.ExecuteReaderAsync(cancellationToken);
            if (await reader.ReadAsync(cancellationToken))
            {
                crop = reader.IsDBNull(0) ? null : reader.GetString(0);
                planted = reader.IsDBNull(1) ? null : reader.GetFieldValue<DateOnly>(1);
                threshold = reader.IsDBNull(2) ? null : Convert.ToDouble(reader.GetValue(2));
                moisture = reader.IsDBNull(3) ? null : Convert.ToDouble(reader.GetValue(3));
                readAt = reader.IsDBNull(4) ? null : reader.GetDateTime(4);
            }
        }

        // Only today's reading is usable, and only if it is recent. A stale
        // reading presented as today's is how a farmer ends up watering on
        // yesterday's conditions.
        var readingFresh = readAt is not null && (DateTime.UtcNow - readAt.Value).TotalHours <= 24;

        // The water balance is a time series assembled once per zone, exactly
        // as the schedule report does it. Wrapped because the engine's columns
        // may be absent on a database where 0027 has not been applied - the
        // forecast must still render.
        ZoneEngineInput? balanceInput = null;
        try
        {
            var engineZone = engine.Data.GetZone(zoneId);
            if (engineZone != null) balanceInput = engine.BuildInput(engineZone, today);
        }
        catch (Exception)
        {
            balanceInput = null;
        }

        foreach (var d in days)
        {
            weatherByDate.TryGetValue(d.Date, out var w);

            try
            {
                var advice = IrrigationAdvisor.Advise(new ZoneAdviceInput
                {
                    CropType = crop,
                    PlantingDate = planted,
                    AsOf = d.Date,
                    // Today only, and only when fresh. Future days get null,
                    // never a guess.
                    SoilMoisturePercent = d.Date == today && readingFresh ? moisture : null,
                    MoistureThresholdPercent = threshold,
                    FarmLatitudeDegrees = latitude,
                    LatestWeather = w,
                    Forecast = weatherByDate.Values.Where(x => x.Date > d.Date).ToList(),
                    WaterBalance = d.Date == today ? balanceInput : null,
                });

                // Day 0 carries a real decision. Later days have no soil
                // reading behind them, so they fall back to the rainfall-only
                // outlook the schedule report already uses past day 0 -
                // rather than dressing up a guess as the engine's advice.
                result[d.Date] = d.Date == today
                    ? ForecastOutlook.PlainDayAdvice(advice.Action, d.Rain)
                    : ForecastOutlook.PlainOutlookFromRainOnly(d.Rain);
            }
            catch (Exception)
            {
                // One un-adviseable day must not take the forecast down. The
                // weather for that day still shows; the advice line does not.
                result[d.Date] = null;
            }
        }

        return result;
    }

    private static bool TryGetUserId(ClaimsPrincipal user, out Guid userId) =>
        Guid.TryParse(user.FindFirstValue("sub"), out userId);
}
