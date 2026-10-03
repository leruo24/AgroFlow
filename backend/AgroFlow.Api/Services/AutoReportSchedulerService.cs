using AgroFlow.Business;
using Npgsql;
using NpgsqlTypes;

namespace AgroFlow.Api.Services;

// Creates report_request rows for farms whose automatic schedule is due.
//
// It does NOT generate anything itself: it puts rows in the same queue the
// app's own Request button fills, and ReportGenerationService drains both.
// One pipeline means an automatic report and a hand-requested one cannot
// render differently or deliver differently.
//
// WHY HOURLY AND NOT A CRON AT 07:00
// ----------------------------------
// A once-a-day timer has to survive the container being awake at exactly the
// right minute. Railway restarts on every deploy, and a deploy at 06:58 would
// silently skip that week entirely - with nobody noticing until a farmer asks
// where their report is. Checking hourly and keying the duplicate check on the
// PERIOD rather than on a timestamp makes the run idempotent: whenever the
// container happens to be up after 07:00 on the right day, the reports go out
// once.
public sealed class AutoReportSchedulerService : BackgroundService
{
    private static readonly TimeSpan CheckInterval = TimeSpan.FromHours(1);

    private readonly NpgsqlDataSource _dataSource;
    private readonly ILogger<AutoReportSchedulerService> _logger;

    public AutoReportSchedulerService(
        NpgsqlDataSource dataSource, ILogger<AutoReportSchedulerService> logger)
    {
        _dataSource = dataSource;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation(
            "Automatic report scheduler started; checking hourly in Africa/Johannesburg time.");

        // A first pass shortly after startup rather than waiting a full hour,
        // so a deploy that lands at 07:05 on a Monday still sends that day's
        // reports instead of waiting until 08:05.
        try
        {
            await Task.Delay(TimeSpan.FromMinutes(2), stoppingToken);
        }
        catch (OperationCanceledException)
        {
            return;
        }

        using var timer = new PeriodicTimer(CheckInterval);

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await RunDueSchedulesAsync(stoppingToken);
            }
            catch (OperationCanceledException)
            {
                break;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Automatic report sweep failed; retrying next hour.");
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

        _logger.LogInformation("Automatic report scheduler stopped.");
    }

    private sealed record DueSchedule(
        long Id, long FarmId, Guid? OwnerId, string Frequency,
        string[] ReportTypes, long[]? ZoneIds, DateTimeOffset? LastRunAt);

    private async Task RunDueSchedulesAsync(CancellationToken ct)
    {
        var sastNow = ReportSchedulePolicy.ToSast(DateTimeOffset.UtcNow);

        var schedules = await LoadEnabledAsync(ct);
        if (schedules.Count == 0) return;

        foreach (var schedule in schedules)
        {
            if (ct.IsCancellationRequested) break;

            var frequency = ReportSchedulePolicy.ParseFrequency(schedule.Frequency);

            if (!ReportSchedulePolicy.IsDue(true, frequency, schedule.LastRunAt, sastNow))
            {
                continue;
            }

            if (schedule.OwnerId is null)
            {
                // Nothing to deliver to, and report_request.profile_id is NOT
                // NULL. A farm whose owner was removed is a data problem for a
                // human, not something to retry hourly in silence.
                _logger.LogWarning(
                    "Schedule {Id} on farm {FarmId} is due but the farm has no owner; skipping.",
                    schedule.Id, schedule.FarmId);

                continue;
            }

            var (start, end) = ReportSchedulePolicy.PeriodFor(frequency, sastNow);

            var created = await QueueReportsAsync(schedule, start, end, ct);

            // Stamped even when `created` is 0 - every row was already there
            // from an earlier attempt - because the period IS done. Not
            // stamping would make the service retry this period every hour
            // for the rest of the day.
            await MarkRunAsync(schedule.Id, ct);

            _logger.LogInformation(
                "Automatic reports for farm {FarmId}: queued {Count} request(s) for {Start} to {End}.",
                schedule.FarmId, created, start, end);
        }
    }

    private async Task<List<DueSchedule>> LoadEnabledAsync(CancellationToken ct)
    {
        var results = new List<DueSchedule>();

        await using var connection = await _dataSource.OpenConnectionAsync(ct);

        // Archived farms are excluded (0036). An archived farm is test data or
        // a farm that has left - either way nobody should still be getting
        // weekly PDFs about it.
        await using var cmd = new NpgsqlCommand(
            """
            select s.id, s.farm_id, f.owner_id, s.frequency, s.report_types, s.zone_ids, s.last_run_at
              from report_schedule s
              join farm f on f.farm_id = s.farm_id
             where s.enabled
               and lower(coalesce(f.status, 'active')) <> 'inactive'
            """,
            connection);

        await using var reader = await cmd.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct))
        {
            results.Add(new DueSchedule(
                reader.GetInt64(0),
                reader.GetInt64(1),
                reader.IsDBNull(2) ? null : reader.GetGuid(2),
                reader.GetString(3),
                reader.IsDBNull(4) ? Array.Empty<string>() : reader.GetFieldValue<string[]>(4),
                reader.IsDBNull(5) ? null : reader.GetFieldValue<long[]>(5),
                reader.IsDBNull(6) ? null : reader.GetFieldValue<DateTimeOffset>(6)));
        }

        return results;
    }

    private async Task<int> QueueReportsAsync(
        DueSchedule schedule, DateOnly start, DateOnly end, CancellationToken ct)
    {
        await using var connection = await _dataSource.OpenConnectionAsync(ct);

        // The zones this schedule covers. Resolved now rather than stored,
        // so a zone added to the farm since the schedule was set up is
        // included, and a deleted one quietly drops out.
        var zoneIds = schedule.ZoneIds is { Length: > 0 }
            ? schedule.ZoneIds
            : await LoadFarmZonesAsync(connection, schedule.FarmId, ct);

        var created = 0;

        foreach (var reportType in schedule.ReportTypes)
        {
            if (!ReportKinds.IsValid(reportType)) continue;

            // A moisture report is per zone, so an "all reports" schedule on a
            // four-zone farm produces four of them. The other two are per farm
            // and produce one each however many zones there are.
            if (ReportKinds.RequiresZone(reportType))
            {
                foreach (var zoneId in zoneIds)
                {
                    created += await InsertIfAbsentAsync(
                        connection, schedule, reportType, zoneId, start, end, ct);
                }
            }
            else
            {
                created += await InsertIfAbsentAsync(
                    connection, schedule, reportType, null, start, end, ct);
            }
        }

        return created;
    }

    private static async Task<long[]> LoadFarmZonesAsync(
        NpgsqlConnection connection, long farmId, CancellationToken ct)
    {
        var ids = new List<long>();

        await using var cmd = new NpgsqlCommand(
            "select id from zone where farm_id = $1 " +
            "and lower(coalesce(status, 'active')) <> 'inactive' order by id", connection);
        cmd.Parameters.AddWithValue(farmId);

        await using var reader = await cmd.ExecuteReaderAsync(ct);
        while (await reader.ReadAsync(ct)) ids.Add(reader.GetInt64(0));

        return ids.ToArray();
    }

    // The belt to IsDue's braces.
    //
    // IsDue already stops a second run in the same day, but this makes the
    // whole sweep safe to repeat for any reason at all - two containers
    // briefly overlapping during a deploy, a clock stepping backwards, a
    // manual re-run. The `not exists` is scoped to requested_via = 'auto', so
    // it can never suppress a report the FARMER asked for that happens to
    // cover the same period.
    private static async Task<int> InsertIfAbsentAsync(
        NpgsqlConnection connection,
        DueSchedule schedule,
        string reportType,
        long? zoneId,
        DateOnly start,
        DateOnly end,
        CancellationToken ct)
    {
        await using var cmd = new NpgsqlCommand(
            """
            insert into report_request
                (profile_id, farm_id, zone_id, report_type, period_start, period_end, requested_via)
            select $1, $2, $3, $4, $5, $6, 'auto'
             where not exists (
                   select 1 from report_request r
                    where r.farm_id = $2
                      and r.report_type = $4
                      and r.period_start = $5
                      and r.period_end = $6
                      and r.requested_via = 'auto'
                      and r.zone_id is not distinct from $3)
            """,
            connection);

        cmd.Parameters.AddWithValue(schedule.OwnerId!.Value);
        cmd.Parameters.AddWithValue(schedule.FarmId);
        cmd.Parameters.AddWithValue(NpgsqlDbType.Bigint, (object?)zoneId ?? DBNull.Value);
        cmd.Parameters.AddWithValue(reportType);
        cmd.Parameters.AddWithValue(NpgsqlDbType.Date, start);
        cmd.Parameters.AddWithValue(NpgsqlDbType.Date, end);

        return await cmd.ExecuteNonQueryAsync(ct);
    }

    private async Task MarkRunAsync(long scheduleId, CancellationToken ct)
    {
        await using var connection = await _dataSource.OpenConnectionAsync(ct);

        await using var cmd = new NpgsqlCommand(
            "update report_schedule set last_run_at = now() where id = $1", connection);
        cmd.Parameters.AddWithValue(scheduleId);

        await cmd.ExecuteNonQueryAsync(ct);
    }
}
