using System;
using System.Collections.Generic;
using System.Linq;
using AgroFlow.Api.Endpoints;
using AgroFlow.Api.Reports;
using AgroFlow.Business.Agronomy;
using AgroFlow.Business.Agronomy.RuleBook;
using Xunit;

namespace AgroFlow.Domain.Tests;

// Item 6: "I watered", "How does the soil feel?" and the one action per zone.
public class ManualLoggingTests
{
    private static readonly DateOnly Today = new DateOnly(2026, 2, 10);
    private static readonly DateTime Morning = DateTime.SpecifyKind(Today.ToDateTime(new TimeOnly(5, 0)), DateTimeKind.Utc); // 07:00 SAST
    private static readonly DateTimeOffset Now = new DateTimeOffset(Morning.AddHours(2));

    // A farm with no kit: crop, soil, size and flow known, weather only.
    private static ZoneEngineInput NoKit(Action<ZoneEngineInput>? change = null)
    {
        var input = new ZoneEngineInput
        {
            ZoneId = 1, ZoneName = "Bed 1", CropType = "maize", PlantingDate = Today.AddDays(-60),
            SoilType = "loam", AreaM2 = 2, FlowRateLpm = 2, RootDepthLimitM = 0.3,
            FarmLatitudeDegrees = -33.93, Today = Today, NowUtc = Morning.AddHours(2),
        };
        for (var i = 9; i >= 0; i--)
        {
            input.Weather.Add(new ZoneWeatherDay
            {
                Date = Today.AddDays(-i), TMinC = 14, TMaxC = 28, RainMm = 0, RhMinPct = 40, RhMaxPct = 80, WindMs = 2.5, WindHeightM = 10,
            });
        }
        change?.Invoke(input);
        return input;
    }

    private static (ZoneEngineResult Result, TodayAction Action) RunToday(ZoneEngineInput input)
    {
        var result = Fao56Engine.Run(input);
        var insights = ZoneInsightBuilder.Build(input, result, new ZoneFaultSignals());
        return (result, TodayRules.For(result, insights));
    }

    private static ZoneSoilFeelCheck Feel(string feel) => new ZoneSoilFeelCheck { CheckedAtUtc = Morning, Feel = feel };

    [Theory]
    [InlineData("wet", 12, 10, 0)]        // field capacity
    [InlineData("dry", 3, 10, 10)]        // at least the watering point
    [InlineData("dry", 14, 10, 14)]       // already past it: kept
    [InlineData("moist", 0, 10, 2.5)]     // pulled up to the middle band
    [InlineData("moist", 9, 10, 7.5)]     // pulled down to it
    [InlineData("moist", 5, 10, 5)]       // inside it: kept
    [InlineData("mud", 5, 10, 5)]         // unknown word: ignored
    public void Soil_feel_moves_the_estimate_only_as_far_as_a_hand_can_tell(string feel, double dr, double raw, double expected)
    {
        Assert.Equal(expected, WaterRules.SoilFeelDepletion(feel, dr, raw), 6);
    }

    [Fact]
    public void A_dry_check_today_means_water_and_a_wet_one_means_not()
    {
        var dry = RunToday(NoKit(i => i.SoilFeelChecks.Add(Feel("dry"))));
        Assert.Equal("water", dry.Action.Kind);
        Assert.StartsWith("Water about", dry.Action.Text);
        Assert.NotNull(dry.Action.Why);

        var wet = RunToday(NoKit(i => i.SoilFeelChecks.Add(Feel("wet"))));
        Assert.NotEqual("water", wet.Action.Kind);
        Assert.Equal(0.0, wet.Result.Days.Last().DrEndMm);
    }

    [Fact]
    public void The_latest_check_of_the_day_wins()
    {
        var input = NoKit(i =>
        {
            i.SoilFeelChecks.Add(Feel("wet"));
            i.SoilFeelChecks.Add(new ZoneSoilFeelCheck { CheckedAtUtc = Morning.AddHours(1), Feel = "dry" });
        });
        var (result, _) = RunToday(input);
        Assert.Equal("dry", result.LatestSoilFeel!.Feel);
    }

    [Fact]
    public void A_fresh_soil_check_is_said_in_the_confidence_but_never_makes_it_High()
    {
        var with = Fao56Engine.Run(NoKit(i => i.SoilFeelChecks.Add(Feel("moist"))));
        Assert.True(with.Setup.ManualCheckFresh);
        Assert.Contains("your own soil check", with.Confidence.Reason);
        Assert.NotEqual(ConfidenceLevel.High, with.Confidence.Level);

        var without = Fao56Engine.Run(NoKit());
        Assert.False(without.Setup.ManualCheckFresh);
        Assert.DoesNotContain("your own soil check", without.Confidence.Reason);

        // A check from last week is no longer fresh.
        var old = Fao56Engine.Run(NoKit(i => i.SoilFeelChecks.Add(new ZoneSoilFeelCheck { CheckedAtUtc = Morning.AddDays(-6), Feel = "moist" })));
        Assert.False(old.Setup.ManualCheckFresh);
    }

    [Fact]
    public void Today_rules_say_finish_setup_when_there_is_no_crop()
    {
        var (_, action) = RunToday(NoKit(i => i.CropType = null));
        Assert.Equal("setup", action.Kind);
        Assert.StartsWith("Finish setup:", action.Text);
    }

    [Fact]
    public void Today_rules_put_rain_before_watering()
    {
        var (_, action) = RunToday(NoKit(i =>
        {
            i.SoilFeelChecks.Add(Feel("dry"));
            i.Weather.Last().RainMm = 30;
        }));
        Assert.NotEqual("water", action.Kind);
    }

    [Fact]
    public void Today_text_is_one_plain_sentence()
    {
        foreach (var feel in new[] { "dry", "moist", "wet" })
        {
            var (_, action) = RunToday(NoKit(i => i.SoilFeelChecks.Add(Feel(feel))));
            Assert.DoesNotMatch(@"\b(ETc|ETo|Kc|RAW|TAW|Dr)\b", action.Text);
            Assert.DoesNotContain("\n", action.Text);
        }
    }

    [Theory]
    [InlineData(null, null, false)]
    [InlineData(10.0, null, true)]
    [InlineData(null, 20.0, true)]
    [InlineData(0.0, null, false)]
    [InlineData(601.0, null, false)]
    [InlineData(null, 10001.0, false)]
    [InlineData(null, -1.0, false)]
    public void Watering_entries_are_checked(double? minutes, double? litres, bool ok)
    {
        var problem = ManualLogEndpoints.CheckWatering(new ManualWateringBody(minutes, litres, null), Now);
        Assert.Equal(ok, problem is null);
    }

    [Fact]
    public void Entries_cannot_be_in_the_future_or_older_than_a_week()
    {
        Assert.NotNull(ManualLogEndpoints.CheckWatering(new ManualWateringBody(10, null, Now.AddHours(1)), Now));
        Assert.NotNull(ManualLogEndpoints.CheckWatering(new ManualWateringBody(10, null, Now.AddDays(-8)), Now));
        Assert.Null(ManualLogEndpoints.CheckWatering(new ManualWateringBody(10, null, Now.AddDays(-2)), Now));
    }

    [Theory]
    [InlineData("dry", true)]
    [InlineData(" Moist ", true)]
    [InlineData("WET", true)]
    [InlineData("soggy", false)]
    [InlineData(null, false)]
    public void Soil_feel_must_be_dry_moist_or_wet(string? feel, bool ok)
    {
        Assert.Equal(ok, ManualLogEndpoints.CheckFeel(new SoilFeelBody(feel, null), Now) is null);
    }

    [Fact]
    public void Hand_logged_days_are_labelled_in_reports()
    {
        Assert.Equal(string.Empty, WaterUsageReportBuilder.HandPrefix(0));
        Assert.StartsWith("Watered by hand", WaterUsageReportBuilder.HandPrefix(1));
        Assert.StartsWith("2 waterings logged by hand", WaterUsageReportBuilder.HandPrefix(2));
    }

    [Fact]
    public void Registration_setup_fields_are_checked()
    {
        var today = Today;
        string? Check(string? soil = "loam", double? area = 2, DateOnly? planted = null, double? depth = null, double? flow = null, double ha = 0.1) =>
            ZoneSetupFields.Check("Bed 1", ha, soil, area, planted, depth, flow, today);

        Assert.Null(Check());
        Assert.Null(Check(soil: null, area: null));                 // older admin builds send neither
        Assert.Null(Check(soil: "Clay", planted: today.AddDays(-21), depth: 0.3, flow: 2));
        Assert.NotNull(Check(soil: "peat"));
        Assert.NotNull(Check(area: 0));
        Assert.NotNull(Check(area: 2000, ha: 0.1));                 // 2000 m2 does not fit in 0.1 ha
        Assert.NotNull(Check(planted: today.AddDays(1)));
        Assert.NotNull(Check(planted: today.AddYears(-3)));
        Assert.NotNull(Check(depth: 5));
        Assert.NotNull(Check(flow: 0));
    }
}
