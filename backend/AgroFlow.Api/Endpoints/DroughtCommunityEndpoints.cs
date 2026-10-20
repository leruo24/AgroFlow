using System.Security.Claims;
using System.Text.Json;
using AgroFlow.Api.Auth;
using AgroFlow.Api.Services;
using AgroFlow.Business;
using AgroFlow.Business.Agronomy;
using Npgsql;

namespace AgroFlow.Api.Endpoints;

public sealed record DroughtModeRequest(string? Mode);                 // "on", "off" or "auto"
public sealed record CommunityReportRequest(long FarmId, string? Category, string? Subtype, string? Severity, string? Description);
public sealed record CommunityConfirmRequest(long FarmId);
public sealed record CommunityUpdateRequest(string? Kind, string? Direction, string? Note);
public sealed record HideReportRequest(string? Reason);
public sealed record WaterSourceRequest(string? WaterSource);
public sealed record IrrigationTypeRequest(string? IrrigationType);
public sealed record LocationProblemRequest(string? Note);
public sealed record NotificationPreferenceBody(
    bool WateringTelegram, bool LowTankTelegram, bool DroughtTelegram, bool CommunityTelegram, bool WeatherTelegram,
    bool CommunityOptIn, string? QuietStart, string? QuietEnd);
public sealed record SettingUpdate(string Key, JsonElement Value);
public sealed record SettingsUpdateRequest(IReadOnlyList<SettingUpdate> Settings);
public sealed record FarmLocationRequest(string? Province, string? Town, double? Latitude, double? Longitude);

// Drought mode, community alerts, the wizard's farm settings and the staff side of them
// (docs/drought-community.md). Farmer routes check the caller is the farm's owner or a member
// in the handler itself (SqlGuardTests); staff routes use AdminOnlyFilter.
public static class DroughtCommunityEndpoints
{
    private const string FarmAccessSql = """
        exists (select 1 from farm f where f.farm_id = $2 and (f.owner_id = $1
           or exists (select 1 from farm_member fm where fm.farm_id = f.farm_id and fm.profile_id = $1)))
        """;

    private const string ZoneFarmAccessSql = """
        exists (select 1 from zone z join farm f on f.farm_id = z.farm_id where z.id = $2 and (f.owner_id = $1
           or exists (select 1 from farm_member fm where fm.farm_id = f.farm_id and fm.profile_id = $1)))
        """;

    public static void MapDroughtCommunityEndpoints(this WebApplication app)
    {
        var farmer = app.MapGroup("/api/farmer").RequireAuthorization();
        farmer.MapGet("/farms/{farmId:long}/drought", GetDroughtAsync);
        farmer.MapPut("/farms/{farmId:long}/drought", SetDroughtAsync);
        farmer.MapGet("/farms/{farmId:long}/setup", GetFarmSetupAsync);
        farmer.MapPut("/farms/{farmId:long}/water-source", SetWaterSourceAsync);
        farmer.MapPost("/farms/{farmId:long}/location-problem", ReportLocationProblemAsync);
        farmer.MapPut("/zones/{zoneId:long}/irrigation-type", SetIrrigationTypeAsync);
        farmer.MapGet("/farms/{farmId:long}/community", GetCommunityAsync);
        farmer.MapGet("/community/limit", GetLimitAsync);
        farmer.MapPost("/community/reports", CreateReportAsync);
        farmer.MapPost("/community/reports/{reportId:long}/confirm", ConfirmReportAsync);
        farmer.MapPost("/community/reports/{reportId:long}/updates", UpdateReportAsync);
        farmer.MapGet("/notification-preferences", GetPreferencesAsync);
        farmer.MapPut("/notification-preferences", SetPreferencesAsync);

        var admin = app.MapGroup("/api/admin").RequireAuthorization().AddEndpointFilter<AdminOnlyFilter>();
        admin.MapGet("/settings/drought-community", GetSettingsAsync);
        admin.MapPut("/settings/drought-community", SetSettingsAsync);
        admin.MapGet("/drought-farms", GetDroughtFarmsAsync);
        admin.MapPut("/farms/{farmId:long}/drought", AdminSetDroughtAsync);
        admin.MapPut("/farms/{farmId:long}/location", AdminSetLocationAsync);
        admin.MapGet("/staff-notices", GetStaffNoticesAsync);
        admin.MapPost("/staff-notices/{noticeId:long}/resolve", ResolveStaffNoticeAsync);
        admin.MapGet("/community/reports", AdminReportsAsync);
        admin.MapPost("/community/reports/{reportId:long}/hide", HideReportAsync);
    }

    private static bool TryGetUserId(ClaimsPrincipal user, out Guid userId) =>
        Guid.TryParse(user.FindFirstValue("sub"), out userId);

    private static async Task<bool> CanAccessFarmAsync(NpgsqlConnection c, Guid userId, long farmId, CancellationToken ct)
    {
        await using var cmd = new NpgsqlCommand($"select {FarmAccessSql}", c);
        cmd.Parameters.AddWithValue(userId);
        cmd.Parameters.AddWithValue(farmId);
        return await cmd.ExecuteScalarAsync(ct) is true;
    }

    // ---- Drought (farmer) ----------------------------------------------------------------

    private static async Task<IResult> GetDroughtAsync(long farmId, ClaimsPrincipal user, NpgsqlDataSource dataSource, DroughtEvaluator drought, CancellationToken ct)
    {
        if (!TryGetUserId(user, out var userId)) return Results.Unauthorized();
        await using (var c = await dataSource.OpenConnectionAsync(ct))
            if (!await CanAccessFarmAsync(c, userId, farmId, ct)) return Results.NotFound(new { error = "Farm not found." });
        var view = await drought.EvaluateAsync(farmId, notify: false, ct);
        return view is null ? Results.Json(new { error = "Drought mode is not set up yet (migration 0054)." }, statusCode: 409) : Results.Ok(view);
    }

    private static async Task<IResult> SetDroughtAsync(long farmId, DroughtModeRequest body, ClaimsPrincipal user, NpgsqlDataSource dataSource,
        DroughtEvaluator drought, IAuditWriter audit, CancellationToken ct)
    {
        if (!TryGetUserId(user, out var userId)) return Results.Unauthorized();
        if (body.Mode is not ("on" or "off" or "auto")) return Results.BadRequest(new { error = "Choose on, off or automatic." });
        await using (var c = await dataSource.OpenConnectionAsync(ct))
            if (!await CanAccessFarmAsync(c, userId, farmId, ct)) return Results.NotFound(new { error = "Farm not found." });
        var view = await drought.SetOverrideAsync(farmId, body.Mode == "auto" ? null : body.Mode, userId, staff: false, ct);
        await audit.WriteAsync(user, AuditActions.DroughtModeChanged, "farm", farmId.ToString(), farmId, new { mode = body.Mode }, ct);
        return view is null ? Results.NotFound() : Results.Ok(view);
    }

    // ---- The wizard's farm facts -----------------------------------------------------------

    private static async Task<IResult> GetFarmSetupAsync(long farmId, ClaimsPrincipal user, NpgsqlDataSource dataSource, TankPhController tank, CancellationToken ct)
    {
        if (!TryGetUserId(user, out var userId)) return Results.Unauthorized();
        await using var c = await dataSource.OpenConnectionAsync(ct);
        if (!await CanAccessFarmAsync(c, userId, farmId, ct)) return Results.NotFound(new { error = "Farm not found." });
        var maxExpr = await ZoneRunLimit.ExpressionAsync(c, "z", ct);
        var has0053 = await HasColumnAsync(c, "farm", "province", ct);
        var farmSql = has0053
            ? "select name, location, latitude, longitude, province, town, water_source from farm where farm_id = $1"
            : "select name, location, latitude, longitude, null::text, null::text, null::text from farm where farm_id = $1";
        object? farm = null;
        await using (var cmd = new NpgsqlCommand(farmSql, c))
        {
            cmd.Parameters.AddWithValue(farmId);
            await using var r = await cmd.ExecuteReaderAsync(ct);
            if (await r.ReadAsync(ct))
                farm = new
                {
                    name = r.GetString(0), location = r.IsDBNull(1) ? null : r.GetString(1),
                    latitude = r.IsDBNull(2) ? (double?)null : Convert.ToDouble(r.GetValue(2)),
                    longitude = r.IsDBNull(3) ? (double?)null : Convert.ToDouble(r.GetValue(3)),
                    province = r.IsDBNull(4) ? null : r.GetString(4), town = r.IsDBNull(5) ? null : r.GetString(5),
                    waterSource = r.IsDBNull(6) ? null : r.GetString(6),
                };
        }
        var zones = new List<object>();
        var typeExpr = has0053 ? "z.irrigation_type" : "null::text";
        await using (var cmd = new NpgsqlCommand(
            $"select z.id, coalesce(z.name, 'Zone ' || z.id), z.crop_type, z.planting_date, z.soil_type, z.area_m2, z.flow_rate_lpm, {typeExpr}, {maxExpr} from zone z where z.farm_id = $1 order by z.id", c))
        {
            cmd.Parameters.AddWithValue(farmId);
            await using var r = await cmd.ExecuteReaderAsync(ct);
            while (await r.ReadAsync(ct))
                zones.Add(new
                {
                    zoneId = r.GetInt64(0), name = r.GetString(1), crop = r.IsDBNull(2) ? null : r.GetString(2),
                    plantingDate = r.IsDBNull(3) ? null : r.GetFieldValue<DateOnly>(3).ToString("yyyy-MM-dd"),
                    soilType = r.IsDBNull(4) ? null : r.GetString(4),
                    areaM2 = r.IsDBNull(5) ? (double?)null : Convert.ToDouble(r.GetValue(5)),
                    flowRateLpm = r.IsDBNull(6) ? (double?)null : Convert.ToDouble(r.GetValue(6)),
                    irrigationType = r.IsDBNull(7) ? null : r.GetString(7),
                    maxRunMinutes = IrrigationRunRules.ZoneMaxOrDefault(r.IsDBNull(8) ? null : r.GetInt32(8)),
                });
        }
        var t = tank.GetTank(farmId);
        return Results.Ok(new
        {
            farmId, farm, zones,
            tank = t is null ? null : new { capacityLitres = t.CapacityLitres, estimatedRemainingLitres = t.EstimatedRemainingLitres },
            irrigationTypes = ApplicationEfficiency.Types,
            efficiencySource = ApplicationEfficiency.Source,
        });
    }

    private static async Task<IResult> SetWaterSourceAsync(long farmId, WaterSourceRequest body, ClaimsPrincipal user, NpgsqlDataSource dataSource, CancellationToken ct)
    {
        if (!TryGetUserId(user, out var userId)) return Results.Unauthorized();
        if (body.WaterSource is not ("tank" or "borehole" or "municipal" or "river_dam" or "other"))
            return Results.BadRequest(new { error = "Choose tank, borehole, municipal, river or dam, or other." });
        await using var c = await dataSource.OpenConnectionAsync(ct);
        await using var cmd = new NpgsqlCommand($"update farm set water_source = $3 where farm_id = $2 and {FarmAccessSql}", c);
        cmd.Parameters.AddWithValue(userId);
        cmd.Parameters.AddWithValue(farmId);
        cmd.Parameters.AddWithValue(body.WaterSource);
        return await cmd.ExecuteNonQueryAsync(ct) == 0 ? Results.NotFound(new { error = "Farm not found." }) : Results.Ok(new { message = "Saved." });
    }

    private static async Task<IResult> SetIrrigationTypeAsync(long zoneId, IrrigationTypeRequest body, ClaimsPrincipal user, NpgsqlDataSource dataSource, CancellationToken ct)
    {
        if (!TryGetUserId(user, out var userId)) return Results.Unauthorized();
        if (body.IrrigationType is null || !ApplicationEfficiency.Types.Contains(body.IrrigationType))
            return Results.BadRequest(new { error = "Choose how this zone is watered." });
        await using var c = await dataSource.OpenConnectionAsync(ct);
        await using var cmd = new NpgsqlCommand($"update zone set irrigation_type = $3 where id = $2 and {ZoneFarmAccessSql}", c);
        cmd.Parameters.AddWithValue(userId);
        cmd.Parameters.AddWithValue(zoneId);
        cmd.Parameters.AddWithValue(body.IrrigationType);
        if (await cmd.ExecuteNonQueryAsync(ct) == 0) return Results.NotFound(new { error = "Zone not found." });
        return Results.Ok(new { message = "Saved.", explanation = ApplicationEfficiency.Explain(body.IrrigationType) });
    }

    // "Something's wrong — tell my field officer": a staff notice; the farmer never edits it.
    private static async Task<IResult> ReportLocationProblemAsync(long farmId, LocationProblemRequest body, ClaimsPrincipal user, NpgsqlDataSource dataSource, CancellationToken ct)
    {
        if (!TryGetUserId(user, out var userId)) return Results.Unauthorized();
        if (body.Note is { Length: > 400 }) return Results.BadRequest(new { error = "Keep it under 400 characters." });
        await using var c = await dataSource.OpenConnectionAsync(ct);
        await using var cmd = new NpgsqlCommand(
            $"insert into staff_notice (farm_id, profile_id, kind, message) select $2, $1, 'location_wrong', $3 where {FarmAccessSql} returning id", c);
        cmd.Parameters.AddWithValue(userId);
        cmd.Parameters.AddWithValue(farmId);
        cmd.Parameters.AddWithValue(string.IsNullOrWhiteSpace(body.Note)
            ? "The farmer says the farm's location on the map is wrong."
            : "The farmer says the farm's location on the map is wrong: " + body.Note.Trim());
        var id = await cmd.ExecuteScalarAsync(ct);
        return id is null ? Results.NotFound(new { error = "Farm not found." })
            : Results.Ok(new { message = "Thanks. Your field officer will check your farm's location." });
    }

    // ---- Community (farmer) ------------------------------------------------------------------

    private static async Task<IResult> GetCommunityAsync(long farmId, ClaimsPrincipal user, CommunityService community, NpgsqlDataSource dataSource, CancellationToken ct)
    {
        if (!TryGetUserId(user, out var userId)) return Results.Unauthorized();
        await using (var c = await dataSource.OpenConnectionAsync(ct))
            if (!await CanAccessFarmAsync(c, userId, farmId, ct)) return Results.NotFound(new { error = "Farm not found." });
        var limit = await community.LimitAsync(userId, ct);
        return Results.Ok(new { reports = await community.ForFarmAsync(userId, farmId, ct), limit = new { limit.Allowed, limit.NextAllowedAt, limit.Message }, unverified = CommunityRules.Unverified });
    }

    private static async Task<IResult> GetLimitAsync(ClaimsPrincipal user, CommunityService community, CancellationToken ct)
    {
        if (!TryGetUserId(user, out var userId)) return Results.Unauthorized();
        var l = await community.LimitAsync(userId, ct);
        return Results.Ok(new { l.Allowed, l.NextAllowedAt, l.Message });
    }

    private static async Task<IResult> CreateReportAsync(CommunityReportRequest body, ClaimsPrincipal user, CommunityService community, NpgsqlDataSource dataSource, CancellationToken ct)
    {
        if (!TryGetUserId(user, out var userId)) return Results.Unauthorized();
        await using (var c = await dataSource.OpenConnectionAsync(ct))
            if (!await CanAccessFarmAsync(c, userId, body.FarmId, ct)) return Results.NotFound(new { error = "Farm not found." });
        var r = await community.CreateAsync(userId, body.FarmId, body.Category, body.Subtype, body.Severity, body.Description, ct);
        return Results.Json(r.Body, statusCode: r.Status);
    }

    private static async Task<IResult> ConfirmReportAsync(long reportId, CommunityConfirmRequest body, ClaimsPrincipal user, CommunityService community, NpgsqlDataSource dataSource, CancellationToken ct)
    {
        if (!TryGetUserId(user, out var userId)) return Results.Unauthorized();
        await using (var c = await dataSource.OpenConnectionAsync(ct))
            if (!await CanAccessFarmAsync(c, userId, body.FarmId, ct)) return Results.NotFound(new { error = "Farm not found." });
        var r = await community.ConfirmAsync(userId, reportId, body.FarmId, ct);
        return Results.Json(r.Body, statusCode: r.Status);
    }

    private static async Task<IResult> UpdateReportAsync(long reportId, CommunityUpdateRequest body, ClaimsPrincipal user, CommunityService community, CancellationToken ct)
    {
        if (!TryGetUserId(user, out var userId)) return Results.Unauthorized();
        // Only the reporter or a confirmer may update (checked in CommunityService).
        var r = await community.UpdateAsync(userId, reportId, body.Kind, body.Direction, body.Note, ct);
        return Results.Json(r.Body, statusCode: r.Status);
    }

    // ---- Alert choices ------------------------------------------------------------------------

    private static async Task<IResult> GetPreferencesAsync(ClaimsPrincipal user, NpgsqlDataSource dataSource, CancellationToken ct)
    {
        if (!TryGetUserId(user, out var userId)) return Results.Unauthorized();
        await using var c = await dataSource.OpenConnectionAsync(ct);
        await using var cmd = new NpgsqlCommand(
            "select watering_telegram, low_tank_telegram, drought_telegram, community_telegram, weather_telegram, community_opt_in, quiet_start, quiet_end from notification_preference where profile_id = $1", c);
        cmd.Parameters.AddWithValue(userId);
        await using var r = await cmd.ExecuteReaderAsync(ct);
        if (!await r.ReadAsync(ct))
            return Results.Ok(new NotificationPreferenceBody(true, true, true, true, true, true, null, null));
        string? T(int i) => r.IsDBNull(i) ? null : TimeOnly.FromTimeSpan(r.GetFieldValue<TimeSpan>(i)).ToString("HH:mm");
        return Results.Ok(new NotificationPreferenceBody(r.GetBoolean(0), r.GetBoolean(1), r.GetBoolean(2), r.GetBoolean(3), r.GetBoolean(4), r.GetBoolean(5), T(6), T(7)));
    }

    private static async Task<IResult> SetPreferencesAsync(NotificationPreferenceBody body, ClaimsPrincipal user, NpgsqlDataSource dataSource, CancellationToken ct)
    {
        if (!TryGetUserId(user, out var userId)) return Results.Unauthorized();
        TimeOnly? Parse(string? v) => TimeOnly.TryParse(v, out var t) ? t : null;
        if ((body.QuietStart is not null && Parse(body.QuietStart) is null) || (body.QuietEnd is not null && Parse(body.QuietEnd) is null))
            return Results.BadRequest(new { error = "Use times like 21:00." });
        await using var c = await dataSource.OpenConnectionAsync(ct);
        await using var cmd = new NpgsqlCommand("""
            insert into notification_preference (profile_id, watering_telegram, low_tank_telegram, drought_telegram, community_telegram,
                                                 weather_telegram, community_opt_in, quiet_start, quiet_end, updated_at)
            values ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
            on conflict (profile_id) do update set watering_telegram = $2, low_tank_telegram = $3, drought_telegram = $4,
                community_telegram = $5, weather_telegram = $6, community_opt_in = $7, quiet_start = $8, quiet_end = $9, updated_at = now()
            """, c);
        cmd.Parameters.AddWithValue(userId);
        cmd.Parameters.AddWithValue(body.WateringTelegram);
        cmd.Parameters.AddWithValue(body.LowTankTelegram);
        cmd.Parameters.AddWithValue(body.DroughtTelegram);
        cmd.Parameters.AddWithValue(body.CommunityTelegram);
        cmd.Parameters.AddWithValue(body.WeatherTelegram);
        cmd.Parameters.AddWithValue(body.CommunityOptIn);
        cmd.Parameters.AddWithValue(NpgsqlTypes.NpgsqlDbType.Time, Parse(body.QuietStart) is { } s ? s.ToTimeSpan() : DBNull.Value);
        cmd.Parameters.AddWithValue(NpgsqlTypes.NpgsqlDbType.Time, Parse(body.QuietEnd) is { } e ? e.ToTimeSpan() : DBNull.Value);
        await cmd.ExecuteNonQueryAsync(ct);
        return Results.Ok(new { message = "Saved. In-app alerts always show; these choices are for Telegram." });
    }

    // ---- Staff -----------------------------------------------------------------------------------

    private static async Task<IResult> GetSettingsAsync(AppSettingsStore settings, CancellationToken ct) =>
        Results.Ok(await settings.ListAsync(ct));

    private static async Task<IResult> SetSettingsAsync(SettingsUpdateRequest body, ClaimsPrincipal user, AppSettingsStore settings, IAuditWriter audit, CancellationToken ct)
    {
        if (body.Settings is null || body.Settings.Count == 0) return Results.BadRequest(new { error = "Nothing to save." });
        var known = (await settings.ListAsync(ct)).ToDictionary(r => r.Key);
        foreach (var s in body.Settings)
        {
            if (!known.ContainsKey(s.Key)) return Results.BadRequest(new { error = $"Unknown setting {s.Key}." });
            if (AppSettingsStore.Validate(s.Key, s.Value) is { } problem) return Results.BadRequest(new { error = problem, key = s.Key });
        }
        Guid.TryParse(user.FindFirstValue("sub"), out var by);
        foreach (var s in body.Settings)
        {
            await settings.SetAsync(s.Key, s.Value, by, ct);
            await audit.WriteAsync(user, AuditActions.SettingChanged, "app_setting", s.Key, null,
                new { from = known[s.Key].Value.GetRawText(), to = s.Value.GetRawText() }, ct);
        }
        return Results.Ok(new { message = $"Saved {body.Settings.Count} setting(s).", settings = await settings.ListAsync(ct) });
    }

    private static async Task<IResult> GetDroughtFarmsAsync(NpgsqlDataSource dataSource, CancellationToken ct)
    {
        var list = new List<object>();
        await using var c = await dataSource.OpenConnectionAsync(ct);
        if (!await HasColumnAsync(c, "farm", "drought_active", ct)) return Results.Ok(list);
        await using var cmd = new NpgsqlCommand(
            "select farm_id, name, drought_since, drought_reason, drought_override, coalesce(is_simulated, false) from farm where drought_active order by drought_since desc nulls last", c);
        await using var r = await cmd.ExecuteReaderAsync(ct);
        while (await r.ReadAsync(ct))
            list.Add(new
            {
                farmId = r.GetInt64(0), name = r.GetString(1),
                since = r.IsDBNull(2) ? (DateTimeOffset?)null : r.GetFieldValue<DateTimeOffset>(2),
                reason = r.IsDBNull(3) ? null : r.GetString(3), @override = r.IsDBNull(4) ? null : r.GetString(4), isSimulated = r.GetBoolean(5),
            });
        return Results.Ok(list);
    }

    private static async Task<IResult> AdminSetDroughtAsync(long farmId, DroughtModeRequest body, ClaimsPrincipal user, DroughtEvaluator drought, IAuditWriter audit, CancellationToken ct)
    {
        if (body.Mode is not ("on" or "off" or "auto")) return Results.BadRequest(new { error = "Choose on, off or automatic." });
        Guid.TryParse(user.FindFirstValue("sub"), out var by);
        var view = await drought.SetOverrideAsync(farmId, body.Mode == "auto" ? null : body.Mode, by, staff: true, ct);
        if (view is null) return Results.NotFound(new { error = "No such farm." });
        await audit.WriteAsync(user, AuditActions.DroughtModeChanged, "farm", farmId.ToString(), farmId, new { mode = body.Mode }, ct);
        return Results.Ok(view);
    }

    // Staff set the farm's location (admin onboarding and the farm drawer). It feeds the weather,
    // drought mode and community-alert distances.
    private static async Task<IResult> AdminSetLocationAsync(long farmId, FarmLocationRequest body, ClaimsPrincipal user, NpgsqlDataSource dataSource, IAuditWriter audit, CancellationToken ct)
    {
        if (body.Province is not null && !LocationRules.IsProvince(body.Province)) return Results.BadRequest(new { error = "Choose one of the nine provinces." });
        if (LocationRules.ValidateCoordinates(body.Latitude, body.Longitude) is { } problem) return Results.BadRequest(new { error = problem });
        await using var c = await dataSource.OpenConnectionAsync(ct);
        await using var cmd = new NpgsqlCommand(
            "update farm set province = $2, town = $3, latitude = $4, longitude = $5 where farm_id = $1", c);
        cmd.Parameters.AddWithValue(farmId);
        cmd.Parameters.AddWithValue(NpgsqlTypes.NpgsqlDbType.Text, (object?)body.Province ?? DBNull.Value);
        cmd.Parameters.AddWithValue(NpgsqlTypes.NpgsqlDbType.Text, string.IsNullOrWhiteSpace(body.Town) ? DBNull.Value : body.Town.Trim());
        cmd.Parameters.AddWithValue(body.Latitude!.Value);
        cmd.Parameters.AddWithValue(body.Longitude!.Value);
        if (await cmd.ExecuteNonQueryAsync(ct) == 0) return Results.NotFound(new { error = "No such farm." });
        await audit.WriteAsync(user, AuditActions.FarmLocationChanged, "farm", farmId.ToString(), farmId,
            new { body.Province, body.Town, body.Latitude, body.Longitude }, ct);
        return Results.Ok(new { message = "Location saved. Weather, drought mode and community alerts use it from now on." });
    }

    private static async Task<IResult> GetStaffNoticesAsync(NpgsqlDataSource dataSource, CancellationToken ct)
    {
        var list = new List<object>();
        await using var c = await dataSource.OpenConnectionAsync(ct);
        if (!await FarmerMessenger.TableExistsAsync(c, "staff_notice", ct)) return Results.Ok(list);
        await using var cmd = new NpgsqlCommand(
            "select n.id, n.farm_id, coalesce(f.name, ''), n.kind, n.message, n.created_at, coalesce(p.name, '') from staff_notice n " +
            "left join farm f on f.farm_id = n.farm_id left join profile p on p.id = n.profile_id where n.resolved_at is null order by n.created_at desc", c);
        await using var r = await cmd.ExecuteReaderAsync(ct);
        while (await r.ReadAsync(ct))
            list.Add(new
            {
                id = r.GetInt64(0), farmId = r.IsDBNull(1) ? (long?)null : r.GetInt64(1), farmName = r.GetString(2), kind = r.GetString(3),
                message = r.GetString(4), createdAt = r.GetFieldValue<DateTimeOffset>(5), farmerName = r.GetString(6),
            });
        return Results.Ok(list);
    }

    private static async Task<IResult> ResolveStaffNoticeAsync(long noticeId, ClaimsPrincipal user, NpgsqlDataSource dataSource, IAuditWriter audit, CancellationToken ct)
    {
        Guid.TryParse(user.FindFirstValue("sub"), out var by);
        await using var c = await dataSource.OpenConnectionAsync(ct);
        await using var cmd = new NpgsqlCommand("update staff_notice set resolved_at = now(), resolved_by = $2 where id = $1 and resolved_at is null", c);
        cmd.Parameters.AddWithValue(noticeId);
        cmd.Parameters.AddWithValue(by);
        if (await cmd.ExecuteNonQueryAsync(ct) == 0) return Results.NotFound(new { error = "No such open notice." });
        await audit.WriteAsync(user, AuditActions.StaffNoticeResolved, "staff_notice", noticeId.ToString(), null, null, ct);
        return Results.Ok(new { message = "Closed." });
    }

    private static async Task<IResult> AdminReportsAsync(CommunityService community, CancellationToken ct) =>
        Results.Ok(await community.AdminListAsync(ct));

    private static async Task<IResult> HideReportAsync(long reportId, HideReportRequest body, ClaimsPrincipal user, CommunityService community, CancellationToken ct)
    {
        var r = await community.HideAsync(user, reportId, body.Reason, ct);
        return Results.Json(r.Body, statusCode: r.Status);
    }

    private static async Task<bool> HasColumnAsync(NpgsqlConnection c, string table, string column, CancellationToken ct)
    {
        await using var cmd = new NpgsqlCommand(
            "select exists (select 1 from information_schema.columns where table_name = $1 and column_name = $2)", c);
        cmd.Parameters.AddWithValue(table);
        cmd.Parameters.AddWithValue(column);
        return await cmd.ExecuteScalarAsync(ct) is true;
    }
}
