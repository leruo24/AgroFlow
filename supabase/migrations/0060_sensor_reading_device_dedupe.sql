-- Attribute MQTT readings to the physical kit and make an offline replay retry
-- idempotent. Existing readings stay valid with hardware_id null.

alter table sensor_reading
    add column if not exists hardware_id bigint
    references hardware (hardware_id) on delete set null;

create unique index if not exists uq_sensor_reading_hardware_measured
    on sensor_reading (hardware_id, sensor_type, recorded_at)
    where hardware_id is not null;

comment on column sensor_reading.hardware_id is
    'Physical kit that published the reading. Null for legacy, simulated, or non-device input.';
