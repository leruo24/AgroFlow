-- Accountability: whoever acts is on the record (item 5).
--
-- WHY
-- ---
-- Work could be "assigned" to somebody by somebody else, so the name on an
-- alert or a request said who was TOLD to deal with it, not who did. And the
-- console's alert and maintenance actions never reached the database at all.
-- These columns record who is handling an item - always the person who
-- pressed "I'll handle this", taken from their login by the API - and who
-- finally resolved or completed it. Every step also goes to admin_audit_log
-- (0037) with the item's entity_type and entity_id, which is the per-item
-- timeline.
--
-- service_request.assigned_to_profile_id (0037) stays, readable, for history.
-- Nothing writes it any more except the tightened /assign route, which only
-- accepts the caller themself.
--
-- Additive and idempotent: nullable columns only, no row rewritten.

alter table service_request
    add column if not exists handled_by_profile_id uuid references profile (id) on delete set null,
    add column if not exists claimed_at            timestamptz;

alter table alert
    add column if not exists handled_by_profile_id  uuid references profile (id) on delete set null,
    add column if not exists claimed_at             timestamptz,
    add column if not exists resolved_by_profile_id uuid references profile (id) on delete set null,
    add column if not exists resolved_at            timestamptz,
    add column if not exists escalated_at           timestamptz;

alter table maintenance
    add column if not exists handled_by_profile_id   uuid references profile (id) on delete set null,
    add column if not exists claimed_at              timestamptz,
    add column if not exists completed_by_profile_id uuid references profile (id) on delete set null,
    add column if not exists completed_at            timestamptz;

create index if not exists idx_service_request_handled on service_request (handled_by_profile_id) where handled_by_profile_id is not null;
create index if not exists idx_alert_handled           on alert (handled_by_profile_id)           where handled_by_profile_id is not null;
create index if not exists idx_maintenance_handled     on maintenance (handled_by_profile_id)     where handled_by_profile_id is not null;

comment on column alert.handled_by_profile_id is
    'The admin handling this alert: always the person who claimed it (or took it over, with a reason in admin_audit_log). Set by the API from the login, never from a request body.';
comment on column alert.resolved_by_profile_id is
    'Who resolved it, from the login. Kept when the alert is reopened - it was resolved by that person, and the timeline says it was reopened.';

-- RLS is unchanged: 0011 already lets admins do everything on alert and
-- maintenance and farm members read their own rows; 0037 granted select on
-- service_request. All writes here go through the API.
