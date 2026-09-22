-- Telegram onboarding and notifications: replaces the Resend welcome email.
--
-- WHY A CODE TABLE AND NOT A DIRECT MESSAGE
-- A Telegram bot cannot open a conversation with anyone - the person has to
-- message the bot first. So onboarding cannot push anything at a farmer who
-- has never met the bot. Instead the admin, who is already on-site installing
-- hardware, shows a QR code for
--     https://t.me/<BotUsername>?start=<code>
-- and the farmer scans it. Telegram delivers "/start <code>" to the bot,
-- which is the first moment a chat_id for that person exists. The bot looks
-- the code up here, stamps used_at, writes profile.telegram_chat_id, and only
-- then sends the login details and the app download link.
--
-- Single-use and expiring because the message that code unlocks contains the
-- farmer's temporary password. A code left live on a screenshot or a printed
-- sheet would otherwise hand that password to whoever scans it first.
--
-- RLS follows 0011: ENABLE (never FORCE - AgroFlow.Api connects as the
-- table-owning `postgres` role and must keep bypassing), and deliberately
-- ZERO policies plus an explicit revoke on this table, because no client of
-- any kind has business reading or writing onboarding codes. Every legitimate
-- path goes through AgroFlow.Api: the admin generates a code over an
-- admin-only endpoint, the bot redeems one from inside the API process.
--
-- Idempotent throughout - safe to re-run.

-- ---------------------------------------------------------------------------
-- 1. profile: where a linked farmer's chat lives, plus the two per-farmer
--    switches this feature needs.
-- ---------------------------------------------------------------------------
-- telegram_chat_id is nullable and stays null forever for a farmer who never
-- links - nothing in onboarding, irrigation or alerting may depend on it
-- being set. bigint because Telegram chat ids exceed int32.
alter table profile
    add column if not exists telegram_chat_id bigint;

-- Per-farmer on/off for alert messages (critical moisture, irrigation
-- start/stop, device offline). Onboarding and request-status messages are not
-- gated by this - a farmer who opted out of sensor chatter still needs to be
-- told a technician is on the way. Default true: a farmer who went to the
-- trouble of linking the bot wants the alerts.
alter table profile
    add column if not exists telegram_alerts_enabled boolean not null default true;

-- The temporary password is delivered over Telegram and then sits in that
-- chat's history indefinitely, where anyone holding the farmer's unlocked
-- phone can scroll back to it. Forcing a change on first login bounds how
-- long that matters.
alter table profile
    add column if not exists must_change_password boolean not null default false;

-- One Telegram account links to at most one farmer. Partial, so the many
-- unlinked profiles (all null) don't collide with each other.
create unique index if not exists idx_profile_telegram_chat_id
    on profile (telegram_chat_id)
    where telegram_chat_id is not null;

-- 0011 revoked the broad table-level UPDATE and re-granted only the columns a
-- farmer may edit; 0012 added phone to that list. Restated here so the three
-- columns above are provably NOT farmer-writable: a farmer must not be able
-- to point their chat id at someone else's profile, silence their own
-- must_change_password flag, or claim another farmer's linked chat. The
-- alerts toggle is written by AgroFlow.Api on the farmer's behalf (it runs as
-- the table owner), not by the client directly.
revoke update on profile from authenticated;
grant update (name, phone) on profile to authenticated;

-- ---------------------------------------------------------------------------
-- 2. telegram_onboarding_code: short-lived single-use link codes.
-- ---------------------------------------------------------------------------
-- code is the primary key and is what travels in the deep link, so it is
-- generated from a CSPRNG in AgroFlow.Api (TelegramOnboardingCodes), not here.
-- Telegram truncates the ?start= payload at 64 characters and permits only
-- [A-Za-z0-9_-], which the generator respects.
create table if not exists telegram_onboarding_code (
    code        text primary key,
    profile_id  uuid not null references profile (id) on delete cascade,
    expires_at  timestamptz not null,
    used_at     timestamptz,
    created_at  timestamptz not null default now()
);

-- "the newest live code for this farmer" - what the admin screen and the
-- mobile Connect Telegram flow both re-read after generating.
create index if not exists idx_telegram_onboarding_code_profile
    on telegram_onboarding_code (profile_id, created_at desc);

-- Redemption and the expiry sweep both only ever look at unused codes.
create index if not exists idx_telegram_onboarding_code_live
    on telegram_onboarding_code (expires_at)
    where used_at is null;

alter table telegram_onboarding_code enable row level security;

-- No policies are created on purpose. Under ENABLE with zero policies every
-- non-owner role sees zero rows and can write none, which is exactly the
-- intent; the revoke makes that explicit rather than implicit, so a later
-- migration that adds a policy still has to add a grant deliberately.
revoke all on telegram_onboarding_code from anon, authenticated;
