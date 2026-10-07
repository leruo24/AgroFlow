-- Dismiss and history for notifications (admin polish, item 1).
--
-- One row each time someone dismisses a notification - an alert, an insight
-- card, a Home "Needs attention" card or a health warning - for either the
-- admin team or a farm. Rows are NEVER deleted: Restore stamps the row, so
-- the history shows what was dismissed, when, by whom, any note, and when and
-- by whom it was brought back.
--
-- ai_recommendation.dismissed_at (0027) is reused and kept in step by the
-- API (set on dismiss, cleared on restore), so every existing reader still
-- works. Its new dismissed_by_profile_id says who.
--
-- RLS on. Admins read everything; a farmer reads the farmer-side rows of
-- farms they can access. Nobody writes through RLS: AgroFlow.Api connects as
-- the table owner and takes the person from the login, never from the body.
--
-- Additive and idempotent: safe to re-run.

create table if not exists dismissal (
    id                       bigint generated always as identity primary key,
    audience                 text not null check (audience in ('admin', 'farmer')),
    item_kind                text not null check (item_kind in ('alert', 'insight', 'attention', 'health')),
    item_key                 text not null,
    farm_id                  bigint references farm (farm_id) on delete set null,

    -- What the item said and when it was raised, kept here so the history
    -- reads on its own even after the item itself has gone.
    title                    text not null,
    raised_at                timestamptz,

    -- A critical item comes back when its condition happens again: the
    -- dismissal only hides it while condition_key is unchanged.
    critical                 boolean not null default false,
    condition_key            text,

    dismissed_by_profile_id  uuid references profile (id) on delete set null,
    dismissed_by_name        text not null default 'Unknown',
    dismissed_at             timestamptz not null default now(),
    note                     text,

    restored_by_profile_id   uuid references profile (id) on delete set null,
    restored_by_name         text,
    restored_at              timestamptz
);

create index if not exists idx_dismissal_active
    on dismissal (audience, item_kind, item_key)
    where restored_at is null;

create index if not exists idx_dismissal_farm
    on dismissal (farm_id, dismissed_at desc)
    where farm_id is not null;

alter table ai_recommendation
    add column if not exists dismissed_by_profile_id uuid references profile (id) on delete set null;

comment on table dismissal is
    'Each dismissal of a notification (alert, insight, attention card, health warning), admin or farmer side. Never deleted; restore stamps the row.';
comment on column ai_recommendation.dismissed_by_profile_id is
    'Who dismissed the insight (from the login). Set with dismissed_at; cleared with it on restore.';

alter table dismissal enable row level security;

grant select on dismissal to authenticated;

drop policy if exists dismissal_select_admin on dismissal;
create policy dismissal_select_admin
    on dismissal
    for select
    to authenticated
    using (app_is_admin());

drop policy if exists dismissal_select_farmer on dismissal;
create policy dismissal_select_farmer
    on dismissal
    for select
    to authenticated
    using (audience = 'farmer' and farm_id is not null and app_can_access_farm(farm_id));
