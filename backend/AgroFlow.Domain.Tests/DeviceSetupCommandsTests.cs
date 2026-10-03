using AgroFlow.Business;

namespace AgroFlow.Domain.Tests;

// Step 5 / step 10: "change-wifi returns 409 when offline."
//
// The 409 itself is one branch in ZoneHardwareEndpoints; what decides it is
// DeviceLiveness.IsOnline, and that is what these tests pin. Getting the
// window wrong in either direction is a real failure: too long and the API
// accepts a change-wifi for a kit that has been unplugged for twenty minutes,
// publishes into the void, and leaves the farmer waiting for a setup network
// that never appears.
public class DeviceLivenessTests
{
    private static readonly DateTimeOffset Now = new(2026, 10, 3, 12, 0, 0, TimeSpan.Zero);

    [Fact]
    public void AKitThatReportedJustNow_IsOnline()
    {
        Assert.True(DeviceLiveness.IsOnline(Now.AddSeconds(-30), Now));
    }

    // The board reports every 30 seconds, so four minutes is eight missed
    // reports - still inside the window, because a brief WiFi drop or an MQTT
    // reconnect must not make the button refuse.
    [Fact]
    public void AKitQuietForFourMinutes_IsStillOnline()
    {
        Assert.True(DeviceLiveness.IsOnline(Now.AddMinutes(-4), Now));
    }

    [Fact]
    public void ExactlyFiveMinutes_IsStillOnline_TheBoundaryIsInclusive()
    {
        Assert.True(DeviceLiveness.IsOnline(Now - DeviceLiveness.OnlineWindow, Now));
    }

    [Fact]
    public void JustOverFiveMinutes_IsOffline_ThisIsTheOneThatReturns409()
    {
        Assert.False(DeviceLiveness.IsOnline(Now.AddMinutes(-5).AddSeconds(-1), Now));
    }

    [Fact]
    public void AKitUnpluggedTwentyMinutesAgo_IsOffline()
    {
        Assert.False(DeviceLiveness.IsOnline(Now.AddMinutes(-20), Now));
    }

    // A zone whose kit has never reported. Offline, not "unknown" - there is
    // nothing to publish a command to.
    [Fact]
    public void AKitThatHasNeverReported_IsOffline()
    {
        Assert.False(DeviceLiveness.IsOnline(null, Now));
    }

    // Clock skew between Postgres and the API process. A reading stamped
    // slightly ahead of us is a board that just reported, not one that has
    // gone quiet.
    [Fact]
    public void AFutureTimestamp_IsTreatedAsOnline_NotAsStale()
    {
        Assert.True(DeviceLiveness.IsOnline(Now.AddSeconds(5), Now));
    }

    // This window is deliberately NOT DeviceMonitor:OfflineAfterMinutes (30).
    // That one answers "has this kit been quiet long enough to message the
    // farmer about?"; this one answers "will a command I publish right now
    // actually arrive?".
    [Fact]
    public void TheWindowIsFiveMinutes_AndIsNotTheAlertingThreshold()
    {
        Assert.Equal(TimeSpan.FromMinutes(5), DeviceLiveness.OnlineWindow);
    }

    // The power-cycle instruction is the whole value of the 409 body: it is
    // the only route back into a board that cannot be reached over the
    // network. Pinned so a copy edit cannot quietly drop it.
    [Fact]
    public void TheOfflineMessageTellsTheFarmerHowToOpenSetupWithoutTheNetwork()
    {
        Assert.Equal(
            "Your kit is offline. Unplug and replug it 3 times quickly to open its setup network.",
            DeviceLiveness.OfflineMessage);
    }

    [Fact]
    public void TheOfflineHintCoversTheChangedRouterCase()
    {
        Assert.Contains("15 minutes", DeviceLiveness.OfflineRouterChangedHint);
    }
}

// The two new commands, and the setup-network strings the app has to be able
// to tell the farmer WITHOUT asking the board - by the time that network is
// up, the board is off the internet.
public class DeviceSetupCommandsTests
{
    [Theory]
    [InlineData("open_setup")]
    [InlineData("change_wifi")]
    public void BothNewCommandsAreRecognised(string command)
    {
        Assert.True(DeviceSetupCommands.IsSetupCommand(command));
    }

    [Theory]
    [InlineData("start")]
    [InlineData("stop")]
    [InlineData(null)]
    [InlineData("reboot")]
    public void TheIrrigationCommandsAreNotSetupCommands(string? command)
    {
        Assert.False(DeviceSetupCommands.IsSetupCommand(command));
    }

    // Neither takes a duration - there is nothing running for a length of
    // time. Constrained in the database too (0030), because the command table
    // has three writers.
    [Theory]
    [InlineData("open_setup")]
    [InlineData("change_wifi")]
    public void NeitherNewCommandTakesADuration(string command)
    {
        Assert.False(DeviceSetupCommands.TakesDuration(command));
    }

    [Fact]
    public void StartStillTakesADuration()
    {
        Assert.True(DeviceSetupCommands.TakesDuration("start"));
    }

    // ---- The setup network -------------------------------------------------
    //
    // These must match apName() and apPassword() in
    // AgroFlowIrrigationNode.ino exactly. If the firmware changes them, these
    // tests are what should fail.

    [Fact]
    public void TheNetworkNameIsTheLastFourOfTheDeviceId()
    {
        Assert.Equal("AgroFlow-Setup-A1B2", DeviceSetupCommands.SetupNetworkName("3C71BFA1B2"));
    }

    [Fact]
    public void TheNetworkPasswordIsAFPlusTheLastSixOfTheDeviceId()
    {
        Assert.Equal("AF-BFA1B2", DeviceSetupCommands.SetupNetworkPassword("3C71BFA1B2"));
    }

    // getDeviceId() formats the efuse MAC with %012llX, so the real value is
    // always 12 uppercase hex characters. Uppercased here anyway, because a
    // farmer typing a lowercase password into a phone would otherwise be
    // given the wrong string to type.
    [Fact]
    public void ALowercaseDeviceId_IsUppercasedToMatchTheFirmware()
    {
        Assert.Equal("AgroFlow-Setup-A1B2", DeviceSetupCommands.SetupNetworkName("3c71bfa1b2"));
        Assert.Equal("AF-BFA1B2", DeviceSetupCommands.SetupNetworkPassword("3c71bfa1b2"));
    }

    [Fact]
    public void ARealTwelveCharacterEfuseId_Works()
    {
        Assert.Equal("AgroFlow-Setup-9C3D", DeviceSetupCommands.SetupNetworkName("A4CF129C3D"));
        Assert.Equal("AF-129C3D", DeviceSetupCommands.SetupNetworkPassword("A4CF129C3D"));
    }

    // A short or missing id must not throw on a screen the farmer is looking
    // at. Placeholders make it obvious something is wrong without crashing
    // the page.
    [Theory]
    [InlineData(null)]
    [InlineData("")]
    public void AMissingDeviceId_ProducesPlaceholdersRatherThanThrowing(string? deviceId)
    {
        Assert.Equal("AgroFlow-Setup-????", DeviceSetupCommands.SetupNetworkName(deviceId));
        Assert.Equal("AF-??????", DeviceSetupCommands.SetupNetworkPassword(deviceId));
    }

    [Fact]
    public void AnIdShorterThanTheSuffix_IsUsedWhole()
    {
        Assert.Equal("AgroFlow-Setup-AB", DeviceSetupCommands.SetupNetworkName("ab"));
    }
}
