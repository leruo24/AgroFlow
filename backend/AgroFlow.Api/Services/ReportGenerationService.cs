using System.Security.Claims;
using AgroFlow.Api.Endpoints;
using AgroFlow.Api.Services.Notifications;
using AgroFlow.Business;
using Microsoft.AspNetCore.Http.HttpResults;
using Npgsql;

namespace AgroFlow.Api.Services;

// Turns `preparing` report_request rows into PDFs, delivers them, and marks
// them ready.
//
// WHY A BACKGROUND SERVICE AND NOT WORK DONE IN THE REQUEST
// ---------------------------------------------------------
// Generating a report runs the FAO-56 engine over a date range. On a phone
// on rural data that is long enough to time out mid-download, and the
// farmer would have nothing to show for it. More importantly the automatic
// weekly reports (0035) have no HTTP request to run inside at all. One
// queue serves both.
//
// HOW IT REUSES OLWETHU'S REPORTS
// -------------------------------
// It calls her three PDF endpoints directly rather than rendering anything
// itself, so the PDF a farmer downloads and the PDF the scheduler sends can
// never drift apart. Those methods take a ClaimsPrincipal and do their own
// farm-ownership check; this builds one from the REQUESTING FARMER'S OWN
// profile id, so that check still runs for real - a queued request cannot
// reach a farm its requester could not reach.
public sealed class ReportGenerationService : BackgroundService
{
    // Short, because a farmer is watching the list and pulling to refresh.
    private static readonly TimeSpan PollInterval = TimeSpan.FromSeconds(20);

    // One request at a time. QuestPDF rendering is CPU-bound and this runs
    // on a small Railway container alongside the MQTT subscriber, which must
    // keep up with every board's 30-second reading.
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

        // A container that restarts mid-generation leaves a row stuck at
        // 'preparing' forever, with the farmer watching a spinner that will
        // never finish. Anything already stale at startup is failed once,
        // visibly, so they can ask again.
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
                // The queue must never take the host down. A failing sweep is
                // retried on the next tick.
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

    // Anything left 'preparing' from a previous process. Twenty minutes is
    // far longer than any real generation and short enough that a farmer who
    // asked before a deploy is not left waiting all day.
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
            // Not fatal: the queue below still works, those rows just stay
            // stuck until the next restart.
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

    // `for update skip locked` so two instances - or a future second worker -
    // cannot both pick up the same request and send the farmer two copies.
    private async Task<PendingRequest?> ClaimNextAsync(CancellationToken ct)
    {
        await using var connection = await _dataSource.OpenConnectionAsync(ct);
        await using var transaction = await connection.BeginTransactionAsync(ct);

        // started_at is the claim. Selecting and stamping it in ONE
        // statement, inside one transaction, is what makes the claim
        // exclusive: `for update skip locked` only holds for the life of the
        // transaction, and generation happens after it commits, so without
        // the stamp the next poll 20 seconds later would pick the same row up
        // again and the farmer would get two copies.
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
                // The endpoint refused rather than threw - most often a date
                // range with no data in it, or a zone that has since been
                // deleted.
                failure = "There was no data to put in this report for the period you chose.";
            }
        }
        catch (Exception ex)
        {
            // The real reason goes to the log and the row; the farmer gets
            // plain words, because "Npgsql.PostgresException: 42703" is not
            // something they can act on.
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

        // Marked ready BEFORE the Telegram send. The report exists and the
        // farmer can open it in the app from this moment; a dead Telegram
        // must not make a perfectly good report show as Failed.
        await MarkReadyAsync(request.Id, BuildRegenerationPath(request), ct);

        await DeliverToTelegramAsync(request, pdf, ct);
    }

    // Calls Olwethu's own PDF endpoints. See the class note on why.
    private async Task<byte[]?> RenderAsync(PendingRequest request, CancellationToken ct)
    {
        using var scope = _services.CreateScope();
        var provider = scope.ServiceProvider;

        var dataSource = provider.GetRequiredService<NpgsqlDataSource>();
        var engine = provider.GetRequiredService<AgroFlow.Business.Fao56EngineController>();

        // The farmer's own identity, so the ownership check inside each
        // endpoint is a real check and not a bypass. "sub" is the claim
        // TryGetUserId reads.
        var principal = new ClaimsPrincipal(new ClaimsIdentity(
            new[] { new Claim("sub", request.ProfileId.ToString()) }, "report-generator"));

        IResult result = request.ReportType switch
        {
            // request.ZoneId travels through. A farmer who picked a zone in
            // the app gets the designed per-zone report; one who asked about
            // the whole farm gets the farm summary, unchanged. Both arrive by
            // Telegram the same way.
            ReportKinds.WaterUsage => await ReportEndpoints.GetWaterUsagePdfAsync(
                principal, dataSource, request.FarmId, request.PeriodStart, request.PeriodEnd, engine,
                request.ZoneId, ct),

            ReportKinds.Moisture => await ReportEndpoints.GetMoisturePdfAsync(
                principal, dataSource, request.ZoneId, request.PeriodStart, request.PeriodEnd, engine),

            ReportKinds.Schedule => await ReportEndpoints.GetSchedulePdfAsync(
                principal, dataSource, request.FarmId, engine),

            _ => Results.BadRequest(),
        };

        // A 4xx from the endpoint is a legitimate "no" - an empty range, a
        // zone that was deleted, a farm the requester is no longer on - not
        // a crash. It becomes a Failed row with a plain message.
        if (result is IStatusCodeHttpResult { StatusCode: >= 400 }) return null;

        // Results.File(byte[], ...) produces a FileContentHttpResult, whose
        // FileContents is the rendered PDF. Reading it here rather than
        // writing the IResult to a response is what lets the same builder
        // serve both a download and this queue.
        return result is FileContentHttpResult file ? file.FileContents.ToArray() : null;
    }

    // What `file_path` holds. Not an object key: this deployment has no
    // object storage, and a Railway container's filesystem does not survive
    // a deploy. The parameters ARE the stored report - see the long note at
    // the bottom of migration 0034.
    private static string BuildRegenerationPath(PendingRequest request)
    {
        return request.ReportType switch
        {
            // The zone has to be in the stored path too, or regenerating a
            // report would hand back the farm summary instead of the document
            // the farmer originally received.
            ReportKinds.WaterUsage =>
                $"/api/farmer/reports/water-usage/pdf?farmId={request.FarmId}" +
                (request.ZoneId is { } wz ? $"&zoneId={wz}" : "") +
                $"&from={request.PeriodStart:yyyy-MM-dd}&to={request.PeriodEnd:yyyy-MM-dd}",

            ReportKinds.Moisture =>
                $"/api/farmer/reports/moisture/pdf?zoneId={request.ZoneId}" +
                $"&from={request.PeriodStart:yyyy-MM-dd}&to={request.PeriodEnd:yyyy-MM-dd}",

            _ => $"/api/farmer/reports/schedule/pdf?farmId={request.FarmId}",
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
            if (chatId is null)
            {
                // Ordinary, not an error: a farmer who never pressed Start in
                // the bot has no chat, and a bot cannot message first.
                _logger.LogInformation(
                    "Report {Id} is ready but profile {ProfileId} has no linked Telegram chat.",
                    request.Id, request.ProfileId);

                return;
            }

            // Send once. The scheduler can legitimately retry a period, and a
            // farmer getting the same report twice is how they learn to
            // ignore the channel. Keyed on the request row, so two DIFFERENT
            // requests for the same report are two sends - which is right,
            // because the farmer asked twice.
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

            await telegram.SendDocumentAsync(chatId.Value, pdf, fileName, caption, ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // The report is already marked ready and openable in the app. A
            // failed Telegram send must never undo that.
            _logger.LogWarning(ex,
                "Could not send report {Id} to Telegram. It is still available in the app.", request.Id);
        }
    }

    private async Task<long?> GetChatIdAsync(Guid profileId, CancellationToken ct)
    {
        await using var connection = await _dataSource.OpenConnectionAsync(ct);

        await using var cmd = new NpgsqlCommand(
            "select telegram_chat_id from profile where id = $1 and telegram_chat_id is not null",
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
            // If even this fails the row stays 'preparing' and
            // ReleaseStaleRequestsAsync will fail it on the next restart.
            _logger.LogError(ex, "Could not mark report request {Id} as failed.", id);
        }
    }
}
