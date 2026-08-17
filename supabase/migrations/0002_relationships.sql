-- AgroFlow relationships schema
-- Time-series / event tables that hang off zone, plus the profile<->farm
-- access relationship. Builds on 0001_foundation.sql.
-- (hardware_id on sensor_reading is added later, in 0003_csharp_domain.sql,
-- once the hardware table it references exists.)

-- ---------------------------------------------------------------------------
-- farm_member: which profiles can access which farms (many-to-many).
-- ---------------------------------------------------------------------------
create table farm_member (
    farm_id     bigint not null references farm (farm_id) on delete cascade,
    profile_id  uuid not null references profile (id) on delete cascade,
    created_at  timestamptz not null default now(),
    primary key (farm_id, profile_id)
);

-- ---------------------------------------------------------------------------
-- sensor_reading: append-only time-series log, one row per reading event.
-- ---------------------------------------------------------------------------
create table sensor_reading (
    id           bigint generated always as identity primary key,
    zone_id      bigint not null references zone (id) on delete cascade,
    sensor_type  text not null
                 check (sensor_type in ('SoilMoisture', 'Temperature', 'Humidity')),
    value        real not null,
    recorded_at  timestamptz not null default now()
);

create index idx_sensor_reading_zone_id on sensor_reading (zone_id);
create index idx_sensor_reading_zone_id_recorded_at on sensor_reading (zone_id, recorded_at desc);

-- ---------------------------------------------------------------------------
-- irrigation_event: one row per irrigation run.
-- IrrigationLog.DateTime -> started_at, IrrigationLog.WaterAmount
-- (EstimatedLitres) -> volume_litres, IrrigationLog.Action -> action
-- (added in 0003_csharp_domain.sql alongside the other C#-only columns).
-- ---------------------------------------------------------------------------
create table irrigation_event (
    id                bigint generated always as identity primary key,
    zone_id           bigint not null references zone (id) on delete cascade,
    started_at        timestamptz not null default now(),
    duration_seconds  integer not null default 0,
    volume_litres     real not null default 0,
    source            text not null default 'manual'
                      check (source in ('manual', 'scheduled', 'ai')),
    created_at        timestamptz not null default now()
);

create index idx_irrigation_event_zone_id on irrigation_event (zone_id);

comment on column irrigation_event.volume_litres is
    'Estimated via runtime_seconds, not measured — no flow meter installed';
