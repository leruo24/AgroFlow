using System.Security.Claims;
using System.Text.Json;
using Npgsql;
using NpgsqlTypes;

namespace AgroFlow.Api.Services;

/// The action names in one place, because the Activity page filters on them and a
/// typo would leave a silent gap in the log.
public static class AuditActions
{
    public const string RequestStatusChanged = "request.status_changed";
    public const string RequestAssigned = "request.assigned";

    public const string AlertAssigned = "alert.assigned";
    public const string AlertResolved = "alert.resolved";
    public const string AlertNoteAdded = "alert.note_added";
    public const string AlertEscalated = "alert.escalated";

    public const string DeviceRevoked = "device.revoked";
    public const string DeviceChangeWifi = "device.change_wifi";
    public const string DeviceOpenSetup = "device.open_setup";

    public const string FarmCreated = "farm.created";
    public const string FarmArchived = "farm.archived";
    public const string FarmRestored = "farm.restored";
    public const string FarmDeleted = "farm.deleted";

    public const string UserCreated = "user.created";
    public const string UserInvited = "user.invited";
    public const string UserDeleted = "user.deleted";
    public const string UserPasswordReset = "user.password_reset";
    // The farmer reset their own password with a code from the Telegram bot.
    public const string UserPasswordResetSelf = "user.password_reset_self";
    // A staff account had Telegram linked and was unlinked: Telegram is for farmers only.
    public const string TelegramStaffUnlinked = "telegram.staff_unlinked";

    public const string ZoneUpdated = "zone.updated";
    // Staff changed a zone's maximum run time (migration 0052).
    public const string ZoneMaxRunChanged = "zone.max_run_changed";
    // Drought mode and community alerts (migrations 0054-0055).
    public const string DroughtModeChanged = "farm.drought_mode_changed";
    public const string SettingChanged = "settings.changed";
    public const string CommunityReportHidden = "community.report_hidden";
    public const string FarmLocationChanged = "farm.location_changed";
    public const string StaffNoticeResolved = "staff_notice.resolved";
    public const string ZoneAdviceRun = "zone.advice_run";

    // A farmer (or admin) changed a zone's crop or planting date.
    // details: from, to, fromLabel, toLabel, fromPlanting, toPlanting, actorRole.
    public const string ZoneCropChanged = "zone.crop_changed";

    // Zones added to an existing farm (a "new zone" request).
    public const string ZonesAdded = "farm.zones_added";

    public const string EnrollmentCodeCreated = "enrollment_code.created";
    public const string MqttPoolAdded = "mqtt_pool.added";
    public const string ReportScheduleChanged = "report_schedule.changed";
    public const string TelegramCodeIssued = "telegram.code_issued";
    public const string TelegramUnlinked = "telegram.unlinked";
}

/// Writes the append-only record of admin actions (migration 0037).
/// Every method catches its own failures: an audit write must never stop an admin
/// action (e.g. revoking a stolen kit before 0037 is applied). A dropped row is
/// logged at Error so it is visible.
public sealed class AuditLog : IAuditWriter
{
    private readonly NpgsqlDataSource _dataSource;
    private readonly ILogger<AuditLog> _logger;

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    };

    public AuditLog(NpgsqlDataSource dataSource, ILogger<AuditLog> logger)
    {
        _dataSource = dataSource;
        _logger = logger;
    }

    /// Security: the actor comes from the JWT only, never from a parameter, so nobody
    /// can write someone else's name into the record.
    public async Task WriteAsync(
        ClaimsPrincipal user,
        string action,
        string entityType,
        string? entityId = null,
        long? farmId = null,
        object? details = null,
        CancellationToken cancellationToken = default)
    {
        Guid? actorId = Guid.TryParse(user.FindFirstValue("sub"), out var id) ? id : null;

        await WriteAsync(actorId, action, entityType, entityId, farmId, details, cancellationToken);
    }

    public async Task WriteAsync(
        Guid? actorProfileId,
        string action,
        string entityType,
        string? entityId = null,
        long? farmId = null,
        object? details = null,
        CancellationToken cancellationToken = default)
    {
        try
        {
            await using var connection = await _dataSource.OpenConnectionAsync(cancellationToken);

            // The name is stored as text so the log stays readable after a profile is renamed
            // or deleted.
            var actorName = await ResolveActorNameAsync(connection, actorProfileId, cancellationToken);

            await using var cmd = new NpgsqlCommand(
                """
                insert into admin_audit_log
                    (actor_profile_id, actor_name, action, entity_type, entity_id, farm_id, details)
                values ($1, $2, $3, $4, $5, $6, $7)
                """,
                connection);

            cmd.Parameters.AddWithValue(NpgsqlDbType.Uuid, (object?)actorProfileId ?? DBNull.Value);
            cmd.Parameters.AddWithValue(actorName);
            cmd.Parameters.AddWithValue(action);
            cmd.Parameters.AddWithValue(entityType);
            cmd.Parameters.AddWithValue(NpgsqlDbType.Text, (object?)entityId ?? DBNull.Value);
            cmd.Parameters.AddWithValue(NpgsqlDbType.Bigint, (object?)farmId ?? DBNull.Value);
            cmd.Parameters.AddWithValue(
                NpgsqlDbType.Jsonb,
                details is null ? "{}" : JsonSerializer.Serialize(details, JsonOptions));

            await cmd.ExecuteNonQueryAsync(cancellationToken);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // Log the failure with its reason, because "0037 not applied" and "the API role may
            // not insert" look the same (an empty Activity page) but need different fixes.
            // Not fatal: the action has already happened and must not be rolled back.
            var diagnosis = ex is PostgresException pg
                ? pg.SqlState switch
                {
                    "42P01" => "admin_audit_log does not exist - migration 0037 has not been applied.",
                    "42703" => "A column is missing - migration 0037 may have been applied partially.",
                    "42501" => "This database role is not permitted to INSERT into admin_audit_log. " +
                               "Apply migration 0038, which grants it.",
                    _ => $"Postgres reported {pg.SqlState}: {pg.MessageText}",
                }
                : $"Not a database error: {ex.GetType().Name}.";

            _logger.LogError(ex,
                "Could not write the audit row for {Action} on {EntityType} {EntityId}. " +
                "The action itself succeeded, but it has NOT been recorded. {Diagnosis} " +
                "GET /api/admin/health reports the same thing under \"Database schema\".",
                action, entityType, entityId, diagnosis);
        }
    }

    private static async Task<string> ResolveActorNameAsync(
        NpgsqlConnection connection, Guid? actorProfileId, CancellationToken ct)
    {
        if (actorProfileId is null) return "Unknown";

        await using var cmd = new NpgsqlCommand(
            "select coalesce(nullif(name, ''), email, 'Unknown') from profile where id = $1",
            connection);
        cmd.Parameters.AddWithValue(actorProfileId.Value);

        return await cmd.ExecuteScalarAsync(ct) as string ?? "Unknown";
    }
}
