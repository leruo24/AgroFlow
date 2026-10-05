using System.Security.Claims;
using System.Text.Json;
using Npgsql;
using NpgsqlTypes;

namespace AgroFlow.Api.Services;

/// The verbs. One place, because the Activity page filters on them and a
/// typo'd string would simply never appear in a filter - a silent gap in a
/// record whose whole value is being complete.
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

    public const string ZoneUpdated = "zone.updated";
    public const string ZoneAdviceRun = "zone.advice_run";

    public const string EnrollmentCodeCreated = "enrollment_code.created";
    public const string MqttPoolAdded = "mqtt_pool.added";
    public const string ReportScheduleChanged = "report_schedule.changed";
    public const string TelegramCodeIssued = "telegram.code_issued";
}

/// Writes the append-only record of what administrators do (migration 0037).
///
/// WHY EVERY METHOD SWALLOWS ITS OWN FAILURES
/// An audit write must never be the reason an admin action fails. If the
/// table is missing because 0037 has not been applied yet, revoking a stolen
/// kit still has to work - the alternative is an admin who cannot act during
/// the one incident the log exists to record.
///
/// That is a deliberate trade: completeness of the log is sacrificed to
/// availability of the action, and a dropped row is logged loudly at Error so
/// it is visible rather than silent.
public sealed class AuditLog
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

    /// The actor, from the JWT only.
    ///
    /// Deliberately never a parameter a caller could pass: an endpoint that
    /// took the actor from its request body would let anyone with an admin
    /// token write somebody else's name into the permanent record.
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

            // The name is resolved here and stored flat, so the log stays
            // readable after a profile is renamed or deleted. "Who did this"
            // is a fact about the moment, not a live lookup.
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
            // Loud, and WITH THE REASON. The first version logged that the
            // write had failed but not why, which is the difference between
            // "migration 0037 was never applied" and "the API's role may not
            // insert" - two problems with completely different fixes that
            // produce exactly the same symptom: every admin action succeeds
            // and the Activity page stays empty.
            //
            // Not fatal, deliberately: the action it describes has already
            // happened and must not be rolled back for bookkeeping. Revoking
            // a stolen kit has to work during the one incident the log exists
            // to record.
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
