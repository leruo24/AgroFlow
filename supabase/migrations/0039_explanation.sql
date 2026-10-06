-- "Why am I seeing this?" for messages that leave the app (item 2c).
--
-- WHY
-- ---
-- Every alert and piece of advice now carries an explanation built from the
-- rule that produced it. In-app insights store theirs in
-- ai_recommendation.data. A Telegram message has nowhere like that: its
-- "Why am I seeing this?" button can carry only a short id (Telegram limits
-- callback data to 64 bytes, and it must not carry personal data). This
-- table is what that id points at, so the bot can answer with the
-- explanation exactly as it was when the message was sent.
--
-- The row belongs to a FARM. The bot answers a "Why?" tap only for a chat
-- linked to a profile that owns or is a member of that farm - checked in the
-- API, and mirrored by RLS below for anyone reading through Supabase.
--
-- Written by the API only. Never updated, never deleted by users: it is a
-- record of what was said.
--
-- Additive and idempotent: safe to re-run.

create table if not exists explanation (
    id           bigint generated always as identity primary key,
    farm_id      bigint not null references farm (farm_id) on delete cascade,
    zone_id      bigint references zone (id) on delete cascade,

    -- What the message was about: 'zone_critical', 'weather_frost',
    -- 'system_device_offline', ... Free text so a new message kind needs no
    -- migration.
    kind         text not null,

    -- { summary, facts[{label,value,source}], rule, confidence,
    --   whatWouldChangeIt, technical } - the same shape the insights carry.
    explanation  jsonb not null,

    created_at   timestamptz not null default now()
);

create index if not exists idx_explanation_farm_created
    on explanation (farm_id, created_at desc);

-- ---------------------------------------------------------------------------
-- RLS. Members of the farm may read its explanations; admins may read all.
-- No insert/update/delete policy for anyone: only the API (table owner)
-- writes, and nothing rewrites what was said.
-- ---------------------------------------------------------------------------
alter table explanation enable row level security;

grant select on explanation to authenticated;

drop policy if exists explanation_select_member on explanation;
create policy explanation_select_member
    on explanation
    for select
    to authenticated
    using (app_can_access_farm(farm_id));

drop policy if exists explanation_select_admin on explanation;
create policy explanation_select_admin
    on explanation
    for select
    to authenticated
    using (app_is_admin());
