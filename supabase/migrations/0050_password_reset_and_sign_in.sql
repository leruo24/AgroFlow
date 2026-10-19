-- Signing in and resetting a password without email (docs/password-reset.md):
--   1. profile.temp_password_expires_at: a temporary password stops working 72 hours after it
--      is issued (the API replaces it with an unknown one once the time is up).
--   2. password_reset_code: the 6-digit code the Telegram bot sends for "Forgot password?",
--      stored as a salted hash only, 10 minutes, single use, 5 tries.
--   3. sign_in_link: the single-use "Sign in to AgroFlow" button in the welcome message,
--      stored as a hash only, 24 hours.
-- Written and read by the API only. RLS is on with no policies and every client grant is
-- revoked, so the app and the admin site can never read a code or a token.
-- Safe to run more than once.

alter table profile
    add column if not exists temp_password_expires_at timestamptz;

comment on column profile.temp_password_expires_at is
    'When the current temporary password stops working. Null once the farmer has set their own.';

create table if not exists password_reset_code (
    id           bigint generated always as identity primary key,
    profile_id   uuid not null references profile (id) on delete cascade,
    code_hash    text not null,
    salt         text not null,
    created_at   timestamptz not null default now(),
    expires_at   timestamptz not null,
    attempts     integer not null default 0 check (attempts >= 0),
    used_at      timestamptz
);

create index if not exists idx_password_reset_code_profile_created
    on password_reset_code (profile_id, created_at desc);

create table if not exists sign_in_link (
    id           bigint generated always as identity primary key,
    profile_id   uuid not null references profile (id) on delete cascade,
    token_hash   text not null unique,
    created_at   timestamptz not null default now(),
    expires_at   timestamptz not null,
    used_at      timestamptz
);

create index if not exists idx_sign_in_link_profile on sign_in_link (profile_id);

alter table password_reset_code enable row level security;
alter table sign_in_link enable row level security;

revoke all on password_reset_code from anon, authenticated;
revoke all on sign_in_link from anon, authenticated;
