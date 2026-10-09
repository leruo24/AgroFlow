using System.Text.RegularExpressions;
using AgroFlow.Api.Endpoints;
using AgroFlow.Api.Reports;
using AgroFlow.Business.Agronomy;
using AgroFlow.Business.Agronomy.RuleBook;

namespace AgroFlow.Domain.Tests;

// Finding 7: Fao56Engine.PrimaryAction (and its rolling Outlook) is the single
// decision. Explanations, IrrigationAdvisor, TodayRules, the report forecast
// cards and the schedule report only word it - none may re-decide and land on
// a different answer.
public class DecisionAgreementTests
{
    private static readonly DateOnly Today = new(2026, 10, 7);

    private static readonly Regex Jargon = new(@"\b(Kc|Ks|RAW|TAW|Dr|ETc|ETo|ET0|FAO-56)\b");

    // The same field as IrrigationDecisionEngineTests: maize, loam, 200 m², 20 L/min.
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

    // One engine input per PrimaryAction the engine can reach today.
    private static ZoneEngineInput InputFor(IrrigationPrimaryAction action)
    {
        switch (action)
        {
            case IrrigationPrimaryAction.WaterNow: return Input();
            case IrrigationPrimaryAction.WaterNowReduced: return Input(todayRain: 20);
            case IrrigationPrimaryAction.PostponeForRain: return Input(todayRain: 60);
            case IrrigationPrimaryAction.NoWaterNeeded: return Input(initialDr: 5);
            case IrrigationPrimaryAction.WaterSoon:
                return Enumerable.Range(0, 100).Select(i => Input(initialDr: i))
                    .First(i => Fao56Engine.Run(i).PrimaryAction == IrrigationPrimaryAction.WaterSoon);
            case IrrigationPrimaryAction.CropNotPlanted:
            {
                var i = Input();
                i.PlantingDate = Today.AddDays(4);
                return i;
            }
            case IrrigationPrimaryAction.SeasonComplete:
            {
                var i = Input();
                i.PlantingDate = Today.AddDays(-400);
                return i;
            }
            case IrrigationPrimaryAction.InsufficientData:
            {
                // The balance carries a persisted state (so BalanceRan is true)
                // but there is no weather for today: no decision can be made.
                var i = Input();
                i.Weather.Clear();
                return i;
            }
            default: throw new ArgumentOutOfRangeException(nameof(action));
        }
    }

    public static IEnumerable<object[]> ReachableActions() => new[]
    {
        IrrigationPrimaryAction.WaterNow, IrrigationPrimaryAction.WaterNowReduced,
        IrrigationPrimaryAction.PostponeForRain, IrrigationPrimaryAction.NoWaterNeeded,
        IrrigationPrimaryAction.WaterSoon, IrrigationPrimaryAction.CropNotPlanted,
        IrrigationPrimaryAction.SeasonComplete, IrrigationPrimaryAction.InsufficientData,
    }.Select(a => new object[] { a });

    // Every value the enum has. A new PrimaryAction must be added to the
    // tables below before this passes.
    public static IEnumerable<object[]> AllActions() =>
        Enum.GetValues<IrrigationPrimaryAction>().Select(a => new object[] { a });

    // What each consumer must say, written out by hand rather than derived
    // from the code under test.
    private static AdviceAction ExpectedAdvice(IrrigationPrimaryAction a) => a switch
    {
        IrrigationPrimaryAction.WaterNow => AdviceAction.IrrigateNow,
        IrrigationPrimaryAction.WaterNowReduced => AdviceAction.IrrigateNow,
        IrrigationPrimaryAction.PostponeForRain => AdviceAction.HoldRainExpected,
        IrrigationPrimaryAction.NoWaterNeeded => AdviceAction.NoActionNeeded,
        IrrigationPrimaryAction.WaterSoon => AdviceAction.WaterSoon,
        IrrigationPrimaryAction.CheckField => AdviceAction.CheckField,
        IrrigationPrimaryAction.CheckSensor => AdviceAction.CheckSensor,
        IrrigationPrimaryAction.CheckIrrigationSystem => AdviceAction.CheckIrrigationSystem,
        IrrigationPrimaryAction.FinishSetup => AdviceAction.FinishSetup,
        IrrigationPrimaryAction.InsufficientData => AdviceAction.InsufficientData,
        IrrigationPrimaryAction.CropNotPlanted => AdviceAction.CropNotPlanted,
        IrrigationPrimaryAction.SeasonComplete => AdviceAction.SeasonComplete,
        _ => throw new ArgumentOutOfRangeException(nameof(a), a, "Add the new PrimaryAction to DecisionAgreementTests."),
    };

    private static string ExpectedTodayKind(IrrigationPrimaryAction a) => a switch
    {
        IrrigationPrimaryAction.WaterNow or IrrigationPrimaryAction.WaterNowReduced => "water",
        IrrigationPrimaryAction.PostponeForRain => "skip",
        IrrigationPrimaryAction.WaterSoon => "soon",
        IrrigationPrimaryAction.NoWaterNeeded or IrrigationPrimaryAction.CropNotPlanted or IrrigationPrimaryAction.SeasonComplete => "none",
        IrrigationPrimaryAction.CheckField or IrrigationPrimaryAction.CheckSensor or IrrigationPrimaryAction.CheckIrrigationSystem => "kit",
        IrrigationPrimaryAction.FinishSetup or IrrigationPrimaryAction.InsufficientData => "setup",
        _ => throw new ArgumentOutOfRangeException(nameof(a), a, "Add the new PrimaryAction to DecisionAgreementTests."),
    };

    private static bool Waters(IrrigationPrimaryAction a) =>
        a is IrrigationPrimaryAction.WaterNow or IrrigationPrimaryAction.WaterNowReduced;

    private static ZoneAdvice Advise(ZoneEngineInput input, double? moisture = null, double? threshold = null) =>
        IrrigationAdvisor.Advise(new ZoneAdviceInput
        {
            ZoneName = input.ZoneName,
            CropType = input.CropType,
            PlantingDate = input.PlantingDate,
            AsOf = input.Today,
            SoilMoisturePercent = moisture,
            MoistureThresholdPercent = threshold,
            FarmLatitudeDegrees = input.FarmLatitudeDegrees,
            LatestWeather = new DailyWeather(input.Today, 16, 30, input.Weather.FirstOrDefault()?.RainMm ?? 0, true),
            Forecast = input.Weather.Where(w => w.Date > input.Today)
                .Select(w => new DailyWeather(w.Date, w.TMinC ?? 16, w.TMaxC ?? 30, w.RainMm ?? 0, true)).ToList(),
            WaterBalance = input,
        });

    private static WaterUsageReportModel Report(ZoneEngineInput input, ZoneEngineResult result) => new()
    {
        FarmName = "Green Farm", ZoneName = input.ZoneName,
        From = input.Today.AddDays(-6), To = input.Today,
        GeneratedAtSast = new DateTimeOffset(input.Today.ToDateTime(new TimeOnly(9, 0)), TimeSpan.FromHours(2)),
        Days = Array.Empty<WaterUsageReportModel.DayLine>(),
        MoistureSeries = Array.Empty<ChartSvg.MoisturePoint>(),
        PumpPositions = Array.Empty<double>(),
        Advice = Array.Empty<WaterUsageReportModel.AdviceLine>(),
        EngineInput = input,
        Engine = result,
    };

    // ---- the agreement matrix ----------------------------------------------

    [Theory]
    [MemberData(nameof(ReachableActions))]
    public void EveryConsumer_AgreesWithPrimaryAction_OnRealEngineRuns(IrrigationPrimaryAction expected)
    {
        var input = InputFor(expected);
        var result = Fao56Engine.Run(input);
        Assert.Equal(expected, result.PrimaryAction);

        var insights = ZoneInsightBuilder.Build(input, result, new ZoneFaultSignals());
        var today = TodayRules.For(result, insights);

        // A threshold that, on the old path, would always have said "water":
        // it must not leak into any answer once the balance decides.
        var advice = Advise(input, moisture: 10, threshold: 30);
        var card = ActionReport.ForecastAction(new[] { Report(input, result) }, Today);

        // IrrigationAdvisor
        Assert.Equal(expected, advice.PrimaryAction);
        Assert.Equal(ExpectedAdvice(expected), advice.Action);
        Assert.DoesNotContain(advice.Reasoning, r => r.Contains("threshold"));
        Assert.DoesNotContain("threshold", advice.Summary);
        Assert.Equal(Waters(expected), advice.Summary.Contains("Irrigate today"));
        Assert.Equal(expected == IrrigationPrimaryAction.PostponeForRain, advice.Summary.Contains("Hold irrigation"));
        Assert.NotNull(advice.PlainSummary);
        Assert.Equal(Waters(expected), advice.PlainSummary!.Contains("water about", StringComparison.OrdinalIgnoreCase));
        Assert.Equal(expected is IrrigationPrimaryAction.NoWaterNeeded or IrrigationPrimaryAction.WaterSoon,
            advice.PlainSummary.StartsWith("No watering needed today", StringComparison.Ordinal));

        // TodayRules
        Assert.Equal(ExpectedTodayKind(expected), today.Kind);
        Assert.Equal(expected == IrrigationPrimaryAction.NoWaterNeeded, today.Text == "No watering needed today");
        Assert.Equal(Waters(expected), today.Text.StartsWith("Water ") || today.Text.StartsWith("Rain helps, but water "));

        // Explanations: the act-now insight and its "why" follow the same action.
        var water = insights.FirstOrDefault(i => i.InsightType == InsightType.WaterNow);
        var skip = insights.FirstOrDefault(i => i.InsightType == InsightType.SkipRain);
        Assert.Equal(Waters(expected), water != null);
        Assert.Equal(expected == IrrigationPrimaryAction.PostponeForRain, skip != null);
        if (water != null)
        {
            Assert.DoesNotContain("sensor reading has reached", water.Explanation!.Summary);
            Assert.Contains(expected == IrrigationPrimaryAction.WaterNowReduced ? "smaller watering" : "drier than", water.Explanation.Summary);
        }
        if (skip != null)
        {
            Assert.Contains("can wait", skip.Explanation!.Summary);
            Assert.DoesNotContain("at least what", skip.Explanation.Summary);
        }

        // ActionReport forecast card for the same day
        Assert.Equal(Waters(expected), card.StartsWith("Water "));
        Assert.Equal(expected == IrrigationPrimaryAction.PostponeForRain, card == "Rain covers it");
        Assert.Equal(expected == IrrigationPrimaryAction.InsufficientData, card == "Check nearer the day");

        // Farmer-facing words stay plain.
        foreach (var text in new[] { today.Text, advice.PlainSummary! }
                     .Concat(insights.Select(i => i.Message))
                     .Concat(insights.Select(i => i.Explanation?.Summary ?? ""))
                     .Concat(advice.Reasoning))
        {
            Assert.DoesNotMatch(Jargon, text);
        }
    }

    // The actions the engine never sets today still have a defined answer in
    // every consumer, so adding them to the engine later cannot fall through
    // to "no action needed".
    [Theory]
    [MemberData(nameof(AllActions))]
    public void EveryPrimaryAction_HasItsOwnAnswer_InTodayRulesAndTheAdvisorMapping(IrrigationPrimaryAction action)
    {
        Assert.Equal(ExpectedAdvice(action), IrrigationAdvisor.ToAdviceAction(action));

        var result = new ZoneEngineResult
        {
            ZoneId = 7, ZoneName = "North field",
            Crop = Fao56EngineReference.TryResolveCrop("maize"),
            BalanceRan = true, PrimaryAction = action,
            DepletionMm = 30, RawMm = 25, EtcTodayMm = 5,
            RecommendedLitres = Waters(action) ? 600 : null,
            RecommendedRuntimeSeconds = Waters(action) ? 1800 : null,
            NextWateringDate = action == IrrigationPrimaryAction.WaterSoon ? Today.AddDays(2) : null,
            DaysToNextWatering = action == IrrigationPrimaryAction.WaterSoon ? 2 : null,
        };
        var today = TodayRules.For(result, Array.Empty<ZoneInsight>());

        Assert.Equal(ExpectedTodayKind(action), today.Kind);
        Assert.Equal(action == IrrigationPrimaryAction.NoWaterNeeded, today.Text == "No watering needed today");
        Assert.DoesNotMatch(Jargon, today.Text);
    }

    // ---- regression tests for the six contradiction paths ---------------------

    // 1. 3 mm of rain against more crop use, with the soil already well past
    //    the watering point: water (reduced), never "rain covers it".
    [Fact]
    public void LightRain_OnADryField_StillWaters_NeverRainCoversIt()
    {
        var input = Input(initialDr: 100, todayRain: 3);
        var result = Fao56Engine.Run(input);
        Assert.True(result.EtcTodayMm > 3, "the case needs crop use above the rain");
        Assert.True(Waters(result.PrimaryAction));

        var insights = ZoneInsightBuilder.Build(input, result, new ZoneFaultSignals());
        var today = TodayRules.For(result, insights);
        var advice = Advise(input);
        var card = ActionReport.ForecastAction(new[] { Report(input, result) }, Today);

        Assert.Equal("water", today.Kind);
        Assert.Equal(AdviceAction.IrrigateNow, advice.Action);
        Assert.StartsWith("Water ", card);
        Assert.DoesNotContain(insights, i => i.InsightType == InsightType.SkipRain);
        Assert.DoesNotContain("cover", today.Text);
        Assert.DoesNotContain("Hold", advice.Summary);
    }

    // 1b. The skip explanation gives the engine's reason, not the old
    //     rain-versus-use rule: postponing on rain smaller than today's use.
    [Fact]
    public void Postpone_ExplainsTheProjectedDryness_NotRainVersusUse()
    {
        var (input, result) = Enumerable.Range(0, 80)
            .SelectMany(dr => new[] { 2.0, 3.0, 4.0 }.Select(rain => Input(initialDr: dr, todayRain: rain)))
            .Select(i => (Input: i, Result: Fao56Engine.Run(i)))
            .First(x => x.Result.PrimaryAction == IrrigationPrimaryAction.PostponeForRain
                        && x.Result.ForecastRainTodayMm < x.Result.EtcTodayMm);

        var skip = ZoneInsightBuilder.Build(input, result, new ZoneFaultSignals())
            .Single(i => i.InsightType == InsightType.SkipRain);

        Assert.Contains("can wait", skip.Explanation!.Summary);
        Assert.DoesNotContain("at least what", skip.Explanation.Summary);
        Assert.Contains(skip.Explanation.Facts, f => f.Label == "How dry it should be after the rain");
        Assert.Contains("PostponeForRain", skip.Explanation.Technical);
    }

    // 2. Start-of-day dryness below the watering point, but today's use takes
    //    it past: the engine says water, and the explanation must not fall
    //    back to a sensor claim for a zone it never read.
    [Fact]
    public void WaterNow_FromTodaysUse_NeverClaimsASensorReading()
    {
        var (input, result) = Enumerable.Range(0, 100)
            .Select(dr => Input(initialDr: dr))
            .Select(i => (Input: i, Result: Fao56Engine.Run(i)))
            .First(x => x.Result.PrimaryAction == IrrigationPrimaryAction.WaterNow
                        && x.Result.DepletionMm < x.Result.RawMm);

        var water = ZoneInsightBuilder.Build(input, result, new ZoneFaultSignals())
            .Single(i => i.InsightType == InsightType.WaterNow);

        Assert.DoesNotContain("sensor", water.Explanation!.Summary);
        Assert.StartsWith("By the end of today", water.Explanation.Summary);
        Assert.Contains(water.Explanation.Facts, f => f.Label == "How dry it will be by tonight");
    }

    // 3. The farmer's threshold says water, the balance says not: the
    //    reasoning and summary follow the balance.
    [Fact]
    public void ThresholdSaysWater_BalanceSaysNo_ReasoningFollowsTheBalance()
    {
        var advice = Advise(Input(initialDr: 5), moisture: 10, threshold: 30);

        Assert.Equal(AdviceAction.NoActionNeeded, advice.Action);
        Assert.Equal("The soil still holds enough water for this crop today.", Assert.Single(advice.Reasoning));
        Assert.DoesNotContain("at or below", advice.Summary);
        Assert.Contains("No irrigation needed today", advice.Summary);
    }

    // 4. A postponed zone's summary names the action.
    [Fact]
    public void Postpone_SummarySaysHold()
    {
        var advice = Advise(Input(todayRain: 60));
        Assert.Equal(AdviceAction.HoldRainExpected, advice.Action);
        Assert.Contains("Hold irrigation today", advice.Summary);
    }

    // 5. States the balance returns early from, or cannot decide, never turn
    //    into "irrigate" (from the threshold) or "no action needed".
    [Fact]
    public void UnplantedCrop_WithADryThreshold_IsNotIrrigateNow()
    {
        var input = InputFor(IrrigationPrimaryAction.CropNotPlanted);
        var advice = Advise(input, moisture: 10, threshold: 30);
        Assert.Equal(AdviceAction.CropNotPlanted, advice.Action);
        Assert.Contains("No crop irrigation yet", advice.Summary);
    }

    [Fact]
    public void InsufficientData_WithABalance_IsNeverNoWateringNeeded()
    {
        var input = InputFor(IrrigationPrimaryAction.InsufficientData);
        var result = Fao56Engine.Run(input);
        Assert.True(result.BalanceRan);
        Assert.Equal(IrrigationPrimaryAction.InsufficientData, result.PrimaryAction);

        var today = TodayRules.For(result, ZoneInsightBuilder.Build(input, result, new ZoneFaultSignals()));
        var advice = Advise(input);

        Assert.NotEqual("No watering needed today", today.Text);
        Assert.Equal("setup", today.Kind);
        Assert.Equal(AdviceAction.InsufficientData, advice.Action);
        Assert.DoesNotContain("No irrigation needed", advice.Summary);
    }

    // 6. Forecast cards and schedule days 1-6 read the rolling outlook per
    //    day, including waterings after the first one.
    [Fact]
    public void ForecastCardsAndScheduleDays_FollowTheOutlookForEveryDay()
    {
        // Shallow sand holds little, so a second watering falls inside the week
        // - the case the old first-watering-only cards missed.
        var input = Input(initialDr: 100);
        input.SoilType = "sandy";
        input.RootDepthLimitM = 0.2;
        var result = Fao56Engine.Run(input);
        var report = new[] { Report(input, result) };
        var advice = Advise(input);

        Assert.Equal(result.Outlook.Count, advice.Outlook.Count);
        Assert.Contains(result.Outlook, d => d.Date > result.NextWateringDate && Waters(d.Action));

        for (var i = 1; i < 7; i++)
        {
            var date = Today.AddDays(i);
            var planned = result.Outlook.FirstOrDefault(d => d.Date == date);
            var card = ActionReport.ForecastAction(report, date);
            var (action, note) = ReportEndpoints.ScheduleDay(i, advice, advice, date, rainMm: null);

            if (planned == null)
            {
                Assert.Equal("Check nearer the day", card);
                Assert.Equal(nameof(AdviceAction.InsufficientData), action);
                continue;
            }

            Assert.Equal(Waters(planned.Action), card.StartsWith("Water "));
            Assert.Equal(planned.Action == IrrigationPrimaryAction.PostponeForRain, card == "Rain covers it");
            Assert.Equal(IrrigationAdvisor.ToAdviceAction(planned.Action).ToString(), action);
            Assert.Equal(planned.Advice, note);
        }
    }

    [Fact]
    public void ScheduleDays_WithoutTheEngine_KeepTheRainOnlyHint()
    {
        var legacy = IrrigationAdvisor.Advise(new ZoneAdviceInput { ZoneName = "North field", AsOf = Today });
        Assert.Null(legacy.PrimaryAction);
        Assert.Equal("RainExpectedCheckMoisture", ReportEndpoints.ScheduleDay(2, legacy, legacy, Today.AddDays(2), 4).Action);
        Assert.Equal("CheckMoisture", ReportEndpoints.ScheduleDay(2, legacy, legacy, Today.AddDays(2), 0).Action);
    }
}
