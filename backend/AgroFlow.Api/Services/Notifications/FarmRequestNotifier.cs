using AgroFlow.Business;
using Npgsql;

namespace AgroFlow.Api.Services.Notifications;

// Sends the three farm/zone request messages, exactly once each.
//
// WHY A SERVICE AND NOT A COUPLE OF CALLS AT THE CALL SITES
// ---------------------------------------------------------
// There are two call sites - the farmer submitting a request, and an admin
// moving it along - and both have the same three obligations:
//
//   1. Claim first, send second. The claim is what makes it send once.
//   2. Never block, never fail the operation. A Telegram outage must not
//      roll back a submitted request. This is the mistake the removed Resend
//      email service made: a failed send threw inside onboarding's try block,
//      so an email outage rolled back a completed on-site onboarding.
//   3. Send AFTER the database write has committed, never inside the
//      transaction - a message about a request that then rolls back is a lie
//      that cannot be retracted.
//
// Keeping all three in one place is what stops the second call site getting
// two of them right.
public sealed class FarmRequestNotifier
{
    private readonly NpgsqlDataSource _dataSource;
    private readonly INotificationService _notifications;
    private readonly ILogger<FarmRequestNotifier> _logger;

    public FarmRequestNotifier(
        NpgsqlDataSource dataSource,
        INotificationService notifications,
        ILogger<FarmRequestNotifier> logger)
    {
        _dataSource = dataSource;
        _notifications = notifications;
        _logger = logger;
    }

    // Everything a message needs, read back in one query so neither call site
    // has to assemble it. Location falls back to the farm's own location for
    // a new_zone request, which carries none of its own.
    private sealed record RequestContext(
        long RequestId, Guid FarmerId, string FarmerName, string RequestType, string? Location, string Status);

    // Fire-and-forget by design. Returns as soon as the sends are dispatched;
    // nothing a caller does depends on the outcome.
    //
    // The whole body is wrapped: INotificationService's contract is that it
    // never throws, but the ledger claim talks to Postgres and that CAN
    // throw, and no notification bookkeeping may ever fail a request.
    public async Task NotifyAsync(long requestId, CancellationToken cancellationToken = default)
    {
        try
        {
            var context = await LoadAsync(requestId, cancellationToken);
            if (context is null)
            {
                _logger.LogWarning(
                    "Request {RequestId} vanished before it could be announced; nothing sent.", requestId);

                return;
            }

            var stage = FarmRequestMessages.StageFor(context.Status);

            if (stage is null)
            {
                // A status with nothing to say. The farmer does not need to
                // hear that their request went back to pending.
                _logger.LogDebug(
                    "Request {RequestId} is at status {Status}, which sends no message.",
                    requestId, context.Status);

                return;
            }

            await NotifyFarmerAsync(context, stage.Value, cancellationToken);

            // The admin notice is for the SUBMISSION only - it is a work
            // queue, and an admin who just set a request to Scheduled does
            // not need to be told that they did.
            if (stage == FarmRequestStage.Submitted)
            {
                await NotifyAdminsAsync(context, cancellationToken);
            }
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _logger.LogWarning(ex,
                "Could not announce request {RequestId}. The request itself is unaffected.", requestId);
        }
    }

    private async Task NotifyFarmerAsync(
        RequestContext context, FarmRequestStage stage, CancellationToken cancellationToken)
    {
        var stageKey = stage.ToString().ToLowerInvariant();

        if (!await TryClaimAsync(context.RequestId, stageKey, "farmer", cancellationToken))
        {
            _logger.LogDebug(
                "Suppressed a duplicate {Stage} message for request {RequestId}.", stageKey, context.RequestId);

            return;
        }

        await _notifications.NotifyFarmRequestAsync(
            context.FarmerId,
            new FarmRequestNotification(
                context.RequestId,
                stage,
                context.RequestType,
                context.Location,
                // service_request (0021) has no date column, so there is
                // never a date to name. Carried through so that adding one
                // later is a change in FarmRequestMessages and nowhere else.
                ScheduledFor: null),
            cancellationToken);
    }

    private async Task NotifyAdminsAsync(RequestContext context, CancellationToken cancellationToken)
    {
        if (!await TryClaimAsync(context.RequestId, "submitted", "admin", cancellationToken)) return;

        await _notifications.NotifyAdminsOfFarmRequestAsync(
            new FarmRequestAdminNotification(
                context.RequestId, context.FarmerName, context.RequestType, context.Location),
            cancellationToken);
    }

    // The claim and the check are one statement, so two API instances racing
    // on the same status change cannot both send. Whoever's insert lands gets
    // the row back; the other gets nothing. Modelled directly on
    // NotificationLedger.TryClaimAsync - see migration 0032 for why it is a
    // different table.
    //
    // FAILS OPEN, exactly as NotificationLedger does: a database problem here
    // returns true and the message goes out. A farmer told twice that their
    // kit is booked is a smaller harm than a farmer never told at all.
    private async Task<bool> TryClaimAsync(
        long requestId, string stage, string audience, CancellationToken cancellationToken)
    {
        try
        {
            await using var connection = await _dataSource.OpenConnectionAsync(cancellationToken);

            await using var command = new NpgsqlCommand(
                """
                insert into service_request_notification (request_id, stage, audience)
                values ($1, $2, $3)
                on conflict (request_id, stage, audience) do nothing
                returning id
                """,
                connection);

            command.Parameters.AddWithValue(requestId);
            command.Parameters.AddWithValue(stage);
            command.Parameters.AddWithValue(audience);

            return await command.ExecuteScalarAsync(cancellationToken) is not null;
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _logger.LogWarning(ex,
                "Could not check the request notification ledger for request {RequestId} ({Stage}/{Audience}); " +
                "sending anyway.", requestId, stage, audience);

            return true;
        }
    }

    private async Task<RequestContext?> LoadAsync(long requestId, CancellationToken cancellationToken)
    {
        await using var connection = await _dataSource.OpenConnectionAsync(cancellationToken);

        // coalesce on the location: a new_zone request stores none of its
        // own, so the farm's location is what the message should name. Both
        // nullified-if-blank first, because an empty string is not a
        // location and would leave a hole in the sentence.
        await using var command = new NpgsqlCommand(
            """
            select r.id,
                   r.farmer_id,
                   coalesce(nullif(p.name, ''), 'a farmer'),
                   r.request_type,
                   coalesce(nullif(trim(r.location), ''), nullif(trim(f.location), '')),
                   r.status
              from service_request r
              join profile p on p.id = r.farmer_id
              left join farm f on f.farm_id = r.farm_id
             where r.id = $1
            """,
            connection);

        command.Parameters.AddWithValue(requestId);

        await using var reader = await command.ExecuteReaderAsync(cancellationToken);

        if (!await reader.ReadAsync(cancellationToken)) return null;

        return new RequestContext(
            reader.GetInt64(0),
            reader.GetGuid(1),
            reader.GetString(2),
            reader.GetString(3),
            reader.IsDBNull(4) ? null : reader.GetString(4),
            reader.GetString(5));
    }
}
