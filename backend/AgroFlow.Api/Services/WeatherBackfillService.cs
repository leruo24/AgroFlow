using AgroFlow.Business.Agronomy;
using Npgsql;

namespace AgroFlow.Api.Services;

// Historical weather backfill from Open-Meteo's ARCHIVE endpoint (ERA5
// reanalysis), as opposed to the forecast endpoint WeatherCollectionService
// uses for the rolling window.
//
// ############################################################
// #  THIS IS NOT WIRED TO ANYTHING AND DOES NOT RUN BY ITSELF #
// ############################################################
//
// It is registered as a plain singleton, NOT as an IHostedService, and nothing
// calls RunAsync. That is deliberate: the overnight brief said write the
// routine but do not run it, because weather_daily does not exist in the live
// database yet - migration 0016 is still waiting to be pasted into the
// Supabase SQL editor.
//
// TO ACTUALLY RUN IT, once 0016 has been applied:
//   1. Confirm the table exists:  select count(*) from weather_daily;
//   2. Resolve this service from DI and await RunAsync(farmId, start, end, ct)
//      - either from a temporary admin-only endpoint or from a one-off
//        console harness.
//   3. Check what landed:
//        select date, tmin_c, tmax_c, precipitation_mm, is_forecast, source
//          from weather_daily where farm_id = <id> order by date;
//
// Why backfill at all: the advice engine only needs today, but anything that
// wants to show a farmer how this season compares to last, or to compute
// seasonal ETc totals, needs history that no live sensor can provide
// retroactively.
public class WeatherBackfillService
{
    private readonly NpgsqlDataSource _dataSource;
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly ILogger<WeatherBackfillService> _logger;

    // Open-Meteo's archive serves long ranges in one request, but a decade in
    // a single call is a large response to hold in memory and a large
    // transaction to replay if it fails halfway. Chunking also means a failure
    // costs one year, not the whole run.
    private const int ChunkDays = 365;

    // ERA5 reanalysis lags real time by roughly five days. Asking for
    // yesterday from the archive returns nulls; that window belongs to the
    // forecast endpoint's past_days instead.
    private const int ArchiveLagDays = 5;

    public WeatherBackfillService(
        NpgsqlDataSource dataSource,
        IHttpClientFactory httpClientFactory,
        ILogger<WeatherBackfillService> logger)
    {
        _dataSource = dataSource;
        _httpClientFactory = httpClientFactory;
        _logger = logger;
    }

    // Backfills one farm over a date range. Returns the number of rows written.
    public async Task<int> RunAsync(long farmId, DateOnly start, DateOnly end, CancellationToken ct = default)
    {
        var latestUsable = DateOnly.FromDateTime(DateTime.UtcNow).AddDays(-ArchiveLagDays);
        if (end > latestUsable)
        {
            _logger.LogInformation(
                "Backfill end date {End} is inside the ERA5 reanalysis lag; clamping to {Clamped}. " +
                "The last {Lag} days are covered by WeatherCollectionService's forecast fetch instead.",
                end, latestUsable, ArchiveLagDays);
            end = latestUsable;
        }

        if (end < start)
        {
            _logger.LogWarning("Backfill range for farm {FarmId} is empty after clamping; nothing to do", farmId);
            return 0;
        }

        await using var connection = await _dataSource.OpenConnectionAsync(ct);

        var farm = await FetchFarmAsync(connection, farmId, ct);
        if (farm is null)
        {
            throw new InvalidOperationException($"Farm {farmId} not found.");
        }

        if (!farm.Latitude.HasValue || !farm.Longitude.HasValue)
        {
            throw new InvalidOperationException(
                $"Farm {farmId} has no latitude/longitude, so historical weather cannot be located. Set farm.latitude and farm.longitude first.");
        }

        _logger.LogInformation(
            "Backfilling weather for farm {FarmId} from {Start} to {End} (Open-Meteo archive / ERA5)",
            farmId, start, end);

        var client = _httpClientFactory.CreateClient();
        client.Timeout = TimeSpan.FromMinutes(2);

        var totalWritten = 0;
        var chunkStart = start;

        while (chunkStart <= end && !ct.IsCancellationRequested)
        {
            var chunkEnd = chunkStart.AddDays(ChunkDays - 1);
            if (chunkEnd > end) chunkEnd = end;

            var url = OpenMeteoDailyParser.BuildArchiveUrl(
                farm.Latitude.Value, farm.Longitude.Value, chunkStart, chunkEnd);

            try
            {
                var response = await client.GetAsync(url, ct);
                response.EnsureSuccessStatusCode();

                var json = await response.Content.ReadAsStringAsync(ct);

                // treatAllAsActuals: every row from the archive endpoint is an
                // observation-based reanalysis value, never a prediction, even
                // though some of these dates would look like "the future"
                // relative to nothing in particular. Marking them is_forecast
                // would make the collector's upsert guard refuse to let real
                // forecasts replace them later.
                var rows = OpenMeteoDailyParser.Parse(json, chunkStart, treatAllAsActuals: true);

                var written = 0;
                foreach (var row in rows)
                {
                    if (!row.HasUsableTemperatures) continue;
                    await UpsertAsync(connection, farmId, row, ct);
                    written++;
                }

                totalWritten += written;
                _logger.LogInformation(
                    "Backfill farm {FarmId} {Start}..{End}: {Written} rows", farmId, chunkStart, chunkEnd, written);
            }
            catch (OperationCanceledException)
            {
                throw;
            }
            catch (Exception ex)
            {
                // One bad chunk should not abandon the rest of the range.
                _logger.LogError(ex,
                    "Backfill chunk {Start}..{End} failed for farm {FarmId}; continuing with the next chunk",
                    chunkStart, chunkEnd, farmId);
            }

            chunkStart = chunkEnd.AddDays(1);

            // Open-Meteo's free tier is generous but not unlimited, and a
            // multi-year backfill is exactly the shape of request that looks
            // like abuse. Be a good citizen of a service that costs us nothing.
            await Task.Delay(TimeSpan.FromSeconds(1), ct);
        }

        _logger.LogInformation("Backfill complete for farm {FarmId}: {Total} rows written", farmId, totalWritten);
        return totalWritten;
    }

    // Backfills every farm that has coordinates.
    public async Task<int> RunForAllFarmsAsync(DateOnly start, DateOnly end, CancellationToken ct = default)
    {
        await using var connection = await _dataSource.OpenConnectionAsync(ct);

        var farmIds = new List<long>();
        await using (var cmd = new NpgsqlCommand(
            "select farm_id from farm where latitude is not null and longitude is not null order by farm_id", connection))
        await using (var reader = await cmd.ExecuteReaderAsync(ct))
        {
            while (await reader.ReadAsync(ct)) farmIds.Add(reader.GetInt64(0));
        }

        var total = 0;
        foreach (var farmId in farmIds)
        {
            if (ct.IsCancellationRequested) break;

            try
            {
                total += await RunAsync(farmId, start, end, ct);
            }
            catch (OperationCanceledException)
            {
                throw;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Backfill failed for farm {FarmId}; continuing", farmId);
            }
        }

        return total;
    }

    // Archive rows are actuals, so this upsert has no is_forecast guard: an
    // actual may always replace whatever is there.
    private static async Task UpsertAsync(
        NpgsqlConnection connection, long farmId, WeatherDailyRow row, CancellationToken ct)
    {
        await using var cmd = new NpgsqlCommand(
            "insert into weather_daily " +
            "  (farm_id, date, tmin_c, tmax_c, precipitation_mm, humidity_mean, is_forecast, fetched_at, source) " +
            "values ($1, $2, $3, $4, $5, $6, false, now(), $7) " +
            "on conflict (farm_id, date) do update set " +
            "  tmin_c = excluded.tmin_c, " +
            "  tmax_c = excluded.tmax_c, " +
            "  precipitation_mm = excluded.precipitation_mm, " +
            "  humidity_mean = excluded.humidity_mean, " +
            "  is_forecast = false, " +
            "  fetched_at = excluded.fetched_at, " +
            "  source = excluded.source",
            connection);

        cmd.Parameters.AddWithValue(farmId);
        cmd.Parameters.AddWithValue(row.Date);
        cmd.Parameters.AddWithValue((object?)(float?)row.TMinC ?? DBNull.Value);
        cmd.Parameters.AddWithValue((object?)(float?)row.TMaxC ?? DBNull.Value);
        cmd.Parameters.AddWithValue((object?)(float?)row.PrecipitationMm ?? DBNull.Value);
        cmd.Parameters.AddWithValue((object?)(float?)row.HumidityMean ?? DBNull.Value);
        cmd.Parameters.AddWithValue(OpenMeteoDailyParser.ArchiveSource);

        await cmd.ExecuteNonQueryAsync(ct);
    }

    private static async Task<FarmCoordinates?> FetchFarmAsync(NpgsqlConnection connection, long farmId, CancellationToken ct)
    {
        await using var cmd = new NpgsqlCommand(
            "select farm_id, latitude, longitude from farm where farm_id = $1", connection);
        cmd.Parameters.AddWithValue(farmId);

        await using var reader = await cmd.ExecuteReaderAsync(ct);
        if (!await reader.ReadAsync(ct)) return null;

        return new FarmCoordinates(
            reader.GetInt64(0),
            reader.IsDBNull(1) ? null : reader.GetDouble(1),
            reader.IsDBNull(2) ? null : reader.GetDouble(2));
    }

    private sealed record FarmCoordinates(long FarmId, double? Latitude, double? Longitude);
}
