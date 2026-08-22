-- Pump command polling + irrigation event logging for the ESP32 firmware.
--
-- zone_id below is bigint (not integer) to match zone.id and every other
-- zone_id FK already in the schema (sensor_reading, irrigation_event, alert).
--
-- irrigation_event already had duration_seconds/volume_litres/source columns
-- that are the same concepts as the newly-requested runtime_seconds/
-- estimated_litres/trigger_source, just named differently, with a narrower
-- check constraint on `source`. Nothing in the app reads/writes this table
-- yet, so they're renamed/repurposed here rather than duplicated - keeps one
-- column per concept instead of two parallel ones meaning the same thing.

-- ---------------------------------------------------------------------------
-- irrigation_commands: pump start/stop commands queued for an ESP32 board to
-- poll and execute.
-- ---------------------------------------------------------------------------
create table irrigation_commands (
    id           uuid primary key default gen_random_uuid(),
    zone_id      bigint not null references zone (id) on delete cascade,
    command      text not null
                 check (command in ('start', 'stop')),
    status       text not null default 'pending'
                 check (status in ('pending', 'executed', 'failed')),
    created_at   timestamptz not null default now(),
    executed_at  timestamptz
);

create index idx_irrigation_commands_zone_id on irrigation_commands (zone_id);

-- Supports "most recent pending command for this zone_id" polling queries.
create index idx_irrigation_commands_zone_status_created
    on irrigation_commands (zone_id, status, created_at desc);

-- ---------------------------------------------------------------------------
-- irrigation_event: rename/repurpose existing columns instead of adding
-- duplicates (see note above). The existing comment on the estimate column
-- ("Estimated via runtime_seconds...") survives the rename automatically -
-- Postgres comments stay attached to the column object, not its name.
-- ---------------------------------------------------------------------------
alter table irrigation_event
    rename column duration_seconds to runtime_seconds;

alter table irrigation_event
    rename column volume_litres to estimated_litres;

alter table irrigation_event
    alter column estimated_litres type numeric(6, 2);

alter table irrigation_event
    rename column source to trigger_source;

alter table irrigation_event
    drop constraint irrigation_event_source_check;

alter table irrigation_event
    alter column trigger_source set default 'auto';

alter table irrigation_event
    add constraint irrigation_event_trigger_source_check
        check (trigger_source in ('auto', 'manual', 'unknown'));

alter table irrigation_event
    add column sync_status text not null default 'synced'
        check (sync_status in ('synced', 'offline_queued'));
