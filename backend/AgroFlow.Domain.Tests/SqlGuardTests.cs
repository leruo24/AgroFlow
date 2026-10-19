using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using Xunit;
using Xunit.Abstractions;

namespace AgroFlow.Domain.Tests;

// Part 2: the guarantees that live in SQL, asserted where the SQL is - there
// is no database in the test run (and must not be).
public class SqlGuardTests
{
    private readonly ITestOutputHelper _out;
    public SqlGuardTests(ITestOutputHelper output) { _out = output; }

    private static string Api(string relative) =>
        File.ReadAllText(Path.Combine(Root(), "backend", "AgroFlow.Api", relative));

    private static string Root()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir != null && !Directory.Exists(Path.Combine(dir.FullName, "backend", "AgroFlow.Api"))) dir = dir.Parent;
        return dir!.FullName;
    }

    // ---- farmer A cannot reach farmer B's things --------------------------

    /// What counts as checking that the caller may touch this zone or farm.
    private static readonly string[] AccessChecks =
    {
        "CanAccessZone", "CanAccessFarm", "FarmAccessSql", "owner_id", "farm_member", "AccessibleZone", "ReadZoneAsync",
        "requireFarmAccess: true",   // ZoneHardwareEndpoints' shared helpers - see the test below
    };

    [Fact]
    public void The_kit_helpers_apply_the_ownership_test_when_asked_to()
    {
        var src = Api(Path.Combine("Endpoints", "ZoneHardwareEndpoints.cs"));
        Assert.Contains("f.owner_id = $1", src);
        Assert.Contains("fm.profile_id = $1", src);
        Assert.Equal(2, Regex.Matches(src, @"requireFarmAccess \? \$""and \(\{FarmAccessSql\}\)""").Count);
        // Only the admin routes (behind AdminOnlyFilter) pass false.
        Assert.DoesNotContain("farmer.MapPost(\"/change-wifi\", AdminChangeWifiAsync", src);
    }

    [Fact]
    public void Every_farmer_route_that_names_a_zone_or_farm_checks_the_caller_may_touch_it()
    {
        var offenders = new List<string>();
        var checkedRoutes = 0;
        foreach (var file in Directory.GetFiles(Path.Combine(Root(), "backend", "AgroFlow.Api", "Endpoints"), "*.cs"))
        {
            var src = File.ReadAllText(file);

            // Group prefixes: `var farmer = app.MapGroup("/api/farmer/zones/{zoneId:long}")`.
            var prefixes = Regex.Matches(src, @"var\s+(\w+)\s*=\s*app\.MapGroup\(\s*""([^""]+)""")
                .ToDictionary(m => m.Groups[1].Value, m => m.Groups[2].Value);
            prefixes["app"] = "";

            foreach (Match m in Regex.Matches(src, @"(\w+)\.Map(Get|Post|Put|Delete)\(\s*""([^""]*)""\s*,\s*(\w+)\s*\)"))
            {
                if (!prefixes.TryGetValue(m.Groups[1].Value, out var prefix)) continue;
                var full = prefix + m.Groups[3].Value;
                if (!full.StartsWith("/api/farmer", StringComparison.Ordinal)) continue;     // admin areas: ApiContractTests
                if (!full.Contains("{zoneId") && !full.Contains("{farmId")) continue;

                var handler = m.Groups[4].Value;
                var start = src.IndexOf($" {handler}(", StringComparison.Ordinal);
                var defStart = start < 0 ? -1 : src.LastIndexOf("private static", start, StringComparison.Ordinal);
                if (defStart < 0) { offenders.Add($"{Path.GetFileName(file)}: {handler} (body not found)"); continue; }
                var next = src.IndexOf("private static", start + handler.Length, StringComparison.Ordinal);
                var body = next < 0 ? src[defStart..] : src[defStart..next];

                checkedRoutes++;
                if (!AccessChecks.Any(body.Contains)) offenders.Add($"{Path.GetFileName(file)}: {full} -> {handler}");
            }
        }
        foreach (var o in offenders) _out.WriteLine(o);
        _out.WriteLine($"{checkedRoutes} farmer routes checked.");
        Assert.True(checkedRoutes >= 10, $"only {checkedRoutes} routes found - the scan is not finding them");
        Assert.Empty(offenders);
    }

    [Fact]
    public void The_zone_access_check_is_owner_member_or_admin_and_nothing_wider()
    {
        var xdb = File.ReadAllText(Path.Combine(Root(), "backend", "AgroFlow.Domain", "Fao56EngineXDB.cs"));
        var body = xdb[xdb.IndexOf("public bool CanAccessZone", StringComparison.Ordinal)..];
        body = body[..body.IndexOf("ExecuteScalar", StringComparison.Ordinal)];
        Assert.Contains("f.owner_id = $2", body);
        Assert.Contains("fm.profile_id = $2", body);
        Assert.Contains("p.role = 'admin'", body);
        Assert.DoesNotContain(" or true", body, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void Farm_alerts_reach_the_owner_and_every_farm_member_in_app_and_Telegram()
    {
        var farmerEndpoints = Api(Path.Combine("Endpoints", "FarmerEndpoints.cs"));
        var dashboard = farmerEndpoints[farmerEndpoints.IndexOf(
            "private static async Task<IResult> GetDashboardAsync", StringComparison.Ordinal)..];
        dashboard = dashboard[..dashboard.IndexOf(
            "private static async Task<IResult> UpdateZoneSettingsAsync", StringComparison.Ordinal)];

        // Every member can select the farm. Both zone alerts and farm-wide alerts are
        // shared farm data, not copied to one profile.
        Assert.Contains("where f.owner_id = $1", dashboard);
        Assert.Contains("fm.farm_id = f.farm_id and fm.profile_id = $1", dashboard);
        Assert.Contains("from alert a join selected_farm f", dashboard);
        Assert.Contains("a.farm_id = f.farm_id", dashboard);
        Assert.Contains("exists (select 1 from selected_zones z where z.id = a.zone_id)", dashboard);

        var telegram = Api(Path.Combine("Services", "Notifications", "TelegramNotificationService.cs"));
        var broadcast = telegram[telegram.IndexOf(
            "private async Task BroadcastToFarmAsync", StringComparison.Ordinal)..];
        broadcast = broadcast[..broadcast.IndexOf("private sealed record ZoneContext", StringComparison.Ordinal)];

        // DISTINCT prevents a farm owner who is also listed as a member from receiving
        // the same message twice; the loop sends to every resolved chat, not just the first.
        Assert.Contains("select distinct p.telegram_chat_id", broadcast);
        Assert.Contains("f.owner_id = p.id", broadcast);
        Assert.Contains("fm.farm_id = $1 and fm.profile_id = p.id", broadcast);
        // Each chat also carries its farmer's language (Part B), but every one is still sent to.
        Assert.Contains("foreach (var (chatId, lang) in chatIds)", broadcast);
        Assert.Contains("SendMessageAsync(chatId", broadcast);
    }

    // ---- concurrency --------------------------------------------------------

    [Fact]
    public void Two_kits_racing_for_the_last_MQTT_login_cannot_both_get_it()
    {
        // `for update skip locked` in one transaction: the second claimant skips
        // the row the first has locked and falls back to the shared login.
        var src = Api(Path.Combine("Services", "MqttCredentialPoolService.cs"));
        Assert.Contains("for update skip locked limit 1", src);
        Assert.Contains("NpgsqlTransaction transaction", src);   // inside the claim's transaction
    }

    [Fact]
    public void The_report_queue_never_hands_one_request_to_two_workers()
    {
        Assert.Contains("for update skip locked", Api(Path.Combine("Services", "ReportGenerationService.cs")));
    }

    [Fact]
    public void A_Telegram_message_for_one_request_and_status_is_sent_once()
    {
        // The ledger's insert claims (request, stage, audience) once; a second
        // send of the same finds it taken.
        var ledger = Api(Path.Combine("Services", "Notifications", "NotificationLedger.cs"));
        Assert.Matches(new Regex("on conflict[^;]*do nothing", RegexOptions.IgnoreCase), ledger);
    }

    [Fact]
    public void Two_admins_saving_a_request_status_at_once_serialise()
    {
        Assert.Contains("for update", Api(Path.Combine("Endpoints", "AdminRequestEndpoints.cs")));
    }

    [Fact]
    public void A_logged_call_reads_the_enquiry_under_a_lock_in_its_transaction()
    {
        var src = Api(Path.Combine("Endpoints", "EnquiryAdminEndpoints.cs"));
        Assert.Contains("for update", src);
        Assert.Contains("BeginTransactionAsync", src);
    }

    // ---- the audit log is append-only --------------------------------------

    [Fact]
    public void Nothing_in_the_API_updates_or_deletes_audit_rows()
    {
        foreach (var file in Directory.GetFiles(Path.Combine(Root(), "backend", "AgroFlow.Api"), "*.cs", SearchOption.AllDirectories)
                     .Where(f => !f.Contains($"{Path.DirectorySeparatorChar}bin{Path.DirectorySeparatorChar}") && !f.Contains($"{Path.DirectorySeparatorChar}obj{Path.DirectorySeparatorChar}")))
        {
            var src = File.ReadAllText(file);
            Assert.DoesNotMatch(new Regex(@"(update|delete\s+from)\s+admin_audit_log", RegexOptions.IgnoreCase), src);
        }

        var migration = File.ReadAllText(Path.Combine(Root(), "supabase", "migrations", "0037_admin_audit_log.sql"));
        Assert.DoesNotMatch(new Regex(@"create policy\s+\w+\s+on admin_audit_log\s+for (update|delete|all|insert)", RegexOptions.IgnoreCase), migration);
    }
}
