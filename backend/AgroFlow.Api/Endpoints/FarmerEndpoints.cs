using System.Security.Claims;
using AgroFlow.Api.Services;
using AgroFlow.Business;
using AgroFlow.Business.Agronomy;
using System.Collections.Concurrent;
using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Extensions.Caching.Memory;
using Npgsql;
using NpgsqlTypes;

namespace AgroFlow.Api.Endpoints;

public record ZoneSettingsRequest(
    string? Name,
    string? Location,
    string? CropType,
    string? IrrigationMode,
    bool? AutomationEnabled,
    float? MoistureThreshold,
    float? DesiredMoisture,
    bool? WeatherAdjustment,
    bool? ScheduleEnabled,
    string[]? ScheduleDays,
    string? ScheduleStartTime,
    int? ScheduleDurationMinutes);

public record ManualIrrigationRequest(string Command, int? DurationSeconds);
public record ProfileUpdateRequest(string Name, string? Phone);
public record LanguageRequest(string? Language);

public record FarmerServiceRequest(
    string RequestType,
    long? FarmId,
    string? Location,
    float? RoughSize,
    string CropType,
    string? Notes,
    // AF-19: "ha", "m2" or "unknown" ("I don't know - help me measure"). Older apps send none.
    string? RoughSizeUnit = null);

public static class FarmerEndpoints
{
    private readonly record struct WeatherCacheKey(long FarmId, double Latitude, double Longitude);
    private sealed record WeatherCacheEntry(string Json, DateTimeOffset ExpiresAt);
    private static readonly ConcurrentDictionary<WeatherCacheKey, SemaphoreSlim> WeatherCacheLocks = new();

    private const string FarmAccessSql = """
        exists (select 1 from farm f where f.farm_id = z.farm_id and f.owner_id = $1)
        or exists (select 1 from farm_member fm where fm.farm_id = z.farm_id and fm.profile_id = $1)
        """;

    public static void MapFarmerEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/farmer").RequireAuthorization();
        group.MapGet("/dashboard", GetDashboardAsync);
        group.MapGet("/weather/current", GetCurrentWeatherAsync);
        group.MapPut("/profile", UpdateProfileAsync);
        group.MapPut("/language", UpdateLanguageAsync);
        group.MapPost("/password-changed", ClearMustChangePasswordAsync);

        group.MapPost("/requests", CreateFarmerServiceRequestAsync);
        group.MapPut("/zones/{zoneId:long}/settings", UpdateZoneSettingsAsync);
        group.MapPost("/zones/{zoneId:long}/kit-code", IssueKitCodeAsync);
        group.MapPost("/zones/{zoneId:long}/commands", CreateManualCommandAsync);
        group.MapPost("/alerts/{alertId:long}/read", MarkAlertReadAsync);
    }

    // A farmer may prepare an empty zone for its first kit. Replacing an active kit remains a
    // staff operation: it can move hardware and history, so it needs the admin linking workflow.
    // The ownership predicate is applied before KitCodes.IssueAsync because that helper only
    // verifies that the zone exists. Inaccessible ids deliberately look exactly like missing ids.
    private static async Task<IResult> IssueKitCodeAsync(
        long zoneId,
        ClaimsPrincipal user,
        NpgsqlDataSource dataSource,
        AuditLog audit,
        CancellationToken ct)
    {
        if (!TryGetUserId(user, out var userId)) return Results.Unauthorized();

        await using var connection = await dataSource.OpenConnectionAsync(ct);
        string zoneName;
        long farmId;
        bool hasActiveKit;
        await using (var zone = new NpgsqlCommand($"""
            select coalesce(nullif(z.name, ''), 'Zone ' || z.id), z.farm_id,
                   exists (select 1 from hardware h
                            where h.zone_id = z.id and h.enrollment_status = 'active')
              from zone z
             where z.id = $2 and ({FarmAccessSql})
            """, connection))
        {
            zone.Parameters.AddWithValue(userId);
            zone.Parameters.AddWithValue(zoneId);
            await using var reader = await zone.ExecuteReaderAsync(ct);
            if (!await reader.ReadAsync(ct))
                return Results.NotFound(new { error = "No such zone." });

            zoneName = reader.GetString(0);
            farmId = reader.GetInt64(1);
            hasActiveKit = reader.GetBoolean(2);
        }

        if (hasActiveKit)
        {
            return Results.Conflict(new
            {
                error = "This zone already has a kit. Ask AgroFlow staff if it needs to be replaced.",
                reason = "kit_already_active",
            });
        }

        var issued = await KitCodes.IssueAsync(
            connection, zoneId, $"{zoneName} kit", EnrollableKitTypes.Default, null, ct);
        if (issued is null) return Results.NotFound(new { error = "No such zone." });

        var (hardwareId, code, expiresAt) = issued.Value;
        // The code is a live credential. Record its creation and expiry, never its value.
        await audit.WriteAsync(
            user,
            AuditActions.EnrollmentCodeCreated,
            "hardware",
            hardwareId.ToString(CultureInfo.InvariantCulture),
            farmId,
            new { zoneId, expiresAt, source = "farmer_self_service" },
            ct);

        return Results.Ok(new { hardwareId, code, expiresAt, zoneId, zoneName });
    }

    // AF-04: the app shows an alert as read only after this succeeds. Only an alert on the caller's
    // own farm (or one of its zones); the first time is kept (read_at is set once), so a retry or a
    // second phone gets the same answer. 404 for anyone else's alert, so ids cannot be probed.
    private static async Task<IResult> MarkAlertReadAsync(long alertId, ClaimsPrincipal user, NpgsqlDataSource dataSource, CancellationToken ct)
    {
        if (!TryGetUserId(user, out var userId)) return Results.Unauthorized();
        await using var connection = await dataSource.OpenConnectionAsync(ct);
        await using var cmd = new NpgsqlCommand("""
            update alert a set read_at = coalesce(a.read_at, now())
             where a.id = $2
               and (exists (select 1 from farm f where f.farm_id = a.farm_id
                              and (f.owner_id = $1 or exists (select 1 from farm_member fm where fm.farm_id = f.farm_id and fm.profile_id = $1)))
                 or exists (select 1 from zone z join farm f on f.farm_id = z.farm_id where z.id = a.zone_id
                              and (f.owner_id = $1 or exists (select 1 from farm_member fm where fm.farm_id = f.farm_id and fm.profile_id = $1))))
            returning a.id, a.read_at
            """, connection);
        cmd.Parameters.AddWithValue(userId);
        cmd.Parameters.AddWithValue(alertId);
        await using var r = await cmd.ExecuteReaderAsync(ct);
        if (!await r.ReadAsync(ct)) return Results.NotFound(new { error = "No such alert." });
        return Results.Ok(new { id = r.GetInt64(0), readAt = r.GetFieldValue<DateTimeOffset>(1) });
    }

    private static async Task<IResult> CreateFarmerServiceRequestAsync(
        FarmerServiceRequest request,
        ClaimsPrincipal user,
        NpgsqlDataSource dataSource,
        AgroFlow.Api.Services.Notifications.FarmRequestNotifier requestNotifier,
        CancellationToken cancellationToken)
    {
        if (!TryGetUserId(user, out var userId))
            return Results.Unauthorized();

        var requestType = request.RequestType?.Trim().ToLowerInvariant();
        var cropType = request.CropType?.Trim().ToLowerInvariant();
        var location = request.Location?.Trim();
        var notes = request.Notes?.Trim();

        if (requestType is not ("new_farm" or "new_zone"))
        {
            return Results.BadRequest(new
            {
                error = "Request type must be new_farm or new_zone."
            });
        }

        var allowedCrops = new[]
        {
            "potato",
            "tomato",
            "citrus",
            "leafy_veg",
            "maize",
            "dry_beans"
        };

        if (cropType is null || !allowedCrops.Contains(cropType))
        {
            return Results.BadRequest(new
            {
                error = "Please select a valid crop."
            });
        }

        if (request.RoughSize.HasValue && request.RoughSize.Value <= 0)
        {
            return Results.BadRequest(new
            {
                error = "Rough size must be greater than 0."
            });
        }

        // The size is stored in hectares with the unit the farmer chose, so staff never get a bare
        // "2.5" (AF-19). "unknown" keeps no number: staff help measure at the visit.
        var unit = request.RoughSizeUnit?.Trim().ToLowerInvariant();
        if (unit is not (null or "ha" or "m2" or "unknown"))
            return Results.BadRequest(new { error = "Choose square metres or hectares for the size, or I don't know.", field = "roughSizeUnit" });
        float? roughSizeHa = unit switch
        {
            "unknown" => null,
            "m2" => request.RoughSize / 10_000f,
            _ => request.RoughSize,
        };
        var storedUnit = unit ?? (request.RoughSize.HasValue ? "unstated" : null);

        if (requestType == "new_farm" &&
            string.IsNullOrWhiteSpace(location))
        {
            return Results.BadRequest(new
            {
                error = "Location is required for a new farm request."
            });
        }

        if (requestType == "new_zone" &&
            !request.FarmId.HasValue)
        {
            return Results.BadRequest(new
            {
                error = "An existing farm must be selected for a new zone request."
            });
        }

        await using var connection =
            await dataSource.OpenConnectionAsync();

        if (requestType == "new_zone")
        {
            const string farmOwnershipSql = """
                select 1
                from farm
                where farm_id = $1
                  and owner_id = $2
                limit 1
                """;

            await using var ownershipCommand =
                new NpgsqlCommand(
                    farmOwnershipSql,
                    connection);

            ownershipCommand.Parameters.AddWithValue(
                request.FarmId!.Value);

            ownershipCommand.Parameters.AddWithValue(
                userId);

            var farmExists =
                await ownershipCommand.ExecuteScalarAsync();

            if (farmExists is null)
            {
                return Results.BadRequest(new
                {
                    error =
                        "You can only submit a new-zone request for a farm you own."
                });
            }
        }

        const string insertSql = """
            insert into service_request (
                farmer_id,
                farm_id,
                request_type,
                location,
                rough_size,
                crop_type,
                notes
            )
            values (
                $1,
                $2,
                $3,
                $4,
                $5,
                $6,
                $7
            )
            returning
                id,
                status,
                created_at
            """;

        await using var command =
            new NpgsqlCommand(
                insertSql,
                connection);

        command.Parameters.AddWithValue(
            userId);

        command.Parameters.AddWithValue(
            NpgsqlDbType.Bigint,
            (object?)request.FarmId ?? DBNull.Value);

        command.Parameters.AddWithValue(
            requestType);

        command.Parameters.AddWithValue(
            NpgsqlDbType.Text,
            (object?)location ?? DBNull.Value);

        command.Parameters.AddWithValue(
            NpgsqlDbType.Real,
            (object?)roughSizeHa ?? DBNull.Value);

        command.Parameters.AddWithValue(
            cropType);

        command.Parameters.AddWithValue(
            NpgsqlDbType.Text,
            (object?)notes ?? DBNull.Value);

        await using var reader =
            await command.ExecuteReaderAsync();

        if (!await reader.ReadAsync())
        {
            return Results.Problem(
                "The service request could not be created.");
        }

        var requestId =
            reader.GetInt64(0);

        var status =
            reader.GetString(1);

        var createdAt =
            reader.GetDateTime(2);

        await reader.CloseAsync();

        // 0057: the unit beside the size. Before it is applied the size alone is kept.
        try
        {
            await using var unitCmd = new NpgsqlCommand("update service_request set rough_size_unit = $2 where id = $1", connection);
            unitCmd.Parameters.AddWithValue(requestId);
            unitCmd.Parameters.AddWithValue(NpgsqlDbType.Text, (object?)storedUnit ?? DBNull.Value);
            await unitCmd.ExecuteNonQueryAsync();
        }
        catch (PostgresException e) when (e.SqlState == PostgresErrorCodes.UndefinedColumn) { }

        // The reader is closed before the notifier opens its own connection. The insert
        // above has already committed, so we never send a message about a request
        // that was rolled back.

        // Telegram the farmer and every admin with a linked chat. Awaited, but it can
        // never fail this request: NotifyAsync catches everything, so a Telegram outage
        // only means a logged skip.
        await requestNotifier.NotifyAsync(requestId, cancellationToken);

        return Results.Created(
            $"/api/farmer/requests/{requestId}",
            new
            {
                id = requestId,
                status,
                created_at = createdAt,
                message = "Your request was submitted successfully."
            });
    }


    private static async Task<IResult> GetCurrentWeatherAsync(
        ClaimsPrincipal user, NpgsqlDataSource dataSource, IHttpClientFactory httpClientFactory,
        IMemoryCache cache, long? farmId, CancellationToken ct)
    {
        if (!TryGetUserId(user, out var userId)) return Results.Unauthorized();

        const string sql = """
            select f.farm_id, f.latitude, f.longitude from farm f
            where (f.owner_id=$1 or exists (
              select 1 from farm_member fm where fm.farm_id=f.farm_id and fm.profile_id=$1))
              and ($2::bigint is null or f.farm_id=$2)
            order by case when f.owner_id=$1 then 0 else 1 end, f.farm_id limit 1;
            """;
        await using var connection = await dataSource.OpenConnectionAsync();
        await using var command = new NpgsqlCommand(sql, connection);
        command.Parameters.AddWithValue(userId);
        command.Parameters.AddWithValue(NpgsqlDbType.Bigint, (object?)farmId ?? DBNull.Value);
        await using var reader = await command.ExecuteReaderAsync(ct);
        if (!await reader.ReadAsync()) return Results.NotFound(new { error = "No assigned farm was found." });
        var selectedFarmId = reader.GetInt64(0);
        var latitude = reader.IsDBNull(1) ? (double?)null : Convert.ToDouble(reader.GetValue(1));
        var longitude = reader.IsDBNull(2) ? (double?)null : Convert.ToDouble(reader.GetValue(2));
        await reader.DisposeAsync();

        double? sensorTemperature = null, sensorHumidity = null;
        DateTimeOffset? temperatureAt = null, humidityAt = null;
        await using (var sensors = new NpgsqlCommand("""
            select distinct on (r.sensor_type) r.sensor_type, r.value, r.recorded_at
              from sensor_reading r
              join zone z on z.id = r.zone_id
             where z.farm_id = $1
               and r.sensor_type in ('Temperature', 'Humidity')
               and coalesce(r.simulated, false) = false
             order by r.sensor_type, r.recorded_at desc
            """, connection))
        {
            sensors.Parameters.AddWithValue(selectedFarmId);
            await using var readings = await sensors.ExecuteReaderAsync(ct);
            while (await readings.ReadAsync(ct))
            {
                var type = readings.GetString(0);
                var value = Convert.ToDouble(readings.GetValue(1));
                var at = readings.GetFieldValue<DateTimeOffset>(2);
                if (type == "Temperature") { sensorTemperature = value; temperatureAt = at; }
                else { sensorHumidity = value; humidityAt = at; }
            }
        }

        var providerJson = latitude.HasValue && longitude.HasValue
            ? await GetProviderWeatherAsync(selectedFarmId, latitude.Value, longitude.Value, httpClientFactory, cache, ct)
            : null;
        JsonObject root;
        try { root = providerJson is null ? new JsonObject() : JsonNode.Parse(providerJson)?.AsObject() ?? new JsonObject(); }
        catch (JsonException) { root = new JsonObject(); }

        var current = root["current"] as JsonObject ?? new JsonObject();
        var providerTemperature = Number(current["temperature_2m"]);
        var providerHumidity = Number(current["relative_humidity_2m"]);
        var now = DateTimeOffset.UtcNow;
        var temperature = CurrentWeatherFallback.Select("Temperature", sensorTemperature, temperatureAt, providerTemperature, now);
        var humidity = CurrentWeatherFallback.Select("Humidity", sensorHumidity, humidityAt, providerHumidity, now);

        current["temperature_2m"] = temperature.Value;
        current["temperature_2m_source"] = temperature.SourceCode;
        current["temperature_2m_observed_at"] = temperature.ObservedAt?.ToString("O", CultureInfo.InvariantCulture);
        current["relative_humidity_2m"] = humidity.Value;
        current["relative_humidity_2m_source"] = humidity.SourceCode;
        current["relative_humidity_2m_observed_at"] = humidity.ObservedAt?.ToString("O", CultureInfo.InvariantCulture);
        root["current"] = current;
        root["field_sensor_fallback"] =
            temperature.Source == CurrentWeatherSource.LocalWeather || humidity.Source == CurrentWeatherSource.LocalWeather;
        root["has_weather_coordinates"] = latitude.HasValue && longitude.HasValue;
        return Results.Content(root.ToJsonString(), "application/json");
    }

    private static double? Number(JsonNode? node)
    {
        if (node is not JsonValue value || !value.TryGetValue<double>(out var number) ||
            double.IsNaN(number) || double.IsInfinity(number)) return null;
        return number;
    }

    private static async Task<string?> GetProviderWeatherAsync(
        long farmId, double latitude, double longitude, IHttpClientFactory httpClientFactory,
        IMemoryCache cache, CancellationToken ct)
    {
        var key = new WeatherCacheKey(farmId, latitude, longitude);
        if (cache.TryGetValue<WeatherCacheEntry>(key, out var hit) && hit is not null && hit.ExpiresAt > DateTimeOffset.UtcNow)
            return hit.Json;

        var gate = WeatherCacheLocks.GetOrAdd(key, static _ => new SemaphoreSlim(1, 1));
        await gate.WaitAsync(ct);
        try
        {
            if (cache.TryGetValue<WeatherCacheEntry>(key, out hit) && hit is not null && hit.ExpiresAt > DateTimeOffset.UtcNow)
                return hit.Json;

            var latitudeText = latitude.ToString(CultureInfo.InvariantCulture);
            var longitudeText = longitude.ToString(CultureInfo.InvariantCulture);
            var url =
                $"https://api.open-meteo.com/v1/forecast?latitude={latitudeText}&longitude={longitudeText}" +
                "&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m" +
                "&daily=precipitation_probability_max&timezone=auto&forecast_days=1";
            try
            {
                using var response = await httpClientFactory.CreateClient().GetAsync(url, ct);
                if (!response.IsSuccessStatusCode) return null;
                var json = await response.Content.ReadAsStringAsync(ct);
                cache.Set(key, new WeatherCacheEntry(json, DateTimeOffset.UtcNow.AddMinutes(10)), TimeSpan.FromMinutes(10));
                return json;
            }
            catch (HttpRequestException) { return null; }
            catch (TaskCanceledException) when (!ct.IsCancellationRequested) { return null; }
        }
        finally
        {
            gate.Release();
        }
    }

    private static async Task<IResult> UpdateProfileAsync(
        ProfileUpdateRequest request, ClaimsPrincipal user, NpgsqlDataSource dataSource)
    {
        if (!TryGetUserId(user, out var userId)) return Results.Unauthorized();
        var name = request.Name.Trim();
        if (name.Length == 0) return Results.BadRequest(new { error = "Name is required." });

        await using var connection = await dataSource.OpenConnectionAsync();
        await using var command = new NpgsqlCommand(
            "update profile set name=$1, phone=$2 where id=$3 returning id", connection);
        command.Parameters.AddWithValue(name);
        command.Parameters.AddWithValue(NpgsqlDbType.Text, (object?)request.Phone?.Trim() ?? DBNull.Value);
        command.Parameters.AddWithValue(userId);
        return await command.ExecuteScalarAsync() is null ? Results.NotFound() : Results.NoContent();
    }

    // Settings -> Language. Only the caller's own row; the Telegram messages they get then use
    // it (BotText). Needs migration 0049; before that it says so instead of failing.
    private static async Task<IResult> UpdateLanguageAsync(
        LanguageRequest request, ClaimsPrincipal user, NpgsqlDataSource dataSource, CancellationToken cancellationToken)
    {
        if (!TryGetUserId(user, out var userId)) return Results.Unauthorized();
        var language = request.Language?.Trim().ToLowerInvariant();
        if (language is null || !AgroFlow.Api.Services.Notifications.BotText.Languages.Contains(language))
        {
            return Results.BadRequest(new { error = "Choose English (en), Afrikaans (af) or Setswana (tn)." });
        }

        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using (var check = new NpgsqlCommand(
            "select exists (select 1 from information_schema.columns where table_name = 'profile' and column_name = 'language')",
            connection))
        {
            if (await check.ExecuteScalarAsync(cancellationToken) is not true)
            {
                return Results.Conflict(new { error = "Saving the language needs database migration 0049, which has not been applied yet." });
            }
        }

        await using var command = new NpgsqlCommand(
            "update profile set language = $1 where id = $2 returning id", connection);
        command.Parameters.AddWithValue(language);
        command.Parameters.AddWithValue(userId);
        return await command.ExecuteScalarAsync(cancellationToken) is null ? Results.NotFound() : Results.NoContent();
    }

    // The app calls this right after a farmer sets their own password, which takes
    // them off the forced-change screen.
    // Security: migration 0024 does not let clients update must_change_password, so
    // a farmer cannot skip the change. This endpoint only clears the caller's own flag.
    private static async Task<IResult> ClearMustChangePasswordAsync(
        ClaimsPrincipal user, NpgsqlDataSource dataSource, CancellationToken cancellationToken)
    {
        if (!TryGetUserId(user, out var userId)) return Results.Unauthorized();

        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        // The farmer's own password now: the temporary one's 72-hour clock (0050) stops too.
        await using (var has = new NpgsqlCommand(
            "select exists (select 1 from information_schema.columns where table_name = 'profile' and column_name = 'temp_password_expires_at')",
            connection))
        {
            if (await has.ExecuteScalarAsync(cancellationToken) is true)
            {
                await using var clear = new NpgsqlCommand(
                    "update profile set must_change_password = false, temp_password_expires_at = null where id = $1", connection);
                clear.Parameters.AddWithValue(userId);
                await clear.ExecuteNonQueryAsync(cancellationToken);
                return Results.NoContent();
            }
        }

        await using var command = new NpgsqlCommand(
            "update profile set must_change_password = false where id = $1", connection);
        command.Parameters.AddWithValue(userId);
        await command.ExecuteNonQueryAsync(cancellationToken);

        return Results.NoContent();
    }

    private static bool TryGetUserId(ClaimsPrincipal user, out Guid userId) =>
        Guid.TryParse(user.FindFirstValue("sub"), out userId);

    private static async Task<IResult> GetDashboardAsync(ClaimsPrincipal user, NpgsqlDataSource dataSource, long? farmId)
    {
        if (!TryGetUserId(user, out var userId)) return Results.Unauthorized();

        const string sql = """
            with accessible_farms as (
                select f.* from farm f
                where f.owner_id = $1
                   or exists (select 1 from farm_member fm where fm.farm_id = f.farm_id and fm.profile_id = $1)
            ), selected_farm as (
                select f.* from accessible_farms f
                where $2::bigint is null or f.farm_id = $2
                order by case when f.owner_id = $1 then 0 else 1 end, f.farm_id
                limit 1
            ), selected_zones as (
                select z.*, f.is_simulated from zone z join selected_farm f on f.farm_id = z.farm_id
            )
            select jsonb_build_object(
                'profile', (select to_jsonb(p) from profile p where p.id = $1),
                'farms', coalesce((select jsonb_agg(to_jsonb(f) order by f.farm_id) from accessible_farms f), '[]'::jsonb),
                'farm', (select to_jsonb(f) from selected_farm f),
                'zones', coalesce((select jsonb_agg(to_jsonb(z) order by z.id) from selected_zones z), '[]'::jsonb),
                'readings', coalesce((select jsonb_agg(to_jsonb(r)) from zone_latest_reading r join selected_zones z on z.id = r.zone_id), '[]'::jsonb),
                'events', coalesce((select jsonb_agg(to_jsonb(e) order by e.started_at desc) from irrigation_event e join selected_zones z on z.id = e.zone_id), '[]'::jsonb),
                'usage', coalesce((select jsonb_agg(to_jsonb(u)) from zone_daily_water_usage u join selected_zones z on z.id = u.zone_id), '[]'::jsonb),
                'weather', coalesce((select jsonb_agg(to_jsonb(w) order by w.recorded_at desc) from weather w join selected_farm f on f.farm_id = w.farm_id), '[]'::jsonb),
                -- Today's forecast row (AF-03): the app reads rain from precipitation_mm and says
                -- "Weather unavailable" when this is null or stale, never "Dry".
                'weatherToday', (select jsonb_build_object('date', w.date, 'precipitation_mm', w.precipitation_mm,
                                        'fetched_at', w.fetched_at, 'is_forecast', w.is_forecast)
                                   from weather_daily w join selected_farm f on f.farm_id = w.farm_id
                                  where w.date = (now() at time zone 'Africa/Johannesburg')::date limit 1),
                'alerts', coalesce((select jsonb_agg(to_jsonb(a) order by a.created_at desc)
                                      from alert a join selected_farm f
                                        on a.farm_id = f.farm_id
                                        or exists (select 1 from selected_zones z where z.id = a.zone_id)), '[]'::jsonb)
            )::text;
            """;

        await using var connection = await dataSource.OpenConnectionAsync();
        await using var command = new NpgsqlCommand(sql, connection);
        command.Parameters.AddWithValue(userId);
        command.Parameters.AddWithValue(NpgsqlDbType.Bigint, (object?)farmId ?? DBNull.Value);
        var json = await command.ExecuteScalarAsync() as string;
        return Results.Content(json ?? "{}", "application/json");
    }

    private static async Task<IResult> UpdateZoneSettingsAsync(
        long zoneId, ZoneSettingsRequest request, ClaimsPrincipal user, NpgsqlDataSource dataSource)
    {
        if (!TryGetUserId(user, out var userId)) return Results.Unauthorized();
        if (request.MoistureThreshold is < 0 or > 100 || request.DesiredMoisture is < 0 or > 100 ||
            request.MoistureThreshold.HasValue && request.DesiredMoisture.HasValue && request.MoistureThreshold >= request.DesiredMoisture)
            return Results.BadRequest(new { error = "Moisture threshold must be below desired moisture and both must be from 0 to 100." });
        if (request.IrrigationMode is not null and not ("automatic" or "scheduled" or "manual"))
            return Results.BadRequest(new { error = "Invalid irrigation mode." });

        // A new zone waits for commissioning before the farmer can make it automatic (0058); zones
        // from before the journey (legacy) keep working as they did. Staff can always switch it.
        if (request.IrrigationMode == "automatic" || request.AutomationEnabled == true)
        {
            await using var check = await dataSource.OpenConnectionAsync();
            await using var stateCmd = new NpgsqlCommand(
                "select commission_state from zone where id = $1", check);
            stateCmd.Parameters.AddWithValue(zoneId);
            string? state = null;
            try { state = await stateCmd.ExecuteScalarAsync() as string; }
            catch (PostgresException e) when (e.SqlState == PostgresErrorCodes.UndefinedColumn) { }
            if (state is not null && Commissioning.FarmerMayChooseMode("automatic", state) is { } notYet)
                return Results.Json(new { error = notYet, reason = "not_commissioned" }, statusCode: StatusCodes.Status409Conflict);
        }

        if (request.ScheduleDurationMinutes is < 1 or > 1440)
            return Results.BadRequest(new { error = "A schedule runs for 1 to 1440 minutes." });

        await using var connection = await dataSource.OpenConnectionAsync();
        var maxExpr = await AgroFlow.Api.Services.ZoneRunLimit.ExpressionAsync(connection);
        var sql = $"""
            update zone z set name=coalesce($2, name), location=coalesce($3, location), crop_type=coalesce($4, crop_type),
              irrigation_mode=coalesce($5, irrigation_mode), automation_enabled=coalesce($6, automation_enabled),
              moisture_threshold=coalesce($7, moisture_threshold), desired_moisture=coalesce($8, desired_moisture),
              weather_adjustment=coalesce($9, weather_adjustment), schedule_enabled=coalesce($10, schedule_enabled),
              schedule_days=coalesce($11, schedule_days), schedule_start_time=coalesce($12, schedule_start_time),
              schedule_duration_minutes=coalesce($13, schedule_duration_minutes)
            where z.id=$14 and ({FarmAccessSql}) returning z.id, z.schedule_duration_minutes, {maxExpr};
            """;
        await using var command = new NpgsqlCommand(sql, connection);
        command.Parameters.AddWithValue(userId);
        command.Parameters.AddWithValue(NpgsqlDbType.Text, (object?)request.Name ?? DBNull.Value);
        command.Parameters.AddWithValue(NpgsqlDbType.Text, (object?)request.Location ?? DBNull.Value);
        command.Parameters.AddWithValue(NpgsqlDbType.Text, (object?)request.CropType ?? DBNull.Value);
        command.Parameters.AddWithValue(NpgsqlDbType.Text, (object?)request.IrrigationMode ?? DBNull.Value);
        command.Parameters.AddWithValue(NpgsqlDbType.Boolean, (object?)request.AutomationEnabled ?? DBNull.Value);
        command.Parameters.AddWithValue(NpgsqlDbType.Real, (object?)request.MoistureThreshold ?? DBNull.Value);
        command.Parameters.AddWithValue(NpgsqlDbType.Real, (object?)request.DesiredMoisture ?? DBNull.Value);
        command.Parameters.AddWithValue(NpgsqlDbType.Boolean, (object?)request.WeatherAdjustment ?? DBNull.Value);
        command.Parameters.AddWithValue(NpgsqlDbType.Boolean, (object?)request.ScheduleEnabled ?? DBNull.Value);
        command.Parameters.AddWithValue(NpgsqlDbType.Array | NpgsqlDbType.Text, (object?)request.ScheduleDays ?? DBNull.Value);
        command.Parameters.AddWithValue(NpgsqlDbType.Text, (object?)request.ScheduleStartTime ?? DBNull.Value);
        command.Parameters.AddWithValue(NpgsqlDbType.Integer, (object?)request.ScheduleDurationMinutes ?? DBNull.Value);
        command.Parameters.AddWithValue(zoneId);
        await using var reader = await command.ExecuteReaderAsync();
        if (!await reader.ReadAsync()) return Results.NotFound();
        if (request.ScheduleDurationMinutes is null || reader.IsDBNull(1)) return Results.NoContent();

        // The schedule keeps what the farmer chose; every run of it is capped at the zone's maximum
        // (the 0057 trigger), and the app shows the capped length: "Capped to 5 min (this zone's limit)".
        var scheduled = reader.GetInt32(1);
        var zoneMax = IrrigationRunRules.ZoneMaxOrDefault(reader.IsDBNull(2) ? null : reader.GetInt32(2));
        var effective = IrrigationRunRules.EffectiveScheduleMinutes(scheduled, zoneMax);
        return Results.Ok(new
        {
            scheduleDurationMinutes = scheduled,
            effectiveMinutes = effective,
            maxRunMinutes = zoneMax,
            capped = effective < scheduled,
            capMessage = effective < scheduled ? IrrigationRunRules.CappedMessage(zoneMax) : null,
        });
    }

    // The app's Irrigate button lands here. We only save the command row; a
    // database trigger wakes IrrigationCommandNotifyService, which publishes it
    // to the board over MQTT.
    //
    // A start longer than the zone's maximum run time is CAPPED there, not refused (AF-05): the
    // response says "Capped to 5 min (this zone's limit)". A second start while the first is still
    // unanswered (a double tap, a retry after a lost response) returns the first command, so only
    // one run happens; an advisory lock on the zone makes two at the same instant safe too.
    private static async Task<IResult> CreateManualCommandAsync(
        long zoneId, ManualIrrigationRequest request, ClaimsPrincipal user, NpgsqlDataSource dataSource)
    {
        if (!TryGetUserId(user, out var userId)) return Results.Unauthorized();
        // Never over the kit's 120-minute ceiling; the zone's own maximum caps it below.
        if (IrrigationRunRules.CheckRequest(request.Command, request.DurationSeconds) is { } problem)
            return Results.BadRequest(new { error = problem });

        await using var connection = await dataSource.OpenConnectionAsync();
        await using var tx = await connection.BeginTransactionAsync();
        await using (var zoneLock = new NpgsqlCommand("select pg_advisory_xact_lock(hashtextextended('zone-command:' || $1::text, 0))", connection, tx))
        {
            zoneLock.Parameters.AddWithValue(zoneId.ToString(CultureInfo.InvariantCulture));
            await zoneLock.ExecuteNonQueryAsync();
        }

        var duration = request.DurationSeconds;
        IrrigationRunRules.CapResult? cap = null;

        // A start needs a kit that is listening. Refused now (409) instead of accepted and
        // marked failed 2 hours later. "Heard from" is the same rule as the Kit screen: the
        // newer of hardware.last_seen and the zone's newest reading. A stop is always let through.
        if (request.Command == "start")
        {
            var maxExpr = await AgroFlow.Api.Services.ZoneRunLimit.ExpressionAsync(connection);
            var kitSql = $"""
                select k.device_id is not null,
                       greatest(k.last_seen, coalesce(r.recorded_at, k.last_seen)),
                       {maxExpr}
                  from zone z
                  left join lateral (
                    select h.device_id, h.last_seen from hardware h
                     where h.zone_id = z.id and h.enrollment_status = 'active' and h.device_id is not null
                     order by h.last_seen desc limit 1) k on true
                  left join lateral (
                    select max(x.recorded_at) as recorded_at from sensor_reading x where x.zone_id = z.id) r on true
                 where z.id = $2 and ({FarmAccessSql});
                """;
            await using var kitCommand = new NpgsqlCommand(kitSql, connection, tx);
            kitCommand.Parameters.AddWithValue(userId);
            kitCommand.Parameters.AddWithValue(zoneId);
            await using (var reader = await kitCommand.ExecuteReaderAsync())
            {
                if (!await reader.ReadAsync()) return Results.NotFound();
                var zoneMax = IrrigationRunRules.ZoneMaxOrDefault(reader.IsDBNull(2) ? null : reader.GetInt32(2));
                cap = IrrigationRunRules.Cap(request.DurationSeconds!.Value, zoneMax);
                duration = cap.Seconds;
                var hasKit = reader.GetBoolean(0);
                var lastContact = reader.IsDBNull(1) ? (DateTimeOffset?)null : reader.GetFieldValue<DateTimeOffset>(1);
                var kit = IrrigationRunRules.Kit(hasKit, lastContact, DateTimeOffset.UtcNow);
                if (kit != IrrigationRunRules.KitState.Online)
                {
                    return Results.Json(new
                    {
                        error = kit == IrrigationRunRules.KitState.None
                            ? IrrigationRunRules.NoKitMessage
                            : IrrigationRunRules.KitOfflineMessage,
                        reason = kit == IrrigationRunRules.KitState.None ? "no_kit" : "kit_offline",
                        lastSeen = lastContact,
                    }, statusCode: StatusCodes.Status409Conflict);
                }
            }

            // The same press again: the unanswered start from the last two minutes is the answer.
            await using var pending = new NpgsqlCommand("""
                select c.id from irrigation_commands c
                 where c.zone_id = $1 and c.command = 'start' and c.source = 'manual' and c.status = 'pending'
                   and c.created_at > now() - $2
                 order by c.created_at desc limit 1
                """, connection, tx);
            pending.Parameters.AddWithValue(zoneId);
            pending.Parameters.AddWithValue(IrrigationRunRules.DuplicateStartWindow);
            if (await pending.ExecuteScalarAsync() is Guid existing)
            {
                await tx.CommitAsync();
                return Results.Accepted(value: new
                {
                    id = existing,
                    duplicate = true,
                    message = "Already sent: waiting for the kit to answer the first request.",
                    durationSeconds = duration,
                    capped = cap.Capped,
                    requestedSeconds = cap.RequestedSeconds,
                    maxRunMinutes = cap.ZoneMaxRunMinutes,
                    capMessage = cap.Message,
                });
            }
        }

        // What was asked before the cap is kept with the command (0057) when the column is there.
        var keepsRequest = cap is { Capped: true } && await RequestedColumnAsync(connection, tx);
        var sql = keepsRequest
            ? $"""
              insert into irrigation_commands (zone_id, command, source, duration_seconds, requested_duration_seconds)
              select z.id, $2, 'manual', $3, $5 from zone z
              where z.id=$4 and ({FarmAccessSql}) returning id;
              """
            : $"""
              insert into irrigation_commands (zone_id, command, source, duration_seconds)
              select z.id, $2, 'manual', $3 from zone z
              where z.id=$4 and ({FarmAccessSql}) returning id;
              """;
        await using var command = new NpgsqlCommand(sql, connection, tx);
        command.Parameters.AddWithValue(userId);
        command.Parameters.AddWithValue(request.Command);
        command.Parameters.AddWithValue(NpgsqlDbType.Integer, (object?)duration ?? DBNull.Value);
        command.Parameters.AddWithValue(zoneId);
        if (keepsRequest) command.Parameters.AddWithValue(cap!.RequestedSeconds);
        var id = await command.ExecuteScalarAsync();
        await tx.CommitAsync();

        // No notification: the farmer can see the result in the app. If the pump never
        // confirms the command, DeviceStatusMonitorService raises an equipment failure.
        if (id is null) return Results.NotFound();
        return Results.Accepted(value: new
        {
            id,
            duplicate = false,
            durationSeconds = duration,
            capped = cap?.Capped ?? false,
            requestedSeconds = cap?.RequestedSeconds ?? request.DurationSeconds,
            maxRunMinutes = cap?.ZoneMaxRunMinutes,
            capMessage = cap?.Message,
        });
    }

    private static async Task<bool> RequestedColumnAsync(NpgsqlConnection connection, NpgsqlTransaction tx)
    {
        await using var has = new NpgsqlCommand(
            "select exists (select 1 from information_schema.columns where table_name = 'irrigation_commands' and column_name = 'requested_duration_seconds')",
            connection, tx);
        return await has.ExecuteScalarAsync() is true;
    }
}
