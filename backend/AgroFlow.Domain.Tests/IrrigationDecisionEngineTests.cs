using AgroFlow.Business.Agronomy;
using AgroFlow.Business.Agronomy.RuleBook;

namespace AgroFlow.Domain.Tests;

public class IrrigationDecisionEngineTests
{
    private static readonly DateOnly Today = new(2026, 10, 7);

    private static ZoneEngineInput Input(double initialDr = 100, double todayRain = 0)
    {
        var input = new ZoneEngineInput
        {
            ZoneId = 7,
            ZoneName = "North field",
            CropType = "maize",
            PlantingDate = Today.AddDays(-60),
            SoilType = "loam",
            AreaM2 = 200,
            FlowRateLpm = 20,
            CalibrationWet = 90,
            CalibrationDry = 20,
            FarmLatitudeDegrees = -33.93,
            Today = Today,
            NowUtc = Today.ToDateTime(new TimeOnly(12, 0), DateTimeKind.Utc),
            InitialDepletionDate = Today.AddDays(-1),
            InitialDepletionMm = initialDr,
            BalanceStartDate = Today,
        };

        for (var i = 0; i < 8; i++)
        {
            input.Weather.Add(new ZoneWeatherDay
            {
                Date = Today.AddDays(i),
                TMinC = 16,
                TMaxC = 30,
                RainMm = i == 0 ? todayRain : 0,
                RhMinPct = 35,
                RhMaxPct = 75,
                WindMs = 2,
                WindHeightM = 10,
                IsForecast = true,
            });
        }
        return input;
    }

    [Fact]
    public void DryField_NoRain_WatersNow() =>
        Assert.Equal(IrrigationPrimaryAction.WaterNow, Fao56Engine.Run(Input()).PrimaryAction);

    [Fact]
    public void DryField_TraceRain_StillWatersNow() =>
        Assert.Equal(IrrigationPrimaryAction.WaterNow, Fao56Engine.Run(Input(todayRain: 0.1)).PrimaryAction);

    [Fact]
    public void DryField_PartialUsefulRain_ReducesWatering()
    {
        var dry = Fao56Engine.Run(Input());
        var partial = Fao56Engine.Run(Input(todayRain: 20));
        Assert.Equal(IrrigationPrimaryAction.WaterNowReduced, partial.PrimaryAction);
        Assert.True(partial.RecommendedDepthMm < dry.RecommendedDepthMm);
    }

    [Fact]
    public void DryField_EnoughRain_Postpones()
    {
        var result = Fao56Engine.Run(Input(todayRain: 60));
        Assert.Equal(IrrigationPrimaryAction.PostponeForRain, result.PrimaryAction);
        Assert.True(result.ProjectedPostRainDepletionMm < result.RawMm);
    }

    [Fact]
    public void AdequateRootZone_NeedsNoWater()
    {
        var result = Fao56Engine.Run(Input(initialDr: 5));
        Assert.Equal(IrrigationPrimaryAction.NoWaterNeeded, result.PrimaryAction);
        Assert.Null(result.RecommendedDepthMm);
    }

    [Fact]
    public void ThresholdReachedTomorrow_IsWaterSoon()
    {
        var result = Enumerable.Range(0, 100)
            .Select(i => Fao56Engine.Run(Input(initialDr: i)))
            .First(r => r.PrimaryAction == IrrigationPrimaryAction.WaterSoon);
        Assert.InRange(result.DaysToNextWatering!.Value, 1, 2);
    }

    [Fact]
    public void NoWater_CannotCarryRuntime()
    {
        var result = Fao56Engine.Run(Input(initialDr: 5));
        Assert.Null(result.RecommendedRuntimeSeconds);
        Assert.Null(result.RecommendedMinutes);
        Assert.Null(result.RecommendedLitres);
    }

    [Fact]
    public void Postpone_CannotRemainPastTrigger()
    {
        var result = Fao56Engine.Run(Input(todayRain: 60));
        Assert.True(result.ProjectedPostRainDepletionMm < result.RawMm);
        Assert.Null(result.RecommendedRuntimeSeconds);
    }

    [Fact]
    public void ForecastPlan_IsRollingSevenDays()
    {
        var result = Fao56Engine.Run(Input(initialDr: 5));
        Assert.Equal(7, result.Outlook.Count);
        Assert.Equal(Today, result.Outlook[0].Date);
        Assert.Equal(Today.AddDays(6), result.Outlook[^1].Date);
    }

    [Fact]
    public void CalendarWeekBoundary_DoesNotResetDepletion()
    {
        var sunday = new DateOnly(2026, 10, 11);
        var input = Input(initialDr: 77);
        input.Today = sunday.AddDays(1);
        input.InitialDepletionDate = sunday;
        input.BalanceStartDate = input.Today;
        foreach (var row in input.Weather) row.Date = input.Today.AddDays(input.Weather.IndexOf(row));
        var result = Fao56Engine.Run(input);
        Assert.True(result.DepletionMm >= 77);
    }

    [Fact]
    public void CurrentSensor_IsNotReplayedThroughOldWeather()
    {
        var input = Input(initialDr: 40);
        input.BalanceStartDate = Today.AddDays(-30);
        input.Readings.Add(new ZoneMoistureReading
        {
            RecordedAtUtc = input.NowUtc!.Value.AddMinutes(-5),
            RawValue = 10,
        });
        for (var i = 30; i >= 1; i--)
        {
            input.Weather.Add(new ZoneWeatherDay
            {
                Date = Today.AddDays(-i), TMinC = 16, TMaxC = 30,
                RainMm = 0, RhMinPct = 35, RhMaxPct = 75, WindMs = 2,
                WindHeightM = 10, IsForecast = false,
            });
        }
        var withoutSensor = Input(initialDr: 40);
        withoutSensor.BalanceStartDate = Today.AddDays(-30);
        withoutSensor.Weather.AddRange(input.Weather.Where(w => !w.IsForecast));
        var a = Fao56Engine.Run(input);
        var b = Fao56Engine.Run(withoutSensor);
        Assert.Equal(b.DepletionMm, a.DepletionMm);
    }

    [Fact]
    public void CurrentPercentDomain_IsExplicit()
    {
        var input = Input();
        input.Readings.Add(new ZoneMoistureReading { RecordedAtUtc = input.NowUtc!.Value, RawValue = 62 });
        var result = Fao56Engine.Run(input);
        Assert.Equal(SoilMoistureDomain.RelativePercent, result.SensorDomain);
        Assert.Equal(62, result.RelativeMoisturePercent);
    }

    [Fact]
    public void LegacyAdcDomain_IsExplicit()
    {
        var input = Input();
        input.CalibrationWet = 1200;
        input.CalibrationDry = 3000;
        input.Readings.Add(new ZoneMoistureReading { RecordedAtUtc = input.NowUtc!.Value, RawValue = 2100 });
        var result = Fao56Engine.Run(input);
        Assert.Equal(SoilMoistureDomain.LegacyRawAdc, result.SensorDomain);
        Assert.Equal(50, result.RelativeMoisturePercent);
    }

    [Fact]
    public void MixedCalibrationDomains_AreInvalid()
    {
        var input = Input();
        input.CalibrationWet = 90;
        input.CalibrationDry = 3000;
        var result = Fao56Engine.Run(input);
        Assert.Equal(SoilMoistureDomain.InvalidMixedCalibration, result.SensorDomain);
        Assert.False(result.CalibrationValid);
    }

    [Fact]
    public void StaleSensor_IsOnlyAConfidenceModifier()
    {
        var input = Input();
        input.Readings.Add(new ZoneMoistureReading { RecordedAtUtc = input.NowUtc!.Value.AddDays(-2), RawValue = 20 });
        var result = Fao56Engine.Run(input);
        Assert.True(result.ReadingStale);
        Assert.Contains("stale", result.SensorModifier!, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void MissingSensor_DoesNotBlockWeatherBalance()
    {
        var result = Fao56Engine.Run(Input());
        Assert.True(result.BalanceRan);
        Assert.Contains("unavailable", result.SensorModifier!, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void SensorModelDisagreement_AsksForInspection()
    {
        var input = Input(initialDr: 100);
        input.Readings.Add(new ZoneMoistureReading { RecordedAtUtc = input.NowUtc!.Value, RawValue = 95 });
        var result = Fao56Engine.Run(input);
        Assert.Contains("Check the field", result.SensorModifier!);
        Assert.NotEqual(ConfidenceLevel.High, result.Confidence.Level);
    }

    [Fact]
    public void SensorAgreesDry_CorroboratesWaterAction()
    {
        var input = Input(initialDr: 100);
        input.Readings.Add(new ZoneMoistureReading { RecordedAtUtc = input.NowUtc!.Value, RawValue = 35 });
        var result = Fao56Engine.Run(input);
        Assert.Contains("also indicates relatively dry", result.SensorModifier!);
    }

    [Fact]
    public void SensorAgreesWet_CorroboratesNoWaterAction()
    {
        var input = Input(initialDr: 5);
        input.Readings.Add(new ZoneMoistureReading { RecordedAtUtc = input.NowUtc!.Value, RawValue = 90 });
        var result = Fao56Engine.Run(input);
        Assert.Contains("supports", result.SensorModifier!);
    }

    [Fact]
    public void MissingArea_StillReturnsDepthOnly()
    {
        var input = Input();
        input.AreaM2 = null;
        var result = Fao56Engine.Run(input);
        Assert.NotNull(result.RecommendedDepthMm);
        Assert.Null(result.RecommendedLitres);
    }

    [Fact]
    public void MissingFlow_ReturnsDepthAndLitresWithoutRuntime()
    {
        var input = Input();
        input.FlowRateLpm = null;
        var result = Fao56Engine.Run(input);
        Assert.NotNull(result.RecommendedDepthMm);
        Assert.NotNull(result.RecommendedLitres);
        Assert.Null(result.RecommendedRuntimeSeconds);
    }

    [Fact]
    public void AreaAndFlow_ReturnExactRuntime()
    {
        var result = Fao56Engine.Run(Input());
        Assert.Equal(result.RecommendedLitres!.Value / 20 * 60, result.RecommendedRuntimeSeconds!.Value, 6);
    }

    [Fact]
    public void ExactRuntime_PreservesSubMinuteDose()
    {
        Assert.Equal(0.24, SoilWaterBalance.IrrigationRuntimeSeconds(0.4, 100)!.Value, 6);
    }

    [Fact]
    public void TinyDose_HasOversizedPumpWarning()
    {
        var input = Input(initialDr: 100);
        input.AreaM2 = 0.01;
        input.FlowRateLpm = 1000;
        var result = Fao56Engine.Run(input);
        Assert.Contains("too large", result.EquipmentWarning!);
    }

    [Fact]
    public void VeryLongDose_HasLowFlowWarning()
    {
        var input = Input(initialDr: 100);
        input.AreaM2 = 10000;
        input.FlowRateLpm = 1;
        var result = Fao56Engine.Run(input);
        Assert.Contains("too low", result.EquipmentWarning!);
    }

    [Fact]
    public void MissingCalendarDay_IsMaterialised()
    {
        var input = Input(initialDr: 20);
        input.BalanceStartDate = Today.AddDays(-2);
        input.Weather.Add(new ZoneWeatherDay
        {
            Date = Today.AddDays(-2), TMinC = 15, TMaxC = 28, IsForecast = false,
        });
        var result = Fao56Engine.Run(input);
        Assert.Contains(result.Days, d => d.Day == Today.AddDays(-1) && !d.EtoMm.HasValue);
    }

    [Fact]
    public void FuturePlanting_HasNoQuantity()
    {
        var input = Input();
        input.PlantingDate = Today.AddDays(4);
        var result = Fao56Engine.Run(input);
        Assert.Equal(IrrigationPrimaryAction.CropNotPlanted, result.PrimaryAction);
        Assert.Null(result.RecommendedDepthMm);
        Assert.Empty(result.Outlook);
    }

    [Fact]
    public void CompletedAnnualCrop_HasNoSchedule()
    {
        var input = Input();
        input.PlantingDate = Today.AddDays(-400);
        var result = Fao56Engine.Run(input);
        Assert.Equal(IrrigationPrimaryAction.SeasonComplete, result.PrimaryAction);
        Assert.Empty(result.Outlook);
    }

    [Fact]
    public void ActualPartialIrrigation_ReducesFutureDepletion()
    {
        var baseline = Fao56Engine.Run(Input(initialDr: 50));
        var input = Input(initialDr: 50);
        input.IrrigationMmByDay[Today] = 12;
        var irrigated = Fao56Engine.Run(input);
        Assert.True(irrigated.ProjectedPostRainDepletionMm < baseline.ProjectedPostRainDepletionMm);
    }

    [Fact]
    public void FarmerSkip_DoesNotInventIrrigation()
    {
        var input = Input(initialDr: 100);
        var result = Fao56Engine.Run(input);
        Assert.Equal(0, input.IrrigationMmByDay.Count);
        Assert.True(result.DepletionMm >= 100);
    }

    [Fact]
    public void HeavyToLowRain_ChangesPostponeToWater()
    {
        Assert.Equal(IrrigationPrimaryAction.PostponeForRain, Fao56Engine.Run(Input(todayRain: 60)).PrimaryAction);
        Assert.Contains(Fao56Engine.Run(Input(todayRain: 2)).PrimaryAction,
            new[] { IrrigationPrimaryAction.WaterNow, IrrigationPrimaryAction.WaterNowReduced });
    }

    [Fact]
    public void LowToHeavyRain_ChangesWaterToPostpone()
    {
        Assert.Equal(IrrigationPrimaryAction.WaterNow, Fao56Engine.Run(Input(todayRain: 0.1)).PrimaryAction);
        Assert.Equal(IrrigationPrimaryAction.PostponeForRain, Fao56Engine.Run(Input(todayRain: 60)).PrimaryAction);
    }

    [Fact]
    public void ForecastPlanDoesNotPersistAssumedIrrigationAsActual()
    {
        var input = Input();
        _ = Fao56Engine.Run(input);
        Assert.Empty(input.IrrigationMmByDay);
    }

    [Fact]
    public void RuntimeWarningDoesNotCapRequirement()
    {
        var input = Input();
        input.AreaM2 = 10000;
        input.FlowRateLpm = 1;
        var result = Fao56Engine.Run(input);
        Assert.True(result.RecommendedRuntimeSeconds > WaterRules.ImpracticallyLongRuntimeSeconds);
    }

    [Fact]
    public void ForecastRain_DoesNotChangeHistoricalDepletion()
    {
        var dry = Fao56Engine.Run(Input(initialDr: 70, todayRain: 0));
        var wetForecast = Fao56Engine.Run(Input(initialDr: 70, todayRain: 60));
        Assert.Equal(dry.DepletionMm, wetForecast.DepletionMm);
    }

    [Fact]
    public void ObservedRain_DoesChangeHistoricalDepletion()
    {
        var input = Input(initialDr: 70);
        input.Weather.Clear();
        input.BalanceStartDate = Today;
        input.Weather.Add(new ZoneWeatherDay
        {
            Date = Today, TMinC = 16, TMaxC = 30, RainMm = 30,
            RhMinPct = 35, RhMaxPct = 75, WindMs = 2, WindHeightM = 10,
            IsForecast = false,
        });
        var result = Fao56Engine.Run(input);
        Assert.True(result.DepletionMm < 70);
    }

    [Fact]
    public void OutlookUncertainty_IncreasesAfterTomorrow()
    {
        var result = Fao56Engine.Run(Input(initialDr: 5));
        Assert.False(result.Outlook[1].Tentative);
        Assert.True(result.Outlook[2].Tentative);
    }

    [Fact]
    public void PlanChange_DetectsIrrigationMovedEarlier()
    {
        var change = IrrigationPlanChangeDetector.Compare("North field",
            Plan((2, IrrigationPrimaryAction.WaterNow, 20)),
            Plan((1, IrrigationPrimaryAction.WaterNow, 20)));
        Assert.Equal(IrrigationPlanChangeKind.MovedEarlier, change!.Kind);
    }

    [Fact]
    public void PlanChange_DetectsIrrigationMovedLater()
    {
        var change = IrrigationPlanChangeDetector.Compare("North field",
            Plan((1, IrrigationPrimaryAction.WaterNow, 20)),
            Plan((3, IrrigationPrimaryAction.WaterNow, 20)));
        Assert.Equal(IrrigationPlanChangeKind.MovedLater, change!.Kind);
    }

    [Fact]
    public void PlanChange_DetectsRainNoLongerSufficient()
    {
        var change = IrrigationPlanChangeDetector.Compare("North field",
            Plan((0, IrrigationPrimaryAction.PostponeForRain, null)),
            Plan((0, IrrigationPrimaryAction.WaterNowReduced, 35)));
        Assert.Equal(IrrigationPlanChangeKind.RainNoLongerSufficient, change!.Kind);
    }

    [Fact]
    public void PlanChange_DetectsNewRainPostponement()
    {
        var change = IrrigationPlanChangeDetector.Compare("North field",
            Plan((0, IrrigationPrimaryAction.WaterNow, 35)),
            Plan((0, IrrigationPrimaryAction.PostponeForRain, null)));
        Assert.Equal(IrrigationPlanChangeKind.PostponeForRain, change!.Kind);
    }

    [Fact]
    public void PlanChange_IgnoresTinyAmountMovement()
    {
        var change = IrrigationPlanChangeDetector.Compare("North field",
            Plan((0, IrrigationPrimaryAction.WaterNow, 20)),
            Plan((0, IrrigationPrimaryAction.WaterNow, 20.5)));
        Assert.Null(change);
    }

    [Fact]
    public void PlanChange_DetectsMaterialAmountReduction()
    {
        var change = IrrigationPlanChangeDetector.Compare("North field",
            Plan((0, IrrigationPrimaryAction.WaterNow, 30)),
            Plan((0, IrrigationPrimaryAction.WaterNowReduced, 20)));
        Assert.Equal(IrrigationPlanChangeKind.AmountReduced, change!.Kind);
    }

    private static List<RollingIrrigationDay> Plan(
        (int Offset, IrrigationPrimaryAction Action, double? Depth) irrigation)
    {
        var plan = Enumerable.Range(0, 7)
            .Select(i => new RollingIrrigationDay
            {
                Date = Today.AddDays(i),
                Action = IrrigationPrimaryAction.NoWaterNeeded,
            }).ToList();
        plan[irrigation.Offset].Action = irrigation.Action;
        plan[irrigation.Offset].RequiredDepthMm = irrigation.Depth;
        return plan;
    }
}
