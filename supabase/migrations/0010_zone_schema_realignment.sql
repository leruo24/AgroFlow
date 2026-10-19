-- Reverses the 0006/0007 zone-column naming (moisture_dry_threshold /
-- moisture_wet_threshold, standalone irrigation_schedule table) in favour of
-- the columns the mobile app's zone-settings/schedule UI actually reads and
-- writes (apps/agroflow-app/src/context/AgroFlowContext.tsx,
-- apps/agroflow-app/src/app/zone/[id].tsx): moisture_threshold,
-- desired_moisture, irrigation_mode, schedule_enabled, schedule_days,
-- schedule_start_time, schedule_duration_minutes, automation_enabled,
-- weather_adjustment, name, location, size_value, size_unit - all living
-- directly on zone instead of a separate schedule table.
--
-- Run this against the live database in the Supabase SQL editor. Safe to
-- run again (every step is guarded), and whether or not 0006 was ever applied (IF EXISTS / IF NOT EXISTS
-- throughout) - if 0006 was never applied, the "add column" branches below
-- create moisture_threshold/desired_moisture fresh instead of renaming.

-- ---------------------------------------------------------------------------
-- 1. Threshold columns: rename if 0006's names are present, otherwise add
--    fresh. moisture_wet_threshold -> desired_moisture is a semantic
--    relabel, not just a rename: "desired_moisture" is the target level
--    auto-irrigation stops at, which is exactly what moisture_wet_threshold
--    already meant - no behaviour change, just the name the app uses.
-- ---------------------------------------------------------------------------
do $$
begin
    if exists (select 1 from information_schema.columns
               where table_name = 'zone' and column_name = 'moisture_dry_threshold') then
        alter table zone rename column moisture_dry_threshold to moisture_threshold;
    end if;

    if exists (select 1 from information_schema.columns
               where table_name = 'zone' and column_name = 'moisture_wet_threshold') then
        alter table zone rename column moisture_wet_threshold to desired_moisture;
    end if;
end $$;

alter table zone
    add column if not exists moisture_threshold real default 30, -- % - below this, auto-irrigation starts
    add column if not exists desired_moisture   real default 60; -- % - target level auto-irrigation stops at

-- ---------------------------------------------------------------------------
-- 2. New zone-level irrigation-mode / schedule / metadata columns the app's
--    zone-settings and schedule UI read and write directly.
-- ---------------------------------------------------------------------------
alter table zone
    add column if not exists irrigation_mode text not null default 'automatic'
        check (irrigation_mode in ('automatic', 'scheduled', 'manual')),
    add column if not exists schedule_enabled           boolean not null default false,
    add column if not exists schedule_days              text[] not null default '{}',
    add column if not exists schedule_start_time        text,
    add column if not exists schedule_duration_minutes  integer,
    add column if not exists automation_enabled         boolean not null default true,
    add column if not exists weather_adjustment         boolean not null default true,
    add column if not exists name                       text,
    add column if not exists location                   text,
    add column if not exists size_value                 real not null default 0,
    add column if not exists size_unit                  text not null default 'ha';

-- ---------------------------------------------------------------------------
-- 3. zone_latest_reading view: carry the renamed threshold columns instead
--    of the old names (this view is what AgroFlow.Api's
--    SensorReadingProcessor reads to make auto-irrigation decisions).
-- ---------------------------------------------------------------------------
-- Guarded: only while the view is missing or is still 0007's version (no moisture_threshold
-- column). The live view (0048) has it, so this does nothing there or on a second run.
-- Dropped first because the column names change, which CREATE OR REPLACE VIEW cannot do.
do $guard$
begin
    if not exists (select 1 from information_schema.columns
                   where table_schema = 'public' and table_name = 'zone_latest_reading'
                     and column_name = 'moisture_threshold') then
        drop view if exists zone_latest_reading;
        create view zone_latest_reading as
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
    end if;
end $guard$;

-- ---------------------------------------------------------------------------
-- 4. fire_due_irrigation_schedules(): read scheduling directly off zone
--    instead of the standalone irrigation_schedule table. Same cooldown /
--    de-dup / midnight-wraparound logic as the 0006 version, just sourced
--    from zone.irrigation_mode/schedule_* columns. day_names is a hardcoded
--    array (not to_char(now(), 'Dy')) so this isn't locale-dependent.
-- ---------------------------------------------------------------------------
-- Guarded: only when the function is missing or is still 0006's version (which reads the
-- irrigation_schedule table). Nothing later redefines it, so on the live database this
-- is already the current version and the block does nothing.
do $guard$
begin
    if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                   where n.nspname = 'public' and p.proname = 'fire_due_irrigation_schedules'
                     and p.prosrc !~ '\mirrigation_schedule\M') then
        create or replace function fire_due_irrigation_schedules()
        returns void
        language plpgsql
        as $$
        declare
            manual_cooldown       constant interval := interval '30 minutes';
            check_window_minutes  constant int := 5;
            day_names             constant text[] := array['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
            today_name            text := day_names[extract(dow from now())::int + 1];

            now_minutes int := (extract(hour from now()) * 60 + extract(minute from now()))::int;
            sched record;
            schedule_minutes int;
            elapsed_minutes int;
            v_manual_active boolean;
        begin
            for sched in
                select z.id as zone_id, z.schedule_start_time, z.schedule_duration_minutes
                  from zone z
                 where z.irrigation_mode = 'scheduled'
                   and z.schedule_enabled
                   and z.schedule_days is not null
                   and today_name = any (z.schedule_days)
                   and z.schedule_start_time is not null
                   and z.schedule_duration_minutes is not null
            loop
                schedule_minutes := (extract(hour from sched.schedule_start_time::time) * 60
                                      + extract(minute from sched.schedule_start_time::time))::int;

                -- mod() with a positive modulus is always non-negative in Postgres,
                -- so this wraps correctly across midnight (see 0006's comment on
                -- why a naive `now()::time between start and start + window` fails).
                elapsed_minutes := mod(now_minutes - schedule_minutes + 1440, 1440);

                if elapsed_minutes >= check_window_minutes then
                    continue; -- not due right now
                end if;

                select exists (
                    select 1 from irrigation_commands
                     where zone_id = sched.zone_id
                       and source = 'manual'
                       and (
                            status = 'pending'
                            or (status = 'executed' and executed_at > now() - manual_cooldown)
                       )
                ) into v_manual_active;

                if v_manual_active then
                    continue; -- don't fight a farmer's manual override
                end if;

                if exists (
                    select 1 from irrigation_commands
                     where zone_id = sched.zone_id
                       and source = 'scheduled'
                       and command = 'start'
                       and created_at > now() - make_interval(mins => check_window_minutes)
                ) then
                    continue; -- already fired this slot
                end if;

                insert into irrigation_commands (zone_id, command, source, duration_seconds)
                values (sched.zone_id, 'start', 'scheduled', sched.schedule_duration_minutes * 60);
            end loop;
        end;
        $$;
    end if;
end $guard$;

-- cron.schedule() upserts by job name (pg_cron 1.4+), so this just re-points
-- the existing 'fire-irrigation-schedules' job at the function above - no
-- new job is created, and the every-5-minutes cadence is unchanged.
-- Skipped when the job is already there with this exact schedule and command (the live
-- database). cron.job is read with EXECUTE so a database without pg_cron's table still runs.
do $guard$
declare
    already boolean := false;
begin
    if to_regclass('cron.job') is not null then
        execute $q$select exists (select 1 from cron.job where jobname = 'fire-irrigation-schedules'
                   and schedule = '*/5 * * * *' and command = 'select fire_due_irrigation_schedules();')$q$
            into already;
    end if;
    if not already then
        perform cron.schedule('fire-irrigation-schedules', '*/5 * * * *',
                              'select fire_due_irrigation_schedules();');
    end if;
end $guard$;

-- ---------------------------------------------------------------------------
-- 5. irrigation_schedule table: dropped. Nothing reads or writes it any
--    more after step 4 above - it was never wired to a real UI (0006 itself
--    flagged its days_of_week shape as not matching the app), and the
--    schedule editor in zone/[id].tsx writes schedule_enabled/schedule_days/
--    schedule_start_time/schedule_duration_minutes straight onto zone.
--
-- BEFORE RUNNING THIS LINE: if you want to double-check there's no data
-- worth keeping, run `select count(*) from irrigation_schedule;` first -
-- if that returns 0 (expected, since nothing ever wrote real schedules
-- through it), the drop below is safe.
-- ---------------------------------------------------------------------------
drop table if exists irrigation_schedule;

-- ---------------------------------------------------------------------------
-- 6. farm.latitude/longitude: the app's weather widget
--    (apps/agroflow-app/src/app/(tabs)/index.tsx) and AgroFlowContext's Farm
--    type both read these off farm already, but no migration in this repo
--    has ever added them - IF NOT EXISTS makes this safe to run regardless
--    of whether they were added manually out-of-band.
-- ---------------------------------------------------------------------------
alter table farm
    add column if not exists latitude  double precision,
    add column if not exists longitude double precision;
