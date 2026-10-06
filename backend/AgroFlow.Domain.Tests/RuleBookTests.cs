using System;
using System.Collections.Generic;
using System.Linq;
using AgroFlow.Business.Agronomy;
using AgroFlow.Business.Agronomy.RuleBook;
using Xunit;

namespace AgroFlow.Domain.Tests;

// Item 2b: one table-driven test per rule, boundaries included. Every rule
// is pure, so every case here is just inputs -> expected output.
public class RuleBookTests
{
    // ---- SoilRules ------------------------------------------------------

    [Theory]
    [InlineData("sandy")]
    [InlineData("loam")]
    [InlineData("clay")]
    public void SoilRules_ReadTheReferenceTable_NeverACopy(string soilType)
    {
        var reference = Fao56EngineReference.TryResolveSoil(soilType)!;
        var holding = SoilRules.WaterHoldingFor(soilType);

        Assert.False(holding.Assumed);
        Assert.Same(reference, holding.Soil);
        Assert.Equal(reference.ThetaFieldCapacity, holding.ThetaFieldCapacity);
        Assert.Equal(reference.ThetaWiltingPoint, holding.ThetaWiltingPoint);
        Assert.Equal(reference.PFactor, SoilRules.DepletionFactorAdjust(soilType));
    }

    [Theory]
    [InlineData("sandy", 1.05)]
    [InlineData("loam", 1.00)]
    [InlineData("clay", 0.95)]
    public void SoilRules_DepletionFactorAdjust_IsThe5PercentOfChapter8(string soilType, double expected)
    {
        Assert.Equal(expected, SoilRules.DepletionFactorAdjust(soilType), 10);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("peat")]
    public void SoilRules_UnknownSoil_IsLoam_AndSaysItWasAssumed(string? soilType)
    {
        var holding = SoilRules.WaterHoldingFor(soilType);
        Assert.True(holding.Assumed);
        Assert.Same(Fao56EngineReference.DefaultSoil, holding.Soil);
    }

    [Fact]
    public void SoilRules_TotalAvailableWater_IsEq82()
    {
        var loam = SoilRules.WaterHoldingFor("loam");
        var expected = 1000.0 * (loam.ThetaFieldCapacity - loam.ThetaWiltingPoint) * 0.3;
        Assert.Equal(expected, SoilRules.TotalAvailableWaterMm(loam, 0.3), 9);
    }

    // ---- CropRules ------------------------------------------------------

    public static IEnumerable<object[]> AllCrops() =>
        Fao56EngineReference.AllCrops.Select(c => new object[] { c.Key });

    [Theory]
    [MemberData(nameof(AllCrops))]
    public void CropRules_KcFollowsTheReferenceTable_AtEachEnd(string cropKey)
    {
        var crop = Fao56EngineReference.TryResolveCrop(cropKey)!;

        Assert.Equal(crop.KcIni, CropRules.KcFor(crop, 1), 9);
        Assert.Equal(crop.KcMid, CropRules.KcFor(crop, crop.LIniDays + crop.LDevDays + 1), 9);
        Assert.Equal(crop.KcEnd, CropRules.KcFor(crop, crop.TotalDays), 9);

        // The assumed-stage factor is one of the crop's own three values.
        Assert.Contains(CropRules.KcWhenStageUnknown(crop), new[] { crop.KcIni, crop.KcMid, crop.KcEnd });
        Assert.Equal(new[] { crop.KcIni, crop.KcMid, crop.KcEnd }.Max(), CropRules.KcWhenStageUnknown(crop));
    }

    [Theory]
    [MemberData(nameof(AllCrops))]
    public void CropRules_StageFor_Boundaries(string cropKey)
    {
        var crop = Fao56EngineReference.TryResolveCrop(cropKey)!;
        var ini = crop.LIniDays;
        var dev = ini + crop.LDevDays;
        var mid = dev + crop.LMidDays;

        // The last day of a stage is still that stage, with 0 days left.
        Assert.Equal(SeasonStage.Establishing, CropRules.StageFor(crop, ini).Stage);
        Assert.Equal(0, CropRules.StageFor(crop, ini).DaysLeftInStage);
        Assert.Equal(SeasonStage.Growing, CropRules.StageFor(crop, ini + 1).Stage);
        Assert.Equal(SeasonStage.Growing, CropRules.StageFor(crop, dev).Stage);
        Assert.Equal(SeasonStage.PeakGrowth, CropRules.StageFor(crop, dev + 1).Stage);
        Assert.Equal(SeasonStage.PeakGrowth, CropRules.StageFor(crop, mid).Stage);
        Assert.Equal(SeasonStage.NearingHarvest, CropRules.StageFor(crop, mid + 1).Stage);
        Assert.Equal(SeasonStage.NearingHarvest, CropRules.StageFor(crop, crop.TotalDays).Stage);
        Assert.Equal(SeasonStage.SeasonComplete, CropRules.StageFor(crop, crop.TotalDays + 1).Stage);
        Assert.Null(CropRules.StageFor(crop, crop.TotalDays + 1).DaysLeftInStage);

        Assert.False(CropRules.SeasonComplete(crop, crop.TotalDays));
        Assert.True(CropRules.SeasonComplete(crop, crop.TotalDays + 1));
    }

    [Theory]
    [InlineData(SeasonStage.Establishing, false)]
    [InlineData(SeasonStage.Growing, false)]
    [InlineData(SeasonStage.PeakGrowth, true)]
    [InlineData(SeasonStage.NearingHarvest, false)]
    [InlineData(SeasonStage.SeasonComplete, false)]
    public void CropRules_SensitiveStage_IsPeakGrowthOnly(SeasonStage stage, bool expected)
    {
        Assert.Equal(expected, CropRules.SensitiveStage(stage));
    }

    [Theory]
    [InlineData(0, false)]
    [InlineData(1, true)]
    [InlineData(CropRules.StageChangeWarningDays, true)]
    [InlineData(CropRules.StageChangeWarningDays + 1, false)]
    public void CropRules_StageChangeSoon_Boundaries(int daysUntil, bool expected)
    {
        Assert.Equal(expected, CropRules.StageChangeSoon(daysUntil));
    }

    [Fact]
    public void CropRules_HarvestSoon_Boundaries()
    {
        var crop = Fao56EngineReference.TryResolveCrop("maize")!;
        Assert.Null(CropRules.HarvestSoon(crop, crop.TotalDays - CropRules.HarvestSoonDays - 1));
        Assert.Equal(CropRules.HarvestSoonDays, CropRules.HarvestSoon(crop, crop.TotalDays - CropRules.HarvestSoonDays));
        Assert.Equal(0, CropRules.HarvestSoon(crop, crop.TotalDays));
        Assert.Null(CropRules.HarvestSoon(crop, crop.TotalDays + 1));
    }

    [Fact]
    public void CropRules_NextStageChange_CountsToTheNextBoundary()
    {
        var crop = Fao56EngineReference.TryResolveCrop("maize")!;
        var next = CropRules.NextStageChange(crop, 1)!.Value;
        Assert.Equal(SeasonStage.Growing, next.Stage);
        Assert.Equal(crop.LIniDays, next.DaysUntil);

        // In the last stage there is nothing next.
        Assert.Null(CropRules.NextStageChange(crop, crop.TotalDays));
    }

    // ---- WaterRules -----------------------------------------------------

    [Theory]
    [InlineData(19.9, 20.0, false)]
    [InlineData(20.0, 20.0, true)]   // exactly at RAW: water (FAO-56 p. 171, "before or at the moment")
    [InlineData(25.0, 20.0, true)]
    public void WaterRules_ShouldWaterToday_AtRawCounts(double depletion, double raw, bool expected)
    {
        Assert.Equal(expected, WaterRules.ShouldWaterToday(depletion, raw));
    }

    [Theory]
    [InlineData(4.9, 5.0, false)]
    [InlineData(5.0, 5.0, true)]    // rain exactly equal to need covers it
    [InlineData(8.0, 5.0, true)]
    [InlineData(0.0, 0.0, true)]
    public void WaterRules_SkipForRain_EqualCovers(double rain, double need, bool expected)
    {
        Assert.Equal(expected, WaterRules.SkipForRain(rain, need));
    }

    [Theory]
    [InlineData(6.0, 1.5, 1.5, 6)]      // 9 L at 1.5 L/min
    [InlineData(6.1, 1.5, 1.5, 7)]      // rounds UP, never under-waters
    [InlineData(0.0, 1.5, 1.5, 0)]
    [InlineData(6.0, null, 1.5, null)]  // no size, no whole-zone minutes
    [InlineData(6.0, 1.5, null, null)]  // no flow rate, no minutes
    public void WaterRules_MinutesToRun(double depletion, double? area, double? flow, int? expected)
    {
        Assert.Equal(expected, WaterRules.MinutesToRun(depletion, area, flow));
    }

    [Theory]
    [InlineData(null, false)]
    [InlineData(0, true)]
    [InlineData(WaterRules.WaterSoonDays, true)]
    [InlineData(WaterRules.WaterSoonDays + 1, false)]
    public void WaterRules_WaterSoon_Boundaries(int? days, bool expected)
    {
        Assert.Equal(expected, WaterRules.WaterSoon(days));
    }

    [Theory]
    [InlineData(5.19, 4.0, false)]
    [InlineData(5.2, 4.0, true)]    // exactly 1.3x
    [InlineData(9.0, 0.0, false)]   // no history, no comparison
    public void WaterRules_HotDaysAhead_Boundaries(double peak, double mean, bool expected)
    {
        Assert.Equal(expected, WaterRules.HotDaysAhead(peak, mean));
    }

    [Theory]
    [InlineData(1.0, false)]
    [InlineData(0.999, true)]
    [InlineData(0.0, true)]
    public void WaterRules_WasStressed_IsKsBelowOne(double ks, bool expected)
    {
        Assert.Equal(expected, WaterRules.WasStressed(ks));
    }

    [Theory]
    [InlineData(29.9, 30.0, true, true)]
    [InlineData(30.0, 30.0, true, true)]    // at the threshold: water
    [InlineData(30.1, 30.0, true, false)]
    [InlineData(10.0, 30.0, false, false)]  // stale: never on its own
    [InlineData(null, 30.0, true, false)]   // uncalibrated: no % to compare
    [InlineData(10.0, null, true, false)]
    public void WaterRules_AtOrBelowFarmerThreshold(double? pct, double? threshold, bool fresh, bool expected)
    {
        Assert.Equal(expected, WaterRules.AtOrBelowFarmerThreshold(pct, threshold, fresh));
    }

    [Theory]
    [InlineData(0.55, 1.00, 1200.0, 3000.0, 1200.0 + 0.55 * 1800.0)]  // wet is the lower number
    [InlineData(0.55, 1.00, 80.0, 20.0, 80.0 - 0.55 * 60.0)]          // wet is the higher number
    [InlineData(0.05, 1.00, 80.0, 20.0, 80.0 - 0.10 * 60.0)]          // clamped up to 0.1 (p. 162)
    [InlineData(0.90, 1.00, 80.0, 20.0, 80.0 - 0.80 * 60.0)]          // clamped down to 0.8
    public void WaterRules_RecommendedThreshold(double p, double soilFactor, double wet, double dry, double expected)
    {
        Assert.Equal(expected, WaterRules.RecommendedThreshold(p, soilFactor, wet, dry), 9);
    }

    [Theory]
    [InlineData(2300.0, 2200.0, 1200.0, 3000.0, true)]   // higher = drier when wet reads low
    [InlineData(2100.0, 2200.0, 1200.0, 3000.0, false)]
    [InlineData(40.0, 50.0, 80.0, 20.0, true)]           // lower = drier when wet reads high
    [InlineData(50.0, 50.0, 80.0, 20.0, false)]          // equal is not too dry
    public void WaterRules_ThresholdTooDry_FollowsTheProbe(double threshold, double recommended, double wet, double dry, bool expected)
    {
        Assert.Equal(expected, WaterRules.ThresholdTooDry(threshold, recommended, wet, dry));
    }

    // ---- VerdictRules ---------------------------------------------------

    [Theory]
    [InlineData(12.0, 10.0, WateringVerdict.AboutRight)]   // exactly 1.2: still about right
    [InlineData(12.01, 10.0, WateringVerdict.TooMuch)]
    [InlineData(8.0, 10.0, WateringVerdict.AboutRight)]    // exactly 0.8
    [InlineData(7.99, 10.0, WateringVerdict.TooLittle)]
    [InlineData(10.0, 10.0, WateringVerdict.AboutRight)]
    [InlineData(5.0, 0.0, WateringVerdict.Unknown)]        // nothing needed: nothing to judge
    [InlineData(-1.0, 10.0, WateringVerdict.Unknown)]
    public void VerdictRules_Bands(double applied, double needed, WateringVerdict expected)
    {
        Assert.Equal(expected, VerdictRules.For(applied, needed));
    }

    [Fact]
    public void VerdictRules_TheOverwateringInsightUsesTheSameRatio()
    {
        Assert.Equal(VerdictRules.OverwaterRatio, ZoneInsightBuilder.OverwateringMultiple);
    }

    // ---- KitRules -------------------------------------------------------

    [Theory]
    [InlineData(null, false)]
    [InlineData(2.99, false)]
    [InlineData(3.0, true)]
    public void KitRules_IsOffline_Boundaries(double? hours, bool expected)
    {
        Assert.Equal(expected, KitRules.IsOffline(hours.HasValue ? TimeSpan.FromHours(hours.Value) : null));
    }

    [Theory]
    [InlineData(null, false)]
    [InlineData(5.99, false)]
    [InlineData(6.0, true)]
    public void KitRules_IsStuck_Boundaries(double? hours, bool expected)
    {
        Assert.Equal(expected, KitRules.IsStuck(hours.HasValue ? TimeSpan.FromHours(hours.Value) : null));
    }

    [Fact]
    public void KitRules_IdenticalFor_StopsAtTheFirstChange()
    {
        var t = new DateTime(2026, 2, 10, 12, 0, 0, DateTimeKind.Utc);
        var newestFirst = new List<(DateTime, double)>
        {
            (t, 50), (t.AddHours(-2), 50), (t.AddHours(-4), 50), (t.AddHours(-5), 49), (t.AddHours(-9), 50),
        };
        Assert.Equal(TimeSpan.FromHours(4), KitRules.IdenticalFor(newestFirst));
        Assert.Equal(TimeSpan.Zero, KitRules.IdenticalFor(new List<(DateTime, double)>()));
    }

    [Theory]
    [InlineData(1200.0 + 0.15 * 1800.0, false)]   // exactly 15%: not drifting yet
    [InlineData(1200.0 + 0.16 * 1800.0, true)]
    [InlineData(1200.0, false)]
    public void KitRules_IsDrifting_Boundaries(double wettest, bool expected)
    {
        Assert.Equal(expected, KitRules.IsDrifting(wettest, 1200.0, 3000.0));
    }

    [Fact]
    public void KitRules_Wettest_FollowsTheProbe()
    {
        var readings = new[] { 1300.0, 1250.0, 2000.0 };
        Assert.Equal(1250.0, KitRules.Wettest(readings, 1200.0, 3000.0));
        Assert.Equal(2000.0, KitRules.Wettest(readings, 3000.0, 1200.0));
        Assert.Null(KitRules.Wettest(readings, null, 3000.0));
    }

    [Fact]
    public void KitRules_PumpRanNoChange_NeverOnMissingEvidence()
    {
        var start = new DateTime(2026, 2, 10, 6, 0, 0, DateTimeKind.Utc);
        var later = start.AddHours(2);

        // Soil got wetter (higher, the firmware's default): fine.
        Assert.False(KitRules.PumpRanNoChange(start, 300, later, 40, new[] { 55.0 }, wetIsLower: false));
        // No change: the pump ran but nothing reached the probe.
        Assert.True(KitRules.PumpRanNoChange(start, 300, later, 40, new[] { 40.0, 39.0 }, wetIsLower: false));
        // Probe that reads lower when wet.
        Assert.False(KitRules.PumpRanNoChange(start, 300, later, 2400, new[] { 1900.0 }, wetIsLower: true));
        Assert.True(KitRules.PumpRanNoChange(start, 300, later, 2400, new[] { 2400.0 }, wetIsLower: true));
        // Missing evidence on either side: a data gap, not a broken pump.
        Assert.False(KitRules.PumpRanNoChange(start, 300, later, null, new[] { 40.0 }, wetIsLower: false));
        Assert.False(KitRules.PumpRanNoChange(start, 300, later, 40, Array.Empty<double>(), wetIsLower: false));
        // Window not yet over.
        Assert.False(KitRules.PumpRanNoChange(start, 300, start.AddMinutes(20), 40, new[] { 40.0 }, wetIsLower: false));
        // Too short a run to judge.
        Assert.False(KitRules.PumpRanNoChange(start, KitRules.PumpCheckMinimumSeconds - 1, later, 40, new[] { 40.0 }, wetIsLower: false));
    }

    [Fact]
    public void KitRules_IsDhtOffline()
    {
        var now = new DateTime(2026, 2, 10, 12, 0, 0, DateTimeKind.Utc);
        var threeGood = new List<(DateTime, string, double)>
        {
            (now.AddMinutes(-1), "Temperature", 24), (now.AddMinutes(-2), "Humidity", 60), (now.AddMinutes(-3), "Temperature", 24),
        };
        var twoGoodThenBad = new List<(DateTime, string, double)>
        {
            (now.AddMinutes(-1), "Temperature", 24), (now.AddMinutes(-2), "Humidity", 60), (now.AddMinutes(-3), "Temperature", double.NaN),
        };
        var allOld = new List<(DateTime, string, double)> { (now.AddHours(-5), "Temperature", 24) };

        Assert.False(KitRules.IsDhtOffline(true, threeGood, now, out _));
        Assert.True(KitRules.IsDhtOffline(true, twoGoodThenBad, now, out _));
        Assert.True(KitRules.IsDhtOffline(true, allOld, now, out var since));
        Assert.Equal(now.AddHours(-5), since);
        // The whole board quiet is "offline", not a DHT11 fault.
        Assert.False(KitRules.IsDhtOffline(false, allOld, now, out _));
    }

    [Theory]
    [InlineData("Temperature", -10.0, true)]
    [InlineData("Temperature", 60.0, true)]
    [InlineData("Temperature", 60.1, false)]
    [InlineData("Humidity", 100.0, true)]
    [InlineData("Humidity", -0.1, false)]
    [InlineData("Humidity", double.NaN, false)]
    [InlineData("Pressure", 50.0, false)]
    public void KitRules_IsValidDhtValue(string type, double value, bool expected)
    {
        Assert.Equal(expected, KitRules.IsValidDhtValue(type, value));
    }

    [Fact]
    public void KitRules_Problems_InAFixedOrder()
    {
        var all = new ZoneFaultSignals
        {
            SinceLastReading = TimeSpan.FromHours(4),
            IdenticalReadingFor = TimeSpan.FromHours(7),
            WateringAppearedToFail = true,
            DhtOffline = true,
            SevenDayMinimumReading = 2000,
        };

        Assert.Equal(
            new[] { KitProblem.Offline, KitProblem.SensorStuck, KitProblem.PumpRanNoChange, KitProblem.DhtOffline, KitProblem.SensorDrift },
            KitRules.Problems(all, 1200, 3000));
        Assert.Empty(KitRules.Problems(new ZoneFaultSignals(), 1200, 3000));
    }
}
