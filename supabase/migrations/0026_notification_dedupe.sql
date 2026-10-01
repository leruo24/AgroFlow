-- One message per farm per event, however many times we notice the event.
--
-- THE PROBLEM THIS SOLVES
-- WeatherCollectionService refreshes every farm's forecast every 6 hours, and
-- each refresh carries 8 days of forecast. A storm four days out is therefore
-- seen again on every cycle until it arrives: roughly 4 refreshes a day times
-- 4 days, about 20 identical "heavy rain coming" messages for one storm. A
-- farmer who gets that once mutes the bot, and then misses the frost warning
-- that mattered.
--
-- The same applies to every polled check. Device offline and zone-critical are
-- already transition-only in code, but a device that flaps, or a zone that
-- crosses the critical line back and forth, would still produce a burst. This
-- table is the backstop for all of them.
--
-- HOW IT WORKS
-- Before sending, AgroFlow claims (farm_id, alert_type, subject_date). The
-- insert either succeeds - this is the first time, send it - or hits the
-- unique constraint and does nothing, meaning someone already sent it. The
-- claim and the check are the same statement, so two API instances racing
-- cannot both win.
--
-- subject_date is what the alert is ABOUT, not when it was sent: the forecast
-- day for weather, the day the fault was noticed for equipment. That is what
-- makes "the storm on Friday" one event no matter how many times the forecast
-- is refreshed before Friday.
--
-- alert_type carries the subject id where there can be more than one per farm
-- (for example 'pump_unresponsive:42' for zone 42), so two broken zones on one
-- farm are two events, not one.
--
-- RLS follows 0011: ENABLE (never FORCE - AgroFlow.Api connects as the
-- table-owning `postgres` role and must keep bypassing), zero policies, and an
-- explicit revoke. No client reads or writes this; it is AgroFlow.Api's own
-- bookkeeping.
--
-- Idempotent - safe to re-run.

create table if not exists notification_sent (
    id            bigint generated always as identity primary key,
    farm_id       bigint not null references farm (farm_id) on delete cascade,

    -- e.g. 'weather_rain', 'weather_frost', 'weather_heat',
    --      'device_offline:17', 'pump_unresponsive:42', 'zone_critical:42'
    alert_type    text not null,

    -- The day the alert is about. Weather uses the forecast date; equipment
    -- faults use the date the fault was observed.
    subject_date  date not null,

    sent_at       timestamptz not null default now()
);

-- The whole point of the table. Named explicitly so the ON CONFLICT in
-- NotificationLedger targets it rather than relying on inference.
create unique index if not exists idx_notification_sent_unique
    on notification_sent (farm_id, alert_type, subject_date);

-- Supports the housekeeping delete below; nothing in the send path needs it.
create index if not exists idx_notification_sent_sent_at
    on notification_sent (sent_at);

alter table notification_sent enable row level security;

-- No policies on purpose: under ENABLE with zero policies every non-owner role
-- sees nothing and can write nothing. The revoke makes that explicit, so a
-- later migration adding a policy still has to add a grant deliberately.
revoke all on notification_sent from anon, authenticated;

comment on table notification_sent is
    'Deduplication ledger for outbound farmer notifications. One row per '
    '(farm, alert type, subject date); the unique index is what stops a '
    'repeatedly-observed event being sent repeatedly. Rows older than a '
    'season are safe to delete - re-sending an alert about a date that has '
    'already passed is harmless because nothing looks back that far.';
