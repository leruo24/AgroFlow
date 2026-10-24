using System;
using System.Collections.Generic;
using System.Linq;
using System.Globalization;
using System.Security.Cryptography;
using System.Text.Json;

namespace AgroFlow.Business;

// Kit linking (firmware 1.7.2): the 6-digit setup code, the per-kit MQTT topics, the kit's
// online/offline report and the claim decision. No database here, so every rule is unit-tested.
public static class KitLink
{
    public const int CodeLength = 6;
    public static readonly TimeSpan CodeLifetime = TimeSpan.FromMinutes(30);

    // Six digits: typed on a phone into the kit's setup page, read out over a call.
    public static string NewCode() =>
        RandomNumberGenerator.GetInt32(0, 1_000_000).ToString("D6", CultureInfo.InvariantCulture);

    // "123 456", "123-456" and older 8-character codes in lower case all compare equal.
    public static string NormaliseCode(string? code) =>
        new string((code ?? "").Where(char.IsLetterOrDigit).ToArray()).ToUpperInvariant();

    // ----- Per-kit MQTT topics ---------------------------------------------------------
    // agroflow/<deviceId>/telemetry  kit -> AgroFlow   readings (the same JSON as before)
    // agroflow/<deviceId>/cmd        AgroFlow -> kit   commands
    // agroflow/<deviceId>/ack        kit -> AgroFlow   {"id","executedAt"} for a command it carried out
    // agroflow/<deviceId>/status     kit -> AgroFlow   retained: "offline" (last will) or {"state":"online",...}
    // Kits on 1.7.1 and older keep agroflow/farm/<farmId>/device/<deviceId>/sensors|commands.
    public const string Telemetry = "telemetry";
    public const string Command = "cmd";
    public const string Ack = "ack";
    public const string Status = "status";

    public static string Topic(string deviceId, string channel) => $"agroflow/{deviceId}/{channel}";

    public static IReadOnlyList<string> SubscribeFilters { get; } =
        new[] { "agroflow/+/" + Telemetry, "agroflow/+/" + Ack, "agroflow/+/" + Status };

    public sealed record Topics(string Telemetry, string Cmd, string Ack, string Status);

    public static Topics TopicsFor(string deviceId) => new(
        Topic(deviceId, Telemetry), Topic(deviceId, Command), Topic(deviceId, Ack), Topic(deviceId, Status));

    // "agroflow/<deviceId>/<channel>" for the kit's own channels; null for anything else
    // (including the old agroflow/farm/... topics, which have more segments).
    public static (string DeviceId, string Channel)? ParseKitTopic(string? topic)
    {
        var parts = (topic ?? "").Split('/');
        if (parts.Length != 3 || parts[0] != "agroflow" || parts[1].Length == 0 || parts[1] == "farm") return null;
        return parts[2] is Telemetry or Ack or Status ? (parts[1], parts[2]) : null;
    }

    // ----- The kit's status report -----------------------------------------------------

    public sealed record StatusReport(bool Online, string? Firmware, int? Rssi);

    // The last will is the plain word "offline"; on connect the kit publishes
    // {"state":"online","firmware":"1.7.2","rssi":-61}. Anything else is ignored (null).
    public static StatusReport? ParseStatus(string? payload)
    {
        var text = (payload ?? "").Trim();
        if (text.Equals("offline", StringComparison.OrdinalIgnoreCase)) return new StatusReport(false, null, null);
        if (text.Equals("online", StringComparison.OrdinalIgnoreCase)) return new StatusReport(true, null, null);
        if (!text.StartsWith('{')) return null;
        try
        {
            using var doc = JsonDocument.Parse(text);
            var root = doc.RootElement;
            if (!root.TryGetProperty("state", out var state) || state.ValueKind != JsonValueKind.String) return null;
            var online = state.GetString() switch { "online" => true, "offline" => false, _ => (bool?)null };
            if (online is null) return null;
            string? firmware = root.TryGetProperty("firmware", out var f) && f.ValueKind == JsonValueKind.String ? f.GetString() : null;
            int? rssi = root.TryGetProperty("rssi", out var r) && r.ValueKind == JsonValueKind.Number && r.TryGetInt32(out var dbm)
                        && dbm is >= -127 and <= 0 ? dbm : null;
            return new StatusReport(online.Value, firmware, rssi);
        }
        catch (JsonException)
        {
            return null;
        }
    }

    // ----- The claim decision ----------------------------------------------------------

    public enum ClaimOutcome
    {
        Link,            // a new link (any other link of this kit on the same farm ends)
        Retry,           // the same kit sent the same code again: answer as before
        CodeInvalid,     // no such code
        CodeExpired,     // the code's 30 minutes are over
        CodeUsed,        // the code already linked a different kit, or its link has ended
        WrongKit,        // staff typed a device ID when making the code, and this is another kit
        LinkedElsewhere, // this kit is still linked to another farm: unlink it there first
    }

    // The hardware row the code belongs to.
    public sealed record CodeRow(string EnrollmentStatus, string? DeviceId, DateTimeOffset? ExpiresAt, long FarmId);

    // farmId: the farm of the kit's current active link (another hardware row), if it has one.
    public static ClaimOutcome Decide(CodeRow? row, string deviceId, long? currentLinkFarmId, DateTimeOffset now)
    {
        if (row is null) return ClaimOutcome.CodeInvalid;
        if (row.ExpiresAt is not { } expires || expires <= now) return ClaimOutcome.CodeExpired;

        switch (row.EnrollmentStatus)
        {
            case "active":
                return string.Equals(row.DeviceId, deviceId, StringComparison.OrdinalIgnoreCase)
                    ? ClaimOutcome.Retry
                    : ClaimOutcome.CodeUsed;
            case "enrolled":
                if (row.DeviceId is { Length: > 0 } expected && !string.Equals(expected, deviceId, StringComparison.OrdinalIgnoreCase))
                    return ClaimOutcome.WrongKit;
                return currentLinkFarmId is { } farm && farm != row.FarmId
                    ? ClaimOutcome.LinkedElsewhere
                    : ClaimOutcome.Link;
            default:
                return ClaimOutcome.CodeUsed;
        }
    }

    // What the kit's setup page and the admin page say. Code is what the firmware switches on.
    public static (int HttpStatus, string Code, string Message) Refusal(ClaimOutcome outcome, string? otherFarm = null) => outcome switch
    {
        ClaimOutcome.CodeExpired => (401, "code_expired", "This code has expired. Ask AgroFlow for a new code."),
        ClaimOutcome.CodeUsed => (409, "code_used", "This code has already been used. Ask AgroFlow for a new code."),
        ClaimOutcome.WrongKit => (401, "wrong_kit", "This code was made for a different kit."),
        ClaimOutcome.LinkedElsewhere => (409, "kit_linked_elsewhere",
            $"This kit is still linked to {(string.IsNullOrWhiteSpace(otherFarm) ? "another farm" : otherFarm)}. AgroFlow staff must unlink it there first."),
        _ => (401, "code_invalid", "That code is not right. Check the 6 digits."),
    };

    // ----- The admin page's live stages ------------------------------------------------

    public const string StageWaiting = "waiting";
    public const string StageLinked = "linked";
    public const string StageOnline = "online";
    public const string StageReading = "reading";

    // Waiting for kit -> Linked -> Online -> First reading received. A reading proves the kit is
    // online too (kits before 1.7.2 never publish a status).
    public static string Stage(string enrollmentStatus, bool reportedOnline, bool hasReading) =>
        enrollmentStatus != "active" ? StageWaiting
        : hasReading ? StageReading
        : reportedOnline ? StageOnline
        : StageLinked;

    // Bucket test: litres caught in a number of seconds, as litres a minute (2 decimals).
    public static double? FlowRateLpm(double litres, double seconds) =>
        litres > 0 && seconds > 0 ? Math.Round(litres * 60.0 / seconds, 2) : null;
}
