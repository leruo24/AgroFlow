using AgroFlow.Business;

namespace AgroFlow.Domain.Tests;

public sealed class TankPhRulesTests
{
    [Fact]
    public void Refill_must_be_positive_and_fit_the_configured_tank()
    {
        Assert.Equal("Litres added must be greater than 0.", TankPhRules.ValidateRefill(0, null, 1_000));
        Assert.Equal("Litres added cannot be greater than the tank size.", TankPhRules.ValidateRefill(1_001, null, 1_000));
        Assert.Null(TankPhRules.ValidateRefill(800, 7.2m, 1_000));
    }

    [Theory]
    [InlineData(-0.1)]
    [InlineData(14.1)]
    public void Ph_outside_zero_to_fourteen_is_rejected(double ph)
    {
        Assert.Equal("pH must be between 0 and 14.", TankPhRules.ValidateRefill(500, (decimal)ph, 1_000));
        Assert.Equal("pH must be between 0 and 14.", TankPhRules.ValidateSoilPh((decimal)ph, null));
    }

    [Fact]
    public void Remaining_estimate_subtracts_runtime_times_flow_use_and_clamps()
    {
        // Two 10-minute runs at 15 L/min use an estimated 300 L.
        Assert.Equal(700m, TankPhRules.EstimateRemaining(1_000m, 2m * 10m * 15m, 1_000m));
        Assert.Equal(0m, TankPhRules.EstimateRemaining(100m, 120m, 1_000m));
    }

    [Fact]
    public void Low_means_strictly_below_twenty_percent()
    {
        Assert.True(TankPhRules.IsLow(199.9m, 1_000m));
        Assert.False(TankPhRules.IsLow(200m, 1_000m));
    }

    [Theory]
    [InlineData(6.4)]
    [InlineData(8.5)]
    public void Water_ph_outside_usual_range_has_the_required_warning(double ph)
    {
        Assert.Equal("Check your water — pH is outside the usual range for irrigation water.",
            TankPhRules.WaterWarning((decimal)ph));
        Assert.Null(TankPhRules.WaterWarning(7.0m));
    }
}
