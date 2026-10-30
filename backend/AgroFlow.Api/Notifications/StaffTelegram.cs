using AgroFlow.Api.Auth;
using Npgsql;

namespace AgroFlow.Api.Services;

// Telegram is for farmers only (docs/features/telegram-farmers-only.md). AgroFlow staff (admin,
// field_officer) never link Telegram and are never messaged there: every notice for staff is
// on the admin site's Home "needs attention" list and its notification bell. Farmers keep
// Telegram onboarding, alerts, reports and Forgot password.
public static class StaffTelegram
{
    public const string RefusedMessage =
        "Telegram is for farmers only. AgroFlow staff get every notice in the admin site, on Home and under the bell.";

    // "this profile row (alias p) is not staff", for recipient queries.
    public static readonly string NotStaffSql =
        "p.role not in (" + string.Join(", ", StaffRoles.All.Select(r => $"'{r}'")) + ")";

    public static readonly string IsStaffSql =
        "p.role in (" + string.Join(", ", StaffRoles.All.Select(r => $"'{r}'")) + ")";

    public static async Task<bool> IsStaffAsync(
        NpgsqlConnection connection, Guid profileId, CancellationToken ct, NpgsqlTransaction? transaction = null)
    {
        await using var cmd = new NpgsqlCommand("select role from profile where id = $1", connection, transaction);
        cmd.Parameters.AddWithValue(profileId);
        return StaffRoles.IsStaff(await cmd.ExecuteScalarAsync(ct) as string);
    }
}

// Thrown when a link code would attach Telegram to a staff account. The bot answers with
// StaffTelegram.RefusedMessage and nothing is linked.
public sealed class StaffTelegramRefusedException : Exception
{
    public StaffTelegramRefusedException() : base(StaffTelegram.RefusedMessage) { }
}

// Runs once at start-up: any staff account that still has a Telegram chat is unlinked, and
// each one is written to the audit log (Platform Activity, "telegram.staff_unlinked", with the
// name and email), so the team can see exactly who was unlinked. Idempotent: the second run
// finds nobody.
public sealed class StaffTelegramCleanupService : BackgroundService
{
    private readonly NpgsqlDataSource _dataSource;
    private readonly AuditLog _audit;
    private readonly ILogger<StaffTelegramCleanupService> _logger;

    public StaffTelegramCleanupService(NpgsqlDataSource dataSource, AuditLog audit, ILogger<StaffTelegramCleanupService> logger)
    {
        _dataSource = dataSource;
        _audit = audit;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        try
        {
            var unlinked = await UnlinkStaffAsync(stoppingToken);
            if (unlinked.Count > 0)
                _logger.LogWarning("Unlinked Telegram from {Count} staff account(s): {Who}. Telegram is for farmers only.",
                    unlinked.Count, string.Join(", ", unlinked.Select(u => $"{u.Name} <{u.Email}>")));
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // Never fatal: the recipient queries leave staff out anyway.
            _logger.LogWarning(ex, "Could not check for staff accounts with Telegram linked.");
        }
    }

    public async Task<IReadOnlyList<(Guid Id, string Name, string Email)>> UnlinkStaffAsync(CancellationToken ct)
    {
        var list = new List<(Guid, string, string)>();
        await using (var connection = await _dataSource.OpenConnectionAsync(ct))
        await using (var cmd = new NpgsqlCommand(
            $"update profile p set telegram_chat_id = null where {StaffTelegram.IsStaffSql} and p.telegram_chat_id is not null " +
            "returning p.id, coalesce(p.name, ''), coalesce(p.email, '')", connection))
        await using (var reader = await cmd.ExecuteReaderAsync(ct))
        {
            while (await reader.ReadAsync(ct)) list.Add((reader.GetGuid(0), reader.GetString(1), reader.GetString(2)));
        }

        foreach (var (id, name, email) in list)
        {
            await _audit.WriteAsync((Guid?)null, AuditActions.TelegramStaffUnlinked, "profile", id.ToString(), null,
                new { name, email, reason = "Telegram is for farmers only" }, ct);
        }
        return list;
    }
}
