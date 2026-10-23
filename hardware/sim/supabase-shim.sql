-- The few Supabase objects AgroFlow's migrations expect, for a plain local Postgres used by
-- the end-to-end simulation (run-e2e.mjs). NEVER run this on the real Supabase database:
-- there these already exist and are managed by Supabase.
--
--   auth.users      the table Supabase Auth owns (profile.id references it; 0008's trigger
--                   copies new users into profile)
--   auth.uid()      the signed-in user's id inside RLS policies, read from the request's JWT
--                   claims the way Supabase does (null when there are none, as for the API)
--   anon, authenticated, service_role   the roles the policies and grants name
--   cron.schedule() pg_cron's scheduler, which the local Postgres does not have; a no-op

create schema if not exists auth;

create table if not exists auth.users (
    id                  uuid primary key default gen_random_uuid(),
    email               text,
    phone               text,
    raw_user_meta_data  jsonb not null default '{}'::jsonb,
    created_at          timestamptz not null default now()
);

create or replace function auth.uid() returns uuid
language sql stable as $$
    select nullif(coalesce(current_setting('request.jwt.claim.sub', true),
                           (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')), '')::uuid
$$;

do $$
begin
    if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
    if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
    if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin; end if;
end
$$;

create schema if not exists cron;

create or replace function cron.schedule(job_name text, schedule text, command text) returns bigint
language sql as $$ select 0::bigint $$;

create or replace function cron.unschedule(job_name text) returns boolean
language sql as $$ select true $$;

-- 0045+ read storage.buckets in a probe only; the API's SchemaCheck reports it missing.
