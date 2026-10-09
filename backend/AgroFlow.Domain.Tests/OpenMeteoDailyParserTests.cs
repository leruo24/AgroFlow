using AgroFlow.Business.Agronomy;

namespace AgroFlow.Domain.Tests;

// Parsing of Open-Meteo's daily response. All fabricated payloads - no network
// call is made by any test here.
public class OpenMeteoDailyParserTests
{
    private static readonly DateOnly Today = new(2026, 1, 20);

    private const string TypicalResponse = """
    {
      "latitude": -33.9,
      "longitude": 18.4,
      "timezone": "Africa/Johannesburg",
      "daily": {
        "time": ["2026-01-18", "2026-01-19", "2026-01-20", "2026-01-21", "2026-01-22"],
        "temperature_2m_max": [27.4, 28.9, 31.0, 30.2, 24.1],
        "temperature_2m_min": [15.1, 14.8, 14.0, 15.5, 13.9],
        "precipitation_sum": [0.0, 0.0, 0.0, 0.2, 8.4],
        "relative_humidity_2m_mean": [61.0, 58.0, 55.0, 60.0, 78.0]
      }
    }
    """;

    [Fact]
    public void ParsesEveryDayInTheResponse()
    {
        var rows = OpenMeteoDailyParser.Parse(TypicalResponse, Today);
        Assert.Equal(5, rows.Count);
    }

    [Fact]
    public void ZipsTheParallelArraysByIndex()
    {
        // The response is column-oriented - a misalignment here would silently
        // attach Monday's rainfall to Tuesday's temperatures.
        var rows = OpenMeteoDailyParser.Parse(TypicalResponse, Today);
        var thursday = rows.Single(r => r.Date == new DateOnly(2026, 1, 22));

        Assert.Equal(24.1, thursday.TMaxC);
        Assert.Equal(13.9, thursday.TMinC);
        Assert.Equal(8.4, thursday.PrecipitationMm);
        Assert.Equal(78.0, thursday.HumidityMean);
    }

    [Fact]
    public void PastDaysAreActuals_AndTodayOnwardsAreForecasts()
    {
        // Today's own row counts as a forecast because it is still partly
        // predicted when fetched mid-morning; the (farm_id, date) upsert key
        // replaces it with actuals on a later cycle.
        var rows = OpenMeteoDailyParser.Parse(TypicalResponse, Today);

        Assert.False(rows.Single(r => r.Date == new DateOnly(2026, 1, 18)).IsForecast);
        Assert.False(rows.Single(r => r.Date == new DateOnly(2026, 1, 19)).IsForecast);
        Assert.True(rows.Single(r => r.Date == Today).IsForecast);
        Assert.True(rows.Single(r => r.Date == new DateOnly(2026, 1, 21)).IsForecast);
    }

    [Fact]
    public void TreatAllAsActuals_MarksNothingAsForecast()
    {
        // What the archive backfill passes: ERA5 rows are reanalysis, never
        // predictions. Marking them forecast would make the collector's upsert
        // guard refuse to let real forecasts replace them later.
        var rows = OpenMeteoDailyParser.Parse(TypicalResponse, Today, treatAllAsActuals: true);
        Assert.All(rows, r => Assert.False(r.IsForecast));
    }

    [Fact]
    public void NullValuesInAnArray_BecomeNullsNotZeroes()
    {
        // Open-Meteo returns null for a variable it has no data for on a given
        // day. Reading that as 0.0 would mean "it did not rain" and "it was
        // freezing", both wrong.
        const string withNulls = """
        {
          "daily": {
            "time": ["2026-01-20"],
            "temperature_2m_max": [null],
            "temperature_2m_min": [14.0],
            "precipitation_sum": [null],
            "relative_humidity_2m_mean": [null]
          }
        }
        """;

        var row = OpenMeteoDailyParser.Parse(withNulls, Today).Single();

        Assert.Null(row.TMaxC);
        Assert.Equal(14.0, row.TMinC);
        Assert.Null(row.PrecipitationMm);
        Assert.Null(row.HumidityMean);
        Assert.False(row.HasUsableTemperatures);
    }

    [Fact]
    public void AMissingVariableEntirely_IsToleratedRatherThanThrowing()
    {
        // The archive endpoint does not serve relative_humidity_2m_mean as a
        // daily aggregate, so it is simply absent from the response.
        const string noHumidity = """
        {
          "daily": {
            "time": ["2026-01-20"],
            "temperature_2m_max": [31.0],
            "temperature_2m_min": [14.0],
            "precipitation_sum": [0.0]
          }
        }
        """;

        var row = OpenMeteoDailyParser.Parse(noHumidity, Today).Single();

        Assert.Null(row.HumidityMean);
        Assert.True(row.HasUsableTemperatures);
    }

    [Fact]
    public void ShortArrays_DoNotThrowOnTheMissingTail()
    {
        const string ragged = """
        {
          "daily": {
            "time": ["2026-01-20", "2026-01-21", "2026-01-22"],
            "temperature_2m_max": [31.0],
            "temperature_2m_min": [14.0],
            "precipitation_sum": []
          }
        }
        """;

        var rows = OpenMeteoDailyParser.Parse(ragged, Today);

        Assert.Equal(3, rows.Count);
        Assert.True(rows[0].HasUsableTemperatures);
        Assert.False(rows[2].HasUsableTemperatures);
    }

    [Fact]
    public void AnUnparseableDate_SkipsThatRowRatherThanFailingTheWholeFetch()
    {
        const string badDate = """
        {
          "daily": {
            "time": ["2026-01-20", "not-a-date", "2026-01-22"],
            "temperature_2m_max": [31.0, 30.0, 24.0],
            "temperature_2m_min": [14.0, 15.0, 13.0],
            "precipitation_sum": [0.0, 0.0, 8.0]
          }
        }
        """;

        var rows = OpenMeteoDailyParser.Parse(badDate, Today);

        Assert.Equal(2, rows.Count);
        // ...and the surviving rows keep their correct column alignment.
        Assert.Equal(24.0, rows.Single(r => r.Date == new DateOnly(2026, 1, 22)).TMaxC);
    }

    [Fact]
    public void AnOpenMeteoErrorResponse_ThrowsWithItsOwnReason()
    {
        const string error = """
        {"error": true, "reason": "Latitude must be in range of -90 to 90."}
        """;

        var ex = Assert.Throws<InvalidOperationException>(() => OpenMeteoDailyParser.Parse(error, Today));
        Assert.Contains("Latitude must be in range", ex.Message);
    }

    [Fact]
    public void AResponseWithNoDailyBlock_Throws()
    {
        Assert.Throws<InvalidOperationException>(() => OpenMeteoDailyParser.Parse("{}", Today));
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public void AnEmptyResponse_Throws(string json)
    {
        Assert.Throws<ArgumentException>(() => OpenMeteoDailyParser.Parse(json, Today));
    }

    [Fact]
    public void TmaxBelowTmin_IsNotTreatedAsUsable()
    {
        // Eq. 52 takes the square root of (Tmax - Tmin). Letting this through
        // would throw deep inside the advisor instead of being dropped here.
        const string inverted = """
        {"daily": {"time": ["2026-01-20"], "temperature_2m_max": [10.0], "temperature_2m_min": [25.0]}}
        """;

        Assert.False(OpenMeteoDailyParser.Parse(inverted, Today).Single().HasUsableTemperatures);
    }

    // ---- URL construction ----------------------------------------------------

    [Fact]
    public void ForecastUrl_IsKeylessAndAsksForWhatTheParserReads()
    {
        var url = OpenMeteoDailyParser.BuildForecastUrl(-33.9249, 18.4241);

        Assert.StartsWith("https://api.open-meteo.com/v1/forecast", url);
        Assert.Contains("latitude=-33.9249", url);
        Assert.Contains("longitude=18.4241", url);
        Assert.Contains("temperature_2m_max", url);
        Assert.Contains("temperature_2m_min", url);
        Assert.Contains("precipitation_sum", url);
        Assert.Contains("past_days=2", url);
        Assert.Contains("forecast_days=8", url);
        Assert.Contains("wind_speed_10m_mean", url);
        Assert.DoesNotContain("wind_speed_10m_max", url);

        // No API key, no token, no account. Keeping it that way is deliberate.
        Assert.DoesNotContain("apikey", url, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("key=", url, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("token", url, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void ParsesDailyMeanWind_NotDailyMaximum()
    {
        const string json = """
        {"daily":{"time":["2026-01-20"],"temperature_2m_max":[30],"temperature_2m_min":[15],
        "wind_speed_10m_mean":[2.4],"wind_speed_10m_max":[9.8]}}
        """;
        var row = OpenMeteoDailyParser.Parse(json, Today).Single();
        Assert.Equal(2.4, row.WindMs);
        Assert.Equal(10, row.WindHeightM);
    }

    [Fact]
    public void ForecastUrl_FormatsCoordinatesInvariantly()
    {
        // A comma-decimal locale would produce "latitude=-33,9249" and split
        // the query string. Pinning this is not paranoia - the server locale
        // is not ours to choose.
        var url = OpenMeteoDailyParser.BuildForecastUrl(-33.9249, 18.4241);
        Assert.DoesNotContain("-33,9249", url);
    }

    [Fact]
    public void ArchiveUrl_UsesTheArchiveHostAndOmitsHumidity()
    {
        var url = OpenMeteoDailyParser.BuildArchiveUrl(
            -33.9249, 18.4241, new DateOnly(2024, 1, 1), new DateOnly(2024, 12, 31));

        Assert.StartsWith("https://archive-api.open-meteo.com/v1/archive", url);
        Assert.Contains("start_date=2024-01-01", url);
        Assert.Contains("end_date=2024-12-31", url);
        // ERA5 does not serve this as a daily aggregate; asking would reject
        // the whole request for one unsupported variable.
        Assert.DoesNotContain("relative_humidity_2m_mean", url);
    }

    [Fact]
    public void ArchiveUrl_RejectsAnInvertedDateRange()
    {
        Assert.Throws<ArgumentException>(() => OpenMeteoDailyParser.BuildArchiveUrl(
            -33.9, 18.4, new DateOnly(2024, 12, 31), new DateOnly(2024, 1, 1)));
    }
}
