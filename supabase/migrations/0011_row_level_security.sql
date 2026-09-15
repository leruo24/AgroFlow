-- Row Level Security: extends the farm_member ownership pattern already
-- live on farm/zone/farm_member/profile to the ten tables that currently
-- have RLS off and zero policies, locks down irrigation_commands (an anon
-- INSERT there fires trg_irrigation_commands_notify -> pg_notify -> MQTT ->
-- a physical valve, see 0009_mqtt_and_device_identity.sql), sets
-- security_invoker on the two zone_* views so they can't bypass the new
-- policies, closes the profile.role self-escalation hole, and consolidates
-- pre-existing duplicate policies.
--
-- ENABLE, never FORCE: AgroFlow.Api connects as the `postgres` role via the
-- Supabase pooler (ConnectionStrings:Supabase, now a .NET user-secret - see
-- backend/AgroFlow.Api/README.md) and owns every table in this schema.
-- Table owners bypass RLS automatically under ENABLE; FORCE would also gate
-- the owner and break every device-ingestion / auto-irrigation /
-- LISTEN-NOTIFY / admin write path in AgroFlow.Api. None of that is touched
-- here.
--
-- Deliberately NOT in this migration (see the bottom-of-file note):
--   - irrigation_schedule: empty, possibly dead (0010 meant to drop it) -
--     pending confirmation of what still references it.
--   - the `profiles` (plural) table: not created by any migration here,
--     1 live row, unexplained - pending investigation, not to be dropped
--     or altered blind.
--   - irrigation_commands INSERT for farm_users: no code writes there yet;
--     Phase 6 adds it alongside the real manual-irrigation feature.
--
-- Idempotent throughout - safe to re-run.

-- ---------------------------------------------------------------------------
-- 0. Helper functions. SECURITY DEFINER so they don't recurse into the RLS
--    they're evaluated inside (and so admin policies elsewhere don't pay
--    for a second layer of the same row-ownership check); STABLE since
--    they only read within one statement; search_path pinned per
--    Postgres's standard SECURITY DEFINER advice.
-- ---------------------------------------------------------------------------
create or replace function app_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists (
        select 1 from profile
         where id = auth.uid() and role = 'admin'
    );
$$;

create or replace function app_can_access_farm(p_farm_id bigint)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists (
        select 1 from farm_member
         where farm_id = p_farm_id and profile_id = auth.uid()
    )
    or exists (
        select 1 from farm
         where farm_id = p_farm_id and owner_id = auth.uid()
    );
$$;

-- Supporting indexes for the two functions above. sensor_reading is the
-- highest-volume table and every row's policy check walks
-- zone.farm_id -> app_can_access_farm -> farm_member.profile_id - that
-- second hop has no index today: farm_member's primary key is
-- (farm_id, profile_id), so profile_id alone (a leaf, not the leading
-- column) can't use it. IF NOT EXISTS makes the zone/hardware lines no-ops
-- if 0001/0008 already created them - included so this file is a complete,
-- self-contained record of what the ownership path needs.
create index if not exists idx_farm_member_profile_id on farm_member (profile_id);
create index if not exists idx_zone_farm_id on zone (farm_id);
create index if not exists idx_hardware_zone_id on hardware (zone_id);

-- ---------------------------------------------------------------------------
-- 1. Enable RLS on nine of the ten currently-unprotected tables (ENABLE,
--    not FORCE - see the file header; irrigation_schedule excluded, see
--    the bottom-of-file note). Idempotent by nature.
--
--    Table-level grants, right after: RLS restricts which ROWS a role can
--    see/touch, but the role also needs table-level privilege to attempt
--    the operation at all - policies alone are not enough. Do not assume
--    Supabase's default privileges already cover these tables for
--    `authenticated` (on this project they did not - discovered by hand
--    after the first run of this file left all nine unreachable despite
--    correct policies). Granted explicitly so a fresh database, or one
--    where the defaults were never applied, ends up reachable instead of
--    silently walled off. GRANT is idempotent - safe to re-run.
-- ---------------------------------------------------------------------------
alter table sensor_reading      enable row level security;
alter table irrigation_event    enable row level security;
alter table irrigation_commands enable row level security;
alter table alert               enable row level security;
alter table hardware            enable row level security;
alter table weather             enable row level security;
alter table report              enable row level security;
alter table maintenance         enable row level security;
alter table ai_recommendation   enable row level security;

grant select on sensor_reading      to authenticated;
grant select on irrigation_event    to authenticated;
grant select on irrigation_commands to authenticated;
grant select, update on alert       to authenticated;
grant select on hardware            to authenticated;
grant select on weather             to authenticated;
grant select on report              to authenticated;
grant select on maintenance         to authenticated;
grant select on ai_recommendation   to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Policies, matching the existing farm_member-based style (SELECT via
--    app_can_access_farm, plus a blanket admin policy). Wrapped in
--    exception-handled blocks so re-running this migration is a no-op
--    instead of an error on the second run.
-- ---------------------------------------------------------------------------
do $$
begin
    -- sensor_reading / irrigation_event: read-only for farm_users. Every
    -- write path (MQTT subscriber, HTTP fallback, pg_cron) runs as
    -- `postgres` and bypasses RLS - see the file header.
    begin
        create policy sensor_reading_select_member on sensor_reading
            for select to authenticated
            using (exists (
                select 1 from zone z
                 where z.id = sensor_reading.zone_id and app_can_access_farm(z.farm_id)
            ));
    exception when duplicate_object then null; end;

    begin
        create policy sensor_reading_all_admin on sensor_reading
            for all to authenticated
            using (app_is_admin()) with check (app_is_admin());
    exception when duplicate_object then null; end;

    begin
        create policy irrigation_event_select_member on irrigation_event
            for select to authenticated
            using (exists (
                select 1 from zone z
                 where z.id = irrigation_event.zone_id and app_can_access_farm(z.farm_id)
            ));
    exception when duplicate_object then null; end;

    begin
        create policy irrigation_event_all_admin on irrigation_event
            for all to authenticated
            using (app_is_admin()) with check (app_is_admin());
    exception when duplicate_object then null; end;

    -- irrigation_commands: THE PRIORITY. SELECT only for farm_users -
    -- deliberately NO farm_user INSERT policy yet (see file header). The
    -- admin policy is included for completeness/tooling but every real
    -- write path today (app's future manual insert, AgroFlow.Api's
    -- auto-irrigation, pg_cron schedule firing) is either not built yet or
    -- runs as `postgres`.
    begin
        create policy irrigation_commands_select_member on irrigation_commands
            for select to authenticated
            using (exists (
                select 1 from zone z
                 where z.id = irrigation_commands.zone_id and app_can_access_farm(z.farm_id)
            ));
    exception when duplicate_object then null; end;

    begin
        create policy irrigation_commands_all_admin on irrigation_commands
            for all to authenticated
            using (app_is_admin()) with check (app_is_admin());
    exception when duplicate_object then null; end;

    -- alert: farm_users can also acknowledge/resolve (UPDATE), matching
    -- the zone-settings UPDATE already live on zone.
    begin
        create policy alert_select_member on alert
            for select to authenticated
            using (exists (
                select 1 from zone z
                 where z.id = alert.zone_id and app_can_access_farm(z.farm_id)
            ));
    exception when duplicate_object then null; end;

    begin
        create policy alert_update_member on alert
            for update to authenticated
            using (exists (
                select 1 from zone z
                 where z.id = alert.zone_id and app_can_access_farm(z.farm_id)
            ))
            with check (exists (
                select 1 from zone z
                 where z.id = alert.zone_id and app_can_access_farm(z.farm_id)
            ));
    exception when duplicate_object then null; end;

    begin
        create policy alert_all_admin on alert
            for all to authenticated
            using (app_is_admin()) with check (app_is_admin());
    exception when duplicate_object then null; end;

    -- hardware: read-only for farm_users, via zone_id. zone_id is nullable
    -- (0008_device_enrollment_and_onboarding.sql) - an unassigned/
    -- not-yet-enrolled device is admin-only, which is the right default.
    begin
        create policy hardware_select_member on hardware
            for select to authenticated
            using (
                zone_id is not null
                and exists (select 1 from zone z where z.id = hardware.zone_id and app_can_access_farm(z.farm_id))
            );
    exception when duplicate_object then null; end;

    begin
        create policy hardware_all_admin on hardware
            for all to authenticated
            using (app_is_admin()) with check (app_is_admin());
    exception when duplicate_object then null; end;

    -- weather / report / maintenance: farm_id-scoped, read-only for
    -- farm_users. All three FKs are nullable (0003_csharp_domain.sql,
    -- on delete set null) - a null farm_id row is admin-only.
    begin
        create policy weather_select_member on weather
            for select to authenticated
            using (farm_id is not null and app_can_access_farm(farm_id));
    exception when duplicate_object then null; end;

    begin
        create policy weather_all_admin on weather
            for all to authenticated
            using (app_is_admin()) with check (app_is_admin());
    exception when duplicate_object then null; end;

    begin
        create policy report_select_member on report
            for select to authenticated
            using (farm_id is not null and app_can_access_farm(farm_id));
    exception when duplicate_object then null; end;

    begin
        create policy report_all_admin on report
            for all to authenticated
            using (app_is_admin()) with check (app_is_admin());
    exception when duplicate_object then null; end;

    begin
        create policy maintenance_select_member on maintenance
            for select to authenticated
            using (farm_id is not null and app_can_access_farm(farm_id));
    exception when duplicate_object then null; end;

    begin
        create policy maintenance_all_admin on maintenance
            for all to authenticated
            using (app_is_admin()) with check (app_is_admin());
    exception when duplicate_object then null; end;

    -- ai_recommendation: zone-scoped, read-only for farm_users.
    begin
        create policy ai_recommendation_select_member on ai_recommendation
            for select to authenticated
            using (
                zone_id is not null
                and exists (select 1 from zone z where z.id = ai_recommendation.zone_id and app_can_access_farm(z.farm_id))
            );
    exception when duplicate_object then null; end;

    begin
        create policy ai_recommendation_all_admin on ai_recommendation
            for all to authenticated
            using (app_is_admin()) with check (app_is_admin());
    exception when duplicate_object then null; end;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Views: security_invoker so they run with the CALLER's RLS instead of
--    the view owner's (postgres) rights - otherwise anything querying
--    these views would see every farm's data regardless of the policies
--    just added above. Guarded so this is a no-op if either view is
--    missing (per your note that the live schema may have moved on).
-- ---------------------------------------------------------------------------
do $$
begin
    if exists (select 1 from pg_views where schemaname = 'public' and viewname = 'zone_latest_reading') then
        execute 'alter view zone_latest_reading set (security_invoker = true)';
    end if;

    if exists (select 1 from pg_views where schemaname = 'public' and viewname = 'zone_daily_water_usage') then
        execute 'alter view zone_daily_water_usage set (security_invoker = true)';
    end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4. profile column guard: RLS is row-level only, so the existing
--    "update own row" policy on profile lets a farmer set role='admin' on
--    themselves - AdminOnlyFilter.cs (backend/AgroFlow.Api/Auth) trusts
--    that column directly. Column privileges are the right tool for a
--    column-level restriction; REVOKE/GRANT are idempotent.
-- ---------------------------------------------------------------------------
revoke update (id, email, role) on profile from authenticated;
-- profile.phone is added by 0012; grant name here so this migration also
-- succeeds on a database built strictly from 0001 onward.
grant update (name) on profile to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Consolidate duplicate policies. Generic by design instead of hardcoded
--    names (I have no live view of pg_policies from here): finds policies
--    on the SAME table, SAME command, with byte-identical qual/with_check
--    text, and drops every one except the single OLDEST (lowest oid = the
--    original, first-created policy) in each group - so the surviving
--    policy is whichever one was there first, behaviour is provably
--    unchanged (the duplicates were OR'd together and identical), and this
--    is safe to re-run (a table with no duplicates left does nothing).
--    Reports what it drops via RAISE NOTICE - read that in the SQL
--    editor's output after running this chunk.
-- ---------------------------------------------------------------------------
do $$
declare
    dup record;
begin
    for dup in
        select p.oid, p.polname, c.relname as tablename,
               row_number() over (
                   partition by p.polrelid, p.polcmd,
                                coalesce(pg_get_expr(p.polqual, p.polrelid), ''),
                                coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '')
                   order by p.oid
               ) as rn
          from pg_policy p
          join pg_class c on c.oid = p.polrelid
          join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public'
    loop
        if dup.rn > 1 then
            raise notice 'Dropping duplicate policy % on % (identical to an older policy on the same table+command, which survives)', dup.polname, dup.tablename;
            execute format('drop policy %I on %I', dup.polname, dup.tablename);
        end if;
    end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 6. zone: drop the two policies chunk 5's automatic text-match couldn't
--    catch. farmers_read_assigned_zones / farmers_update_assigned_zones
--    and zone_select_assigned_farm / zone_update_assigned_farm each
--    encode the same farm_member ownership check, worded differently -
--    chunk 5 only drops byte-identical qual/with_check text, so an
--    equivalent-but-differently-worded pair sails through it untouched.
--    EXPLAIN on zone confirmed both members of each pair are evaluated and
--    OR'd together on every query, doubling the farm_member subplan for
--    zero behavioural difference (basis for "equivalent" here: the
--    reported EXPLAIN showing the identical farm_member lookup appearing
--    twice, plus the names/roles below - not an independent read of the
--    raw qual text, which wasn't available in this session).
--
--    Keeping zone_select_assigned_farm / zone_update_assigned_farm - their
--    names match the <table>_<cmd>_<descriptor> convention every other
--    policy in this migration uses. Dropping the two farmers_*_zones ones.
--    IF EXISTS makes this a no-op once already dropped.
-- ---------------------------------------------------------------------------
drop policy if exists farmers_read_assigned_zones on zone;
drop policy if exists farmers_update_assigned_zones on zone;

-- ---------------------------------------------------------------------------
-- 7. Optional performance cleanup, unrelated to RLS: sensor_reading has
--    both idx_sensor_reading_zone_id (zone_id) and
--    idx_sensor_reading_zone_id_recorded_at (zone_id, recorded_at desc),
--    both from 0002_relationships.sql. The single-column index is
--    redundant - zone_id is the LEADING column of the composite index, so
--    any plan that could use idx_sensor_reading_zone_id (an equality or
--    range scan on zone_id alone) can use the composite index's zone_id
--    prefix exactly as well; this holds generally for a plain btree
--    index, not something that needed a live EXPLAIN to establish. Kept
--    as a separate, clearly-optional statement rather than folded into
--    the RLS work above - it's a housekeeping win, not a fix for
--    anything broken. IF EXISTS makes it a no-op if already dropped.
-- ---------------------------------------------------------------------------
drop index if exists idx_sensor_reading_zone_id;

-- ---------------------------------------------------------------------------
-- Open items NOT handled by this migration - see the chat response this
-- shipped with for the investigation queries and why:
--   - irrigation_schedule: RLS left off, table left in place, pending
--     confirmation nothing references it.
--   - the `profiles` (plural) table: left completely untouched pending
--     investigation of what it is and whether it's still needed.
-- ---------------------------------------------------------------------------
