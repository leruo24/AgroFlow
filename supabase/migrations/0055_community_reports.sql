-- Community alerts: farmers warn nearby farms (docs/drought-community.md, Part 2), and each
-- farmer's alert choices (Part 4, "Alerts & help").
--
--   community_report: one report, placed at the reporting farm's saved location (staff set
--     it; farmers never pick a point and the phone is never tracked). Only that point rounded
--     to 2 decimal places (about 1 km) is stored, and it is never shown with the reporter's name.
--   community_report_confirmation: "I'm seeing this too", once per farmer per report.
--   community_report_update: the reporter's or a confirmer's update (fires: still burning,
--     spreading towards ..., under control, out).
--   community_notification: which farms were told about what, so nobody is told twice and the
--     app can list what reached a farm.
--   notification_preference: per farmer, which alerts also go to Telegram, quiet hours, and
--     whether they get community alerts at all (on by default). In-app is always on.
-- All five are read and written by the API only (RLS on, no policies, client grants revoked),
-- so no client can read where a report came from or who made it.
-- Safe to run more than once.

create table if not exists community_report (
    id                  bigint generated always as identity primary key,
    reporter_profile_id uuid not null references profile (id) on delete cascade,
    farm_id             bigint references farm (farm_id) on delete set null,
    category            text not null check (category in ('pest', 'disease', 'fire', 'water', 'weather')),
    subtype             text not null,
    severity            text not null check (severity in ('low', 'moderate', 'high')),
    description         text check (char_length(description) <= 280),
    latitude_rounded    numeric(5,2) not null check (latitude_rounded between -35 and -22),
    longitude_rounded   numeric(5,2) not null check (longitude_rounded between 16 and 33),
    -- Always the reporting farm's saved location (set by staff); the phone is never tracked.
    location_source     text not null default 'farm' check (location_source = 'farm'),
    radius_km           numeric(6,1) not null check (radius_km > 0),
    status              text not null default 'active' check (status in ('active', 'hidden', 'expired', 'closed')),
    fire_state          text check (fire_state is null or fire_state in ('burning', 'spreading', 'under_control', 'out')),
    wind_from_deg       numeric(5,1),
    wind_speed_kmh      numeric(5,1),
    escalated           boolean not null default false,
    expires_at          timestamptz not null,
    hidden_reason       text,
    hidden_by           uuid references profile (id) on delete set null,
    hidden_at           timestamptz,
    created_at          timestamptz not null default now(),
    updated_at          timestamptz not null default now()
);

create index if not exists idx_community_report_reporter_created on community_report (reporter_profile_id, created_at desc);
create index if not exists idx_community_report_active on community_report (category, created_at desc) where status = 'active';

create table if not exists community_report_confirmation (
    report_id   bigint not null references community_report (id) on delete cascade,
    profile_id  uuid not null references profile (id) on delete cascade,
    farm_id     bigint references farm (farm_id) on delete set null,
    created_at  timestamptz not null default now(),
    primary key (report_id, profile_id)
);

create table if not exists community_report_update (
    id          bigint generated always as identity primary key,
    report_id   bigint not null references community_report (id) on delete cascade,
    profile_id  uuid not null references profile (id) on delete cascade,
    kind        text not null check (kind in ('still_burning', 'spreading', 'under_control', 'out', 'note')),
    direction   text check (direction is null or direction in ('north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west')),
    note        text check (char_length(note) <= 280),
    wind_from_deg  numeric(5,1),
    wind_speed_kmh numeric(5,1),
    created_at  timestamptz not null default now()
);

create index if not exists idx_community_report_update_report on community_report_update (report_id, created_at);

create table if not exists community_notification (
    id          bigint generated always as identity primary key,
    report_id   bigint not null references community_report (id) on delete cascade,
    farm_id     bigint not null references farm (farm_id) on delete cascade,
    update_id   bigint references community_report_update (id) on delete cascade,
    kind        text not null check (kind in ('report', 'update', 'escalation')),
    priority    text not null default 'normal' check (priority in ('normal', 'downwind')),
    distance_km numeric(6,1) not null,
    message     text not null,
    created_at  timestamptz not null default now()
);

-- Once per farm per report for the first alert; once per farm per update after that.
create unique index if not exists idx_community_notification_once
    on community_notification (report_id, farm_id, kind, coalesce(update_id, 0));
create index if not exists idx_community_notification_farm on community_notification (farm_id, created_at desc);

create table if not exists notification_preference (
    profile_id          uuid primary key references profile (id) on delete cascade,
    watering_telegram   boolean not null default true,
    low_tank_telegram   boolean not null default true,
    drought_telegram    boolean not null default true,
    community_telegram  boolean not null default true,
    weather_telegram    boolean not null default true,
    community_opt_in    boolean not null default true,
    quiet_start         time,
    quiet_end           time,
    updated_at          timestamptz not null default now()
);

alter table community_report enable row level security;
alter table community_report_confirmation enable row level security;
alter table community_report_update enable row level security;
alter table community_notification enable row level security;
alter table notification_preference enable row level security;

revoke all on community_report, community_report_confirmation, community_report_update,
              community_notification, notification_preference from anon, authenticated;
