using AgroFlow.Api.Services.Notifications;
using Microsoft.Extensions.Options;
using Npgsql;

namespace AgroFlow.Api.Services;

// Finds equipment that has stopped working and tells the farmer, because a farmer
// only opens the app when they think of it, and a silent pump is exactly what they
// are not thinking about.
// Three sweeps:
//   1. Devices that have gone quiet (and come back).
//   2. Pumps that never confirmed a watering command.
//   3. Zones whose sensor has stopped reporting, or that have nothing able to
//      control them.
// A device counts as alive by the newer of hardware.last_seen (set by MQTT, which
// knows the device) and the newest sensor_reading in its zone (all the HTTP path
// gives). So two devices in one zone look alive together; the real fix is device
// identity on the HTTP endpoint.
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

        // Wait one interval before the first sweep, so devices that were quiet during a
        // redeploy can report in first.
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
                // A failed sweep must not kill the service: an unhandled exception in a
                // BackgroundService stops the whole host, including irrigation.
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

    // 1. Devices going quiet, and coming back

    private async Task SweepDeviceStatusAsync(TimeSpan offlineAfter, CancellationToken cancellationToken)
    {
        var transitions = new List<(long HardwareId, long FarmId, string FarmName, string DeviceName, bool Online, DateTimeOffset LastSeen)>();

        // One statement does the whole sweep: work out each device's real last activity,
        // flip only the rows whose status is wrong, and return just those. A device that is
        // already Offline and still quiet matches nothing, so it is only messaged once.
        const string sql =
            """
            with activity as (
                select h.hardware_id,
                       h.status,
                       h.status_reported_at,
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
                       -- A kit on 1.7.2 that said "offline" itself (its last will) stays Offline until
                       -- it says it is back; older activity does not count (0063).
                       case when last_activity < now() - $1 then 'Offline'
                            when status = 'Offline' and status_reported_at >= last_activity then 'Offline'
                            else 'Online' end as should_be
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

            // Already only on changes, but the ledger also limits a device that flaps around
            // the threshold to one message of each kind per day.
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

    // 2. Pumps that never confirmed a command

    private async Task SweepUnresponsivePumpsAsync(TimeSpan pumpAfter, CancellationToken cancellationToken)
    {
        // A command stays 'pending' until the device confirms it, so one still pending long
        // after the device's polling interval was never carried out. 'failed' is included
        // because nothing else tells the farmer about those.
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
            // This sweep is polled, so the ledger is what stops it re-sending every time:
            // one message per zone per day.
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

    // 3. Sensors gone silent, and zones nothing can control

    private async Task SweepSilentSensorsAsync(TimeSpan sensorAfter, CancellationToken cancellationToken)
    {
        // Two faults in one query, told apart by whether the zone has an active device:
        //   - a device, but no readings for a long time -> sensor problem
        //   - no active device                          -> nothing can water it
        // Zones that never reported are included: an installed but unwired zone is exactly
        // the silent failure we want to catch. The ledger limits it to once a day.
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
