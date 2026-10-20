using System.Globalization;
using System.Text.Json;
using AgroFlow.Business;
using AgroFlow.Business.Agronomy;
using Npgsql;

namespace AgroFlow.Api.Services;

public sealed record AppSettingRow(string Key, JsonElement Value, string Description, string Source, DateTimeOffset UpdatedAt);

// The thresholds behind drought mode and community alerts (app_setting, migration 0054).
// Staff change them in the admin site; everything else reads them from here. Before 0054 is
// applied, or if a row is missing or unreadable, the seeded default is used, so a settings
// problem can never switch a rule off. Read at most once a minute.
public sealed class AppSettingsStore
{
    private readonly NpgsqlDataSource _dataSource;
    private readonly ILogger<AppSettingsStore> _logger;
    private Dictionary<string, JsonElement>? _cache;
    private DateTimeOffset _loadedAt = DateTimeOffset.MinValue;
    private readonly SemaphoreSlim _gate = new(1, 1);

    public AppSettingsStore(NpgsqlDataSource dataSource, ILogger<AppSettingsStore> logger)
    {
        _dataSource = dataSource;
        _logger = logger;
    }

    public async Task<IReadOnlyList<AppSettingRow>> ListAsync(CancellationToken ct)
    {
        var rows = new List<AppSettingRow>();
        await using var connection = await _dataSource.OpenConnectionAsync(ct);
        if (!await TableExistsAsync(connection, ct)) return rows;
        await using var cmd = new NpgsqlCommand("select key, value::text, description, source, updated_at from app_setting order by key", connection);
        await using var reader = await cmd.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct))
        {
            using var doc = JsonDocument.Parse(reader.GetString(1));
            rows.Add(new AppSettingRow(reader.GetString(0), doc.RootElement.Clone(), reader.GetString(2), reader.GetString(3), reader.GetFieldValue<DateTimeOffset>(4)));
        }
        return rows;
    }

    // Number settings must stay numbers and inside sensible bounds; text stays text.
    public static string? Validate(string key, JsonElement value)
    {
        if (key == "fire.emergency_text")
            return value.ValueKind == JsonValueKind.String && value.GetString() is { Length: > 2 and <= 200 } ? null : "Type the emergency number text (3 to 200 characters).";
        if (value.ValueKind != JsonValueKind.Number || !value.TryGetDouble(out var n)) return "This setting must be a number.";
        return key switch
        {
            "drought.tank_low_fraction" or "drought.reduced_fraction" => n is > 0 and < 1 ? null : "Use a share between 0 and 1 (for example 0.25).",
            "drought.ky_full_at" or "drought.ky_skip_below" => n is >= 0 and <= 3 ? null : "Use a value between 0 and 3.",
            "drought.eto_ratio" or "fire.downwind_factor" or "fire.escalate_factor" => n is >= 0.5 and <= 5 ? null : "Use a value between 0.5 and 5.",
            "fire.cone_degrees" => n is > 0 and <= 90 ? null : "Use between 1 and 90 degrees.",
            _ when key.StartsWith("community.radius_km.") => n is > 0 and <= 300 ? null : "Use between 1 and 300 km.",
            _ when key.StartsWith("community.expiry_hours.") => n is >= 1 and <= 720 ? null : "Use between 1 and 720 hours.",
            _ => n is >= 0 and <= 1000 ? null : "Use a value between 0 and 1000.",
        };
    }

    public async Task<bool> SetAsync(string key, JsonElement value, Guid? by, CancellationToken ct)
    {
        await using var connection = await _dataSource.OpenConnectionAsync(ct);
        await using var cmd = new NpgsqlCommand(
            "update app_setting set value = $2::jsonb, updated_at = now(), updated_by = $3 where key = $1", connection);
        cmd.Parameters.AddWithValue(key);
        cmd.Parameters.AddWithValue(value.GetRawText());
        cmd.Parameters.AddWithValue(NpgsqlTypes.NpgsqlDbType.Uuid, (object?)by ?? DBNull.Value);
        var changed = await cmd.ExecuteNonQueryAsync(ct) > 0;
        _cache = null;
        return changed;
    }

    public async Task<DroughtSettings> DroughtAsync(CancellationToken ct)
    {
        var v = await ValuesAsync(ct);
        var d = DroughtSettings.Defaults;
        return new DroughtSettings(
            Num(v, "drought.tank_low_fraction", d.TankLowFraction),
            (int)Num(v, "drought.forecast_days", d.ForecastDays),
            Num(v, "drought.rain_sum_mm", d.RainSumMm),
            Num(v, "drought.eto_ratio", d.EtoRatio),
            (int)Num(v, "drought.eto_lookback_days", d.EtoLookbackDays),
            Num(v, "drought.ky_full_at", d.KyFullAt),
            Num(v, "drought.ky_skip_below", d.KySkipBelow),
            Num(v, "drought.reduced_fraction", d.ReducedFraction));
    }

    public async Task<CommunitySettings> CommunityAsync(CancellationToken ct)
    {
        var v = await ValuesAsync(ct);
        var d = CommunitySettings.Defaults;
        var cats = new[] { "pest", "disease", "fire", "water", "weather" };
        return new CommunitySettings(
            (int)Num(v, "community.report_limit", d.ReportLimit),
            (int)Num(v, "community.report_window_hours", d.ReportWindowHours),
            cats.ToDictionary(c => c, c => Num(v, $"community.radius_km.{c}", d.RadiusKm[c])),
            cats.ToDictionary(c => c, c => (int)Num(v, $"community.expiry_hours.{c}", d.ExpiryHours[c])),
            (int)Num(v, "community.group_hours", d.GroupHours),
            Num(v, "fire.downwind_factor", d.FireDownwindFactor),
            Num(v, "fire.cone_degrees", d.FireConeDegrees),
            (int)Num(v, "fire.escalate_confirmations", d.FireEscalateConfirmations),
            Num(v, "fire.escalate_factor", d.FireEscalateFactor),
            v.TryGetValue("fire.emergency_text", out var t) && t.ValueKind == JsonValueKind.String && !string.IsNullOrWhiteSpace(t.GetString())
                ? t.GetString()! : d.EmergencyText);
    }

    private static double Num(Dictionary<string, JsonElement> v, string key, double fallback) =>
        v.TryGetValue(key, out var e) && e.ValueKind == JsonValueKind.Number && e.TryGetDouble(out var n) && double.IsFinite(n) ? n : fallback;

    private async Task<Dictionary<string, JsonElement>> ValuesAsync(CancellationToken ct)
    {
        if (_cache is { } c && DateTimeOffset.UtcNow - _loadedAt < TimeSpan.FromMinutes(1)) return c;
        await _gate.WaitAsync(ct);
        try
        {
            if (_cache is { } c2 && DateTimeOffset.UtcNow - _loadedAt < TimeSpan.FromMinutes(1)) return c2;
            var values = new Dictionary<string, JsonElement>();
            try
            {
                foreach (var row in await ListAsync(ct)) values[row.Key] = row.Value;
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                _logger.LogWarning(ex, "Could not read app_setting; using the default thresholds.");
            }
            _cache = values;
            _loadedAt = DateTimeOffset.UtcNow;
            return values;
        }
        finally { _gate.Release(); }
    }

    private static async Task<bool> TableExistsAsync(NpgsqlConnection connection, CancellationToken ct)
    {
        await using var cmd = new NpgsqlCommand("select to_regclass('public.app_setting') is not null", connection);
        return await cmd.ExecuteScalarAsync(ct) is true;
    }
}

// In-app alerts and Telegram for a farm's FARMERS (never staff): owner and members with a
// linked chat whose preference for this kind of alert is on (notification_preference, 0055;
// default on), outside their quiet hours. A fire that may reach the farm ignores quiet hours.
public sealed class FarmerMessenger
{
    public enum Kind { Watering, LowTank, Drought, Community, Weather }

    private readonly NpgsqlDataSource _dataSource;
    private readonly Notifications.TelegramClient _telegram;
    private readonly ILogger<FarmerMessenger> _logger;

    public FarmerMessenger(NpgsqlDataSource dataSource, Notifications.TelegramClient telegram, ILogger<FarmerMessenger> logger)
    {
        _dataSource = dataSource;
        _telegram = telegram;
        _logger = logger;
    }

    public static string PreferenceColumn(Kind k) => k switch
    {
        Kind.Watering => "watering_telegram",
        Kind.LowTank => "low_tank_telegram",
        Kind.Drought => "drought_telegram",
        Kind.Community => "community_telegram",
        _ => "weather_telegram",
    };

    // Quiet hours in South African time; a window may run past midnight (21:00-06:00).
    public static bool InQuietHours(TimeOnly? start, TimeOnly? end, DateTimeOffset nowUtc)
    {
        if (start is not { } s || end is not { } e || s == e) return false;
        var local = TimeOnly.FromDateTime(nowUtc.ToOffset(TimeSpan.FromHours(2)).DateTime);
        return s < e ? local >= s && local < e : local >= s || local < e;
    }

    // An in-app alert for the whole farm (zone_id null, farm_id set; the app's Alerts list).
    public async Task<long?> InAppAsync(long farmId, string severity, string message, CancellationToken ct)
    {
        try
        {
            await using var connection = await _dataSource.OpenConnectionAsync(ct);
            await using var cmd = new NpgsqlCommand(
                "insert into alert (zone_id, farm_id, severity, message) values (null, $1, $2, $3) returning id", connection);
            cmd.Parameters.AddWithValue(farmId);
            cmd.Parameters.AddWithValue(severity);
            cmd.Parameters.AddWithValue(message.Length > 1000 ? message[..1000] : message);
            return await cmd.ExecuteScalarAsync(ct) as long?;
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _logger.LogWarning(ex, "Could not save an in-app alert for farm {FarmId}.", farmId);
            return null;
        }
    }

    public async Task<int> TelegramAsync(long farmId, Kind kind, string message, bool urgent, CancellationToken ct)
    {
        if (!_telegram.IsConfigured) return 0;
        var sent = 0;
        try
        {
            var chats = new List<(long Chat, TimeOnly? Start, TimeOnly? End)>();
            await using (var connection = await _dataSource.OpenConnectionAsync(ct))
            {
                var hasPrefs = await TableExistsAsync(connection, "notification_preference", ct);
                var prefJoin = hasPrefs ? "left join notification_preference np on np.profile_id = p.id" : "";
                var prefOn = hasPrefs ? $"and coalesce(np.{PreferenceColumn(kind)}, true)" + (kind == Kind.Community ? " and coalesce(np.community_opt_in, true)" : "") : "";
                var quiet = hasPrefs ? "np.quiet_start, np.quiet_end" : "null::time, null::time";
                var sql = $"""
                    select distinct p.telegram_chat_id, {quiet}
                      from profile p {prefJoin}
                     where p.telegram_chat_id is not null and p.telegram_alerts_enabled and {StaffTelegram.NotStaffSql} {prefOn}
                       and (exists (select 1 from farm f where f.farm_id = $1 and f.owner_id = p.id)
                         or exists (select 1 from farm_member fm where fm.farm_id = $1 and fm.profile_id = p.id))
                    """;
                await using var cmd = new NpgsqlCommand(sql, connection);
                cmd.Parameters.AddWithValue(farmId);
                await using var reader = await cmd.ExecuteReaderAsync(ct);
                while (await reader.ReadAsync(ct))
                    chats.Add((reader.GetInt64(0),
                        reader.IsDBNull(1) ? null : TimeOnly.FromTimeSpan(reader.GetFieldValue<TimeSpan>(1)),
                        reader.IsDBNull(2) ? null : TimeOnly.FromTimeSpan(reader.GetFieldValue<TimeSpan>(2))));
            }
            foreach (var (chat, start, end) in chats)
            {
                if (!urgent && InQuietHours(start, end, DateTimeOffset.UtcNow)) continue;
                if (await _telegram.SendMessageAsync(chat, message, ct)) sent++;
            }
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _logger.LogWarning(ex, "Could not send a {Kind} Telegram message for farm {FarmId}.", kind, farmId);
        }
        return sent;
    }

    internal static async Task<bool> TableExistsAsync(NpgsqlConnection connection, string table, CancellationToken ct)
    {
        await using var cmd = new NpgsqlCommand($"select to_regclass('public.{table}') is not null", connection);
        return await cmd.ExecuteScalarAsync(ct) is true;
    }
}
