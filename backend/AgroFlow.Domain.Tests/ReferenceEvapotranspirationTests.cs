using AgroFlow.Business.Agronomy;

namespace AgroFlow.Domain.Tests;

// Verification of the ET0 chain against FAO-56's own worked example.
//
// FAO-56 EXAMPLE 8, p. 47 - "Determination of extraterrestrial radiation":
//   Determine Ra for 3 September at 20 deg S.
//     phi   = -0.35 rad
//     J     = 246 days
//     dr    = 0.985
//     delta = 0.120 rad
//     ws    = 1.527 rad
//     Ra    = 32.2 MJ m-2 day-1  =  13.1 mm/day
//
// Every intermediate is checked, not just the final answer, so a regression
// points at the equation that broke rather than just "the number moved".
public class ReferenceEvapotranspirationTests
{
    // 3 September in a non-leap year. FAO-56 Annex 2 Table 2.5 gives J = 246,
    // which is what DateOnly.DayOfYear independently produces - asserted below
    // so the example's premise is verified rather than assumed.
    private const int Example8DayOfYear = 246;
    private const double Example8LatitudeDegrees = -20.0;

    [Fact]
    public void Example8_DayNumberForThirdOfSeptember_Is246()
    {
        Assert.Equal(Example8DayOfYear, new DateOnly(2025, 9, 3).DayOfYear);
    }

    [Fact]
    public void Example8_LatitudeInRadians_MatchesBook()
    {
        // Book: -0.35 rad (given to 2 dp).
        var phi = ReferenceEvapotranspiration.LatitudeToRadians(Example8LatitudeDegrees);
        Assert.Equal(-0.35, phi, precision: 2);
    }

    [Fact]
    public void Example8_InverseRelativeDistance_MatchesBook()
    {
        // Book: dr = 0.985 (3 dp).
        var dr = ReferenceEvapotranspiration.InverseRelativeDistanceEarthSun(Example8DayOfYear);
        Assert.Equal(0.985, dr, precision: 3);
    }

    [Fact]
    public void Example8_SolarDeclination_MatchesBook()
    {
        // Book: delta = 0.120 rad (3 dp).
        var delta = ReferenceEvapotranspiration.SolarDeclination(Example8DayOfYear);
        Assert.Equal(0.120, delta, precision: 3);
    }

    [Fact]
    public void Example8_SunsetHourAngle_MatchesBook()
    {
        // Book: ws = 1.527 rad (3 dp).
        var phi = ReferenceEvapotranspiration.LatitudeToRadians(Example8LatitudeDegrees);
        var delta = ReferenceEvapotranspiration.SolarDeclination(Example8DayOfYear);
        var ws = ReferenceEvapotranspiration.SunsetHourAngle(phi, delta);
        Assert.Equal(1.527, ws, precision: 3);
    }

    [Fact]
    public void Example8_ExtraterrestrialRadiation_MatchesBook()
    {
        // Book: Ra = 32.2 MJ m-2 day-1 (1 dp).
        var ra = ReferenceEvapotranspiration.ExtraterrestrialRadiationMj(Example8LatitudeDegrees, Example8DayOfYear);
        Assert.Equal(32.2, ra, precision: 1);
    }

    [Fact]
    public void Example8_ExtraterrestrialRadiationAsEquivalentEvaporation_MatchesBook()
    {
        // Book: 0.408 (32.2) = 13.1 mm/day (1 dp).
        var raMm = ReferenceEvapotranspiration.ExtraterrestrialRadiationMm(Example8LatitudeDegrees, Example8DayOfYear);
        Assert.Equal(13.1, raMm, precision: 1);
    }

    // ---- Hargreaves Eq. 52 itself -------------------------------------------
    //
    // FAO-56 publishes no worked example for Eq. 52 (it gives the equation on
    // p. 64 and moves on), so there is no book figure to match. What CAN be
    // verified is that the equation is implemented exactly as printed, on top
    // of an Ra that has just been proven against Example 8. These tests pin the
    // arithmetic term by term.

    [Fact]
    public void Hargreaves_ReproducesEquation52TermByTerm()
    {
        const double tMin = 12.0;
        const double tMax = 28.0;

        var ra = ReferenceEvapotranspiration.ExtraterrestrialRadiationMm(Example8LatitudeDegrees, Example8DayOfYear);
        var tMean = (tMax + tMin) / 2.0;
        var expected = 0.0023 * (tMean + 17.8) * Math.Sqrt(tMax - tMin) * ra;

        var actual = ReferenceEvapotranspiration.HargreavesEt0Mm(tMin, tMax, Example8LatitudeDegrees, Example8DayOfYear);

        Assert.Equal(expected, actual, precision: 10);

        // And the value is agronomically sane for a warm early-spring day at
        // 20 S: 4.57 mm/day.
        Assert.Equal(4.57, actual, precision: 2);
    }

    [Fact]
    public void Hargreaves_WiderDiurnalRange_GivesHigherEt0()
    {
        // Eq. 52's (Tmax - Tmin)^0.5 term is a proxy for cloudiness: a bigger
        // day/night swing means clearer skies and more radiation.
        var narrow = ReferenceEvapotranspiration.HargreavesEt0Mm(18, 24, -33.9, 15);
        var wide = ReferenceEvapotranspiration.HargreavesEt0Mm(14, 28, -33.9, 15);
        Assert.True(wide > narrow, $"wider range should raise ET0, got narrow={narrow}, wide={wide}");
    }

    [Fact]
    public void Hargreaves_EqualMinAndMax_GivesZero()
    {
        // (Tmax - Tmin)^0.5 = 0. Degenerate but legal input.
        var et0 = ReferenceEvapotranspiration.HargreavesEt0Mm(20, 20, -33.9, 100);
        Assert.Equal(0.0, et0, precision: 10);
    }

    [Fact]
    public void Hargreaves_TmaxBelowTmin_Throws()
    {
        // Bad data, not a computable day - the square root would be imaginary.
        Assert.Throws<ArgumentException>(
            () => ReferenceEvapotranspiration.HargreavesEt0Mm(25, 10, -33.9, 100));
    }

    [Fact]
    public void Hargreaves_ExtremeColdIsFlooredAtZero()
    {
        // (Tmean + 17.8) goes negative below -17.8 C, which would yield a
        // negative ET0. Evapotranspiration cannot be negative.
        var et0 = ReferenceEvapotranspiration.HargreavesEt0Mm(-40, -30, 60, 15);
        Assert.Equal(0.0, et0);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(367)]
    [InlineData(-5)]
    public void ExtraterrestrialRadiation_RejectsDayOfYearOutsideRange(int dayOfYear)
    {
        Assert.Throws<ArgumentOutOfRangeException>(
            () => ReferenceEvapotranspiration.ExtraterrestrialRadiationMj(-33.9, dayOfYear));
    }

    [Fact]
    public void ExtraterrestrialRadiation_HandlesPolarDayWithoutNaN()
    {
        // Inside the Antarctic circle at midsummer the arccos argument leaves
        // [-1, 1]. Clamping must yield a real number, not NaN.
        var ra = ReferenceEvapotranspiration.ExtraterrestrialRadiationMj(-80.0, 355);
        Assert.False(double.IsNaN(ra));
        Assert.True(ra > 0);
    }

    [Fact]
    public void ExtraterrestrialRadiation_SouthernSummerExceedsSouthernWinter()
    {
        // Cape Town (-33.9): January should out-radiate July by a wide margin.
        var january = ReferenceEvapotranspiration.ExtraterrestrialRadiationMj(-33.9, 15);
        var july = ReferenceEvapotranspiration.ExtraterrestrialRadiationMj(-33.9, 196);
        Assert.True(january > july * 2, $"expected southern summer >> winter, got Jan={january}, Jul={july}");
    }

    [Fact]
    public void LatitudeBeyond55Degrees_IsFlagged()
    {
        Assert.True(ReferenceEvapotranspiration.IsBeyondReliableLatitude(-60));
        Assert.False(ReferenceEvapotranspiration.IsBeyondReliableLatitude(-33.9));
    }
}
