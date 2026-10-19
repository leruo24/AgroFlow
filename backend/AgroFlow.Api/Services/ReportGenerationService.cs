using System.Security.Claims;
using AgroFlow.Api.Endpoints;
using AgroFlow.Api.Services.Notifications;
using AgroFlow.Business;
using Microsoft.AspNetCore.Http.HttpResults;
using Npgsql;

namespace AgroFlow.Api.Services;

// Turns `preparing` report_request rows into PDFs, sends them, and marks them ready.
// A background service because running the engine over a date range can time out a
// phone on rural data, and automatic weekly reports (0035) have no HTTP request at all.
// It calls the three PDF endpoints directly, so the downloaded and the scheduled PDF
// are identical. Those check farm ownership with a ClaimsPrincipal, and we build it
// from the requesting farmer's own profile id, so a queued request cannot reach a
// farm its requester could not.
public sealed class ReportGenerationService : BackgroundService
{
    // Short, because a farmer may be watching the list and refreshing.
    private static readonly TimeSpan PollInterval = TimeSpan.FromSeconds(20);

    // One request at a time: rendering is CPU-heavy and shares a small container with
    // the MQTT subscriber, which must keep up with every board's 30-second reading.
    private const int BatchSize = 1;

    private readonly IServiceProvider _services;
    private readonly NpgsqlDataSource _dataSource;
    private readonly ILogger<ReportGenerationService> _logger;

    public ReportGenerationService(
        IServiceProvider services,
        NpgsqlDataSource dataSource,
        ILogger<ReportGenerationService> logger)
    {
        _services = services;
        _dataSource = dataSource;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("Report generation service started.");

        // A restart mid-generation would leave a row stuck at 'preparing' forever, so
        // anything stale at start-up is marked failed and the farmer can ask again.
        await ReleaseStaleRequestsAsync(stoppingToken);

        using var timer = new PeriodicTimer(PollInterval);

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await DrainQueueAsync(stoppingToken);
            }
            catch (OperationCanceledException)
            {
                break;
            }
            catch (Exception ex)
            {
                // The queue must never take the host down; a failed sweep retries on the next tick.
                _logger.LogError(ex, "Report queue sweep failed; retrying on the next tick.");
            }

            try
            {
                if (!await timer.WaitForNextTickAsync(stoppingToken)) break;
            }
            catch (OperationCanceledException)
            {
                break;
            }
        }

        _logger.LogInformation("Report generation service stopped.");
    }

    // Anything left 'preparing' by a previous process. Twenty minutes is far longer than
    // any real generation, and short enough not to leave a farmer waiting all day.
    private async Task ReleaseStaleRequestsAsync(CancellationToken ct)
    {
        try
        {
            await using var connection = await _dataSource.OpenConnectionAsync(ct);

            await using var cmd = new NpgsqlCommand(
                """
                update report_request
                   set status = 'failed',
                       error = 'Generation was interrupted by a server restart.',
                       completed_at = now()
                 where status = 'preparing'
                   and started_at is not null
                   and started_at < now() - interval '20 minutes'
                """,
                connection);

            var released = await cmd.ExecuteNonQueryAsync(ct);

            if (released > 0)
            {
                _logger.LogWarning(
                    "Failed {Count} report request(s) left mid-generation by a previous process.", released);
            }
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // Not fatal: the queue still works; those rows stay stuck until the next restart.
            _logger.LogWarning(ex, "Could not release stale report requests.");
        }
    }

    private async Task DrainQueueAsync(CancellationToken ct)
    {
        var pending = await ClaimNextAsync(ct);
        if (pending is null) return;

        await GenerateAsync(pending, ct);
    }

    private sealed record PendingRequest(
        long Id, Guid ProfileId, long FarmId, long? ZoneId,
        string ReportType, DateOnly PeriodStart, DateOnly PeriodEnd, string RequestedVia);

    // `for update skip locked`, so two workers cannot pick up the same request and send
    // the farmer two copies.
    private async Task<PendingRequest?> ClaimNextAsync(CancellationToken ct)
    {
        await using var connection = await _dataSource.OpenConnectionAsync(ct);
        await using var transaction = await connection.BeginTransactionAsync(ct);

        // started_at is the claim. Selecting and stamping it in one statement makes the
        // claim exclusive; the lock ends when the transaction commits, so without the stamp
        // the next poll would pick up the same row.
        await using var cmd = new NpgsqlCommand(
            """
            update report_request
               set started_at = now()
             where id in (
                   select id from report_request
                    where status = 'preparing' and started_at is null
                    order by created_at
                    for update skip locked
                    limit @batch)
            returning id, profile_id, farm_id, zone_id, report_type,
                      period_start, period_end, requested_via
            """,
            connection, transaction);
        cmd.Parameters.AddWithValue("batch", BatchSize);

        PendingRequest? pending = null;

        await using (var reader = await cmd.ExecuteReaderAsync(ct))
        {
            if (await reader.ReadAsync(ct))
            {
                pending = new PendingRequest(
                    reader.GetInt64(0),
                    reader.GetGuid(1),
                    reader.GetInt64(2),
                    reader.IsDBNull(3) ? null : reader.GetInt64(3),
                    reader.GetString(4),
                    reader.GetFieldValue<DateOnly>(5),
                    reader.GetFieldValue<DateOnly>(6),
                    reader.GetString(7));
            }
        }

        await transaction.CommitAsync(ct);

        return pending;
    }

    private async Task GenerateAsync(PendingRequest request, CancellationToken ct)
    {
        byte[]? pdf = null;
        string? failure = null;

        try
        {
            pdf = await RenderAsync(request, ct);

            if (pdf is null || pdf.Length == 0)
            {
                // The endpoint refused instead of throwing, usually a period with no data or a
                // deleted zone.
                failure = "There was no data to put in this report for the period you chose.";
            }
        }
        catch (Exception ex)
        {
            // The real reason goes to the log and the row; the farmer gets plain words.
            _logger.LogError(ex,
                "Report request {Id} ({Type}) failed for farm {FarmId}.",
                request.Id, request.ReportType, request.FarmId);

            failure = "Something went wrong while making this report.";
        }

        if (failure is not null || pdf is null)
        {
            await MarkFailedAsync(request.Id, failure ?? "Unknown error.", ct);
            return;
        }

        // Marked ready before the Telegram send: the farmer can open it in the app now,
        // and a Telegram outage must not make a good report show as Failed.
        await MarkReadyAsync(request.Id, BuildRegenerationPath(request), ct);

        await DeliverToTelegramAsync(request, pdf, ct);
    }

    // Calls the report PDF endpoints directly (see the class comment).
    private async Task<byte[]?> RenderAsync(PendingRequest request, CancellationToken ct)
    {
        using var scope = _services.CreateScope();
        var provider = scope.ServiceProvider;

        var dataSource = provider.GetRequiredService<NpgsqlDataSource>();
        var engine = provider.GetRequiredService<AgroFlow.Business.Fao56EngineController>();

        // Security: the farmer's own identity, so each endpoint's ownership check really
        // runs. "sub" is the claim TryGetUserId reads.
        var principal = new ClaimsPrincipal(new ClaimsIdentity(
            new[] { new Claim("sub", request.ProfileId.ToString()) }, "report-generator"));

        IResult result = request.ReportType switch
        {
            // request.ZoneId is passed through: a zone gives the per-zone report, the whole
            // farm gives the farm summary. Both arrive on Telegram the same way.
            ReportKinds.WaterUsage => await ReportEndpoints.GetWaterUsagePdfAsync(
                principal, dataSource, request.FarmId, request.PeriodStart, request.PeriodEnd, engine,
                request.ZoneId, ct),

            ReportKinds.Moisture => await ReportEndpoints.GetMoisturePdfAsync(
                principal, dataSource, request.ZoneId, request.PeriodStart, request.PeriodEnd, engine),

            ReportKinds.Schedule => await ReportEndpoints.GetSchedulePdfAsync(
                principal, dataSource, request.FarmId, engine, request.ZoneId),

            _ => Results.BadRequest(),
        };

        // A 4xx from the endpoint is a normal "no" (empty range, deleted zone, farm the
        // requester left), so it becomes a Failed row with a plain message.
        if (result is IStatusCodeHttpResult { StatusCode: >= 400 }) return null;

        // Results.File(byte[], ...) gives a FileContentHttpResult whose FileContents is the
        // PDF, so the same builder serves both a download and this queue.
        return result is FileContentHttpResult file ? file.FileContents.ToArray() : null;
    }

    // What `file_path` holds: the report's parameters, not a file key. We have no object
    // storage and Railway's filesystem does not survive a deploy (see the note at the
    // end of migration 0034).
    private static string BuildRegenerationPath(PendingRequest request)
    {
        return request.ReportType switch
        {
            // The zone is part of the stored path too, so regenerating gives back the same
            // per-zone document.
            ReportKinds.WaterUsage =>
                $"/api/farmer/reports/water-usage/pdf?farmId={request.FarmId}" +
                (request.ZoneId is { } wz ? $"&zoneId={wz}" : "") +
                $"&from={request.PeriodStart:yyyy-MM-dd}&to={request.PeriodEnd:yyyy-MM-dd}",

            ReportKinds.Moisture =>
                $"/api/farmer/reports/moisture/pdf?zoneId={request.ZoneId}" +
                $"&from={request.PeriodStart:yyyy-MM-dd}&to={request.PeriodEnd:yyyy-MM-dd}",

            _ => $"/api/farmer/reports/schedule/pdf?farmId={request.FarmId}" +
                 (request.ZoneId is { } sz ? $"&zoneId={sz}" : ""),
        };
    }

    private async Task DeliverToTelegramAsync(PendingRequest request, byte[] pdf, CancellationToken ct)
    {
        try
        {
            using var scope = _services.CreateScope();
            var telegram = scope.ServiceProvider.GetRequiredService<TelegramClient>();
            var ledger = scope.ServiceProvider.GetRequiredService<NotificationLedger>();

            if (!telegram.IsConfigured) return;

            var chatId = await GetChatIdAsync(request.ProfileId, ct);

            // An automatic report may also go to the admin who set up the schedule and to the
            // admin group chat.
            var automatic = request.RequestedVia == "auto";
            // Staff never get Telegram (StaffTelegram): the copy to the staff member who set up
            // the schedule and to the admin group chat stopped. Staff see reports in the admin site.
            var (toHandler, toAdminChat, handler) = (false, false, (Guid?)null);
            var handlerChat = toHandler && handler is { } h ? await GetChatIdAsync(h, ct) : null;
            var options = scope.ServiceProvider.GetRequiredService<Microsoft.Extensions.Options.IOptions<TelegramOptions>>().Value;

            var recipients = ReportDelivery.Recipients(
                chatId, automatic, toHandler, handlerChat, toAdminChat, options.AdminGroupChatId);

            if (recipients.Count == 0)
            {
                // Normal, not an error: a farmer who never pressed Start has no chat.
                _logger.LogInformation(
                    "Report {Id} is ready but profile {ProfileId} has no linked Telegram chat.",
                    request.Id, request.ProfileId);

                return;
            }

            // Send once per request row: the scheduler may retry a period, and duplicates teach
            // farmers to ignore the channel. Two separate requests are two sends, because the
            // farmer asked twice.
            var claimed = await ledger.TryClaimAsync(
                request.FarmId,
                $"report-{request.Id}",
                DateOnly.FromDateTime(DateTime.UtcNow),
                ct);

            if (!claimed)
            {
                _logger.LogDebug("Report {Id} was already sent to Telegram; not sending again.", request.Id);
                return;
            }

            var caption =
                $"📄 Your AgroFlow {ReportKinds.DisplayName(request.ReportType)} report " +
                $"({ReportPeriods.Describe(request.PeriodStart, request.PeriodEnd)}) is ready.";

            var fileName =
                $"agroflow-{request.ReportType.Replace('_', '-')}-{request.PeriodEnd:yyyyMMdd}.pdf";

            // Each recipient: one retry, then an admin alert.
            var failed = 0;
            foreach (var chat in recipients)
            {
                var sent = await ReportDelivery.SendWithOneRetryAsync(
                    () => telegram.SendDocumentAsync(chat, pdf, fileName, caption, ct),
                    ReportDelivery.RetryDelay, ct);
                if (!sent) failed++;
            }

            if (failed > 0) await RaiseDeliveryAlertAsync(request, failed, ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // The report is already ready in the app; a failed Telegram send never undoes that.
            _logger.LogWarning(ex,
                "Could not send report {Id} to Telegram. It is still available in the app.", request.Id);
        }
    }

    // The schedule's extra recipients, read through jsonb so a database without 0040
    // answers "nobody extra".
    private async Task<(bool ToHandler, bool ToAdminChat, Guid? Handler)> LoadScheduleRecipientsAsync(
        long farmId, CancellationToken ct)
    {
        try
        {
            await using var connection = await _dataSource.OpenConnectionAsync(ct);
            await using var cmd = new NpgsqlCommand(
                "select coalesce((to_jsonb(s) ->> 'send_to_handler')::boolean, false), " +
                "       coalesce((to_jsonb(s) ->> 'admin_chat_enabled')::boolean, false), s.created_by " +
                "from report_schedule s where s.farm_id = $1", connection);
            cmd.Parameters.AddWithValue(farmId);
            await using var reader = await cmd.ExecuteReaderAsync(ct);
            if (!await reader.ReadAsync(ct)) return (false, false, null);
            return (reader.GetBoolean(0), reader.GetBoolean(1), reader.IsDBNull(2) ? null : reader.GetGuid(2));
        }
        catch (PostgresException)
        {
            return (false, false, null);
        }
    }

    // A report that could not be delivered even after a retry becomes an admin alert,
    // not just a log line.
    private async Task RaiseDeliveryAlertAsync(PendingRequest request, int failedRecipients, CancellationToken ct)
    {
        try
        {
            await using var connection = await _dataSource.OpenConnectionAsync(ct);
            await using var cmd = new NpgsqlCommand(
                "insert into alert (zone_id, severity, message, status) " +
                "select coalesce($1, (select min(z.id) from zone z where z.farm_id = $2)), 'Warning', $3, 'Open'",
                connection);
            cmd.Parameters.AddWithValue(NpgsqlTypes.NpgsqlDbType.Bigint, (object?)request.ZoneId ?? DBNull.Value);
            cmd.Parameters.AddWithValue(request.FarmId);
            cmd.Parameters.AddWithValue(
                $"The {ReportKinds.DisplayName(request.ReportType)} report " +
                $"({ReportPeriods.Describe(request.PeriodStart, request.PeriodEnd)}) could not be sent on Telegram " +
                $"to {failedRecipients} recipient(s), even after a retry. It is ready in the app (report {request.Id}).");
            await cmd.ExecuteNonQueryAsync(ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _logger.LogError(ex, "Could not raise the delivery alert for report {Id}.", request.Id);
        }
    }

    private async Task<long?> GetChatIdAsync(Guid profileId, CancellationToken ct)
    {
        await using var connection = await _dataSource.OpenConnectionAsync(ct);

        await using var cmd = new NpgsqlCommand(
            $"select p.telegram_chat_id from profile p where p.id = $1 and p.telegram_chat_id is not null and {StaffTelegram.NotStaffSql}",
            connection);
        cmd.Parameters.AddWithValue(profileId);

        return await cmd.ExecuteScalarAsync(ct) is long chatId ? chatId : null;
    }

    private async Task MarkReadyAsync(long id, string filePath, CancellationToken ct)
    {
        await using var connection = await _dataSource.OpenConnectionAsync(ct);

        await using var cmd = new NpgsqlCommand(
            "update report_request set status = 'ready', file_path = $2, completed_at = now(), " +
            "error = null where id = $1", connection);
        cmd.Parameters.AddWithValue(id);
        cmd.Parameters.AddWithValue(filePath);

        await cmd.ExecuteNonQueryAsync(ct);

        _logger.LogInformation("Report request {Id} is ready.", id);
    }

    private async Task MarkFailedAsync(long id, string error, CancellationToken ct)
    {
        try
        {
            await using var connection = await _dataSource.OpenConnectionAsync(ct);

            await using var cmd = new NpgsqlCommand(
                "update report_request set status = 'failed', error = $2, completed_at = now() " +
                "where id = $1", connection);
            cmd.Parameters.AddWithValue(id);
            cmd.Parameters.AddWithValue(error);

            await cmd.ExecuteNonQueryAsync(ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // If this fails too, the row stays 'preparing' and ReleaseStaleRequestsAsync fails
            // it on the next restart.
            _logger.LogError(ex, "Could not mark report request {Id} as failed.", id);
        }
    }
}
