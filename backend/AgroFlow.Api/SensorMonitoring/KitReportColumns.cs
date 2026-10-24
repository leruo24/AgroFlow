using Npgsql;

namespace AgroFlow.Api.Services;

// hardware.wifi_rssi / soil_probe_ok / kit_report_at (migration 0061): the kit's Wi-Fi signal and
// soil-probe check from its latest reading (firmware 1.7.1+). Before 0061 is applied the routes
// read them as unknown (null) and the Kit tab leaves those lines out. Like HardwareBacklog, the
// column check is remembered once it is there, and asked again at most once a minute while missing.
public static class KitReportColumns
{
    private static volatile bool _known;
    private static DateTimeOffset _lastMiss = DateTimeOffset.MinValue;

    public static async Task<bool> ExistAsync(NpgsqlConnection connection, CancellationToken ct = default)
    {
        if (_known) return true;
        if (DateTimeOffset.UtcNow - _lastMiss < TimeSpan.FromMinutes(1)) return false;
        await using var cmd = new NpgsqlCommand(
            "select exists (select 1 from information_schema.columns where table_name = 'hardware' and column_name = 'wifi_rssi')",
            connection);
        _known = await cmd.ExecuteScalarAsync(ct) is true;
        if (!_known) _lastMiss = DateTimeOffset.UtcNow;
        return _known;
    }

    // "h.wifi_rssi, h.soil_probe_ok", or two typed nulls before 0061.
    public static async Task<string> SelectAsync(NpgsqlConnection connection, string alias = "h", CancellationToken ct = default) =>
        await ExistAsync(connection, ct)
            ? $"{alias}.wifi_rssi::integer, {alias}.soil_probe_ok"
            : "null::integer, null::boolean";
}
