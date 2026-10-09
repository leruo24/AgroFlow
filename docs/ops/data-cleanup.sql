-- Data cleanup helpers (item 6).
--
-- NOTHING HERE HAS BEEN RUN. Sections 1, 3 and 4 are read-only and safe to
-- run as they are. Section 2 writes - read it before you run it.
--
-- Run these ONE AT A TIME in the Supabase SQL editor: it returns the result of
-- the last statement only, so running the file whole hides everything above.
--
-- A note on "archive" versus "delete" throughout. archive_farm() (migration
-- 0036) sets farm.status and zone.status to 'Inactive' and deletes NOTHING -
-- the farm disappears from lists, reports and the automatic report scheduler,
-- and every reading, event and alert it owns stays exactly where it is. Delete
-- cascades to all of them. For test data, archive is almost always what you
-- want, and it is reversible.


-- ===========================================================================
-- 1. Farms worth archiving  (READ-ONLY)
-- ===========================================================================
-- Four independent reasons to suspect a farm is test data, reported per farm
-- with the reasons spelled out rather than a bare score. A farm with one
-- reason is worth a look; a farm with three is almost certainly a leftover.
--
-- Nothing is archived by this. The last column gives you the statement.

select f.farm_id,
       f.name                                              as farm_name,
       coalesce(nullif(p.name, ''), p.email, 'no owner')   as owner,
       coalesce(f.status, 'Active')                        as current_status,

       (select count(*) from zone z where z.farm_id = f.farm_id)        as zones,

       (select max(sr.recorded_at)
          from sensor_reading sr
          join zone z on z.id = sr.zone_id
         where z.farm_id = f.farm_id)                                   as last_reading,

       -- The reasons, as text, so the answer explains itself.
       concat_ws(', ',
           case when not exists (select 1 from zone z where z.farm_id = f.farm_id)
                then 'no zones' end,

           case when not exists (
                    select 1 from sensor_reading sr
                      join zone z on z.id = sr.zone_id
                     where z.farm_id = f.farm_id
                       and sr.recorded_at > now() - interval '14 days')
                then 'no readings in 14 days' end,

           case when f.name ~* '(test|merge|verify|demo|dummy|sample|temp)'
                then 'test-sounding name' end,

           case when p.email ~* '(\.test$|\.local$|\.invalid$|\.example$|@example\.)'
                then 'test-domain owner' end
       )                                                                as why,

       -- Paste this to archive it. Reversible with restore_farm().
       format('select archive_farm(%s);  -- %s', f.farm_id, f.name)     as archive_statement

  from farm f
  left join profile p on p.id = f.owner_id

 where lower(coalesce(f.status, 'Active')) <> 'inactive'
   and (
        not exists (select 1 from zone z where z.farm_id = f.farm_id)
     or not exists (
            select 1 from sensor_reading sr
              join zone z on z.id = sr.zone_id
             where z.farm_id = f.farm_id
               and sr.recorded_at > now() - interval '14 days')
     or f.name ~* '(test|merge|verify|demo|dummy|sample|temp)'
     or p.email ~* '(\.test$|\.local$|\.invalid$|\.example$|@example\.)'
   )

 order by (
        (case when not exists (select 1 from zone z where z.farm_id = f.farm_id) then 1 else 0 end)
      + (case when f.name ~* '(test|merge|verify|demo|dummy|sample|temp)' then 1 else 0 end)
      + (case when p.email ~* '(\.test$|\.local$|\.invalid$|\.example$)' then 1 else 0 end)
   ) desc, f.name;


-- ===========================================================================
-- 2. Remove admin rights from two accounts  (WRITES)
-- ===========================================================================
-- Look before you leap: this shows what will change.

select id, name, email, role
  from profile
 where email in ('admin@gmail.com', 'merge-test@agroflow.local');

-- Then this. Single statement, as asked.
--
-- `and role = 'admin'` is not redundant: it makes the statement safe to re-run
-- and makes the row count meaningful - 0 rows updated means it was already
-- done, rather than leaving you wondering whether it worked.
--
-- BEFORE YOU RUN IT, make sure another admin account exists and you can sign
-- in as it. Demoting the account you are signed in as will lock you out of the
-- console, and the console is the only place that can promote somebody back.

update profile
   set role = 'farm_user'
 where email in ('admin@gmail.com', 'merge-test@agroflow.local')
   and role = 'admin';

-- Confirm, and check somebody is still an administrator.
select email, role from profile where role = 'admin' order by email;


-- ===========================================================================
-- 3. Seeded irrigation events  (READ-ONLY)
-- ===========================================================================
-- The 120 L-per-event rows. "120 L" is not stored anywhere - estimated_litres
-- is, and the flow rate that produced it - so these are found by their shape:
-- a round runtime, no device that could have run them, and several identical
-- rows arriving together.
--
-- Decide for yourself; nothing here deletes.

select e.id,
       e.zone_id,
       z.name                                      as zone_name,
       f.name                                      as farm_name,
       e.started_at,
       e.runtime_seconds,
       e.estimated_litres,
       z.flow_rate_lpm,

       -- What the row WOULD say under the canonical formula (0018). A wide
       -- gap between this and estimated_litres is itself a sign the row was
       -- written by hand rather than by a kit.
       case when z.flow_rate_lpm is null then null
            else round((e.runtime_seconds / 60.0) * z.flow_rate_lpm)
       end                                         as litres_by_formula,

       -- Could a kit have produced this at all?
       (select count(*) from hardware h
         where h.zone_id = z.id
           and h.enrollment_status = 'active')     as active_kits_on_zone,

       concat_ws(', ',
           case when e.estimated_litres = 120 then 'exactly 120 L' end,
           case when not exists (select 1 from hardware h
                                  where h.zone_id = z.id and h.enrollment_status = 'active')
                then 'no active kit on this zone' end,
           case when e.runtime_seconds % 60 = 0 then 'whole-minute runtime' end
       )                                           as why

  from irrigation_event e
  left join zone z on z.id = e.zone_id
  left join farm f on f.farm_id = z.farm_id

 where e.estimated_litres = 120
    or not exists (select 1 from hardware h
                    where h.zone_id = z.id and h.enrollment_status = 'active')

 order by e.started_at desc;

-- The same thing counted, which is the number to look at first.
select count(*)                                    as seeded_looking_events,
       min(started_at)                             as earliest,
       max(started_at)                             as latest,
       count(distinct zone_id)                     as zones_affected
  from irrigation_event e
  left join zone z on z.id = e.zone_id
 where e.estimated_litres = 120
    or not exists (select 1 from hardware h
                    where h.zone_id = z.id and h.enrollment_status = 'active');

-- If you decide to remove them, this is the statement - but read the count
-- above first, and prefer archiving the FARM if the events belong to a test
-- farm, because that keeps every row and is reversible.
--
-- delete from irrigation_event where estimated_litres = 120;


-- ===========================================================================
-- 4. Roles, and farmers with no farm  (READ-ONLY)
-- ===========================================================================
-- Every distinct role, with counts. Anything other than 'admin' and
-- 'farm_user' is a typo that will fail every policy check silently: RLS
-- compares the string, so 'Admin' or 'farmuser' simply matches nothing.

select coalesce(role, '(null)') as role, count(*) as accounts
  from profile
 group by coalesce(role, '(null)')
 order by accounts desc;

-- Accounts whose role is not one of the two valid values.
select id, name, email, role, created_at
  from profile
 where role is null
    or role not in ('admin', 'farm_user')
 order by created_at desc;

-- Farmers with no farm: they own none and are a member of none. They sign in
-- successfully and then see an empty app, which reads as a broken account
-- rather than an unfinished setup.
select p.id,
       coalesce(nullif(p.name, ''), '(no name)')   as name,
       p.email,
       p.created_at,
       p.telegram_chat_id is not null              as telegram_connected
  from profile p
 where p.role = 'farm_user'
   and not exists (select 1 from farm f where f.owner_id = p.id)
   and not exists (select 1 from farm_member fm where fm.profile_id = p.id)
 order by p.created_at desc;

-- And the reverse, which is rarer and worse: a farm whose owner no longer
-- exists. Its data is live and nobody can see it.
select f.farm_id, f.name, f.owner_id, coalesce(f.status, 'Active') as status
  from farm f
 where f.owner_id is null
    or not exists (select 1 from profile p where p.id = f.owner_id)
 order by f.name;
