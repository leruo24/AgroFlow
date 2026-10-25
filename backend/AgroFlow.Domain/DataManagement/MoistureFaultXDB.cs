#nullable enable
using System;
using System.Collections.Generic;
using AgroFlow.Business;
using Npgsql;

namespace AgroFlow.Data
{
    public sealed class MoistureFaultZone
    {
        public long ZoneId { get; set; }
        public long FarmId { get; set; }
        public double? CalibrationWet { get; set; }
        public double? CalibrationDry { get; set; }
    }

    public sealed class RawMoistureReading
    {
        public DateTime AtUtc { get; set; }
        public double Value { get; set; }
    }

    // Reads for the rule-based fault checks. Writes only fault alerts.
    public sealed class MoistureFaultXDB : DB
    {
        private readonly string connectionString;
        public MoistureFaultXDB(string connectionString) : base(connectionString) => this.connectionString = connectionString;

        private NpgsqlConnection Open()
        {
            var connection = new NpgsqlConnection(connectionString);
            connection.Open();
            return connection;
        }

        // Zones with a soil moisture reading in the last two days.
        public List<MoistureFaultZone> GetActiveZones()
        {
            const string sql = """
                select z.id, z.farm_id, z.calibration_wet, z.calibration_dry
                  from zone z join farm f on f.farm_id = z.farm_id
                 where lower(coalesce(f.status, 'active')) <> 'inactive'
                   and exists (select 1 from sensor_reading r
                                where r.zone_id = z.id and r.sensor_type = 'SoilMoisture'
                                  and r.recorded_at >= now() - interval '2 days')
                """;
            var zones = new List<MoistureFaultZone>();
            using var connection = Open();
            using var command = new NpgsqlCommand(sql, connection);
            using var reader = command.ExecuteReader();
            while (reader.Read())
            {
                zones.Add(new MoistureFaultZone
                {
                    ZoneId = reader.GetInt64(0),
                    FarmId = reader.GetInt64(1),
                    CalibrationWet = reader.IsDBNull(2) ? null : Convert.ToDouble(reader.GetValue(2)),
                    CalibrationDry = reader.IsDBNull(3) ? null : Convert.ToDouble(reader.GetValue(3)),
                });
            }
            return zones;
        }

        public List<RawMoistureReading> GetReadings(long zoneId, DateTime sinceUtc)
        {
            const string sql = """
                select recorded_at, value from sensor_reading
                 where zone_id = $1 and sensor_type = 'SoilMoisture' and recorded_at >= $2
                 order by recorded_at
                """;
            var readings = new List<RawMoistureReading>();
            using var connection = Open();
            using var command = new NpgsqlCommand(sql, connection);
            command.Parameters.AddWithValue(zoneId);
            command.Parameters.AddWithValue(DateTime.SpecifyKind(sinceUtc, DateTimeKind.Utc));
            using var reader = command.ExecuteReader();
            while (reader.Read())
                readings.Add(new RawMoistureReading { AtUtc = reader.GetDateTime(0).ToUniversalTime(), Value = Convert.ToDouble(reader.GetValue(1)) });
            return readings;
        }

        public List<PumpRun> GetPumpRuns(long zoneId, DateTime sinceUtc)
        {
            const string sql = """
                select started_at, duration_seconds from irrigation_event
                 where zone_id = $1 and started_at >= $2 and duration_seconds > 0
                 order by started_at
                """;
            var runs = new List<PumpRun>();
            using var connection = Open();
            using var command = new NpgsqlCommand(sql, connection);
            command.Parameters.AddWithValue(zoneId);
            command.Parameters.AddWithValue(DateTime.SpecifyKind(sinceUtc, DateTimeKind.Utc));
            using var reader = command.ExecuteReader();
            while (reader.Read())
                runs.Add(new PumpRun { StartedAtUtc = reader.GetDateTime(0).ToUniversalTime(), DurationSeconds = reader.GetInt32(1) });
            return runs;
        }

        // One open fault alert per zone: a second fault while one is open adds nothing.
        public bool InsertFaultAlert(long farmId, long zoneId, string message)
        {
            const string sql = """
                insert into alert (farm_id, zone_id, severity, message, status)
                select $1, $2, 'Warning', $3, 'Open'
                 where not exists (
                   select 1 from alert
                    where zone_id = $2 and status = 'Open' and message like $4)
                """;
            using var connection = Open();
            using var command = new NpgsqlCommand(sql, connection);
            command.Parameters.AddWithValue(farmId);
            command.Parameters.AddWithValue(zoneId);
            command.Parameters.AddWithValue(message);
            command.Parameters.AddWithValue(MoistureFaultRules.MessagePrefix + "%");
            return command.ExecuteNonQuery() == 1;
        }
    }
}
