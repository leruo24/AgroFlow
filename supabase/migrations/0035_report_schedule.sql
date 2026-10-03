-- Automatic reports: which farms get them, how often, and which ones.
--
-- OFF BY DEFAULT, DELIBERATELY
-- ---------------------------
-- There is no row here until an admin creates one, and `enabled` defaults to
-- false even then. Nothing starts sending a farmer weekly PDFs because a
-- migration ran. A farmer who did not ask for a document every Monday and
-- gets one anyway learns to ignore the channel - which is the same channel
-- the frost warnings go down.
--
-- ONE ROW PER FARM, not per farmer. The reports are about a farm's zones, and
-- a farm can have several members; keying on the farm means two people on one
-- farm cannot configure two contradictory schedules for the same zones.
--
-- Idempotent: safe to re-run.

create table if not exists report_schedule (
    id            bigint generated always as identity primary key,

    farm_id       bigint not null unique references farm (farm_id) on delete cascade,

    enabled       boolean not null default false,

    frequency     text not null default 'weekly'
                  check (frequency in ('weekly', 'monthly')),

    -- Which reports this farm wants. A text[] rather than three booleans
    -- because the set of report types is already a list in one place
    -- (ReportKinds) and three columns would need a migration to add a fourth.
    -- Values are the same keys report_request.report_type uses.
    report_types  text[] not null default array['water_usage']::text[],

    -- null = every zone on the farm, matching report_request.zone_id's
    -- meaning. An explicit list is for a farm where only some zones matter.
    zone_ids      bigint[],

    -- The period this schedule last produced reports FOR - not when the
    -- service last looked. That difference is what makes the duplicate check
    -- work across restarts: the question is "has this period been done", and
    -- a service that restarts twice an hour must not answer it twice.
    last_run_at   timestamptz,

    created_by    uuid references profile (id) on delete set null,

    created_at    timestamptz not null default now(),
    updated_at    timestamptz not null default now(),

    -- An enabled schedule that asks for nothing would wake the service every
    -- hour to produce zero reports.
    constraint report_schedule_types_not_empty
        check (not enabled or array_length(report_types, 1) >= 1)
);

create index if not exists idx_report_schedule_enabled
    on report_schedule (frequency)
    where enabled;

drop trigger if exists trg_report_schedule_updated_at on report_schedule;
create trigger trg_report_schedule_updated_at
    before update on report_schedule
    for each row execute function set_updated_at();

comment on column report_schedule.last_run_at is
    'The period this schedule last produced reports for. Not "when the service last ran": the duplicate check asks whether a PERIOD has been done, so it has to survive a container restarting mid-hour.';
comment on column report_schedule.zone_ids is
    'null means every zone on the farm, the same meaning report_request.zone_id carries. An explicit list is for a farm where only some zones matter.';

-- ---------------------------------------------------------------------------
-- Row-level security
--
-- Admins write. Farmers read their own farm's row, because the Reports screen
-- shows them what they are signed up for.
--
-- Farmers do NOT get an UPDATE policy, even for the off switch. Turning it off
-- goes through POST /api/farmer/auto-reports/stop, which runs as `postgres`
-- and sets exactly one column on exactly their own farm. A column-level
-- UPDATE grant would have worked too, but the endpoint also has to be able to
-- say "you are not on this farm" in plain words, and an RLS refusal arrives as
-- an empty result rather than a message.
-- ---------------------------------------------------------------------------
alter table report_schedule enable row level security;

grant select on report_schedule to authenticated;

drop policy if exists report_schedule_select_member on report_schedule;
create policy report_schedule_select_member
    on report_schedule
    for select
    to authenticated
    using (app_can_access_farm(farm_id));

drop policy if exists report_schedule_all_admin on report_schedule;
create policy report_schedule_all_admin
    on report_schedule
    for all
    to authenticated
    using (app_is_admin())
    with check (app_is_admin());
