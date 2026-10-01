using Npgsql;

namespace AgroFlow.Api.Services.Notifications;

// "Has this farm already been told about this?" - the thing that stops a
// repeatedly-observed event becoming a repeatedly-sent message.
//
// The forecast is refreshed every 6 hours and carries 8 days, so a storm four
// days out is seen about 20 times before it arrives. Without a ledger that is
// 20 identical messages, after which the farmer mutes the bot and misses the
// frost warning that mattered.
//
// See migration 0026 for the table and for what subject_date means.
public sealed class NotificationLedger
{
    private readonly NpgsqlDataSource _dataSource;
    private readonly ILogger<NotificationLedger> _logger;

    public NotificationLedger(NpgsqlDataSource dataSource, ILogger<NotificationLedger> logger)
    {
        _dataSource = dataSource;
        _logger = logger;
    }

    // Returns true exactly once per (farm, alertType, subjectDate), and false
    // every time after.
    //
    // Claiming and checking are a single statement on purpose: `on conflict do
    // nothing returning` means two API instances racing on the same event
    // cannot both be told to send. Whoever's insert lands gets the row back;
    // the other gets nothing.
    //
    // Fails OPEN - a database problem here returns true and the farmer gets
    // the message. A duplicate warning is a far smaller harm than a frost
    // warning swallowed by a failing dedupe check.
    public async Task<bool> TryClaimAsync(
        long farmId,
        string alertType,
        DateOnly subjectDate,
        CancellationToken cancellationToken)
    {
        try
        {
            await using var connection = await _dataSource.OpenConnectionAsync(cancellationToken);

            await using var command = new NpgsqlCommand(
                """
                insert into notification_sent (farm_id, alert_type, subject_date)
                values ($1, $2, $3)
                on conflict (farm_id, alert_type, subject_date) do nothing
                returning id
                """,
                connection);

            command.Parameters.AddWithValue(farmId);
            command.Parameters.AddWithValue(alertType);
            command.Parameters.AddWithValue(subjectDate);

            var inserted = await command.ExecuteScalarAsync(cancellationToken);

            if (inserted is null)
            {
                _logger.LogDebug(
                    "Suppressed a duplicate {AlertType} notification for farm {FarmId} about {SubjectDate}.",
                    alertType, farmId, subjectDate);

                return false;
            }

            return true;
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _logger.LogWarning(
                ex,
                "Could not check the notification ledger for {AlertType} on farm {FarmId}; sending anyway.",
                alertType, farmId);

            return true;
        }
    }
}
