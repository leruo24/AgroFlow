-- Send-once bookkeeping for the three messages a farm/zone request produces.
--
-- WHY NOT notification_sent (0026)
-- -------------------------------
-- 0026's ledger is exactly the right PATTERN for this - claim a key, send
-- only if the insert landed - and the task names it as the thing to use. Its
-- TABLE cannot carry these messages, for one hard reason: `farm_id bigint not
-- null references farm (farm_id)`. A new_farm request has no farm yet. That
-- is the whole point of the request, and it is the request type whose
-- "we've received it" message matters most, because the farmer has nothing
-- in the app to look at yet.
--
-- Widening notification_sent.farm_id to nullable was the alternative. It was
-- rejected: that column is NOT NULL and part of the unique index that makes
-- the whole ledger work, and in Postgres two NULL farm_ids count as distinct
-- for uniqueness - so a nullable farm_id would silently stop deduplicating
-- precisely the rows that needed it. The weather and equipment alerts that
-- table serves are all genuinely farm-scoped and should keep that constraint.
--
-- So: the same mechanism, keyed by what is actually unique here.
--
-- WHY THIS IS NEEDED AT ALL
-- -------------------------
-- An admin can set a request to Scheduled, change their mind, set it back to
-- pending, and forward it again. Without this the farmer gets "your hardware
-- kit is booked" three times, and a farmer who learns the channel repeats
-- itself stops reading it - which is how the frost warning gets missed.
--
-- Idempotent - safe to re-run.

create table if not exists service_request_notification (
    id          bigint generated always as identity primary key,

    request_id  bigint not null references service_request (id) on delete cascade,

    -- 'submitted' / 'scheduled' / 'completed', from
    -- FarmRequestMessages.StageFor - derived from service_request.status, not
    -- stored by the admin, so it cannot drift from the CHECK on that column.
    stage       text not null,

    -- 'farmer' or 'admin'. The same status change sends a different message
    -- to each, so each needs its own claim - otherwise notifying the admin
    -- would suppress the farmer's message.
    audience    text not null check (audience in ('farmer', 'admin')),

    sent_at     timestamptz not null default now()
);

-- The point of the table: the claim either inserts or conflicts.
create unique index if not exists idx_service_request_notification_unique
    on service_request_notification (request_id, stage, audience);

alter table service_request_notification enable row level security;

-- No policies, same as 0026: under ENABLE with zero policies every non-owner
-- role sees nothing and can write nothing. AgroFlow.Api connects as the
-- table-owning `postgres` role and bypasses RLS. The revoke makes the
-- intent explicit, so a later migration adding a policy has to add a grant
-- deliberately.
revoke all on service_request_notification from anon, authenticated;
revoke all on sequence service_request_notification_id_seq from anon, authenticated;

comment on table service_request_notification is
    'Send-once ledger for farm/zone request messages. Same mechanism as '
    'notification_sent (0026), keyed by (request, stage, audience) because a '
    'new_farm request has no farm_id to key on. Rows are safe to delete once '
    'the request is closed.';
