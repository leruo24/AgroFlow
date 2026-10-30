using System;
using System.IO;
using AgroFlow.Api.Services;
using Xunit;

namespace AgroFlow.Domain.Tests;

// Telegram is for farmers only (docs/features/telegram-farmers-only.md): staff never link it and are
// never messaged there; their notices are on the admin site's Home and bell.
public class StaffTelegramTests
{
    private static string Api(string relative)
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir != null && !Directory.Exists(Path.Combine(dir.FullName, "backend", "AgroFlow.Api"))) dir = dir.Parent;
        return File.ReadAllText(Path.Combine(dir!.FullName, "backend", "AgroFlow.Api", relative));
    }

    [Fact]
    public void Staff_are_admins_and_field_officers()
    {
        Assert.Equal("p.role not in ('admin', 'field_officer')", StaffTelegram.NotStaffSql);
        Assert.Equal("p.role in ('admin', 'field_officer')", StaffTelegram.IsStaffSql);
        Assert.StartsWith("Telegram is for farmers only.", StaffTelegram.RefusedMessage);
    }

    [Fact]
    public void Staff_notices_are_not_sent_on_Telegram()
    {
        var src = Api(Path.Combine("Notifications", "TelegramNotificationService.cs"));
        // The two staff notices (new enquiry or call-back, new farm request) only log now.
        Assert.Contains("public Task NotifyAdminsAsync(string message, CancellationToken cancellationToken)\n    {\n        _logger.LogInformation(\"Staff notice shown in the admin site",
            src.Replace("\r\n", "\n"));
        Assert.Contains("public Task NotifyAdminsOfFarmRequestAsync(", src);
        // Farm-wide messages (kit offline, weather, sensor alerts) leave staff out.
        Assert.Contains(".Replace(\"{notStaff}\", StaffTelegram.NotStaffSql)", src);
        Assert.Contains("and {notStaff}", src);
    }

    [Fact]
    public void Reports_go_to_the_farmer_only()
    {
        var src = Api("DataManagement/ReportGenerationService.cs");
        Assert.Contains("var (toHandler, toAdminChat, handler) = (false, false, (Guid?)null);", src);
        Assert.Contains("p.telegram_chat_id is not null and {StaffTelegram.NotStaffSql}", src);
    }

    [Fact]
    public void A_link_code_never_links_a_staff_account_and_staff_cannot_get_one()
    {
        var redeem = Api(Path.Combine("Notifications", "TelegramOnboardingService.cs"));
        Assert.Contains("if (await StaffTelegram.IsStaffAsync(connection, profileId, cancellationToken, transaction))", redeem);
        Assert.Contains("throw new StaffTelegramRefusedException();", redeem);
        var bot = Api(Path.Combine("Notifications", "TelegramPollingService.cs"));
        Assert.Contains("catch (StaffTelegramRefusedException)", bot);
        var routes = Api(Path.Combine("Endpoints", "TelegramEndpoints.cs"));
        Assert.Equal(3, routes.Split("StaffTelegram.IsStaffAsync(roleConnection").Length - 1);   // two admin routes, and /me
    }

    [Fact]
    public void Already_linked_staff_are_unlinked_at_start_up_and_each_is_audited()
    {
        var src = Api("Notifications/StaffTelegram.cs");
        Assert.Contains("update profile p set telegram_chat_id = null where {StaffTelegram.IsStaffSql} and p.telegram_chat_id is not null", src);
        Assert.Contains("AuditActions.TelegramStaffUnlinked", src);
        Assert.Contains("AddHostedService(sp => sp.GetRequiredService<StaffTelegramCleanupService>())", Api("Program.cs"));
    }
}
