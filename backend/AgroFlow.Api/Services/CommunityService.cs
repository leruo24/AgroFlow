using System.Globalization;
using System.Security.Claims;
using System.Text.Json;
using AgroFlow.Api.Auth;
using AgroFlow.Business;
using Npgsql;

namespace AgroFlow.Api.Services;

// Current wind at a point: where it blows FROM (degrees, meteorological) and its speed.
public interface IWindProvider
{
    Task<(double FromDeg, double SpeedKmh)?> CurrentAsync(double latitude, double longitude, CancellationToken ct);
}

// Open-Meteo's current conditions (no key; same provider as the farm forecasts).
public sealed class OpenMeteoWind : IWindProvider
{
    private readonly IHttpClientFactory _clients;
    private readonly ILogger<OpenMeteoWind> _logger;
    public OpenMeteoWind(IHttpClientFactory clients, ILogger<OpenMeteoWind> logger) { _clients = clients; _logger = logger; }

    public async Task<(double FromDeg, double SpeedKmh)?> CurrentAsync(double latitude, double longitude, CancellationToken ct)
    {
        try
        {
            var inv = CultureInfo.InvariantCulture;
            var url = "https://api.open-meteo.com/v1/forecast?latitude=" + latitude.ToString(inv) + "&longitude=" + longitude.ToString(inv) +
                      "&current=wind_speed_10m,wind_direction_10m&wind_speed_unit=kmh";
            using var response = await _clients.CreateClient().GetAsync(url, ct);
            if (!response.IsSuccessStatusCode) return null;
            using var json = await JsonDocument.ParseAsync(await response.Content.ReadAsStreamAsync(ct), cancellationToken: ct);
            var cur = json.RootElement.GetProperty("current");
            return (cur.GetProperty("wind_direction_10m").GetDouble(), cur.GetProperty("wind_speed_10m").GetDouble());
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _logger.LogWarning(ex, "Could not read the wind for a fire report; farms within the radius are still told.");
            return null;
        }
    }
}

public sealed record CommunityResult(int Status, object Body);

public sealed record NearbyReport(
    long ReportId, string Category, string Subtype, string Label, string Severity, string Message, double DistanceKm,
    bool Downwind, int SimilarFarms, int Confirmations, string? FireState, DateTimeOffset CreatedAt, DateTimeOffset ExpiresAt,
    bool Mine, bool Confirmed, bool CanUpdate, IReadOnlyList<string> Updates);

// Community alerts end to end (docs/drought-community.md, Part 2).
public sealed class CommunityService
{
    private readonly NpgsqlDataSource _dataSource;
    private readonly AppSettingsStore _settings;
    private readonly IWindProvider _wind;
    private readonly FarmerMessenger _messenger;
    private readonly IAuditWriter _audit;
    private readonly ILogger<CommunityService> _logger;
    private readonly Func<DateTimeOffset> _now;

    public CommunityService(NpgsqlDataSource dataSource, AppSettingsStore settings, IWindProvider wind, FarmerMessenger messenger,
        IAuditWriter audit, ILogger<CommunityService> logger, Func<DateTimeOffset>? now = null)
    {
        _dataSource = dataSource;
        _settings = settings;
        _wind = wind;
        _messenger = messenger;
        _audit = audit;
        _logger = logger;
        _now = now ?? (() => DateTimeOffset.UtcNow);
    }

    private static readonly TimeSpan Sast = TimeSpan.FromHours(2);

    // ---- The report limit ---------------------------------------------------------------

    public async Task<(bool Allowed, DateTimeOffset? NextAllowedAt, string Message)> LimitAsync(Guid profileId, CancellationToken ct)
    {
        var s = await _settings.CommunityAsync(ct);
        var times = new List<DateTimeOffset>();
        await using var connection = await _dataSource.OpenConnectionAsync(ct);
        await using var cmd = new NpgsqlCommand(
            "select created_at from community_report where reporter_profile_id = $1 and created_at > $2", connection);
        cmd.Parameters.AddWithValue(profileId);
        cmd.Parameters.AddWithValue(_now() - TimeSpan.FromHours(s.ReportWindowHours));
        await using var r = await cmd.ExecuteReaderAsync(ct);
        while (await r.ReadAsync(ct)) times.Add(r.GetFieldValue<DateTimeOffset>(0));
        var next = CommunityRules.NextAllowedAt(times, _now(), s);
        return (next is null, next, CommunityRules.LimitMessage(next, s, Sast));
    }

    // ---- New report ---------------------------------------------------------------------

    public async Task<CommunityResult> CreateAsync(Guid profileId, long farmId, string? category, string? subtype,
        string? severity, string? description, CancellationToken ct)
    {
        if (CommunityCategories.Validate(category, subtype, severity, description) is { } problem)
            return new(400, new { error = problem });
        var s = await _settings.CommunityAsync(ct);

        await using var connection = await _dataSource.OpenConnectionAsync(ct);
        if (await StaffTelegram.IsStaffAsync(connection, profileId, ct))
            return new(403, new { error = "Community reports are made by farmers in the AgroFlow app. Staff see and moderate them in the admin site." });

        // The farm's saved location (set by staff). Farmers never pick a point.
        double? lat = null, lon = null;
        await using (var cmd = new NpgsqlCommand(
            "select f.latitude, f.longitude from farm f where f.farm_id = $2 and (f.owner_id = $1 or exists " +
            "(select 1 from farm_member fm where fm.farm_id = f.farm_id and fm.profile_id = $1))", connection))
        {
            cmd.Parameters.AddWithValue(profileId);
            cmd.Parameters.AddWithValue(farmId);
            await using var r = await cmd.ExecuteReaderAsync(ct);
            if (!await r.ReadAsync(ct)) return new(404, new { error = "Farm not found." });
            lat = r.IsDBNull(0) ? null : Convert.ToDouble(r.GetValue(0));
            lon = r.IsDBNull(1) ? null : Convert.ToDouble(r.GetValue(1));
        }
        if (LocationRules.ValidateCoordinates(lat, lon) is not null)
            return new(409, new { error = "Your farm has no location saved yet, so nearby farms cannot be found. Ask your field officer to set it." });

        var limit = await LimitAsync(profileId, ct);
        if (!limit.Allowed)
            return new(429, new { error = limit.Message, nextAllowedAt = limit.NextAllowedAt });

        var now = _now();
        var rlat = CommunityRules.Round(lat!.Value);
        var rlon = CommunityRules.Round(lon!.Value);
        var radius = CommunityRules.RadiusFor(category!, false, s);
        (double FromDeg, double SpeedKmh)? wind = category == "fire" ? await _wind.CurrentAsync(rlat, rlon, ct) : null;

        long id;
        await using (var cmd = new NpgsqlCommand(
            "insert into community_report (reporter_profile_id, farm_id, category, subtype, severity, description, latitude_rounded, longitude_rounded, " +
            "location_source, radius_km, fire_state, wind_from_deg, wind_speed_kmh, expires_at, created_at, updated_at) " +
            "values ($1, $2, $3, $4, $5, $6, $7, $8, 'farm', $9, $10, $11, $12, $13, $14, $14) returning id", connection))
        {
            cmd.Parameters.AddWithValue(profileId);
            cmd.Parameters.AddWithValue(farmId);
            cmd.Parameters.AddWithValue(category!);
            cmd.Parameters.AddWithValue(subtype!);
            cmd.Parameters.AddWithValue(severity!);
            cmd.Parameters.AddWithValue(NpgsqlTypes.NpgsqlDbType.Text, string.IsNullOrWhiteSpace(description) ? DBNull.Value : description.Trim());
            cmd.Parameters.AddWithValue((decimal)rlat);
            cmd.Parameters.AddWithValue((decimal)rlon);
            cmd.Parameters.AddWithValue((decimal)radius);
            cmd.Parameters.AddWithValue(NpgsqlTypes.NpgsqlDbType.Text, category == "fire" ? "burning" : DBNull.Value);
            cmd.Parameters.AddWithValue(NpgsqlTypes.NpgsqlDbType.Numeric, wind is { } w1 ? (decimal)Math.Round(w1.FromDeg, 1) : DBNull.Value);
            cmd.Parameters.AddWithValue(NpgsqlTypes.NpgsqlDbType.Numeric, wind is { } w2 ? (decimal)Math.Round(w2.SpeedKmh, 1) : DBNull.Value);
            cmd.Parameters.AddWithValue(CommunityRules.ExpiresAt(category!, now, s));
            cmd.Parameters.AddWithValue(now);
            id = (long)(await cmd.ExecuteScalarAsync(ct))!;
        }

        var told = await NotifyAsync(connection, id, "report", null, onlyNew: false, s, ct);
        var after = await LimitAsync(profileId, ct);
        return new(201, new { id, notifiedFarms = told, limit = after.Message, nextAllowedAt = after.NextAllowedAt });
    }

    // ---- "I'm seeing this too" ----------------------------------------------------------

    public async Task<CommunityResult> ConfirmAsync(Guid profileId, long reportId, long farmId, CancellationToken ct)
    {
        var s = await _settings.CommunityAsync(ct);
        await using var connection = await _dataSource.OpenConnectionAsync(ct);
        var report = await LoadAsync(connection, reportId, ct);
        if (report is null || report.Status != "active") return new(404, new { error = "That report is no longer active." });
        if (report.Reporter == profileId) return new(409, new { error = "You made this report. Use an update instead." });
        if (!await IsMemberAsync(connection, profileId, farmId, ct)) return new(404, new { error = "Farm not found." });

        await using (var cmd = new NpgsqlCommand(
            "insert into community_report_confirmation (report_id, profile_id, farm_id) values ($1, $2, $3) on conflict do nothing", connection))
        {
            cmd.Parameters.AddWithValue(reportId);
            cmd.Parameters.AddWithValue(profileId);
            cmd.Parameters.AddWithValue(farmId);
            if (await cmd.ExecuteNonQueryAsync(ct) == 0) return new(409, new { error = "You have already confirmed this report." });
        }
        var confirmations = await ConfirmationsAsync(connection, reportId, ct);

        // A fire confirmed by enough farms reaches further.
        if (report.Category == "fire" && !report.Escalated && CommunityRules.Escalates(confirmations, s))
        {
            await using (var cmd = new NpgsqlCommand(
                "update community_report set escalated = true, radius_km = $2, updated_at = now() where id = $1", connection))
            {
                cmd.Parameters.AddWithValue(reportId);
                cmd.Parameters.AddWithValue((decimal)CommunityRules.RadiusFor("fire", true, s));
                await cmd.ExecuteNonQueryAsync(ct);
            }
            await NotifyAsync(connection, reportId, "escalation", null, onlyNew: true, s, ct);
        }
        return new(200, new { confirmations, message = $"{confirmations + 1} nearby farms have reported similar activity. {CommunityRules.Unverified}" });
    }

    // ---- Updates (fires: still burning, spreading, under control, out) ---------------------

    public async Task<CommunityResult> UpdateAsync(Guid profileId, long reportId, string? kind, string? direction, string? note, CancellationToken ct)
    {
        var s = await _settings.CommunityAsync(ct);
        if (kind is not ("still_burning" or "spreading" or "under_control" or "out" or "note"))
            return new(400, new { error = "Choose an update." });
        // The words ("north-east"), or the compass codes older app builds send ("NE").
        if (direction is not null)
        {
            var word = CommunityRules.NormaliseDirection(direction);
            if (word is null) return new(400, new { error = "Choose a direction." });
            direction = word;
        }
        if (note is { Length: > 280 }) return new(400, new { error = "Keep the note under 280 characters." });

        await using var connection = await _dataSource.OpenConnectionAsync(ct);
        var report = await LoadAsync(connection, reportId, ct);
        if (report is null || report.Status != "active") return new(404, new { error = "That report is no longer active." });
        if (kind != "note" && report.Category != "fire") return new(400, new { error = "Only fire reports have these updates." });
        var allowed = report.Reporter == profileId;
        if (!allowed)
        {
            await using var cmd = new NpgsqlCommand("select exists (select 1 from community_report_confirmation where report_id = $1 and profile_id = $2)", connection);
            cmd.Parameters.AddWithValue(reportId);
            cmd.Parameters.AddWithValue(profileId);
            allowed = await cmd.ExecuteScalarAsync(ct) is true;
        }
        if (!allowed) return new(403, new { error = "Only the farmer who reported it, or a farmer who confirmed it, can post updates." });

        // Each fire update re-checks the wind, so newly downwind farms are told too.
        (double FromDeg, double SpeedKmh)? wind = report.Category == "fire" ? await _wind.CurrentAsync(report.Lat, report.Lon, ct) : null;
        long updateId;
        await using (var cmd = new NpgsqlCommand(
            "insert into community_report_update (report_id, profile_id, kind, direction, note, wind_from_deg, wind_speed_kmh) values ($1, $2, $3, $4, $5, $6, $7) returning id", connection))
        {
            cmd.Parameters.AddWithValue(reportId);
            cmd.Parameters.AddWithValue(profileId);
            cmd.Parameters.AddWithValue(kind);
            cmd.Parameters.AddWithValue(NpgsqlTypes.NpgsqlDbType.Text, (object?)direction ?? DBNull.Value);
            cmd.Parameters.AddWithValue(NpgsqlTypes.NpgsqlDbType.Text, string.IsNullOrWhiteSpace(note) ? DBNull.Value : note.Trim());
            cmd.Parameters.AddWithValue(NpgsqlTypes.NpgsqlDbType.Numeric, wind is { } a ? (decimal)Math.Round(a.FromDeg, 1) : DBNull.Value);
            cmd.Parameters.AddWithValue(NpgsqlTypes.NpgsqlDbType.Numeric, wind is { } b ? (decimal)Math.Round(b.SpeedKmh, 1) : DBNull.Value);
            updateId = (long)(await cmd.ExecuteScalarAsync(ct))!;
        }
        if (report.Category == "fire")
        {
            var state = kind switch { "spreading" => "spreading", "under_control" => "under_control", "out" => "out", "still_burning" => "burning", _ => null };
            await using var cmd = new NpgsqlCommand(
                "update community_report set fire_state = coalesce($2, fire_state), wind_from_deg = coalesce($3, wind_from_deg), " +
                "wind_speed_kmh = coalesce($4, wind_speed_kmh), status = case when $2 = 'out' then 'closed' else status end, updated_at = now() where id = $1", connection);
            cmd.Parameters.AddWithValue(reportId);
            cmd.Parameters.AddWithValue(NpgsqlTypes.NpgsqlDbType.Text, (object?)state ?? DBNull.Value);
            cmd.Parameters.AddWithValue(NpgsqlTypes.NpgsqlDbType.Numeric, wind is { } a ? (decimal)Math.Round(a.FromDeg, 1) : DBNull.Value);
            cmd.Parameters.AddWithValue(NpgsqlTypes.NpgsqlDbType.Numeric, wind is { } b ? (decimal)Math.Round(b.SpeedKmh, 1) : DBNull.Value);
            await cmd.ExecuteNonQueryAsync(ct);
        }
        var told = await NotifyAsync(connection, reportId, "update", updateId, onlyNew: false, s, ct, updateKind: kind, direction: direction, includeClosed: kind == "out");
        return new(200, new { notifiedFarms = told, closed = kind == "out" });
    }

    // ---- Staff moderation ---------------------------------------------------------------

    public async Task<CommunityResult> HideAsync(ClaimsPrincipal staff, long reportId, string? reason, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(reason) || reason.Length > 300) return new(400, new { error = "Say why it is hidden (up to 300 characters)." });
        Guid.TryParse(staff.FindFirstValue("sub"), out var by);
        await using var connection = await _dataSource.OpenConnectionAsync(ct);
        await using (var cmd = new NpgsqlCommand(
            "update community_report set status = 'hidden', hidden_reason = $2, hidden_by = $3, hidden_at = now(), updated_at = now() where id = $1 and status <> 'hidden'", connection))
        {
            cmd.Parameters.AddWithValue(reportId);
            cmd.Parameters.AddWithValue(reason.Trim());
            cmd.Parameters.AddWithValue(by);
            if (await cmd.ExecuteNonQueryAsync(ct) == 0) return new(404, new { error = "No such report, or it is already hidden." });
        }
        await _audit.WriteAsync(staff, AuditActions.CommunityReportHidden, "community_report", reportId.ToString(), null, new { reason = reason.Trim() }, ct);
        return new(200, new { message = "Hidden. Nobody else is told about it." });
    }

    public async Task<int> ExpireAsync(CancellationToken ct)
    {
        await using var connection = await _dataSource.OpenConnectionAsync(ct);
        await using var cmd = new NpgsqlCommand(
            "update community_report set status = 'expired', updated_at = now() where status = 'active' and expires_at <= $1", connection);
        cmd.Parameters.AddWithValue(_now());
        return await cmd.ExecuteNonQueryAsync(ct);
    }

    public async Task<IReadOnlyList<object>> AdminListAsync(CancellationToken ct)
    {
        var list = new List<object>();
        await using var connection = await _dataSource.OpenConnectionAsync(ct);
        await using var cmd = new NpgsqlCommand("""
            select r.id, r.category, r.subtype, r.severity, r.description, r.latitude_rounded, r.longitude_rounded, r.radius_km,
                   r.status, r.fire_state, r.escalated, r.created_at, r.expires_at, r.hidden_reason,
                   coalesce(p.name, ''), coalesce(p.email, ''), coalesce(f.name, ''),
                   (select count(*) from community_report_confirmation c where c.report_id = r.id),
                   (select count(*) from community_notification n where n.report_id = r.id),
                   (select count(*) from community_report x where x.reporter_profile_id = r.reporter_profile_id and x.status = 'hidden'),
                   (select count(*) from community_report x where x.reporter_profile_id = r.reporter_profile_id)
              from community_report r
              left join profile p on p.id = r.reporter_profile_id
              left join farm f on f.farm_id = r.farm_id
             order by r.created_at desc limit 300
            """, connection);
        await using var r = await cmd.ExecuteReaderAsync(ct);
        while (await r.ReadAsync(ct))
        {
            list.Add(new
            {
                id = r.GetInt64(0), category = r.GetString(1), subtype = r.GetString(2), label = CommunityCategories.Label(r.GetString(2)),
                severity = r.GetString(3), description = r.IsDBNull(4) ? null : r.GetString(4),
                latitude = Convert.ToDouble(r.GetValue(5)), longitude = Convert.ToDouble(r.GetValue(6)), radiusKm = Convert.ToDouble(r.GetValue(7)),
                status = r.GetString(8), fireState = r.IsDBNull(9) ? null : r.GetString(9), escalated = r.GetBoolean(10),
                createdAt = r.GetFieldValue<DateTimeOffset>(11), expiresAt = r.GetFieldValue<DateTimeOffset>(12),
                hiddenReason = r.IsDBNull(13) ? null : r.GetString(13),
                reporterName = r.GetString(14), reporterEmail = r.GetString(15), farmName = r.GetString(16),
                confirmations = r.GetInt64(17), notifiedFarms = r.GetInt64(18),
                reporterHiddenCount = r.GetInt64(19), reporterTotal = r.GetInt64(20),
            });
        }
        return list;
    }

    // ---- What reached a farm --------------------------------------------------------------

    public async Task<IReadOnlyList<NearbyReport>> ForFarmAsync(Guid profileId, long farmId, CancellationToken ct)
    {
        var list = new List<NearbyReport>();
        await using var connection = await _dataSource.OpenConnectionAsync(ct);
        if (!await IsMemberAsync(connection, profileId, farmId, ct)) return list;
        var s = await _settings.CommunityAsync(ct);
        await using var cmd = new NpgsqlCommand("""
            with mine_or_told as (
              select r.id, n.message, n.distance_km, n.priority = 'downwind' as downwind
                from community_report r
                join lateral (select message, distance_km, priority from community_notification n
                               where n.report_id = r.id and n.farm_id = $2 order by n.created_at desc limit 1) n on true
               where r.status = 'active'
              union all
              select r.id, null, 0, false from community_report r
               where r.status = 'active' and r.reporter_profile_id = $1 and r.farm_id = $2
                 and not exists (select 1 from community_notification n where n.report_id = r.id and n.farm_id = $2))
            select r.id, r.category, r.subtype, r.severity, m.message, m.distance_km, m.downwind, r.fire_state, r.created_at, r.expires_at,
                   r.reporter_profile_id = $1,
                   exists (select 1 from community_report_confirmation c where c.report_id = r.id and c.profile_id = $1),
                   (select count(*) from community_report_confirmation c where c.report_id = r.id),
                   r.latitude_rounded, r.longitude_rounded, r.description
              from mine_or_told m join community_report r on r.id = m.id
             order by m.downwind desc, r.created_at desc
            """, connection);
        cmd.Parameters.AddWithValue(profileId);
        cmd.Parameters.AddWithValue(farmId);
        var rows = new List<(long Id, string Cat, string Sub, string Sev, string? Msg, double Dist, bool Down, string? Fire, DateTimeOffset At, DateTimeOffset Exp, bool Mine, bool Conf, long Count, double Lat, double Lon, string? Desc)>();
        await using (var r = await cmd.ExecuteReaderAsync(ct))
            while (await r.ReadAsync(ct))
                rows.Add((r.GetInt64(0), r.GetString(1), r.GetString(2), r.GetString(3), r.IsDBNull(4) ? null : r.GetString(4),
                    Convert.ToDouble(r.GetValue(5)), r.GetBoolean(6), r.IsDBNull(7) ? null : r.GetString(7),
                    r.GetFieldValue<DateTimeOffset>(8), r.GetFieldValue<DateTimeOffset>(9), r.GetBoolean(10), r.GetBoolean(11),
                    r.GetInt64(12), Convert.ToDouble(r.GetValue(13)), Convert.ToDouble(r.GetValue(14)), r.IsDBNull(15) ? null : r.GetString(15)));
        foreach (var x in rows)
        {
            var similar = await SimilarFarmsAsync(connection, x.Id, x.Cat, x.Lat, x.Lon, x.At, s, ct);
            var updates = new List<string>();
            await using (var u = new NpgsqlCommand("select kind, direction, created_at from community_report_update where report_id = $1 order by created_at", connection))
            {
                u.Parameters.AddWithValue(x.Id);
                await using var ur = await u.ExecuteReaderAsync(ct);
                while (await ur.ReadAsync(ct))
                    updates.Add(UpdateLine(ur.GetString(0), ur.IsDBNull(1) ? null : ur.GetString(1), ur.GetFieldValue<DateTimeOffset>(2)));
            }
            var message = x.Msg ?? (x.Mine ? $"Your report: {CommunityCategories.Label(x.Sub)}, {CommunityMessages.Severity(x.Sev).ToLowerInvariant()}. {CommunityRules.Unverified}" : "");
            list.Add(new NearbyReport(x.Id, x.Cat, x.Sub, CommunityCategories.Label(x.Sub), x.Sev, message, x.Dist, x.Down, similar,
                (int)x.Count, x.Fire, x.At, x.Exp, x.Mine, x.Conf, x.Mine || x.Conf, updates));
        }
        return list;
    }

    private static string UpdateLine(string kind, string? direction, DateTimeOffset at)
    {
        var when = at.ToOffset(Sast).ToString("ddd HH:mm", CultureInfo.InvariantCulture);
        var what = kind switch
        {
            "still_burning" => "Still burning",
            "spreading" => direction is null ? "Spreading" : $"Spreading towards the {direction}",
            "under_control" => "Under control",
            "out" => "Out",
            _ => "Update",
        };
        return $"{when}: {what}";
    }

    // ---- Notify ---------------------------------------------------------------------------

    private sealed record ReportRow(long Id, Guid Reporter, long? FarmId, string Category, string Subtype, string Severity, string? Description,
        double Lat, double Lon, string Status, bool Escalated, double? WindFrom, DateTimeOffset CreatedAt);

    private static async Task<ReportRow?> LoadAsync(NpgsqlConnection c, long id, CancellationToken ct)
    {
        await using var cmd = new NpgsqlCommand(
            "select id, reporter_profile_id, farm_id, category, subtype, severity, description, latitude_rounded, longitude_rounded, status, escalated, wind_from_deg, created_at from community_report where id = $1", c);
        cmd.Parameters.AddWithValue(id);
        await using var r = await cmd.ExecuteReaderAsync(ct);
        if (!await r.ReadAsync(ct)) return null;
        return new ReportRow(r.GetInt64(0), r.GetGuid(1), r.IsDBNull(2) ? null : r.GetInt64(2), r.GetString(3), r.GetString(4), r.GetString(5),
            r.IsDBNull(6) ? null : r.GetString(6), Convert.ToDouble(r.GetValue(7)), Convert.ToDouble(r.GetValue(8)), r.GetString(9),
            r.GetBoolean(10), r.IsDBNull(11) ? null : Convert.ToDouble(r.GetValue(11)), r.GetFieldValue<DateTimeOffset>(12));
    }

    // Farms with a saved point. A farm has opted out only when it has farmer members and none of
    // them wants community alerts (a farm with no members, like a demonstration farm, is in).
    private static async Task<List<FarmPoint>> FarmsAsync(NpgsqlConnection c, CancellationToken ct)
    {
        var farms = new List<FarmPoint>();
        var hasPrefs = await FarmerMessenger.TableExistsAsync(c, "notification_preference", ct);
        var optIn = hasPrefs
            ? """
              not exists (select 1 from profile p where (p.id = f.owner_id or exists (select 1 from farm_member fm where fm.farm_id = f.farm_id and fm.profile_id = p.id)) and p.role = 'farm_user')
              or exists (select 1 from profile p left join notification_preference np on np.profile_id = p.id
                          where (p.id = f.owner_id or exists (select 1 from farm_member fm where fm.farm_id = f.farm_id and fm.profile_id = p.id))
                            and p.role = 'farm_user' and coalesce(np.community_opt_in, true))
              """
            : "true";
        await using var cmd = new NpgsqlCommand(
            $"select f.farm_id, f.latitude, f.longitude, ({optIn}) from farm f where f.latitude is not null and f.longitude is not null", c);
        await using var r = await cmd.ExecuteReaderAsync(ct);
        while (await r.ReadAsync(ct))
            farms.Add(new FarmPoint(r.GetInt64(0), Convert.ToDouble(r.GetValue(1)), Convert.ToDouble(r.GetValue(2)), r.GetBoolean(3)));
        return farms;
    }

    private static async Task<int> ConfirmationsAsync(NpgsqlConnection c, long reportId, CancellationToken ct)
    {
        await using var cmd = new NpgsqlCommand("select count(*) from community_report_confirmation where report_id = $1", c);
        cmd.Parameters.AddWithValue(reportId);
        return Convert.ToInt32(await cmd.ExecuteScalarAsync(ct));
    }

    // Farms that reported or confirmed the same thing nearby (the group), for "3 nearby farms".
    private static async Task<int> SimilarFarmsAsync(NpgsqlConnection c, long reportId, string category, double lat, double lon,
        DateTimeOffset at, CommunitySettings s, CancellationToken ct)
    {
        var farms = new HashSet<long>();
        await using (var cmd = new NpgsqlCommand(
            "select id, farm_id, latitude_rounded, longitude_rounded, created_at from community_report where category = $1 and status = 'active' and created_at between $2 and $3", c))
        {
            cmd.Parameters.AddWithValue(category);
            cmd.Parameters.AddWithValue(at - TimeSpan.FromHours(s.GroupHours));
            cmd.Parameters.AddWithValue(at + TimeSpan.FromHours(s.GroupHours));
            await using var r = await cmd.ExecuteReaderAsync(ct);
            while (await r.ReadAsync(ct))
            {
                if (r.IsDBNull(1)) continue;
                if (r.GetInt64(0) == reportId || CommunityMatching.SameGroup(category, lat, lon, at, category,
                        Convert.ToDouble(r.GetValue(2)), Convert.ToDouble(r.GetValue(3)), r.GetFieldValue<DateTimeOffset>(4), s))
                    farms.Add(r.GetInt64(1));
            }
        }
        await using (var cmd = new NpgsqlCommand("select farm_id from community_report_confirmation where report_id = $1 and farm_id is not null", c))
        {
            cmd.Parameters.AddWithValue(reportId);
            await using var r = await cmd.ExecuteReaderAsync(ct);
            while (await r.ReadAsync(ct)) farms.Add(r.GetInt64(0));
        }
        return farms.Count;
    }

    private async Task<int> NotifyAsync(NpgsqlConnection c, long reportId, string kind, long? updateId, bool onlyNew, CommunitySettings s,
        CancellationToken ct, string? updateKind = null, string? direction = null, bool includeClosed = false)
    {
        var report = await LoadAsync(c, reportId, ct);
        if (report is null) return 0;
        // Hidden or expired reports never notify; a fire marked "out" sends its last update.
        if (report.Status != "active" && !(includeClosed && report.Status == "closed")) return 0;

        var targets = CommunityMatching.Targets(report.Category, report.Lat, report.Lon, report.FarmId, report.Escalated, report.WindFrom, await FarmsAsync(c, ct), s).ToList();
        // Updates also go to every farm already told, even if the wind moved away from it.
        if (kind == "update")
        {
            var already = new Dictionary<long, (double Dist, bool Down)>();
            await using (var cmd = new NpgsqlCommand("select farm_id, max(distance_km), bool_or(priority = 'downwind') from community_notification where report_id = $1 and kind <> 'update' group by farm_id", c))
            {
                cmd.Parameters.AddWithValue(reportId);
                await using var r = await cmd.ExecuteReaderAsync(ct);
                while (await r.ReadAsync(ct)) already[r.GetInt64(0)] = (Convert.ToDouble(r.GetValue(1)), r.GetBoolean(2));
            }
            foreach (var (farm, v) in already)
                if (targets.All(t => t.FarmId != farm)) targets.Add(new CommunityTarget(farm, v.Dist, false));
        }
        if (onlyNew)
        {
            var told = new HashSet<long>();
            await using var cmd = new NpgsqlCommand("select distinct farm_id from community_notification where report_id = $1", c);
            cmd.Parameters.AddWithValue(reportId);
            await using var r = await cmd.ExecuteReaderAsync(ct);
            while (await r.ReadAsync(ct)) told.Add(r.GetInt64(0));
            targets = targets.Where(t => !told.Contains(t.FarmId)).ToList();
        }

        var similar = await SimilarFarmsAsync(c, reportId, report.Category, report.Lat, report.Lon, report.CreatedAt, s, ct);
        var sent = 0;
        foreach (var t in targets)
        {
            var message = kind == "update"
                ? CommunityMessages.FireUpdate(updateKind ?? "note", direction, t.DistanceKm, t.Downwind, s)
                : CommunityMessages.Report(report.Category, report.Subtype, report.Severity, t.DistanceKm, t.Downwind, similar, report.Description, s);
            await using (var cmd = new NpgsqlCommand(
                "insert into community_notification (report_id, farm_id, update_id, kind, priority, distance_km, message) values ($1, $2, $3, $4, $5, $6, $7) on conflict do nothing", c))
            {
                cmd.Parameters.AddWithValue(reportId);
                cmd.Parameters.AddWithValue(t.FarmId);
                cmd.Parameters.AddWithValue(NpgsqlTypes.NpgsqlDbType.Bigint, (object?)updateId ?? DBNull.Value);
                cmd.Parameters.AddWithValue(kind);
                cmd.Parameters.AddWithValue(t.Downwind ? "downwind" : "normal");
                cmd.Parameters.AddWithValue((decimal)t.DistanceKm);
                cmd.Parameters.AddWithValue(message);
                if (await cmd.ExecuteNonQueryAsync(ct) == 0) continue;   // already told
            }
            var severity = report.Category == "fire" && t.Downwind ? "Critical" : report.Severity == "high" ? "Warning" : "Info";
            await _messenger.InAppAsync(t.FarmId, severity, "Community alert: " + message, ct);
            await _messenger.TelegramAsync(t.FarmId, FarmerMessenger.Kind.Community, "AgroFlow community alert\n" + message,
                urgent: report.Category == "fire" && t.Downwind, ct);
            sent++;
        }
        if (sent > 0) _logger.LogInformation("Community report {Id} ({Kind}): {Count} farm(s) told.", reportId, kind, sent);
        return sent;
    }

    private static async Task<bool> IsMemberAsync(NpgsqlConnection c, Guid profileId, long farmId, CancellationToken ct)
    {
        await using var cmd = new NpgsqlCommand(
            "select exists (select 1 from farm f where f.farm_id = $2 and (f.owner_id = $1 or exists (select 1 from farm_member fm where fm.farm_id = f.farm_id and fm.profile_id = $1)))", c);
        cmd.Parameters.AddWithValue(profileId);
        cmd.Parameters.AddWithValue(farmId);
        return await cmd.ExecuteScalarAsync(ct) is true;
    }
}

// Closes community reports when their time is up (hourly).
public sealed class CommunityExpiryService : BackgroundService
{
    private readonly CommunityService _community;
    private readonly ILogger<CommunityExpiryService> _logger;
    public CommunityExpiryService(CommunityService community, ILogger<CommunityExpiryService> logger) { _community = community; _logger = logger; }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromHours(1));
        do
        {
            try { await _community.ExpireAsync(stoppingToken); }
            catch (Exception ex) when (ex is not OperationCanceledException) { _logger.LogWarning(ex, "Community report expiry failed."); }
        }
        while (await timer.WaitForNextTickAsync(stoppingToken).ConfigureAwait(false));
    }
}
