using AgroFlow.Business;

namespace AgroFlow.Domain.Tests;

// Step 2: the MQTT subscriber must store Temperature and Humidity readings,
// not just SoilMoisture.
//
// The subscriber never filtered to SoilMoisture - it passed whatever arrived
// straight into the insert - so the "extend it additively" part of the task
// was already satisfied by accident. What was missing was any list at all on
// that path: an unrecognised sensorType reached Postgres and died on
// sensor_reading's CHECK constraint, once per message.
//
// These tests pin the list both transports now share, and pin the separation
// that matters for safety: all three types are stored, exactly one of them
// can start a pump.
public class SensorReadingTypesTests
{
    [Theory]
    [InlineData("SoilMoisture")]
    [InlineData("Temperature")]
    [InlineData("Humidity")]
    public void TheThreeTypesTheFirmwarePublishes_AreAccepted(string sensorType)
    {
        Assert.True(SensorReadingTypes.IsValid(sensorType));
    }

    // The two that v1.3.0 added. Before this, the HTTP endpoint accepted them
    // and the MQTT subscriber had no opinion either way.
    [Fact]
    public void TemperatureAndHumidity_AreAccepted_ThisIsWhatV130Added()
    {
        Assert.True(SensorReadingTypes.IsValid(SensorReadingTypes.Temperature));
        Assert.True(SensorReadingTypes.IsValid(SensorReadingTypes.Humidity));
    }

    [Theory]
    [InlineData("")]
    [InlineData(" ")]
    [InlineData("Moisture")]
    [InlineData("Pressure")]
    [InlineData("'; drop table sensor_reading; --")]
    public void AnythingElse_IsRejected_BeforeItReachesTheCheckConstraint(string sensorType)
    {
        Assert.False(SensorReadingTypes.IsValid(sensorType));
    }

    [Fact]
    public void Null_IsRejected()
    {
        Assert.False(SensorReadingTypes.IsValid(null));
    }

    // Case-sensitive deliberately: sensor_reading's CHECK is case-sensitive,
    // so accepting a lowercase variant here would only move the failure into
    // Postgres.
    [Theory]
    [InlineData("soilmoisture")]
    [InlineData("TEMPERATURE")]
    [InlineData("humidity")]
    public void WrongCase_IsRejected_BecauseTheConstraintIsCaseSensitive(string sensorType)
    {
        Assert.False(SensorReadingTypes.IsValid(sensorType));
    }

    // ---- The safety separation ---------------------------------------------

    [Fact]
    public void OnlySoilMoisture_DrivesIrrigation()
    {
        Assert.True(SensorReadingTypes.DrivesIrrigation(SensorReadingTypes.SoilMoisture));
    }

    [Theory]
    [InlineData("Temperature")]
    [InlineData("Humidity")]
    public void StoredButNotActedOn_TemperatureAndHumidityNeverStartAPump(string sensorType)
    {
        // Both are valid readings...
        Assert.True(SensorReadingTypes.IsValid(sensorType));
        // ...and neither may reach the irrigation decision.
        Assert.False(SensorReadingTypes.DrivesIrrigation(sensorType));
    }

    // The list must stay in step with the CHECK constraint in
    // 0002_relationships.sql. If this fails, that migration needs extending
    // in the same change.
    [Fact]
    public void TheListIsExactlyTheThreeValuesTheCheckConstraintAllows()
    {
        Assert.Equal(
            new[] { "SoilMoisture", "Temperature", "Humidity" },
            SensorReadingTypes.All);
    }
}
