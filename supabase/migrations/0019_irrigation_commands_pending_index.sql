-- Supporting index for irrigation-command REPLAY.
--
-- Until now, a row in irrigation_commands reached a device exactly once: the
-- insert fired trg_irrigation_commands_notify -> pg_notify -> MQTT publish
-- (0009_mqtt_and_device_identity.sql). If AgroFlow.Api or its MQTT connection
-- was down at that instant, the NOTIFY went nowhere and the command stayed
-- 'pending' forever with nothing to retry it. That mattered less when the API
-- ran on someone's laptop; now that it is a Railway container that restarts on
-- every deploy, it is a real failure mode.
--
-- IrrigationCommandNotifyService now also sweeps for pending commands - on
-- startup, on MQTT reconnect, and periodically - with a query shaped:
--
--     select ... from irrigation_commands
--      where status = 'pending' and created_at > now() - interval '...'
--      order by created_at
--
-- 0004 already created (zone_id, status, created_at desc), which serves
-- "pending commands FOR ONE ZONE". The sweep has no zone_id predicate, so
-- that index cannot be used for it. This partial index covers the sweep
-- directly and stays tiny, because it only ever indexes rows that are
-- currently pending - in steady state a handful, not the whole table.
--
-- Run this in the Supabase SQL editor. Idempotent - safe to re-run.

create index if not exists idx_irrigation_commands_pending_created
    on irrigation_commands (created_at)
    where status = 'pending';

comment on index idx_irrigation_commands_pending_created is
    'Partial index over currently-pending commands only. Supports IrrigationCommandNotifyService''s startup / reconnect / periodic replay sweep, which has no zone_id predicate and so cannot use idx_irrigation_commands_zone_status_created.';
