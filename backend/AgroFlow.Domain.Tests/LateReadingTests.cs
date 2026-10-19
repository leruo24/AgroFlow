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

// Part C (kit offline): a kit sends the readings it kept while offline with their own
// time. They are stored, but only a fresh reading may change health, alerts or the
// pump (ReadingAge). The firmware side is checked from the sketch's source, like
// FirmwareContractTests; the ring itself is tested natively in hardware/esp32/tests.
public class LateReadingTests
{
    private static readonly DateTimeOffset Now = DateTimeOffset.Parse("2026-10-19T10:00:00Z");

    [Theory]
    [InlineData(null, ReadingTiming.Live)]                  // a normal live reading
    [InlineData(0, ReadingTiming.Live)]
    [InlineData(30, ReadingTiming.Live)]                    // one report late
    [InlineData(600, ReadingTiming.Live)]                   // exactly the 10-minute limit
    [InlineData(601, ReadingTiming.Late)]
    [InlineData(3 * 3600, ReadingTiming.Late)]              // a morning offline
    [InlineData(7 * 86400, ReadingTiming.Late)]             // a week back is still kept
    [InlineData(7 * 86400 + 1, ReadingTiming.Rejected)]
    [InlineData(-120, ReadingTiming.Live)]                  // kit clock two minutes fast
    [InlineData(-301, ReadingTiming.Rejected)]              // in the future
    public void Readings_are_classed_by_age(int? secondsOld, ReadingTiming expected)
    {
        DateTimeOffset? recordedAt = secondsOld is null ? null : Now.AddSeconds(-secondsOld.Value);
        Assert.Equal(expected, ReadingAge.Classify(recordedAt, Now));
    }

    [Fact]
    public void Only_a_live_reading_may_start_watering()
    {
        Assert.True(ReadingAge.MayDriveLiveDecisions(ReadingTiming.Live));
        Assert.False(ReadingAge.MayDriveLiveDecisions(ReadingTiming.Late));
        Assert.False(ReadingAge.MayDriveLiveDecisions(ReadingTiming.Rejected));
    }

    [Fact]
    public void The_max_age_rule_is_ten_minutes()
    {
        Assert.Equal(TimeSpan.FromMinutes(10), ReadingAge.MaxLiveAge);
        // Bounded by the 30 s report interval: anything past this is many missed reports.
        Assert.True(ReadingAge.MaxLiveAge > TimeSpan.FromSeconds(30));
    }

    [Fact]
    public void A_late_reading_keeps_its_own_time_and_a_fast_clock_is_not_stored_in_the_future()
    {
        var old = Now.AddHours(-3);
        Assert.Equal(old, ReadingAge.StoredTime(old, Now));
        Assert.Equal(Now, ReadingAge.StoredTime(Now.AddMinutes(2), Now));
        Assert.Equal(Now, ReadingAge.StoredTime(null, Now));
    }

    [Fact]
    public void The_processor_classifies_before_it_can_issue_a_command()
    {
        // Source-level guard: the late path returns before the insert of an auto command.
        var src = File.ReadAllText(Path.Combine(RepoRoot(), "backend", "AgroFlow.Api", "Services", "SensorReadingProcessor.cs"));
        var classify = src.IndexOf("ReadingAge.Classify(", StringComparison.Ordinal);
        var lateReturn = src.IndexOf("!ReadingAge.MayDriveLiveDecisions(timing)", StringComparison.Ordinal);
        var command = src.IndexOf("await InsertAutoCommandAsync(", StringComparison.Ordinal);
        Assert.True(classify > 0 && lateReturn > classify && command > lateReturn,
            "ProcessAsync must classify the reading and return for a late one before any pump command.");
    }

    [Fact]
    public void A_buffered_mqtt_reading_parses_with_its_time()
    {
        var json = """{"sensorType":"SoilMoisture","value":31.5,"recordedAt":"2026-10-19T07:00:00Z","seq":42}""";
        var payload = JsonSerializer.Deserialize<SensorMqttPayload>(json, new JsonSerializerOptions(JsonSerializerDefaults.Web))!;
        Assert.Equal("SoilMoisture", payload.SensorType);
        Assert.Equal(31.5f, payload.Value);
        Assert.Equal(DateTimeOffset.Parse("2026-10-19T07:00:00Z"), payload.RecordedAt);
        Assert.Equal(42, payload.Seq);

        // A live reading from older firmware has neither, and is live.
        var live = JsonSerializer.Deserialize<SensorMqttPayload>("""{"sensorType":"Humidity","value":60}""",
            new JsonSerializerOptions(JsonSerializerDefaults.Web))!;
        Assert.Null(live.RecordedAt);
        Assert.Equal(ReadingTiming.Live, ReadingAge.Classify(live.RecordedAt, Now));
    }

    [Fact]
    public void The_http_reading_route_takes_recordedAt_too()
    {
        Assert.Contains("recordedAt", Fields(typeof(SensorReadingRequest)));
    }

    // Firmware v1.5.0, from the sketch's source (never secrets.h).

    [Fact]
    public void The_firmware_sends_buffered_readings_with_recordedAt_and_seq()
    {
        var sketch = Sketch();
        foreach (var f in new[] { "recordedAt", "seq" })
        {
            Assert.Contains($"doc[\"{f}\"]", sketch);
            Assert.Contains(f, Fields(typeof(SensorMqttPayload)));
        }
        Assert.Contains("#include \"OfflineBuffer.h\"", sketch);
        Assert.Contains("readingBuffer.replay(", sketch);
        Assert.Contains("runBuffer.replay(", sketch);
        Assert.Contains("\"offline_queued\"", sketch);   // kept runs upload as offline_queued events
    }

    [Fact]
    public void The_local_page_is_on_the_kit_wifi_only_behind_its_password_and_capped_at_five_minutes()
    {
        var sketch = Sketch();
        Assert.Contains("server.client().localIP() != WiFi.softAPIP()", sketch);
        Assert.Contains("server.authenticate(LOCAL_PAGE_USER, apPassword().c_str())", sketch);
        // Its own 5 minutes (firmware 1.6.0 lets server runs go up to the zone's maximum).
        Assert.Contains("const unsigned long LOCAL_MAX_RUN_MS         = 5UL * 60UL * 1000UL;", sketch);
        Assert.Contains("LOCAL_MAX_RUN_MINUTES    = LOCAL_MAX_RUN_MS / 60000UL", sketch);
        Assert.Contains("runLimitMs = LOCAL_MAX_RUN_MS;", sketch);
        Assert.Contains("startPumpCycle(\"manual\", false);", sketch);   // logged as a manual irrigation event
        // Every handler checks first.
        foreach (var handler in new[] { "handleLocalPage", "handleLocalStatus", "handleLocalPump" })
        {
            var at = sketch.IndexOf($"void {handler}()", StringComparison.Ordinal);
            Assert.True(at > 0, handler);
            var body = sketch.Substring(at, 200);
            Assert.Contains("if (!localRequestAllowed()) return;", body);
        }
    }

    [Fact]
    public void The_firmware_pins_are_unchanged()
    {
        var sketch = Sketch();
        Assert.Contains("const int MOISTURE_PIN = 32;", sketch);
        Assert.Contains("const int RELAY_PIN    = 25;", sketch);
        Assert.Contains("const int DHT_PIN      = 27;", sketch);
    }

    private static string Camel(string name) => JsonNamingPolicy.CamelCase.ConvertName(name);

    private static string[] Fields(Type record) =>
        record.GetProperties(BindingFlags.Public | BindingFlags.Instance).Select(p => Camel(p.Name)).ToArray();

    private static string Sketch() =>
        File.ReadAllText(Path.Combine(RepoRoot(), "hardware", "esp32", "AgroFlowIrrigationNode", "AgroFlowIrrigationNode.ino"));

    private static string RepoRoot()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir != null && !Directory.Exists(Path.Combine(dir.FullName, "hardware"))) dir = dir.Parent;
        return dir!.FullName;
    }
}
