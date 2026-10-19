-- Repairs three places where the live database drifted from migrations it had run
-- (found with docs/ops/verify-migrations.sql on 2026-10-14). Each step does what
-- the original migration meant to do and is a no-op on a database where it already
-- took effect, so this is safe to run on a fresh database too. No data is deleted.
--
--   a) 0007 dropped auto_irrigation_check(), but it survived on live. A trigger
--      still calling it would make Postgres decide to water a zone as well as the API.
--   b) 0010 added 'manual' to irrigation_mode inside `add column if not exists`,
--      which is skipped whole when the column already exists, so live kept the
--      older ('automatic','scheduled') check. The app and 0048 write 'manual'.
--   c) 0013's handle_new_auth_user() copies the farmer's phone into profile.phone;
--      live still has the older body without it.

begin;

-- a) Drop every trigger that calls auto_irrigation_check(), whatever its name,
--    then the function itself.
do $$
declare
    t record;
begin
    for t in
        select tg.tgname, tg.tgrelid::regclass as tbl
          from pg_trigger tg
          join pg_proc p on p.oid = tg.tgfoid
         where p.proname = 'auto_irrigation_check'
           and p.pronamespace = 'public'::regnamespace
           and not tg.tgisinternal
    loop
        execute format('drop trigger if exists %I on %s', t.tgname, t.tbl);
    end loop;
end $$;

drop function if exists public.auto_irrigation_check();

-- b) Stop, changing nothing, if a zone holds a value the new check would reject.
do $$
begin
    if exists (select 1 from zone
                where irrigation_mode not in ('automatic', 'scheduled', 'manual')) then
        raise exception 'zone.irrigation_mode has values outside automatic/scheduled/manual; fix those rows first';
    end if;
end $$;

alter table zone drop constraint if exists zone_irrigation_mode_check;
alter table zone
    add constraint zone_irrigation_mode_check
        check (irrigation_mode in ('automatic', 'scheduled', 'manual'));

-- c) 0013's definition, unchanged.
create or replace function handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_farm_id bigint;
begin
    insert into profile (
        id,
        email,
        name,
        phone,
        role
    )
    values (
        new.id,
        new.email,
        coalesce(new.raw_user_meta_data ->> 'name', ''),
        nullif(new.raw_user_meta_data ->> 'phone', ''),
        'farm_user'
    )
    on conflict (id) do nothing;

    v_farm_id :=
        (new.raw_user_meta_data ->> 'invitedFarmId')::bigint;

    if v_farm_id is not null then
        insert into farm_member (
            farm_id,
            profile_id
        )
        values (
            v_farm_id,
            new.id
        )
        on conflict do nothing;
    end if;

    return new;
end;
$$;

commit;
