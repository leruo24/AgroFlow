using AgroFlow.Business;
using Npgsql;
using NpgsqlTypes;

namespace AgroFlow.Api.Services;

// Creates report_request rows for farms whose automatic schedule is due.
// It only fills the same queue as the app's Request button; ReportGenerationService
// renders both, so they behave the same.
// It runs hourly instead of a 07:00 cron, because a deploy at 06:58 would skip the
// week. The duplicate check is keyed on the period, so reports go out once
// whenever the service runs after 07:00 on the right day.
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

        // A first pass soon after start-up, so a deploy at 07:05 on a Monday still sends
        // that day's reports.
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
        string[] ReportTypes, long[]? ZoneIds, DateTimeOffset? LastRunAt,
        int? DayOfWeek, bool PerZonePdf);

    private async Task RunDueSchedulesAsync(CancellationToken ct)
    {
        var sastNow = ReportSchedulePolicy.ToSast(DateTimeOffset.UtcNow);

        var schedules = await LoadEnabledAsync(ct);
        if (schedules.Count == 0) return;

        foreach (var schedule in schedules)
        {
            if (ct.IsCancellationRequested) break;

            var frequency = ReportSchedulePolicy.ParseFrequency(schedule.Frequency);

            if (!ReportSchedulePolicy.IsDue(true, frequency, schedule.DayOfWeek, schedule.LastRunAt, sastNow))
            {
                continue;
            }

            if (schedule.OwnerId is null)
            {
                // No one to deliver to, and report_request.profile_id is NOT NULL. A farm whose
                // owner was removed needs a person to fix it, not hourly retries.
                _logger.LogWarning(
                    "Schedule {Id} on farm {FarmId} is due but the farm has no owner; skipping.",
                    schedule.Id, schedule.FarmId);

                continue;
            }

            var (start, end) = ReportSchedulePolicy.PeriodFor(frequency, schedule.DayOfWeek, sastNow);

            var created = await QueueReportsAsync(schedule, start, end, ct);

            // Stamped even when nothing was created (the rows already existed), because the
            // period is done; otherwise we would retry every hour.
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

        // Archived farms (0036) are left out: nobody should get weekly PDFs about them.
        await using var cmd = new NpgsqlCommand(
            """
            select s.id, s.farm_id, f.owner_id, s.frequency, s.report_types, s.zone_ids, s.last_run_at,
                   -- 0040's columns, read through jsonb so a database without
                   -- them still runs every schedule as before (Monday, one PDF).
                   (to_jsonb(s) ->> 'day_of_week')::int,
                   coalesce((to_jsonb(s) ->> 'per_zone_pdf')::boolean, false)
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
                reader.IsDBNull(6) ? null : reader.GetFieldValue<DateTimeOffset>(6),
                reader.IsDBNull(7) ? null : reader.GetInt32(7),
                reader.GetBoolean(8)));
        }

        return results;
    }

    private async Task<int> QueueReportsAsync(
        DueSchedule schedule, DateOnly start, DateOnly end, CancellationToken ct)
    {
        await using var connection = await _dataSource.OpenConnectionAsync(ct);

        // The zones this schedule covers, looked up now (not stored), so zones added since
        // are included and deleted ones drop out.
        var zoneIds = schedule.ZoneIds is { Length: > 0 }
            ? schedule.ZoneIds
            : await LoadFarmZonesAsync(connection, schedule.FarmId, ct);

        var created = 0;

        // Which PDFs: moisture is per zone; water usage and the schedule are one all-zones
        // PDF, or one per zone when per_zone_pdf is set; the farm summary covers the whole
        // farm (ReportSchedulePolicy).
        foreach (var (reportType, zoneId) in ReportSchedulePolicy.RequestsFor(
                     schedule.ReportTypes, schedule.PerZonePdf, zoneIds))
        {
            created += await InsertIfAbsentAsync(
                connection, schedule, reportType, zoneId, start, end, ct);
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

    // A second safety check on top of IsDue: this makes the sweep safe to repeat (two
    // containers during a deploy, a clock change, a manual re-run). `not exists` only
    // looks at requested_via = 'auto', so it never blocks a report the farmer asked for.
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
