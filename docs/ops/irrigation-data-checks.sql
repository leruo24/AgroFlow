-- Irrigation Data: what is actually in the database (item 8).
--
-- READ-ONLY. Every statement here is a select. Nothing in this file writes,
-- so it is safe to run against the live database in the Supabase SQL editor.
-- Run them ONE AT A TIME - the editor returns the result of the last
-- statement only, so a whole-file run hides everything above it.
--
-- WHY THIS FILE EXISTS
-- The Irrigation Data page used to show every event against a farm called
-- "Unassigned", with litres read from irrigation_event.estimated_litres. Both
-- have been fixed in the console, but "the page looks wrong" and "the data is
-- wrong" are different problems with different fixes, and there was no way to
-- tell them apart. These are the queries that tell them apart.


-- ---------------------------------------------------------------------------
-- 1. Is there anything there at all?
-- ---------------------------------------------------------------------------
-- If this is 0, the page is empty because the table is empty - nothing in the
-- console can fix that. Seeded rows usually arrive in one burst, so first and
-- last being seconds apart is itself a useful signal.

select count(*)                as events,
       min(started_at)         as earliest,
       max(started_at)         as latest,
       count(distinct zone_id) as zones_involved
  from irrigation_event;


-- ---------------------------------------------------------------------------
-- 2. The rows, with the farm the console should be showing
-- ---------------------------------------------------------------------------
-- This is the join the page now does. If farm_name comes back here but the
-- page still shows no farm, the problem is in the console. If farm_name is
-- null HERE, the data is genuinely unattached and the page is right.

select e.id,
       e.started_at,
       e.runtime_seconds,
       z.id                  as zone_id,
       z.name                as zone_name,
       z.flow_rate_lpm,
       f.farm_id,
       f.name                as farm_name,
       f.status              as farm_status,

       -- The canonical estimate, from migration 0018. NOT estimated_litres:
       -- that column is whatever was written at the time and has drifted
       -- against flow_rate_lpm.
       case
         when z.flow_rate_lpm is null then null
         else round((e.runtime_seconds / 60.0) * z.flow_rate_lpm)
       end                   as litres_estimated,

       e.estimated_litres    as litres_stored
  from irrigation_event e
  left join zone z on z.id = e.zone_id
  left join farm f on f.farm_id = z.farm_id
 order by e.started_at desc
 limit 100;


-- ---------------------------------------------------------------------------
-- 3. Events whose zone has no flow rate
-- ---------------------------------------------------------------------------
-- These are the rows the page now reports as "No estimate" and leaves out of
-- the water totals. That is deliberate (0018: a zone whose rate nobody has
-- entered must not yield a confident number), but each one is a zone somebody
-- should set a rate on - so this is a work list, not a problem report.

select f.name            as farm_name,
       z.id              as zone_id,
       z.name            as zone_name,
       count(e.id)       as events_without_an_estimate,
       sum(e.runtime_seconds) / 60 as pump_minutes_unaccounted
  from zone z
  left join farm f on f.farm_id = z.farm_id
  join irrigation_event e on e.zone_id = z.id
 where z.flow_rate_lpm is null
 group by f.name, z.id, z.name
 order by events_without_an_estimate desc;


-- ---------------------------------------------------------------------------
-- 4. Events that are genuinely unattached
-- ---------------------------------------------------------------------------
-- irrigation_event.zone_id is NOT NULL with an FK, so the first case should
-- never happen; the second can, if a zone was created without a farm. Either
-- way these are the only rows the page can honestly label "No farm on record".

select e.id,
       e.zone_id,
       e.started_at,
       case
         when z.id is null      then 'zone row is missing'
         when z.farm_id is null then 'zone has no farm'
       end as why
  from irrigation_event e
  left join zone z on z.id = e.zone_id
 where z.id is null
    or z.farm_id is null
 order by e.started_at desc;


-- ---------------------------------------------------------------------------
-- 5. How much of it belongs to archived farms
-- ---------------------------------------------------------------------------
-- The page now hides these. Running this says how much of what disappeared
-- was retired test data - which is usually the answer when the totals drop
-- after an archive.
--
-- farm.status has never had a CHECK constraint and both 'Active' and 'active'
-- exist in the live data, so the comparison is lower()'d. Migration 0036
-- explains why the rows were not rewritten.

select coalesce(lower(f.status), 'no status') as farm_status,
       count(*)                               as events
  from irrigation_event e
  left join zone z on z.id = e.zone_id
  left join farm f on f.farm_id = z.farm_id
 group by coalesce(lower(f.status), 'no status')
 order by events desc;


-- ---------------------------------------------------------------------------
-- 6. Where the stored column disagrees with the formula
-- ---------------------------------------------------------------------------
-- Diagnostic, not a fix. A long tail here is the evidence for computing
-- litres rather than reading estimated_litres; it does not need correcting,
-- because nothing reads that column any more.

select e.id,
       z.name                                            as zone_name,
       e.runtime_seconds,
       z.flow_rate_lpm,
       e.estimated_litres                                as stored,
       round((e.runtime_seconds / 60.0) * z.flow_rate_lpm) as computed,
       round(abs(e.estimated_litres - (e.runtime_seconds / 60.0) * z.flow_rate_lpm)) as difference
  from irrigation_event e
  join zone z on z.id = e.zone_id
 where z.flow_rate_lpm is not null
   and abs(e.estimated_litres - (e.runtime_seconds / 60.0) * z.flow_rate_lpm) > 1
 order by difference desc
 limit 50;
