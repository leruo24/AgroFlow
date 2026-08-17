-- AgroFlow C# domain-model alignment
-- Extends 0001_foundation.sql / 0002_relationships.sql; creates tables for
-- C# classes that have no existing equivalent. Field sets below are
-- finalized against the class diagram documentation (this supersedes the
-- earlier inferred/nullable FK guesses on Weather/Maintenance/AIRecommendation
-- from the draft version of this file).

-- ---------------------------------------------------------------------------
-- Hardware.cs -> new table. Resolves the earlier "no stable device identity"
-- gap: sensor_reading is an append-only log and was never meant to carry
-- per-device fields (device_name/status/last_seen), so those live here
-- instead, with sensor_reading pointing at a device via hardware_id.
-- ---------------------------------------------------------------------------
create table hardware (
    hardware_id  bigint generated always as identity primary key,
    device_name  text not null default '',
    device_type  text not null
                 check (device_type in ('Sensor', 'Pump', 'ESP32')),
    status       text not null default 'Offline'
                 check (status in ('Offline', 'Online')),
    last_seen    timestamptz not null default now(),
    created_at   timestamptz not null default now(),
    updated_at   timestamptz not null default now()
);

create trigger trg_hardware_updated_at
    before update on hardware
    for each row execute function set_updated_at();

alter table sensor_reading
    add column hardware_id bigint references hardware (hardware_id) on delete set null,
    add column raw_value   integer;

create index idx_sensor_reading_hardware_id on sensor_reading (hardware_id);

-- ---------------------------------------------------------------------------
-- IrrigationLog.cs -> irrigation_event (0002_relationships.sql). action has
-- no existing equivalent; date_time/water_amount already map onto
-- started_at/volume_litres (see the comment added on volume_litres in
-- 0002_relationships.sql).
-- ---------------------------------------------------------------------------
alter table irrigation_event
    add column action text;

-- ---------------------------------------------------------------------------
-- Zone.cs -> zone (0001_foundation.sql). crop_type/water_saved/health_status
-- are stored columns (see 0001_foundation.sql). moisture/temperature/humidity
-- are computed here from sensor_reading rather than stored, per the earlier
-- decision to avoid duplicating the sensor_reading time series onto zone.
-- ---------------------------------------------------------------------------
create view zone_latest_reading as
select
    z.id            as zone_id,
    z.farm_id,
    z.crop_type,
    z.water_saved,
    z.health_status,
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

-- ---------------------------------------------------------------------------
-- User.cs / Admin.cs / FarmUser.cs -> already covered by profile
-- (0001_foundation.sql: name, email, role). No new table - both subclasses
-- add zero fields beyond the base class, matching profile.role.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Alert.cs -> new table.
-- ---------------------------------------------------------------------------
create table alert (
    id          bigint generated always as identity primary key,
    zone_id     bigint references zone (id) on delete cascade,
    severity    text not null,
    message     text not null,
    status      text not null default 'Open'
                check (status in ('Open', 'Resolved')),
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now()
);

create index idx_alert_zone_id on alert (zone_id);

create trigger trg_alert_updated_at
    before update on alert
    for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- Report.cs -> new table. Not covered by this round's authoritative field
-- list, kept as previously designed: report_type + generated_date, with an
-- inferred nullable farm_id (Report.cs itself has no FK field).
-- ---------------------------------------------------------------------------
create table report (
    id              bigint generated always as identity primary key,
    farm_id         bigint references farm (farm_id) on delete cascade,
    report_type     text not null default '',
    generated_date  timestamptz not null default now()
);

create index idx_report_farm_id on report (farm_id);

-- ---------------------------------------------------------------------------
-- Weather.cs -> new table. temperature/humidity/pressure/wind_speed/
-- weather_conditions per the class diagram (weather_conditions replaces the
-- earlier "condition" column name). id, farm_id and recorded_at are still
-- additions - Weather.cs itself has no identity, FK or timestamp field.
-- ---------------------------------------------------------------------------
create table weather (
    id                  bigint generated always as identity primary key,
    farm_id             bigint references farm (farm_id) on delete cascade,
    temperature         real not null default 0,
    humidity            real not null default 0,
    pressure            real not null default 0,
    wind_speed          real not null default 0,
    weather_conditions  text not null default '',
    recorded_at         timestamptz not null default now()
);

create index idx_weather_farm_id on weather (farm_id);

-- ---------------------------------------------------------------------------
-- Maintenance.cs -> new table. Now that hardware exists, maintenance can
-- reference the actual device (hardware_id) and/or the farm (farm_id)
-- instead of the earlier zone_id stand-in.
-- ---------------------------------------------------------------------------
create table maintenance (
    maintenance_id  bigint generated always as identity primary key,
    farm_id         bigint references farm (farm_id) on delete set null,
    hardware_id     bigint references hardware (hardware_id) on delete set null,
    scheduled_date  timestamptz,
    description     text not null default '',
    status          text not null default 'Pending'
                    check (status in ('Pending', 'Scheduled', 'Completed')),
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now()
);

create index idx_maintenance_farm_id on maintenance (farm_id);
create index idx_maintenance_hardware_id on maintenance (hardware_id);

create trigger trg_maintenance_updated_at
    before update on maintenance
    for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- AIRecommendation.cs -> new table. recommendation_id, message, priority,
-- estimated_water per the class diagram, plus zone_id: the diagram's
-- omission of a zone/farm reference looks like a documentation gap rather
-- than an intentional exclusion, since a recommendation with an
-- estimated_water amount but nothing to apply it to can't be used anywhere
-- in the app.
-- ---------------------------------------------------------------------------
create table ai_recommendation (
    recommendation_id  bigint generated always as identity primary key,
    zone_id            bigint references zone (id) on delete cascade,
    message            text not null default '',
    priority           text not null default '',
    estimated_water    real not null default 0,
    created_at         timestamptz not null default now()
);

create index idx_ai_recommendation_zone_id on ai_recommendation (zone_id);
