-- Farmer-requested PDF reports, and the queue that produces them.
--
-- WHY A ROW AND NOT JUST A DOWNLOAD
-- ---------------------------------
-- Olwethu's report endpoints already return a PDF synchronously, and the
-- admin dashboard downloads them that way. That works for an admin at a desk
-- on a laptop. It does not work for the farmer this table is for:
--
--   * generation runs the FAO-56 engine over a date range and can take long
--     enough that a phone on rural data times out mid-download;
--   * the farmer wants the report to ARRIVE - on Telegram, where they
--     already get everything else - not to sit holding a phone waiting;
--   * and the automatic weekly/monthly reports (0035) have no user waiting
--     at all, so they need somewhere to record what was asked for and what
--     happened.
--
-- So the request is a row, the work happens behind it, and both the app and
-- the scheduler put rows in the same queue.
--
-- Idempotent: safe to re-run.

create table if not exists report_request (
    id              bigint generated always as identity primary key,

    -- Who asked. For an automatic request this is the farm owner, so the
    -- row still has somebody to deliver to and to scope RLS by.
    profile_id      uuid not null references profile (id) on delete cascade,

    farm_id         bigint not null references farm (farm_id) on delete cascade,

    -- null = every zone on the farm. Not an empty array and not a magic 0:
    -- null is the only value that cannot be confused with "a zone that was
    -- deleted", which matters because the choice is replayed months later by
    -- the scheduler.
    zone_id         bigint references zone (id) on delete set null,

    -- The three reports that exist. Matches the three PDF endpoints exactly -
    -- if a fourth is ever added, this constraint and the generator's switch
    -- have to be extended in the same change.
    report_type     text not null
                    check (report_type in ('water_usage', 'moisture', 'schedule')),

    period_start    date not null,
    period_end      date not null,

    status          text not null default 'preparing'
                    check (status in ('preparing', 'ready', 'failed')),

    -- Where to get the PDF. See the note at the bottom of this file: this
    -- holds the API path that REGENERATES the report, not a stored object,
    -- because this deployment has no object storage.
    file_path       text,

    -- 'app' = a farmer tapped Request. 'auto' = the scheduler (0035) made it.
    -- Kept apart so an admin can tell at a glance whether the automatic
    -- reports are actually running, and so a farmer's own request is never
    -- suppressed by the scheduler's duplicate check.
    requested_via   text not null default 'app'
                    check (requested_via in ('app', 'auto')),

    created_at      timestamptz not null default now(),

    -- When a worker picked this row up. The CLAIM marker, not just a
    -- timestamp: the generator selects rows where this is null and stamps it
    -- inside the same transaction, so a second poll - or a second container -
    -- cannot pick up a request that is already being rendered and send the
    -- farmer two copies. status alone cannot do this job, because a row stays
    -- 'preparing' for the whole time it is being worked on.
    started_at      timestamptz,

    completed_at    timestamptz,

    -- Plain words, shown to the farmer. Never a stack trace.
    error           text,

    constraint report_request_period_order_check
        check (period_end >= period_start)
);

create index if not exists idx_report_request_profile
    on report_request (profile_id, created_at desc);

create index if not exists idx_report_request_farm
    on report_request (farm_id, created_at desc);

-- The generator's own queue query: oldest first so a backlog drains in the
-- order it was asked for. Partial, because a healthy queue is almost empty.
create index if not exists idx_report_request_pending
    on report_request (created_at)
    where status = 'preparing' and started_at is null;

-- "Has this schedule already produced this period's report?" - the
-- scheduler's duplicate check (0035). Covers only automatic rows, because a
-- farmer may legitimately ask for the same report twice.
create index if not exists idx_report_request_auto_period
    on report_request (farm_id, report_type, period_start, period_end)
    where requested_via = 'auto';

comment on column report_request.file_path is
    'The API path that regenerates this report. NOT a stored file: this deployment has no object storage and Railway containers have an ephemeral filesystem, so a saved PDF would vanish on the next deploy. The request row holds the parameters, which is what actually makes the report reproducible.';
comment on column report_request.zone_id is
    'null means every zone on the farm. Deliberately null rather than an empty list, so it can never be confused with "the chosen zone was deleted".';

-- ---------------------------------------------------------------------------
-- Row-level security
--
-- Farmers see and create their own rows. Admins see everything. Nobody
-- updates: status, file_path and error are written by AgroFlow.Api as the
-- table-owning `postgres` role, which bypasses RLS - a farmer who could mark
-- their own request 'ready' would be able to hide a failure from the team.
-- ---------------------------------------------------------------------------
alter table report_request enable row level security;

grant select, insert on report_request to authenticated;
grant usage, select on sequence report_request_id_seq to authenticated;

drop policy if exists report_request_select_own on report_request;
create policy report_request_select_own
    on report_request
    for select
    to authenticated
    using (profile_id = auth.uid());

-- The farm check is what stops a farmer requesting a report for a farm they
-- are not on. profile_id = auth.uid() alone would let them name any farm_id.
drop policy if exists report_request_insert_own on report_request;
create policy report_request_insert_own
    on report_request
    for insert
    to authenticated
    with check (
        profile_id = auth.uid()
        and app_can_access_farm(farm_id)
    );

drop policy if exists report_request_all_admin on report_request;
create policy report_request_all_admin
    on report_request
    for all
    to authenticated
    using (app_is_admin())
    with check (app_is_admin());

-- ---------------------------------------------------------------------------
-- WHERE THE PDFs LIVE, AND WHY
--
-- The brief's first choice was Supabase Storage, in a private `reports`
-- bucket, with signed URLs. This project has NO storage integration of any
-- kind - no bucket, no client, and nothing that holds a storage credential -
-- so that would have meant adding one, plus a new secret, plus a retention
-- policy, on the night before a deploy.
--
-- Its second choice is what this implements: "store them where the existing
-- PDF endpoints can regenerate them on demand."
--
-- That is the better fit here anyway. AgroFlow.Api runs on Railway, whose
-- container filesystem is ephemeral - a PDF written to disk is gone on the
-- next deploy, which for a weekly report is days, not months. And the reports
-- are pure functions of data the database already holds: the same request
-- parameters regenerate a byte-identical PDF whenever it is asked for. So the
-- parameters ARE the stored report, and file_path points at the endpoint that
-- renders them.
--
-- The one thing this does not give is a frozen snapshot: a report regenerated
-- after the underlying readings change will differ from the one the farmer
-- first opened. For a water-usage summary over a closed date range that is
-- very nearly never, because those rows do not change once the day has
-- passed. If it ever matters, the upgrade is to add storage and fill
-- file_path with a real object key - no other column changes.
-- ---------------------------------------------------------------------------
