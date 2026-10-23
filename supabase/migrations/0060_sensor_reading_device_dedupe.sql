-- ESP32 offline buffer, firmware v1.7.0 (fix/esp32-offline-buffer). Numbered 0060: it was
-- written as 0057, which the audit fixes took first.
--
--   1. Readings are attributed to the physical kit that published them, and a reading the kit
--      sends twice (an offline replay retried after a power cut) is stored once: one row per
--      kit, sensor and measured time. Existing readings stay valid with hardware_id null
--      (legacy, simulated or non-device input), and the unique index ignores them.
--   2. The kit's backlog: how many readings it still has waiting to upload, from the
--      "backlog" field of its latest reading, and when that was reported. Shown with the
--      kit's status (staff Kits page, the farmer's kit screen).
--
-- The API reads and writes these as the table owner; RLS and grants on sensor_reading and
-- hardware are unchanged and cover the new columns. Safe to run more than once.

alter table sensor_reading
    add column if not exists hardware_id bigint
    references hardware (hardware_id) on delete set null;

create unique index if not exists uq_sensor_reading_hardware_measured
    on sensor_reading (hardware_id, sensor_type, recorded_at)
    where hardware_id is not null;

comment on column sensor_reading.hardware_id is
    'Physical kit that published the reading. Null for legacy, simulated, or non-device input.';

alter table hardware
    add column if not exists offline_backlog integer check (offline_backlog >= 0),
    add column if not exists offline_backlog_at timestamptz;

comment on column hardware.offline_backlog is
    'Readings the kit still had waiting to upload, from the backlog field of its latest reading (firmware 1.7.0+). Null: not reported yet.';
comment on column hardware.offline_backlog_at is
    'When offline_backlog was reported.';
