-- Who did what, and when.
--
-- WHY
-- ---
-- Nothing in AgroFlow recorded administrator actions. A request moved from
-- pending to scheduled and the only trace was the new value - not who moved
-- it, not when, and not what it had been before. "Platform Activity" was a
-- page saying there was nowhere to read this from.
--
-- That matters for three different reasons, and only one of them is audit in
-- the compliance sense:
--
--   1. A farmer rings to ask when somebody is coming. Whoever answers needs
--      to see that Leruo scheduled it on Tuesday, not just that it is
--      "scheduled".
--   2. Four people share one admin role. Without a name against an action,
--      "who revoked that kit?" has no answer at all.
--   3. Revoking a device, archiving a farm and resetting a password are
--      destructive and irreversible. An append-only record is what makes
--      them safe to delegate.
--
-- APPEND-ONLY, DELIBERATELY. No update policy and no delete policy, for
-- anyone - see the RLS block. A log that can be edited answers none of the
-- three questions above.
--
-- Idempotent: safe to re-run.

create table if not exists admin_audit_log (
    id                bigint generated always as identity primary key,

    -- WHO. Taken from the JWT by the API, never from the request body - a
    -- caller must not be able to name somebody else as the actor.
    actor_profile_id  uuid references profile (id) on delete set null,

    -- Denormalised on purpose. The log has to stay readable after a profile
    -- is deleted or renamed, and "who did this" is a fact about the moment
    -- it happened, not a live lookup. The FK above goes null; this does not.
    actor_name        text not null default 'Unknown',

    -- Dotted verb: 'request.status_changed', 'device.revoked',
    -- 'farm.archived'. Grouped by entity so the Activity page can filter on
    -- a prefix without a second column to keep in step.
    action            text not null,

    entity_type       text not null,
    entity_id         text,

    -- Nullable: some actions are not about a farm (a user created, an MQTT
    -- login added). Where it IS known it is stored, so the Activity page can
    -- filter by farm without joining through four tables.
    farm_id           bigint references farm (farm_id) on delete set null,

    -- Before/after for the fields that changed, plus whatever else makes the
    -- row readable on its own. jsonb rather than text so a later question
    -- ("every status change to completed") is a query, not a scan.
    details           jsonb not null default '{}'::jsonb,

    created_at        timestamptz not null default now()
);

-- The Activity page's default view: newest first.
create index if not exists idx_admin_audit_log_created
    on admin_audit_log (created_at desc);

-- Its filters.
create index if not exists idx_admin_audit_log_actor
    on admin_audit_log (actor_profile_id, created_at desc);

create index if not exists idx_admin_audit_log_action
    on admin_audit_log (action, created_at desc);

create index if not exists idx_admin_audit_log_farm
    on admin_audit_log (farm_id, created_at desc)
    where farm_id is not null;

-- "Everything that happened to this request / this kit", which is what the
-- per-item timelines read.
create index if not exists idx_admin_audit_log_entity
    on admin_audit_log (entity_type, entity_id, created_at desc);

comment on table admin_audit_log is
    'Append-only record of administrator actions. Inserted only by AgroFlow.Api as the table owner; admins may read, nobody may update or delete.';
comment on column admin_audit_log.actor_name is
    'The actor name as it was at the time. Denormalised so the log stays readable after a profile is renamed or deleted.';

-- ---------------------------------------------------------------------------
-- Row-level security
--
-- Admins READ. Nobody writes through RLS at all: AgroFlow.Api connects as the
-- table-owning postgres role and bypasses it, which is how the audit rows get
-- in. There is deliberately NO insert policy, so a client holding an admin
-- JWT still cannot forge a row, and no update or delete policy for anyone,
-- which is what makes this append-only rather than merely "append-mostly".
--
-- A farmer gets nothing: the select policy is admin-only, so
-- `select * from admin_audit_log` returns zero rows for them even though the
-- grant below is to `authenticated`.
-- ---------------------------------------------------------------------------
alter table admin_audit_log enable row level security;

grant select on admin_audit_log to authenticated;

-- No sequence grant: nothing but the owner inserts.
revoke insert, update, delete on admin_audit_log from authenticated;
revoke all on admin_audit_log from anon;

drop policy if exists admin_audit_log_select_admin on admin_audit_log;
create policy admin_audit_log_select_admin
    on admin_audit_log
    for select
    to authenticated
    using (app_is_admin());

-- ---------------------------------------------------------------------------
-- The accountability chain on a request.
--
-- service_request (0021) recorded a status and nothing about who moved it
-- there. These five columns are the "who and when" for each step, so the
-- admin Requests page can show a timeline rather than a single word.
--
-- Additive: every column is nullable, nothing existing changes meaning, and
-- rows created before this simply have nulls - which read correctly as
-- "we do not know who did this", because we genuinely do not.
-- ---------------------------------------------------------------------------
alter table service_request
    add column if not exists assigned_to_profile_id   uuid references profile (id) on delete set null,
    add column if not exists scheduled_by_profile_id  uuid references profile (id) on delete set null,
    add column if not exists scheduled_at             timestamptz,
    add column if not exists completed_by_profile_id  uuid references profile (id) on delete set null,
    add column if not exists completed_at             timestamptz;

create index if not exists idx_service_request_assigned
    on service_request (assigned_to_profile_id)
    where assigned_to_profile_id is not null;

comment on column service_request.assigned_to_profile_id is
    'The admin who picked this up. Set from the Assigned-to picker, independently of status - somebody can own a request before it is scheduled.';
comment on column service_request.scheduled_at is
    'When the installation was booked, set when status becomes scheduled. Distinct from updated_at, which moves on any edit.';

-- The admin dashboard reads these back through PostgREST, so it needs the
-- grant. Writes still go through the API (PUT /api/admin/requests/{id}/status),
-- which is what records the audit row alongside them.
grant select on service_request to authenticated;
