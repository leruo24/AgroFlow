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

        // Humidity and wind for FAO-56 Penman-Monteith (Eq. 6). All nullable: the archive
        // endpoint does not serve them, and Eq. 6 has documented fallbacks (see
        // DailyEtoResolver).
        // WindHeightM comes with WindMs because Open-Meteo measures wind at 10 m and Eq. 6
        // needs 2 m; Eq. 47 converts, but only with a known height.
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

        // A row with no temperatures cannot give ET0, so we do not store it. Rain alone is
        // still useful, so we only check the temperature pair.
        public bool HasUsableTemperatures => TMinC.HasValue && TMaxC.HasValue && TMaxC.Value >= TMinC.Value;
    }

    // Parses Open-Meteo's daily response into weather_daily rows.
    // Open-Meteo is free and needs no API key (see WeatherCollectionService); talk to the
    // team before switching to a provider that needs a secret.
    // The response is column-oriented:
    //
    //   { "daily": {
    //       "time":                ["2026-01-19", "2026-01-20", ...],
    //       "temperature_2m_max":  [28.4, 31.0, ...],
    //       "temperature_2m_min":  [14.1, 14.0, ...],
    //       "precipitation_sum":   [0.0, 0.0, ...]
    //   } }
    //
    // Parallel arrays zipped by index. Every array except "time" is optional and every
    // element nullable, because Open-Meteo returns null for missing data and leaves out
    // variables it does not support at a location.
    // Pure: no HTTP, clock or database, so it is unit-tested offline.
    public static class OpenMeteoDailyParser
    {
        public const string ForecastSource = "open-meteo-forecast";

        // Open-Meteo's wind_speed_10m_mean is measured at 10 m above ground.
        // FAO-56 Eq. 6 wants 2 m, so Eq. 47 converts using this height.
        public const double WindMeasurementHeightM = 10.0;
        public const string ArchiveSource = "open-meteo-archive";

        // The daily variables we ask for. temperature_2m_max/min are what FAO-56 Eq. 52
        // needs; precipitation_sum drives the rainfall outlook. Humidity (min/max/mean) and
        // mean wind are for Eq. 6 (Penman-Monteith) and come free in the same call.
        public const string DailyVariables =
            "temperature_2m_max,temperature_2m_min,precipitation_sum,relative_humidity_2m_mean," +
            "relative_humidity_2m_min,relative_humidity_2m_max,wind_speed_10m_mean";

        // The archive (ERA5) has no daily relative_humidity_2m_mean, so the backfill asks for
        // fewer variables instead of having the whole request rejected.
        public const string ArchiveDailyVariables =
            "temperature_2m_max,temperature_2m_min,precipitation_sum";

        // `today` decides which rows are forecasts. Today's row counts as a forecast because
        // it is still partly predicted; a later run overwrites it with actuals, using the
        // (farm_id, date) upsert key from migration 0016.
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

                // A row whose date does not parse cannot be stored, so we skip it instead of failing
                // the whole farm's fetch.
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
                        // Only set a measurement height when there is a wind value.
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

        // Builds the forecast URL. Kept next to the parser so the requested and parsed
        // variables always match.
        // past_days=2 fetches yesterday, so it arrives as actuals on the next run after being
        // stored as a forecast. forecast_days=8 gives today plus seven.
        public static string BuildForecastUrl(double latitude, double longitude)
        {
            return "https://api.open-meteo.com/v1/forecast"
                   + "?latitude=" + latitude.ToString("F4", CultureInfo.InvariantCulture)
                   + "&longitude=" + longitude.ToString("F4", CultureInfo.InvariantCulture)
                   + "&daily=" + DailyVariables
                   + "&past_days=2"
                   + "&forecast_days=8"
                   // FAO-56 uses m/s and Open-Meteo defaults to km/h, so we ask for m/s.
                   + "&wind_speed_unit=ms"
                   + "&timezone=auto";
        }

        // Builds the archive URL for the backfill: a different host (ERA5 reanalysis, not
        // the forecast model).
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
