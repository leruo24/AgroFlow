#nullable enable
using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text.Json;

namespace AgroFlow.Business.Agronomy
{
    // One row destined for the weather_daily table (migration 0016).
    public sealed class WeatherDailyRow
    {
        public DateOnly Date { get; }
        public double? TMinC { get; }
        public double? TMaxC { get; }
        public double? PrecipitationMm { get; }
        public double? HumidityMean { get; }
        public bool IsForecast { get; }

        // Added for FAO-56 Penman-Monteith (Eq. 6), which needs humidity and wind
        // as well as temperature. All nullable: the archive endpoint does not
        // serve them, and Eq. 6 has documented fallbacks for each (see
        // DailyEtoResolver).
        //
        // WindHeightM travels with WindMs because Open-Meteo measures wind at
        // 10 m while Eq. 6 is defined at 2 m - Eq. 47 converts, but only if the
        // height is known rather than assumed.
        public double? RhMinPct { get; }
        public double? RhMaxPct { get; }
        public double? WindMs { get; }
        public double? WindHeightM { get; }

        public WeatherDailyRow(
            DateOnly date, double? tMinC, double? tMaxC, double? precipitationMm, double? humidityMean, bool isForecast,
            double? rhMinPct = null, double? rhMaxPct = null, double? windMs = null, double? windHeightM = null)
        {
            Date = date;
            TMinC = tMinC;
            TMaxC = tMaxC;
            PrecipitationMm = precipitationMm;
            HumidityMean = humidityMean;
            IsForecast = isForecast;
            RhMinPct = rhMinPct;
            RhMaxPct = rhMaxPct;
            WindMs = windMs;
            WindHeightM = windHeightM;
        }

        // A row with no temperatures cannot produce ET0, so there is no point
        // storing it. Rainfall alone is still worth keeping, hence the check
        // is on the pair rather than on everything.
        public bool HasUsableTemperatures => TMinC.HasValue && TMaxC.HasValue && TMaxC.Value >= TMinC.Value;
    }

    // Parses Open-Meteo's daily response into weather_daily rows.
    //
    // Open-Meteo is free, requires no API key and no account, and asks only
    // for attribution for its non-commercial tier. Keeping it keyless is
    // deliberate - see WeatherCollectionService. Do not "upgrade" this to a
    // provider that needs a secret without a conversation first.
    //
    // The response shape is column-oriented, not row-oriented:
    //
    //   { "daily": {
    //       "time":                ["2026-01-19", "2026-01-20", ...],
    //       "temperature_2m_max":  [28.4, 31.0, ...],
    //       "temperature_2m_min":  [14.1, 14.0, ...],
    //       "precipitation_sum":   [0.0, 0.0, ...]
    //   } }
    //
    // Parallel arrays that must be zipped by index. Every array except "time"
    // is treated as optional and every element as nullable, because Open-Meteo
    // returns null for a variable it has no data for on a given day, and
    // simply omits a variable it does not support at that location. Assuming
    // otherwise is how this would throw at 3am on a farm near the coast.
    //
    // Pure: takes a string, returns rows. No HTTP, no clock, no database -
    // which is why it lives in the domain and is unit-tested offline.
    public static class OpenMeteoDailyParser
    {
        public const string ForecastSource = "open-meteo-forecast";

        // Open-Meteo's wind_speed_10m_mean is measured at 10 m above ground.
        // FAO-56 Eq. 6 wants 2 m, so Eq. 47 converts using this height.
        public const double WindMeasurementHeightM = 10.0;
        public const string ArchiveSource = "open-meteo-archive";

        // The daily variables AgroFlow asks for. temperature_2m_max/min are
        // what FAO-56 Eq. 52 needs; precipitation_sum drives the rainfall
        // outlook. Humidity is collected because it is free from the same call
        // and useful for display - Hargreaves does not use it.
        // relative_humidity_2m_min/max and daily mean wind_speed_10m_mean are used for
        // FAO-56 Eq. 6 (Penman-Monteith). They come from the same free call that
        // already fetched the temperatures, so this costs nothing extra.
        public const string DailyVariables =
            "temperature_2m_max,temperature_2m_min,precipitation_sum,relative_humidity_2m_mean," +
            "relative_humidity_2m_min,relative_humidity_2m_max,wind_speed_10m_mean";

        // Archive (ERA5) does not serve relative_humidity_2m_mean as a daily
        // aggregate, so the backfill asks for a narrower set rather than
        // having the whole request rejected for one unsupported variable.
        public const string ArchiveDailyVariables =
            "temperature_2m_max,temperature_2m_min,precipitation_sum";

        // `today` decides which rows are forecasts. Today's own row is treated
        // as a forecast because it is still partly predicted when fetched
        // mid-morning; it is overwritten with actuals on a later cycle once
        // the day is in the past. That is exactly what the (farm_id, date)
        // upsert key in migration 0016 is for.
        public static IReadOnlyList<WeatherDailyRow> Parse(string json, DateOnly today, bool treatAllAsActuals = false)
        {
            if (string.IsNullOrWhiteSpace(json))
            {
                throw new ArgumentException("Open-Meteo response was empty.", nameof(json));
            }

            using var document = JsonDocument.Parse(json);

            if (!document.RootElement.TryGetProperty("daily", out var daily))
            {
                // Open-Meteo reports errors as {"error": true, "reason": "..."}.
                if (document.RootElement.TryGetProperty("reason", out var reason))
                {
                    throw new InvalidOperationException("Open-Meteo returned an error: " + reason.GetString());
                }

                throw new InvalidOperationException("Open-Meteo response contained no 'daily' block.");
            }

            if (!daily.TryGetProperty("time", out var timeArray) || timeArray.ValueKind != JsonValueKind.Array)
            {
                throw new InvalidOperationException("Open-Meteo 'daily' block contained no 'time' array.");
            }

            var maxTemps = ReadOptionalNumberArray(daily, "temperature_2m_max");
            var minTemps = ReadOptionalNumberArray(daily, "temperature_2m_min");
            var precipitation = ReadOptionalNumberArray(daily, "precipitation_sum");
            var humidity = ReadOptionalNumberArray(daily, "relative_humidity_2m_mean");
            var humidityMin = ReadOptionalNumberArray(daily, "relative_humidity_2m_min");
            var humidityMax = ReadOptionalNumberArray(daily, "relative_humidity_2m_max");
            var windMean = ReadOptionalNumberArray(daily, "wind_speed_10m_mean");

            var rows = new List<WeatherDailyRow>();
            var index = 0;

            foreach (var timeElement in timeArray.EnumerateArray())
            {
                var raw = timeElement.GetString();

                // A row whose date will not parse is unusable - there is
                // nothing to key it on. Skip it rather than failing the whole
                // farm's fetch for one bad element.
                if (DateOnly.TryParseExact(raw, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var date))
                {
                    rows.Add(new WeatherDailyRow(
                        date,
                        ValueAt(minTemps, index),
                        ValueAt(maxTemps, index),
                        ValueAt(precipitation, index),
                        ValueAt(humidity, index),
                        isForecast: !treatAllAsActuals && date >= today,
                        rhMinPct: ValueAt(humidityMin, index),
                        rhMaxPct: ValueAt(humidityMax, index),
                        windMs: ValueAt(windMean, index),
                        // Only claim a measurement height when there is a wind
                        // figure to attach it to.
                        windHeightM: ValueAt(windMean, index).HasValue ? WindMeasurementHeightM : (double?)null));
                }

                index++;
            }

            return rows;
        }

        private static List<double?>? ReadOptionalNumberArray(JsonElement parent, string name)
        {
            if (!parent.TryGetProperty(name, out var array) || array.ValueKind != JsonValueKind.Array)
            {
                return null; // variable not supported at this location, or not requested
            }

            var values = new List<double?>();
            foreach (var element in array.EnumerateArray())
            {
                values.Add(element.ValueKind == JsonValueKind.Number ? element.GetDouble() : (double?)null);
            }

            return values;
        }

        private static double? ValueAt(List<double?>? values, int index)
        {
            if (values == null || index >= values.Count) return null;
            return values[index];
        }

        // Builds the forecast-endpoint URL. Kept here beside the parser so the
        // requested variables and the parsed variables cannot drift apart.
        //
        // past_days=2 fetches yesterday (and the day before, cheaply) so that
        // yesterday's row arrives as ACTUALS on the next cycle after it was
        // last written as a forecast. forecast_days=8 gives today plus seven.
        public static string BuildForecastUrl(double latitude, double longitude)
        {
            return "https://api.open-meteo.com/v1/forecast"
                   + "?latitude=" + latitude.ToString("F4", CultureInfo.InvariantCulture)
                   + "&longitude=" + longitude.ToString("F4", CultureInfo.InvariantCulture)
                   + "&daily=" + DailyVariables
                   + "&past_days=2"
                   + "&forecast_days=8"
                   // FAO-56 works in m/s; Open-Meteo defaults to km/h, so ask
                   // for the unit rather than converting after the fact.
                   + "&wind_speed_unit=ms"
                   + "&timezone=auto";
        }

        // Builds the archive-endpoint URL used by the backfill. A different
        // host: ERA5 reanalysis, not the forecast model.
        public static string BuildArchiveUrl(double latitude, double longitude, DateOnly start, DateOnly end)
        {
            if (end < start)
            {
                throw new ArgumentException("Backfill end date is before the start date.", nameof(end));
            }

            return "https://archive-api.open-meteo.com/v1/archive"
                   + "?latitude=" + latitude.ToString("F4", CultureInfo.InvariantCulture)
                   + "&longitude=" + longitude.ToString("F4", CultureInfo.InvariantCulture)
                   + "&start_date=" + start.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)
                   + "&end_date=" + end.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)
                   + "&daily=" + ArchiveDailyVariables
                   + "&timezone=auto";
        }
    }
}
