using System.Globalization;
using AgroFlow.Business;
using Npgsql;

namespace AgroFlow.Api.Reports;

/// A whole farm's week: every zone, plus the farm-level totals and weather.
///
/// WHY THIS WRAPS THE PER-ZONE MODEL RATHER THAN REPLACING IT
/// "All zones" is not a different report, it is the same report repeated with
/// a summary in front. Building it from a list of WaterUsageReportModel means
/// a zone's section in the farm report is rendered by exactly the code that
/// renders its single-zone report - so the two can never disagree about that
/// zone, which is the kind of discrepancy nobody notices until a farmer puts
/// the two documents side by side.
internal sealed class FarmWaterUsageReport
{
    public required string FarmName { get; init; }
    public required DateOnly From { get; init; }
    public required DateOnly To { get; init; }
    public required DateTimeOffset GeneratedAtSast { get; init; }

    /// One per zone, in name order. May be empty: a farm with no zones still
    /// gets a report, which says so.
    public required IReadOnlyList<WaterUsageReportModel> Zones { get; init; }

    public int TotalRuns => Zones.Sum(z => z.TotalRuns);

    public double TotalMinutes => Math.Round(Zones.Sum(z => z.TotalMinutes), 3);

    /// Null when NO zone could be estimated. One zone without a flow rate
    /// does not void the farm's total - it is simply left out of it, and the
    /// report says how many were.
    public double? TotalLitres =>
        Zones.Any(z => z.TotalLitres.HasValue)
            ? Math.Round(Zones.Sum(z => z.TotalLitres ?? 0), 3)
            : null;

    public double? TotalNeedLitres =>
        Zones.Any(z => z.TotalNeedLitres.HasValue)
            ? Math.Round(Zones.Sum(z => z.TotalNeedLitres ?? 0), 3)
            : null;

    public double? Difference =>
        TotalLitres.HasValue && TotalNeedLitres.HasValue
            ? Math.Round(TotalLitres.Value - TotalNeedLitres.Value, 3)
            : null;

    /// Zones that could not be estimated at all, which is what the summary
    /// has to disclose rather than quietly totalling the rest.
    public IReadOnlyList<string> ZonesWithoutEstimate =>
        Zones.Where(z => z.TotalLitres is null).Select(z => z.ZoneName).ToList();

    public int DaysTooDryAcrossZones => Zones.Sum(z => z.DaysTooDry);

    public double TotalRainMm =>
        Zones.Count == 0 ? 0 : Math.Round(Zones[0].TotalRainMm, 3);

    /// The farm's weather, taken from the first zone.
    ///
    /// weather_daily is keyed on the FARM, so the area forecast is identical
    /// on every zone's rows - reading it from one of them is not an
    /// approximation. The local field readings do differ per zone, which is why
    /// the farm-level comparison averages them below rather than picking one.
    public IReadOnlyList<WaterUsageReportModel.DayLine> WeatherDays =>
        Zones.Count == 0 ? Array.Empty<WaterUsageReportModel.DayLine>() : Zones[0].Days;

    public double? AvgAreaTempC => Avg(Zones.Select(z => z.AvgAreaTempC));
    public double? AvgAreaHumidity => Avg(Zones.Select(z => z.AvgAreaHumidity));
    public double? AvgLocalTempC => Avg(Zones.Select(z => z.AvgLocalTempC));
    public double? AvgLocalHumidity => Avg(Zones.Select(z => z.AvgLocalHumidity));

    /// The farm's local field temperature for one day, averaged across whichever
    /// zones reported it. A zone whose sensor was down simply does not
    /// contribute, rather than pulling the average toward zero.
    public double? LocalTempOn(DateOnly date) =>
        Avg(Zones.Select(z => z.Days.FirstOrDefault(d => d.Date == date)?.LocalMaxC));

    public double? LocalHumidityOn(DateOnly date) =>
        Avg(Zones.Select(z => z.Days.FirstOrDefault(d => d.Date == date)?.LocalHumidity));

    private static double? Avg(IEnumerable<double?> values)
    {
        var present = values.Where(v => v.HasValue).Select(v => v!.Value).ToList();
        return present.Count == 0 ? null : Math.Round(present.Average(), 3);
    }
}

internal static class FarmWaterUsageReportBuilder
{
    private static readonly TimeSpan Sast = TimeSpan.FromHours(2);

    /// Returns null when the farm does not exist or the caller may not read
    /// it - the caller turns that into a 404, so a farmer probing farm ids
    /// cannot tell "not yours" from "not there".
    public static async Task<FarmWaterUsageReport?> BuildAsync(
        NpgsqlConnection connection,
        Fao56EngineController engine,
        Guid profileId,
        long farmId,
        DateOnly from,
        DateOnly to,
        CancellationToken ct)
    {
        /* ---- 1. The farm, and whether this person may read it --------- */
        const string farmSql = """
            select f.name
              from farm f
             where f.farm_id = $1
               and (f.owner_id = $2
                 or exists (select 1 from farm_member fm where fm.farm_id = f.farm_id and fm.profile_id = $2)
                 or exists (select 1 from profile p where p.id = $2 and p.role = 'admin'))
            """;

        string farmName;

        await using (var cmd = new NpgsqlCommand(farmSql, connection))
        {
            cmd.Parameters.AddWithValue(farmId);
            cmd.Parameters.AddWithValue(profileId);

            if (await cmd.ExecuteScalarAsync(ct) is not string name) return null;
            farmName = name;
        }

        /* ---- 2. Its zones -------------------------------------------- */
        // Archived zones are left out, the same way archived farms are left
        // out of every list: a retired block in this week's totals makes the
        // farm look like it watered more than it did. Migration 0036 made
        // zone.status mirror farm.status; it is compared case-insensitively
        // because neither has ever had a CHECK constraint.
        const string zoneSql = """
            select z.id
              from zone z
             where z.farm_id = $1
               and lower(coalesce(z.status, 'Active')) <> 'inactive'
             order by z.name, z.id
            """;

        var zoneIds = new List<long>();

        await using (var cmd = new NpgsqlCommand(zoneSql, connection))
        {
            cmd.Parameters.AddWithValue(farmId);

            await using var reader = await cmd.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct)) zoneIds.Add(reader.GetInt64(0));
        }

        /* ---- 3. Each zone's own report ------------------------------- */
        // Sequentially, on one connection, rather than in parallel. Each zone
        // runs the FAO-56 balance, which is CPU-bound; a farm with twelve
        // zones fanning out would make the API's slowest endpoint also its
        // least predictable one.
        var zones = new List<WaterUsageReportModel>();

        foreach (var zoneId in zoneIds)
        {
            var zone = await WaterUsageReportBuilder.BuildAsync(
                connection, engine, profileId, zoneId, from, to, ct);

            if (zone is not null) zones.Add(zone);
        }

        return new FarmWaterUsageReport
        {
            FarmName = farmName,
            From = from,
            To = to,
            GeneratedAtSast = DateTimeOffset.UtcNow.ToOffset(Sast),
            Zones = zones,
        };
    }

    /// "28 Sep – 4 Oct 2026", shared by the PDF and the workbook.
    public static string DescribePeriod(DateOnly from, DateOnly to)
    {
        var a = from.ToDateTime(TimeOnly.MinValue);
        var b = to.ToDateTime(TimeOnly.MinValue);

        var left = a.Year == b.Year
            ? a.ToString("d MMM", CultureInfo.InvariantCulture)
            : a.ToString("d MMM yyyy", CultureInfo.InvariantCulture);

        return $"{left} – {b.ToString("d MMM yyyy", CultureInfo.InvariantCulture)}";
    }
}
