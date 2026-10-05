using System.Security.Claims;
using AgroFlow.Business;
using Npgsql;
using NpgsqlTypes;

namespace AgroFlow.Api.Endpoints;

public record CreateReportRequestBody(
    string ReportType,
    string? Period,
    DateOnly? PeriodStart,
    DateOnly? PeriodEnd,
    long? ZoneId,
    long? FarmId);

public record ReportRequestRow(
    long Id,
    string ReportType,
    string ReportTypeLabel,
    long? ZoneId,
    string? ZoneName,
    string PeriodStart,
    string PeriodEnd,
    string PeriodLabel,
    string Status,
    string StatusLabel,
    string? FilePath,
    string RequestedVia,
    string CreatedAt,
    string? CompletedAt,
    string? Error);

// The farmer's own report queue: ask for one, see the ones you have asked
// for, open a finished one.
//
// The generation itself is ReportGenerationService's job - see its class
// note on why the work does not happen inside this request.
public static class ReportRequestEndpoints
{
    /* WHY EVERY HANDLER HERE IS WRAPPED
     *
     * This endpoint had no try/catch at all, so ANY database exception
     * escaped as a bare 500 and the app showed the farmer
     * "AgroFlow API request failed (500)" - a sentence that tells them
     * nothing and tells us nothing either.
     *
     * The most likely cause by far is the simplest: migrations 0034/0035
     * have not been applied, so `report_request` does not exist and Postgres
     * answers 42P01. That is a deployment state, not a bug, and it must read
     * as one in the log while the farmer still gets plain words.
     *
     * Ordered by how likely each is in practice - see the report.
     */
    private const string UndefinedTable = "42P01";
    private const string UndefinedColumn = "42703";
    private const string InsufficientPrivilege = "42501";

    /// The farmer-facing sentence. Deliberately the SAME one whatever broke:
    /// none of the real reasons - a missing table, a revoked grant, a null
    /// flow rate - are things a farmer can act on, and the real reason is in
    /// the log and the row for whoever can.
    private const string FarmerFacingFailure =
        "This report couldn't be made. Try again later.";

    /// Turns an exception into a logged diagnosis plus a plain 503.
    ///
    /// 503 and not 500: every cause below is "this is not set up / not
    /// available right now", which is a temporary state the farmer should
    /// retry, not a bug in their request.
    private static IResult Failure(ILogger logger, Exception ex, string what)
    {
        if (ex is PostgresException pg)
        {
            var diagnosis = pg.SqlState switch
            {
                UndefinedTable =>
                    $"Table '{pg.TableName ?? "report_request"}' does not exist. " +
                    "Apply migrations 0034_report_request.sql and 0035_report_schedule.sql.",

                UndefinedColumn =>
                    $"Column '{pg.ColumnName}' is missing on '{pg.TableName}'. " +
                    "A migration is applied only partially - re-run the latest one.",

                InsufficientPrivilege =>
                    $"Permission denied on '{pg.TableName}'. Check the GRANT and RLS policy in the migration.",

                _ => $"Postgres {pg.SqlState}: {pg.MessageText}",
            };

            logger.LogError(ex, "{What} failed. {Diagnosis}", what, diagnosis);
        }
        else
        {
            logger.LogError(ex, "{What} failed.", what);
        }

        return Results.Json(
            new { error = FarmerFacingFailure },
            statusCode: StatusCodes.Status503ServiceUnavailable);
    }

    public static void MapReportRequestEndpoints(this WebApplication app)
    {
        var group = app.MapGroup("/api/farmer/report-requests").RequireAuthorization();

        group.MapGet("/", ListAsync);
        group.MapPost("/", CreateAsync);
    }

    private static async Task<IResult> ListAsync(
        ClaimsPrincipal user,
        NpgsqlDataSource dataSource,
        ILoggerFactory loggerFactory,
        CancellationToken cancellationToken)
    {
        if (!TryGetUserId(user, out var userId)) return Results.Unauthorized();

        var logger = loggerFactory.CreateLogger("AgroFlow.Api.ReportRequests");

        try
        {
            return await ListInnerAsync(userId, dataSource, cancellationToken);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // An empty list rather than an error: the Reports screen's own
            // request form must stay usable even when the history behind it
            // cannot be read.
            logger.LogError(ex, "Could not list report requests for {ProfileId}.", userId);
            return Results.Ok(Array.Empty<ReportRequestRow>());
        }
    }

    private static async Task<IResult> ListInnerAsync(
        Guid userId, NpgsqlDataSource dataSource, CancellationToken cancellationToken)
    {
        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);

        // profile_id = the requester, which is what the RLS policy scopes by
        // too. Repeated here because AgroFlow.Api connects as `postgres` and
        // bypasses RLS - the policy is not doing this filtering for us.
        await using var cmd = new NpgsqlCommand(
            """
            select r.id, r.report_type, r.zone_id, z.name, r.period_start, r.period_end,
                   r.status, r.file_path, r.requested_via, r.created_at, r.completed_at, r.error
              from report_request r
              left join zone z on z.id = r.zone_id
             where r.profile_id = $1
             order by r.created_at desc
             limit 50
            """,
            connection);
        cmd.Parameters.AddWithValue(userId);

        var rows = new List<ReportRequestRow>();

        await using var reader = await cmd.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            var reportType = reader.GetString(1);
            var start = reader.GetFieldValue<DateOnly>(4);
            var end = reader.GetFieldValue<DateOnly>(5);
            var status = reader.GetString(6);

            rows.Add(new ReportRequestRow(
                reader.GetInt64(0),
                reportType,
                ReportKinds.DisplayName(reportType),
                reader.IsDBNull(2) ? null : reader.GetInt64(2),
                reader.IsDBNull(3) ? null : reader.GetString(3),
                start.ToString("yyyy-MM-dd"),
                end.ToString("yyyy-MM-dd"),
                ReportPeriods.Describe(start, end),
                status,
                ReportRequestStatuses.DisplayName(status),
                reader.IsDBNull(7) ? null : reader.GetString(7),
                reader.GetString(8),
                reader.GetFieldValue<DateTimeOffset>(9).ToString("o"),
                reader.IsDBNull(10) ? null : reader.GetFieldValue<DateTimeOffset>(10).ToString("o"),
                // The row's own error is for the team; the farmer gets the
                // same plain sentence whatever went wrong, because none of
                // the real reasons are things they can act on.
                status == ReportRequestStatuses.Failed
                    ? ReportRequestStatuses.FarmerFailureMessage
                    : null));
        }

        return Results.Ok(rows);
    }

    private static async Task<IResult> CreateAsync(
        CreateReportRequestBody request,
        ClaimsPrincipal user,
        NpgsqlDataSource dataSource,
        ILoggerFactory loggerFactory,
        CancellationToken cancellationToken)
    {
        if (!TryGetUserId(user, out var userId)) return Results.Unauthorized();

        var logger = loggerFactory.CreateLogger("AgroFlow.Api.ReportRequests");

        try
        {
            return await CreateInnerAsync(request, userId, dataSource, cancellationToken);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            return Failure(logger, ex, "Creating a report request");
        }
    }

    private static async Task<IResult> CreateInnerAsync(
        CreateReportRequestBody request,
        Guid userId,
        NpgsqlDataSource dataSource,
        CancellationToken cancellationToken)
    {

        var reportType = request.ReportType?.Trim().ToLowerInvariant();

        if (!ReportKinds.IsValid(reportType))
        {
            return Results.BadRequest(new
            {
                error = "Pick one of: " + string.Join(", ", ReportKinds.All) + ".",
            });
        }

        // ------------------------------------------------------------------
        // The period.
        //
        // Resolved on the SERVER from the farmer's choice, not taken as two
        // dates from the client, so "last 7 days" means the same seven days
        // however the phone's clock or timezone is set. Custom dates are the
        // one case the client supplies.
        // ------------------------------------------------------------------
        var today = DateOnly.FromDateTime(DateTime.UtcNow.AddHours(2)); // SAST, no DST
        DateOnly start;
        DateOnly end;

        switch (request.Period)
        {
            case ReportPeriods.Custom:
                if (request.PeriodStart is null || request.PeriodEnd is null)
                {
                    return Results.BadRequest(new { error = "Custom reports need a start and an end date." });
                }

                start = request.PeriodStart.Value;
                end = request.PeriodEnd.Value;

                if (end < start)
                {
                    return Results.BadRequest(new { error = "The end date must not be before the start date." });
                }

                // The same ceiling Olwethu's endpoints enforce. Caught here so
                // the farmer is told now rather than after waiting for a
                // report that was never going to be made.
                if (end.DayNumber - start.DayNumber >= 366)
                {
                    return Results.BadRequest(new { error = "Reports cover at most one year." });
                }

                break;

            case ReportPeriods.Last30Days:
                end = today;
                start = today.AddDays(-29);
                break;

            default:
                end = today;
                start = today.AddDays(-6);
                break;
        }

        await using var connection = await dataSource.OpenConnectionAsync(cancellationToken);

        // ------------------------------------------------------------------
        // Ownership, resolved FROM THE ZONE when one is named - so a farmer
        // cannot pair their own farmId with someone else's zoneId. Archived
        // farms are refused: there is nothing to report on.
        // ------------------------------------------------------------------
        long farmId;
        long? zoneId = request.ZoneId;

        if (zoneId is not null)
        {
            await using var cmd = new NpgsqlCommand(
                """
                select z.farm_id from zone z
                  join farm f on f.farm_id = z.farm_id
                 where z.id = $2
                   and lower(coalesce(f.status, 'active')) <> 'inactive'
                   and (f.owner_id = $1 or exists (
                        select 1 from farm_member fm
                         where fm.farm_id = z.farm_id and fm.profile_id = $1))
                """,
                connection);
            cmd.Parameters.AddWithValue(userId);
            cmd.Parameters.AddWithValue(zoneId.Value);

            if (await cmd.ExecuteScalarAsync(cancellationToken) is not long resolved)
            {
                return Results.NotFound(new { error = "Zone not found." });
            }

            farmId = resolved;
        }
        else
        {
            await using var cmd = new NpgsqlCommand(
                """
                select f.farm_id from farm f
                 where lower(coalesce(f.status, 'active')) <> 'inactive'
                   and ($2::bigint is null or f.farm_id = $2)
                   and (f.owner_id = $1 or exists (
                        select 1 from farm_member fm
                         where fm.farm_id = f.farm_id and fm.profile_id = $1))
                 order by case when f.owner_id = $1 then 0 else 1 end, f.farm_id
                 limit 1
                """,
                connection);
            cmd.Parameters.AddWithValue(userId);
            cmd.Parameters.AddWithValue(NpgsqlDbType.Bigint, (object?)request.FarmId ?? DBNull.Value);

            if (await cmd.ExecuteScalarAsync(cancellationToken) is not long resolved)
            {
                return Results.NotFound(new { error = "Farm not found." });
            }

            farmId = resolved;
        }

        // The moisture report is per zone - Olwethu's endpoint takes a zoneId
        // and nothing else. Refused here with a plain reason rather than
        // queued and failed minutes later.
        if (ReportKinds.RequiresZone(reportType) && zoneId is null)
        {
            return Results.BadRequest(new
            {
                error = "A soil moisture report is for one zone. Please choose a zone.",
            });
        }

        await using (var insert = new NpgsqlCommand(
            """
            insert into report_request
                (profile_id, farm_id, zone_id, report_type, period_start, period_end, requested_via)
            values ($1, $2, $3, $4, $5, $6, 'app')
            returning id
            """,
            connection))
        {
            insert.Parameters.AddWithValue(userId);
            insert.Parameters.AddWithValue(farmId);
            insert.Parameters.AddWithValue(NpgsqlDbType.Bigint, (object?)zoneId ?? DBNull.Value);
            insert.Parameters.AddWithValue(reportType!);
            insert.Parameters.AddWithValue(NpgsqlDbType.Date, start);
            insert.Parameters.AddWithValue(NpgsqlDbType.Date, end);

            var id = (long)(await insert.ExecuteScalarAsync(cancellationToken))!;

            return Results.Accepted(value: new
            {
                id,
                status = ReportRequestStatuses.Preparing,
                message = "We're making your report. It will show here when it's ready.",
            });
        }
    }

    private static bool TryGetUserId(ClaimsPrincipal user, out Guid userId) =>
        Guid.TryParse(user.FindFirstValue("sub"), out userId);
}
