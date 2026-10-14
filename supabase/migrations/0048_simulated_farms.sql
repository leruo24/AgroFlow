-- Explicitly labelled demonstration farms and provenance on generated readings.
-- Existing farm/sensor_reading RLS continues to apply to the new columns; the
-- simulator writes through the API's database role and clients remain read-only.

alter table farm
    add column if not exists is_simulated boolean not null default false;

alter table sensor_reading
    add column if not exists simulated boolean not null default false,
    add column if not exists simulation_day date;

create unique index if not exists uq_sensor_reading_simulated_zone_day
    on sensor_reading (zone_id, simulation_day)
    where simulated = true;

comment on column farm.is_simulated is
    'True only for demonstration farms whose data is generated rather than measured.';
comment on column sensor_reading.simulated is
    'True only when SimulationService generated this row. False means a real device or manual source.';
comment on column sensor_reading.simulation_day is
    'Africa/Johannesburg model day for a simulated row; null on real readings.';

-- 0010 renamed zone.moisture_dry_threshold / moisture_wet_threshold, but renaming a
-- table column does not rename a view column that selected it, so a database where
-- the 0007 view was in place still names them the old way. CREATE OR REPLACE VIEW
-- cannot rename columns (42P16), so rename them first. Does nothing on a database
-- that already has the new names.
do $$
begin
    if exists (select 1 from information_schema.columns
               where table_schema = 'public' and table_name = 'zone_latest_reading'
                 and column_name = 'moisture_dry_threshold') then
        alter view zone_latest_reading rename column moisture_dry_threshold to moisture_threshold;
    end if;
    if exists (select 1 from information_schema.columns
               where table_schema = 'public' and table_name = 'zone_latest_reading'
                 and column_name = 'moisture_wet_threshold') then
        alter view zone_latest_reading rename column moisture_wet_threshold to desired_moisture;
    end if;
end $$;

-- Keep the latest-reading view honest about the provenance of each displayed value.
create or replace view zone_latest_reading as
select
    z.id            as zone_id,
    z.farm_id,
    z.crop_type,
    z.water_saved,
    z.health_status,
    z.moisture_threshold,
    z.desired_moisture,
    moisture.value      as moisture,
    temperature.value   as temperature,
    humidity.value      as humidity,
    greatest(moisture.recorded_at, temperature.recorded_at, humidity.recorded_at) as last_reading_at,
    moisture.simulated  as moisture_simulated,
    temperature.simulated as temperature_simulated,
    humidity.simulated  as humidity_simulated
from zone z
left join lateral (
    select value, recorded_at, simulated from sensor_reading
    where zone_id = z.id and sensor_type = 'SoilMoisture'
    order by recorded_at desc
    limit 1
) moisture on true
left join lateral (
    select value, recorded_at, simulated from sensor_reading
    where zone_id = z.id and sensor_type = 'Temperature'
    order by recorded_at desc
    limit 1
) temperature on true
left join lateral (
    select value, recorded_at, simulated from sensor_reading
    where zone_id = z.id and sensor_type = 'Humidity'
    order by recorded_at desc
    limit 1
) humidity on true;

alter view zone_latest_reading set (security_invoker = true);

-- Open-Meteo geocoding results captured 2026-10-14:
-- Ficksburg (used for nearby Rustlers Valley): -28.872, 27.87506
-- Brits: -25.63473, 27.78022
insert into farm (name, location, total_area, status, latitude, longitude, is_simulated)
select 'Rustlers Valley (Simulated)', 'Rustlers Valley, near Ficksburg, Free State', 0.01,
       'Active', -28.872, 27.87506, true
where not exists (select 1 from farm where name = 'Rustlers Valley (Simulated)');

insert into farm (name, location, total_area, status, latitude, longitude, is_simulated)
select 'Brits (Simulated)', 'Brits, North West', 0.01,
       'Active', -25.63473, 27.78022, true
where not exists (select 1 from farm where name = 'Brits (Simulated)');

update farm set location = 'Rustlers Valley, near Ficksburg, Free State',
       latitude = -28.872, longitude = 27.87506, is_simulated = true
where name = 'Rustlers Valley (Simulated)';

update farm set location = 'Brits, North West',
       latitude = -25.63473, longitude = 27.78022, is_simulated = true
where name = 'Brits (Simulated)';

insert into zone (
    farm_id, name, location, crop_type, size_value, size_unit, soil_type,
    area_m2, root_depth_limit_m, planting_date, flow_rate_lpm,
    calibration_wet, calibration_dry, irrigation_mode)
select f.farm_id, 'Demo Zone (Simulated)', f.location, 'citrus', 0.01, 'ha', 'loam',
       100, 0.6, current_date - 60, 10, 100, 0, 'manual'
from farm f
where f.name = 'Rustlers Valley (Simulated)'
  and not exists (select 1 from zone z where z.farm_id = f.farm_id and z.name = 'Demo Zone (Simulated)');

insert into zone (
    farm_id, name, location, crop_type, size_value, size_unit, soil_type,
    area_m2, root_depth_limit_m, planting_date, flow_rate_lpm,
    calibration_wet, calibration_dry, irrigation_mode)
select f.farm_id, 'Demo Zone (Simulated)', f.location, 'tomato', 0.01, 'ha', 'loam',
       100, 0.6, current_date - 60, 10, 100, 0, 'manual'
from farm f
where f.name = 'Brits (Simulated)'
  and not exists (select 1 from zone z where z.farm_id = f.farm_id and z.name = 'Demo Zone (Simulated)');
