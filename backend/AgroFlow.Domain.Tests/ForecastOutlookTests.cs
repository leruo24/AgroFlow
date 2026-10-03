using AgroFlow.Business;
using AgroFlow.Business.Agronomy;

namespace AgroFlow.Domain.Tests;

// Step 2: the 7-day forecast, and what each day means for watering.
//
// The thresholds here are the difference between a farmer watering a field
// the rain was about to cover and one watching a crop dry out, so they are
// pinned rather than left to read off the implementation.
public class ForecastOutlookTests
{
    // ---- The window --------------------------------------------------------

    // The engine collects eight days from Open-Meteo; the screen shows seven.
    // Day 8 is both the least reliable and the least actionable.
    [Fact]
    public void TheScreenShowsSevenDays_NotTheEnginesEight()
    {
        Assert.Equal(7, ForecastOutlook.MaxForecastDays);
        Assert.True(ForecastOutlook.MaxForecastDays < Fao56EngineController.ForecastWindowDays);
    }

    // ---- Icons -------------------------------------------------------------

    [Fact]
    public void MeaningfulRain_ShowsTheRainIcon()
    {
        Assert.Equal(ForecastIcon.Rain, ForecastOutlook.PickIcon(4.2, 60));
    }

    // A trace that evaporates off the leaves before it reaches the root zone
    // must not be presented as rain.
    [Theory]
    [InlineData(0.0)]
    [InlineData(0.4)]
    [InlineData(0.9)]
    public void ATraceOfRain_DoesNotCountAsRain(double rainMm)
    {
        Assert.NotEqual(ForecastIcon.Rain, ForecastOutlook.PickIcon(rainMm, 50));
    }

    [Fact]
    public void TheRainThresholdIsInclusive()
    {
        Assert.Equal(ForecastIcon.Rain, ForecastOutlook.PickIcon(ForecastOutlook.RainMmThreshold, 50));
    }

    [Fact]
    public void HumidAndDry_ReadsAsCloud()
    {
        Assert.Equal(ForecastIcon.Cloud, ForecastOutlook.PickIcon(0.0, 85));
    }

    [Fact]
    public void DryAndClear_ReadsAsSun()
    {
        Assert.Equal(ForecastIcon.Sun, ForecastOutlook.PickIcon(0.0, 40));
    }

    // Rain wins over humidity: a wet day is a wet day however humid it is.
    [Fact]
    public void RainBeatsHumidity()
    {
        Assert.Equal(ForecastIcon.Rain, ForecastOutlook.PickIcon(8.0, 95));
    }

    // A row with nothing recorded must still produce an icon rather than
    // throwing - weather_daily's humidity column is explicitly nullable.
    [Fact]
    public void MissingNumbers_StillProduceAnIcon()
    {
        Assert.Equal(ForecastIcon.Sun, ForecastOutlook.PickIcon(null, null));
    }

    [Theory]
    [InlineData(ForecastIcon.Sun, "sun")]
    [InlineData(ForecastIcon.Cloud, "cloud")]
    [InlineData(ForecastIcon.Rain, "rain")]
    public void IconNamesAreTheThreeTheAppKnows(ForecastIcon icon, string expected)
    {
        Assert.Equal(expected, ForecastOutlook.IconName(icon));
    }

    // ---- The plain sentence ------------------------------------------------

    [Fact]
    public void IrrigateNow_ReadsAsWaterLikelyNeeded()
    {
        Assert.Equal("Water likely needed", ForecastOutlook.PlainDayAdvice(AdviceAction.IrrigateNow, 0));
    }

    [Fact]
    public void HoldRainExpected_ReadsAsRainShouldCoverIt()
    {
        Assert.Equal("Rain should cover it", ForecastOutlook.PlainDayAdvice(AdviceAction.HoldRainExpected, 6));
    }

    [Fact]
    public void NoActionOnADryDay_ReadsAsNoWateringNeeded()
    {
        Assert.Equal("No watering needed", ForecastOutlook.PlainDayAdvice(AdviceAction.NoActionNeeded, 0));
    }

    // "The crop does not need water" and "the rain has it covered" are
    // different answers to the farmer even though the engine reaches both as
    // "do nothing".
    [Fact]
    public void NoActionOnAWetDay_CreditsTheRainInstead()
    {
        Assert.Equal("Rain should cover it", ForecastOutlook.PlainDayAdvice(AdviceAction.NoActionNeeded, 5));
    }

    // THE IMPORTANT NEGATIVE: a day the engine cannot speak to gets NO
    // sentence. Advice the app invented is worse than no advice, because the
    // farmer cannot tell the two apart.
    [Fact]
    public void InsufficientData_SaysNothingRatherThanGuessing()
    {
        Assert.Null(ForecastOutlook.PlainDayAdvice(AdviceAction.InsufficientData, 0));
        Assert.Null(ForecastOutlook.PlainDayAdvice(AdviceAction.InsufficientData, 12));
    }

    // ---- Days past today ---------------------------------------------------
    //
    // Future days have no soil reading, so their outlook rests on rainfall
    // alone - the same rule the schedule report already applies past day 0.

    [Fact]
    public void AWetFutureDay_SaysTheRainShouldCoverIt()
    {
        Assert.Equal("Rain should cover it", ForecastOutlook.PlainOutlookFromRainOnly(9));
    }

    [Theory]
    [InlineData(0.0)]
    [InlineData(0.5)]
    [InlineData(null)]
    public void ADryOrUnknownFutureDay_SendsTheFarmerToTheSoil(double? rainMm)
    {
        Assert.Equal("Check the soil that morning", ForecastOutlook.PlainOutlookFromRainOnly(rainMm));
    }

    // ---- Copy pinned -------------------------------------------------------

    [Fact]
    public void TheEmptyStateSaysWhichKindOfNothingItIs()
    {
        Assert.Equal("Forecast not available right now", ForecastOutlook.NoForecastMessage);
    }

    // Required by Open-Meteo's terms, and honest: these are a public forecast
    // for the area, not a measurement at this farm.
    [Fact]
    public void TheSourceIsNamed()
    {
        Assert.Equal("Forecast from the weather app (Open-Meteo)", ForecastOutlook.SourceLine);
    }
}
