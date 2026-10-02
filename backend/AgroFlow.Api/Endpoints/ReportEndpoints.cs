using System.Security.Claims;
using System.Globalization;
using System.Text.Json;
using Npgsql;
using NpgsqlTypes;
using QuestPDF.Fluent;
using QuestPDF.Helpers;
using QuestPDF.Infrastructure;
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
        group.MapGet("/moisture", GetMoistureAsync);
        group.MapGet("/schedule", GetScheduleAsync);
        group.MapGet("/water-usage/pdf", GetWaterUsagePdfAsync);
        group.MapGet("/moisture/pdf", GetMoisturePdfAsync);
        group.MapGet("/schedule/pdf", GetSchedulePdfAsync);
        group.MapGet("/zones", GetZonesAsync);
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

        private static async Task<IResult> GetMoistureAsync(
        ClaimsPrincipal user, NpgsqlDataSource dataSource, long? zoneId, DateOnly? from, DateOnly? to)
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
            select z.name, z.moisture_threshold, z.desired_moisture, z.flow_rate_lpm
            from zone z
            where z.id = $1
              and (exists (select 1 from farm f where f.farm_id = z.farm_id and f.owner_id = $2)
                or exists (select 1 from farm_member fm where fm.farm_id = z.farm_id and fm.profile_id = $2)
                or exists (select 1 from profile p where p.id = $2 and p.role = 'admin'));
            """;
        string zoneName; double? dryThreshold, targetMoisture; float? flowRate;
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
        }

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
                var avg = Convert.ToDouble(r.GetValue(1));
                var min = Convert.ToDouble(r.GetValue(2));
                var max = Convert.ToDouble(r.GetValue(3));
                var count = Convert.ToInt64(r.GetValue(4));
                weightedSum += avg * count; readingCount += count;
                lowest = Math.Min(lowest, min); highest = Math.Max(highest, max);
                if (dryThreshold is not null && avg < dryThreshold) hoursBelow++;
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
        });
    }

    private const int MaxReadingAgeHours = 24;

    private static async Task<IResult> GetScheduleAsync(
        ClaimsPrincipal user, NpgsqlDataSource dataSource, long? farmId)
    {
        if (!TryGetUserId(user, out var userId)) return Results.Unauthorized();
        if (farmId is null) return Results.BadRequest(new { error = "farmId is required." });

        await using var connection = await dataSource.OpenConnectionAsync();

        // 1. Ownership gate + latitude (needed for ET0).
        const string farmSql = """
            select f.name, f.latitude from farm f
            where f.farm_id = $1
              and (f.owner_id = $2 or exists (
                select 1 from farm_member fm where fm.farm_id = f.farm_id and fm.profile_id = $2));
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
                    SoilMoisturePercent = i == 0 && readingFresh ? z.Moisture : null,
                    MoistureThresholdPercent = z.Threshold,
                    FarmLatitudeDegrees = latitude,
                    LatestWeather = w,
                    Forecast = weather.Values.Where(x => x.Date > asOf).ToList(),
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
                    pct = z.Moisture,
                    recordedAt = z.ReadAt,
                    usedForToday = readingFresh,
                    note = z.ReadAt is null ? "No moisture reading recorded for this zone."
                        : readingFresh ? null
                        : $"Latest reading is older than {MaxReadingAgeHours} hours, so it was not used.",
                },
                summary = todayAdvice!.Summary,
                reasoning = todayAdvice.Reasoning,
                facts = todayAdvice.Facts.Select(f => new { f.Label, f.Value, f.Source }),
                insights = todayAdvice.Insights,
                limitations = todayAdvice.Limitations,
                days,
            });
        }

        return Results.Ok(new
        {
            farmId,
            farmName,
            generatedAt = DateTimeOffset.UtcNow,
            today = today.ToString("yyyy-MM-dd"),
            status = zones.Count == 0 ? "no_zones" : "ok",
            message = zones.Count == 0 ? "Not enough data yet: this farm has no zones." : null,
            zones,
        });
    }

        private static async Task<IResult> GetWaterUsagePdfAsync(
        ClaimsPrincipal user, NpgsqlDataSource dataSource, long? farmId, DateOnly? from, DateOnly? to)
    {
        // Reuse the on-screen report so the PDF can never disagree with it.
        var result = await GetWaterUsageAsync(user, dataSource, farmId, from, to);
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

        var bytes = Document.Create(container => container.Page(page =>
        {
            page.Size(PageSizes.A4);
            page.Margin(36);
            page.DefaultTextStyle(t => t.FontSize(10));

            page.Header().Column(col =>
            {
                col.Item().Text("Water usage report (estimated)").FontSize(18).SemiBold();
                col.Item().Text($"{farmName}  |  {from:yyyy-MM-dd} to {to:yyyy-MM-dd}");
                col.Item().Text($"Generated {generated:yyyy-MM-dd HH:mm} (SAST)").FontColor(Colors.Grey.Darken1);
            });

            page.Content().PaddingVertical(12).Column(col =>
            {
                col.Spacing(10);
                col.Item().Text(note).Italic();
                col.Item().Text(
                    $"Total estimated: {total.ToString("0.0", CultureInfo.InvariantCulture)} L across {zonesCounted} zone(s)." +
                    (zonesExcluded > 0 ? $" {zonesExcluded} zone(s) had no usable data and are not included." : ""))
                    .SemiBold();

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
            });

            page.Footer().AlignCenter().Text(t =>
            {
                t.Span("Page ");
                t.CurrentPageNumber();
            });
        })).GeneratePdf();

        return Results.File(bytes, "application/pdf", $"water-usage-farm{farmId}-{from:yyyyMMdd}-{to:yyyyMMdd}.pdf");
    }

        private static async Task<IResult> GetMoisturePdfAsync(
        ClaimsPrincipal user, NpgsqlDataSource dataSource, long? zoneId, DateOnly? from, DateOnly? to)
    {
        // Reuse the on-screen report so the PDF can never disagree with it.
        var result = await GetMoistureAsync(user, dataSource, zoneId, from, to);
        if (result is IStatusCodeHttpResult { StatusCode: >= 400 }) return result;
        if (result is not IValueHttpResult { Value: { } value }) return result;

        using var json = JsonSerializer.SerializeToDocument(value, new JsonSerializerOptions(JsonSerializerDefaults.Web));
        var root = json.RootElement;

        static string Num(JsonElement e, string suffix) =>
            e.ValueKind == JsonValueKind.Number
                ? e.GetDouble().ToString("0.#", CultureInfo.InvariantCulture) + suffix
                : "not set";

        var zoneName = root.GetProperty("zoneName").GetString();
        var generated = root.GetProperty("generatedAt").GetDateTimeOffset().ToOffset(TimeSpan.FromHours(2));
        var note = root.GetProperty("estimateNote").GetString();
        var hasData = root.GetProperty("status").GetString() == "ok";
        var thresholds = root.GetProperty("thresholds");

        var bytes = Document.Create(container => container.Page(page =>
        {
            page.Size(PageSizes.A4);
            page.Margin(36);
            page.DefaultTextStyle(t => t.FontSize(10));

            page.Header().Column(col =>
            {
                col.Item().Text("Soil moisture and irrigation report").FontSize(18).SemiBold();
                col.Item().Text($"{zoneName}  |  {from:yyyy-MM-dd} to {to:yyyy-MM-dd}");
                col.Item().Text($"Generated {generated:yyyy-MM-dd HH:mm} (SAST)").FontColor(Colors.Grey.Darken1);
            });

            page.Content().PaddingVertical(12).Column(col =>
            {
                col.Spacing(10);

                if (!hasData)
                {
                    col.Item().Text(root.GetProperty("message").GetString());
                    return;
                }

                var s = root.GetProperty("summary");
                col.Item().Text(
                    $"Dry threshold: {Num(thresholds.GetProperty("dryPct"), "%")}  |  " +
                    $"Target moisture: {Num(thresholds.GetProperty("targetPct"), "%")}");
                col.Item().Text(
                    $"{s.GetProperty("readingCount").GetInt64()} readings. " +
                    $"Average {Num(s.GetProperty("averagePct"), "%")}, " +
                    $"lowest {Num(s.GetProperty("lowestPct"), "%")}, " +
                    $"highest {Num(s.GetProperty("highestPct"), "%")}.");
                col.Item().Text(s.GetProperty("action").GetString()).SemiBold();

                col.Item().PaddingTop(6).Text("Irrigation events").FontSize(12).SemiBold();
                col.Item().Text(note).Italic();
                var events = root.GetProperty("irrigationEvents");
                if (events.GetArrayLength() == 0)
                {
                    col.Item().Text("No irrigation recorded in this period.");
                }
                else
                {
                    col.Item().Table(table =>
                    {
                        table.ColumnsDefinition(c =>
                        {
                            c.RelativeColumn(2); c.RelativeColumn(); c.RelativeColumn(); c.RelativeColumn(2);
                        });
                        table.Header(h =>
                        {
                            h.Cell().Text("Started (SAST)").SemiBold();
                            h.Cell().Text("Minutes").SemiBold();
                            h.Cell().Text("Trigger").SemiBold();
                            h.Cell().Text("Estimated litres").SemiBold();
                        });
                        foreach (var e in events.EnumerateArray())
                        {
                            var trigger = e.GetProperty("triggerSource");
                            table.Cell().BorderBottom(0.5f).BorderColor(Colors.Grey.Lighten2).Text(e.GetProperty("startedAt").GetString());
                            table.Cell().BorderBottom(0.5f).BorderColor(Colors.Grey.Lighten2).Text((e.GetProperty("runtimeSeconds").GetInt64() / 60.0).ToString("0.#", CultureInfo.InvariantCulture));
                            table.Cell().BorderBottom(0.5f).BorderColor(Colors.Grey.Lighten2).Text(trigger.ValueKind == JsonValueKind.String ? trigger.GetString() : "unknown");
                            table.Cell().BorderBottom(0.5f).BorderColor(Colors.Grey.Lighten2).Text(
                                e.GetProperty("estimatedLitres").ValueKind == JsonValueKind.Number
                                    ? Num(e.GetProperty("estimatedLitres"), " L (estimated)")
                                    : "not enough data yet");
                        }
                    });
                }

                col.Item().PaddingTop(6).Text("Soil moisture by hour").FontSize(12).SemiBold();
                col.Item().Table(table =>
                {
                    table.ColumnsDefinition(c =>
                    {
                        c.RelativeColumn(2); c.RelativeColumn(); c.RelativeColumn(); c.RelativeColumn(); c.RelativeColumn();
                    });
                    table.Header(h =>
                    {
                        h.Cell().Text("Hour (SAST)").SemiBold();
                        h.Cell().Text("Average").SemiBold();
                        h.Cell().Text("Min").SemiBold();
                        h.Cell().Text("Max").SemiBold();
                        h.Cell().Text("Readings").SemiBold();
                    });
                    foreach (var p in root.GetProperty("series").EnumerateArray())
                    {
                        table.Cell().BorderBottom(0.5f).BorderColor(Colors.Grey.Lighten2).Text(p.GetProperty("time").GetString());
                        table.Cell().BorderBottom(0.5f).BorderColor(Colors.Grey.Lighten2).Text(Num(p.GetProperty("avgMoisturePct"), "%"));
                        table.Cell().BorderBottom(0.5f).BorderColor(Colors.Grey.Lighten2).Text(Num(p.GetProperty("minMoisturePct"), "%"));
                        table.Cell().BorderBottom(0.5f).BorderColor(Colors.Grey.Lighten2).Text(Num(p.GetProperty("maxMoisturePct"), "%"));
                        table.Cell().BorderBottom(0.5f).BorderColor(Colors.Grey.Lighten2).Text(p.GetProperty("readings").GetInt64().ToString());
                    }
                });
            });

            page.Footer().AlignCenter().Text(t =>
            {
                t.Span("Page ");
                t.CurrentPageNumber();
            });
        })).GeneratePdf();

        return Results.File(bytes, "application/pdf", $"moisture-zone{zoneId}-{from:yyyyMMdd}-{to:yyyyMMdd}.pdf");
    }

        private static async Task<IResult> GetSchedulePdfAsync(
        ClaimsPrincipal user, NpgsqlDataSource dataSource, long? farmId)
    {
        // Reuse the on-screen report so the PDF can never disagree with it.
        var result = await GetScheduleAsync(user, dataSource, farmId);
        if (result is IStatusCodeHttpResult { StatusCode: >= 400 }) return result;
        if (result is not IValueHttpResult { Value: { } value }) return result;

        using var json = JsonSerializer.SerializeToDocument(value, new JsonSerializerOptions(JsonSerializerDefaults.Web));
        var root = json.RootElement;

        static string Str(JsonElement e) => e.ValueKind == JsonValueKind.String ? e.GetString() ?? "-" : "-";
        static string Num(JsonElement e, string suffix = "") =>
            e.ValueKind == JsonValueKind.Number
                ? e.GetDouble().ToString("0.#", CultureInfo.InvariantCulture) + suffix
                : "-";
        static string ActionText(string? a) => a switch
        {
            "IrrigateNow" => "Irrigate today",
            "NoActionNeeded" => "No irrigation needed",
            "InsufficientData" => "No recommendation possible",
            "RainExpectedCheckMoisture" => "Rain expected: check moisture",
            "CheckMoisture" => "Check moisture",
            _ => a ?? "-",
        };

        var farmName = root.GetProperty("farmName").GetString();
        var generated = root.GetProperty("generatedAt").GetDateTimeOffset().ToOffset(TimeSpan.FromHours(2));
        var today = root.GetProperty("today").GetString();
        var hasZones = root.GetProperty("status").GetString() == "ok";

        var bytes = Document.Create(container => container.Page(page =>
        {
            page.Size(PageSizes.A4);
            page.Margin(36);
            page.DefaultTextStyle(t => t.FontSize(10));

            page.Header().Column(col =>
            {
                col.Item().Text("Suggested irrigation schedule").FontSize(18).SemiBold();
                col.Item().Text($"{farmName}  |  next 7 days from {today}");
                col.Item().Text($"Generated {generated:yyyy-MM-dd HH:mm} (SAST)").FontColor(Colors.Grey.Darken1);
            });

            page.Content().PaddingVertical(12).Column(col =>
            {
                col.Spacing(8);
                col.Item().Text(
                    "Rule-based advice from FAO-56 crop water guidance, the farm's weather records and the zone's own moisture threshold. " +
                    "Soil moisture can only be measured today, so later days show a prompt to check moisture, not a watering decision.")
                    .Italic();

                if (!hasZones)
                {
                    col.Item().Text(root.GetProperty("message").GetString());
                    return;
                }

                foreach (var z in root.GetProperty("zones").EnumerateArray())
                {
                    col.Item().PaddingTop(8).Text($"{Str(z.GetProperty("name"))} ({Str(z.GetProperty("cropType"))})").FontSize(13).SemiBold();
                    col.Item().Text(Str(z.GetProperty("summary"))).SemiBold();

                    var lm = z.GetProperty("latestMoisture");
                    col.Item().Text(
                        lm.GetProperty("pct").ValueKind == JsonValueKind.Number
                            ? $"Latest soil moisture reading: {Num(lm.GetProperty("pct"), "%")} at {Str(lm.GetProperty("recordedAt"))} (UTC)." +
                              (lm.GetProperty("usedForToday").GetBoolean() ? "" : " " + Str(lm.GetProperty("note")))
                            : "No soil moisture reading recorded for this zone.");

                    var reasoning = z.GetProperty("reasoning");
                    if (reasoning.GetArrayLength() > 0)
                    {
                        col.Item().Text("Why").SemiBold();
                        foreach (var r in reasoning.EnumerateArray()) col.Item().Text("- " + Str(r));
                    }

                    var facts = z.GetProperty("facts");
                    if (facts.GetArrayLength() > 0)
                    {
                        col.Item().Text("Figures and their sources").SemiBold();
                        foreach (var f in facts.EnumerateArray())
                            col.Item().Text($"- {Str(f.GetProperty("label"))}: {Str(f.GetProperty("value"))}  [{Str(f.GetProperty("source"))}]").FontSize(9);
                    }

                    var limitations = z.GetProperty("limitations");
                    if (limitations.GetArrayLength() > 0)
                    {
                        col.Item().Text("What could not be determined").SemiBold();
                        foreach (var l in limitations.EnumerateArray()) col.Item().Text("- " + Str(l)).FontSize(9);
                    }

                    col.Item().Text("7-day outlook").SemiBold();
                    col.Item().Table(table =>
                    {
                        table.ColumnsDefinition(c =>
                        {
                            c.RelativeColumn(1.4f); c.RelativeColumn(2.2f); c.RelativeColumn(); c.RelativeColumn(); c.RelativeColumn(); c.RelativeColumn(3f);
                        });
                        table.Header(h =>
                        {
                            h.Cell().Text("Date").SemiBold();
                            h.Cell().Text("Action").SemiBold();
                            h.Cell().Text("ET0 mm").SemiBold();
                            h.Cell().Text("ETc mm").SemiBold();
                            h.Cell().Text("Rain mm").SemiBold();
                            h.Cell().Text("Note").SemiBold();
                        });
                        foreach (var d in z.GetProperty("days").EnumerateArray())
                        {
                            table.Cell().BorderBottom(0.5f).BorderColor(Colors.Grey.Lighten2).Text(Str(d.GetProperty("date")));
                            table.Cell().BorderBottom(0.5f).BorderColor(Colors.Grey.Lighten2).Text(ActionText(d.GetProperty("action").GetString()));
                            table.Cell().BorderBottom(0.5f).BorderColor(Colors.Grey.Lighten2).Text(Num(d.GetProperty("et0MmPerDay")));
                            table.Cell().BorderBottom(0.5f).BorderColor(Colors.Grey.Lighten2).Text(Num(d.GetProperty("etcMmPerDay")));
                            table.Cell().BorderBottom(0.5f).BorderColor(Colors.Grey.Lighten2).Text(Num(d.GetProperty("forecastRainMm")));
                            table.Cell().BorderBottom(0.5f).BorderColor(Colors.Grey.Lighten2).Text(Str(d.GetProperty("note"))).FontSize(9);
                        }
                    });
                }
            });

            page.Footer().AlignCenter().Text(t =>
            {
                t.Span("Page ");
                t.CurrentPageNumber();
            });
        })).GeneratePdf();

        return Results.File(bytes, "application/pdf", $"schedule-farm{farmId}-{today}.pdf");
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