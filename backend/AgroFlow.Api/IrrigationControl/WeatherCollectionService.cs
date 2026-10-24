using AgroFlow.Business.Agronomy;
using Npgsql;

namespace AgroFlow.Api.Services;

// Fills weather_daily (0016) from Open-Meteo every Weather:FetchIntervalHours
// (default 6) for every farm with coordinates. The FAO-56 engine needs this to
// work out ET0.
// Open-Meteo is free and needs no key: no account, no secret, no cost. Talk to the
// team before switching to a provider that needs a key.
// One farm's problem stays that farm's problem: each failure is logged and we move
// on, because this process also runs the MQTT bridge and the irrigation commands.
public class WeatherCollectionService : BackgroundService
{
    private readonly NpgsqlDataSource _dataSource;
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly IConfiguration _configuration;
    private readonly ILogger<WeatherCollectionService> _logger;

    // Farms already reported as having no coordinates, so we warn once instead of every
    // six hours.
    private readonly HashSet<long> _farmsReportedWithoutCoordinates = new();

    public WeatherCollectionService(
        NpgsqlDataSource dataSource,
        IHttpClientFactory httpClientFactory,
        IConfiguration configuration,
        ILogger<WeatherCollectionService> logger)
    {
        _dataSource = dataSource;
        _httpClientFactory = httpClientFactory;
        _configuration = configuration;
        _logger = logger;
    }

    private TimeSpan FetchInterval =>
        TimeSpan.FromHours(double.TryParse(_configuration["Weather:FetchIntervalHours"], out var hours) && hours > 0
            ? hours
            : 6.0);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation(
            "Weather collection starting; interval {Hours}h, source Open-Meteo (free, no API key)",
            FetchInterval.TotalHours);

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await CollectOnceAsync(stoppingToken);
            }
            catch (OperationCanceledException)
            {
                break;
            }
            catch (Exception ex)
            {
                // A second safety net: CollectOnceAsync already handles per-farm failures, and this
                // catches structural ones (e.g. the farm list query failing) so the loop keeps running.
                _logger.LogError(ex, "Weather collection cycle failed; will retry next interval");
            }

            try
            {
                await Task.Delay(FetchInterval, stoppingToken);
            }
            catch (OperationCanceledException)
            {
                break;
            }
        }
    }

    // Public so an admin endpoint or a manual trigger can run one cycle without waiting.
    public async Task CollectOnceAsync(CancellationToken ct)
    {
        await using var connection = await _dataSource.OpenConnectionAsync(ct);

        var farms = await FetchFarmsAsync(connection, ct);
        if (farms.Count == 0)
        {
            _logger.LogInformation("Weather collection: no farms found");
            return;
        }

        var withCoordinates = 0;
        var succeeded = 0;
        var rowsWritten = 0;

        // Today in SAST, not UTC: for part of the day they differ, and is_forecast depends
        // on this date.
        var today = DateOnly.FromDateTime(DateTime.UtcNow.AddHours(2));

        foreach (var farm in farms)
        {
            if (ct.IsCancellationRequested) break;

            if (!farm.Latitude.HasValue || !farm.Longitude.HasValue)
            {
                // Quietly, and only once, not every cycle.
                if (_farmsReportedWithoutCoordinates.Add(farm.FarmId))
                {
                    _logger.LogInformation(
                        "Farm {FarmId} has no latitude/longitude, so no weather can be fetched and no ET0 can be computed for its zones. " +
                        "Set farm.latitude and farm.longitude to enable it. This is logged once per process, not every cycle.",
                        farm.FarmId);
                }
                continue;
            }

            withCoordinates++;

            try
            {
                var written = await CollectForFarmAsync(connection, farm, today, ct);
                rowsWritten += written;
                succeeded++;
            }
            catch (OperationCanceledException)
            {
                throw;
            }
            catch (Exception ex)
            {
                // Log and continue: one farm's bad coordinate or timeout must not stop the others.
                _logger.LogError(ex,
                    "Weather fetch failed for farm {FarmId}; continuing with the remaining farms", farm.FarmId);
            }
        }

        _logger.LogInformation(
            "Weather collection complete: {Succeeded}/{WithCoordinates} farms with coordinates updated, {Rows} weather_daily rows written ({Total} farms total)",
            succeeded, withCoordinates, rowsWritten, farms.Count);
    }

    private async Task<int> CollectForFarmAsync(
        NpgsqlConnection connection, FarmLocation farm, DateOnly today, CancellationToken ct)
    {
        var url = OpenMeteoDailyParser.BuildForecastUrl(farm.Latitude!.Value, farm.Longitude!.Value);

        var client = _httpClientFactory.CreateClient();
        client.Timeout = TimeSpan.FromSeconds(30);

        var response = await client.GetAsync(url, ct);
        response.EnsureSuccessStatusCode();

        var json = await response.Content.ReadAsStringAsync(ct);
        var rows = OpenMeteoDailyParser.Parse(json, today);

        var written = 0;
        foreach (var row in rows)
        {
            // A row without a usable temperature pair cannot give ET0; storing it would leave
            // a hole that looks like data.
            if (!row.HasUsableTemperatures) continue;

            await UpsertWeatherDailyAsync(connection, farm.FarmId, row, OpenMeteoDailyParser.ForecastSource, ct);
            written++;
        }

        _logger.LogDebug("Farm {FarmId}: {Rows} weather_daily rows upserted", farm.FarmId, written);
        return written;
    }

    // The upsert that turns forecasts into actuals. The WHERE on DO UPDATE matters: an
    // incoming actual always wins, but a forecast may only replace another forecast, so a
    // run just after midnight cannot overwrite yesterday's observations with a model value.
    private static async Task UpsertWeatherDailyAsync(
        NpgsqlConnection connection, long farmId, WeatherDailyRow row, string source, CancellationToken ct)
    {
        await using var cmd = new NpgsqlCommand(
            // rh_min_pct / rh_max_pct / wind_ms / wind_height_m are for Penman-Monteith (0027);
            // the same call already returns them.
            "insert into weather_daily " +
            "  (farm_id, date, tmin_c, tmax_c, precipitation_mm, humidity_mean, is_forecast, fetched_at, source, " +
            "   rh_min_pct, rh_max_pct, wind_ms, wind_height_m) " +
            "values ($1, $2, $3, $4, $5, $6, $7, now(), $8, $9, $10, $11, $12) " +
            "on conflict (farm_id, date) do update set " +
            "  tmin_c = excluded.tmin_c, " +
            "  tmax_c = excluded.tmax_c, " +
            "  precipitation_mm = excluded.precipitation_mm, " +
            "  humidity_mean = excluded.humidity_mean, " +
            "  is_forecast = excluded.is_forecast, " +
            "  fetched_at = excluded.fetched_at, " +
            "  source = excluded.source, " +
            "  rh_min_pct = excluded.rh_min_pct, " +
            "  rh_max_pct = excluded.rh_max_pct, " +
            "  wind_ms = excluded.wind_ms, " +
            "  wind_height_m = excluded.wind_height_m " +
            "where excluded.is_forecast = false or weather_daily.is_forecast = true",
            connection);

        cmd.Parameters.AddWithValue(farmId);
        cmd.Parameters.AddWithValue(row.Date);
        cmd.Parameters.AddWithValue((object?)(float?)row.TMinC ?? DBNull.Value);
        cmd.Parameters.AddWithValue((object?)(float?)row.TMaxC ?? DBNull.Value);
        cmd.Parameters.AddWithValue((object?)(float?)row.PrecipitationMm ?? DBNull.Value);
        cmd.Parameters.AddWithValue((object?)(float?)row.HumidityMean ?? DBNull.Value);
        cmd.Parameters.AddWithValue(row.IsForecast);
        cmd.Parameters.AddWithValue(source);
        cmd.Parameters.AddWithValue((object?)(float?)row.RhMinPct ?? DBNull.Value);
        cmd.Parameters.AddWithValue((object?)(float?)row.RhMaxPct ?? DBNull.Value);
        cmd.Parameters.AddWithValue((object?)(float?)row.WindMs ?? DBNull.Value);
        cmd.Parameters.AddWithValue((object?)(float?)row.WindHeightM ?? DBNull.Value);

        await cmd.ExecuteNonQueryAsync(ct);
    }

    private static async Task<List<FarmLocation>> FetchFarmsAsync(NpgsqlConnection connection, CancellationToken ct)
    {
        var farms = new List<FarmLocation>();

        // farm's primary key is farm_id, not id (0001). latitude/longitude come from 0010
        // and are nullable.
        await using var cmd = new NpgsqlCommand(
            "select farm_id, latitude, longitude from farm order by farm_id", connection);

        await using var reader = await cmd.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct))
        {
            farms.Add(new FarmLocation(
                reader.GetInt64(0),
                reader.IsDBNull(1) ? null : reader.GetDouble(1),
                reader.IsDBNull(2) ? null : reader.GetDouble(2)));
        }

        return farms;
    }

    private sealed record FarmLocation(long FarmId, double? Latitude, double? Longitude);
}
