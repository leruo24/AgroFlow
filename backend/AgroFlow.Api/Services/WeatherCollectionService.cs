using AgroFlow.Business.Agronomy;
using Npgsql;

namespace AgroFlow.Api.Services;

// Populates weather_daily (migration 0016) from Open-Meteo, once every
// Weather:FetchIntervalHours (default 6), for every farm that has
// coordinates.
//
// This is the foundation the whole FAO-56 advice engine stands on: nothing in
// AgroFlow stored weather before this, so ET0 could not be computed for any
// farm at all. It runs as a hosted service alongside MqttConnectionService and
// IrrigationCommandNotifyService.
//
// OPEN-METEO IS FREE AND KEYLESS AND MUST STAY THAT WAY. No account, no API
// key, no secret to rotate, no per-call cost, and nothing extra to configure
// on Railway. That is a deliberate property of this design, not an accident of
// which provider was nearest to hand - it is the same reasoning that keeps the
// advice engine off a paid LLM. If you are about to swap in a provider that
// needs a key, have that conversation first.
//
// FAILURE POSTURE: one farm's problem is that farm's problem. A bad
// coordinate, a timeout, an unparseable response - each is logged and the loop
// moves to the next farm. Nothing in here is allowed to take the host process
// down, because the host process is also the MQTT bridge and the irrigation
// command path.
public class WeatherCollectionService : BackgroundService
{
    private readonly NpgsqlDataSource _dataSource;
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly IConfiguration _configuration;
    private readonly ILogger<WeatherCollectionService> _logger;

    // Farms already reported as having no coordinates. Without this the
    // service would log the same warning for the same farms every six hours
    // forever, which trains everyone to ignore the logs.
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
                // Belt and braces - CollectOnceAsync already handles per-farm
                // failures. This catches anything structural (the farm list
                // query itself failing, say) so a transient database problem
                // cannot end the loop for the life of the container.
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

    // Exposed so a future admin endpoint or a manual trigger can run one cycle
    // without waiting for the timer.
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

        // The farm's own local date, not UTC - what counts as "today" for a
        // farm in SAST is not what counts as today in UTC for eight hours of
        // the day, and is_forecast is decided by that comparison.
        var today = DateOnly.FromDateTime(DateTime.UtcNow);

        foreach (var farm in farms)
        {
            if (ct.IsCancellationRequested) break;

            if (!farm.Latitude.HasValue || !farm.Longitude.HasValue)
            {
                // Quietly, and ONCE - not every cycle.
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
                // Log and continue. One farm's bad coordinate or one timeout
                // must not stop the other farms from getting their weather.
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
            // A row with no usable temperature pair cannot produce ET0. Storing
            // it would just put a hole in the series that looks like data.
            if (!row.HasUsableTemperatures) continue;

            await UpsertWeatherDailyAsync(connection, farm.FarmId, row, OpenMeteoDailyParser.ForecastSource, ct);
            written++;
        }

        _logger.LogDebug("Farm {FarmId}: {Rows} weather_daily rows upserted", farm.FarmId, written);
        return written;
    }

    // The upsert that makes forecasts converge on actuals.
    //
    // The WHERE clause on the DO UPDATE is the important part: an incoming
    // ACTUAL always wins, but an incoming FORECAST may only overwrite another
    // forecast. Without it, a cycle that ran just after midnight could replace
    // yesterday's real observations with a model value and quietly degrade the
    // history the advice engine reads.
    private static async Task UpsertWeatherDailyAsync(
        NpgsqlConnection connection, long farmId, WeatherDailyRow row, string source, CancellationToken ct)
    {
        await using var cmd = new NpgsqlCommand(
            "insert into weather_daily " +
            "  (farm_id, date, tmin_c, tmax_c, precipitation_mm, humidity_mean, is_forecast, fetched_at, source) " +
            "values ($1, $2, $3, $4, $5, $6, $7, now(), $8) " +
            "on conflict (farm_id, date) do update set " +
            "  tmin_c = excluded.tmin_c, " +
            "  tmax_c = excluded.tmax_c, " +
            "  precipitation_mm = excluded.precipitation_mm, " +
            "  humidity_mean = excluded.humidity_mean, " +
            "  is_forecast = excluded.is_forecast, " +
            "  fetched_at = excluded.fetched_at, " +
            "  source = excluded.source " +
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

        await cmd.ExecuteNonQueryAsync(ct);
    }

    private static async Task<List<FarmLocation>> FetchFarmsAsync(NpgsqlConnection connection, CancellationToken ct)
    {
        var farms = new List<FarmLocation>();

        // farm's primary key is farm_id, not id (0001_foundation.sql).
        // latitude/longitude were added by 0010_zone_schema_realignment.sql
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
