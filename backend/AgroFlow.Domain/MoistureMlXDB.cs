#nullable enable
using System;
using System.Collections.Generic;
using AgroFlow.Business;
using AgroFlow.Business.Agronomy;
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

    // One zone's daily history for retraining, in the zone's own sensor units.
    public sealed class MoistureTrainingZone
    {
        public long ZoneId { get; set; }
        public string SoilType { get; set; } = Fao56EngineReference.DefaultSoilKey;
        public bool FarmIsSimulated { get; set; }
        public double? CalibrationWet { get; set; }
        public double? CalibrationDry { get; set; }
        public List<(MoistureDay Day, double? RawReading, bool ReadingSimulated)> Days { get; } =
            new List<(MoistureDay, double?, bool)>();
    }

    // Reads for the machine learning features: fault checks, the forecast line and retraining.
    // Writes only fault alerts.
    public sealed class MoistureMlXDB : DB
    {
        private readonly string connectionString;
        public MoistureMlXDB(string connectionString) : base(connectionString) => this.connectionString = connectionString;

        private NpgsqlConnection Open()
        {
            var connection = new NpgsqlConnection(connectionString);
            connection.Open();
            return connection;
        }

        public bool CanAccessZone(long zoneId, Guid profileId)
        {
            const string sql = """
                select exists (
                  select 1 from zone z join farm f on f.farm_id = z.farm_id
                   where z.id = $1
                     and (f.owner_id = $2
                       or exists (select 1 from farm_member fm where fm.farm_id = f.farm_id and fm.profile_id = $2)
                       or exists (select 1 from profile p where p.id = $2 and p.role = 'admin')))
                """;
            using var connection = Open();
            using var command = new NpgsqlCommand(sql, connection);
            command.Parameters.AddWithValue(zoneId);
            command.Parameters.AddWithValue(profileId);
            return command.ExecuteScalar() is true;
        }

        public bool IsSimulatedZone(long zoneId)
        {
            const string sql = "select f.is_simulated from zone z join farm f on f.farm_id = z.farm_id where z.id = $1";
            using var connection = Open();
            using var command = new NpgsqlCommand(sql, connection);
            command.Parameters.AddWithValue(zoneId);
            return command.ExecuteScalar() is true;
        }

        // Days (SAST) in the last week with at least one soil moisture reading.
        public int ReadingDaysInLastWeek(long zoneId)
        {
            const string sql = """
                select count(distinct (recorded_at at time zone 'Africa/Johannesburg')::date)
                  from sensor_reading
                 where zone_id = $1 and sensor_type = 'SoilMoisture'
                   and recorded_at >= now() - interval '7 days'
                """;
            using var connection = Open();
            using var command = new NpgsqlCommand(sql, connection);
            command.Parameters.AddWithValue(zoneId);
            return Convert.ToInt32(command.ExecuteScalar());
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

        // Days with enough rain to explain a jump in moisture.
        public HashSet<DateOnly> GetRainDays(long farmId, DateOnly from, double minRainMm)
        {
            const string sql = """
                select date from weather_daily
                 where farm_id = $1 and date >= $2 and coalesce(precipitation_mm, 0) >= $3
                """;
            var days = new HashSet<DateOnly>();
            using var connection = Open();
            using var command = new NpgsqlCommand(sql, connection);
            command.Parameters.AddWithValue(farmId);
            command.Parameters.AddWithValue(from);
            command.Parameters.AddWithValue((float)minRainMm);
            using var reader = command.ExecuteReader();
            while (reader.Read()) days.Add(reader.GetFieldValue<DateOnly>(0));
            return days;
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

        // The last year of every zone's balance rows, each with that day's last soil
        // moisture reading and its provenance (sensor_reading.simulated).
        public List<MoistureTrainingZone> GetTrainingHistory()
        {
            const string sql = """
                select z.id, coalesce(z.soil_type, 'loam'), f.is_simulated, z.calibration_wet, z.calibration_dry,
                       b.day, b.stage, b.kc, b.etc_mm, b.p, b.taw_mm, b.raw_mm, b.rain_mm, b.irrigation_mm,
                       w.tmax_c, w.tmin_c, w.humidity_mean, r.value, coalesce(r.simulated, false)
                  from zone z
                  join farm f on f.farm_id = z.farm_id
                  join zone_water_balance b on b.zone_id = z.id
                  left join weather_daily w on w.farm_id = f.farm_id and w.date = b.day
                  left join lateral (
                    select s.value, s.simulated from sensor_reading s
                     where s.zone_id = z.id and s.sensor_type = 'SoilMoisture'
                       and (s.recorded_at at time zone 'Africa/Johannesburg')::date = b.day
                     order by s.recorded_at desc limit 1) r on true
                 where b.day >= current_date - 365
                 order by z.id, b.day
                """;
            var zones = new Dictionary<long, MoistureTrainingZone>();
            using var connection = Open();
            using var command = new NpgsqlCommand(sql, connection);
            using var reader = command.ExecuteReader();
            while (reader.Read())
            {
                var zoneId = reader.GetInt64(0);
                if (!zones.TryGetValue(zoneId, out var zone))
                {
                    zone = new MoistureTrainingZone
                    {
                        ZoneId = zoneId,
                        SoilType = reader.GetString(1),
                        FarmIsSimulated = reader.GetBoolean(2),
                        CalibrationWet = Nullable(reader, 3),
                        CalibrationDry = Nullable(reader, 4),
                    };
                    zones[zoneId] = zone;
                }

                var kc = Nullable(reader, 7);
                var etc = Nullable(reader, 8);
                var day = new MoistureDay
                {
                    Day = reader.GetFieldValue<DateOnly>(5),
                    Stage = ParseStage(reader.IsDBNull(6) ? null : reader.GetString(6)),
                    Kc = kc,
                    EtoMm = kc is > 0 && etc.HasValue ? etc / kc : null,
                    AdjustedP = Nullable(reader, 9),
                    TawMm = Nullable(reader, 10),
                    RawMm = Nullable(reader, 11),
                    RainMm = Nullable(reader, 12) ?? 0,
                    IrrigationMm = Nullable(reader, 13) ?? 0,
                    TMaxC = Nullable(reader, 14),
                    TMinC = Nullable(reader, 15),
                    HumidityPct = Nullable(reader, 16),
                };
                zone.Days.Add((day, Nullable(reader, 17), reader.GetBoolean(18)));
            }
            return new List<MoistureTrainingZone>(zones.Values);
        }

        private static double? Nullable(NpgsqlDataReader reader, int i)
            => reader.IsDBNull(i) ? null : Convert.ToDouble(reader.GetValue(i));

        // zone_water_balance.stage holds the farmer-facing label; null means the stage
        // was assumed, which the engine treats as peak growth.
        private static SeasonStage? ParseStage(string? label)
        {
            if (label == null) return SeasonStage.PeakGrowth;
            foreach (SeasonStage stage in Enum.GetValues(typeof(SeasonStage)))
                if (string.Equals(Fao56EngineReference.StageLabel(stage), label, StringComparison.OrdinalIgnoreCase))
                    return stage;
            return null;
        }
    }
}
