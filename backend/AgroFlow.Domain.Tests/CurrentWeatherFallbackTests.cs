using AgroFlow.Business.Agronomy;

namespace AgroFlow.Domain.Tests;

public class CurrentWeatherFallbackTests
{
    private static readonly DateTimeOffset Now = new(2026, 10, 26, 8, 0, 0, TimeSpan.Zero);

    [Fact]
    public void Fresh_field_temperature_wins_over_local_weather()
    {
        var result = CurrentWeatherFallback.Select("Temperature", 24.5, Now.AddMinutes(-5), 30, Now);
        Assert.Equal(24.5, result.Value);
        Assert.Equal("field_sensor", result.SourceCode);
    }

    [Fact]
    public void Temperature_and_humidity_fall_back_independently()
    {
        var temperature = CurrentWeatherFallback.Select("Temperature", 25, Now.AddHours(-3), 27, Now);
        var humidity = CurrentWeatherFallback.Select("Humidity", 62, Now.AddMinutes(-2), 70, Now);
        Assert.Equal((27d, "local_weather"), (temperature.Value, temperature.SourceCode));
        Assert.Equal((62d, "field_sensor"), (humidity.Value, humidity.SourceCode));
    }

    [Theory]
    [InlineData("Temperature", 99)]
    [InlineData("Humidity", -1)]
    [InlineData("Humidity", 101)]
    public void Invalid_field_values_use_valid_local_weather(string type, double invalid)
    {
        var fallback = type == "Temperature" ? 21 : 55;
        var result = CurrentWeatherFallback.Select(type, invalid, Now, fallback, Now);
        Assert.Equal(fallback, result.Value);
        Assert.Equal("local_weather", result.SourceCode);
    }

    [Fact]
    public void Missing_or_invalid_sources_are_unavailable_not_zero()
    {
        var result = CurrentWeatherFallback.Select("Humidity", null, null, double.NaN, Now);
        Assert.Null(result.Value);
        Assert.Equal("unavailable", result.SourceCode);
    }

    [Fact]
    public void Future_sensor_timestamp_is_rejected()
    {
        var result = CurrentWeatherFallback.Select("Temperature", 24, Now.AddMinutes(6), 22, Now);
        Assert.Equal(22, result.Value);
        Assert.Equal("local_weather", result.SourceCode);
    }
}
