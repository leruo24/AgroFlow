using System.Security.Claims;
using System.Globalization;
using System.Text.Json;
using Npgsql;
using NpgsqlTypes;
using QuestPDF.Fluent;
using QuestPDF.Helpers;
using QuestPDF.Infrastructure;
using AgroFlow.Business.Agronomy;
using AgroFlow.Api.Reports;

namespace AgroFlow.Api.Endpoints;

public static class ReportEndpoints
{
    // The three PDF builders below are `internal` rather than `private` so
    // ReportGenerationService can call them directly.
    //
    // That is deliberate reuse and not a refactor: their bodies are
    // untouched, and the alternative - a second renderer for the background
    // queue - would mean the PDF a farmer downloads and the PDF the
    // scheduler emails could drift apart. The ownership check inside each
    // one still runs, because the generator hands it a ClaimsPrincipal built
    // from the requesting farmer's own profile id.

    // South Africa has no daylight saving, so a fixed zone is safe for day boundaries.
    private const string ReportTimeZone = "Africa/Johannesburg";
    private const int MaxRangeDays = 366;

    public static void MapReportEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/farmer/reports").RequireAuthorization();
        group.MapGet("/water-usage", GetWaterUsageAsync);
        group.MapGet("/moisture", GetMoistureAsync);
        group.MapGet("/schedule", GetScheduleAsync);
        group.MapGet("/water-usage/pdf", GetWaterUsagePdfAsync);

        // The same report as a workbook. Only ever per zone, because a
        // spreadsheet of several zones' days side by side is not a thing
        // anybody asked for - they would filter it back down to one.
        group.MapGet("/water-usage/xlsx", GetWaterUsageXlsxAsync);
        group.MapGet("/moisture/pdf", GetMoisturePdfAsync);
        group.MapGet("/schedule/pdf", GetSchedulePdfAsync);
        group.MapGet("/zones", GetZonesAsync);
    }

    private static bool TryGetUserId(ClaimsPrincipal user, out Guid userId) =>
        Guid.TryParse(user.FindFirstValue("sub"), out userId);

    private static async Task<IResult> GetWaterUsageAsync(
        ClaimsPrincipal user, NpgsqlDataSource dataSource, long? farmId, DateOnly? from, DateOnly? to,
        AgroFlow.Business.Fao56EngineController engine)
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
                            and (f.owner_id = $2
                or exists (select 1 from farm_member fm where fm.farm_id = f.farm_id and fm.profile_id = $2)
                or exists (select 1 from profile p where p.id = $2 and p.role = 'admin'));
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

        var zoneDtoList = zoneDtos.ToList();

        return Results.Ok(new
        {
            farmId,
            farmName,
            from = from.Value.ToString("yyyy-MM-dd"),
            to = to.Value.ToString("yyyy-MM-dd"),
            generatedAt = DateTimeOffset.UtcNow,
            isEstimate = true,
            estimateNote = "Estimated: pump run time x zone flow rate. No flow meter is installed.",
            zones = zoneDtoList,

            // Spec 9b: the water usage report carries the efficiency insights.
            insights = CollectInsights(engine, zones.Select(z => z.ZoneId), WaterUsageReportInsights),
        });
    }

        private static async Task<IResult> GetMoistureAsync(
        ClaimsPrincipal user, NpgsqlDataSource dataSource, long? zoneId, DateOnly? from, DateOnly? to,
        AgroFlow.Business.Fao56EngineController engine)
    {
        if (!TryGetUserId(user, out var userId)) return Results.Unauthorized();

        if (zoneId is null) return Results.BadRequest(new { error = "zoneId is required." });
        if (from is null || to is null) return Results.BadRequest(new { error = "from and to dates are required (yyyy-MM-dd)." });
        if (from > to) return Results.BadRequest(new { error = "from must not be after to." });
        if (to.Value.DayNumber - from.Value.DayNumber >= 31)
            return Results.BadRequest(new { error = "Date range must not exceed 31 days." });

        await using var connection = await dataSource.OpenConnectionAsync();

        // 1. Ownership gate on the zone's farm.
        const string zoneSql = """
            select z.name, z.moisture_threshold, z.desired_moisture, z.flow_rate_lpm,
                   -- Read through jsonb so a database without the engine's
                   -- columns (migration 0027) reads them as null, not an error.
                   (to_jsonb(z) ->> 'calibration_wet')::double precision,
                   (to_jsonb(z) ->> 'calibration_dry')::double precision
            from zone z
            where z.id = $1
              and (exists (select 1 from farm f where f.farm_id = z.farm_id and f.owner_id = $2)
                or exists (select 1 from farm_member fm where fm.farm_id = z.farm_id and fm.profile_id = $2)
                or exists (select 1 from profile p where p.id = $2 and p.role = 'admin'));
            """;
        string zoneName; double? dryThreshold, targetMoisture; float? flowRate;
        double? calibrationWet, calibrationDry;
        await using (var zoneCmd = new NpgsqlCommand(zoneSql, connection))
        {
            zoneCmd.Parameters.AddWithValue(zoneId.Value);
            zoneCmd.Parameters.AddWithValue(userId);
            await using var zr = await zoneCmd.ExecuteReaderAsync();
            if (!await zr.ReadAsync()) return Results.NotFound(new { error = "Zone not found." });
            zoneName = zr.IsDBNull(0) ? $"Zone {zoneId}" : zr.GetString(0);
            dryThreshold = zr.IsDBNull(1) ? null : Convert.ToDouble(zr.GetValue(1));
            targetMoisture = zr.IsDBNull(2) ? null : Convert.ToDouble(zr.GetValue(2));
            flowRate = zr.IsDBNull(3) ? null : zr.GetFloat(3);
            calibrationWet = zr.IsDBNull(4) ? null : zr.GetDouble(4);
            calibrationDry = zr.IsDBNull(5) ? null : zr.GetDouble(5);
        }

        // Item 2: readings are a percentage only after the wet/dry setup.
        // Calibrated: every figure is converted, the same way the engine does.
        // Not calibrated: figures stay sensor numbers and are never shown with
        // a %, and no comparison with the % threshold is made.
        var calibrated = AgroFlow.Business.Agronomy.SoilWaterBalance
            .RelativeMoisturePercent(0, calibrationWet, calibrationDry) is not null;
        double Shown(double raw) => calibrated
            ? AgroFlow.Business.Agronomy.SoilWaterBalance.RelativeMoisturePercent(raw, calibrationWet, calibrationDry)!.Value
            : raw;

        // 2. Hourly moisture buckets (local SAST wall-clock time).
        const string moistureSql = """
            select date_trunc('hour', r.recorded_at at time zone 'Africa/Johannesburg') as bucket,
                   avg(r.value), min(r.value), max(r.value), count(*)
            from sensor_reading r
            where r.zone_id = $1 and r.sensor_type = 'SoilMoisture'
              and r.recorded_at >= $2::date::timestamp at time zone 'Africa/Johannesburg'
              and r.recorded_at <  ($3::date + 1)::timestamp at time zone 'Africa/Johannesburg'
            group by 1 order by 1;
            """;
        var series = new List<object>();
        double weightedSum = 0, lowest = double.MaxValue, highest = double.MinValue;
        long readingCount = 0; int hoursBelow = 0;
        await using (var cmd = new NpgsqlCommand(moistureSql, connection))
        {
            cmd.Parameters.AddWithValue(zoneId.Value);
            cmd.Parameters.AddWithValue(NpgsqlDbType.Date, from.Value);
            cmd.Parameters.AddWithValue(NpgsqlDbType.Date, to.Value);
            await using var r = await cmd.ExecuteReaderAsync();
            while (await r.ReadAsync())
            {
                // The conversion is linear, so the average converts directly;
                // a probe that reads LOWER when wet swaps min and max.
                var avg = Shown(Convert.ToDouble(r.GetValue(1)));
                var a = Shown(Convert.ToDouble(r.GetValue(2)));
                var b = Shown(Convert.ToDouble(r.GetValue(3)));
                var min = Math.Min(a, b);
                var max = Math.Max(a, b);
                var count = Convert.ToInt64(r.GetValue(4));
                weightedSum += avg * count; readingCount += count;
                lowest = Math.Min(lowest, min); highest = Math.Max(highest, max);
                if (calibrated && dryThreshold is not null && avg < dryThreshold) hoursBelow++;
                series.Add(new
                {
                    time = r.GetDateTime(0).ToString("yyyy-MM-dd'T'HH:mm"),
                    avgMoisturePct = Math.Round(avg, 1),
                    minMoisturePct = Math.Round(min, 1),
                    maxMoisturePct = Math.Round(max, 1),
                    readings = count,
                });
            }
        }

        // 3. Irrigation events in the same window.
        const string eventSql = """
            select e.started_at at time zone 'Africa/Johannesburg', e.runtime_seconds, e.trigger_source
            from irrigation_event e
            where e.zone_id = $1
              and e.started_at >= $2::date::timestamp at time zone 'Africa/Johannesburg'
              and e.started_at <  ($3::date + 1)::timestamp at time zone 'Africa/Johannesburg'
            order by e.started_at;
            """;
        var events = new List<object>();
        await using (var cmd = new NpgsqlCommand(eventSql, connection))
        {
            cmd.Parameters.AddWithValue(zoneId.Value);
            cmd.Parameters.AddWithValue(NpgsqlDbType.Date, from.Value);
            cmd.Parameters.AddWithValue(NpgsqlDbType.Date, to.Value);
            await using var r = await cmd.ExecuteReaderAsync();
            while (await r.ReadAsync())
            {
                var runtime = Convert.ToInt64(r.GetValue(1));
                events.Add(new
                {
                    startedAt = r.GetDateTime(0).ToString("yyyy-MM-dd'T'HH:mm"),
                    runtimeSeconds = runtime,
                    triggerSource = r.IsDBNull(2) ? null : r.GetString(2),
                    estimatedLitres = Litres(runtime, flowRate),
                });
            }
        }

        var hasData = series.Count > 0;
        string? action = !hasData ? null
            : !calibrated ? "The soil sensor is not yet set up, so its readings are sensor numbers, not moisture. Do the wet/dry setup to compare them with the dry threshold."
            : dryThreshold is null ? "No moisture threshold is set for this zone, so no dry-period check was made."
            : hoursBelow == 0 ? $"Moisture stayed at or above the {dryThreshold:0.#}% threshold in every hour with readings."
            : $"Moisture averaged below the {dryThreshold:0.#}% threshold in {hoursBelow} of {series.Count} hours with readings.";

        return Results.Ok(new
        {
            zoneId,
            zoneName,
            from = from.Value.ToString("yyyy-MM-dd"),
            to = to.Value.ToString("yyyy-MM-dd"),
            generatedAt = DateTimeOffset.UtcNow,
            timeZone = ReportTimeZone,
            status = hasData ? "ok" : "no_data",
            message = hasData ? null : "Not enough data yet: no soil moisture readings in this period.",
            thresholds = new { dryPct = dryThreshold, targetPct = targetMoisture },

            // Item 2, additive: false means every "...Pct" figure below is a
            // raw sensor number and must be shown without a %.
            calibrated,
            readingUnit = calibrated ? "%" : "sensor reading (not yet set up)",
            summary = hasData ? new
            {
                readingCount,
                averagePct = Math.Round(weightedSum / readingCount, 1),
                lowestPct = Math.Round(lowest, 1),
                highestPct = Math.Round(highest, 1),
                hoursBelowThreshold = dryThreshold is null ? (int?)null : hoursBelow,
                action,
            } : null,
            series,
            irrigationEvents = events,
            isEstimate = true,
            estimateNote = "Irrigation litres are estimated: pump run time x zone flow rate. No flow meter is installed.",

            // Spec 9b: the moisture report carries the sensor- and dryness-related
            // insights. Each item is { text, source }.
            insights = CollectInsights(engine, new[] { zoneId.Value }, MoistureReportInsights),

            // Spec 3b: the probe is resistive and will drift as it corrodes.
            calibrationNote = "The soil sensor is resistive, so its readings are relative, not a measured volume of water. They react to salts and fertiliser and drift as the probe corrodes. Redo the wet/dry setup if readings drift over weeks.",
        });
    }

    // The same figure as RuleBook.ConfidenceRules.FreshReadingHours: past it a
    // reading lowers confidence and the advice comes from the weather.
    private const int MaxReadingAgeHours = (int)AgroFlow.Business.Agronomy.RuleBook.ConfidenceRules.FreshReadingHours;

    // Item 2: how the latest reading is described. Never a % before the
    // wet/dry setup; a stale reading says when the kit last reported.
    internal static string ReadingLabel(double? raw, DateTime? readAtUtc, double? relativePct, bool fresh)
    {
        if (raw is null || readAtUtc is null) return "No soil reading yet.";

        var at = readAtUtc.Value.AddHours(2).ToString("HH:mm 'on' d MMM", CultureInfo.InvariantCulture);
        var reading = relativePct is { } pct
            ? $"Soil moisture {Math.Round(pct).ToString("F0", CultureInfo.InvariantCulture)}% at {at}"
            : $"Sensor reading {Math.Round(raw.Value).ToString("F0", CultureInfo.InvariantCulture)} (not yet set up) at {at}";

        return fresh
            ? reading + "."
            : reading + ". Based on the weather: " + AgroFlow.Business.Agronomy.RuleBook.ConfidenceRules.KitQuiet(readAtUtc) + ".";
    }

    private static async Task<IResult> GetScheduleAsync(
        ClaimsPrincipal user, NpgsqlDataSource dataSource, long? farmId,
        AgroFlow.Business.Fao56EngineController engine)
    {
        if (!TryGetUserId(user, out var userId)) return Results.Unauthorized();
        if (farmId is null) return Results.BadRequest(new { error = "farmId is required." });

        await using var connection = await dataSource.OpenConnectionAsync();

        // 1. Ownership gate + latitude (needed for ET0).
        //
        // The admin clause matches the other three report endpoints (lines
        // 54, 179 and 1024 of this file). It was missing only here, so an
        // administrator could open every other report for a farm they do not
        // belong to and got a bare "Farm not found." on the schedule - which
        // reads as a data problem rather than as the permission check it
        // actually was.
        const string farmSql = """
            select f.name, f.latitude from farm f
            where f.farm_id = $1
              and (f.owner_id = $2 or exists (
                select 1 from farm_member fm where fm.farm_id = f.farm_id and fm.profile_id = $2)
                or exists (select 1 from profile p where p.id = $2 and p.role = 'admin'));
            """;
        string farmName; double? latitude;
        await using (var cmd = new NpgsqlCommand(farmSql, connection))
        {
            cmd.Parameters.AddWithValue(farmId.Value);
            cmd.Parameters.AddWithValue(userId);
            await using var r = await cmd.ExecuteReaderAsync();
            if (!await r.ReadAsync()) return Results.NotFound(new { error = "Farm not found." });
            farmName = r.IsDBNull(0) ? "" : r.GetString(0);
            latitude = r.IsDBNull(1) ? null : Convert.ToDouble(r.GetValue(1));
        }

        // South Africa has no daylight saving, so UTC+2 is the local date.
        var today = DateOnly.FromDateTime(DateTime.UtcNow.AddHours(2));

        // 2. Weather rows (actuals + forecast) for today .. today+7.
        var weather = new Dictionary<DateOnly, DailyWeather>();
        const string weatherSql = """
            select w.date, w.tmin_c, w.tmax_c, w.precipitation_mm, w.is_forecast
            from weather_daily w
            where w.farm_id = $1 and w.date between $2 and $3
              and w.tmin_c is not null and w.tmax_c is not null
            order by w.date;
            """;
        await using (var cmd = new NpgsqlCommand(weatherSql, connection))
        {
            cmd.Parameters.AddWithValue(farmId.Value);
            cmd.Parameters.AddWithValue(NpgsqlDbType.Date, today);
            cmd.Parameters.AddWithValue(NpgsqlDbType.Date, today.AddDays(7));
            await using var r = await cmd.ExecuteReaderAsync();
            while (await r.ReadAsync())
            {
                var d = r.GetFieldValue<DateOnly>(0);
                weather[d] = new DailyWeather(
                    d, Convert.ToDouble(r.GetValue(1)), Convert.ToDouble(r.GetValue(2)),
                    r.IsDBNull(3) ? 0 : Convert.ToDouble(r.GetValue(3)), r.GetBoolean(4));
            }
        }

        // 3. Zones + each zone's latest moisture reading.
        const string zoneSql = """
            select z.id, z.name, z.crop_type, z.planting_date, z.moisture_threshold, m.value, m.recorded_at
            from zone z
            left join lateral (
                select r.value, r.recorded_at from sensor_reading r
                where r.zone_id = z.id and r.sensor_type = 'SoilMoisture'
                order by r.recorded_at desc limit 1) m on true
            where z.farm_id = $1
            order by z.id;
            """;
        var zoneRows = new List<(long Id, string Name, string? Crop, DateOnly? Planted, double? Threshold, double? Moisture, DateTime? ReadAt)>();
        await using (var cmd = new NpgsqlCommand(zoneSql, connection))
        {
            cmd.Parameters.AddWithValue(farmId.Value);
            await using var r = await cmd.ExecuteReaderAsync();
            while (await r.ReadAsync())
            {
                var id = r.GetInt64(0);
                zoneRows.Add((
                    id,
                    r.IsDBNull(1) ? $"Zone {id}" : r.GetString(1),
                    r.IsDBNull(2) ? null : r.GetString(2),
                    r.IsDBNull(3) ? null : r.GetFieldValue<DateOnly>(3),
                    r.IsDBNull(4) ? null : Convert.ToDouble(r.GetValue(4)),
                    r.IsDBNull(5) ? null : Convert.ToDouble(r.GetValue(5)),
                    r.IsDBNull(6) ? null : r.GetDateTime(6)));
            }
        }

        // 4. Run the FAO-56 engine: once per zone per day.
        var zones = new List<object>();
        foreach (var z in zoneRows)
        {
            var readingFresh = z.ReadAt is not null
                && (DateTime.UtcNow - z.ReadAt.Value).TotalHours <= MaxReadingAgeHours;
            var days = new List<object>();
            ZoneAdvice? todayAdvice = null;

            // The FAO-56 water balance is a time series, not a per-day figure, so
            // it is assembled once per zone and handed to today's Advise call.
            // Future days keep the forecast-only outlook they always had.
            AgroFlow.Business.Agronomy.ZoneEngineInput? balanceInput = null;
            AgroFlow.Business.Agronomy.ZoneFaultSignals? faultSignals = null;
            try
            {
                var engineZone = engine.Data.GetZone(z.Id);
                if (engineZone != null)
                {
                    balanceInput = engine.BuildInput(engineZone, today);
                    faultSignals = engine.BuildFaultSignals(engineZone, today);
                }
            }
            catch (Exception)
            {
                // The report must still render if the engine's own columns are
                // missing - migration 0027 may not be applied yet. The advice then
                // degrades to exactly what it was before the engine existed, and
                // the zone's limitations say what is unavailable.
                balanceInput = null;
                faultSignals = null;
            }

            // Item 2: a reading is a percentage only after the wet/dry setup.
            // Before it, it is a sensor number and is never shown with a %.
            var calibrated = balanceInput is { CalibrationWet: not null, CalibrationDry: not null };
            var relativePct = calibrated && z.Moisture is { } rawReading
                ? AgroFlow.Business.Agronomy.SoilWaterBalance.RelativeMoisturePercent(
                    rawReading, balanceInput!.CalibrationWet, balanceInput.CalibrationDry)
                : null;

            // The threshold check needs a real percentage. With the engine
            // available, only a calibrated reading is one; without it (engine
            // columns missing) the old behaviour stands.
            var moistureForAdvice = !readingFresh ? null
                : balanceInput is null ? z.Moisture
                : relativePct;

            for (var i = 0; i < 7; i++)
            {
                var asOf = today.AddDays(i);
                weather.TryGetValue(asOf, out var w);
                var advice = IrrigationAdvisor.Advise(new ZoneAdviceInput
                {
                    ZoneName = z.Name,
                    CropType = z.Crop,
                    PlantingDate = z.Planted,
                    AsOf = asOf,
                    // Moisture is only known for today. Future days get null, never a guess.
                    SoilMoisturePercent = i == 0 ? moistureForAdvice : null,
                    MoistureThresholdPercent = z.Threshold,
                    FarmLatitudeDegrees = latitude,
                    LatestWeather = w,
                    Forecast = weather.Values.Where(x => x.Date > asOf).ToList(),
                    WaterBalance = i == 0 ? balanceInput : null,
                    FaultSignals = i == 0 ? faultSignals : null,
                });
                if (i == 0) todayAdvice = advice;

                var rain = w?.PrecipitationMm;
                var action = i == 0 ? advice.Action.ToString()
                    : rain >= 1.0 ? "RainExpectedCheckMoisture"
                    : "CheckMoisture";
                days.Add(new
                {
                    date = asOf.ToString("yyyy-MM-dd"),
                    action,
                    stage = advice.Stage?.StageDisplayName,
                    kc = advice.Stage is { IsWithinSeason: true } ? (double?)Math.Round(advice.Stage.Kc, 2) : null,
                    et0MmPerDay = advice.Et0MmPerDay is { } e0 ? Math.Round(e0, 1) : (double?)null,
                    etcMmPerDay = advice.EtcMmPerDay is { } ec ? Math.Round(ec, 1) : (double?)null,
                                        forecastRainMm = rain is { } rainMm ? Math.Round(rainMm, 1) : (double?)null,
                    weatherIsForecast = w?.IsForecast,
                    note = i == 0 ? advice.Reasoning.FirstOrDefault()
                                                : rain >= 1.0 ? $"{Math.Round(rain.Value, 1).ToString(CultureInfo.InvariantCulture)} mm rain forecast. Check soil moisture before irrigating."
                        : "Check soil moisture this morning; irrigate if below the zone threshold.",
                });
            }

            zones.Add(new
            {
                zoneId = z.Id,
                name = z.Name,
                cropType = z.Crop,
                latestMoisture = new
                {
                    // A percentage only after the wet/dry setup (item 2).
                    pct = relativePct is { } rp ? Math.Round(rp, 1) : (double?)null,
                    reading = z.Moisture,
                    calibrated,
                    label = ReadingLabel(z.Moisture, z.ReadAt, relativePct, readingFresh),
                    recordedAt = z.ReadAt,
                    usedForToday = readingFresh,
                    note = z.ReadAt is null ? "No moisture reading recorded for this zone."
                        : readingFresh ? null
                        : "Based on the weather: " + AgroFlow.Business.Agronomy.RuleBook.ConfidenceRules.KitQuiet(z.ReadAt) + ".",
                },
                summary = todayAdvice!.Summary,

                // Item 2: how sure, and the one thing that would improve it.
                // Optional - null when the engine's inputs were unavailable.
                confidence = todayAdvice.Confidence is { } conf
                    ? new { level = conf.Key, reason = conf.Reason }
                    : null,
                nextStep = todayAdvice.NextStep is { } step
                    ? new { field = step.Field, ask = step.Ask }
                    : null,

                // The one plain sentence for a farmer, from the water balance.
                // Null when the balance could not run.
                plainSummary = todayAdvice.PlainSummary,

                reasoning = todayAdvice.Reasoning,
                facts = todayAdvice.Facts.Select(f => new { f.Label, f.Value, f.Source }),

                // The farmer-facing insight set, each as { text, source } per spec
                // section 9a. Farmers see text; reports always show source.
                insights = todayAdvice.FarmerInsights.Select(i => new
                {
                    text = i.Message,
                    source = i.Source,
                    insightType = i.InsightType,
                    severity = i.Severity,

                    // Item 2c: the one-line "Why:" and the full explanation
                    // for the report's appendix.
                    why = i.Explanation?.Summary,
                    explanation = i.Explanation,
                }),

                // The FAO-56 narrative notes that `insights` used to carry. Kept
                // so nothing that was published is lost - every line still cites
                // the textbook.
                faoNotes = todayAdvice.Insights,

                limitations = todayAdvice.Limitations,

                // Today's water-balance figures, for the report tables.
                waterBalance = todayAdvice.WaterBalanceAvailable ? new
                {
                    soilCanHoldMm = Round1(todayAdvice.TotalAvailableWaterMm),
                    standsBeforeWateringMm = Round1(todayAdvice.ReadilyAvailableWaterMm),
                    shortOfFullMm = Round1(todayAdvice.DepletionMm),
                    recommendedLitres = Round1(todayAdvice.RecommendedLitres),
                    recommendedMinutes = todayAdvice.RecommendedMinutes,
                    relativeMoisturePct = Round1(todayAdvice.RelativeMoisturePercent),
                    dayOfSeason = todayAdvice.DayOfSeason,
                    seasonLengthDays = todayAdvice.SeasonLengthDays,
                    stage = todayAdvice.SeasonStageLabel,
                    daysToNextWatering = todayAdvice.DaysToNextWatering,
                    etoSource = todayAdvice.EtoSource,
                } : null,

                days,
            });
        }

        // Spec 9c: the last 7 observed days, area against local field readings.
        var weatherComparison = await ReadWeatherComparisonAsync(
            connection, farmId.Value, today.AddDays(-7), today);

        return Results.Ok(new
        {
            farmId,
            farmName,
            generatedAt = DateTimeOffset.UtcNow,
            today = today.ToString("yyyy-MM-dd"),
            status = zones.Count == 0 ? "no_zones" : "ok",
            message = zones.Count == 0 ? "Not enough data yet: this farm has no zones." : null,
            zones,
            weatherComparison = new
            {
                caption = WeatherComparisonCaption,
                days = weatherComparison,
                available = weatherComparison.Count > 0,
                message = weatherComparison.Count == 0
                    ? "No observed weather days to compare yet."
                    : null,
            },
        });
    }

        /* The designed, per-zone report (item 8b).
     *
     * WHY zoneId SWITCHES THE WHOLE DOCUMENT
     * Without a zone this endpoint answers "how much water did this FARM
     * use", which is a summary across zones and stays exactly as it was -
     * the scheduler, the Telegram delivery and the admin console all depend
     * on it. With a zone it answers "how did this block do this week", which
     * is a different document for a different reader: a farmer, on a phone,
     * who wants to know whether their tomatoes got enough. That is the one
     * docs/agroflow-report-template.pdf describes, and it carries charts, the
     * crop's needs, the moisture trace and the week's advice.
     *
     * Splitting them on a parameter rather than on a new route keeps one URL
     * in the scheduler's regeneration path and one in the mobile app. */
    /* "All zones": the whole farm, in the same designed template (item 3).
     *
     * The farm report is the per-zone report repeated with a summary in
     * front - literally, in that each zone's section is rendered by the same
     * code as its single-zone report. A farmer who pulls both documents must
     * not find them disagreeing about the same zone. */
    private static async Task<IResult> BuildFarmDesignedAsync(
        ClaimsPrincipal user, NpgsqlDataSource dataSource,
        long farmId, DateOnly from, DateOnly to,
        AgroFlow.Business.Fao56EngineController engine,
        bool asWorkbook,
        CancellationToken cancellationToken,
        ReportKind kind = ReportKind.WaterUsage)
    {
        if (!TryGetUserId(user, out var userId)) return Results.Unauthorized();
        if (from > to) return Results.BadRequest(new { error = "from must not be after to." });

        if (to.DayNumber - from.DayNumber >= MaxRangeDays)
        {
            return Results.BadRequest(new { error = $"Date range must not exceed {MaxRangeDays} days." });
        }

        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);

        var farm = await FarmWaterUsageReportBuilder.BuildAsync(
            connection, engine, userId, farmId, from, to, cancellationToken);

        if (farm is null) return Results.NotFound(new { error = "No such farm." });

        var stamp = $"{from:yyyy-MM-dd}-to-{to:yyyy-MM-dd}";
        var slug = Slug(farm.FarmName);

        return asWorkbook
            ? Results.File(
                FarmWaterUsageWorkbook.Render(farm),
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                $"agroflow-water-{slug}-{stamp}.xlsx")
            : Results.File(
                ActionReportPdf.Render(kind, farm.FarmName, farm.Zones, from, to,
                    AgroFlow.Business.Fao56EngineController.TodayInSast(), farm.GeneratedAtSast),
                "application/pdf",
                $"agroflow-{FilePrefix(kind)}-{slug}-{stamp}.pdf");
    }

    private static async Task<IResult> BuildDesignedAsync(
        ClaimsPrincipal user, NpgsqlDataSource dataSource,
        long zoneId, DateOnly from, DateOnly to,
        AgroFlow.Business.Fao56EngineController engine,
        bool asWorkbook,
        CancellationToken cancellationToken,
        ReportKind kind = ReportKind.WaterUsage)
    {
        if (!TryGetUserId(user, out var userId)) return Results.Unauthorized();
        if (from > to) return Results.BadRequest(new { error = "from must not be after to." });

        if (to.DayNumber - from.DayNumber >= MaxRangeDays)
        {
            return Results.BadRequest(new { error = $"Date range must not exceed {MaxRangeDays} days." });
        }

        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);

        var model = await WaterUsageReportBuilder.BuildAsync(
            connection, engine, userId, zoneId, from, to, cancellationToken);

        // One answer for "no such zone" and "not your zone". Telling them
        // apart would let anyone with a token enumerate which zone ids exist.
        if (model is null) return Results.NotFound(new { error = "No such zone." });

        var stamp = $"{from:yyyy-MM-dd}-to-{to:yyyy-MM-dd}";
        var slug = Slug(model.ZoneName);

        return asWorkbook
            ? Results.File(
                WaterUsageWorkbook.Render(model),
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                $"agroflow-water-{slug}-{stamp}.xlsx")
            // Item 3: every farmer PDF is the action report.
            : Results.File(
                ActionReportPdf.Render(kind, model.FarmName, new[] { model }, from, to,
                    AgroFlow.Business.Fao56EngineController.TodayInSast(), model.GeneratedAtSast),
                "application/pdf",
                $"agroflow-{FilePrefix(kind)}-{slug}-{stamp}.pdf");
    }

    private static string FilePrefix(ReportKind kind) => kind switch
    {
        ReportKind.Moisture => "moisture",
        ReportKind.Schedule => "schedule",
        _ => "water",
    };

    /// A filename a phone will not mangle: lowercase, ASCII, hyphens.
    private static string Slug(string name)
    {
        var chars = name.ToLowerInvariant()
            .Select(c => char.IsLetterOrDigit(c) ? c : '-')
            .ToArray();

        var slug = new string(chars).Trim('-');

        while (slug.Contains("--", StringComparison.Ordinal))
        {
            slug = slug.Replace("--", "-", StringComparison.Ordinal);
        }

        return slug.Length == 0 ? "zone" : slug;
    }

    private static async Task<IResult> GetWaterUsageXlsxAsync(
        ClaimsPrincipal user, NpgsqlDataSource dataSource, long? farmId, long? zoneId,
        DateOnly? from, DateOnly? to,
        AgroFlow.Business.Fao56EngineController engine, CancellationToken cancellationToken)
    {
        if (from is null || to is null) return Results.BadRequest(new { error = "from and to dates are required (yyyy-MM-dd)." });

        if (zoneId is not null)
        {
            return await BuildDesignedAsync(
                user, dataSource, zoneId.Value, from.Value, to.Value, engine,
                asWorkbook: true, cancellationToken);
        }

        if (farmId is not null)
        {
            return await BuildFarmDesignedAsync(
                user, dataSource, farmId.Value, from.Value, to.Value, engine,
                asWorkbook: true, cancellationToken);
        }

        return Results.BadRequest(new { error = "Either farmId or zoneId is required." });
    }

    internal static async Task<IResult> GetWaterUsagePdfAsync(
        ClaimsPrincipal user, NpgsqlDataSource dataSource, long? farmId, DateOnly? from, DateOnly? to,
        AgroFlow.Business.Fao56EngineController engine, long? zoneId = null,
        CancellationToken cancellationToken = default)
    {
        if (zoneId is not null && from is not null && to is not null)
        {
            return await BuildDesignedAsync(
                user, dataSource, zoneId.Value, from.Value, to.Value, engine,
                asWorkbook: false, cancellationToken);
        }

        // "All zones" now gets the designed template too (item 3), instead of
        // the one-page summary it used to share with nothing else.
        if (farmId is not null && from is not null && to is not null)
        {
            return await BuildFarmDesignedAsync(
                user, dataSource, farmId.Value, from.Value, to.Value, engine,
                asWorkbook: false, cancellationToken);
        }

        // Reuse the on-screen report so the PDF can never disagree with it.
        var result = await GetWaterUsageAsync(user, dataSource, farmId, from, to, engine);
        if (result is IStatusCodeHttpResult { StatusCode: >= 400 }) return result;
        if (result is not IValueHttpResult { Value: { } value }) return result;

        using var json = JsonSerializer.SerializeToDocument(value, new JsonSerializerOptions(JsonSerializerDefaults.Web));
        var root = json.RootElement;

        static string Litres1(JsonElement e) =>
            e.ValueKind == JsonValueKind.Number ? e.GetDouble().ToString("0.0", CultureInfo.InvariantCulture) + " L" : "n/a";

        var farmName = root.GetProperty("farmName").GetString();
        var generated = root.GetProperty("generatedAt").GetDateTimeOffset().ToOffset(TimeSpan.FromHours(2));
        var note = root.GetProperty("estimateNote").GetString();

        double total = 0; int zonesCounted = 0, zonesExcluded = 0;
        foreach (var z in root.GetProperty("zones").EnumerateArray())
        {
            if (z.GetProperty("status").GetString() == "ok")
            {
                total += z.GetProperty("estimatedLitres").GetDouble();
                zonesCounted++;
            }
            else zonesExcluded++;
        }

        var why = new AgroFlow.Api.Reports.ReportWhy();
        var insightWhy = why.AddInsights(root);
        var bytes = Document.Create(container => container.Page(page =>
        {
            ReportShell.ApplyPageDefaults(page);

            page.Header().Element(c => ReportShell.Header(
                c,
                "Water Usage Report",
                $"{farmName}  ·  {from:yyyy-MM-dd} to {to:yyyy-MM-dd}",
                ReportShell.GeneratedLine(generated)));

            page.Footer().Element(c => ReportShell.Footer(c, DesignedWaterUsagePdf.EstimateNote));

            page.Content().PaddingHorizontal(34).PaddingTop(18).PaddingBottom(12).Column(col =>
            {
                col.Spacing(10);
                col.Item().Text(note).Italic();
                col.Item().Text(
                    $"Total estimated: {total.ToString("0.0", CultureInfo.InvariantCulture)} L across {zonesCounted} zone(s)." +
                    (zonesExcluded > 0 ? $" {zonesExcluded} zone(s) had no usable data and are not included." : ""))
                    .SemiBold();

                WriteInsightsBlock(col, root, why, insightWhy);

                foreach (var z in root.GetProperty("zones").EnumerateArray())
                {
                    col.Item().PaddingTop(6).Text(z.GetProperty("name").GetString()).FontSize(12).SemiBold();

                    if (z.GetProperty("status").GetString() != "ok")
                    {
                        col.Item().Text(z.GetProperty("message").GetString());
                        continue;
                    }

                    col.Item().Text(
                        $"{z.GetProperty("eventCount").GetInt64()} irrigation event(s), " +
                        $"{(z.GetProperty("runtimeSecondsTotal").GetInt64() / 60.0).ToString("0.#", CultureInfo.InvariantCulture)} min pump time, " +
                        $"estimated {Litres1(z.GetProperty("estimatedLitres"))} " +
                        $"(flow rate {z.GetProperty("flowRateLpm").GetDouble().ToString("0.0#", CultureInfo.InvariantCulture)} L/min)");

                    col.Item().Table(table =>
                    {
                        table.ColumnsDefinition(c =>
                        {
                            c.RelativeColumn(2); c.RelativeColumn(); c.RelativeColumn(); c.RelativeColumn(2);
                        });
                        table.Header(h =>
                        {
                            h.Cell().Text("Date").SemiBold();
                            h.Cell().Text("Events").SemiBold();
                            h.Cell().Text("Pump min").SemiBold();
                            h.Cell().Text("Estimated litres").SemiBold();
                        });
                        foreach (var d in z.GetProperty("days").EnumerateArray())
                        {
                            table.Cell().BorderBottom(0.5f).BorderColor(Colors.Grey.Lighten2).Text(d.GetProperty("date").GetString());
                            table.Cell().BorderBottom(0.5f).BorderColor(Colors.Grey.Lighten2).Text(d.GetProperty("eventCount").GetInt64().ToString());
                            table.Cell().BorderBottom(0.5f).BorderColor(Colors.Grey.Lighten2).Text((d.GetProperty("runtimeSeconds").GetInt64() / 60.0).ToString("0.#", CultureInfo.InvariantCulture));
                            table.Cell().BorderBottom(0.5f).BorderColor(Colors.Grey.Lighten2).Text(Litres1(d.GetProperty("estimatedLitres")));
                        }
                    });
                }
                why.Appendix(col);
            });

        })).GeneratePdf();

        return Results.File(bytes, "application/pdf", $"water-usage-farm{farmId}-{from:yyyyMMdd}-{to:yyyyMMdd}.pdf");
    }

    internal static async Task<IResult> GetMoisturePdfAsync(
        ClaimsPrincipal user, NpgsqlDataSource dataSource, long? zoneId, DateOnly? from, DateOnly? to,
        AgroFlow.Business.Fao56EngineController engine)
    {
        // Item 3: the soil moisture report is the action report for one zone.
        if (zoneId is null || from is null || to is null)
        {
            return await GetMoistureAsync(user, dataSource, zoneId, from, to, engine);
        }

        return await BuildDesignedAsync(
            user, dataSource, zoneId.Value, from.Value, to.Value, engine,
            asWorkbook: false, CancellationToken.None, ReportKind.Moisture);
    }

    internal static async Task<IResult> GetSchedulePdfAsync(
        ClaimsPrincipal user, NpgsqlDataSource dataSource, long? farmId,
        AgroFlow.Business.Fao56EngineController engine, long? zoneId = null)
    {
        // Item 4: one zone's own schedule, for per-zone automatic reports.
        if (zoneId is not null)
        {
            var day = AgroFlow.Business.Fao56EngineController.TodayInSast();
            return await BuildDesignedAsync(
                user, dataSource, zoneId.Value, day.AddDays(-6), day, engine,
                asWorkbook: false, CancellationToken.None, ReportKind.Schedule);
        }

        // Item 3: the watering schedule is the farm's action report over the
        // last 7 days, with the coming week's day cards.
        if (farmId is null)
        {
            return await GetScheduleAsync(user, dataSource, farmId, engine);
        }

        var today = AgroFlow.Business.Fao56EngineController.TodayInSast();
        return await BuildFarmDesignedAsync(
            user, dataSource, farmId.Value, today.AddDays(-6), today, engine,
            asWorkbook: false, CancellationToken.None, ReportKind.Schedule);
    }

        private static async Task<IResult> GetZonesAsync(
        ClaimsPrincipal user, NpgsqlDataSource dataSource, long? farmId)
    {
        if (!TryGetUserId(user, out var userId)) return Results.Unauthorized();
        if (farmId is null) return Results.BadRequest(new { error = "farmId is required." });

        const string sql = """
            select z.id, z.name, z.crop_type
            from zone z
            where z.farm_id = $1
              and (exists (select 1 from farm f where f.farm_id = z.farm_id and f.owner_id = $2)
                or exists (select 1 from farm_member fm where fm.farm_id = z.farm_id and fm.profile_id = $2)
                or exists (select 1 from profile p where p.id = $2 and p.role = 'admin'))
            order by z.id;
            """;

        await using var connection = await dataSource.OpenConnectionAsync();
        await using var cmd = new NpgsqlCommand(sql, connection);
        cmd.Parameters.AddWithValue(farmId.Value);
        cmd.Parameters.AddWithValue(userId);
        await using var r = await cmd.ExecuteReaderAsync();

        var zones = new List<object>();
        while (await r.ReadAsync())
        {
            var id = r.GetInt64(0);
            zones.Add(new
            {
                zoneId = id,
                name = r.IsDBNull(1) ? $"Zone {id}" : r.GetString(1),
                cropType = r.IsDBNull(2) ? null : r.GetString(2),
            });
        }
        return Results.Ok(zones);
    }



    // Spec 9b: each report gets the subset of the engine's insights that belongs
    // to it, in the { text, source } shape. Insights come from the engine rather
    // than from the report's own numbers so the farmer sees the same words
    // everywhere.
    //
    // Returns an empty list when the engine's columns are not there yet, so a
    // report never fails because migration 0027 has not been applied.
    private static List<object> CollectInsights(
        AgroFlow.Business.Fao56EngineController engine, IEnumerable<long> zoneIds, string[] wantedTypes)
    {
        var collected = new List<object>();
        var today = AgroFlow.Business.Fao56EngineController.TodayInSast();

        foreach (var zoneId in zoneIds)
        {
            try
            {
                var zone = engine.Data.GetZone(zoneId);
                if (zone == null) continue;

                var input = engine.BuildInput(zone, today);
                var result = AgroFlow.Business.Agronomy.Fao56Engine.Run(input);
                var signals = engine.BuildFaultSignals(zone, today);

                foreach (var insight in AgroFlow.Business.Agronomy.ZoneInsightBuilder.Build(input, result, signals))
                {
                    if (wantedTypes.Length > 0 && !wantedTypes.Contains(insight.InsightType)) continue;

                    collected.Add(new
                    {
                        text = insight.Message,
                        source = insight.Source,
                        insightType = insight.InsightType,
                        severity = insight.Severity,
                        zoneId = insight.ZoneId,

                        // Item 2c: the report's "Why:" line and appendix entry.
                        why = insight.Explanation?.Summary,
                        explanation = insight.Explanation,
                    });
                }
            }
            catch (Exception)
            {
                // Per zone, so one zone cannot empty the whole report's insights.
            }
        }

        return collected;
    }

    // Which insight types belong on which report (spec 9b).
    private static readonly string[] MoistureReportInsights =
    {
        AgroFlow.Business.Agronomy.InsightType.WateringFailed,
        AgroFlow.Business.Agronomy.InsightType.SensorDrift,
        AgroFlow.Business.Agronomy.InsightType.StressDays,
        AgroFlow.Business.Agronomy.InsightType.ThresholdUnsafe,
    };

    private static readonly string[] WaterUsageReportInsights =
    {
        AgroFlow.Business.Agronomy.InsightType.Overwatering,
        AgroFlow.Business.Agronomy.InsightType.SkipRain,
        AgroFlow.Business.Agronomy.InsightType.WaterNow,
    };

    // Spec 9b: a top-level insights block, each line with its source in small
    // text underneath. Shared by the moisture and water-usage PDFs so the two
    // cannot drift apart.
    private static void WriteInsightsBlock(ColumnDescriptor col, JsonElement root,
        AgroFlow.Api.Reports.ReportWhy why, List<AgroFlow.Business.Agronomy.RuleBook.Explanation?> perInsight)
    {
        if (!root.TryGetProperty("insights", out var insights)
            || insights.ValueKind != JsonValueKind.Array
            || insights.GetArrayLength() == 0)
        {
            return;
        }

        col.Item().PaddingTop(6).Text("What to do").FontSize(12).SemiBold();

        var index = 0;
        foreach (var insight in insights.EnumerateArray())
        {
            var explanation = index < perInsight.Count ? perInsight[index] : null;
            index++;
            var text = insight.TryGetProperty("text", out var t) && t.ValueKind == JsonValueKind.String
                ? t.GetString()! : "";
            var source = insight.TryGetProperty("source", out var sr) && sr.ValueKind == JsonValueKind.String
                ? sr.GetString()! : "";

            col.Item().Text("- " + text);
            if (source.Length > 0)
            {
                col.Item().PaddingLeft(10).Text("Source: " + source)
                    .FontSize(8).FontColor(Colors.Grey.Darken1);
            }

            why.Line(col, explanation);
        }
    }

    private static double? Round1(double? value) =>
        value is { } v ? Math.Round(v, 1) : (double?)null;

    // Spec 9c: the weather app beside local zone sensors, from report_daily_weather
    // view. Observed days only - a forecast has nothing measured to compare to.
    //
    // Returns an empty list rather than throwing when the view does not exist yet
    // (migration 0027 unapplied), so the report still renders.
    private static async Task<List<object>> ReadWeatherComparisonAsync(
        NpgsqlConnection connection, long farmId, DateOnly from, DateOnly to)
    {
        var rows = new List<object>();

        const string sql = """
            select day, app_tmin_c, app_tmax_c, app_rh_min_pct, app_rh_max_pct, app_rh_mean_pct,
                   app_wind_ms, app_wind_height_m, app_rain_mm, eto_mm, eto_source,
                   dht_tmin_c, dht_tmax_c, dht_rh_mean_pct, dht_zone_count,
                   diff_tmin_c, diff_tmax_c, diff_rh_mean_pct
            from report_daily_weather
            where farm_id = $1 and day between $2 and $3
            order by day;
            """;

        try
        {
            await using var cmd = new NpgsqlCommand(sql, connection);
            cmd.Parameters.AddWithValue(farmId);
            cmd.Parameters.AddWithValue(NpgsqlDbType.Date, from);
            cmd.Parameters.AddWithValue(NpgsqlDbType.Date, to);

            await using var r = await cmd.ExecuteReaderAsync();
            while (await r.ReadAsync())
            {
                double? Val(int i) => r.IsDBNull(i) ? (double?)null : Math.Round(Convert.ToDouble(r.GetValue(i)), 1);

                var dhtZoneCount = r.IsDBNull(14) ? 0 : Convert.ToInt64(r.GetValue(14));

                rows.Add(new
                {
                    date = r.GetFieldValue<DateOnly>(0).ToString("yyyy-MM-dd"),
                    app = new
                    {
                        tminC = Val(1), tmaxC = Val(2),
                        rhMinPct = Val(3), rhMaxPct = Val(4), rhMeanPct = Val(5),
                        windMs = Val(6), windHeightM = Val(7), rainMm = Val(8),
                    },
                    eto = new { mm = Val(9), source = r.IsDBNull(10) ? null : r.GetString(10) },
                    dht = new
                    {
                        tminC = Val(11), tmaxC = Val(12), rhMeanPct = Val(13),
                        zoneCount = dhtZoneCount,
                    },
                    // Null, never zero, when either side is missing - a missing
                    // sensor must not read as perfect agreement.
                    difference = new { tminC = Val(15), tmaxC = Val(16), rhMeanPct = Val(17) },
                    // What to show in the cell when there is nothing to compare.
                    note = dhtZoneCount == 0
                        ? "Sensor offline"
                        : (r.IsDBNull(10) ? null : (r.GetString(10) == "dht11_fallback" ? "DHT11 used (weather app incomplete)" : null)),
                });
            }
        }
        catch (PostgresException)
        {
            // View missing (0027 not applied). An empty comparison is the honest
            // answer; the caller renders the section as unavailable.
            return rows;
        }

        return rows;
    }

    private const string WeatherComparisonCaption =
        "The weather app shows conditions for the wider area. AgroFlow's DHT11 is installed in an irrigation zone, so it measures the local conditions around the crop. Differences are normal.";

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
