-- Automatic reports: daily, a chosen weekday, per-zone PDFs, more recipients,
-- and who turned a schedule off (item 4).
--
-- WHAT CHANGES FOR EXISTING ROWS: NOTHING
-- --------------------------------------
-- Every new column defaults to what a 0035 row already meant: weekly on
-- Monday, one all-zones PDF, the farmer only, nobody recorded as turning it
-- off. No row is rewritten. The only non-additive statement is widening the
-- frequency check to allow 'daily' - the old constraint is dropped and an
-- identical one plus 'daily' added, so every value that passed before passes
-- now.
--
-- Idempotent: safe to re-run.

-- 'daily' joins 'weekly' and 'monthly'. 0035 created this check inline, so
-- Postgres named it report_schedule_frequency_check.
alter table report_schedule drop constraint if exists report_schedule_frequency_check;
alter table report_schedule
    add constraint report_schedule_frequency_check
    check (frequency in ('daily', 'weekly', 'monthly'));

-- Weekly: which day it is sent, ISO numbering (1 = Monday ... 7 = Sunday).
-- Null keeps 0035's Monday.
alter table report_schedule add column if not exists day_of_week smallint;
alter table report_schedule drop constraint if exists report_schedule_day_of_week_check;
alter table report_schedule
    add constraint report_schedule_day_of_week_check
    check (day_of_week is null or day_of_week between 1 and 7);

-- One tailored PDF per zone instead of one all-zones PDF.
alter table report_schedule add column if not exists per_zone_pdf boolean not null default false;

-- Extra recipients beside the farmer. The admin who set the schedule up, and
-- an admin group chat whose id is configuration (Telegram:AdminGroupChatId),
-- never stored here.
alter table report_schedule add column if not exists send_to_handler boolean not null default false;
alter table report_schedule add column if not exists admin_chat_enabled boolean not null default false;

-- Who turned it off, and when. A farmer's own off switch and an admin's are
-- both recorded, so "why did my reports stop?" has an answer.
alter table report_schedule add column if not exists turned_off_by uuid references profile (id) on delete set null;
alter table report_schedule add column if not exists turned_off_at timestamptz;

comment on column report_schedule.day_of_week is
    'Weekly schedules only: ISO day the report is sent (1 = Monday). Null = Monday, as before this column existed.';
comment on column report_schedule.per_zone_pdf is
    'True: each zone gets its own tailored PDF. False: one all-zones PDF, as before this column existed.';

-- RLS is unchanged: 0035's policies cover every column of this table.
