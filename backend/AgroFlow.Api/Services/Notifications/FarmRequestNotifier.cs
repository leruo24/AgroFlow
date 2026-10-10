using AgroFlow.Business;
using Npgsql;

namespace AgroFlow.Api.Services.Notifications;

// Sends the three farm/zone request messages, once each. Both callers (a farmer
// submitting, an admin moving a request along) follow the same three rules, kept here:
//   1. Claim first, then send. The claim is what makes it send once.
//   2. Never block or fail the operation: a Telegram outage must not undo a request.
//   3. Send after the database write has committed, never inside the transaction,
//      so we never message about a change that rolled back.
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

    // Everything a message needs, read back in one query. A new_zone request has no
    // location of its own, so we use the farm's.
    private sealed record RequestContext(
        long RequestId, Guid FarmerId, string FarmerName, string RequestType, string? Location, string Status);

    // Fire-and-forget: returns once the sends are started. The whole body is wrapped
    // because the ledger claim talks to Postgres and can throw, and notification
    // bookkeeping must never fail a request.
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
                // A status with nothing to say: the farmer does not need to hear their request
                // went back to pending.
                _logger.LogDebug(
                    "Request {RequestId} is at status {Status}, which sends no message.",
                    requestId, context.Status);

                return;
            }

            await NotifyFarmerAsync(context, stage.Value, cancellationToken);

            // The admin notice is only for new submissions: an admin who just scheduled a
            // request does not need telling.
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
                // service_request (0021) has no date column, so there is no date to name yet.
                // Adding one later only changes FarmRequestMessages.
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

    // Claim and check in one statement, so two API instances cannot both send (like
    // NotificationLedger.TryClaimAsync; see 0032 for why it is a separate table).
    // Fails open: on a database problem we return true and send. Telling a farmer
    // twice is better than never telling them.
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

        // A new_zone request has no location, so we use the farm's. Blank strings become
        // null first so the sentence never has a gap.
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
