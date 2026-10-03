using AgroFlow.Business;

namespace AgroFlow.Domain.Tests;

// Step 1 / step 7: "mqtt-credentials includes host/port when configured."
//
// This is the switch that moves every board to a different broker without a
// reflash - which is the whole reason it exists, because HiveMQ Cloud
// Serverless is retired on 31 December 2026.
//
// The asymmetry it encodes is the important part: a board given NO address
// falls back to its compiled-in MQTT_HOST and keeps working. A board given a
// BAD one - an empty host, port 0 - tries, fails and retries forever. So an
// unusable value has to come back as "not configured", and a typo in
// Mqtt__Host on the day of that migration must leave the fleet on the old
// address rather than strand it between two.
public class MqttBrokerAddressTests
{
    private const string Host = "853fe2eddcd24d0c8e0f4d69869c5dab.s1.eu.hivemq.cloud";

    [Fact]
    public void AConfiguredHostAndPortAreBothSent()
    {
        var (host, port) = MqttBrokerAddress.Resolve(Host, "8883");

        Assert.Equal(Host, host);
        Assert.Equal(8883, port);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public void NoHostMeansNothingIsSent(string? configuredHost)
    {
        var (host, port) = MqttBrokerAddress.Resolve(configuredHost, "8883");

        Assert.Null(host);
        // The port goes too. A port with no host has nothing to connect to,
        // and sending half an address is how a board ends up pointed at its
        // compiled-in host on somebody else's port.
        Assert.Null(port);
    }

    // A host with no usable port IS still worth sending: the board falls back
    // to its own compiled-in 8883, which is right for any TLS broker.
    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("not-a-number")]
    public void AHostWithNoUsablePortIsStillSent(string? configuredPort)
    {
        var (host, port) = MqttBrokerAddress.Resolve(Host, configuredPort);

        Assert.Equal(Host, host);
        Assert.Null(port);
    }

    // THE ONE THAT WOULD STRAND A BOARD: port 0 is both "unset" in config and
    // what a failed int.TryParse leaves behind, so it must never reach a
    // device as a real port.
    [Theory]
    [InlineData("0")]
    [InlineData("-1")]
    [InlineData("65536")]
    [InlineData("99999")]
    public void AnImpossiblePortIsNotSent(string configuredPort)
    {
        var (_, port) = MqttBrokerAddress.Resolve(Host, configuredPort);

        Assert.Null(port);
    }

    [Theory]
    [InlineData("1")]
    [InlineData("1883")]
    [InlineData("8883")]
    [InlineData("65535")]
    public void EveryRealPortIsAccepted(string configuredPort)
    {
        Assert.NotNull(MqttBrokerAddress.ResolvePort(configuredPort));
    }

    // A pasted Railway variable routinely carries whitespace, and a hostname
    // with a trailing space fails DNS in a way that looks like the broker
    // being down.
    [Fact]
    public void SurroundingWhitespaceIsTrimmed()
    {
        var (host, port) = MqttBrokerAddress.Resolve("  " + Host + "\n", " 8883 ");

        Assert.Equal(Host, host);
        Assert.Equal(8883, port);
    }

    // The migration this exists for: point the fleet at a different broker by
    // changing one variable.
    [Fact]
    public void MovingBrokersIsOneConfigChange()
    {
        var (host, port) = MqttBrokerAddress.Resolve("broker.emqx.io", "8883");

        Assert.Equal("broker.emqx.io", host);
        Assert.Equal(8883, port);
    }
}
