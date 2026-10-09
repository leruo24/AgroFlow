using System.Security.Claims;
using AgroFlow.Api.Auth;
using AgroFlow.Api.Services;
using AgroFlow.Api.Services.Notifications;
using AgroFlow.Business;
using Npgsql;

namespace AgroFlow.Api.Endpoints;

// "Mark complete" can send an optional note; it is optional so consoles that
// only send a status still work.
public record UpdateRequestStatusRequest(string Status, string? Note = null);

public record AssignRequestBody(Guid? AssignedToProfileId);

public record UpdateRequestStatusResponse(long Id, string Status, string? Message);

// Admin status changes on a farm or zone request, so moving one along also
// messages the farmer on Telegram.
// The dashboard calls this instead of writing to Supabase directly, because the
// bot token must stay on the server. The RLS policy (0021) still allows the
// direct write.
public static class AdminRequestEndpoints
{
    public static void MapAdminRequestEndpoints(this WebApplication app)
    {
        var admin = app.MapGroup("/api/admin/requests")
            .RequireAuthorization()
            .AddEndpointFilter<AdminOnlyFilter>();

        admin.MapPut("/{requestId:long}/status", UpdateStatusAsync);

        // Who owns this request, kept separate from status: someone can pick a request
        // up before it is scheduled.
        admin.MapPut("/{requestId:long}/assign", AssignAsync);
    }

    /* Records who moved the request to each step and when.
     * Kept apart from the status UPDATE because the columns differ per status.
     * It only ever sets values: moving back to pending does not clear scheduled_by. */
    private static async Task StampWhoAndWhenAsync(
        NpgsqlDataSource dataSource,
        long requestId,
        string status,
        ClaimsPrincipal user,
        CancellationToken cancellationToken)
    {
        if (!Guid.TryParse(user.FindFirstValue("sub"), out var actorId)) return;

        var sql = status switch
        {
            "scheduled" =>
                "update service_request set scheduled_by_profile_id = $2, scheduled_at = now() where id = $1",
            "completed" =>
                "update service_request set completed_by_profile_id = $2, completed_at = now() where id = $1",
            _ => null,
        };

        if (sql is null) return;

        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);
        await using var cmd = new NpgsqlCommand(sql, connection);
        cmd.Parameters.AddWithValue(requestId);
        cmd.Parameters.AddWithValue(actorId);

        await cmd.ExecuteNonQueryAsync(cancellationToken);
    }

    /* Who is dealing with this request. Independent of status, so "scheduled but
     * nobody owns it yet" is possible. Passing null un-assigns. */
    private static async Task<IResult> AssignAsync(
        long requestId,
        AssignRequestBody body,
        ClaimsPrincipal user,
        NpgsqlDataSource dataSource,
        AuditLog audit,
        CancellationToken cancellationToken)
    {
        // Security: nobody can assign work in someone else's name. This route only
        // accepts the caller's own id (or null to let go), taken from the login, never the body.
        if (!Guid.TryParse(user.FindFirstValue("sub") ?? user.FindFirstValue(ClaimTypes.NameIdentifier), out var caller))
        {
            return Results.Unauthorized();
        }

        if (!HandlingRules.AssignAllowed(body.AssignedToProfileId, caller))
        {
            return Results.Json(
                new { error = "You can only put your own name on a request. Use \"I'll handle this\"." },
                statusCode: StatusCodes.Status403Forbidden);
        }

        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);

        await using var cmd = new NpgsqlCommand(
            """
            update service_request
               set assigned_to_profile_id = $2, updated_at = now()
             where id = $1
            returning (select coalesce(nullif(p.name, ''), p.email) from profile p where p.id = $2)
            """,
            connection);

        cmd.Parameters.AddWithValue(requestId);
        cmd.Parameters.AddWithValue(
            NpgsqlTypes.NpgsqlDbType.Uuid,
            (object?)body.AssignedToProfileId ?? DBNull.Value);

        object? assignedName;
        await using (var reader = await cmd.ExecuteReaderAsync(cancellationToken))
        {
            if (!await reader.ReadAsync(cancellationToken))
            {
                return Results.NotFound(new { error = "No such request." });
            }

            assignedName = reader.IsDBNull(0) ? null : reader.GetString(0);
        }

        await audit.WriteAsync(
            user, AuditActions.RequestAssigned, "service_request", requestId.ToString(),
            details: new { assignedTo = assignedName, assignedToProfileId = body.AssignedToProfileId },
            cancellationToken: cancellationToken);

        return Results.Ok(new
        {
            requestId,
            assignedTo = assignedName,
            message = assignedName is null
                ? "Nobody is assigned to this request."
                : $"Assigned to {assignedName}.",
        });
    }

    private static async Task<IResult> UpdateStatusAsync(
        long requestId,
        UpdateRequestStatusRequest request,
        ClaimsPrincipal user,
        NpgsqlDataSource dataSource,
        FarmRequestNotifier requestNotifier,
        AuditLog audit,
        CancellationToken cancellationToken)
    {
        var status = FarmRequestMessages.Normalise(request.Status);

        // The three values 0021's CHECK allows. Checked here so a typo gets a clear 400
        // instead of a constraint error.
        if (status is not ("pending" or "scheduled" or "completed"))
        {
            return Results.BadRequest(new
            {
                error = "Status must be one of pending, scheduled or completed.",
            });
        }

        string? previousStatus;

        await using (var connection = await dataSource.OpenConnectionAsync(cancellationToken))
        {
            // Returns the old status so we can tell when nothing changed.
            // It needs a CTE: RETURNING would give the new value. `for update` locks the row,
            // so two admins saving at once cannot both send a message.
            await using var command = new NpgsqlCommand(
                """
                with previous as (
                    select id, status from service_request where id = $1 for update
                )
                update service_request s
                   set status = $2, updated_at = now()
                  from previous
                 where s.id = previous.id
                returning previous.status
                """,
                connection);

            command.Parameters.AddWithValue(requestId);
            command.Parameters.AddWithValue(status);

            var result = await command.ExecuteScalarAsync(cancellationToken);

            if (result is null)
            {
                return Results.NotFound(new { error = "No such request." });
            }

            previousStatus = result as string;
        }

        // Committed before anything is sent, so we never message about a change that
        // rolled back. A re-save sends nothing new anyway (the 0032 ledger); this check
        // just saves a round trip.
        if (!string.Equals(previousStatus, status, StringComparison.OrdinalIgnoreCase))
        {
            // Set the "by" and "at" columns for this step (0037), so the timeline can say
            // "Scheduled by Thabo on Tuesday" instead of only a status word.
            await StampWhoAndWhenAsync(dataSource, requestId, status, user, cancellationToken);

            await audit.WriteAsync(
                user,
                AuditActions.RequestStatusChanged,
                "service_request",
                requestId.ToString(),
                details: new { from = previousStatus, to = status, note = string.IsNullOrWhiteSpace(request.Note) ? null : request.Note.Trim() },
                cancellationToken: cancellationToken);

            await requestNotifier.NotifyAsync(requestId, cancellationToken);
        }

        return Results.Ok(new UpdateRequestStatusResponse(
            requestId,
            status,
            FarmRequestMessages.StageFor(status) is null
                ? "Status updated. This status sends no message to the farmer."
                : "Status updated. The farmer has been messaged if they have Telegram connected."));
    }
}
