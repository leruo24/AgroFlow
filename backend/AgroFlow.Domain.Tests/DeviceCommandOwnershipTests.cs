using AgroFlow.Business;

namespace AgroFlow.Domain.Tests;

// Step 10: "The ACK rejects another zone's device."
//
// Why this is worth a test of its own rather than being obvious: marking a
// command executed is what stops the replay sweep redelivering it (see
// CommandReplayPolicy). A forged ACK therefore suppresses redelivery of a
// pump run that NEVER PHYSICALLY HAPPENED - the zone reads as watered and was
// not, and nothing downstream can tell.
public class DeviceCommandOwnershipTests
{
    private const string Board = "3C71BFA1B2C3";
    private const string OtherBoard = "A4CF12DEAD99";

    [Fact]
    public void TheZonesOwnBoard_MayAcknowledge()
    {
        Assert.True(DeviceCommandOwnership.MayAcknowledge(Board, Board));
    }

    // THE ONE THAT MATTERS.
    [Fact]
    public void AnotherZonesBoard_IsRejected()
    {
        Assert.False(DeviceCommandOwnership.MayAcknowledge(Board, OtherBoard));
    }

    // A zone with no active claimed device has nothing that may acknowledge
    // its commands. Previously the comparison was against a null DeviceId,
    // and a caller sending no deviceId at all would have matched it.
    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void AZoneWithNoDevice_AcceptsNoAcknowledgement(string? expected)
    {
        Assert.False(DeviceCommandOwnership.MayAcknowledge(expected, Board));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void ACallerWithNoDeviceId_IsRejected(string? caller)
    {
        Assert.False(DeviceCommandOwnership.MayAcknowledge(Board, caller));
    }

    // Two nulls must not match each other. This is the exact shape of the
    // hole: an unclaimed zone plus a caller presenting nothing.
    [Fact]
    public void TwoAbsentIdsDoNotMatchEachOther()
    {
        Assert.False(DeviceCommandOwnership.MayAcknowledge(null, null));
    }

    // device_id is stored uppercased by the claim path, but a casing
    // difference is not a different board.
    [Theory]
    [InlineData("3c71bfa1b2c3")]
    [InlineData("3C71bfA1b2C3")]
    public void CasingDoesNotMakeItADifferentBoard(string caller)
    {
        Assert.True(DeviceCommandOwnership.MayAcknowledge(Board, caller));
    }

    // A prefix is not a match. Guards against any future move to a
    // StartsWith-style comparison, which would let one board acknowledge for
    // a family of ids.
    [Theory]
    [InlineData("3C71BFA1B2")]
    [InlineData("3C71BFA1B2C3EXTRA")]
    public void APartialOrExtendedIdIsNotAMatch(string caller)
    {
        Assert.False(DeviceCommandOwnership.MayAcknowledge(Board, caller));
    }
}
