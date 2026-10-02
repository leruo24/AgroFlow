using System;
using AgroFlow.Business.Agronomy;
using Xunit;
using Xunit.Abstractions;

namespace AgroFlow.Domain.Tests;

// Section 12 of the engine spec: the FAO-56 worked examples the engine must
// reproduce. No mock data anywhere - every expected number below is printed in
// Allen et al. (1998), FAO Irrigation and Drainage Paper 56, and the test prints
// expected vs actual so a run can be read as the verification record.
//
// Example numbers are FAO-56's own.
public class Fao56EngineVerificationTests
{
    private readonly ITestOutputHelper _out;

    public Fao56EngineVerificationTests(ITestOutputHelper output)
    {
        _out = output;
    }

    private void Report(string label, double expected, double actual, double tolerance)
    {
        _out.WriteLine($"{label,-46} expected {expected,10:F3}   actual {actual,10:F3}   (tol {tolerance})");
        Assert.Equal(expected, actual, tolerance);
    }

    // -----------------------------------------------------------------------
    // 12.1  Kc curve - FAO-56 Example 28
    //       Stage lengths 25/25/30/20, Kc_ini 0.15, Kc_mid 1.19, Kc_end 0.35.
    // -----------------------------------------------------------------------
    [Theory]
    [InlineData(20, 0.15)]  // inside the initial stage: constant at Kc_ini
    [InlineData(40, 0.77)]  // interpolating up through development
    [InlineData(70, 1.19)]  // inside mid-season: constant at Kc_mid
    [InlineData(95, 0.56)]  // interpolating down through late season
    public void Kc_MatchesExample28(int dayOfSeason, double expected)
    {
        var actual = SoilWaterBalance.Kc(
            kcIni: 0.15, kcMid: 1.19, kcEnd: 0.35,
            lIni: 25, lDev: 25, lMid: 30, lLate: 20,
            dayOfSeason: dayOfSeason);

        Report($"12.1 Example 28 Kc, day {dayOfSeason}", expected, actual, 0.005);
    }

    // -----------------------------------------------------------------------
    // 12.2  TAW / RAW / Ks - FAO-56 Example 37
    //       theta_FC 0.32, theta_WP 0.12, Zr 0.8 m, p 0.40.
    // -----------------------------------------------------------------------
    [Fact]
    public void TawRaw_MatchExample37()
    {
        var taw = SoilWaterBalance.TotalAvailableWaterMm(0.32, 0.12, 0.8);
        var raw = SoilWaterBalance.ReadilyAvailableWaterMm(0.40, taw);

        Report("12.2 Example 37 TAW (mm)", 160.0, taw, 0.05);
        Report("12.2 Example 37 RAW (mm)", 64.0, raw, 0.05);
    }

    [Theory]
    [InlineData(67.0, 0.97)]
    [InlineData(72.8, 0.91)]
    public void Ks_MatchesExample37(double depletionMm, double expectedKs)
    {
        var taw = SoilWaterBalance.TotalAvailableWaterMm(0.32, 0.12, 0.8);
        var raw = SoilWaterBalance.ReadilyAvailableWaterMm(0.40, taw);

        var ks = SoilWaterBalance.StressCoefficient(depletionMm, taw, raw, 0.40);

        Report($"12.2 Example 37 Ks at Dr {depletionMm} mm", expectedKs, ks, 0.005);
    }

    // -----------------------------------------------------------------------
    // 12.3  Water balance - FAO-56 Example 37
    //       Dr starts at 55 mm, ETo 5 mm/day, Kc 1.2, ten days, no rain and no
    //       irrigation. Ks is taken from the previous day's depletion and applied
    //       to today's ETc (Eq. 81), which is how FAO-56's daily table advances.
    // -----------------------------------------------------------------------
    [Fact]
    public void WaterBalance_MatchesExample37OverTenDays()
    {
        const double thetaFc = 0.32, thetaWp = 0.12, zr = 0.8, p = 0.40;
        const double eto = 5.0, kc = 1.2;

        var taw = SoilWaterBalance.TotalAvailableWaterMm(thetaFc, thetaWp, zr);
        var raw = SoilWaterBalance.ReadilyAvailableWaterMm(p, taw);
        var etc = kc * eto;

        var dr = 55.0;
        for (var day = 1; day <= 10; day++)
        {
            var ks = SoilWaterBalance.StressCoefficient(dr, taw, raw, p);
            var etcAdj = SoilWaterBalance.StressAdjustedEtcMm(ks, etc);
            dr = SoilWaterBalance.NextDepletionMm(dr, rainfallMm: 0.0, irrigationMm: 0.0, etcAdj, taw);
            _out.WriteLine($"     day {day,2}: Ks {ks:F3}  ETc_adj {etcAdj:F2} mm  Dr {dr:F2} mm");
        }

        Report("12.3 Example 37 Dr after 10 days (mm)", 104.5, dr, 0.5);
    }

    // -----------------------------------------------------------------------
    // 12.4  RAW - FAO-56 Example 36
    //       Tomato on silt: theta_FC 0.32, theta_WP 0.15, Zr 0.8 m, p 0.40.
    // -----------------------------------------------------------------------
    [Fact]
    public void TawRaw_MatchExample36()
    {
        var taw = SoilWaterBalance.TotalAvailableWaterMm(0.32, 0.15, 0.8);
        var raw = SoilWaterBalance.ReadilyAvailableWaterMm(0.40, taw);

        Report("12.4 Example 36 TAW (mm)", 136.0, taw, 0.05);
        Report("12.4 Example 36 RAW (mm)", 54.0, raw, 0.5);
    }

    // -----------------------------------------------------------------------
    // 12.5  p adjusted for ETc - FAO-56 Table 22 footnote (p. 162)
    //       Soil factor 1.0 (loam) so only the ETc term moves p.
    // -----------------------------------------------------------------------
    [Theory]
    [InlineData(0.40, 8.0, 0.28)]   // p + 0.04 (5 - 8) = 0.40 - 0.12
    [InlineData(0.20, 12.0, 0.10)]  // 0.20 - 0.28 = -0.08, clamped up to the 0.1 floor
    public void AdjustedP_MatchesTable22Footnote(double tabulatedP, double etc, double expected)
    {
        var actual = SoilWaterBalance.AdjustP(tabulatedP, soilFactor: 1.0, etcMmPerDay: etc);
        Report($"12.5 p {tabulatedP} at ETc {etc}", expected, actual, 0.005);
    }

    // -----------------------------------------------------------------------
    // 12.6  ETo - FAO-56 Chapter 4's daily worked example (Example 18):
    //       Uccle (Brussels), 6 July, altitude 100 m, latitude 50 deg 48' N.
    //       Tmax 21.5 C, Tmin 12.3 C, RHmax 84%, RHmin 63%, u2 2.78 m/s.
    //
    //       Every intermediate value below is the one FAO-56 prints for this
    //       example, so a failure localises to the equation that broke rather
    //       than just to "ETo is wrong".
    // -----------------------------------------------------------------------
    [Fact]
    public void Eto_ReproducesExample18()
    {
        const double tMin = 12.3, tMax = 21.5;
        const double rhMax = 84.0, rhMin = 63.0;
        const double u2 = 2.78;
        const double elevation = 100.0;
        const double latitude = 50.8;       // 50 deg 48' N
        const int dayOfYear = 187;          // 6 July

        var tMean = (tMax + tMin) / 2.0;
        Report("12.6 Tmean (C)", 16.9, tMean, 0.05);

        var slope = PenmanMonteithEto.SaturationSlopeKpaPerC(tMean);
        Report("12.6 slope of vapour pressure curve (kPa/C)", 0.122, slope, 0.001);

        var pressure = PenmanMonteithEto.AtmosphericPressureKpa(elevation);
        Report("12.6 atmospheric pressure (kPa)", 100.1, pressure, 0.1);

        var gamma = PenmanMonteithEto.PsychrometricConstantKpaPerC(pressure);
        Report("12.6 psychrometric constant (kPa/C)", 0.0666, gamma, 0.0002);

        var es = PenmanMonteithEto.MeanSaturationVapourPressureKpa(tMin, tMax);
        Report("12.6 es (kPa)", 1.997, es, 0.003);

        var ea = PenmanMonteithEto.ActualVapourPressureFromRhMaxMinKpa(tMin, tMax, rhMax, rhMin);
        Report("12.6 ea (kPa)", 1.409, ea, 0.003);

        Report("12.6 es - ea (kPa)", 0.589, es - ea, 0.004);

        var ra = ReferenceEvapotranspiration.ExtraterrestrialRadiationMj(latitude, dayOfYear);
        Report("12.6 Ra (MJ m-2 d-1)", 41.09, ra, 0.15);

        // The book derives Rs from measured sunshine hours (n = 9.25 h, Eq. 35),
        // which AgroFlow has no sensor for. Its published Rs is used here so this
        // test checks Eq. 6 and the vapour/radiation chain rather than Eq. 35.
        const double rs = 22.07;

        var rso = PenmanMonteithEto.ClearSkySolarRadiationMj(ra);
        Report("12.6 Rso (MJ m-2 d-1)", 30.90, rso, 0.15);

        var rns = PenmanMonteithEto.NetShortwaveRadiationMj(rs);
        Report("12.6 Rns (MJ m-2 d-1)", 17.0, rns, 0.05);

        var rnl = PenmanMonteithEto.NetLongwaveRadiationMj(tMin, tMax, ea, rs, rso);
        Report("12.6 Rnl (MJ m-2 d-1)", 3.71, rnl, 0.06);

        var rn = PenmanMonteithEto.NetRadiationMj(rns, rnl);
        Report("12.6 Rn (MJ m-2 d-1)", 13.28, rn, 0.1);

        var eto = PenmanMonteithEto.Eto(
            netRadiationMj: rn,
            soilHeatFluxMj: 0.0,
            tMeanC: tMean,
            windSpeed2MMs: u2,
            saturationVapourPressureKpa: es,
            actualVapourPressureKpa: ea,
            psychrometricConstantKpaPerC: gamma,
            saturationSlopeKpaPerC: slope);

        Report("12.6 ETo (mm/day)", 3.9, eto, 0.12);
    }

    // FAO-56 Eq. 47, p. 56. The book's own illustration: 3.2 m/s measured at 10 m
    // becomes 2.4 m/s at 2 m (Example 14, p. 56).
    [Fact]
    public void WindAdjustment_MatchesExample14()
    {
        var u2 = PenmanMonteithEto.WindSpeedAt2M(3.2, 10.0);
        Report("12.6 Eq.47 wind 3.2 m/s at 10 m -> 2 m", 2.4, u2, 0.05);
    }

    // Eq. 50 must never return more than clear-sky radiation, however large the
    // diurnal range. Not a book example - a guard on our own use of Eq. 50.
    [Fact]
    public void SolarRadiationFromTemperatureRange_IsCappedAtClearSky()
    {
        var ra = 41.09;
        var rs = PenmanMonteithEto.SolarRadiationFromTemperatureRangeMj(0.0, 40.0, ra);
        Assert.True(rs <= PenmanMonteithEto.ClearSkySolarRadiationMj(ra) + 1e-9,
            $"Rs {rs} exceeded clear-sky Rso {PenmanMonteithEto.ClearSkySolarRadiationMj(ra)}");
        _out.WriteLine($"     Eq.50 with a 40 C range: Rs {rs:F2} capped at Rso {PenmanMonteithEto.ClearSkySolarRadiationMj(ra):F2}");
    }

    // -----------------------------------------------------------------------
    // Reference tables: the engine's crop and soil values are the ones the spec
    // sourced from FAO-56, not drifted copies.
    // -----------------------------------------------------------------------
    [Theory]
    [InlineData("spinach", 20, 20, 15, 5, 60, 0.70, 1.00, 0.95, 0.3, 0.20)]
    [InlineData("tomato", 30, 40, 45, 30, 145, 0.60, 1.15, 0.80, 0.7, 0.40)]
    [InlineData("cucumber", 20, 30, 40, 15, 105, 0.60, 1.00, 0.75, 0.7, 0.50)]
    [InlineData("potato", 25, 30, 45, 30, 130, 0.50, 1.15, 0.75, 0.4, 0.35)]
    [InlineData("dry beans", 20, 30, 40, 20, 110, 0.40, 1.15, 0.35, 0.6, 0.45)]
    [InlineData("maize", 25, 40, 45, 30, 140, 0.30, 1.20, 0.35, 1.0, 0.55)]
    public void EngineCropTable_MatchesTheSourcedValues(
        string key, int lIni, int lDev, int lMid, int lLate, int total,
        double kcIni, double kcMid, double kcEnd, double zr, double p)
    {
        var crop = Fao56EngineReference.TryResolveCrop(key);
        Assert.NotNull(crop);

        Assert.Equal(lIni, crop!.LIniDays);
        Assert.Equal(lDev, crop.LDevDays);
        Assert.Equal(lMid, crop.LMidDays);
        Assert.Equal(lLate, crop.LLateDays);
        Assert.Equal(total, crop.TotalDays);
        Assert.Equal(kcIni, crop.KcIni, 4);
        Assert.Equal(kcMid, crop.KcMid, 4);
        Assert.Equal(kcEnd, crop.KcEnd, 4);
        Assert.Equal(zr, crop.RootDepthM, 4);
        Assert.Equal(p, crop.DepletionFractionP, 4);

        _out.WriteLine($"     {key,-10} {lIni}/{lDev}/{lMid}/{lLate} = {total} d, Kc {kcIni}/{kcMid}/{kcEnd}, Zr {zr} m, p {p}");
    }

    [Theory]
    [InlineData("sandy", 0.12, 0.045, 1.05)]
    [InlineData("loam", 0.25, 0.12, 1.00)]
    [InlineData("clay", 0.36, 0.22, 0.95)]
    public void EngineSoilTable_MatchesTable19Midpoints(
        string key, double thetaFc, double thetaWp, double pFactor)
    {
        var soil = Fao56EngineReference.TryResolveSoil(key);
        Assert.NotNull(soil);
        Assert.Equal(thetaFc, soil!.ThetaFieldCapacity, 4);
        Assert.Equal(thetaWp, soil.ThetaWiltingPoint, 4);
        Assert.Equal(pFactor, soil.PFactor, 4);

        var taw = SoilWaterBalance.TotalAvailableWaterMm(thetaFc, thetaWp, 1.0);
        _out.WriteLine($"     {key,-6} theta_FC {thetaFc}  theta_WP {thetaWp}  p x{pFactor}  -> TAW {taw:F0} mm per m of root depth");
    }

    // Crops with no FAO-56 row must resolve to null so the caller raises
    // setup_missing. A substituted Kc curve would be worse than no advice.
    [Theory]
    [InlineData("grapes")]
    [InlineData("wheat")]
    [InlineData("apples")]
    [InlineData("")]
    [InlineData(null)]
    public void UnknownCrops_ResolveToNull(string? cropType)
    {
        Assert.Null(Fao56EngineReference.TryResolveCrop(cropType));
    }

    // The aliases the spec calls for: corn -> maize, cucumbers -> cucumber, and
    // Luba's underscore spelling for dry beans.
    [Theory]
    [InlineData("corn", "maize")]
    [InlineData("Cucumbers", "cucumber")]
    [InlineData("dry_beans", "dry beans")]
    [InlineData("  Tomato  ", "tomato")]
    [InlineData("leafy_veg", "leafy_veg")]
    public void CropAliases_Normalise(string input, string expectedKey)
    {
        var crop = Fao56EngineReference.TryResolveCrop(input);
        Assert.NotNull(crop);
        Assert.Equal(expectedKey, crop!.Key);
    }

    // Rain below 0.2 x ETo is ignored (spec 6.8).
    [Fact]
    public void SmallRainfall_IsIgnored()
    {
        Assert.Equal(0.0, SoilWaterBalance.EffectiveRainfallMm(0.5, 5.0));   // below 1.0 mm
        Assert.Equal(2.0, SoilWaterBalance.EffectiveRainfallMm(2.0, 5.0));   // above it, credited in full
    }

    // Depletion is clamped to [0, TAW]: the clamp at zero is FAO-56 Eq. 88's deep
    // percolation, the clamp at TAW is the profile at wilting point.
    [Fact]
    public void Depletion_IsClampedToZeroAndTaw()
    {
        Assert.Equal(0.0, SoilWaterBalance.NextDepletionMm(10.0, 50.0, 0.0, 2.0, 160.0));
        Assert.Equal(160.0, SoilWaterBalance.NextDepletionMm(158.0, 0.0, 0.0, 9.0, 160.0));
    }

    // Net irrigation never exceeds the depletion, and minutes round up.
    [Fact]
    public void IrrigationAmount_IsDepletionOverAreaAndRoundsMinutesUp()
    {
        var litres = SoilWaterBalance.IrrigationLitres(15.0, 1.5);   // 15 mm over 1.5 m2
        Assert.Equal(22.5, litres!.Value, 3);

        var minutes = SoilWaterBalance.IrrigationMinutes(litres, 1.5);  // at 1.5 L/min
        Assert.Equal(15, minutes);

        // No flow rate configured -> no minutes, rather than a guess.
        Assert.Null(SoilWaterBalance.IrrigationMinutes(litres, null));
        // No area -> no litres.
        Assert.Null(SoilWaterBalance.IrrigationLitres(15.0, null));
    }

    // Relative moisture is only defined once both calibration points exist, and
    // works whichever way round the resistive probe's wet/dry readings sit.
    [Fact]
    public void RelativeMoisture_NeedsCalibrationAndHandlesEitherDirection()
    {
        Assert.Null(SoilWaterBalance.RelativeMoisturePercent(2000, null, 3000));
        Assert.Null(SoilWaterBalance.RelativeMoisturePercent(2000, 1200, null));

        // Resistive probe: wet reads LOW (1200), dry reads HIGH (3000).
        Assert.Equal(50.0, SoilWaterBalance.RelativeMoisturePercent(2100, 1200, 3000)!.Value, 3);
        // Clamped outside the calibrated range.
        Assert.Equal(100.0, SoilWaterBalance.RelativeMoisturePercent(800, 1200, 3000)!.Value, 3);
        Assert.Equal(0.0, SoilWaterBalance.RelativeMoisturePercent(3500, 1200, 3000)!.Value, 3);
    }

    // Root depth is capped by the tub, so a 1.0 m maize root zone in a 0.3 m tub
    // claims 0.3 m of water, not 1.0 m.
    [Fact]
    public void RootDepth_IsCappedByTheZoneLimit()
    {
        Assert.Equal(0.3, SoilWaterBalance.EffectiveRootDepthM(1.0, 0.3), 4);
        Assert.Equal(1.0, SoilWaterBalance.EffectiveRootDepthM(1.0, null), 4);
        Assert.Equal(0.4, SoilWaterBalance.EffectiveRootDepthM(0.4, 1.5), 4);
    }

    // Farmer-facing stage names (spec 5c) - no FAO jargon reaches a farmer.
    [Theory]
    [InlineData(1, SeasonStage.Establishing)]
    [InlineData(25, SeasonStage.Establishing)]
    [InlineData(26, SeasonStage.Growing)]
    [InlineData(65, SeasonStage.Growing)]
    [InlineData(66, SeasonStage.PeakGrowth)]
    [InlineData(110, SeasonStage.PeakGrowth)]
    [InlineData(111, SeasonStage.NearingHarvest)]
    [InlineData(140, SeasonStage.NearingHarvest)]
    [InlineData(141, SeasonStage.SeasonComplete)]
    public void Stage_UsesInclusiveBoundaries(int day, SeasonStage expected)
    {
        // maize: 25/40/45/30 = 140
        Assert.Equal(expected, SoilWaterBalance.Stage(25, 40, 45, 30, day));
    }

    [Fact]
    public void StageLabels_AreTheFarmerFacingNames()
    {
        Assert.Equal("Establishing", Fao56EngineReference.StageLabel(SeasonStage.Establishing));
        Assert.Equal("Growing", Fao56EngineReference.StageLabel(SeasonStage.Growing));
        Assert.Equal("Peak growth", Fao56EngineReference.StageLabel(SeasonStage.PeakGrowth));
        Assert.Equal("Nearing harvest", Fao56EngineReference.StageLabel(SeasonStage.NearingHarvest));
        Assert.Equal("Season complete", Fao56EngineReference.StageLabel(SeasonStage.SeasonComplete));
    }
}
