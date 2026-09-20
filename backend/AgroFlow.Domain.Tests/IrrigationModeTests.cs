using AgroFlow.Business;

namespace AgroFlow.Domain.Tests;

// Proves the fix for the SensorReadingProcessor bug: auto-irrigation used to
// ignore zone.irrigation_mode entirely and would issue a 'start' command for a
// zone the farmer had set to Manual.
//
// The gate itself is pure and lives here in the domain; the processor's part is
// one call plus an early return. Testing the rule directly is what is
// meaningful - the alternative would be a database fixture proving that a
// boolean is read correctly.
public class IrrigationModeTests
{
    [Fact]
    public void AutomaticMode_AllowsAutoCommands()
    {
        Assert.True(IrrigationMode.AllowsAutoCommands("automatic"));
    }

    [Fact]
    public void ManualMode_BlocksAutoCommands_ThisIsTheBug()
    {
        // THE REGRESSION TEST. Before the fix, a soil-moisture reading below
        // the threshold on a Manual zone inserted an 'auto' start command and
        // physically started the pump. It must not.
        Assert.False(IrrigationMode.AllowsAutoCommands("manual"));
    }

    [Fact]
    public void ScheduledMode_BlocksAutoCommands()
    {
        // fire_due_irrigation_schedules() (pg_cron, migration 0010) owns the
        // decision for scheduled zones. Letting the moisture path also fire
        // would make the two fight: an off-schedule auto 'start' would then
        // cause the real scheduled 'start' to be suppressed by the processor's
        // "same as last command" de-dup.
        Assert.False(IrrigationMode.AllowsAutoCommands("scheduled"));
    }

    [Theory]
    [InlineData("Automatic")]
    [InlineData("AUTOMATIC")]
    [InlineData("aUtOmAtIc")]
    public void ModeComparison_IsCaseInsensitive(string mode)
    {
        // The column is plain text; a differently-cased value written by hand
        // or by a future client must not silently disable automation.
        Assert.True(IrrigationMode.AllowsAutoCommands(mode));
    }

    [Theory]
    [InlineData(null)]          // zone row deleted mid-reading
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("auto")]        // plausible-looking but not the real value
    [InlineData("off")]
    [InlineData("semi-automatic")]
    public void UnknownOrMissingMode_FailsClosed(string? mode)
    {
        // Starting a pump is a physical action on someone's field. When the
        // mode is not understood, do nothing.
        Assert.False(IrrigationMode.AllowsAutoCommands(mode));
    }

    [Theory]
    [InlineData("automatic", true)]
    [InlineData("scheduled", true)]
    [InlineData("manual", true)]
    [InlineData("nonsense", false)]
    [InlineData(null, false)]
    public void IsRecognised_MatchesTheCheckConstraintIn0010(string? mode, bool expected)
    {
        // Mirrors: check (irrigation_mode in ('automatic', 'scheduled', 'manual'))
        Assert.Equal(expected, IrrigationMode.IsRecognised(mode));
    }

    [Fact]
    public void OnlyAutomaticIsPermissive_AcrossEveryConstraintValue()
    {
        // Belt and braces: whatever else changes, exactly one of the three
        // constraint values may issue auto commands.
        var permissive = new[] { IrrigationMode.Automatic, IrrigationMode.Scheduled, IrrigationMode.Manual }
            .Where(IrrigationMode.AllowsAutoCommands)
            .ToArray();

        Assert.Equal(new[] { IrrigationMode.Automatic }, permissive);
    }
}
