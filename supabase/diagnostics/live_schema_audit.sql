-- AgroFlow live-schema audit (read-only).
-- Run the whole file in the Supabase SQL Editor and share the result grids.
-- It reads metadata and row counts only; it changes no database objects.

-- 1. PostgreSQL version, current execution identity and installed extensions.
select version() as postgres_version,
       current_database() as database_name,
       current_user as current_user,
       session_user as session_user;

select e.extname as extension_name, e.extversion as version
from pg_extension e
order by e.extname;

-- 2. Public tables, owners, RLS state and approximate row counts.
select c.relname as table_name,
       pg_get_userbyid(c.relowner) as owner,
       c.relrowsecurity as rls_enabled,
       c.relforcerowsecurity as rls_forced,
       c.reltuples::bigint as approximate_rows
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind in ('r', 'p')
order by c.relname;

-- 3. Every public table/view column, including type, nullability and default.
select c.table_name,
       c.ordinal_position,
       c.column_name,
       c.data_type,
       c.udt_name,
       c.is_nullable,
       c.column_default
from information_schema.columns c
where c.table_schema = 'public'
order by c.table_name, c.ordinal_position;

-- 4. Primary keys, unique constraints, foreign keys and check constraints.
select conrelid::regclass::text as table_name,
       conname as constraint_name,
       case contype
         when 'p' then 'PRIMARY KEY'
         when 'u' then 'UNIQUE'
         when 'f' then 'FOREIGN KEY'
         when 'c' then 'CHECK'
         when 'x' then 'EXCLUSION'
         else contype::text
       end as constraint_type,
       pg_get_constraintdef(oid, true) as definition
from pg_constraint
where connamespace = 'public'::regnamespace
order by conrelid::regclass::text, constraint_type, conname;

-- 5. RLS policies, including roles and permissive/restrictive mode.
select schemaname,
       tablename,
       policyname,
       permissive,
       roles,
       cmd,
       qual,
       with_check
from pg_policies
where schemaname = 'public'
order by tablename, cmd, policyname;

-- 6. Effective table privileges for client-facing Supabase roles.
select grantee,
       table_name,
       string_agg(privilege_type, ', ' order by privilege_type) as privileges
from information_schema.role_table_grants
where table_schema = 'public'
  and grantee in ('anon', 'authenticated', 'service_role')
group by grantee, table_name
order by table_name, grantee;

-- 7. Column-level privileges, especially the profile role guard.
select grantee,
       table_name,
       column_name,
       string_agg(privilege_type, ', ' order by privilege_type) as privileges
from information_schema.column_privileges
where table_schema = 'public'
  and grantee in ('anon', 'authenticated', 'service_role')
group by grantee, table_name, column_name
order by table_name, grantee, column_name;

-- 8. Views and whether they invoke underlying objects as caller or owner.
select c.relname as view_name,
       coalesce(array_to_string(c.reloptions, ', '), '') as view_options,
       pg_get_viewdef(c.oid, true) as definition
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relkind in ('v', 'm')
order by c.relname;

-- 9. Non-internal triggers and their definitions.
select event_object_table as table_name,
       trigger_name,
       action_timing,
       string_agg(event_manipulation, ', ' order by event_manipulation) as events,
       action_statement
from information_schema.triggers
where trigger_schema = 'public'
group by event_object_table, trigger_name, action_timing, action_statement
order by event_object_table, trigger_name;

-- 10. Public indexes and their exact definitions.
select tablename as table_name, indexname as index_name, indexdef as definition
from pg_indexes
where schemaname = 'public'
order by tablename, indexname;

-- 11. Public functions, security mode and definitions. This may be a long grid.
select p.proname as function_name,
       pg_get_function_identity_arguments(p.oid) as arguments,
       pg_get_function_result(p.oid) as result_type,
       l.lanname as language,
       p.prosecdef as security_definer,
       p.provolatile as volatility,
       pg_get_functiondef(p.oid) as definition
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
join pg_language l on l.oid = p.prolang
where n.nspname = 'public'
order by p.proname, arguments;

-- 12. Scheduled jobs, if pg_cron is installed and visible to this user.
do $$
begin
  if to_regclass('cron.job') is null then
    raise notice 'cron.job is unavailable (pg_cron absent or not visible).';
  else
    raise notice 'Run separately: select jobid, jobname, schedule, command, active from cron.job order by jobid;';
  end if;
end $$;

-- 13. Targeted investigation of the two historically unresolved tables.
select table_name,
       case when table_name in ('profiles', 'irrigation_schedule')
            then 'present'
            else 'not applicable'
       end as finding
from information_schema.tables
where table_schema = 'public'
  and table_name in ('profiles', 'irrigation_schedule')
order by table_name;

-- 14. Exact row counts for AgroFlow tables only. No row data is returned.
-- Add/remove names here if section 2 reveals unexpected tables.
select 'profile' as table_name, count(*) as row_count from public.profile
union all select 'farm', count(*) from public.farm
union all select 'farm_member', count(*) from public.farm_member
union all select 'zone', count(*) from public.zone
union all select 'hardware', count(*) from public.hardware
union all select 'sensor_reading', count(*) from public.sensor_reading
union all select 'irrigation_commands', count(*) from public.irrigation_commands
union all select 'irrigation_event', count(*) from public.irrigation_event
union all select 'alert', count(*) from public.alert
union all select 'weather', count(*) from public.weather
union all select 'maintenance', count(*) from public.maintenance
union all select 'report', count(*) from public.report
union all select 'ai_recommendation', count(*) from public.ai_recommendation
order by table_name;
