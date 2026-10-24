using Npgsql;

namespace AgroFlow.Api.Services;

// hardware.offline_backlog (migration 0060): how many readings a kit still has waiting to
// upload, from its latest reading (firmware 1.7.0+). Before 0060 is applied the routes read it
// as unknown (null) and keep working. Like ZoneRunLimit, the column check is remembered once
// it is there, and asked again at most once a minute while it is missing.
public static class HardwareBacklog
{
    private static volatile bool _known;
    private static DateTimeOffset _lastMiss = DateTimeOffset.MinValue;

    public static async Task<bool> ColumnExistsAsync(NpgsqlConnection connection, CancellationToken ct = default)
    {
        if (_known) return true;
        if (DateTimeOffset.UtcNow - _lastMiss < TimeSpan.FromMinutes(1)) return false;
        await using var cmd = new NpgsqlCommand(
            "select exists (select 1 from information_schema.columns where table_name = 'hardware' and column_name = 'offline_backlog')",
            connection);
        _known = await cmd.ExecuteScalarAsync(ct) is true;
        if (!_known) _lastMiss = DateTimeOffset.UtcNow;
        return _known;
    }

    // The SQL for "this kit's backlog" given the hardware alias: the column, or null.
    public static async Task<string> ExpressionAsync(NpgsqlConnection connection, string alias = "h", CancellationToken ct = default) =>
        await ColumnExistsAsync(connection, ct) ? $"{alias}.offline_backlog" : "null::integer";
}
