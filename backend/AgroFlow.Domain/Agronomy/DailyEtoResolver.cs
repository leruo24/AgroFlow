#nullable enable
using System;
using System.Collections.Generic;
using System.Globalization;

namespace AgroFlow.Business.Agronomy
{
    // Turns one day's available weather into an ETo figure, following the fallback
    // order in spec section 3c and recording which source every input came from.
    //
    // THE POINT OF THE SOURCE STRINGS
    // -------------------------------
    // A farmer is told "water for 4 minutes". The report has to be able to say
    // whether that rested on measured wind or on FAO-56's 2 m/s default. So every
    // input carries provenance and every fallback leaves a line in Limitations.
    // Nothing is silently defaulted.
    //
    // NAMING NOTE: the spec writes these provenance values as 'owm'/'owm_forecast'
    // because it assumed OpenWeatherMap. AgroFlow's weather actually comes from
    // Open-Meteo (free, no API key - see WeatherCollectionService and
    // OpenMeteoDailyParser), so the values are 'weather_app' and
    // 'weather_app_forecast'. Recording 'owm' would put a provider name in the
    // database that never served the row.
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

        // From the dht_daily view, used only when the weather app has no usable
        // temperature for the day.
        public double? DhtTMinC { get; set; }
        public double? DhtTMaxC { get; set; }
        public double? DhtRhMeanPct { get; set; }

        // Elevation is not recorded per farm. FAO-56 Eq. 8 needs it for
        // atmospheric pressure; sea level is used and the effect is small
        // (gamma moves ~1% per 100 m), but it is still an assumption and is
        // reported as one.
        public double ElevationM { get; set; }
    }

    public sealed class DailyEtoResult
    {
        // Null when the day has no usable temperature from any source. The caller
        // must then write a data_gap insight and carry Dr forward - never
        // substitute a number.
        public double? EtoMm { get; set; }

        public string EtoSource { get; set; } = EtoSources.None;
        public string RsSource { get; set; } = EtoSources.None;
        public string WindSource { get; set; } = EtoSources.None;
        public string HumiditySource { get; set; } = EtoSources.None;
        public string TemperatureSource { get; set; } = EtoSources.None;

        // True when any input had to be defaulted or estimated. Written to
        // zone_water_balance.incomplete so a report can mark the day.
        public bool Incomplete { get; set; }

        // Farmer-readable, one line per fallback actually used. Goes straight into
        // ZoneAdvice.Limitations.
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
        // FAO-56 Table 15 lists 2 m/s as "general global conditions" - the value
        // the book itself suggests where no wind data exists (p. 63).
        public const double DefaultWindSpeedMs = 2.0;
        public const double DefaultWindHeightM = 2.0;

        // Plausibility limits, spec section 3b. Outside these a value is treated as
        // absent rather than trusted.
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

            // ---- 1. Temperature: weather app, then DHT11, then give up --------
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
                    "FAO-56 defines this calculation for open-field weather, not for conditions inside a tub, so the figure is less reliable.");
            }
            else
            {
                // Spec 3c fallback 5: no temperature from either source means no
                // ETo. Carry Dr forward, raise data_gap, fabricate nothing.
                result.EtoSource = EtoSources.None;
                result.Incomplete = true;
                result.Limitations.Add(
                    "No usable temperature for " + Iso(inputs.Date) +
                    " from the weather app or the zone's sensor, so no water-use figure could be worked out for that day.");
                return result;
            }

            result.TMinC = tMin;
            result.TMaxC = tMax;

            // ---- 2. Latitude: needed for Ra, and there is no substitute -------
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

            // ---- 3. Radiation: always estimated, Eq. 50 from the temperature
            //         range. AgroFlow has no pyranometer anywhere.
            var ra = ReferenceEvapotranspiration.ExtraterrestrialRadiationMj(latitude, dayOfYear);
            var rs = PenmanMonteithEto.SolarRadiationFromTemperatureRangeMj(tMin, tMax, ra);
            var rso = PenmanMonteithEto.ClearSkySolarRadiationMj(ra);

            result.RadiationMj = rs;
            result.RsSource = EtoSources.Estimated;
            result.Incomplete = true;
            result.Limitations.Add(
                "Sunshine was estimated from the day's high and low temperature (FAO-56 Eq. 50); there is no sunlight sensor on any AgroFlow farm.");

            // ---- 4. Wind: weather app, else FAO-56's 2 m/s ---------------------
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

            // ---- 5. Humidity: RHmax/RHmin, else RHmean, else DHT11, else
            //         estimate from the temperatures with Eq. 64 ----------------
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
                // FAO-56 Eq. 64 / Eq. 48: estimate RHmin from the temperatures and
                // take ea as the saturation pressure at Tmin.
                var rhMinEstimate = PenmanMonteithEto.EstimateRhMinFromTemperaturesPct(tMin, tMax);
                ea = PenmanMonteithEto.ActualVapourPressureFromTMinKpa(tMin);
                result.HumiditySource = EtoSources.Estimated;
                result.Incomplete = true;
                result.Limitations.Add(
                    "Humidity was not available from the weather app or the zone sensor, so it was estimated from the day's temperatures (FAO-56 Eq. 64; estimated lowest humidity "
                    + rhMinEstimate.ToString("F0", CultureInfo.InvariantCulture) + "%).");
            }

            // ea cannot exceed es: that would be a negative vapour pressure
            // deficit, i.e. air wetter than saturated. Possible when ea is
            // estimated on a day with almost no temperature range.
            if (ea > es) ea = es;

            result.SaturationVapourPressureKpa = es;
            result.ActualVapourPressureKpa = ea;

            // ---- 6. Net radiation and ETo ------------------------------------
            var rns = PenmanMonteithEto.NetShortwaveRadiationMj(rs);
            var rnl = PenmanMonteithEto.NetLongwaveRadiationMj(tMin, tMax, ea, rs, rso);
            var rn = PenmanMonteithEto.NetRadiationMj(rns, rnl);
            result.NetRadiationMj = rn;

            var tMean = (tMin + tMax) / 2.0;
            var pressure = PenmanMonteithEto.AtmosphericPressureKpa(inputs.ElevationM);
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

            // The headline source is the weakest link in the chain: a day whose
            // temperature came from the tub is a dht11_fallback day regardless of
            // where the wind came from.
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
