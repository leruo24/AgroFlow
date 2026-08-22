-- Moves irrigation decision-making from the ESP32 firmware into Postgres:
-- zone health status, water usage totals, moisture-threshold auto-start/stop,
-- and time-of-day schedules - all expressed as triggers/cron writing into
-- irrigation_commands, which is the one channel the firmware already polls.
--
-- All thresholds/windows below are named `constant` inside their functions
-- and commented - that's the intended place to tune them, not the app code.

-- ---------------------------------------------------------------------------
-- Zone config columns needed by the triggers below.
-- ---------------------------------------------------------------------------
alter table zone
    add column moisture_dry_threshold real default 30, -- % - below this, auto-irrigation starts
    add column moisture_wet_threshold real default 60, -- % - above this, auto-irrigation stops
    add column water_used_total       real not null default 0;
    -- water_used_total is a NEW column, not a reuse of water_saved: "saved"
    -- implies a comparison against some baseline (e.g. vs. manual watering),
    -- which nothing here computes - it would have been misleading to stuff a
    -- running usage total into a column named "saved". water_saved is left
    -- exactly as-is (still unpopulated by anything, still means whatever
    -- future savings-calculation logic wants it to mean).

-- Cheap "used today" reporting without a stored/reset column - "today" is a
-- query-time concept (and timezone-dependent), so it's a view over
-- irrigation_event rather than a trigger-maintained counter that would need
-- a midnight-reset job. Assumes UTC "today" - see the schedule section below
-- for the same timezone caveat.
create view zone_daily_water_usage as
select
    zone_id,
    coalesce(sum(estimated_litres), 0) as used_today_litres
from irrigation_event
where started_at >= date_trunc('day', now())
group by zone_id;

-- ---------------------------------------------------------------------------
-- irrigation_commands.source: distinguishes who/what issued a command.
-- Needed so the auto/scheduled triggers below can tell "is there an active
-- MANUAL override" apart from their own prior commands - without this,
-- auto-irrigation would cooldown-block itself after every command it issues.
-- Defaults to 'manual' so the app's existing insert paths (which never set
-- this column) keep working unchanged - they only ever issue farmer-driven
-- commands anyway.
-- ---------------------------------------------------------------------------
alter table irrigation_commands
    add column source text not null default 'manual'
        check (source in ('manual', 'auto', 'scheduled'));

create index idx_irrigation_commands_zone_source_status
    on irrigation_commands (zone_id, source, status);

-- irrigation_event.trigger_source only allowed ('auto','manual','unknown') -
-- widened to include 'scheduled' now that schedules are a real command
-- source the firmware can receive and needs to echo back into the event log.
alter table irrigation_event
    drop constraint irrigation_event_trigger_source_check;

alter table irrigation_event
    add constraint irrigation_event_trigger_source_check
        check (trigger_source in ('auto', 'manual', 'scheduled', 'unknown'));

-- ---------------------------------------------------------------------------
-- 1. Health status trigger
-- Recalculates zone.health_status on every sensor_reading insert, using the
-- same "latest reading per sensor_type" logic as zone_latest_reading (the
-- newly-inserted row is already visible to it within the same transaction).
-- ---------------------------------------------------------------------------
create or replace function calculate_zone_health(p_zone_id bigint)
returns text
language plpgsql
as $$
declare
    -- Tunable thresholds. Moisture is the primary signal (matches the
    -- original Zone health model: <20 Critical, <40 Warning, else Healthy);
    -- temperature/humidity only ever escalate severity, never on their own
    -- override a healthy moisture reading into Critical.
    moisture_critical_max    constant real := 20;
    moisture_warning_max     constant real := 40;
    temperature_critical_min constant real := 38; -- heat this extreme is Critical regardless of moisture
    temperature_warning_min  constant real := 33; -- heat this high adds Warning-level stress
    humidity_warning_max     constant real := 20; -- air this dry adds evapotranspiration stress

    v_moisture    real;
    v_temperature real;
    v_humidity    real;
begin
    select moisture, temperature, humidity
      into v_moisture, v_temperature, v_humidity
      from zone_latest_reading
     where zone_id = p_zone_id;

    if v_moisture is null then
        return 'Unknown'; -- no soil moisture reading yet - can't assess
    end if;

    if v_moisture < moisture_critical_max
       or (v_temperature is not null and v_temperature >= temperature_critical_min) then
        return 'Critical';
    end if;

    if v_moisture < moisture_warning_max
       or (v_temperature is not null and v_temperature >= temperature_warning_min)
       or (v_humidity is not null and v_humidity < humidity_warning_max) then
        return 'Warning';
    end if;

    return 'Healthy';
end;
$$;

create or replace function update_zone_health()
returns trigger
language plpgsql
as $$
begin
    update zone
       set health_status = calculate_zone_health(new.zone_id)
     where id = new.zone_id;
    return new;
end;
$$;

create trigger trg_sensor_reading_health_status
    after insert on sensor_reading
    for each row execute function update_zone_health();

-- ---------------------------------------------------------------------------
-- 2. Water usage trigger
-- Running cumulative total, updated on every irrigation_event insert. See
-- zone_daily_water_usage above for "today" reporting.
-- ---------------------------------------------------------------------------
create or replace function update_zone_water_usage()
returns trigger
language plpgsql
as $$
begin
    update zone
       set water_used_total = water_used_total + new.estimated_litres
     where id = new.zone_id;
    return new;
end;
$$;

create trigger trg_irrigation_event_water_usage
    after insert on irrigation_event
    for each row execute function update_zone_water_usage();

-- ---------------------------------------------------------------------------
-- 3. Auto-irrigation trigger
-- Fires on every SoilMoisture sensor_reading insert. Only inserts a command
-- when the moisture-driven decision actually CHANGES from what was last
-- instructed (compares against the most recent irrigation_commands row for
-- the zone) - readings arrive every ~30s per the firmware's report interval,
-- so without this de-dup check a zone sitting below the dry threshold would
-- get a new 'start' command inserted on every single reading.
-- ---------------------------------------------------------------------------
create or replace function auto_irrigation_check()
returns trigger
language plpgsql
as $$
declare
    -- Tunable: how long a manual command holds the floor against auto
    -- logic after it's issued/executed, so auto-irrigation doesn't fight a
    -- farmer's manual override mid-cycle. Shared with the schedule firing
    -- function below - keep them in sync if you change this.
    manual_cooldown constant interval := interval '30 minutes';

    v_dry_threshold real;
    v_wet_threshold real;
    v_desired       text;
    v_last_command  text;
    v_manual_active boolean;
begin
    if new.sensor_type <> 'SoilMoisture' then
        return new; -- only soil moisture drives irrigation decisions
    end if;

    select moisture_dry_threshold, moisture_wet_threshold
      into v_dry_threshold, v_wet_threshold
      from zone
     where id = new.zone_id;

    v_desired := case
        when new.value < v_dry_threshold then 'start'
        when new.value > v_wet_threshold then 'stop'
        else null -- inside the dead band between thresholds (or thresholds unset) - no change needed
    end;

    if v_desired is null then
        return new;
    end if;

    select exists (
        select 1 from irrigation_commands
         where zone_id = new.zone_id
           and source = 'manual'
           and (
                status = 'pending'
                or (status = 'executed' and executed_at > now() - manual_cooldown)
           )
    ) into v_manual_active;

    if v_manual_active then
        return new; -- don't fight a farmer's manual override
    end if;

    select command into v_last_command
      from irrigation_commands
     where zone_id = new.zone_id
     order by created_at desc
     limit 1;

    if v_last_command is distinct from v_desired then
        insert into irrigation_commands (zone_id, command, source)
        values (new.zone_id, v_desired, 'auto');
    end if;

    return new;
end;
$$;

create trigger trg_sensor_reading_auto_irrigation
    after insert on sensor_reading
    for each row execute function auto_irrigation_check();

-- ---------------------------------------------------------------------------
-- 4. Schedule table + pg_cron firing
-- days_of_week uses Postgres's own extract(dow) numbering (0=Sunday..
-- 6=Saturday), not day-name text, so the cron function's day check is a
-- plain integer membership test - no locale-dependent day-name parsing.
-- NOTE: this does NOT match the app's placeholder IrrigationSchedule.days
-- shape (string[] of 'Mon'/'Wed'/'Fri' abbreviations, still unused/mock) -
-- whichever UI eventually manages schedules will need a small mapping
-- function between the two. Flagging rather than silently picking one.
-- NOTE: start_time is treated as UTC throughout (no per-farm timezone
-- column exists anywhere in the schema) - if farms end up spanning multiple
-- timezones this will need revisiting.
-- ---------------------------------------------------------------------------
create table irrigation_schedule (
    id                bigint generated always as identity primary key,
    zone_id           bigint not null references zone (id) on delete cascade,
    start_time        time not null,
    duration_minutes  integer not null,
    days_of_week      integer[] not null default '{0,1,2,3,4,5,6}',
    enabled           boolean not null default true,
    created_at        timestamptz not null default now(),
    updated_at        timestamptz not null default now()
);

create index idx_irrigation_schedule_zone_id on irrigation_schedule (zone_id);

create trigger trg_irrigation_schedule_updated_at
    before update on irrigation_schedule
    for each row execute function set_updated_at();

-- Supabase allow-lists pg_cron, so this should succeed as-is from the SQL
-- editor/CLI migration run. If it errors on permissions, enable it first via
-- Database -> Extensions -> pg_cron in the Supabase dashboard, then re-run
-- from here down.
create extension if not exists pg_cron;

create or replace function fire_due_irrigation_schedules()
returns void
language plpgsql
as $$
declare
    -- Tunable: same cooldown as auto-irrigation, see auto_irrigation_check().
    manual_cooldown       constant interval := interval '30 minutes';

    -- Tunable: this function is expected to run this often via
    -- cron.schedule below. Keep this >= the actual cron interval so a due
    -- schedule can never slip through the gap between two runs.
    check_window_minutes  constant int := 5;

    now_minutes int := (extract(hour from now()) * 60 + extract(minute from now()))::int;
    sched record;
    schedule_minutes int;
    elapsed_minutes int;
    v_manual_active boolean;
begin
    for sched in
        select s.zone_id, s.start_time, s.duration_minutes
          from irrigation_schedule s
         where s.enabled
           and extract(dow from now())::int = any (s.days_of_week)
    loop
        schedule_minutes := (extract(hour from sched.start_time) * 60 + extract(minute from sched.start_time))::int;

        -- Minutes since this schedule's start_time today. mod() with a
        -- positive modulus is always non-negative in Postgres, so this
        -- wraps correctly across midnight (unlike a naive
        -- `now()::time between start_time and start_time + window`, which
        -- silently fails for schedules within `check_window` of midnight).
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
        values (sched.zone_id, 'start', 'scheduled', sched.duration_minutes * 60);
    end loop;
end;
$$;

-- cron.schedule() upserts by job name (pg_cron 1.4+), so re-running this
-- migration updates the existing job rather than creating a duplicate.
select cron.schedule(
    'fire-irrigation-schedules',
    '*/5 * * * *', -- every 5 minutes - MUST match check_window_minutes above
    $$select fire_due_irrigation_schedules();$$
);
