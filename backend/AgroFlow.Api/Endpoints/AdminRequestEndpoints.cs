using AgroFlow.Api.Auth;
using AgroFlow.Api.Services.Notifications;
using AgroFlow.Business;
using Npgsql;

namespace AgroFlow.Api.Endpoints;

public record UpdateRequestStatusRequest(string Status);

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
    }

    private static async Task<IResult> UpdateStatusAsync(
        long requestId,
        UpdateRequestStatusRequest request,
        NpgsqlDataSource dataSource,
        FarmRequestNotifier requestNotifier,
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
