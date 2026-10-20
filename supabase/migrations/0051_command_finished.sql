-- "Executed" and "finished" become two different things (docs/irrigate-path.md).
--
-- irrigation_commands.status = 'executed' has always meant the kit acknowledged the command
-- and STARTED the run (POST /api/devices/commands/{id}/executed is sent at pump start). The
-- end of the run only showed up as an irrigation_event row, with nothing linking the two, so
-- "executed" read as "done". Now:
--   1. irrigation_commands.finished_at: set when the kit reports the run itself
--      (POST /api/irrigation-events), so a command can say sent -> started -> finished.
--   2. irrigation_event.command_id: the command the run came from (null for runs nobody
--      asked for: the offline fallback, the kit's local page, older history).
-- The status values are unchanged on purpose: the 30-minute manual cooldown (the API's
-- SensorReadingProcessor and fire_due_irrigation_schedules()) reads status = 'executed'.
-- Clients keep their existing access: the table grants and RLS policies (0011) cover new columns.
-- Safe to run more than once.

alter table irrigation_commands
    add column if not exists finished_at timestamptz;

comment on column irrigation_commands.status is
    'pending = waiting for the kit; executed = the kit acknowledged and STARTED the run (not finished: see finished_at); failed = given up after 2 hours.';

comment on column irrigation_commands.finished_at is
    'When the kit reported the finished run (the matching irrigation_event). Null while watering, or if the kit never reported it.';

alter table irrigation_event
    add column if not exists command_id uuid references irrigation_commands (id) on delete set null;

comment on column irrigation_event.command_id is
    'The command this run came from (Water now, a schedule, automatic). Null for runs the kit started on its own.';

create index if not exists idx_irrigation_event_command_id on irrigation_event (command_id);

-- Finding the started, unfinished command a reported run belongs to.
create index if not exists idx_irrigation_commands_zone_started_unfinished
    on irrigation_commands (zone_id, executed_at desc)
    where status = 'executed' and finished_at is null;
