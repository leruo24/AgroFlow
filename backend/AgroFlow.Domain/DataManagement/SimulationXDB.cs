#nullable enable
using System;
using System.Collections.Generic;
using AgroFlow.Business;
using Npgsql;

namespace AgroFlow.Data
{
    public sealed class SimulationXDB : DB
    {
        private readonly string connectionString;
        public SimulationXDB(string connectionString) : base(connectionString) => this.connectionString = connectionString;

        private NpgsqlConnection Open()
        {
            var connection = new NpgsqlConnection(connectionString);
            connection.Open();
            return connection;
        }

        public List<SimulationTarget> GetTargets(DateOnly day)
        {
            // Three independent guards: flagged farm, real Open-Meteo weather for that
            // location/day, and no simulated reading already written for the day.
            const string sql = """
                select f.farm_id, z.id, b.day, b.dr_end_mm, b.taw_mm
                  from farm f
                  join zone z on z.farm_id = f.farm_id
                  join zone_water_balance b on b.zone_id = z.id and b.day = $1
                  join weather_daily w on w.farm_id = f.farm_id and w.date = b.day
                 where f.is_simulated = true
                   and lower(coalesce(f.status, 'active')) <> 'inactive'
                   and w.source like 'open-meteo-%'
                   and b.dr_end_mm is not null and b.taw_mm > 0
                   and not exists (
                     select 1 from sensor_reading r
                      where r.zone_id = z.id and r.sensor_type = 'SoilMoisture'
                        and r.simulated = true and r.simulation_day = $1)
                """;
            var targets = new List<SimulationTarget>();
            using var connection = Open();
            using var command = new NpgsqlCommand(sql, connection);
            command.Parameters.AddWithValue(day);
            using var reader = command.ExecuteReader();
            while (reader.Read())
            {
                targets.Add(new SimulationTarget
                {
                    FarmId = reader.GetInt64(0), ZoneId = reader.GetInt64(1), Day = reader.GetFieldValue<DateOnly>(2),
                    DepletionMm = Convert.ToDouble(reader.GetValue(3)),
                    TotalAvailableWaterMm = Convert.ToDouble(reader.GetValue(4)),
                });
            }
            return targets;
        }

        public bool InsertReading(SimulationTarget target, double moisture, DateTimeOffset recordedAt)
        {
            // Re-check the farm flag in the INSERT itself. Even a stale/injected target
            // therefore cannot write simulated data to a real farm.
            const string sql = """
                insert into sensor_reading (zone_id, sensor_type, value, recorded_at, simulated, simulation_day)
                select z.id, 'SoilMoisture', $2, $3, true, $4
                  from zone z join farm f on f.farm_id = z.farm_id
                 where z.id = $1 and f.is_simulated = true
                on conflict do nothing
                """;
            using var connection = Open();
            using var command = new NpgsqlCommand(sql, connection);
            command.Parameters.AddWithValue(target.ZoneId);
            command.Parameters.AddWithValue((float)moisture);
            command.Parameters.AddWithValue(recordedAt.ToUniversalTime());
            command.Parameters.AddWithValue(target.Day);
            return command.ExecuteNonQuery() == 1;
        }
    }
}
