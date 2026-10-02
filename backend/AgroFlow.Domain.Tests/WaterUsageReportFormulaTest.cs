using AgroFlow.Business.Agronomy;

namespace AgroFlow.Domain.Tests;

// The litres formula every report depends on: runtime_seconds / 60 * flow_rate_lpm.
// These pin the numbers hand-checked against the live data (900 s at 1.5 L/min = 22.5 L)
// and the "no estimate is better than a guessed one" rule from the reports brief.
public class WaterUsageReportFormulaTests
{
    [Fact]
    public void FifteenMinutesAtTestPumpRate_Is22Point5Litres()
    {
        var estimate = WaterUsageEstimator.EstimateEventLitres(900, 1.5);

        Assert.NotNull(estimate);
        Assert.Equal(22.5, estimate!.Litres, 6);
    }

    [Fact]
    public void SevenEventsOfFifteenMinutes_Give157Point5Litres()
    {
        // The per-zone total seen in the water-usage report: 7 events x 900 s.
        var estimate = WaterUsageEstimator.EstimateEventLitres(7 * 900, 1.5);

        Assert.NotNull(estimate);
        Assert.Equal(157.5, estimate!.Litres, 6);
    }

    [Fact]
    public void LitresAreLinearInRuntime_SoSummingRuntimeFirstGivesTheSameTotal()
    {
        // The reports estimate from a day's total runtime instead of per event.
        var perEvent = WaterUsageEstimator.EstimateEventLitres(900, 1.5)!.Litres * 7;
        var summed = WaterUsageEstimator.EstimateEventLitres(6300, 1.5)!.Litres;

        Assert.Equal(perEvent, summed, 6);
    }

    [Fact]
    public void NoFlowRate_ReturnsNull_NotZero()
    {
        // Zero would read as "no water was delivered", which is a false claim.
        Assert.Null(WaterUsageEstimator.EstimateEventLitres(900, null));
    }

    [Fact]
    public void ZeroRuntime_IsZeroLitres_WhenFlowRateKnown()
    {
        var estimate = WaterUsageEstimator.EstimateEventLitres(0, 1.5);

        Assert.NotNull(estimate);
        Assert.Equal(0.0, estimate!.Litres, 6);
    }

    [Fact]
    public void NegativeRuntime_Throws()
    {
        Assert.Throws<ArgumentOutOfRangeException>(() => WaterUsageEstimator.EstimateEventLitres(-1, 1.5));
    }

    [Fact]
    public void NegativeFlowRate_Throws()
    {
        Assert.Throws<ArgumentOutOfRangeException>(() => WaterUsageEstimator.EstimateEventLitres(900, -1.5));
    }

    [Fact]
    public void EveryEstimate_IsLabelledAsAnEstimate_AndSaysItIsNotMeasured()
    {
        var estimate = WaterUsageEstimator.EstimateEventLitres(900, 1.5)!;

        Assert.True(estimate.IsEstimate);
        Assert.Contains("not measured", estimate.Basis);
    }

    [Fact]
    public void RuntimeAboveSixHours_IsNotPlausible()
    {
        Assert.True(WaterUsageEstimator.IsPlausibleRuntime(WaterUsageEstimator.MaxPlausibleRuntimeSeconds));
        Assert.False(WaterUsageEstimator.IsPlausibleRuntime(WaterUsageEstimator.MaxPlausibleRuntimeSeconds + 1));
        Assert.False(WaterUsageEstimator.IsPlausibleRuntime(-1));
    }
}
