using AgroFlow.Business;

namespace AgroFlow.Domain.Tests;

// The two rule-based fault checks: pump ran but moisture did not rise, and a sensor
// stuck on one value. Plain thresholds, no machine learning.
public class MoistureFaultTests
{
    private static readonly DateTime T0 = new(2026, 10, 1, 6, 0, 0, DateTimeKind.Utc);

    private static List<MoistureSample> Hourly(Func<int, double> value, int count) =>
        Enumerable.Range(0, count).Select(i => new MoistureSample { AtUtc = T0.AddHours(i), Value = value(i) }).ToList();

    private static double Wobble(int i) => 0.3 * Math.Sin(i * 1.7);

    [Fact]
    public void Pump_run_with_no_moisture_rise_is_flagged()
    {
        var samples = Hourly(i => 40 + Wobble(i), 6);
        var run = new PumpRun { StartedAtUtc = T0.AddHours(2).AddMinutes(5), DurationSeconds = 600 };

        Assert.True(MoistureFaultRules.PumpRanButMoistureDidNotRise(samples, run));
        var fault = Assert.Single(MoistureFaultRules.Check(samples, new[] { run }, T0.AddHours(6)));
        Assert.Equal(MoistureFaultKind.PumpRanMoistureDidNotRise, fault.Kind);
        Assert.StartsWith("Possible sensor or water supply problem — please check.", fault.Message);
    }

    [Fact]
    public void Pump_run_that_wets_the_soil_is_not_flagged()
    {
        var samples = Hourly(i => i >= 3 ? 55 : 40, 6);
        var run = new PumpRun { StartedAtUtc = T0.AddHours(2).AddMinutes(5), DurationSeconds = 600 };

        Assert.False(MoistureFaultRules.PumpRanButMoistureDidNotRise(samples, run));
        Assert.Empty(MoistureFaultRules.Check(samples, new[] { run }, T0.AddHours(6)));
    }

    [Fact]
    public void Pump_run_is_not_judged_without_readings_around_it()
    {
        var run = new PumpRun { StartedAtUtc = T0.AddHours(2), DurationSeconds = 600 };

        Assert.Null(MoistureFaultRules.PumpRanButMoistureDidNotRise(Hourly(_ => 40, 2), run)); // nothing after
        Assert.Null(MoistureFaultRules.PumpRanButMoistureDidNotRise(Hourly(_ => 40, 6),
            new PumpRun { StartedAtUtc = T0.AddHours(2), DurationSeconds = 30 })); // too short to judge
    }

    [Fact]
    public void Sensor_stuck_on_one_value_for_twelve_hours_is_flagged()
    {
        var stuck = Hourly(_ => 37.2, 14);
        var fault = Assert.Single(MoistureFaultRules.Check(stuck, Array.Empty<PumpRun>(), T0.AddHours(13)));
        Assert.Equal(MoistureFaultKind.SensorUnchanged, fault.Kind);
        Assert.StartsWith("Possible sensor or water supply problem — please check.", fault.Message);
    }

    [Fact]
    public void Changing_or_sparse_readings_are_not_called_stuck()
    {
        Assert.False(MoistureFaultRules.SensorUnchanged(Hourly(i => 50 - 0.2 * i, 14), T0.AddHours(13)));
        Assert.False(MoistureFaultRules.SensorUnchanged(Hourly(_ => 37.2, 3), T0.AddHours(13)));
    }

    [Fact]
    public void Calibrated_raw_readings_become_relative_percent()
    {
        Assert.True(MoistureFaultController.IsRelative(1200, 2800));
        Assert.False(MoistureFaultController.IsRelative(null, null));
    }
}
