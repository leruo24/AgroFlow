using AgroFlow.Api.Auth;
using AgroFlow.Api.Services;
using Npgsql;
using NpgsqlTypes;

namespace AgroFlow.Api.Endpoints;

public record AuditRow(
    long Id,
    string CreatedAt,
    string ActorName,
    string Action,
    /// The row as one readable sentence - "Leruo scheduled Johnny's new-zone
    /// request" - built on the server so the console, a CSV export and a
    /// future email all say the same thing.
    string Summary,
    string EntityType,
    string? EntityId,
    long? FarmId,
    string? FarmName,
    string Details);

public record AuditFilterOption(string Value, string Label);

public record AuditLogResponse(
    IReadOnlyList<AuditRow> Rows,
    int Total,
    IReadOnlyList<AuditFilterOption> Actions,
    IReadOnlyList<AuditFilterOption> Actors);

// GET /api/admin/activity — the Platform Activity page.
//
// The page it replaces said there was nowhere to read administrator actions
// from, which was true. This reads migration 0037's append-only log.
public static class AuditLogEndpoints
{
    private const int MaxRows = 500;

    public static void MapAuditLogEndpoints(this WebApplication app)
    {
        var admin = app.MapGroup("/api/admin/activity")
            .RequireAuthorization()
            .AddEndpointFilter<AdminOnlyFilter>();

        admin.MapGet("/", ListAsync);

        // Everything that ever happened to one thing - the per-item
        // timelines on a request, an alert or a kit.
        admin.MapGet("/{entityType}/{entityId}", TimelineAsync);
    }

    private static async Task<IResult> ListAsync(
        NpgsqlDataSource dataSource,
        ILoggerFactory loggerFactory,
        string? action,
        string? actor,
        long? farmId,
        DateOnly? from,
        DateOnly? to,
        CancellationToken cancellationToken)
    {
        try
        {
            await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);

            var rows = await QueryAsync(
                connection,
                """
                select a.id, a.created_at, a.actor_name, a.action, a.entity_type,
                       a.entity_id, a.farm_id, f.name, a.details
                  from admin_audit_log a
                  left join farm f on f.farm_id = a.farm_id
                 where ($1::text is null or a.action = $1)
                   and ($2::uuid is null or a.actor_profile_id = $2)
                   and ($3::bigint is null or a.farm_id = $3)
                   and ($4::date is null or a.created_at >= $4)
                   and ($5::date is null or a.created_at < ($5::date + 1))
                 order by a.created_at desc
                 limit $6
                """,
                cmd =>
                {
                    cmd.Parameters.AddWithValue(NpgsqlDbType.Text, (object?)action ?? DBNull.Value);
                    cmd.Parameters.AddWithValue(
                        NpgsqlDbType.Uuid,
                        Guid.TryParse(actor, out var actorId) ? actorId : DBNull.Value);
                    cmd.Parameters.AddWithValue(NpgsqlDbType.Bigint, (object?)farmId ?? DBNull.Value);
                    cmd.Parameters.AddWithValue(NpgsqlDbType.Date, (object?)from ?? DBNull.Value);
                    cmd.Parameters.AddWithValue(NpgsqlDbType.Date, (object?)to ?? DBNull.Value);
                    cmd.Parameters.AddWithValue(MaxRows);
                },
                cancellationToken);

            // The filter options come from what is actually IN the log, not
            // from the full list of verbs - a filter offering twenty actions
            // that have never happened is noise.
            var actions = await DistinctAsync(
                connection,
                "select distinct action from admin_audit_log order by action",
                cancellationToken);

            var actors = await QueryActorsAsync(connection, cancellationToken);

            return Results.Ok(new AuditLogResponse(rows, rows.Count, actions, actors));
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // An empty log rather than an error page: until 0037 is applied
            // there genuinely is nothing recorded, and the page says so.
            loggerFactory
                .CreateLogger("AgroFlow.Api.Activity")
                .LogError(ex, "Could not read the audit log. Is migration 0037 applied?");

            return Results.Ok(new AuditLogResponse(
                Array.Empty<AuditRow>(), 0,
                Array.Empty<AuditFilterOption>(), Array.Empty<AuditFilterOption>()));
        }
    }

    private static async Task<IResult> TimelineAsync(
        string entityType,
        string entityId,
        NpgsqlDataSource dataSource,
        ILoggerFactory loggerFactory,
        CancellationToken cancellationToken)
    {
        try
        {
            await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);

            // Oldest first: a timeline is read top to bottom in the order it
            // happened, which is the opposite of the activity list.
            var rows = await QueryAsync(
                connection,
                """
                select a.id, a.created_at, a.actor_name, a.action, a.entity_type,
                       a.entity_id, a.farm_id, f.name, a.details
                  from admin_audit_log a
                  left join farm f on f.farm_id = a.farm_id
                 where a.entity_type = $1 and a.entity_id = $2
                 order by a.created_at
                """,
                cmd =>
                {
                    cmd.Parameters.AddWithValue(entityType);
                    cmd.Parameters.AddWithValue(entityId);
                },
                cancellationToken);

            return Results.Ok(rows);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            loggerFactory
                .CreateLogger("AgroFlow.Api.Activity")
                .LogError(ex, "Could not read the timeline for {Type} {Id}.", entityType, entityId);

            return Results.Ok(Array.Empty<AuditRow>());
        }
    }

    // ------------------------------------------------------------------

    private static async Task<List<AuditRow>> QueryAsync(
        NpgsqlConnection connection,
        string sql,
        Action<NpgsqlCommand> bind,
        CancellationToken ct)
    {
        var rows = new List<AuditRow>();

        await using var cmd = new NpgsqlCommand(sql, connection);
        bind(cmd);

        await using var reader = await cmd.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct))
        {
            var actorName = reader.GetString(2);
            var action = reader.GetString(3);
            var entityType = reader.GetString(4);
            var entityId = reader.IsDBNull(5) ? null : reader.GetString(5);
            var farmName = reader.IsDBNull(7) ? null : reader.GetString(7);
            var details = reader.IsDBNull(8) ? "{}" : reader.GetString(8);

            rows.Add(new AuditRow(
                reader.GetInt64(0),
                reader.GetFieldValue<DateTimeOffset>(1).ToString("o"),
                actorName,
                action,
                Summarise(actorName, action, entityType, entityId, farmName, details),
                entityType,
                entityId,
                reader.IsDBNull(6) ? null : reader.GetInt64(6),
                farmName,
                details));
        }

        return rows;
    }

    private static async Task<List<AuditFilterOption>> DistinctAsync(
        NpgsqlConnection connection, string sql, CancellationToken ct)
    {
        var options = new List<AuditFilterOption>();

        await using var cmd = new NpgsqlCommand(sql, connection);
        await using var reader = await cmd.ExecuteReaderAsync(ct);

        while (await reader.ReadAsync(ct))
        {
            var value = reader.GetString(0);
            options.Add(new AuditFilterOption(value, Humanise(value)));
        }

        return options;
    }

    private static async Task<List<AuditFilterOption>> QueryActorsAsync(
        NpgsqlConnection connection, CancellationToken ct)
    {
        var options = new List<AuditFilterOption>();

        await using var cmd = new NpgsqlCommand(
            """
            select distinct on (actor_profile_id) actor_profile_id, actor_name
              from admin_audit_log
             where actor_profile_id is not null
             order by actor_profile_id, created_at desc
            """,
            connection);

        await using var reader = await cmd.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct))
        {
            options.Add(new AuditFilterOption(reader.GetGuid(0).ToString(), reader.GetString(1)));
        }

        return options;
    }

    /// "request.status_changed" -> "Request status changed". For the filter
    /// dropdown, where a dotted verb reads like a log line rather than a
    /// choice.
    private static string Humanise(string action)
    {
        var words = action.Replace('.', ' ').Replace('_', ' ');
        return words.Length == 0 ? action : char.ToUpperInvariant(words[0]) + words[1..];
    }

    /// One readable sentence per row.
    ///
    /// Built here rather than in the console so that the page, the CSV export
    /// and anything added later all describe an action the same way - the
    /// alternative is three slightly different vocabularies for one log.
    // Item 6b: "Crop changed from Citrus to Potato by Thandi" - the farmer's
    // own words for it, so an officer reading the farm's activity knows why
    // the advice changed.
    private static string CropChanged(string actor, string? details, string? farmName)
    {
        string? from = null, to = null, planted = null;
        try
        {
            using var doc = System.Text.Json.JsonDocument.Parse(string.IsNullOrWhiteSpace(details) ? "{}" : details);
            var root = doc.RootElement;
            string? Get(string name) =>
                root.TryGetProperty(name, out var v) && v.ValueKind == System.Text.Json.JsonValueKind.String ? v.GetString() : null;
            from = Get("fromLabel") ?? Get("from");
            to = Get("toLabel") ?? Get("to");
            planted = Get("toPlanting");
        }
        catch (System.Text.Json.JsonException)
        {
            // Unreadable details still give a sentence.
        }

        var where = farmName is null ? "" : $" at {farmName}";
        if (from != null && to != null && from != to) return $"Crop changed from {from} to {to} by {actor}{where}";
        if (to != null && from == null) return $"Crop set to {to} by {actor}{where}";
        if (planted != null) return $"Planting date changed to {planted} by {actor}{where}";
        return $"Crop or planting date changed by {actor}{where}";
    }

    private static string Thing(string entityType) => entityType switch
    {
        "service_request" => "request",
        "maintenance" => "maintenance job",
        _ => entityType,
    };

    internal static string Summarise(
        string actor, string action, string entityType, string? entityId, string? farmName, string? details = null)
    {
        if (action == AuditActions.ZoneCropChanged) return CropChanged(actor, details, farmName);

        var where = farmName is null ? "" : $" at {farmName}";
        var what = entityId is null ? entityType : $"{entityType} {entityId}";

        return action switch
        {
            AuditActions.RequestStatusChanged => $"{actor} changed request {entityId}{where}",
            AuditActions.RequestAssigned => $"{actor} assigned request {entityId}{where}",

            AuditActions.AlertAssigned => $"{actor} assigned alert {entityId}{where}",
            AuditActions.AlertResolved => $"{actor} resolved alert {entityId}{where}",
            AuditActions.AlertEscalated => $"{actor} escalated alert {entityId}{where}",
            AuditActions.AlertNoteAdded => $"{actor} added a note to alert {entityId}{where}",

            AuditActions.DeviceRevoked => $"{actor} revoked kit {entityId}{where}",
            AuditActions.DeviceChangeWifi => $"{actor} asked the kit on zone {entityId} to change WiFi",
            AuditActions.DeviceOpenSetup => $"{actor} opened the setup page on zone {entityId}",

            AuditActions.FarmCreated => $"{actor} created farm {farmName ?? entityId}",
            AuditActions.FarmArchived => $"{actor} archived farm {farmName ?? entityId}",
            AuditActions.FarmRestored => $"{actor} restored farm {farmName ?? entityId}",
            AuditActions.FarmDeleted => $"{actor} deleted farm {farmName ?? entityId}",

            AuditActions.UserCreated => $"{actor} created a farmer account",
            AuditActions.UserInvited => $"{actor} invited a farmer",
            AuditActions.UserDeleted => $"{actor} deleted a farmer account",
            AuditActions.UserPasswordReset => $"{actor} reset a farmer's password",

            AuditActions.ZoneUpdated => $"{actor} updated zone {entityId}{where}",
            AuditActions.ZonesAdded => $"{actor} added zones to farm {farmName ?? entityId}",
            AuditActions.ZoneAdviceRun => $"{actor} ran the advice engine on zone {entityId}{where}",

            AuditActions.EnrollmentCodeCreated => $"{actor} created an enrollment code{where}",
            AuditActions.MqttPoolAdded => $"{actor} added MQTT logins to the pool",
            AuditActions.ReportScheduleChanged => $"{actor} changed automatic reports{where}",
            AuditActions.TelegramCodeIssued => $"{actor} issued a Telegram link code",

            // Item 5: handling and the actions that close an item.
            "handling.claimed" => $"{actor} took on {Thing(entityType)} {entityId}{where}",
            "handling.taken_over" => $"{actor} took over {Thing(entityType)} {entityId}{where}",
            "handling.released" => $"{actor} let go of {Thing(entityType)} {entityId}{where}",
            "alert.closed" => $"{actor} closed alert {entityId}{where}",
            "alert.reopened" => $"{actor} reopened alert {entityId}{where}",
            "maintenance.created" => $"{actor} booked maintenance job {entityId}{where}",
            "maintenance.scheduled" => $"{actor} scheduled maintenance job {entityId}{where}",
            "maintenance.completed" => $"{actor} completed maintenance job {entityId}{where}",
            "maintenance.note_added" => $"{actor} added a note to maintenance job {entityId}{where}",
            "service_request.note_added" => $"{actor} added a note to request {entityId}{where}",

            // An action added later still reads as a sentence rather than
            // vanishing from the page.
            _ => $"{actor} — {Humanise(action).ToLowerInvariant()} ({what})",
        };
    }
}
