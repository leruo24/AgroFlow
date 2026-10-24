#nullable enable
using System;

namespace AgroFlow.Business.Agronomy
{
    // Daily FAO-56 Penman-Monteith reference evapotranspiration (Eq. 6) and the equations
    // it needs. FAO-56 prefers Eq. 6 wherever its inputs are available, and weather_daily
    // has humidity and wind. Hargreaves (Eq. 52, ReferenceEvapotranspiration) stays as
    // the documented fallback and is still used by the schedule report narrative.
    // Missing inputs, following FAO-56:
    //   Rs   not measured anywhere in AgroFlow -> Eq. 50 from (Tmax - Tmin) and Ra.
    //   wind missing -> 2 m/s, FAO-56 Table 15 "general global conditions".
    //   RH   missing -> RHmin estimated from Tmin via Eq. 64 (ea = e0(Tmin)).
    //   temp missing -> no ETo at all, never made up.
    // Pure arithmetic, so it can be checked against the book's worked examples offline.
    public static class PenmanMonteithEto
    {
        // FAO-56 Eq. 8, p. 31: atmospheric pressure from elevation, with the
        // constants the book uses (P0 = 101.3 kPa at z = 0).
        public static double AtmosphericPressureKpa(double elevationM)
        {
            return 101.3 * Math.Pow((293.0 - 0.0065 * elevationM) / 293.0, 5.26);
        }

        // FAO-56 Eq. 8 note / Eq. 9, p. 32: psychrometric constant.
        // gamma = 0.665e-3 * P
        public static double PsychrometricConstantKpaPerC(double pressureKpa)
        {
            return 0.000665 * pressureKpa;
        }

        // FAO-56 Eq. 11, p. 36: saturation vapour pressure at temperature T.
        public static double SaturationVapourPressureKpa(double tCelsius)
        {
            return 0.6108 * Math.Exp(17.27 * tCelsius / (tCelsius + 237.3));
        }

        // FAO-56 Eq. 12, p. 36: mean saturation vapour pressure is the mean of e0(Tmax) and
        // e0(Tmin), not e0(Tmean), which underestimates es.
        public static double MeanSaturationVapourPressureKpa(double tMinC, double tMaxC)
        {
            return (SaturationVapourPressureKpa(tMaxC) + SaturationVapourPressureKpa(tMinC)) / 2.0;
        }

        // FAO-56 Eq. 13, p. 37: slope of the saturation vapour pressure curve at
        // mean air temperature.
        public static double SaturationSlopeKpaPerC(double tMeanC)
        {
            var numerator = 4098.0 * SaturationVapourPressureKpa(tMeanC);
            var denominator = Math.Pow(tMeanC + 237.3, 2.0);
            return numerator / denominator;
        }

        // FAO-56 Eq. 17, p. 39: actual vapour pressure from RHmax and RHmin.
        public static double ActualVapourPressureFromRhMaxMinKpa(
            double tMinC, double tMaxC, double rhMaxPct, double rhMinPct)
        {
            return (SaturationVapourPressureKpa(tMinC) * rhMaxPct / 100.0
                    + SaturationVapourPressureKpa(tMaxC) * rhMinPct / 100.0) / 2.0;
        }

        // FAO-56 Eq. 19, p. 39: actual vapour pressure from RHmean, when only a daily mean
        // RH is available.
        public static double ActualVapourPressureFromRhMeanKpa(
            double tMinC, double tMaxC, double rhMeanPct)
        {
            return MeanSaturationVapourPressureKpa(tMinC, tMaxC) * rhMeanPct / 100.0;
        }

        // FAO-56 Eq. 48, p. 58: with no humidity data, ea = e0(Tmin) (dewpoint = Tmin). The
        // book suggests subtracting 2-3 C in arid climates; we do not, because we do not know
        // if a farm is arid, so the result is marked 'estimated'.
        public static double ActualVapourPressureFromTMinKpa(double tMinC)
        {
            return SaturationVapourPressureKpa(tMinC);
        }

        // FAO-56 Eq. 50, p. 60: Hargreaves' radiation formula.
        //   Rs = kRs * sqrt(Tmax - Tmin) * Ra
        // kRs is 0.16 inland and 0.19 on the coast (p. 60); we use 0.16 because our farms are
        // not known to be coastal. Rs is capped at clear-sky Rso (Eq. 37, 0.75 * Ra), since
        // Eq. 50 can exceed it on a very large daily range.
        public const double KRsInterior = 0.16;
        public const double KRsCoastal = 0.19;

        public static double SolarRadiationFromTemperatureRangeMj(
            double tMinC, double tMaxC, double raMj, double kRs = KRsInterior)
        {
            if (tMaxC < tMinC)
            {
                throw new ArgumentException(
                    "Tmax is below Tmin, so Eq. 50's sqrt(Tmax - Tmin) is undefined. This is bad input data, not a computable day.",
                    nameof(tMaxC));
            }

            var rs = kRs * Math.Sqrt(tMaxC - tMinC) * raMj;
            var rso = ClearSkySolarRadiationMj(raMj);
            return rs > rso ? rso : rs;
        }

        // FAO-56 Eq. 37, p. 51: clear-sky solar radiation where no calibrated
        // as/bs are available: Rso = 0.75 * Ra.
        public static double ClearSkySolarRadiationMj(double raMj)
        {
            return 0.75 * raMj;
        }

        // FAO-56 Eq. 38, p. 51: net shortwave radiation. albedo = 0.23 for the
        // hypothetical grass reference crop.
        public const double ReferenceCropAlbedo = 0.23;

        public static double NetShortwaveRadiationMj(double rsMj)
        {
            return (1.0 - ReferenceCropAlbedo) * rsMj;
        }

        // FAO-56 Eq. 39, p. 52: net longwave radiation.
        // sigma = 4.903e-9 MJ K-4 m-2 day-1 (Stefan-Boltzmann, p. 52).
        public const double StefanBoltzmannMjPerK4PerM2PerDay = 4.903e-9;

        public static double NetLongwaveRadiationMj(
            double tMinC, double tMaxC, double actualVapourPressureKpa, double rsMj, double rsoMj)
        {
            var tMaxK4 = Math.Pow(tMaxC + 273.16, 4.0);
            var tMinK4 = Math.Pow(tMinC + 273.16, 4.0);

            // Rs/Rso is the relative shortwave radiation term. Guard the divide: Ra is zero in a
            // polar night, and a NaN must never reach the irrigation advice.
            var relative = rsoMj > 0.0 ? rsMj / rsoMj : 1.0;
            if (relative > 1.0) relative = 1.0;
            if (relative < 0.0) relative = 0.0;

            return StefanBoltzmannMjPerK4PerM2PerDay
                   * ((tMaxK4 + tMinK4) / 2.0)
                   * (0.34 - 0.14 * Math.Sqrt(actualVapourPressureKpa))
                   * (1.35 * relative - 0.35);
        }

        // FAO-56 Eq. 40, p. 53: net radiation.
        public static double NetRadiationMj(double netShortwaveMj, double netLongwaveMj)
        {
            return netShortwaveMj - netLongwaveMj;
        }

        // FAO-56 Eq. 47, p. 56: wind speed measured at height z adjusted to 2 m.
        //   u2 = uz * 4.87 / ln(67.8 z - 5.42)
        public static double WindSpeedAt2M(double windSpeedMs, double measurementHeightM)
        {
            if (measurementHeightM <= 0.0)
            {
                throw new ArgumentOutOfRangeException(
                    nameof(measurementHeightM), measurementHeightM,
                    "Wind measurement height must be positive.");
            }

            // Already at 2 m: Eq. 47 gives ~1.0 anyway, but we skip it to keep this case exact.
            if (Math.Abs(measurementHeightM - 2.0) < 1e-9) return windSpeedMs;

            return windSpeedMs * 4.87 / Math.Log(67.8 * measurementHeightM - 5.42);
        }

        // FAO-56 Eq. 64, p. 71 (the "missing humidity data" chapter):
        //   RHmin ~= 100 * e0(Tdew) / e0(Tmax), with Tdew taken as Tmin.
        // Returned clamped to 0-100.
        public static double EstimateRhMinFromTemperaturesPct(double tMinC, double tMaxC)
        {
            var rhMin = 100.0 * SaturationVapourPressureKpa(tMinC) / SaturationVapourPressureKpa(tMaxC);
            if (rhMin < 0.0) return 0.0;
            if (rhMin > 100.0) return 100.0;
            return rhMin;
        }

        // FAO-56 Eq. 6, p. 24: the FAO Penman-Monteith equation for daily ETo:
        //
        //            0.408 D (Rn - G) + g (900/(T+273)) u2 (es - ea)
        //   ETo =  ---------------------------------------------------
        //                       D + g (1 + 0.34 u2)
        //
        // G is taken as zero: FAO-56 p. 54 says soil heat flux is small over a day.
        // All inputs are explicit, so the book's worked examples can be run through directly.
        public static double Eto(
            double netRadiationMj,
            double soilHeatFluxMj,
            double tMeanC,
            double windSpeed2MMs,
            double saturationVapourPressureKpa,
            double actualVapourPressureKpa,
            double psychrometricConstantKpaPerC,
            double saturationSlopeKpaPerC)
        {
            var numerator =
                0.408 * saturationSlopeKpaPerC * (netRadiationMj - soilHeatFluxMj)
                + psychrometricConstantKpaPerC * (900.0 / (tMeanC + 273.0)) * windSpeed2MMs
                  * (saturationVapourPressureKpa - actualVapourPressureKpa);

            var denominator =
                saturationSlopeKpaPerC + psychrometricConstantKpaPerC * (1.0 + 0.34 * windSpeed2MMs);

            var eto = numerator / denominator;

            // The vapour pressure deficit can be slightly negative when ea is estimated, which
            // can push ETo below zero. Evapotranspiration cannot be negative, so we floor it.
            return eto < 0.0 ? 0.0 : eto;
        }
    }
}
