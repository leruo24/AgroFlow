using AgroFlow.Business;
using Npgsql;

namespace AgroFlow.Api.Services;

// zone.max_run_minutes (migration 0052) for the routes that need it. Before 0052 is applied
// every zone reads as IrrigationRunRules.DefaultMaxRunMinutes (5), the old fixed cap, so the
// API keeps working. The column check is remembered once it is there; while it is missing it
// is asked again at most once a minute, so applying 0052 takes effect without a restart.
public static class ZoneRunLimit
{
    private static volatile bool _known;
    private static DateTimeOffset _lastMiss = DateTimeOffset.MinValue;

    public static async Task<bool> ColumnExistsAsync(NpgsqlConnection connection, CancellationToken ct = default)
    {
        if (_known) return true;
        if (DateTimeOffset.UtcNow - _lastMiss < TimeSpan.FromMinutes(1)) return false;
        await using var cmd = new NpgsqlCommand(
            "select exists (select 1 from information_schema.columns where table_name = 'zone' and column_name = 'max_run_minutes')",
            connection);
        _known = await cmd.ExecuteScalarAsync(ct) is true;
        if (!_known) _lastMiss = DateTimeOffset.UtcNow;
        return _known;
    }

    // The SQL for "this zone's maximum" given the zone alias: the column, or the default.
    public static async Task<string> ExpressionAsync(NpgsqlConnection connection, string alias = "z", CancellationToken ct = default) =>
        await ColumnExistsAsync(connection, ct) ? $"{alias}.max_run_minutes" : IrrigationRunRules.DefaultMaxRunMinutes.ToString();

    public static async Task<int> ForZoneAsync(NpgsqlConnection connection, long zoneId, CancellationToken ct = default)
    {
        if (!await ColumnExistsAsync(connection, ct)) return IrrigationRunRules.DefaultMaxRunMinutes;
        await using var cmd = new NpgsqlCommand("select max_run_minutes from zone where id = $1", connection);
        cmd.Parameters.AddWithValue(zoneId);
        return IrrigationRunRules.ZoneMaxOrDefault(await cmd.ExecuteScalarAsync(ct) as int?);
    }
}
