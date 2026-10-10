using System.Text.Json;
using Npgsql;

namespace AgroFlow.Api.Reports;

/// One "zone.crop_changed" audit row.
internal sealed record CropChange(DateTimeOffset At, string? From, DateOnly? FromPlanting);

// A report for a past period keeps the crop that was growing then.
// The zone row only holds today's crop, but each change in admin_audit_log says
// what it changed from, so the crop on a past day is the "from" of the first
// change after that day, or today's crop if nothing changed since.
internal static class CropHistory
{
    /// The crop and planting date in effect at the end of <paramref name="day"/> (SAST).
    public static (string? Crop, DateOnly? Planting) AsOf(
        string? currentCrop, DateOnly? currentPlanting, IEnumerable<CropChange> changes, DateOnly day)
    {
        var endOfDay = new DateTimeOffset(day.AddDays(1).ToDateTime(TimeOnly.MinValue), TimeSpan.FromHours(2));
        var first = changes.Where(c => c.At >= endOfDay).OrderBy(c => c.At).FirstOrDefault();
        return first is null ? (currentCrop, currentPlanting) : (first.From, first.FromPlanting);
    }

    /// The zone's crop changes, oldest first. Empty if the audit table is not there.
    public static async Task<List<CropChange>> ReadAsync(NpgsqlConnection connection, long zoneId, CancellationToken ct)
    {
        var list = new List<CropChange>();
        try
        {
            await using var cmd = new NpgsqlCommand(
                """
                select created_at, details::text
                  from admin_audit_log
                 where action = 'zone.crop_changed' and entity_type = 'zone' and entity_id = $1
                 order by created_at
                """, connection);
            cmd.Parameters.AddWithValue(zoneId.ToString());
            await using var reader = await cmd.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct))
            {
                list.Add(Parse(reader.GetFieldValue<DateTimeOffset>(0), reader.GetString(1)));
            }
        }
        catch (PostgresException)
        {
            // 0037 not applied: no history, so we use today's crop.
        }
        return list;
    }

    internal static CropChange Parse(DateTimeOffset at, string details)
    {
        using var doc = JsonDocument.Parse(details);
        var root = doc.RootElement;
        string? Get(string name) =>
            root.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;
        return new CropChange(at, Get("from"), DateOnly.TryParse(Get("fromPlanting"), out var p) ? p : null);
    }
}
