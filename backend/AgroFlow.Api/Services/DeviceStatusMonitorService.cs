using AgroFlow.Api.Services.Notifications;
using Microsoft.Extensions.Options;
using Npgsql;

namespace AgroFlow.Api.Services;

// Marks devices Offline when they stop reporting, Online when they come
// back, and tells the farmer on each TRANSITION - never on every check.
//
// WHY THIS EXISTS
// Before this service, nothing in AgroFlow ever wrote hardware.status after
// enrolment: a device was set to 'Online' the moment it enrolled and stayed
// that way forever, however long ago it had actually gone quiet. A farm left
// running unattended had no way of finding out that its hardware had dropped
// off, and the admin dashboard's "connected hardware" count was decorative.
//
// WHAT COUNTS AS ALIVE
// The greater of two signals:
//   - hardware.last_seen, stamped per-message by the MQTT path, which knows
//     exactly which device published.
//   - the newest sensor_reading in the device's zone, which is all the HTTP
//     ingestion path can offer, because POST /api/sensor-readings carries a
//     zoneId and no device identity at all.
// The zone fallback means two devices sharing one zone are treated as alive
// together. That is a real limitation, and the right fix is device identity
// on the HTTP endpoint rather than guesswork here.
public sealed class DeviceStatusMonitorService : BackgroundService
{
    private readonly NpgsqlDataSource _dataSource;
    private readonly INotificationService _notifications;
    private readonly DeviceMonitorOptions _options;
    private readonly ILogger<DeviceStatusMonitorService> _logger;

    public DeviceStatusMonitorService(
        NpgsqlDataSource dataSource,
        INotificationService notifications,
        IOptions<DeviceMonitorOptions> options,
        ILogger<DeviceStatusMonitorService> logger)
    {
        _dataSource = dataSource;
        _notifications = notifications;
        _options = options.Value;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!_options.Enabled)
        {
            _logger.LogInformation("Device status monitoring is disabled (DeviceMonitor:Enabled=false).");
            return;
        }

        var interval = TimeSpan.FromMinutes(Math.Max(1, _options.CheckIntervalMinutes));
        var offlineAfter = TimeSpan.FromMinutes(Math.Max(1, _options.OfflineAfterMinutes));

        _logger.LogInformation(
            "Device status monitoring started: a device is Offline after {OfflineAfter} without a reading, checked every {Interval}.",
            offlineAfter, interval);

        // A first sweep at startup would fire on everything that went quiet
        // while the API was being redeployed, so wait one interval first and
        // let live devices report in.
        using var timer = new PeriodicTimer(interval);

        while (await SafeWaitAsync(timer, stoppingToken))
        {
            try
            {
                await SweepAsync(offlineAfter, stoppingToken);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                // Never let a bad sweep kill the service: an unhandled
                // exception out of a BackgroundService stops the whole host
                // under the default BackgroundServiceExceptionBehavior, which
                // would take irrigation down with it.
                _logger.LogError(ex, "Device status sweep failed; will retry on the next interval.");
            }
        }
    }

    private static async Task<bool> SafeWaitAsync(PeriodicTimer timer, CancellationToken stoppingToken)
    {
        try
        {
            return await timer.WaitForNextTickAsync(stoppingToken);
        }
        catch (OperationCanceledException)
        {
            return false;
        }
    }

    private async Task SweepAsync(TimeSpan offlineAfter, CancellationToken cancellationToken)
    {
        var transitions = new List<(long HardwareId, bool Online, DateTimeOffset? LastSeen)>();

        // One statement does the whole sweep: compute each device's real last
        // activity, flip only the rows whose stored status disagrees with it,
        // and return exactly those rows. `returning` is what makes this
        // transition-only - a device that is already Offline and still quiet
        // matches no row, so it produces no message, however many times this
        // runs.
        const string sql =
            """
            with activity as (
                select h.hardware_id,
                       h.status,
                       greatest(
                           h.last_seen,
                           coalesce(
                               (select max(sr.recorded_at)
                                  from sensor_reading sr
                                 where sr.zone_id = h.zone_id),
                               h.last_seen)
                       ) as last_activity
                  from hardware h
                 where h.zone_id is not null
                   and h.enrollment_status = 'active'
            ),
            decided as (
                select hardware_id,
                       status,
                       last_activity,
                       case when last_activity < now() - $1 then 'Offline' else 'Online' end as should_be
                  from activity
            )
            update hardware h
               set status = d.should_be,
                   last_seen = greatest(h.last_seen, d.last_activity)
              from decided d
             where h.hardware_id = d.hardware_id
               and d.status is distinct from d.should_be
            returning h.hardware_id, h.status, d.last_activity
            """;

        await using (var connection = await _dataSource.OpenConnectionAsync(cancellationToken))
        {
            await using var command = new NpgsqlCommand(sql, connection);
            command.Parameters.AddWithValue(offlineAfter);

            await using var reader = await command.ExecuteReaderAsync(cancellationToken);

            while (await reader.ReadAsync(cancellationToken))
            {
                var hardwareId = reader.GetInt64(0);
                var online = reader.GetString(1) == "Online";
                var lastActivity = reader.GetFieldValue<DateTimeOffset>(2);

                transitions.Add((hardwareId, online, lastActivity));
            }
        }

        if (transitions.Count == 0) return;

        foreach (var (hardwareId, online, lastSeen) in transitions)
        {
            _logger.LogInformation(
                "Device {HardwareId} transitioned to {Status} (last activity {LastSeen}).",
                hardwareId, online ? "Online" : "Offline", lastSeen);

            // INotificationService never throws, so one unreachable farmer
            // cannot stop the rest of the sweep being reported.
            await _notifications.NotifyDeviceStatusAsync(hardwareId, online, lastSeen, cancellationToken);
        }
    }
}
