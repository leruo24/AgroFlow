-- Row Level Security on the four core tables, in a migration at last (audit fixes, Part D).
--
-- 0011 says RLS on farm, zone, farm_member and profile was "already live": it was set up in the
-- Supabase dashboard and never written down in a migration. A database built from the migrations
-- (the kit simulation, a new Supabase project, a restore into an empty project) therefore had RLS
-- OFF on farm, zone and farm_member, and profile had RLS on with no policy. SecurityDbTests found
-- this on a full replay. On such a database, with Supabase's default grants, any signed-in farmer
-- could read every farm and zone through the client API.
--
-- What this does, and why it is safe on the live database:
--   1. Turns RLS on for the four tables. Already on: nothing changes.
--   2. Adds read policies ONLY to a table that has no policy at all. The live tables already have
--      their dashboard policies, so nothing is added or replaced there; a rebuilt database gets the
--      same rule the rest of the schema uses (0011): the farm's owner or a member, or staff.
--   3. Grants SELECT to authenticated on the four tables, which the apps' reads need (the admin
--      site's farm and zone lists, the app's own profile, the alert history's zone names). RLS
--      decides which rows. No insert, update or delete is granted: those go through AgroFlow.Api.
--   anon gets nothing.
-- ENABLE, never FORCE: the API connects as the table owner and keeps its own access checks.
-- Safe to run more than once.

alter table farm enable row level security;
alter table zone enable row level security;
alter table farm_member enable row level security;
alter table profile enable row level security;

do $guard$
begin
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'farm') then
        create policy farm_select_member_or_staff on farm for select to authenticated
            using (app_is_admin() or app_can_access_farm(farm_id));
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'zone') then
        create policy zone_select_member_or_staff on zone for select to authenticated
            using (app_is_admin() or app_can_access_farm(farm_id));
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'farm_member') then
        create policy farm_member_select_own_or_staff on farm_member for select to authenticated
            using (app_is_admin() or profile_id = auth.uid());
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'profile') then
        create policy profile_select_own_or_staff on profile for select to authenticated
            using (app_is_admin() or id = auth.uid());
    end if;
end $guard$;

grant select on farm, zone, farm_member, profile to authenticated;
revoke all on farm, zone, farm_member, profile from anon;

comment on table farm_member is
    'Which profiles can use which farms. RLS: a farmer sees their own rows, staff see all (0059 writes down what 0011 assumed was live).';
