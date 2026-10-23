-- Audit fixes, Part A: trust and data (docs/audit/fix-report-2026-10-23.md).
--
--   1. onboarding_request (AF-01, B3-01): one row per staff "Onboard farmer" attempt, keyed by
--      the request id the admin site makes when the form opens. The farm, its zones and the
--      coordinates are saved in one transaction with this row; the account is created after.
--      A retry with the same id continues the same farmer and farm instead of making new ones,
--      and the admin site reads the row's status instead of offering "Create again".
--   2. zone.irrigation_mode now defaults to 'manual' (decision: new zones start in Manual and
--      only switch to Automatic after commissioning). Existing zones keep their mode: only the
--      column default changes, no row is updated.
--   3. The run cap (AF-05): every start is capped at the zone's maximum run time
--      (zone.max_run_minutes, 0052), whichever path inserted it: Water now (the API), a
--      schedule (fire_due_irrigation_schedules, pg_cron) or automatic watering. A trigger does it
--      so no path can miss it; the API also caps first, so it can tell the farmer.
--      irrigation_commands.requested_duration_seconds keeps what was asked for.
--   4. irrigation_commands.published_at: when the API handed the command to the broker, so the
--      app can tell "Request sent" (saved) from "Waiting for kit" (sent to the kit, no answer yet).
--
-- The firmware's own cap (min(requested, maxRunSeconds)) is unchanged and stays independent.
-- RLS: onboarding_request is read and written by the API only. irrigation_commands keeps its
-- grants and policies (0011); new columns are covered by them.
-- Safe to run more than once.

-- 1. Onboarding requests ---------------------------------------------------------------------

create table if not exists onboarding_request (
    request_id      uuid primary key,
    -- started: validated, nothing saved yet; farm_saved: farm + zones + coordinates committed;
    -- account_created: the farmer's sign-in exists and owns the farm; completed: handover ready;
    -- failed: stopped at last_step, retry with the same request_id to continue.
    status          text not null default 'started'
                    check (status in ('started', 'farm_saved', 'account_created', 'completed', 'failed')),
    last_step       text,
    email           text not null,
    farm_id         bigint references farm (farm_id) on delete set null,
    profile_id      uuid references profile (id) on delete set null,
    enquiry_id      bigint references enquiry (id) on delete set null,
    created_by      uuid references profile (id) on delete set null,
    last_error      text,
    attempts        integer not null default 1,
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now()
);

create index if not exists idx_onboarding_request_email on onboarding_request (lower(email));
create index if not exists idx_onboarding_request_farm on onboarding_request (farm_id);

alter table onboarding_request enable row level security;
revoke all on onboarding_request from anon, authenticated;

comment on table onboarding_request is
    'One staff onboarding attempt (AF-01). The farm, zones and coordinates are saved in one transaction with it; a retry with the same request_id continues the same farmer and farm. API only.';

-- 2. New zones start in Manual ---------------------------------------------------------------

alter table zone alter column irrigation_mode set default 'manual';

comment on column zone.irrigation_mode is
    'manual (default for new zones), automatic or scheduled. A new zone is switched to automatic only after commissioning (kit linked, wet/dry calibration, measured flow, an acknowledged test start/stop); zones that existed before 0057 keep their mode.';

-- 3 + 4. The run cap and the publish time ----------------------------------------------------

alter table irrigation_commands
    add column if not exists requested_duration_seconds integer,
    add column if not exists published_at timestamptz;

comment on column irrigation_commands.requested_duration_seconds is
    'What was asked for, when it was more than the zone''s maximum run time; duration_seconds is then the capped length the kit is sent. Null when nothing was capped.';
comment on column irrigation_commands.published_at is
    'When the API published the command to the kit over MQTT. Null: saved, not sent yet ("Request sent").';

create or replace function cap_irrigation_command_duration()
returns trigger
language plpgsql
as $$
declare
    v_max_minutes integer;
    v_cap_seconds integer;
begin
    if new.command <> 'start' or new.duration_seconds is null then
        return new;
    end if;

    select max_run_minutes into v_max_minutes from zone where id = new.zone_id;
    -- Out of range or missing reads as the default (IrrigationRunRules.ZoneMaxOrDefault).
    if v_max_minutes is null or v_max_minutes < 1 or v_max_minutes > 120 then
        v_max_minutes := 5;
    end if;
    v_cap_seconds := v_max_minutes * 60;

    if new.duration_seconds > v_cap_seconds then
        new.requested_duration_seconds := coalesce(new.requested_duration_seconds, new.duration_seconds);
        new.duration_seconds := v_cap_seconds;
    end if;
    return new;
end;
$$;

comment on function cap_irrigation_command_duration() is
    'Caps every start at the zone''s maximum run time (AF-05), on every insert path; keeps the request in requested_duration_seconds.';

drop trigger if exists trg_irrigation_commands_cap on irrigation_commands;
create trigger trg_irrigation_commands_cap
    before insert on irrigation_commands
    for each row execute function cap_irrigation_command_duration();

-- 5. A request's rough size has a unit (AF-19) ------------------------------------------------
-- rough_size stays in hectares (what staff already read); rough_size_unit says what the farmer
-- chose: 'ha', 'm2' (converted to hectares, 1 ha = 10 000 m2), 'unknown' ("I don't know - help me
-- measure", rough_size null) or 'unstated' (an older app that sent a bare number). Staff never see
-- an unqualified number again.

alter table service_request
    add column if not exists rough_size_unit text;

do $guard$
begin
    if not exists (select 1 from pg_constraint
                   where conrelid = 'public.service_request'::regclass and conname = 'service_request_rough_size_unit_check') then
        alter table service_request
            add constraint service_request_rough_size_unit_check
            check (rough_size_unit is null or rough_size_unit in ('ha', 'm2', 'unknown', 'unstated'));
    end if;
end $guard$;

comment on column service_request.rough_size_unit is
    'What the farmer chose for rough_size (AF-19): ha, m2 (rough_size is still stored in hectares), unknown (help me measure; rough_size null) or unstated (an older app sent a bare number).';
