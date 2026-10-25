#nullable enable
using System;
using System.Collections.Generic;
using System.Globalization;

namespace AgroFlow.Business.Agronomy
{
    // Turns one day's weather into an ETo figure, using a fallback order and recording
    // where every input came from, so a report can say whether "water for 4 minutes"
    // used measured wind or FAO-56's 2 m/s default. Every fallback adds a line to
    // Limitations; nothing is silently defaulted.
    // The values are 'weather_app' and 'weather_app_forecast' because our weather comes
    // from Open-Meteo (see WeatherCollectionService and OpenMeteoDailyParser).
    public static class EtoSources
    {
        public const string WeatherApp = "weather_app";
        public const string WeatherAppForecast = "weather_app_forecast";
        public const string Dht11 = "dht11";
        public const string Dht11Fallback = "dht11_fallback";
        public const string Default = "default";
        public const string Estimated = "estimated";
        public const string None = "none";
    }

    // One day's raw weather inputs, each nullable because each can be absent.
    public sealed class DailyEtoInputs
    {
        public DateOnly Date { get; set; }
        public double? LatitudeDegrees { get; set; }

        // From weather_daily.
        public double? WeatherTMinC { get; set; }
        public double? WeatherTMaxC { get; set; }
        public double? WeatherRhMinPct { get; set; }
        public double? WeatherRhMaxPct { get; set; }
        public double? WeatherRhMeanPct { get; set; }
        public double? WeatherWindMs { get; set; }
        public double? WeatherWindHeightM { get; set; }
        public bool WeatherIsForecast { get; set; }
        public bool HasWeatherRow { get; set; }

        // From the dht_daily view, only used when the weather app has no usable temperature.
        public double? DhtTMinC { get; set; }
        public double? DhtTMaxC { get; set; }
        public double? DhtRhMeanPct { get; set; }

        // Null means we have no reliable farm elevation, so standard air pressure is used
        // (and labelled); we never invent an elevation.
        public double? ElevationM { get; set; }
    }

    public sealed class DailyEtoResult
    {
        // Null when no source has a usable temperature for the day. The caller then writes a
        // data_gap insight and carries Dr forward, never a made-up number.
        public double? EtoMm { get; set; }

        public string EtoSource { get; set; } = EtoSources.None;
        public string RsSource { get; set; } = EtoSources.None;
        public string WindSource { get; set; } = EtoSources.None;
        public string HumiditySource { get; set; } = EtoSources.None;
        public string TemperatureSource { get; set; } = EtoSources.None;

        // True when any input was defaulted or estimated; saved to
        // zone_water_balance.incomplete so a report can mark the day.
        public bool Incomplete { get; set; }

        // Farmer-readable, one line per fallback used. Goes into ZoneAdvice.Limitations.
        public List<string> Limitations { get; } = new List<string>();

        // The intermediate values, for report Facts and for checking by hand.
        public double? TMinC { get; set; }
        public double? TMaxC { get; set; }
        public double? Wind2MMs { get; set; }
        public double? RadiationMj { get; set; }
        public double? NetRadiationMj { get; set; }
        public double? ActualVapourPressureKpa { get; set; }
        public double? SaturationVapourPressureKpa { get; set; }
    }

    public static class DailyEtoResolver
    {
        // FAO-56 Table 15 gives 2 m/s for "general global conditions", the value the book
        // suggests when there is no wind data (p. 63).
        public const double DefaultWindSpeedMs = 2.0;
        public const double DefaultWindHeightM = 2.0;

        // Plausibility limits: outside these a value counts as missing.
        public const double MinPlausibleTempC = -20.0;
        public const double MaxPlausibleTempC = 55.0;
        public const double MaxPlausibleWindMs = 60.0;

        private static bool PlausibleTemp(double? t)
        {
            return t.HasValue && t.Value >= MinPlausibleTempC && t.Value <= MaxPlausibleTempC;
        }

        private static bool PlausibleRh(double? rh)
        {
            return rh.HasValue && rh.Value >= 0.0 && rh.Value <= 100.0;
        }

        private static bool PlausibleWind(double? w)
        {
            return w.HasValue && w.Value >= 0.0 && w.Value <= MaxPlausibleWindMs;
        }

        public static DailyEtoResult Resolve(DailyEtoInputs inputs)
        {
            if (inputs == null) throw new ArgumentNullException(nameof(inputs));

            var result = new DailyEtoResult();

            // 1. Temperature: weather app, then DHT11, then give up
            double tMin, tMax;

            var weatherTempUsable =
                PlausibleTemp(inputs.WeatherTMinC) && PlausibleTemp(inputs.WeatherTMaxC)
                && inputs.WeatherTMaxC!.Value >= inputs.WeatherTMinC!.Value;

            var dhtTempUsable =
                PlausibleTemp(inputs.DhtTMinC) && PlausibleTemp(inputs.DhtTMaxC)
                && inputs.DhtTMaxC!.Value >= inputs.DhtTMinC!.Value;

            if (weatherTempUsable)
            {
                tMin = inputs.WeatherTMinC!.Value;
                tMax = inputs.WeatherTMaxC!.Value;
                result.TemperatureSource = inputs.WeatherIsForecast
                    ? EtoSources.WeatherAppForecast
                    : EtoSources.WeatherApp;
            }
            else if (dhtTempUsable)
            {
                tMin = inputs.DhtTMinC!.Value;
                tMax = inputs.DhtTMaxC!.Value;
                result.TemperatureSource = EtoSources.Dht11Fallback;
                result.Incomplete = true;
                result.Limitations.Add(
                    "No weather-app temperature for " + Iso(inputs.Date) +
                    ", so the zone's own temperature sensor readings were used instead. " +
                    "FAO-56 defines this calculation for standard weather-station conditions, not a zone's local crop microclimate, so the figure is less reliable.");
            }
            else
            {
                // No temperature from either source means no ETo: carry Dr forward, raise data_gap,
                // and make nothing up.
                result.EtoSource = EtoSources.None;
                result.Incomplete = true;
                result.Limitations.Add(
                    "No usable temperature for " + Iso(inputs.Date) +
                    " from the weather app or the zone's sensor, so no water-use figure could be worked out for that day.");
                return result;
            }

            result.TMinC = tMin;
            result.TMaxC = tMax;

            // 2. Latitude: needed for Ra, and there is no substitute
            if (!inputs.LatitudeDegrees.HasValue)
            {
                result.EtoSource = EtoSources.None;
                result.Incomplete = true;
                result.Limitations.Add(
                    "This farm has no location saved, so the amount of sunshine it receives cannot be worked out and no water-use figure is available. Add the farm location.");
                return result;
            }

            var latitude = inputs.LatitudeDegrees.Value;
            var dayOfYear = inputs.Date.DayOfYear;

            // 3. Radiation: always estimated with Eq. 50 from the temperature range
            //    (we have no pyranometer).
            var ra = ReferenceEvapotranspiration.ExtraterrestrialRadiationMj(latitude, dayOfYear);
            var rs = PenmanMonteithEto.SolarRadiationFromTemperatureRangeMj(tMin, tMax, ra);
            var rso = PenmanMonteithEto.ClearSkySolarRadiationMj(ra);

            result.RadiationMj = rs;
            result.RsSource = EtoSources.Estimated;
            result.Incomplete = true;
            result.Limitations.Add(
                "Sunshine was estimated from the day's high and low temperature (FAO-56 Eq. 50); there is no sunlight sensor on any AgroFlow farm.");

            // 4. Wind: weather app, else FAO-56's 2 m/s
            double wind2M;
            if (PlausibleWind(inputs.WeatherWindMs))
            {
                var height = inputs.WeatherWindHeightM.HasValue && inputs.WeatherWindHeightM.Value > 0.0
                    ? inputs.WeatherWindHeightM.Value
                    : DefaultWindHeightM;

                wind2M = PenmanMonteithEto.WindSpeedAt2M(inputs.WeatherWindMs!.Value, height);
                result.WindSource = inputs.WeatherIsForecast
                    ? EtoSources.WeatherAppForecast
                    : EtoSources.WeatherApp;
            }
            else
            {
                wind2M = DefaultWindSpeedMs;
                result.WindSource = EtoSources.Default;
                result.Incomplete = true;
                result.Limitations.Add(
                    "Wind speed was not available, so FAO-56's general default of 2 m/s was used (Table 15).");
            }

            result.Wind2MMs = wind2M;

            // 5. Humidity: RHmax/RHmin, else RHmean, else DHT11, else estimated from the
            //    temperatures with Eq. 64
            var es = PenmanMonteithEto.MeanSaturationVapourPressureKpa(tMin, tMax);
            double ea;

            if (PlausibleRh(inputs.WeatherRhMaxPct) && PlausibleRh(inputs.WeatherRhMinPct))
            {
                ea = PenmanMonteithEto.ActualVapourPressureFromRhMaxMinKpa(
                    tMin, tMax, inputs.WeatherRhMaxPct!.Value, inputs.WeatherRhMinPct!.Value);
                result.HumiditySource = inputs.WeatherIsForecast
                    ? EtoSources.WeatherAppForecast
                    : EtoSources.WeatherApp;
            }
            else if (PlausibleRh(inputs.WeatherRhMeanPct))
            {
                ea = PenmanMonteithEto.ActualVapourPressureFromRhMeanKpa(
                    tMin, tMax, inputs.WeatherRhMeanPct!.Value);
                result.HumiditySource = inputs.WeatherIsForecast
                    ? EtoSources.WeatherAppForecast
                    : EtoSources.WeatherApp;
            }
            else if (PlausibleRh(inputs.DhtRhMeanPct))
            {
                ea = PenmanMonteithEto.ActualVapourPressureFromRhMeanKpa(
                    tMin, tMax, inputs.DhtRhMeanPct!.Value);
                result.HumiditySource = EtoSources.Dht11Fallback;
                result.Incomplete = true;
                result.Limitations.Add(
                    "Humidity came from the zone's own sensor rather than the weather app for " + Iso(inputs.Date) + ".");
            }
            else
            {
                // FAO-56 Eq. 64 / Eq. 48: estimate RHmin from the temperatures and take ea as the
                // saturation pressure at Tmin.
                var rhMinEstimate = PenmanMonteithEto.EstimateRhMinFromTemperaturesPct(tMin, tMax);
                ea = PenmanMonteithEto.ActualVapourPressureFromTMinKpa(tMin);
                result.HumiditySource = EtoSources.Estimated;
                result.Incomplete = true;
                result.Limitations.Add(
                    "Humidity was not available from the weather app or the zone sensor, so it was estimated from the day's temperatures (FAO-56 Eq. 64; estimated lowest humidity "
                    + rhMinEstimate.ToString("F0", CultureInfo.InvariantCulture) + "%).");
            }

            // ea cannot be more than es (air wetter than saturated). It can happen when ea is
            // estimated on a day with almost no temperature range.
            if (ea > es) ea = es;

            result.SaturationVapourPressureKpa = es;
            result.ActualVapourPressureKpa = ea;

            // 6. Net radiation and ETo
            var rns = PenmanMonteithEto.NetShortwaveRadiationMj(rs);
            var rnl = PenmanMonteithEto.NetLongwaveRadiationMj(tMin, tMax, ea, rs, rso);
            var rn = PenmanMonteithEto.NetRadiationMj(rns, rnl);
            result.NetRadiationMj = rn;

            var tMean = (tMin + tMax) / 2.0;
            double pressure;
            if (inputs.ElevationM.HasValue)
            {
                pressure = PenmanMonteithEto.AtmosphericPressureKpa(inputs.ElevationM.Value);
            }
            else
            {
                pressure = PenmanMonteithEto.AtmosphericPressureKpa(0.0);
                result.Incomplete = true;
                result.Limitations.Add(
                    "Farm elevation is not available, so standard atmospheric pressure was used; no elevation was guessed.");
            }
            var gamma = PenmanMonteithEto.PsychrometricConstantKpaPerC(pressure);
            var slope = PenmanMonteithEto.SaturationSlopeKpaPerC(tMean);

            var eto = PenmanMonteithEto.Eto(
                netRadiationMj: rn,
                soilHeatFluxMj: 0.0,
                tMeanC: tMean,
                windSpeed2MMs: wind2M,
                saturationVapourPressureKpa: es,
                actualVapourPressureKpa: ea,
                psychrometricConstantKpaPerC: gamma,
                saturationSlopeKpaPerC: slope);

            result.EtoMm = eto;

            // The headline source is the weakest link: a day whose temperature came from the
            // zone's own sensor is a dht11_fallback day, whatever the wind source.
            result.EtoSource = result.TemperatureSource == EtoSources.Dht11Fallback
                ? EtoSources.Dht11Fallback
                : result.TemperatureSource;

            if (ReferenceEvapotranspiration.IsBeyondReliableLatitude(latitude))
            {
                result.Limitations.Add(
                    "This farm is beyond 55 degrees latitude, where FAO-56 warns the sunshine equations are less reliable in winter.");
            }

            return result;
        }

        private static string Iso(DateOnly date)
        {
            return date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
        }
    }
}
