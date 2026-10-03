-- Archiving a farm: hide it without deleting anything.
--
-- WHY ARCHIVE AND NOT DELETE
-- --------------------------
-- The live database carries demo and test farms from a term of development,
-- mixed in with the real ones. They have to stop appearing in lists, reports
-- and automatic reports before the deployment - but deleting them would take
-- their zones, their sensor_reading history, their irrigation_event rows and
-- their alerts with them (every FK here is `on delete cascade`). That history
-- is the evidence the system worked, which is exactly what is wanted for the
-- demonstration and the report.
--
-- So: a status flag, and nothing is ever removed.
--
-- WHAT THIS DOES NOT DO: it archives nothing. The brief asked for the ability
-- and for the SQL to decide WHICH farms are test data - that is a judgement
-- about real customers and it belongs to a person. The queries are in
-- docs/finish-features-report.md.
--
-- Idempotent: safe to re-run.

-- ---------------------------------------------------------------------------
-- 1. zone.status
--
-- farm.status has existed since 0001 ('Active' by default, no constraint).
-- zone has never had one, so "archive the farm and its zones" had nowhere to
-- record the second half. Same column name, same default, same lack of a
-- CHECK - deliberately mirroring farm rather than inventing a second
-- vocabulary for the same idea.
-- ---------------------------------------------------------------------------
alter table zone
    add column if not exists status text not null default 'Active';

comment on column zone.status is
    'Active or Inactive. Mirrors farm.status. Archiving a farm sets both. Compared case-insensitively everywhere - see the casing note below.';

-- Supports the "hide archived" filter on the zone lists, which is now on
-- every farmer-facing query. Partial, because the overwhelming majority of
-- rows are active and only the exceptions need finding.
create index if not exists idx_zone_inactive
    on zone (farm_id)
    where lower(status) = 'inactive';

create index if not exists idx_farm_inactive
    on farm (farm_id)
    where lower(status) = 'inactive';

-- ---------------------------------------------------------------------------
-- 2. THE CASING MISMATCH - reported, not rewritten.
--
-- farm.status defaults to 'Active' with a capital A and has no CHECK
-- constraint, so nothing has ever stopped a lowercase 'active' being written.
-- Rows in the live database may well hold either.
--
-- This migration deliberately does NOT normalise them. A blanket
-- `update farm set status = initcap(status)` would touch every row in a live
-- table to fix a problem that costs nothing once the readers are
-- case-insensitive, and it would silently rewrite any status value nobody
-- here anticipated.
--
-- Instead every new filter compares with lower(), and the archive action
-- below writes 'Inactive'/'Active' to match the existing default's casing.
-- Both spellings therefore keep working, for ever, without a data migration.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 3. Archive and restore, as functions.
--
-- A function rather than two UPDATEs in C# because the farm and its zones
-- have to move together: a farm archived while its zones stayed active would
-- still feed the auto-report scheduler's zone lookup, and a half-archived
-- farm is harder to spot than an un-archived one.
--
-- SECURITY INVOKER (the default) on purpose: these run as the caller, so RLS
-- still applies and only an admin's JWT can reach the rows. AgroFlow.Api
-- connects as the table owner and bypasses that, which is how the admin
-- endpoint calls them.
-- ---------------------------------------------------------------------------
create or replace function archive_farm(p_farm_id bigint)
returns void
language sql
as 'update farm set status = ''Inactive'', updated_at = now() where farm_id = p_farm_id;
    update zone set status = ''Inactive'', updated_at = now() where farm_id = p_farm_id;';

create or replace function restore_farm(p_farm_id bigint)
returns void
language sql
as 'update farm set status = ''Active'', updated_at = now() where farm_id = p_farm_id;
    update zone set status = ''Active'', updated_at = now() where farm_id = p_farm_id;';

comment on function archive_farm(bigint) is
    'Hides a farm and its zones from default lists, reports and automatic reports. Deletes nothing - every reading, event and alert is kept. Reversible with restore_farm().';

-- Written with single-quoted bodies rather than $$ ... $$, because this
-- project''s migrations are pasted into the Supabase SQL editor and dollar
-- quoting is the thing that most often breaks that paste. The doubled quotes
-- above are the cost of that choice.
