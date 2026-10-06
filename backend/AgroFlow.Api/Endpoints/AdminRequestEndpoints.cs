using System.Security.Claims;
using AgroFlow.Api.Auth;
using AgroFlow.Api.Services;
using AgroFlow.Api.Services.Notifications;
using AgroFlow.Business;
using Npgsql;

namespace AgroFlow.Api.Endpoints;

public record UpdateRequestStatusRequest(string Status);

public record AssignRequestBody(Guid? AssignedToProfileId);

public record UpdateRequestStatusResponse(long Id, string Status, string? Message);

// Admin-side status changes on a farm/zone request, so that moving one along
// also tells the farmer.
//
// WHY THIS ENDPOINT HAS TO EXIST
// ------------------------------
// The admin dashboard changed service_request.status by writing to Supabase
// DIRECTLY (api.ts's updateServiceRequestStatus), with no server involvement
// at all. That works - the admin's JWT satisfies service_request_all_admin
// from 0021 - but it means nothing server-side ever learns the status
// changed, so there is no point at which a Telegram message could be sent.
// The farmer's "your hardware kit is booked" could not be hooked onto the
// direct write without putting the bot token in the browser.
//
// So the write moves here, and the dashboard calls this instead. The RLS
// policy and the direct route both stay in place - this is additive, and an
// older build of the dashboard keeps working (silently, without the
// messages).
public static class AdminRequestEndpoints
{
    public static void MapAdminRequestEndpoints(this WebApplication app)
    {
        var admin = app.MapGroup("/api/admin/requests")
            .RequireAuthorization()
            .AddEndpointFilter<AdminOnlyFilter>();

        admin.MapPut("/{requestId:long}/status", UpdateStatusAsync);

        // Who owns this request. Separate from status on purpose:
        // somebody picks a request up before it is scheduled, and
        // "assigned to" is the answer to "who is dealing with this?"
        admin.MapPut("/{requestId:long}/assign", AssignAsync);
    }

    /* Stamps the "by" and "at" columns for the step a request just moved to.
     *
     * Separate from the status UPDATE rather than folded into it because the
     * columns differ per status, and a single UPDATE with five CASE
     * expressions is the kind of SQL nobody can read six months later.
     *
     * Only ever SETS. Moving a request back to pending does not clear
     * scheduled_by - it genuinely was scheduled by that person, and erasing
     * that is the opposite of what an accountability chain is for. */
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

    /* Who is dealing with this request.
     *
     * Deliberately independent of status: somebody picks a request up before
     * it is scheduled, and an unassigned-but-scheduled request is a real and
     * useful state ("booked, nobody owns it yet"). Passing null un-assigns. */
    private static async Task<IResult> AssignAsync(
        long requestId,
        AssignRequestBody body,
        ClaimsPrincipal user,
        NpgsqlDataSource dataSource,
        AuditLog audit,
        CancellationToken cancellationToken)
    {
        // Item 5: nobody can put work in somebody else's name. This route
        // stays for older consoles, but it only accepts the caller's own id
        // (or null, to let go). The caller comes from the login, never the body.
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

        // The same three values 0021's CHECK allows. Validated here so a typo
        // comes back as a 400 naming the options rather than as a constraint
        // violation.
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
            // Returns the OLD status, which is what makes the "nothing
            // actually changed" case distinguishable below.
            //
            // It has to come from a CTE: a subquery in RETURNING against the
            // same table would read the row the UPDATE has just written and
            // hand back the NEW value, making every save look like a change.
            // The `for update` in the CTE locks the row first, so two admins
            // saving at once serialise rather than both reading the same old
            // status and both sending.
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

        // Committed before anything is sent. A message about a status change
        // that then rolled back cannot be retracted.
        //
        // A no-op re-save sends nothing new anyway, because the ledger in
        // 0032 has already claimed this (request, stage, audience) - this
        // check just avoids the round trip.
        if (!string.Equals(previousStatus, status, StringComparison.OrdinalIgnoreCase))
        {
            // The "by" and "at" columns for this step (0037). Which one is
            // set depends on where the request moved TO, so the timeline can
            // say "Scheduled by Leruo on Tuesday" rather than only showing a
            // status word.
            await StampWhoAndWhenAsync(dataSource, requestId, status, user, cancellationToken);

            await audit.WriteAsync(
                user,
                AuditActions.RequestStatusChanged,
                "service_request",
                requestId.ToString(),
                details: new { from = previousStatus, to = status },
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
