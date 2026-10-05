-- Let the API actually write the audit rows.
--
-- WHY
-- ---
-- Migration 0037 created admin_audit_log, granted SELECT to `authenticated`,
-- revoked INSERT/UPDATE/DELETE from it, and granted INSERT to nobody at all.
-- That was deliberate: no client holding an admin JWT should be able to forge
-- a row through PostgREST, and the API was expected to insert as the table's
-- owner, which bypasses both RLS and the grants.
--
-- "The API is the owner" is an assumption about the connection string, not a
-- fact about the schema. It holds when ConnectionStrings:Supabase uses the
-- `postgres` role. It does not hold for a role created later, for the pooler
-- user on some Supabase projects, or for anyone who tightened that connection
-- string for good reasons.
--
-- When it does not hold, the failure is silent in the worst way: every admin
-- action still succeeds, the API logs an error nobody is reading, and the
-- Activity page simply stays empty. That is indistinguishable from "the
-- feature was never deployed", which is the other thing that can cause it.
--
-- So the grant is made explicit here rather than assumed. `service_role` is
-- Supabase's own privileged server-side role and already bypasses RLS; naming
-- it costs nothing if the API connects as the owner anyway, and fixes the
-- problem outright if it does not.
--
-- WHAT THIS DOES NOT DO
-- It does not grant INSERT to `authenticated` or `anon`. A farmer's token and
-- an admin's token both carry `authenticated`, and neither may write to this
-- table under any circumstances - that is what makes the log worth having.
-- 0037's revoke stands.
--
-- It does not grant UPDATE or DELETE to anybody, including service_role. The
-- table stays append-only.
--
-- Run this in the Supabase SQL editor. Idempotent - safe to re-run.

grant insert on admin_audit_log to service_role;

-- NO SEQUENCE GRANT IS NEEDED, and that is worth stating rather than leaving
-- somebody to wonder. `id` is `generated always as identity`, not `serial`.
-- Postgres owns an identity column's sequence internally and checks no
-- separate privilege on it, so INSERT on the table is sufficient. A `serial`
-- column would have needed `grant usage on sequence ...` as well, and the
-- failure would have read "permission denied for sequence", which looks like
-- an entirely different problem.

-- Reading stays admin-only. Restated rather than assumed, because this file
-- may be applied on its own if 0037 was already run.
grant select on admin_audit_log to service_role;

-- And the belt-and-braces half: nothing below changes behaviour when the API
-- is the owner, and all of it is needed when it is not.
revoke insert, update, delete on admin_audit_log from authenticated;
revoke all on admin_audit_log from anon;
revoke update, delete on admin_audit_log from service_role;

comment on table admin_audit_log is
    'Append-only record of administrator actions. INSERT is granted to the API only (owner or service_role); admins may read; nobody may update or delete. See migrations 0037 and 0038.';

-- ---------------------------------------------------------------------------
-- How to check this worked, as the role the API actually uses:
--
--   select current_user,
--          has_table_privilege(current_user, 'public.admin_audit_log', 'INSERT');
--
-- GET /api/admin/health reports the same thing under "Database schema", which
-- is the easier place to look.
-- ---------------------------------------------------------------------------
