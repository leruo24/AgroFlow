-- Two new device commands: open_setup and change_wifi.
--
-- WHY THEY TRAVEL ON irrigation_commands
-- --------------------------------------
-- They are not irrigation. They ride that table anyway because it is already
-- the whole command pipeline: an insert fires trg_irrigation_commands_notify
-- -> pg_notify -> IrrigationCommandNotifyService -> publish on the device's
-- existing .../commands topic, with a uuid id the firmware ACKs through
-- POST /api/devices/commands/{id}/executed, and a replay sweep that redelivers
-- anything a board missed while offline (0019, CommandReplayPolicy).
--
-- A parallel table for two commands would need a second trigger, a second
-- notify channel, a second publisher and a second ACK route, all to carry the
-- identical envelope to the identical topic. The firmware already treats all
-- four commands the same way - one handler, one ACK. So the table is now the
-- device command queue that it has in practice always been.
--
-- WHY THIS IS SAFE FOR THE EXISTING COMMANDS
-- ------------------------------------------
-- Additive only: 'start' and 'stop' keep their exact previous meaning, and
-- every reader of this table either switches on the command value (the
-- firmware, which ignores anything it does not recognise) or does not look at
-- it at all (the replay sweep, the ACK endpoint). duration_seconds stays
-- nullable and is simply absent on both new commands.
--
-- Idempotent: dropping the constraint before adding it makes this re-runnable.
--
-- The constraint in 0004 is anonymous - `command text not null check (command
-- in ('start','stop'))` - so Postgres named it from the table and column, as
-- irrigation_commands_command_check. That is the name dropped below. Verify it
-- before applying, with:
--
--   select conname, pg_get_constraintdef(oid) from pg_constraint
--    where conrelid = 'irrigation_commands'::regclass and contype = 'c';
--
-- If the live name differs, change the DROP line to match. A wrong name would
-- not error - `drop constraint if exists` is silent - and the ADD would then
-- fail on the old constraint still being there, which is the safe direction to
-- fail in: nothing is applied and the old rule still holds.

alter table irrigation_commands
    drop constraint if exists irrigation_commands_command_check;

alter table irrigation_commands
    add constraint irrigation_commands_command_check
    check (command in ('start', 'stop', 'open_setup', 'change_wifi'));

-- Neither new command takes a duration. Stated as a constraint rather than
-- left to the API because the pipeline has three writers (the app's manual
-- insert, this API, and the pg_cron schedule job) and a stray
-- duration_seconds on a change_wifi would be a silent oddity in the payload
-- the board receives.
alter table irrigation_commands
    drop constraint if exists irrigation_commands_setup_no_duration_check;

alter table irrigation_commands
    add constraint irrigation_commands_setup_no_duration_check
    check (command not in ('open_setup', 'change_wifi') or duration_seconds is null);

comment on column irrigation_commands.command is
    'start/stop drive the pump. open_setup opens the board''s setup page keeping its WiFi; change_wifi makes it forget its WiFi and open the setup page, keeping farm/zone/token. All four use the same envelope, topic and ACK route.';
