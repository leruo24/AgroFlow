using AgroFlow.Business;

namespace AgroFlow.Domain.Tests;

// Step 4: the admin pastes hand-created HiveMQ logins in.
//
// This is tested directly because what the parser accepts IS the behaviour. A
// separator it mishandles stores a TRUNCATED password, which is not visible
// anywhere: the pool row looks fine, the admin page shows the username, and
// the only symptom is a board that cannot reach the broker weeks later with
// rc=5 in a serial log nobody is watching.
public class MqttPoolPasteParserTests
{
    [Fact]
    public void ATabSeparatedPair_IsTheConsoleCopyPasteCase()
    {
        var result = MqttPoolPasteParser.Parse("agroflow-kit-01\tS0meL0ngPassword");

        Assert.Single(result.Credentials);
        Assert.Equal("agroflow-kit-01", result.Credentials[0].Username);
        Assert.Equal("S0meL0ngPassword", result.Credentials[0].Password);
        Assert.Equal(0, result.Skipped);
    }

    [Theory]
    [InlineData("kit-01 pw")]
    [InlineData("kit-01,pw")]
    [InlineData("kit-01:pw")]
    [InlineData("kit-01;pw")]
    [InlineData("kit-01\tpw")]
    public void EverySupportedSeparatorWorks(string line)
    {
        var result = MqttPoolPasteParser.Parse(line);

        Assert.Single(result.Credentials);
        Assert.Equal("kit-01", result.Credentials[0].Username);
        Assert.Equal("pw", result.Credentials[0].Password);
    }

    [Fact]
    public void AWholeBatchIsRead()
    {
        var result = MqttPoolPasteParser.Parse(
            "kit-01 pw1\nkit-02 pw2\nkit-03 pw3");

        Assert.Equal(3, result.Credentials.Count);
        Assert.Equal(new[] { "kit-01", "kit-02", "kit-03" },
            result.Credentials.Select(c => c.Username));
    }

    [Fact]
    public void WindowsLineEndingsAreHandled()
    {
        var result = MqttPoolPasteParser.Parse("kit-01 pw1\r\nkit-02 pw2\r\n");

        Assert.Equal(2, result.Credentials.Count);
        Assert.Equal(0, result.Skipped);
    }

    [Fact]
    public void BlankLinesAreNotCountedAsFailures()
    {
        var result = MqttPoolPasteParser.Parse("\n\nkit-01 pw1\n\n   \nkit-02 pw2\n\n");

        Assert.Equal(2, result.Credentials.Count);
        Assert.Equal(0, result.Skipped);
    }

    // So an admin can label a batch without the label counting as a failure.
    [Fact]
    public void CommentLinesAreIgnored()
    {
        var result = MqttPoolPasteParser.Parse(
            "# created 2026-10-03, kits 11-20\nkit-11 pw\n# end");

        Assert.Single(result.Credentials);
        Assert.Equal(0, result.Skipped);
    }

    // ---- THE ONE THAT WOULD SILENTLY BREAK A BOARD ------------------------

    [Fact]
    public void APasswordContainingASeparator_IsKeptWHOLE()
    {
        // A generated password routinely contains a colon, a comma or a
        // space. Splitting on all separators would store "Ab12" and the board
        // would never connect.
        var result = MqttPoolPasteParser.Parse("kit-01\tAb12:Cd34,Ef56;Gh78 Ij90");

        Assert.Single(result.Credentials);
        Assert.Equal("Ab12:Cd34,Ef56;Gh78 Ij90", result.Credentials[0].Password);
    }

    [Fact]
    public void AColonShorthandWithAColonInThePassword_KeepsThePasswordWhole()
    {
        var result = MqttPoolPasteParser.Parse("kit-01:pass:word:here");

        Assert.Equal("kit-01", result.Credentials[0].Username);
        Assert.Equal("pass:word:here", result.Credentials[0].Password);
    }

    // Aligned columns pasted out of a table.
    [Fact]
    public void ExtraSpacingBetweenTheColumnsIsAbsorbed()
    {
        var result = MqttPoolPasteParser.Parse("kit-01    \t   S0meL0ngPassword   ");

        Assert.Equal("kit-01", result.Credentials[0].Username);
        Assert.Equal("S0meL0ngPassword", result.Credentials[0].Password);
    }

    // A password ending in a symbol must survive the trim.
    [Fact]
    public void ATrailingSymbolInThePasswordSurvives()
    {
        var result = MqttPoolPasteParser.Parse("kit-01 pass!@#$%^&*()_+-=[]{}|");

        Assert.Equal("pass!@#$%^&*()_+-=[]{}|", result.Credentials[0].Password);
    }

    // ---- Lines that cannot be read ---------------------------------------

    [Theory]
    [InlineData("justausername")]
    [InlineData("kit-01 ")]
    [InlineData("kit-01:")]
    [InlineData(" pw")]
    [InlineData(":pw")]
    public void AnUnreadableLineIsCountedAndReported(string line)
    {
        var result = MqttPoolPasteParser.Parse(line);

        Assert.Empty(result.Credentials);
        Assert.Equal(1, result.Skipped);
    }

    // A partly-bad paste stores the good rows and reports the rest, rather
    // than rejecting the whole batch - the admin can then fix two lines
    // instead of re-pasting twenty.
    [Fact]
    public void AGoodBatchWithOneBadLine_StoresTheGoodOnesAndReportsTheBadOne()
    {
        var result = MqttPoolPasteParser.Parse("kit-01 pw1\nnopasswordhere\nkit-03 pw3");

        Assert.Equal(2, result.Credentials.Count);
        Assert.Equal(1, result.Skipped);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   \n\n  ")]
    public void NothingPasted_YieldsNothingAndNoFailures(string? pasted)
    {
        var result = MqttPoolPasteParser.Parse(pasted);

        Assert.Empty(result.Credentials);
        Assert.Equal(0, result.Skipped);
    }
}
