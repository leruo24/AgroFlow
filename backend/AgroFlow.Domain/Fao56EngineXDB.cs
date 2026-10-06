#nullable enable
using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.Data;
using System.Linq;
using AgroFlow.Business.Agronomy;
using Npgsql;
using NpgsqlTypes;

namespace AgroFlow.Data
{
    // Data layer for the FAO-56 engine, in the project's DB / XDB shape: a
    // concrete class with no interface, no DTOs, and synchronous calls
    // throughout, reading and writing the Agronomy business objects directly.
    //
    // Unlike ZoneDB this does not go through DataSet/DataAdapter. The engine
    // reads several differently-shaped result sets per zone (weather days,
    // readings, irrigation totals) and writes idempotent upserts; a DataSet per
    // shape would add a mapping layer without buying anything, and the upserts
    // need ON CONFLICT, which DataAdapter cannot express. The layering is the
    // same - SQL lives here and nowhere else.
    //
    // Days are Africa/Johannesburg throughout, matching the report endpoints.
    // South Africa has no daylight saving, so UTC+2 is fixed.
    public class Fao56EngineXDB : DB
    {
        public const string DayTimeZone = "Africa/Johannesburg";

        // DB keeps its own copy privately, so the string is held here too rather
        // than widening the shared base class that other XDB classes depend on.
        private readonly string connectionString;

        public Fao56EngineXDB(string connectionString) : base(connectionString)
        {
            this.connectionString = connectionString;
        }

        private NpgsqlConnection Open()
        {
            var connection = new NpgsqlConnection(connectionString);
            connection.Open();
            return connection;
        }

        // ------------------------------------------------------------------
        // Zones the engine should run for.
        // ------------------------------------------------------------------
        public Collection<EngineZoneRow> GetZonesForFarm(long farmId)
        {
            return ReadZones("where z.farm_id = $1", cmd => cmd.Parameters.AddWithValue(farmId));
        }

        public Collection<EngineZoneRow> GetAllZones()
        {
            return ReadZones(string.Empty, null);
        }

        public EngineZoneRow? GetZone(long zoneId)
        {
            var rows = ReadZones("where z.id = $1", cmd => cmd.Parameters.AddWithValue(zoneId));
            return rows.Count > 0 ? rows[0] : null;
        }

        private Collection<EngineZoneRow> ReadZones(string whereClause, Action<NpgsqlCommand>? bind)
        {
            var sql =
                "select z.id, z.farm_id, z.name, z.crop_type, z.planting_date, " +
                "       z.soil_type, z.area_m2, z.flow_rate_lpm, z.root_depth_limit_m, " +
                "       z.calibration_wet, z.calibration_dry, " +
                "       z.moisture_threshold, z.desired_moisture, " +
                "       f.latitude, f.name " +
                "from zone z join farm f on f.farm_id = z.farm_id " +
                whereClause + " order by z.id";

            var rows = new Collection<EngineZoneRow>();

            using (var connection = Open())
            using (var cmd = new NpgsqlCommand(sql, connection))
            {
                if (bind != null) bind(cmd);

                using (var reader = cmd.ExecuteReader())
                {
                    while (reader.Read())
                    {
                        var id = reader.GetInt64(0);
                        rows.Add(new EngineZoneRow
                        {
                            ZoneId = id,
                            FarmId = reader.GetInt64(1),
                            ZoneName = reader.IsDBNull(2) ? "Zone " + id : reader.GetString(2),
                            CropType = reader.IsDBNull(3) ? null : reader.GetString(3),
                            PlantingDate = reader.IsDBNull(4) ? null : reader.GetFieldValue<DateOnly>(4),
                            SoilType = reader.IsDBNull(5) ? null : reader.GetString(5),
                            AreaM2 = Nullable(reader, 6),
                            FlowRateLpm = Nullable(reader, 7),
                            RootDepthLimitM = Nullable(reader, 8),
                            CalibrationWet = Nullable(reader, 9),
                            CalibrationDry = Nullable(reader, 10),
                            MoistureThreshold = Nullable(reader, 11),
                            DesiredMoisture = Nullable(reader, 12),
                            FarmLatitude = Nullable(reader, 13),
                            FarmName = reader.IsDBNull(14) ? "" : reader.GetString(14),
                        });
                    }
                }
            }

            return rows;
        }

        // ------------------------------------------------------------------
        // Weather for a farm, observed and forecast, plus the dht_daily values
        // for the same days.
        // ------------------------------------------------------------------
        public Collection<ZoneWeatherDay> GetWeather(long farmId, long zoneId, DateOnly from, DateOnly to)
        {
            // dht_daily is per zone; weather_daily is per farm. Joined on the day
            // so the engine gets one row per day with both sides on it.
            const string sql =
                "select w.date, w.tmin_c, w.tmax_c, w.precipitation_mm, " +
                "       w.rh_min_pct, w.rh_max_pct, w.humidity_mean, " +
                "       w.wind_ms, w.wind_height_m, w.is_forecast, " +
                "       d.tmin_c, d.tmax_c, d.rh_mean_pct " +
                "from weather_daily w " +
                "left join dht_daily d on d.day = w.date and d.zone_id = $2 " +
                "where w.farm_id = $1 and w.date between $3 and $4 " +
                "order by w.date";

            var days = new Collection<ZoneWeatherDay>();

            using (var connection = Open())
            using (var cmd = new NpgsqlCommand(sql, connection))
            {
                cmd.Parameters.AddWithValue(farmId);
                cmd.Parameters.AddWithValue(zoneId);
                cmd.Parameters.AddWithValue(NpgsqlDbType.Date, from);
                cmd.Parameters.AddWithValue(NpgsqlDbType.Date, to);

                using (var reader = cmd.ExecuteReader())
                {
                    while (reader.Read())
                    {
                        days.Add(new ZoneWeatherDay
                        {
                            Date = reader.GetFieldValue<DateOnly>(0),
                            TMinC = Nullable(reader, 1),
                            TMaxC = Nullable(reader, 2),
                            RainMm = Nullable(reader, 3),
                            RhMinPct = Nullable(reader, 4),
                            RhMaxPct = Nullable(reader, 5),
                            RhMeanPct = Nullable(reader, 6),
                            WindMs = Nullable(reader, 7),
                            WindHeightM = Nullable(reader, 8),
                            IsForecast = !reader.IsDBNull(9) && reader.GetBoolean(9),
                            DhtTMinC = Nullable(reader, 10),
                            DhtTMaxC = Nullable(reader, 11),
                            DhtRhMeanPct = Nullable(reader, 12),
                        });
                    }
                }
            }

            return days;
        }

        // ------------------------------------------------------------------
        // Soil moisture readings. Raw values, oldest first. Nothing is filtered
        // out here - the engine marks implausible readings and keeps the row.
        // ------------------------------------------------------------------
        public Collection<ZoneMoistureReading> GetMoistureReadings(long zoneId, DateTime sinceUtc)
        {
            const string sql =
                "select r.recorded_at, r.value from sensor_reading r " +
                "where r.zone_id = $1 and r.sensor_type = 'SoilMoisture' and r.recorded_at >= $2 " +
                "order by r.recorded_at";

            var readings = new Collection<ZoneMoistureReading>();

            using (var connection = Open())
            using (var cmd = new NpgsqlCommand(sql, connection))
            {
                cmd.Parameters.AddWithValue(zoneId);
                cmd.Parameters.AddWithValue(NpgsqlDbType.TimestampTz, sinceUtc);

                using (var reader = cmd.ExecuteReader())
                {
                    while (reader.Read())
                    {
                        readings.Add(new ZoneMoistureReading
                        {
                            RecordedAtUtc = reader.GetDateTime(0),
                            RawValue = Convert.ToDouble(reader.GetValue(1)),
                            IsValid = true,
                        });
                    }
                }
            }

            return readings;
        }

        // ------------------------------------------------------------------
        // Irrigation applied per day, as a depth in mm.
        //
        // Litres are ALWAYS runtime_seconds / 60 * zone.flow_rate_lpm -
        // irrigation_event.estimated_litres is never read, because the seeded
        // rows in it are wrong (120 L per event where the formula gives 22.5 L).
        // Depth is then litres / area_m2.
        // ------------------------------------------------------------------
        public Dictionary<DateOnly, double> GetIrrigationMmByDay(
            long zoneId, double? flowRateLpm, double? areaM2, DateOnly from, DateOnly to)
        {
            var result = new Dictionary<DateOnly, double>();

            // Without a flow rate or an area there is no depth to compute, and a
            // zero would read as "nothing was watered", which is a different and
            // false claim.
            if (!flowRateLpm.HasValue || flowRateLpm.Value <= 0.0) return result;
            if (!areaM2.HasValue || areaM2.Value <= 0.0) return result;

            const string sql =
                "select (e.started_at at time zone 'Africa/Johannesburg')::date as day, " +
                "       sum(e.runtime_seconds) as runtime_seconds " +
                "from irrigation_event e " +
                "where e.zone_id = $1 " +
                "  and e.started_at >= $2::date::timestamp at time zone 'Africa/Johannesburg' " +
                "  and e.started_at <  ($3::date + 1)::timestamp at time zone 'Africa/Johannesburg' " +
                "group by 1";

            using (var connection = Open())
            using (var cmd = new NpgsqlCommand(sql, connection))
            {
                cmd.Parameters.AddWithValue(zoneId);
                cmd.Parameters.AddWithValue(NpgsqlDbType.Date, from);
                cmd.Parameters.AddWithValue(NpgsqlDbType.Date, to);

                using (var reader = cmd.ExecuteReader())
                {
                    while (reader.Read())
                    {
                        var day = reader.GetFieldValue<DateOnly>(0);
                        var runtimeSeconds = Convert.ToDouble(reader.GetValue(1));
                        var litres = runtimeSeconds / 60.0 * flowRateLpm.Value;
                        result[day] = litres / areaM2.Value;
                    }
                }
            }

            return result;
        }

        // Item 2: the longest single pump run per day, for zones whose waterings
        // cannot be measured in mm (no flow rate or no size). The engine treats
        // a long enough run as a full watering (WaterRules.WateringResetsBalance).
        public Dictionary<DateOnly, double> GetLongestRunSecondsByDay(long zoneId, DateOnly from, DateOnly to)
        {
            var result = new Dictionary<DateOnly, double>();

            const string sql =
                "select (e.started_at at time zone 'Africa/Johannesburg')::date as day, " +
                "       max(e.runtime_seconds) as runtime_seconds " +
                "from irrigation_event e " +
                "where e.zone_id = $1 " +
                "  and e.runtime_seconds is not null " +
                "  and e.started_at >= $2::date::timestamp at time zone 'Africa/Johannesburg' " +
                "  and e.started_at <  ($3::date + 1)::timestamp at time zone 'Africa/Johannesburg' " +
                "group by 1";

            using (var connection = Open())
            using (var cmd = new NpgsqlCommand(sql, connection))
            {
                cmd.Parameters.AddWithValue(zoneId);
                cmd.Parameters.AddWithValue(NpgsqlDbType.Date, from);
                cmd.Parameters.AddWithValue(NpgsqlDbType.Date, to);

                using (var reader = cmd.ExecuteReader())
                {
                    while (reader.Read())
                    {
                        result[reader.GetFieldValue<DateOnly>(0)] = Convert.ToDouble(reader.GetValue(1));
                    }
                }
            }

            return result;
        }

        // Total irrigation depth over a window, for the overwatering check.
        public double SumIrrigationMm(
            long zoneId, double? flowRateLpm, double? areaM2, DateOnly from, DateOnly to)
        {
            var byDay = GetIrrigationMmByDay(zoneId, flowRateLpm, areaM2, from, to);
            return byDay.Values.Sum();
        }

        // ------------------------------------------------------------------
        // Writing the balance. Idempotent: re-running a day overwrites it,
        // because the engine is a pure function of its inputs and a rerun with
        // better weather should correct the row, not add a second one.
        // ------------------------------------------------------------------
        public void SaveWaterBalanceDay(long zoneId, WaterBalanceDay day, string? stageLabel)
        {
            const string sql =
                "insert into zone_water_balance " +
                "  (zone_id, day, day_of_season, stage, kc, etc_mm, p, taw_mm, raw_mm, " +
                "   rain_mm, irrigation_mm, dr_end_mm, ks, incomplete) " +
                "values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) " +
                "on conflict (zone_id, day) do update set " +
                "  day_of_season = excluded.day_of_season, " +
                "  stage         = excluded.stage, " +
                "  kc            = excluded.kc, " +
                "  etc_mm        = excluded.etc_mm, " +
                "  p             = excluded.p, " +
                "  taw_mm        = excluded.taw_mm, " +
                "  raw_mm        = excluded.raw_mm, " +
                "  rain_mm       = excluded.rain_mm, " +
                "  irrigation_mm = excluded.irrigation_mm, " +
                "  dr_end_mm     = excluded.dr_end_mm, " +
                "  ks            = excluded.ks, " +
                "  incomplete    = excluded.incomplete, " +
                "  updated_at    = now()";

            using (var connection = Open())
            using (var cmd = new NpgsqlCommand(sql, connection))
            {
                cmd.Parameters.AddWithValue(zoneId);
                cmd.Parameters.AddWithValue(NpgsqlDbType.Date, day.Day);
                AddNullable(cmd, day.DayOfSeason);
                AddNullableText(cmd, stageLabel);
                AddNullableNumeric(cmd, day.Kc);
                AddNullableNumeric(cmd, day.EtcMm);
                AddNullableNumeric(cmd, day.AdjustedP);
                AddNullableNumeric(cmd, day.TawMm);
                AddNullableNumeric(cmd, day.RawMm);
                AddNullableNumeric(cmd, day.RainMm);
                AddNullableNumeric(cmd, day.IrrigationMm);
                AddNullableNumeric(cmd, day.DrEndMm);
                AddNullableNumeric(cmd, day.Ks);
                cmd.Parameters.AddWithValue(day.Incomplete);

                cmd.ExecuteNonQuery();
            }
        }

        // Today's ETo written back onto the farm's weather row, with its
        // provenance. weather_daily is per farm, so this is written once per farm
        // per day rather than per zone.
        public void SaveFarmEto(long farmId, DateOnly day, double? etoMm, string etoSource, string rsSource)
        {
            const string sql =
                "update weather_daily set eto_mm = $3, eto_source = $4, rs_source = $5 " +
                "where farm_id = $1 and date = $2";

            using (var connection = Open())
            using (var cmd = new NpgsqlCommand(sql, connection))
            {
                cmd.Parameters.AddWithValue(farmId);
                cmd.Parameters.AddWithValue(NpgsqlDbType.Date, day);
                AddNullable(cmd, etoMm);
                cmd.Parameters.AddWithValue(etoSource);
                cmd.Parameters.AddWithValue(rsSource);

                cmd.ExecuteNonQuery();
            }
        }

        // ------------------------------------------------------------------
        // Insights. One row per zone per type per day: a second run on the same
        // day refreshes the message rather than stacking duplicates.
        //
        // dismissed_at is deliberately NOT reset on update - re-running the
        // engine must not un-dismiss something the farmer has already dealt with.
        // ------------------------------------------------------------------
        public void SaveInsight(ZoneInsight insight, string dataJson)
        {
            const string sql =
                "insert into ai_recommendation " +
                "  (zone_id, insight_type, severity, message, data, valid_for, priority) " +
                "values ($1, $2, $3, $4, $5::jsonb, $6, $3) " +
                "on conflict (zone_id, insight_type, valid_for) " +
                "where insight_type is not null and valid_for is not null " +
                "do update set " +
                "  severity = excluded.severity, " +
                "  message  = excluded.message, " +
                "  data     = excluded.data, " +
                "  priority = excluded.priority";

            using (var connection = Open())
            using (var cmd = new NpgsqlCommand(sql, connection))
            {
                cmd.Parameters.AddWithValue(insight.ZoneId);
                cmd.Parameters.AddWithValue(insight.InsightType);
                cmd.Parameters.AddWithValue(insight.Severity);
                cmd.Parameters.AddWithValue(insight.Message);
                cmd.Parameters.AddWithValue(dataJson);
                cmd.Parameters.AddWithValue(NpgsqlDbType.Date, insight.ValidFor);

                cmd.ExecuteNonQuery();
            }
        }

        // Clear an insight type for a zone, used when a fault condition resolves
        // (spec 8b: three good DHT11 readings stop the dht_offline insight).
        public void ClearInsight(long zoneId, string insightType, DateOnly validFor)
        {
            const string sql =
                "delete from ai_recommendation " +
                "where zone_id = $1 and insight_type = $2 and valid_for = $3";

            using (var connection = Open())
            using (var cmd = new NpgsqlCommand(sql, connection))
            {
                cmd.Parameters.AddWithValue(zoneId);
                cmd.Parameters.AddWithValue(insightType);
                cmd.Parameters.AddWithValue(NpgsqlDbType.Date, validFor);
                cmd.ExecuteNonQuery();
            }
        }

        public Collection<ZoneInsight> GetInsights(long zoneId, DateOnly validFor, bool includeDismissed)
        {
            var sql =
                "select insight_type, severity, message, coalesce(data::text, '{}'), valid_for " +
                "from ai_recommendation " +
                "where zone_id = $1 and valid_for = $2 and insight_type is not null";

            if (!includeDismissed) sql += " and dismissed_at is null";

            sql += " order by case severity when 'act_now' then 0 when 'heads_up' then 1 else 2 end, insight_type";

            var insights = new Collection<ZoneInsight>();

            using (var connection = Open())
            using (var cmd = new NpgsqlCommand(sql, connection))
            {
                cmd.Parameters.AddWithValue(zoneId);
                cmd.Parameters.AddWithValue(NpgsqlDbType.Date, validFor);

                using (var reader = cmd.ExecuteReader())
                {
                    while (reader.Read())
                    {
                        var insight = new ZoneInsight
                        {
                            ZoneId = zoneId,
                            InsightType = reader.GetString(0),
                            Severity = reader.IsDBNull(1) ? "info" : reader.GetString(1),
                            Message = reader.IsDBNull(2) ? "" : reader.GetString(2),
                            ValidFor = reader.GetFieldValue<DateOnly>(4),
                        };
                        insight.Data["raw"] = reader.GetString(3);
                        insights.Add(insight);
                    }
                }
            }

            return insights;
        }

        // ------------------------------------------------------------------
        // Fault signals that come from timing rather than from the balance.
        // ------------------------------------------------------------------
        public ZoneFaultSignals GetFaultSignals(EngineZoneRow zone, DateTime nowUtc)
        {
            var signals = new ZoneFaultSignals();

            // Latest soil reading, and how long it has been unchanged.
            const string latestSql =
                "select recorded_at, value from sensor_reading " +
                "where zone_id = $1 and sensor_type = 'SoilMoisture' " +
                "order by recorded_at desc limit 200";

            var recent = new List<(DateTime At, double Value)>();

            using (var connection = Open())
            using (var cmd = new NpgsqlCommand(latestSql, connection))
            {
                cmd.Parameters.AddWithValue(zone.ZoneId);
                using (var reader = cmd.ExecuteReader())
                {
                    while (reader.Read())
                    {
                        recent.Add((reader.GetDateTime(0), Convert.ToDouble(reader.GetValue(1))));
                    }
                }
            }

            if (recent.Count > 0)
            {
                signals.SinceLastReading = nowUtc - recent[0].At;

                // Walk back while the value is identical to the newest one.
                var newest = recent[0].Value;
                var oldestIdentical = recent[0].At;
                for (var i = 1; i < recent.Count; i++)
                {
                    if (Math.Abs(recent[i].Value - newest) > 1e-9) break;
                    oldestIdentical = recent[i].At;
                }
                signals.IdenticalReadingFor = recent[0].At - oldestIdentical;

                // Wettest reading over the last 7 days, for sensor_drift. Which
                // extreme is "wettest" depends on which way the probe reads.
                var weekAgo = nowUtc.AddDays(-7);
                var week = recent.Where(r => r.At >= weekAgo).Select(r => r.Value).ToList();
                if (week.Count > 0 && zone.CalibrationWet.HasValue && zone.CalibrationDry.HasValue)
                {
                    signals.SevenDayMinimumReading = zone.CalibrationWet.Value < zone.CalibrationDry.Value
                        ? week.Min()
                        : week.Max();
                }
            }

            // DHT11: is the board reporting soil readings but no valid
            // temperature or humidity? (spec 8b)
            signals.DhtOffline = IsDhtOffline(zone.ZoneId, nowUtc, out var dhtSince);
            signals.DhtOfflineSinceUtc = dhtSince;

            // watering_failed: a run of at least 2 minutes whose soil reading did
            // not move toward wet within 30 minutes.
            signals.WateringAppearedToFail = DidWateringFail(zone, nowUtc, out var failedAt);
            signals.FailedRunAtUtc = failedAt;

            return signals;
        }

        public const int DhtOfflineWindowHours = 2;
        public const int DhtBackOnlineReadingCount = 3;

        // A zone is DHT offline when soil readings are still arriving but none of
        // the last two hours' readings carries a valid DHT11 temperature or
        // humidity. It is back online after 3 consecutive valid DHT11 readings.
        public bool IsDhtOffline(long zoneId, DateTime nowUtc, out DateTime? offlineSinceUtc)
        {
            offlineSinceUtc = null;

            const string soilSql =
                "select count(*) from sensor_reading " +
                "where zone_id = $1 and sensor_type = 'SoilMoisture' and recorded_at >= $2";

            const string dhtSql =
                "select recorded_at, sensor_type, value from sensor_reading " +
                "where zone_id = $1 and sensor_type in ('Temperature', 'Humidity') " +
                "order by recorded_at desc limit 50";

            var since = nowUtc.AddHours(-DhtOfflineWindowHours);

            long soilCount;
            using (var connection = Open())
            using (var cmd = new NpgsqlCommand(soilSql, connection))
            {
                cmd.Parameters.AddWithValue(zoneId);
                cmd.Parameters.AddWithValue(NpgsqlDbType.TimestampTz, since);
                soilCount = Convert.ToInt64(cmd.ExecuteScalar());
            }

            // No soil readings either means the whole board is quiet - that is
            // zone_offline, not a DHT11 fault. Do not log a sensor callout for it.
            if (soilCount == 0) return false;

            var dht = new List<(DateTime At, string Type, double Value)>();
            using (var connection = Open())
            using (var cmd = new NpgsqlCommand(dhtSql, connection))
            {
                cmd.Parameters.AddWithValue(zoneId);
                using (var reader = cmd.ExecuteReader())
                {
                    while (reader.Read())
                    {
                        dht.Add((reader.GetDateTime(0), reader.GetString(1), Convert.ToDouble(reader.GetValue(2))));
                    }
                }
            }

            var validRecent = dht
                .Where(d => d.At >= since && IsValidDhtValue(d.Type, d.Value))
                .ToList();

            if (validRecent.Count > 0)
            {
                // Back online needs 3 consecutive valid readings, so a single good
                // reading in a flapping sensor does not clear the fault.
                var consecutive = 0;
                foreach (var d in dht)
                {
                    if (IsValidDhtValue(d.Type, d.Value)) consecutive++;
                    else break;
                }
                if (consecutive >= DhtBackOnlineReadingCount) return false;
            }

            var lastValid = dht.FirstOrDefault(d => IsValidDhtValue(d.Type, d.Value));
            offlineSinceUtc = lastValid.At == default ? (DateTime?)null : lastValid.At;

            return true;
        }

        // Spec 3b plausibility: temperature -10..60 C, humidity 0..100 %. NaN is
        // what a DHT11 timeout or checksum failure looks like once it reaches a
        // real column.
        public static bool IsValidDhtValue(string sensorType, double value)
        {
            if (double.IsNaN(value) || double.IsInfinity(value)) return false;

            if (sensorType == "Temperature") return value >= -10.0 && value <= 60.0;
            if (sensorType == "Humidity") return value >= 0.0 && value <= 100.0;
            return false;
        }

        public const int WateringFailedMinRuntimeSeconds = 120;
        public const int WateringFailedWindowMinutes = 30;

        private bool DidWateringFail(EngineZoneRow zone, DateTime nowUtc, out DateTime? failedAtUtc)
        {
            failedAtUtc = null;

            // The most recent run of at least 2 minutes in the last day.
            const string runSql =
                "select started_at, runtime_seconds from irrigation_event " +
                "where zone_id = $1 and runtime_seconds >= $2 and started_at >= $3 " +
                "order by started_at desc limit 1";

            DateTime startedAt;
            double runtimeSeconds;

            using (var connection = Open())
            using (var cmd = new NpgsqlCommand(runSql, connection))
            {
                cmd.Parameters.AddWithValue(zone.ZoneId);
                cmd.Parameters.AddWithValue(WateringFailedMinRuntimeSeconds);
                cmd.Parameters.AddWithValue(NpgsqlDbType.TimestampTz, nowUtc.AddDays(-1));

                using (var reader = cmd.ExecuteReader())
                {
                    if (!reader.Read()) return false;
                    startedAt = reader.GetDateTime(0);
                    runtimeSeconds = Convert.ToDouble(reader.GetValue(1));
                }
            }

            var runEnded = startedAt.AddSeconds(runtimeSeconds);

            // The window must have fully elapsed before this can be judged -
            // otherwise a run that finished a minute ago looks like a failure.
            if (nowUtc < runEnded.AddMinutes(WateringFailedWindowMinutes)) return false;

            // Compare the reading just before the run with the wettest reading in
            // the 30 minutes after it.
            const string beforeSql =
                "select value from sensor_reading " +
                "where zone_id = $1 and sensor_type = 'SoilMoisture' and recorded_at <= $2 " +
                "order by recorded_at desc limit 1";

            const string afterSql =
                "select value from sensor_reading " +
                "where zone_id = $1 and sensor_type = 'SoilMoisture' " +
                "  and recorded_at > $2 and recorded_at <= $3";

            double? before = null;
            var after = new List<double>();

            using (var connection = Open())
            {
                using (var cmd = new NpgsqlCommand(beforeSql, connection))
                {
                    cmd.Parameters.AddWithValue(zone.ZoneId);
                    cmd.Parameters.AddWithValue(NpgsqlDbType.TimestampTz, startedAt);
                    var value = cmd.ExecuteScalar();
                    if (value != null && value != DBNull.Value) before = Convert.ToDouble(value);
                }

                using (var cmd = new NpgsqlCommand(afterSql, connection))
                {
                    cmd.Parameters.AddWithValue(zone.ZoneId);
                    cmd.Parameters.AddWithValue(NpgsqlDbType.TimestampTz, runEnded);
                    cmd.Parameters.AddWithValue(NpgsqlDbType.TimestampTz, runEnded.AddMinutes(WateringFailedWindowMinutes));
                    using (var reader = cmd.ExecuteReader())
                    {
                        while (reader.Read()) after.Add(Convert.ToDouble(reader.GetValue(0)));
                    }
                }
            }

            // No readings on one side of the run: that is a data gap, not a proven
            // pump failure. Do not accuse the hardware on missing evidence.
            if (!before.HasValue || after.Count == 0) return false;

            var wetIsLower = zone.CalibrationWet.HasValue && zone.CalibrationDry.HasValue
                             && zone.CalibrationWet.Value < zone.CalibrationDry.Value;

            // An uncalibrated zone still gets this check - spec section 8 says the
            // sensor is used to confirm the soil got wetter even without
            // calibration. The firmware currently reports a percentage, where
            // higher is wetter, which is the default assumption.
            var movedTowardWet = wetIsLower
                ? after.Min() < before.Value
                : after.Max() > before.Value;

            if (movedTowardWet) return false;

            failedAtUtc = startedAt;
            return true;
        }

        // Trailing mean ETo over the days before today, for the hot_days check.
        public double? GetTrailingMeanEto(long farmId, DateOnly from, DateOnly to)
        {
            const string sql =
                "select avg(eto_mm) from weather_daily " +
                "where farm_id = $1 and date between $2 and $3 and eto_mm is not null and is_forecast = false";

            using (var connection = Open())
            using (var cmd = new NpgsqlCommand(sql, connection))
            {
                cmd.Parameters.AddWithValue(farmId);
                cmd.Parameters.AddWithValue(NpgsqlDbType.Date, from);
                cmd.Parameters.AddWithValue(NpgsqlDbType.Date, to);

                var value = cmd.ExecuteScalar();
                if (value == null || value == DBNull.Value) return null;
                return Convert.ToDouble(value);
            }
        }

        // ------------------------------------------------------------------
        // Calibration and soil writes, for the farmer-facing endpoints.
        // ------------------------------------------------------------------
        public void SaveCalibrationPoint(long zoneId, string point, double reading)
        {
            // The column name is chosen here, not interpolated from caller input.
            var column = point == "wet" ? "calibration_wet" : "calibration_dry";
            var sql = "update zone set calibration_" + (point == "wet" ? "wet" : "dry") + " = $2 where id = $1";

            using (var connection = Open())
            using (var cmd = new NpgsqlCommand(sql, connection))
            {
                cmd.Parameters.AddWithValue(zoneId);
                cmd.Parameters.AddWithValue(reading);
                cmd.ExecuteNonQuery();
            }

            _ = column;
        }

        public void SaveSoilType(long zoneId, string soilType)
        {
            const string sql = "update zone set soil_type = $2 where id = $1";

            using (var connection = Open())
            using (var cmd = new NpgsqlCommand(sql, connection))
            {
                cmd.Parameters.AddWithValue(zoneId);
                cmd.Parameters.AddWithValue(soilType);
                cmd.ExecuteNonQuery();
            }
        }

        public void SaveRecommendedThresholds(long zoneId, double moistureThreshold, double desiredMoisture)
        {
            const string sql =
                "update zone set moisture_threshold = $2, desired_moisture = $3 where id = $1";

            using (var connection = Open())
            using (var cmd = new NpgsqlCommand(sql, connection))
            {
                cmd.Parameters.AddWithValue(zoneId);
                cmd.Parameters.AddWithValue((float)moistureThreshold);
                cmd.Parameters.AddWithValue((float)desiredMoisture);
                cmd.ExecuteNonQuery();
            }
        }

        // The latest valid soil reading, for the calibration endpoints.
        public double? GetLatestValidReading(long zoneId)
        {
            const string sql =
                "select value from sensor_reading " +
                "where zone_id = $1 and sensor_type = 'SoilMoisture' " +
                "order by recorded_at desc limit 20";

            using (var connection = Open())
            using (var cmd = new NpgsqlCommand(sql, connection))
            {
                cmd.Parameters.AddWithValue(zoneId);
                using (var reader = cmd.ExecuteReader())
                {
                    while (reader.Read())
                    {
                        var value = Convert.ToDouble(reader.GetValue(0));
                        // Calibration points define the range, so they cannot be
                        // checked against it - only the ADC range applies here.
                        if (Fao56Engine.IsPlausibleReading(value, null, null)) return value;
                    }
                }
            }

            return null;
        }

        // ------------------------------------------------------------------
        // Access check, matching the rule the report endpoints use: owner, farm
        // member, or an admin profile.
        // ------------------------------------------------------------------
        public bool CanAccessZone(Guid userId, long zoneId, out long farmId)
        {
            const string sql =
                "select z.farm_id from zone z join farm f on f.farm_id = z.farm_id " +
                "where z.id = $1 " +
                "  and (f.owner_id = $2 " +
                "    or exists (select 1 from farm_member fm where fm.farm_id = f.farm_id and fm.profile_id = $2) " +
                "    or exists (select 1 from profile p where p.id = $2 and p.role = 'admin'))";

            farmId = 0;

            using (var connection = Open())
            using (var cmd = new NpgsqlCommand(sql, connection))
            {
                cmd.Parameters.AddWithValue(zoneId);
                cmd.Parameters.AddWithValue(userId);

                var value = cmd.ExecuteScalar();
                if (value == null || value == DBNull.Value) return false;
                farmId = Convert.ToInt64(value);
                return true;
            }
        }

        // ------------------------------------------------------------------
        // Maintenance callout for a DHT11 fault (spec 8b).
        //
        // Luba's service_request is NOT used: its crop_type and farmer_id columns
        // are both NOT NULL, so a system-generated row would have to invent a
        // crop and attribute the request to a farmer who never made it. Spec 8b's
        // own fallback applies - an admin-facing `alert` row instead. Her table,
        // her constraints and her admin page are untouched.
        // ------------------------------------------------------------------
        public bool HasOpenDhtAlert(long zoneId)
        {
            const string sql =
                "select count(*) from alert " +
                "where zone_id = $1 and status = 'Open' and message like 'DHT11%'";

            using (var connection = Open())
            using (var cmd = new NpgsqlCommand(sql, connection))
            {
                cmd.Parameters.AddWithValue(zoneId);
                return Convert.ToInt64(cmd.ExecuteScalar()) > 0;
            }
        }

        public void CreateDhtMaintenanceAlert(long zoneId, DateTime? offlineSinceUtc)
        {
            // At most one open callout per zone for this fault.
            if (HasOpenDhtAlert(zoneId)) return;

            var since = offlineSinceUtc.HasValue
                ? offlineSinceUtc.Value.AddHours(2).ToString("yyyy-MM-dd HH:mm")
                : "an unknown time";

            var message =
                "DHT11 temperature/humidity sensor not responding since " + since +
                ". System is using weather app data. Needs a site visit.";

            const string sql =
                "insert into alert (zone_id, severity, message, status) values ($1, $2, $3, 'Open')";

            using (var connection = Open())
            using (var cmd = new NpgsqlCommand(sql, connection))
            {
                cmd.Parameters.AddWithValue(zoneId);
                cmd.Parameters.AddWithValue("Warning");
                cmd.Parameters.AddWithValue(message);
                cmd.ExecuteNonQuery();
            }
        }

        // ------------------------------------------------------------------
        // Helpers
        // ------------------------------------------------------------------
        private static double? Nullable(NpgsqlDataReader reader, int ordinal)
        {
            return reader.IsDBNull(ordinal) ? (double?)null : Convert.ToDouble(reader.GetValue(ordinal));
        }

        private static void AddNullable(NpgsqlCommand cmd, double? value)
        {
            cmd.Parameters.AddWithValue(value.HasValue ? (object)value.Value : DBNull.Value);
        }

        private static void AddNullable(NpgsqlCommand cmd, int? value)
        {
            cmd.Parameters.AddWithValue(value.HasValue ? (object)value.Value : DBNull.Value);
        }

        private static void AddNullableNumeric(NpgsqlCommand cmd, double? value)
        {
            var parameter = new NpgsqlParameter { NpgsqlDbType = NpgsqlDbType.Numeric };
            parameter.Value = value.HasValue ? (object)(decimal)value.Value : DBNull.Value;
            cmd.Parameters.Add(parameter);
        }

        private static void AddNullableText(NpgsqlCommand cmd, string? value)
        {
            cmd.Parameters.AddWithValue(string.IsNullOrEmpty(value) ? (object)DBNull.Value : value);
        }
    }

    // Plain row objects. No DTO layer: these are what the data layer reads and
    // what the engine is handed, in the project's established style.
    public sealed class EngineZoneRow
    {
        public long ZoneId { get; set; }
        public long FarmId { get; set; }
        public string ZoneName { get; set; } = "Zone";
        public string FarmName { get; set; } = "";
        public string? CropType { get; set; }
        public DateOnly? PlantingDate { get; set; }
        public string? SoilType { get; set; }
        public double? AreaM2 { get; set; }
        public double? FlowRateLpm { get; set; }
        public double? RootDepthLimitM { get; set; }
        public double? CalibrationWet { get; set; }
        public double? CalibrationDry { get; set; }
        public double? MoistureThreshold { get; set; }
        public double? DesiredMoisture { get; set; }
        public double? FarmLatitude { get; set; }
    }
}
