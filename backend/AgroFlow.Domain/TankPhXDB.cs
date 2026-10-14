#nullable enable
using System;
using System.Collections.Generic;
using AgroFlow.Business;
using Npgsql;
using NpgsqlTypes;

namespace AgroFlow.Data
{
    // Data side of the existing DB / XDB / Controller pattern. Tank estimates
    // are read from recorded pump runtimes; they never write irrigation inputs.
    public sealed class TankPhXDB : DB
    {
        private readonly string connectionString;

        public TankPhXDB(string connectionString) : base(connectionString)
        {
            this.connectionString = connectionString;
        }

        private NpgsqlConnection Open()
        {
            var connection = new NpgsqlConnection(connectionString);
            connection.Open();
            return connection;
        }

        public bool CanAccessFarm(long farmId, Guid profileId)
        {
            const string sql = """
                select exists (
                  select 1 from farm f
                   where f.farm_id = $1
                     and (f.owner_id = $2
                       or exists (select 1 from farm_member fm where fm.farm_id = f.farm_id and fm.profile_id = $2)
                       or exists (select 1 from profile p where p.id = $2 and p.role = 'admin')))
                """;
            using var connection = Open();
            using var command = new NpgsqlCommand(sql, connection);
            command.Parameters.AddWithValue(farmId);
            command.Parameters.AddWithValue(profileId);
            return command.ExecuteScalar() is true;
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

        public void SetCapacity(long farmId, decimal litres)
        {
            using var connection = Open();
            using var command = new NpgsqlCommand(
                "update farm set tank_capacity_litres = $2, updated_at = now() where farm_id = $1", connection);
            command.Parameters.AddWithValue(farmId);
            command.Parameters.AddWithValue(litres);
            command.ExecuteNonQuery();
        }

        public TankStatus? GetTankStatus(long farmId, DateTimeOffset at)
        {
            const string sql = """
                select f.farm_id, f.name, f.tank_capacity_litres,
                       r.id, r.litres_added, r.refilled_at, r.water_ph
                  from farm f
                  left join lateral (
                    select tr.id, tr.litres_added, tr.refilled_at, tr.water_ph
                      from tank_refill tr
                     where tr.farm_id = f.farm_id and tr.refilled_at <= $2
                     order by tr.refilled_at desc, tr.id desc limit 1
                  ) r on true
                 where f.farm_id = $1
                """;

            using var connection = Open();
            using var command = new NpgsqlCommand(sql, connection);
            command.Parameters.AddWithValue(farmId);
            command.Parameters.AddWithValue(NpgsqlDbType.TimestampTz, at);
            using var reader = command.ExecuteReader();
            if (!reader.Read()) return null;

            var status = new TankStatus
            {
                FarmId = reader.GetInt64(0),
                FarmName = reader.GetString(1),
                CapacityLitres = reader.IsDBNull(2) ? null : reader.GetDecimal(2),
                LastRefillId = reader.IsDBNull(3) ? null : reader.GetInt64(3),
                LastRefillLitres = reader.IsDBNull(4) ? null : reader.GetDecimal(4),
                LastRefilledAt = reader.IsDBNull(5) ? null : reader.GetFieldValue<DateTimeOffset>(5),
                LatestWaterPh = reader.IsDBNull(6) ? null : reader.GetDecimal(6),
            };
            reader.Close();

            if (status.CapacityLitres is { } capacity
                && status.LastRefillLitres is { } refill
                && status.LastRefilledAt is { } since)
            {
                status.EstimatedUsedLitres = EstimateUsed(connection, farmId, since, at);
                status.EstimatedRemainingLitres = TankPhRules.EstimateRemaining(
                    refill, status.EstimatedUsedLitres, capacity);
                status.IsLow = TankPhRules.IsLow(status.EstimatedRemainingLitres.Value, capacity);
            }

            status.WaterPhWarning = TankPhRules.WaterWarning(status.LatestWaterPh);
            return status;
        }

        private static decimal EstimateUsed(
            NpgsqlConnection connection, long farmId, DateTimeOffset from, DateTimeOffset to)
        {
            const string sql = """
                select coalesce(sum(coalesce(e.runtime_seconds, 0)::numeric / 60 * z.flow_rate_lpm), 0)
                  from irrigation_event e
                  join zone z on z.id = e.zone_id
                 where z.farm_id = $1
                   and e.started_at > $2
                   and e.started_at <= $3
                   and coalesce(e.runtime_seconds, 0) > 0
                   and z.flow_rate_lpm > 0
                """;
            using var command = new NpgsqlCommand(sql, connection);
            command.Parameters.AddWithValue(farmId);
            command.Parameters.AddWithValue(NpgsqlDbType.TimestampTz, from);
            command.Parameters.AddWithValue(NpgsqlDbType.TimestampTz, to);
            return Convert.ToDecimal(command.ExecuteScalar());
        }

        public void InsertRefill(
            long farmId, decimal litres, decimal? waterPh, DateTimeOffset at, Guid profileId,
            decimal? estimatedUsed, decimal? observedUsed)
        {
            const string sql = """
                insert into tank_refill (
                    farm_id, litres_added, water_ph, refilled_at, logged_by_profile_id,
                    estimated_used_since_previous, observed_used_since_previous)
                values ($1, $2, $3, $4, $5, $6, $7)
                """;
            using var connection = Open();
            using var command = new NpgsqlCommand(sql, connection);
            command.Parameters.AddWithValue(farmId);
            command.Parameters.AddWithValue(litres);
            command.Parameters.AddWithValue(NpgsqlDbType.Numeric, (object?)waterPh ?? DBNull.Value);
            command.Parameters.AddWithValue(NpgsqlDbType.TimestampTz, at);
            command.Parameters.AddWithValue(profileId);
            command.Parameters.AddWithValue(NpgsqlDbType.Numeric, (object?)estimatedUsed ?? DBNull.Value);
            command.Parameters.AddWithValue(NpgsqlDbType.Numeric, (object?)observedUsed ?? DBNull.Value);
            command.ExecuteNonQuery();
        }

        public List<SoilPhEntry> GetSoilPh(long zoneId, int limit = 20)
        {
            const string sql = """
                select id, zone_id, ph, measured_at, note
                  from soil_ph_log where zone_id = $1
                 order by measured_at desc, id desc limit $2
                """;
            var rows = new List<SoilPhEntry>();
            using var connection = Open();
            using var command = new NpgsqlCommand(sql, connection);
            command.Parameters.AddWithValue(zoneId);
            command.Parameters.AddWithValue(Math.Clamp(limit, 1, 100));
            using var reader = command.ExecuteReader();
            while (reader.Read())
            {
                rows.Add(new SoilPhEntry
                {
                    Id = reader.GetInt64(0),
                    ZoneId = reader.GetInt64(1),
                    Ph = reader.GetDecimal(2),
                    MeasuredAt = reader.GetFieldValue<DateTimeOffset>(3),
                    Note = reader.IsDBNull(4) ? null : reader.GetString(4),
                });
            }
            return rows;
        }

        public List<ZoneSoilPhSummary> GetFarmSoilPh(long farmId)
        {
            const string sql = """
                select z.id, coalesce(nullif(z.name, ''), 'Unnamed zone'),
                       p.id, p.ph, p.measured_at, p.note
                  from zone z
                  left join lateral (
                    select id, ph, measured_at, note from soil_ph_log
                     where zone_id = z.id order by measured_at desc, id desc limit 1
                  ) p on true
                 where z.farm_id = $1
                 order by z.id
                """;
            var rows = new List<ZoneSoilPhSummary>();
            using var connection = Open();
            using var command = new NpgsqlCommand(sql, connection);
            command.Parameters.AddWithValue(farmId);
            using var reader = command.ExecuteReader();
            while (reader.Read())
            {
                var zoneId = reader.GetInt64(0);
                rows.Add(new ZoneSoilPhSummary
                {
                    ZoneId = zoneId,
                    ZoneName = reader.GetString(1),
                    Latest = reader.IsDBNull(2) ? null : new SoilPhEntry
                    {
                        Id = reader.GetInt64(2), ZoneId = zoneId, Ph = reader.GetDecimal(3),
                        MeasuredAt = reader.GetFieldValue<DateTimeOffset>(4),
                        Note = reader.IsDBNull(5) ? null : reader.GetString(5),
                    },
                });
            }
            return rows;
        }

        public SoilPhEntry InsertSoilPh(
            long zoneId, decimal ph, DateTimeOffset measuredAt, string? note, Guid profileId)
        {
            const string sql = """
                insert into soil_ph_log (zone_id, ph, measured_at, note, logged_by_profile_id)
                values ($1, $2, $3, $4, $5)
                returning id
                """;
            using var connection = Open();
            using var command = new NpgsqlCommand(sql, connection);
            command.Parameters.AddWithValue(zoneId);
            command.Parameters.AddWithValue(ph);
            command.Parameters.AddWithValue(NpgsqlDbType.TimestampTz, measuredAt);
            command.Parameters.AddWithValue(NpgsqlDbType.Text, (object?)note ?? DBNull.Value);
            command.Parameters.AddWithValue(profileId);
            return new SoilPhEntry
            {
                Id = Convert.ToInt64(command.ExecuteScalar()),
                ZoneId = zoneId,
                Ph = ph,
                MeasuredAt = measuredAt,
                Note = note,
            };
        }

        public List<long> GetConfiguredFarmIds()
        {
            var ids = new List<long>();
            using var connection = Open();
            using var command = new NpgsqlCommand(
                "select farm_id from farm where tank_capacity_litres is not null and lower(status) <> 'archived'", connection);
            using var reader = command.ExecuteReader();
            while (reader.Read()) ids.Add(reader.GetInt64(0));
            return ids;
        }

        // True only for the first open low-level alert, which is what triggers Telegram.
        public bool SetLowAlert(long farmId, bool low)
        {
            using var connection = Open();
            if (!low)
            {
                using var resolve = new NpgsqlCommand(
                    "update alert set status = 'Resolved', updated_at = now() " +
                    "where farm_id = $1 and zone_id is null and message = $2 and status = 'Open'", connection);
                resolve.Parameters.AddWithValue(farmId);
                resolve.Parameters.AddWithValue(TankPhRules.LowTankMessage);
                resolve.ExecuteNonQuery();
                return false;
            }

            const string sql = """
                insert into alert (farm_id, zone_id, severity, message, status)
                select $1, null, 'Warning', $2, 'Open'
                 where not exists (
                   select 1 from alert
                    where farm_id = $1 and zone_id is null and message = $2 and status = 'Open')
                on conflict do nothing
                """;
            using var insert = new NpgsqlCommand(sql, connection);
            insert.Parameters.AddWithValue(farmId);
            insert.Parameters.AddWithValue(TankPhRules.LowTankMessage);
            return insert.ExecuteNonQuery() == 1;
        }
    }
}
