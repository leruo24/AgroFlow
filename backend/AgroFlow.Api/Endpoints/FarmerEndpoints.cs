using System.Security.Claims;
using System.Globalization;
using AgroFlow.Api.Services.Notifications;
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
        group.MapPost("/password-changed", ClearMustChangePasswordAsync);
        group.MapPut("/zones/{zoneId:long}/settings", UpdateZoneSettingsAsync);
        group.MapPost("/zones/{zoneId:long}/commands", CreateManualCommandAsync);
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

    // Called by the mobile app immediately after a farmer sets their own
    // password, which is what takes them off the forced-change screen.
    //
    // The flag is cleared HERE rather than by the client writing to profile
    // directly: 0024 deliberately does not grant authenticated an UPDATE on
    // must_change_password, precisely so a farmer cannot dismiss the forced
    // change without actually changing anything. This endpoint runs as the
    // table owner and only ever clears the caller's own flag.
    private static async Task<IResult> ClearMustChangePasswordAsync(
        ClaimsPrincipal user, NpgsqlDataSource dataSource, CancellationToken cancellationToken)
    {
        if (!TryGetUserId(user, out var userId)) return Results.Unauthorized();

        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
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
                select z.* from zone z join selected_farm f on f.farm_id = z.farm_id
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
                'alerts', coalesce((select jsonb_agg(to_jsonb(a) order by a.created_at desc) from alert a join selected_zones z on z.id = a.zone_id), '[]'::jsonb)
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

    private static async Task<IResult> CreateManualCommandAsync(
        long zoneId, ManualIrrigationRequest request, ClaimsPrincipal user, NpgsqlDataSource dataSource,
        INotificationService notifications, CancellationToken cancellationToken)
    {
        if (!TryGetUserId(user, out var userId)) return Results.Unauthorized();
        if (request.Command is not ("start" or "stop")) return Results.BadRequest(new { error = "Command must be start or stop." });
        if (request.Command == "start" && request.DurationSeconds is null)
            return Results.BadRequest(new { error = "A start command requires a duration." });
        if (request.DurationSeconds is <= 0 or > 3600) return Results.BadRequest(new { error = "Duration must be between 1 and 3600 seconds." });

        var sql = $"""
            insert into irrigation_commands (zone_id, command, source, duration_seconds)
            select z.id, $2, 'manual', $3 from zone z
            where z.id=$4 and ({FarmAccessSql}) returning id;
            """;
        await using var connection = await dataSource.OpenConnectionAsync();
        await using var command = new NpgsqlCommand(sql, connection);
        command.Parameters.AddWithValue(userId);
        command.Parameters.AddWithValue(request.Command);
        command.Parameters.AddWithValue(NpgsqlDbType.Integer, (object?)request.DurationSeconds ?? DBNull.Value);
        command.Parameters.AddWithValue(zoneId);
        var id = await command.ExecuteScalarAsync();
        if (id is null) return Results.NotFound();

        // Everyone on the farm hears about it, including whoever pressed the
        // button - on a farm with several members, "who started the pump" is
        // exactly the thing the others need to know. Never throws, so a
        // Telegram problem cannot turn an accepted command into an error.
        await notifications.NotifyIrrigationAsync(zoneId, request.Command, "manual", cancellationToken);

        return Results.Accepted(value: new { id });
    }
}
