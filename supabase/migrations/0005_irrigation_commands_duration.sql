-- Adds duration_seconds to irrigation_commands: a manual 'start' command can
-- now specify how long to run. Null means "run until an explicit stop".
--
-- Also adds a zone_id + started_at index on irrigation_event for date-range
-- reporting (water usage over time, per-zone irrigation history).
--
-- No occurred_at column added here, despite the timestamp audit that
-- prompted this migration flagging exactly that need: irrigation_event
-- already has started_at (timestamptz, added in 0002_relationships.sql)
-- meaning precisely "when this irrigation run happened" - the bug was that
-- the firmware never populated it, so it silently defaulted to insert time
-- (wrong for anything flushed from the offline buffer, since that's sync
-- time, not irrigation time). Fixed in the firmware instead of duplicating
-- the column - see AgroFlowIrrigationNode.ino.

alter table irrigation_commands
    add column duration_seconds integer;

create index idx_irrigation_event_zone_started_at
    on irrigation_event (zone_id, started_at desc);
