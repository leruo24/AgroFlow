#nullable enable
using System;

namespace AgroFlow.Business.Agronomy
{
    // Reference evapotranspiration (ET0) from daily min/max air temperature and latitude,
    // using FAO-56 Eq. 52 (Hargreaves, 1985).
    // FAO-56 offers Eq. 52 "when solar radiation data, relative humidity data and/or wind
    // speed data are missing" (p. 64). We use it as the fallback; Penman-Monteith (Eq. 6,
    // PenmanMonteithEto) is used when its inputs are available.
    // FAO-56 notes Eq. 52 "has a tendency to underpredict under high wind conditions
    // (u2 > 3 m/s) and to overpredict under conditions of high relative humidity" (p. 64),
    // so results should be presented as estimates.
    // Pure arithmetic over (Tmin, Tmax, latitude, day of year), so it is unit-tested offline.
    public static class ReferenceEvapotranspiration
    {
        // Solar constant. FAO-56 Eq. 21 variable list, p. 46: Gsc = 0.0820 MJ m-2 min-1.
        public const double SolarConstantMjPerM2PerMin = 0.0820;

        // FAO-56 Eq. 20, p. 45: equivalent evaporation [mm/day] = 0.408 * Ra [MJ m-2 day-1].
        public const double MjToMmEquivalentEvaporation = 0.408;

        // Beyond this latitude FAO-56 warns the Ra equations are less valid in winter (p. 47).
        // None of our farms is near it, but callers are warned instead of given a bad number.
        public const double HighLatitudeWarningThresholdDegrees = 55.0;

        // FAO-56 Eq. 22, p. 46. Positive in the northern hemisphere, negative in the
        // southern, so South African latitudes are negative.
        public static double LatitudeToRadians(double latitudeDegrees)
        {
            return Math.PI / 180.0 * latitudeDegrees;
        }

        // FAO-56 Eq. 23, p. 46: inverse relative distance Earth-Sun.
        public static double InverseRelativeDistanceEarthSun(int dayOfYear)
        {
            return 1.0 + 0.033 * Math.Cos(2.0 * Math.PI * dayOfYear / 365.0);
        }

        // FAO-56 Eq. 24, p. 46: solar declination [rad].
        public static double SolarDeclination(int dayOfYear)
        {
            return 0.409 * Math.Sin(2.0 * Math.PI * dayOfYear / 365.0 - 1.39);
        }

        // FAO-56 Eq. 25, p. 46: sunset hour angle [rad].
        // Inside the polar circles the arccos argument goes outside [-1, 1]. We clamp it,
        // giving ws = 0 (polar night) or ws = pi (polar day) instead of NaN.
        public static double SunsetHourAngle(double latitudeRadians, double solarDeclination)
        {
            var cosOmega = -Math.Tan(latitudeRadians) * Math.Tan(solarDeclination);
            if (cosOmega > 1.0) cosOmega = 1.0;
            if (cosOmega < -1.0) cosOmega = -1.0;
            return Math.Acos(cosOmega);
        }

        // FAO-56 Eq. 21, p. 46: extraterrestrial radiation Ra [MJ m-2 day-1].
        //
        // Verified against FAO-56 Example 8, p. 47 (3 September at 20 deg S):
        // the book gives 32.2 MJ m-2 day-1 / 13.1 mm/day. See the unit tests.
        public static double ExtraterrestrialRadiationMj(double latitudeDegrees, int dayOfYear)
        {
            if (dayOfYear < 1 || dayOfYear > 366)
            {
                throw new ArgumentOutOfRangeException(
                    nameof(dayOfYear), dayOfYear, "Day of year must be between 1 and 366 (FAO-56 Eq. 23/24 define J on that range).");
            }

            if (latitudeDegrees < -90.0 || latitudeDegrees > 90.0)
            {
                throw new ArgumentOutOfRangeException(
                    nameof(latitudeDegrees), latitudeDegrees, "Latitude must be between -90 and 90 degrees.");
            }

            var phi = LatitudeToRadians(latitudeDegrees);
            var dr = InverseRelativeDistanceEarthSun(dayOfYear);
            var delta = SolarDeclination(dayOfYear);
            var omegaS = SunsetHourAngle(phi, delta);

            return 24.0 * 60.0 / Math.PI
                   * SolarConstantMjPerM2PerMin
                   * dr
                   * (omegaS * Math.Sin(phi) * Math.Sin(delta)
                      + Math.Cos(phi) * Math.Cos(delta) * Math.Sin(omegaS));
        }

        // The same value as equivalent evaporation [mm/day], the unit Eq. 52 needs Ra in
        // (FAO-56 Eq. 20, p. 45).
        public static double ExtraterrestrialRadiationMm(double latitudeDegrees, int dayOfYear)
        {
            return ExtraterrestrialRadiationMj(latitudeDegrees, dayOfYear) * MjToMmEquivalentEvaporation;
        }

        // FAO-56 Eq. 52, p. 64 - the 1985 Hargreaves reference evapotranspiration
        // equation:
        //
        //     ET0 = 0.0023 (Tmean + 17.8) (Tmax - Tmin)^0.5 Ra
        //
        // with Ra in mm/day. Returns ET0 in mm/day.
        public static double HargreavesEt0Mm(
            double tMinCelsius, double tMaxCelsius, double latitudeDegrees, int dayOfYear)
        {
            if (tMaxCelsius < tMinCelsius)
            {
                throw new ArgumentException(
                    $"Tmax ({tMaxCelsius}) is below Tmin ({tMinCelsius}). Eq. 52 takes the square root of (Tmax - Tmin), which is undefined here - this is bad input data, not a computable day.",
                    nameof(tMaxCelsius));
            }

            var ra = ExtraterrestrialRadiationMm(latitudeDegrees, dayOfYear);
            var tMean = (tMaxCelsius + tMinCelsius) / 2.0;
            var et0 = 0.0023 * (tMean + 17.8) * Math.Sqrt(tMaxCelsius - tMinCelsius) * ra;

            // A very cold day can make (Tmean + 17.8) negative and give a negative ET0.
            // Evapotranspiration cannot be negative, so we floor it at zero.
            return et0 < 0.0 ? 0.0 : et0;
        }

        public static bool IsBeyondReliableLatitude(double latitudeDegrees)
        {
            return Math.Abs(latitudeDegrees) > HighLatitudeWarningThresholdDegrees;
        }
    }
}
