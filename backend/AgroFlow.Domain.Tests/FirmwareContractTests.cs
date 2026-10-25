using System;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Text.Json;
using AgroFlow.Api.Endpoints;
using AgroFlow.Api.Mqtt;
using AgroFlow.Business;
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
        Assert.Contains("FIRMWARE_VERSION = \"1.7.2\"", sketch);
        // 1.7.2: the kit's own topics, the same the server builds (KitLink.TopicsFor).
        Assert.Contains("String base = \"agroflow/\" + getDeviceId() + \"/\";", sketch);
        foreach (var channel in new[] { "telemetry", "cmd", "ack", "status" })
            Assert.Contains($"base + \"{channel}\"", sketch);
        Assert.Equal("agroflow/A1/telemetry", KitLink.TopicsFor("A1").Telemetry);
        Assert.Equal("agroflow/A1/cmd", KitLink.TopicsFor("A1").Cmd);
        // Kits still on 1.7.1 keep the farm topics until they are reflashed.
        Assert.Equal("agroflow/farm/+/device/+/sensors", MqttTopics.SensorTopicFilter);
        Assert.Equal("agroflow/farm/3/device/AF-1/commands", MqttTopics.CommandsTopic(3, "AF-1"));

        foreach (var f in new[] { "sensorType", "value" })
        {
            Assert.Contains($"doc[\"{f}\"]", sketch);
            Assert.Contains(f, Fields(typeof(SensorMqttPayload)));
        }
        // The command the server publishes (camelCase) has every field the board reads.
        // (firmware 1.6.0 reads the run fields through a JsonVariantConst named cmd)
        foreach (var f in new[] { "id", "command", "durationSeconds", "source", "maxRunSeconds" })
        {
            Assert.True(sketch.Contains($"doc[\"{f}\"]") || sketch.Contains($"cmd[\"{f}\"]"), f);
            Assert.Contains(f, Fields(typeof(IrrigationCommandNotification)));
        }
    }

    [Fact]
    public void The_board_authenticates_with_its_own_token_header()
    {
        Assert.Contains("\"X-Device-Token\"", Sketch());
        Assert.Equal("X-Device-Token", AgroFlow.Api.Services.DeviceAuthService.TokenHeader);
    }

    [Fact]
    public void The_pins_match_the_wiring_and_the_relay_is_off_before_anything_else()
    {
        // The real kit (2026-10-23): soil GPIO 32, relay GPIO 25 active LOW, DHT11 GPIO 27.
        var sketch = Sketch().Replace("\r\n", "\n");
        Assert.Contains("const int MOISTURE_PIN = 32;", sketch);
        Assert.Contains("const int RELAY_PIN    = 25;", sketch);
        Assert.Contains("const int DHT_PIN      = 27;", sketch);
        Assert.Contains("const bool RELAY_ACTIVE_LOW = true;", sketch);
        Assert.Contains("dht.setup(DHT_PIN, DHTesp::DHT11);", sketch);
        // The first two statements of setup(): the relay pin is an output, and it is off.
        var setup = sketch[(sketch.IndexOf("void setup() {", StringComparison.Ordinal) + "void setup() {".Length)..];
        var statements = setup.Split(';', 3).Select(s => s.Trim()).ToArray();
        Assert.Equal("pinMode(RELAY_PIN, OUTPUT)", statements[0]);
        Assert.Equal("relayWrite(false)", statements[1]);
    }

    [Fact]
    public void A_repeated_command_ID_is_acknowledged_again_and_never_carried_out_twice()
    {
        var sketch = Sketch().Replace("\r\n", "\n");
        Assert.Contains("#include \"CommandIds.h\"", sketch);
        Assert.Contains("const size_t RECENT_COMMAND_IDS = 32;", sketch);
        var handler = sketch[sketch.IndexOf("void handleMqttCommand(", StringComparison.Ordinal)..];
        handler = handler[..handler.IndexOf("\nvoid reconnectMqtt()", StringComparison.Ordinal)];
        int Index(string s) { var i = handler.IndexOf(s, StringComparison.Ordinal); Assert.True(i >= 0, s); return i; }
        // In order: look the ID up; a repeat is re-acknowledged with its first time and returns;
        // a new ID is remembered and saved to flash; only then can the pump start.
        Assert.True(Index("recentCommands.acknowledgedAt(commandId)") < Index("markCommandExecuted(commandId, (uint32_t)firstAck)"));
        Assert.True(Index("markCommandExecuted(commandId, (uint32_t)firstAck)") < Index("recentCommands.remember(commandId, ackEpoch)"));
        Assert.True(Index("recentCommands.remember(commandId, ackEpoch)") < Index("saveRecentCommands()"));
        Assert.True(Index("saveRecentCommands()") < Index("startPumpCycle("));
        // The IDs are loaded from flash at boot.
        Assert.Contains("loadRecentCommands();", sketch);
    }

    [Fact]
    public void The_setup_details_are_printed_at_boot_and_when_the_setup_page_opens_and_never_a_secret()
    {
        var sketch = Sketch().Replace("\r\n", "\n");
        var block = sketch[sketch.IndexOf("void printKitSetupInfo() {", StringComparison.Ordinal)..];
        block = block[..block.IndexOf("\n}", StringComparison.Ordinal)];
        // 1.7.2: the hotspot has no password; the local pump page keeps one.
        foreach (var line in new[] { "===== AgroFlow kit =====", "Device ID: %s", "Setup Wi-Fi: %s (no password)", "Kit page password (user agroflow): %s", "Setup page: 192.168.4.1", "=======================" })
            Assert.Contains(line, block);
        // The device token and the MQTT login are never printed.
        foreach (var secret in new[] { "deviceToken", "mqttPass", "mqttUser" }) Assert.DoesNotContain(secret, block);

        var setup = sketch[sketch.IndexOf("void setup() {", StringComparison.Ordinal)..];
        Assert.Contains("printKitSetupInfo();", setup[..setup.IndexOf("if (!isClaimed)", StringComparison.Ordinal)]);   // at boot
        var portal = sketch[sketch.IndexOf("void openSetupPortal(const char *reason) {", StringComparison.Ordinal)..];
        Assert.Contains("printKitSetupInfo();", portal[..portal.IndexOf("\n}", StringComparison.Ordinal)]);             // whenever it opens
    }

    [Fact]
    public void Every_reading_carries_the_Wi_Fi_signal_and_soil_probe_check_and_the_server_reads_them()
    {
        var sketch = Sketch();
        Assert.Contains("doc[\"rssi\"] = WiFi.RSSI();", sketch);
        Assert.Contains("doc[\"soilProbeOk\"] = moistureValid(lastSoilRaw);", sketch);
        Assert.Contains("rssi", Fields(typeof(SensorMqttPayload)));
        Assert.Contains("soilProbeOk", Fields(typeof(SensorMqttPayload)));
    }

    [Fact]
    public void Every_reading_carries_the_backlog_and_the_server_reads_it()
    {
        Assert.Contains("doc[\"backlog\"]", Sketch());
        Assert.Contains("backlog", Fields(typeof(SensorMqttPayload)));
    }

    [Fact]
    public void Firmware_172_links_with_an_open_hotspot_keeps_the_login_from_the_claim_and_reports_online_and_offline()
    {
        var sketch = Sketch().Replace("\r\n", "\n");
        // The hotspot has no password, and the setup page shows the problem in plain words.
        Assert.Contains("WiFi.softAP(apName().c_str());", sketch);
        Assert.Contains("#include \"SetupPortal.h\"", sketch);
        Assert.Contains("agroflow::joinMessage(problem)", sketch);
        Assert.Contains("agroflow::claimMessage(httpCode, code)", sketch);
        Assert.Contains("closeSetupPortal();   // only after success", sketch);
        // The claim's answer: the broker, TLS and the farm and zone names for the page.
        foreach (var f in new[] { "mqttHost", "mqttPort", "mqttTls", "farmName", "zoneName" })
        {
            Assert.Contains($"r[\"{f}\"]", sketch);
            Assert.Contains(f, Fields(typeof(ClaimDeviceResponse)));
        }
        // Kept in flash, never printed.
        Assert.Contains("preferences.putString(\"mqttPass\", mqttPass);", sketch);
        Assert.DoesNotMatch(@"Serial\.print[a-z]*\([^;]*,\s*(mqttPass|mqttUser|deviceToken)", sketch);   // as an argument
        Assert.DoesNotMatch(@"Serial\.print(ln)?\((mqttPass|mqttUser|deviceToken)", sketch);
        // Last will "offline" (retained) and a retained online message with firmware and signal.
        Assert.Contains("mqttStatusTopic.c_str(), 1, true, \"offline\")", sketch);
        Assert.Contains("online[\"state\"] = \"online\";", sketch);
        Assert.Contains("mqttClient.publish(mqttStatusTopic.c_str(), status.c_str(), true);", sketch);
        Assert.Equal(new KitLink.StatusReport(true, "1.7.2", -60),
            KitLink.ParseStatus("{\"state\":\"online\",\"firmware\":\"1.7.2\",\"rssi\":-60}"));
        // Acknowledgements go over MQTT first; unlink forgets the link and reopens setup.
        Assert.Contains("mqttClient.publish(mqttAckTopic.c_str(), ackBody.c_str())", sketch);
        Assert.Contains("if (strcmp(command, \"unlink\") == 0) { unlinkKit(", sketch);
        // Unchanged: change_wifi, open_setup and the power-cycle resets.
        Assert.Contains("forgetWifiAndOpenSetup(\"change WiFi requested from the app\")", sketch);
        Assert.Contains("openSetupPortal(\"remote open_setup command\")", sketch);
        Assert.Contains("const int BOOTS_FOR_PORTAL = 3;", sketch);
        Assert.Contains("const int BOOTS_FOR_FACTORY_RESET = 5;", sketch);
    }
}
