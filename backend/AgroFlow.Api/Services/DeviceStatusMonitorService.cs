using AgroFlow.Api.Services.Notifications;
using Microsoft.Extensions.Options;
using Npgsql;

namespace AgroFlow.Api.Services;

// Finds equipment that has stopped working and tells the farmer, because this
// is the class of problem the app cannot surface on its own: a farmer only
// opens the app when they think about it, and a pump that silently stopped
// working is precisely the thing they are not thinking about.
//
// Three sweeps, each with its own signature:
//   1. Devices that have gone quiet (and come back).
//   2. Pumps that never acknowledged a watering command.
//   3. Zones whose sensor has stopped reporting, or that have nothing able to
//      control them at all.
//
// WHY THIS EXISTS
// Before this service, nothing in AgroFlow ever wrote hardware.status after
// enrolment: a device was set to 'Online' the moment it enrolled and stayed
// that way forever, however long ago it had actually gone quiet. A farm left
// running unattended had no way of finding out that its hardware had dropped
// off.
//
// WHAT COUNTS AS ALIVE
// The greater of two signals: hardware.last_seen, stamped per-message by the
// MQTT path which knows exactly which device published; and the newest
// sensor_reading in the device's zone, which is all the HTTP ingestion path
// can offer, because POST /api/sensor-readings carries a zoneId and no device
// identity at all. The zone fallback means two devices sharing one zone are
// treated as alive together - a real limitation, whose right fix is device
// identity on the HTTP endpoint rather than guesswork here.
public sealed class DeviceStatusMonitorService : BackgroundService
{
    private readonly NpgsqlDataSource _dataSource;
    private readonly INotificationService _notifications;
    private readonly NotificationLedger _ledger;
    private readonly DeviceMonitorOptions _options;
    private readonly ILogger<DeviceStatusMonitorService> _logger;

    public DeviceStatusMonitorService(
        NpgsqlDataSource dataSource,
        INotificationService notifications,
        NotificationLedger ledger,
        IOptions<DeviceMonitorOptions> options,
        ILogger<DeviceStatusMonitorService> logger)
    {
        _dataSource = dataSource;
        _notifications = notifications;
        _ledger = ledger;
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
        var pumpAfter = TimeSpan.FromMinutes(Math.Max(1, _options.PumpUnresponsiveAfterMinutes));
        var sensorAfter = TimeSpan.FromMinutes(Math.Max(1, _options.SensorSilentAfterMinutes));

        _logger.LogInformation(
            "Equipment monitoring started: device offline after {OfflineAfter} without a reading, " +
            "pump unresponsive after {PumpAfter}, sensor silent after {SensorAfter}; checked every {Interval}.",
            offlineAfter, pumpAfter, sensorAfter, interval);

        // A first sweep at startup would fire on everything that went quiet
        // while the API was being redeployed, so wait one interval first and
        // let live devices report in.
        using var timer = new PeriodicTimer(interval);

        while (await SafeWaitAsync(timer, stoppingToken))
        {
            try
            {
                await SweepDeviceStatusAsync(offlineAfter, stoppingToken);
                await SweepUnresponsivePumpsAsync(pumpAfter, stoppingToken);
                await SweepSilentSensorsAsync(sensorAfter, stoppingToken);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                // Never let a bad sweep kill the service: an unhandled
                // exception out of a BackgroundService stops the whole host
                // under the default BackgroundServiceExceptionBehavior, which
                // would take irrigation down with it.
                _logger.LogError(ex, "Equipment sweep failed; will retry on the next interval.");
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

    // ------------------------------------------------------------------
    // 1. DEVICES GOING QUIET, AND COMING BACK
    // ------------------------------------------------------------------

    private async Task SweepDeviceStatusAsync(TimeSpan offlineAfter, CancellationToken cancellationToken)
    {
        var transitions = new List<(long HardwareId, long FarmId, string FarmName, string DeviceName, bool Online, DateTimeOffset LastSeen)>();

        // One statement does the whole sweep: compute each device's real last
        // activity, flip only the rows whose stored status disagrees with it,
        // and return exactly those rows. `returning` is what makes this
        // transition-only - a device that is already Offline and still quiet
        // matches no row, so it produces no message however many times this
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
            ),
            flipped as (
                update hardware h
                   set status = d.should_be,
                       last_seen = greatest(h.last_seen, d.last_activity)
                  from decided d
                 where h.hardware_id = d.hardware_id
                   and d.status is distinct from d.should_be
                returning h.hardware_id, h.zone_id, h.status, h.device_name, d.last_activity
            )
            select fl.hardware_id,
                   f.farm_id,
                   f.name,
                   coalesce(nullif(fl.device_name, ''), 'Unnamed device'),
                   fl.status,
                   fl.last_activity
              from flipped fl
              join zone z on z.id = fl.zone_id
              join farm f on f.farm_id = z.farm_id
            """;

        await using (var connection = await _dataSource.OpenConnectionAsync(cancellationToken))
        {
            await using var command = new NpgsqlCommand(sql, connection);
            command.Parameters.AddWithValue(offlineAfter);

            await using var reader = await command.ExecuteReaderAsync(cancellationToken);

            while (await reader.ReadAsync(cancellationToken))
            {
                transitions.Add((
                    reader.GetInt64(0),
                    reader.GetInt64(1),
                    reader.GetString(2),
                    reader.GetString(3),
                    reader.GetString(4) == "Online",
                    reader.GetFieldValue<DateTimeOffset>(5)));
            }
        }

        foreach (var t in transitions)
        {
            _logger.LogInformation(
                "Device {HardwareId} transitioned to {Status} (last activity {LastSeen}).",
                t.HardwareId, t.Online ? "Online" : "Offline", t.LastSeen);

            // Already transition-only, but the ledger also caps a device that
            // flaps across the threshold at one message of each kind per day.
            var alertType = $"{(t.Online ? "device_online" : "device_offline")}:{t.HardwareId}";

            if (!await _ledger.TryClaimAsync(t.FarmId, alertType, Today(), cancellationToken)) continue;

            await _notifications.NotifySystemFailureAsync(
                t.FarmId,
                new SystemFailureNotification(
                    t.Online ? SystemFailureKind.DeviceRecovered : SystemFailureKind.DeviceOffline,
                    t.DeviceName,
                    t.FarmName,
                    t.Online ? null : FormatLastSeen(t.LastSeen)),
                cancellationToken);
        }
    }

    // ------------------------------------------------------------------
    // 2. PUMPS THAT NEVER ACKNOWLEDGED A COMMAND
    // ------------------------------------------------------------------

    private async Task SweepUnresponsivePumpsAsync(TimeSpan pumpAfter, CancellationToken cancellationToken)
    {
        // A command sits 'pending' until the device confirms it, so one that
        // is still pending well past the device's polling interval means the
        // instruction was never carried out. 'failed' is included because
        // nothing else reports those to the farmer at all.
        const string sql =
            """
            select distinct z.id, f.farm_id, f.name, coalesce(nullif(z.name, ''), 'Unnamed zone'),
                   min(c.created_at) as oldest
              from irrigation_commands c
              join zone z on z.id = c.zone_id
              join farm f on f.farm_id = z.farm_id
             where (c.status = 'pending' and c.created_at < now() - $1)
                or (c.status = 'failed' and c.created_at > now() - interval '1 day')
             group by z.id, f.farm_id, f.name, z.name
            """;

        var stuck = new List<(long ZoneId, long FarmId, string FarmName, string ZoneName, DateTimeOffset Oldest)>();

        await using (var connection = await _dataSource.OpenConnectionAsync(cancellationToken))
        {
            await using var command = new NpgsqlCommand(sql, connection);
            command.Parameters.AddWithValue(pumpAfter);

            await using var reader = await command.ExecuteReaderAsync(cancellationToken);

            while (await reader.ReadAsync(cancellationToken))
            {
                stuck.Add((
                    reader.GetInt64(0),
                    reader.GetInt64(1),
                    reader.GetString(2),
                    reader.GetString(3),
                    reader.GetFieldValue<DateTimeOffset>(4)));
            }
        }

        foreach (var s in stuck)
        {
            // Polled rather than transition-based, so without the ledger this
            // would re-send on every sweep for as long as the command stayed
            // stuck. One per zone per day.
            if (!await _ledger.TryClaimAsync(s.FarmId, $"pump_unresponsive:{s.ZoneId}", Today(), cancellationToken))
            {
                continue;
            }

            _logger.LogWarning(
                "Zone {ZoneId} has an irrigation command unacknowledged since {Oldest}.",
                s.ZoneId, s.Oldest);

            await _notifications.NotifySystemFailureAsync(
                s.FarmId,
                new SystemFailureNotification(
                    SystemFailureKind.PumpUnresponsive,
                    s.ZoneName,
                    s.FarmName,
                    $"Instruction sent {FormatLastSeen(s.Oldest)} and still not confirmed."),
                cancellationToken);
        }
    }

    // ------------------------------------------------------------------
    // 3. SENSORS GONE SILENT, AND ZONES NOTHING CAN CONTROL
    // ------------------------------------------------------------------

    private async Task SweepSilentSensorsAsync(TimeSpan sensorAfter, CancellationToken cancellationToken)
    {
        // Two different faults with one query, distinguished by whether the
        // zone has any active device at all:
        //   - has a device, but no readings for a long time  -> sensor problem
        //   - has no active device                           -> nothing can
        //                                                       water it, ever
        //
        // Zones that have NEVER reported are included deliberately: a zone
        // installed and never wired up is exactly the silent failure worth
        // catching, and the ledger stops it being reported more than daily.
        const string sql =
            """
            select z.id,
                   f.farm_id,
                   f.name,
                   coalesce(nullif(z.name, ''), 'Unnamed zone'),
                   exists (select 1 from hardware h
                            where h.zone_id = z.id and h.enrollment_status = 'active') as has_device,
                   (select max(sr.recorded_at) from sensor_reading sr where sr.zone_id = z.id) as last_reading
              from zone z
              join farm f on f.farm_id = z.farm_id
             where coalesce(
                       (select max(sr.recorded_at) from sensor_reading sr where sr.zone_id = z.id),
                       'epoch'::timestamptz
                   ) < now() - $1
            """;

        var silent = new List<(long ZoneId, long FarmId, string FarmName, string ZoneName, bool HasDevice, DateTimeOffset? LastReading)>();

        await using (var connection = await _dataSource.OpenConnectionAsync(cancellationToken))
        {
            await using var command = new NpgsqlCommand(sql, connection);
            command.Parameters.AddWithValue(sensorAfter);

            await using var reader = await command.ExecuteReaderAsync(cancellationToken);

            while (await reader.ReadAsync(cancellationToken))
            {
                silent.Add((
                    reader.GetInt64(0),
                    reader.GetInt64(1),
                    reader.GetString(2),
                    reader.GetString(3),
                    reader.GetBoolean(4),
                    reader.IsDBNull(5) ? null : reader.GetFieldValue<DateTimeOffset>(5)));
            }
        }

        foreach (var s in silent)
        {
            var kind = s.HasDevice ? SystemFailureKind.SensorSilent : SystemFailureKind.ZoneUncontrollable;
            var alertType = $"{(s.HasDevice ? "sensor_silent" : "zone_uncontrollable")}:{s.ZoneId}";

            if (!await _ledger.TryClaimAsync(s.FarmId, alertType, Today(), cancellationToken)) continue;

            _logger.LogWarning(
                "Zone {ZoneId} has no recent readings (has active device: {HasDevice}, last reading {LastReading}).",
                s.ZoneId, s.HasDevice, s.LastReading);

            await _notifications.NotifySystemFailureAsync(
                s.FarmId,
                new SystemFailureNotification(
                    kind,
                    s.ZoneName,
                    s.FarmName,
                    s.LastReading is null
                        ? "This zone has never sent a reading."
                        : $"Last reading {FormatLastSeen(s.LastReading.Value)}."),
                cancellationToken);
        }
    }

    private static DateOnly Today() => DateOnly.FromDateTime(DateTime.UtcNow);

    private static string FormatLastSeen(DateTimeOffset lastSeen)
    {
        var age = DateTimeOffset.UtcNow - lastSeen;

        if (age < TimeSpan.FromMinutes(90)) return $"about {(int)age.TotalMinutes} minutes ago";
        if (age < TimeSpan.FromHours(48)) return $"about {(int)age.TotalHours} hours ago";

        return $"about {(int)age.TotalDays} days ago";
    }
}
