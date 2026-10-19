using System.Security.Claims;
using AgroFlow.Business;
using System.Globalization;
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
    string? Notes);

public static class FarmerEndpoints
{
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
        group.MapPost("/zones/{zoneId:long}/commands", CreateManualCommandAsync);
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
            (object?)request.RoughSize ?? DBNull.Value);

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

        // Close the reader before the notifier opens its own connection. The insert
        // above has already committed, so we never send a message about a request
        // that was rolled back.
        await reader.CloseAsync();

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
        ClaimsPrincipal user, NpgsqlDataSource dataSource, IHttpClientFactory httpClientFactory, long? farmId)
    {
        if (!TryGetUserId(user, out var userId)) return Results.Unauthorized();

        const string sql = """
            select f.latitude, f.longitude from farm f
            where (f.owner_id=$1 or exists (
              select 1 from farm_member fm where fm.farm_id=f.farm_id and fm.profile_id=$1))
              and ($2::bigint is null or f.farm_id=$2)
            order by case when f.owner_id=$1 then 0 else 1 end, f.farm_id limit 1;
            """;
        await using var connection = await dataSource.OpenConnectionAsync();
        await using var command = new NpgsqlCommand(sql, connection);
        command.Parameters.AddWithValue(userId);
        command.Parameters.AddWithValue(NpgsqlDbType.Bigint, (object?)farmId ?? DBNull.Value);
        await using var reader = await command.ExecuteReaderAsync();
        if (!await reader.ReadAsync()) return Results.NotFound(new { error = "No assigned farm was found." });
        if (reader.IsDBNull(0) || reader.IsDBNull(1))
            return Results.BadRequest(new { error = "The assigned farm does not have weather coordinates." });

        var latitude = Convert.ToDouble(reader.GetValue(0));
        var longitude = Convert.ToDouble(reader.GetValue(1));
        var latitudeText = latitude.ToString(CultureInfo.InvariantCulture);
        var longitudeText = longitude.ToString(CultureInfo.InvariantCulture);
        var url =
            $"https://api.open-meteo.com/v1/forecast?latitude={latitudeText}&longitude={longitudeText}" +
            "&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m" +
            "&daily=precipitation_probability_max&timezone=auto&forecast_days=1";
        var client = httpClientFactory.CreateClient();
        using var response = await client.GetAsync(url);
        if (!response.IsSuccessStatusCode)
            return Results.Json(new { error = "Weather provider request failed." }, statusCode: StatusCodes.Status502BadGateway);
        return Results.Content(await response.Content.ReadAsStringAsync(), "application/json");
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

        var sql = $"""
            update zone z set name=coalesce($2, name), location=coalesce($3, location), crop_type=coalesce($4, crop_type),
              irrigation_mode=coalesce($5, irrigation_mode), automation_enabled=coalesce($6, automation_enabled),
              moisture_threshold=coalesce($7, moisture_threshold), desired_moisture=coalesce($8, desired_moisture),
              weather_adjustment=coalesce($9, weather_adjustment), schedule_enabled=coalesce($10, schedule_enabled),
              schedule_days=coalesce($11, schedule_days), schedule_start_time=coalesce($12, schedule_start_time),
              schedule_duration_minutes=coalesce($13, schedule_duration_minutes)
            where z.id=$14 and ({FarmAccessSql}) returning z.id;
            """;
        await using var connection = await dataSource.OpenConnectionAsync();
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
        return await command.ExecuteScalarAsync() is null ? Results.NotFound() : Results.NoContent();
    }

    // The app's Irrigate button lands here. We only save the command row; a
    // database trigger wakes IrrigationCommandNotifyService, which publishes it
    // to the board over MQTT.
    private static async Task<IResult> CreateManualCommandAsync(
        long zoneId, ManualIrrigationRequest request, ClaimsPrincipal user, NpgsqlDataSource dataSource)
    {
        if (!TryGetUserId(user, out var userId)) return Results.Unauthorized();
        // At most 300 s, the kit's own cap (IrrigationRunRules).
        if (IrrigationRunRules.CheckRequest(request.Command, request.DurationSeconds) is { } problem)
            return Results.BadRequest(new { error = problem });

        await using var connection = await dataSource.OpenConnectionAsync();

        // A start needs a kit that is listening. Refused now (409) instead of accepted and
        // marked failed 2 hours later. "Heard from" is the same rule as the Kit screen: the
        // newer of hardware.last_seen and the zone's newest reading. A stop is always let through.
        if (request.Command == "start")
        {
            var kitSql = $"""
                select k.device_id is not null,
                       greatest(k.last_seen, coalesce(r.recorded_at, k.last_seen))
                  from zone z
                  left join lateral (
                    select h.device_id, h.last_seen from hardware h
                     where h.zone_id = z.id and h.enrollment_status = 'active' and h.device_id is not null
                     order by h.last_seen desc limit 1) k on true
                  left join lateral (
                    select max(x.recorded_at) as recorded_at from sensor_reading x where x.zone_id = z.id) r on true
                 where z.id = $2 and ({FarmAccessSql});
                """;
            await using var kitCommand = new NpgsqlCommand(kitSql, connection);
            kitCommand.Parameters.AddWithValue(userId);
            kitCommand.Parameters.AddWithValue(zoneId);
            await using (var reader = await kitCommand.ExecuteReaderAsync())
            {
                if (!await reader.ReadAsync()) return Results.NotFound();
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
        }

        var sql = $"""
            insert into irrigation_commands (zone_id, command, source, duration_seconds)
            select z.id, $2, 'manual', $3 from zone z
            where z.id=$4 and ({FarmAccessSql}) returning id;
            """;
        await using var command = new NpgsqlCommand(sql, connection);
        command.Parameters.AddWithValue(userId);
        command.Parameters.AddWithValue(request.Command);
        command.Parameters.AddWithValue(NpgsqlDbType.Integer, (object?)request.DurationSeconds ?? DBNull.Value);
        command.Parameters.AddWithValue(zoneId);
        var id = await command.ExecuteScalarAsync();

        // No notification: the farmer can see the result in the app. If the pump never
        // confirms the command, DeviceStatusMonitorService raises an equipment failure.
        return id is null ? Results.NotFound() : Results.Accepted(value: new { id });
    }
}
