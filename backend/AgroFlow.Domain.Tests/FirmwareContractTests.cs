using System;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Text.Json;
using AgroFlow.Api.Endpoints;
using AgroFlow.Api.Mqtt;
using Xunit;

namespace AgroFlow.Domain.Tests;

// Part 2 (TEST PLAN 3): the firmware against the API contract, without
// hardware. Reads the sketch's source (AgroFlowIrrigationNode.ino only -
// never secrets.h) and checks every route, header, topic and JSON field it
// uses against what the server declares. A mismatch means a board in the
// field stops talking to the API.
public class FirmwareContractTests
{
    private static string Sketch()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir != null && !Directory.Exists(Path.Combine(dir.FullName, "hardware"))) dir = dir.Parent;
        return File.ReadAllText(Path.Combine(dir!.FullName, "hardware", "esp32", "AgroFlowIrrigationNode", "AgroFlowIrrigationNode.ino"));
    }

    private static string Camel(string name) => JsonNamingPolicy.CamelCase.ConvertName(name);

    private static string[] Fields(Type record) =>
        record.GetProperties(BindingFlags.Public | BindingFlags.Instance).Select(p => Camel(p.Name)).ToArray();

    [Theory]
    [InlineData("/api/devices/claim")]
    [InlineData("/api/devices/mqtt-credentials")]
    [InlineData("/api/devices/firmware-check")]
    [InlineData("/api/devices/commands/")]
    [InlineData("/api/irrigation-events")]
    public void The_firmware_calls_routes_the_API_still_has(string route)
    {
        Assert.Contains($"\"{route}", Sketch());
    }

    [Fact]
    public void The_claim_the_firmware_sends_and_reads_matches_the_server()
    {
        var sketch = Sketch();
        foreach (var f in new[] { "deviceId", "enrollmentCode", "firmwareVersion" })
        {
            Assert.Contains($"doc[\"{f}\"]", sketch);
            Assert.Contains(f, Fields(typeof(ClaimDeviceRequest)));
        }
        foreach (var f in new[] { "deviceToken", "farmId", "zoneId", "mqttUsername", "mqttPassword" })
        {
            Assert.Contains($"[\"{f}\"]", sketch);
            Assert.Contains(f, Fields(typeof(ClaimDeviceResponse)));
        }
    }

    [Fact]
    public void The_broker_details_the_firmware_reads_are_optional_on_the_server()
    {
        var sketch = Sketch();
        Assert.Contains("r[\"mqttHost\"] | \"\"", sketch);         // empty = keep the compiled-in broker
        Assert.Contains("mqttHost", Fields(typeof(MqttCredentialsResponse)));
        Assert.Contains("mqttPort", Fields(typeof(MqttCredentialsResponse)));
    }

    [Fact]
    public void Irrigation_events_command_acks_and_firmware_checks_match()
    {
        var sketch = Sketch();
        foreach (var f in new[] { "zoneId", "runtimeSeconds", "triggerSource", "syncStatus", "startedAt" })
        {
            Assert.Contains($"doc[\"{f}\"]", sketch);
            Assert.Contains(f, Fields(typeof(IrrigationEventRequest)));
        }
        foreach (var f in new[] { "deviceId", "executedAt" }) Assert.Contains(f, Fields(typeof(CommandExecutedRequest)));
        foreach (var f in new[] { "updateAvailable", "downloadUrl" })
        {
            Assert.Contains($"doc[\"{f}\"]", sketch);
            Assert.Contains(f, Fields(typeof(FirmwareCheckResponse)));
        }
    }

    [Fact]
    public void MQTT_topics_and_payloads_match()
    {
        var sketch = Sketch();
        Assert.Contains("\"/device/\" + deviceId + \"/sensors\"", sketch);
        Assert.Contains("\"/device/\" + deviceId + \"/commands\"", sketch);
        Assert.Equal("agroflow/farm/+/device/+/sensors", MqttTopics.SensorTopicFilter);
        Assert.Equal("agroflow/farm/3/device/AF-1/commands", MqttTopics.CommandsTopic(3, "AF-1"));

        foreach (var f in new[] { "sensorType", "value" })
        {
            Assert.Contains($"doc[\"{f}\"]", sketch);
            Assert.Contains(f, Fields(typeof(SensorMqttPayload)));
        }
        // The command the server publishes (camelCase) has every field the board reads.
        foreach (var f in new[] { "id", "command", "durationSeconds", "source" })
        {
            Assert.Contains($"doc[\"{f}\"]", sketch);
            Assert.Contains(f, Fields(typeof(IrrigationCommandNotification)));
        }
    }

    [Fact]
    public void The_board_authenticates_with_its_own_token_header()
    {
        Assert.Contains("\"X-Device-Token\"", Sketch());
        Assert.Equal("X-Device-Token", AgroFlow.Api.Services.DeviceAuthService.TokenHeader);
    }
}
