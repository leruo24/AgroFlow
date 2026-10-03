-- Record WHEN a farmer saw an alert, so the team can tell whether alerts are
-- being acted on.
--
-- WHY THIS COLUMN DID NOT EXIST
-- -----------------------------
-- The mobile app has always had a "read" flag on an alert, and the Alerts
-- screen has always shown "Unread" and cleared it on tap. But that flag lived
-- ONLY in the phone's AsyncStorage (see AgroFlowContext's STORAGE_KEYS note).
-- It never reached the database, so:
--
--   * reinstalling the app, or signing in on a second phone, marked every
--     alert unread again;
--   * and nobody on the AgroFlow side could tell whether a farmer had ever
--     seen the frost warning that mattered.
--
-- The second is the one that matters for the deployment: the whole point of
-- the alert channel is that somebody acts on it, and until now there was no
-- way to check that it was working.
--
-- `alert.status` already exists (Open/Resolved) and is NOT this. Resolved
-- means the underlying problem went away - DeviceStatusMonitorService and
-- SensorReadingProcessor both write it on their own. read_at means a human
-- looked at it. A zone can go back to healthy (Resolved) without the farmer
-- ever having opened the app, and that difference is exactly what we need to
-- be able to see.
--
-- Idempotent: safe to re-run.

alter table alert
    add column if not exists read_at timestamptz;

-- Partial: the interesting query is "which alerts has nobody looked at", and
-- on a healthy farm most rows eventually have a timestamp.
create index if not exists idx_alert_unread
    on alert (zone_id, created_at desc)
    where read_at is null;

comment on column alert.read_at is
    'When a farmer first opened this alert in the app. NULL means nobody has looked at it. Distinct from status: Resolved means the problem went away, which can happen without anyone reading it.';

-- ---------------------------------------------------------------------------
-- Narrow the farmer's UPDATE to the two columns they have any business
-- writing.
--
-- 0011 granted `update on alert to authenticated` as a WHOLE-TABLE grant, with
-- the alert_update_member policy scoping it to the farmer's own farms. The
-- policy controls which ROWS; it has never controlled which COLUMNS. So a
-- farmer could rewrite the message or severity of an alert on their own farm -
-- which is the record of what AgroFlow told them, and is exactly the thing an
-- audit of "did they act on it" would rest on.
--
-- This is the same column-level treatment 0027 chose for
-- ai_recommendation.dismissed_at ("so a farmer cannot rewrite an insight's
-- message or severity") and that 0028 applied to hardware. Acknowledging
-- (status) and reading (read_at) keep working; nothing else was ever used by
-- either client - the admin dashboard only SELECTs alerts, and the mobile app
-- reaches them through /api/farmer/dashboard.
--
-- AgroFlow.Api connects as the table-owning `postgres` role and bypasses all
-- of this, so no server path changes.
-- ---------------------------------------------------------------------------
revoke update on alert from authenticated;

grant update (status, read_at) on alert to authenticated;

-- The row-scoping policy from 0011 is unchanged and still applies; it is not
-- redefined here.
