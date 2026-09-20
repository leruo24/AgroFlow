#nullable enable
using System;

namespace AgroFlow.Business.Agronomy
{
    // Reference evapotranspiration (ET0) from daily minimum/maximum air
    // temperature and latitude, per FAO-56 (Allen et al., 1998).
    //
    // WHY HARGREAVES-SAMANI AND NOT PENMAN-MONTEITH
    // ---------------------------------------------
    // Older project notes say Penman-Monteith. Penman-Monteith (FAO-56 Eq. 6)
    // needs solar radiation, wind speed and vapour pressure. AgroFlow has no
    // pyranometer and no anemometer on any node, and the weather rows carry no
    // wind at all - so Eq. 6 cannot be evaluated from measured inputs, only
    // from estimates of its own inputs. FAO-56 addresses this case directly and
    // offers Eq. 52 (the 1985 Hargreaves equation) as the alternative "when
    // solar radiation data, relative humidity data and/or wind speed data are
    // missing" (p. 64). That is exactly our situation, so Eq. 52 is what this
    // class implements.
    //
    // FAO-56 is explicit about the trade-off, and so are we: Eq. 52 "has a
    // tendency to underpredict under high wind conditions (u2 > 3 m/s) and to
    // overpredict under conditions of high relative humidity" (p. 64). Anything
    // built on these numbers should present them as estimates.
    //
    // Everything here is pure arithmetic over (Tmin, Tmax, latitude, day-of-
    // year). No I/O, no clock, no database - so it is fully unit-testable
    // offline, which is how it was developed and verified.
    public static class ReferenceEvapotranspiration
    {
        // Solar constant. FAO-56 Eq. 21 variable list, p. 46: Gsc = 0.0820 MJ m-2 min-1.
        public const double SolarConstantMjPerM2PerMin = 0.0820;

        // FAO-56 Eq. 20, p. 45: equivalent evaporation [mm/day] = 0.408 * Ra [MJ m-2 day-1].
        public const double MjToMmEquivalentEvaporation = 0.408;

        // Beyond this latitude FAO-56 warns the Ra equations have limited
        // validity in winter (p. 47). Nothing AgroFlow serves is anywhere near
        // it, but callers get told rather than silently handed a bad number.
        public const double HighLatitudeWarningThresholdDegrees = 55.0;

        // FAO-56 Eq. 22, p. 46. Positive in the northern hemisphere, negative in
        // the southern - South African latitudes are negative here.
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
        //
        // The argument to arccos goes outside [-1, 1] inside the polar circles
        // (permanent day or permanent night), where the equation has no
        // solution. FAO-56 gives an arctan form (Eq. 26/27) partly to dodge
        // this; we clamp instead, which yields ws = 0 (polar night) or ws = pi
        // (polar day) - the physically correct limits - rather than NaN.
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

        // Same quantity expressed as equivalent evaporation [mm/day], which is
        // the unit Eq. 52 wants Ra in. FAO-56 Eq. 20, p. 45.
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

            // A very cold day can drive (Tmean + 17.8) negative, which would
            // hand back a negative ET0. Evapotranspiration cannot be negative;
            // floor it at zero rather than propagating a nonsense value into
            // ETc and then into irrigation advice.
            return et0 < 0.0 ? 0.0 : et0;
        }

        public static bool IsBeyondReliableLatitude(double latitudeDegrees)
        {
            return Math.Abs(latitudeDegrees) > HighLatitudeWarningThresholdDegrees;
        }
    }
}
