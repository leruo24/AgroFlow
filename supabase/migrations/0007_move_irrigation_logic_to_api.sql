-- Health status, water usage, and auto-irrigation decision-making move from
-- Postgres triggers into the new AgroFlow.Api project (api/AgroFlow.Api),
-- called directly by the ESP32 firmware instead of writing straight to
-- Supabase. This drops the 0006_backend_irrigation_logic.sql triggers/
-- functions that duplicated that logic.
--
-- Uses IF EXISTS throughout so this is safe to run whether or not 0006 was
-- ever actually applied to this database.
--
-- NOT dropped, and still needed:
--   - zone.moisture_dry_threshold / moisture_wet_threshold / water_used_total
--     - now read/written by the API instead of a trigger, not removed.
--   - irrigation_commands.source, irrigation_event.trigger_source's widened
--     check ('scheduled' included) - the API writes source='auto', and
--     schedule-firing (still in Postgres, see below) writes source='scheduled'.
--   - irrigation_schedule table and the fire-due-irrigation-schedules pg_cron
--     job - schedule firing stays in Postgres per the request that only
--     health/water/auto-irrigation move to C#, not schedules.
--   - zone_daily_water_usage view - aggregates irrigation_event directly,
--     unaffected by where the running total is maintained.

drop trigger if exists trg_sensor_reading_health_status on sensor_reading;
drop trigger if exists trg_irrigation_event_water_usage on irrigation_event;
drop trigger if exists trg_sensor_reading_auto_irrigation on sensor_reading;

drop function if exists update_zone_health();
drop function if exists calculate_zone_health(bigint);
drop function if exists update_zone_water_usage();
drop function if exists auto_irrigation_check();

-- Widened so the API's single "everything current about a zone" query
-- (zone_latest_reading) also carries the per-zone auto-irrigation
-- thresholds, instead of needing a second round-trip to the zone table.
create or replace view zone_latest_reading as
select
    z.id            as zone_id,
    z.farm_id,
    z.crop_type,
    z.water_saved,
    z.health_status,
    z.moisture_dry_threshold,
    z.moisture_wet_threshold,
    moisture.value      as moisture,
    temperature.value   as temperature,
    humidity.value       as humidity,
    greatest(moisture.recorded_at, temperature.recorded_at, humidity.recorded_at) as last_reading_at
from zone z
left join lateral (
    select value, recorded_at from sensor_reading
    where zone_id = z.id and sensor_type = 'SoilMoisture'
    order by recorded_at desc
    limit 1
) moisture on true
left join lateral (
    select value, recorded_at from sensor_reading
    where zone_id = z.id and sensor_type = 'Temperature'
    order by recorded_at desc
    limit 1
) temperature on true
left join lateral (
    select value, recorded_at from sensor_reading
    where zone_id = z.id and sensor_type = 'Humidity'
    order by recorded_at desc
    limit 1
) humidity on true;
