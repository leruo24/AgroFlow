using AgroFlow.Business;

namespace AgroFlow.Domain.Tests;

// Proves the safety half of the irrigation-command replay fix.
//
// The plumbing half - LISTEN, the MQTT reconnect hook, the periodic sweep -
// needs a live Postgres and a live broker and is NOT unit-tested here; see
// docs/OVERNIGHT_REPORT.md, which says so plainly rather than implying the
// whole fix is covered. What IS covered is the decision that actually matters
// for safety: which pending commands may still be sent, and which must not.
public class CommandReplayPolicyTests
{
    private static readonly DateTimeOffset Now = new(2026, 1, 20, 12, 0, 0, TimeSpan.Zero);

    [Fact]
    public void AFreshPendingCommand_IsReplayed()
    {
        // The normal case: the container restarted seconds after the farmer
        // hit the button, so the NOTIFY went nowhere.
        Assert.Equal(ReplayDecision.Publish, CommandReplayPolicy.Decide(Now.AddSeconds(-30), Now));
    }

    [Fact]
    public void ACommandFromAnHourAgo_IsReplayed()
    {
        Assert.Equal(ReplayDecision.Publish, CommandReplayPolicy.Decide(Now.AddHours(-1), Now));
    }

    [Fact]
    public void ExactlyAtTheWindowEdge_IsStillReplayed()
    {
        // Inclusive bound - a command right on two hours is still acted on.
        Assert.Equal(ReplayDecision.Publish, CommandReplayPolicy.Decide(Now - CommandReplayPolicy.MaxReplayAge, Now));
    }

    [Fact]
    public void JustPastTheWindow_IsExpired()
    {
        Assert.Equal(
            ReplayDecision.Expire,
            CommandReplayPolicy.Decide(Now - CommandReplayPolicy.MaxReplayAge - TimeSpan.FromSeconds(1), Now));
    }

    [Fact]
    public void AThreeDayOldPendingStart_IsExpiredNotReplayed_ThisIsTheSafetyCase()
    {
        // THE POINT OF THE POLICY. A pending 'start' is an instruction to open
        // a valve. Replaying one queued three days ago - because a deploy
        // happened to restart the container - would irrigate a field for
        // reasons nobody watching could explain, possibly at night, possibly
        // after rain, possibly on a crop that has since been harvested.
        //
        // A farmer who wants water now can ask again. A farmer who gets an
        // unexplained midnight flood cannot un-flood the field.
        Assert.Equal(ReplayDecision.Expire, CommandReplayPolicy.Decide(Now.AddDays(-3), Now));
    }

    [Fact]
    public void AFutureTimestampFromClockSkew_IsTreatedAsCurrent()
    {
        // The database clock can run slightly ahead of this process. A row
        // timestamped in the future was only just written - expiring it would
        // be exactly wrong.
        Assert.Equal(ReplayDecision.Publish, CommandReplayPolicy.Decide(Now.AddMinutes(5), Now));
    }

    [Fact]
    public void ExpiryReason_NamesTheAgeAndTheWindow()
    {
        // This string goes into a warning log that someone will read while
        // wondering why a command never fired.
        var reason = CommandReplayPolicy.ExpiryReason(Now.AddDays(-3), Now);

        Assert.Contains("3d", reason);
        Assert.Contains("2h", reason);
        Assert.Contains("expired", reason);
    }

    [Theory]
    [InlineData(-1)]
    [InlineData(-30)]
    [InlineData(-119)]
    public void EverythingInsideTheWindowIsPublished(int minutesAgo)
    {
        Assert.Equal(ReplayDecision.Publish, CommandReplayPolicy.Decide(Now.AddMinutes(minutesAgo), Now));
    }

    [Theory]
    [InlineData(-121)]
    [InlineData(-60 * 24)]
    [InlineData(-60 * 24 * 30)]
    public void EverythingOutsideTheWindowIsExpired(int minutesAgo)
    {
        Assert.Equal(ReplayDecision.Expire, CommandReplayPolicy.Decide(Now.AddMinutes(minutesAgo), Now));
    }

    [Fact]
    public void TheWindowIsShortEnoughToBeSafeAndLongEnoughToBeUseful()
    {
        // Documents the intent of the constant: long enough to cover a deploy,
        // a container restart or a broker blip; far short of "the situation
        // has changed".
        Assert.True(CommandReplayPolicy.MaxReplayAge >= TimeSpan.FromMinutes(30));
        Assert.True(CommandReplayPolicy.MaxReplayAge <= TimeSpan.FromHours(6));
    }
}
