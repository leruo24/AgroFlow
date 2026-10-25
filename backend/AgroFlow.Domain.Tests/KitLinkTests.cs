using System;
using System.Linq;
using AgroFlow.Business;
using Xunit;

namespace AgroFlow.Domain.Tests;

// Kit linking (firmware 1.7.2): the 6-digit code, the per-kit topics, the kit's status report and
// the claim decision. The database side is in hardware/sim/run-e2e.mjs (section 5b).
public class KitLinkTests
{
    private static readonly DateTimeOffset Now = new(2026, 10, 24, 12, 0, 0, TimeSpan.Zero);

    private static KitLink.CodeRow Waiting(long farmId = 7, string? presetDevice = null) =>
        new("enrolled", presetDevice, Now.AddMinutes(20), farmId);

    [Fact]
    public void A_setup_code_is_six_digits_and_lasts_thirty_minutes()
    {
        for (var i = 0; i < 200; i++) Assert.Matches("^[0-9]{6}$", KitLink.NewCode());
        Assert.Equal(TimeSpan.FromMinutes(30), KitLink.CodeLifetime);
        Assert.Equal("123456", KitLink.NormaliseCode(" 123 456 "));
        Assert.Equal("123456", KitLink.NormaliseCode("123-456"));
        Assert.Equal("ABCD2345", KitLink.NormaliseCode("abcd2345"));
    }

    [Fact]
    public void Each_kit_has_its_own_four_topics()
    {
        var t = KitLink.TopicsFor("A1B2C3D4E5F6");
        Assert.Equal("agroflow/A1B2C3D4E5F6/telemetry", t.Telemetry);
        Assert.Equal("agroflow/A1B2C3D4E5F6/cmd", t.Cmd);
        Assert.Equal("agroflow/A1B2C3D4E5F6/ack", t.Ack);
        Assert.Equal("agroflow/A1B2C3D4E5F6/status", t.Status);
        Assert.Equal(new[] { "agroflow/+/telemetry", "agroflow/+/ack", "agroflow/+/status" }, KitLink.SubscribeFilters.ToArray());
    }

    [Fact]
    public void Only_the_kits_own_channels_parse_and_the_old_farm_topics_do_not()
    {
        Assert.Equal(("A1", "telemetry"), KitLink.ParseKitTopic("agroflow/A1/telemetry"));
        Assert.Equal(("A1", "status"), KitLink.ParseKitTopic("agroflow/A1/status"));
        Assert.Equal(("A1", "ack"), KitLink.ParseKitTopic("agroflow/A1/ack"));
        Assert.Null(KitLink.ParseKitTopic("agroflow/A1/cmd"));                       // AgroFlow's own outgoing topic
        Assert.Null(KitLink.ParseKitTopic("agroflow/farm/3/device/A1/sensors"));    // 1.7.1 and older: the old parser
        Assert.Null(KitLink.ParseKitTopic("agroflow/farm/telemetry"));
        Assert.Null(KitLink.ParseKitTopic("other/A1/telemetry"));
        Assert.Null(KitLink.ParseKitTopic(null));
    }

    [Fact]
    public void The_last_will_says_offline_and_the_connect_message_says_online_with_firmware_and_signal()
    {
        Assert.Equal(new KitLink.StatusReport(false, null, null), KitLink.ParseStatus("offline"));
        Assert.Equal(new KitLink.StatusReport(true, "1.7.2", -61),
            KitLink.ParseStatus("{\"state\":\"online\",\"firmware\":\"1.7.2\",\"rssi\":-61}"));
        Assert.Equal(new KitLink.StatusReport(true, "1.7.2", null),
            KitLink.ParseStatus("{\"state\":\"online\",\"firmware\":\"1.7.2\",\"rssi\":12}"));   // not a real dBm
        Assert.Null(KitLink.ParseStatus("{\"state\":\"maybe\"}"));
        Assert.Null(KitLink.ParseStatus("garbage"));
        Assert.Null(KitLink.ParseStatus("{not json"));
    }

    [Fact]
    public void A_waiting_code_links_a_new_kit_and_ends_a_link_on_the_same_farm()
    {
        Assert.Equal(KitLink.ClaimOutcome.Link, KitLink.Decide(Waiting(), "KIT1", currentLinkFarmId: null, Now));
        // The same kit moved to another zone of the same farm.
        Assert.Equal(KitLink.ClaimOutcome.Link, KitLink.Decide(Waiting(farmId: 7), "KIT1", currentLinkFarmId: 7, Now));
    }

    [Fact]
    public void A_kit_still_linked_to_another_farm_is_refused_until_staff_unlink_it()
    {
        Assert.Equal(KitLink.ClaimOutcome.LinkedElsewhere, KitLink.Decide(Waiting(farmId: 7), "KIT1", currentLinkFarmId: 9, Now));
        var (status, code, message) = KitLink.Refusal(KitLink.ClaimOutcome.LinkedElsewhere, "Old test farm");
        Assert.Equal(409, status);
        Assert.Equal("kit_linked_elsewhere", code);
        Assert.Contains("Old test farm", message);
    }

    [Fact]
    public void An_expired_code_and_an_unknown_code_say_which()
    {
        var expired = Waiting() with { ExpiresAt = Now.AddSeconds(-1) };
        Assert.Equal(KitLink.ClaimOutcome.CodeExpired, KitLink.Decide(expired, "KIT1", null, Now));
        Assert.Equal(KitLink.ClaimOutcome.CodeInvalid, KitLink.Decide(null, "KIT1", null, Now));
        Assert.Equal("code_expired", KitLink.Refusal(KitLink.ClaimOutcome.CodeExpired).Code);
        Assert.Equal("code_invalid", KitLink.Refusal(KitLink.ClaimOutcome.CodeInvalid).Code);
    }

    [Fact]
    public void The_same_kit_retrying_the_same_code_is_answered_again_but_another_kit_is_told_it_is_used()
    {
        var linked = new KitLink.CodeRow("active", "KIT1", Now.AddMinutes(20), 7);
        Assert.Equal(KitLink.ClaimOutcome.Retry, KitLink.Decide(linked, "KIT1", null, Now));
        Assert.Equal(KitLink.ClaimOutcome.Retry, KitLink.Decide(linked, "kit1", null, Now));
        Assert.Equal(KitLink.ClaimOutcome.CodeUsed, KitLink.Decide(linked, "KIT2", null, Now));
        Assert.Equal(KitLink.ClaimOutcome.CodeUsed, KitLink.Decide(linked with { EnrollmentStatus = "replaced" }, "KIT1", null, Now));
        Assert.Equal((409, "code_used"), (KitLink.Refusal(KitLink.ClaimOutcome.CodeUsed).HttpStatus, KitLink.Refusal(KitLink.ClaimOutcome.CodeUsed).Code));
    }

    [Fact]
    public void A_code_made_for_one_kit_refuses_another()
    {
        Assert.Equal(KitLink.ClaimOutcome.WrongKit, KitLink.Decide(Waiting(presetDevice: "KIT1"), "KIT2", null, Now));
        Assert.Equal(KitLink.ClaimOutcome.Link, KitLink.Decide(Waiting(presetDevice: "KIT1"), "kit1", null, Now));
    }

    [Theory]
    [InlineData("enrolled", false, false, "waiting")]
    [InlineData("active", false, false, "linked")]
    [InlineData("active", true, false, "online")]
    [InlineData("active", true, true, "reading")]
    [InlineData("active", false, true, "reading")]   // an older kit never reports a status; its reading proves it
    [InlineData("replaced", true, true, "waiting")]
    public void The_admin_panel_moves_through_waiting_linked_online_and_first_reading(string status, bool online, bool reading, string stage) =>
        Assert.Equal(stage, KitLink.Stage(status, online, reading));

    [Fact]
    public void A_bucket_test_gives_litres_a_minute()
    {
        Assert.Equal(6.0, KitLink.FlowRateLpm(5, 50));
        Assert.Equal(1.71, KitLink.FlowRateLpm(2, 70));
        Assert.Null(KitLink.FlowRateLpm(0, 30));
        Assert.Null(KitLink.FlowRateLpm(5, 0));
    }
}
