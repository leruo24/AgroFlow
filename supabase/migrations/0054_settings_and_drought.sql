-- Settings staff can change, and drought mode (docs/drought-community.md, Part 1).
--
--   1. app_setting: every threshold of drought mode and community alerts is a row here, not a
--      number in the code. Staff change them in the admin site (Settings -> Drought & community),
--      through the API. The values seeded below are the starting defaults; each row says where
--      its number comes from (the brief, FAO guidance, or a plain policy choice).
--   2. farm.drought_override: 'on' or 'off' when the farmer or staff switched drought mode by
--      hand; null means automatic. farm.drought_active / drought_since / drought_reason are the
--      API's latest automatic decision, so the admin site can list drought farms.
--   3. drought_event: each time drought mode turns on or off, and why (history, audit).
-- app_setting and drought_event are read and written by the API only: RLS on, no policies,
-- client grants revoked. The new farm columns follow farm's existing access (0011).
-- Safe to run more than once: settings already present keep their (possibly edited) value.

create table if not exists app_setting (
    key         text primary key,
    value       jsonb not null,
    description text not null,
    source      text not null,
    updated_at  timestamptz not null default now(),
    updated_by  uuid references profile (id) on delete set null
);

alter table app_setting enable row level security;
revoke all on app_setting from anon, authenticated;

insert into app_setting (key, value, description, source) values
  ('drought.tank_low_fraction', '0.25', 'Drought mode can start when the tank estimate is below this share of the tank (0.25 = 25%).', 'AgroFlow brief (25%)'),
  ('drought.forecast_days', '7', 'How many forecast days are added up for rain.', 'AgroFlow brief (7-day forecast)'),
  ('drought.rain_sum_mm', '5', 'Rain below this total over the forecast days counts as no meaningful rain.', 'AgroFlow brief (< 5 mm)'),
  ('drought.eto_ratio', '1.0', 'Reference ET counts as high when the forecast average is at least this times the farm''s own recent average (1.0 = at or above the usual for this farm).', 'Policy: compares the farm with its own record instead of a fixed number'),
  ('drought.eto_lookback_days', '30', 'Days of the farm''s own past reference ET used as "usual for the area".', 'Policy'),
  ('drought.ky_full_at', '1.0', 'Zones whose crop stage has a yield response factor (Ky) at or above this get full water in drought mode. Ky > 1 means very sensitive to water deficit.', 'FAO Irrigation and Drainage Paper 66 (Steduto et al. 2012), ch. 2, definition of Ky'),
  ('drought.ky_skip_below', '0.25', 'Zones whose crop stage Ky is below this may skip a day in drought mode (FAO late-season values are 0.20).', 'Policy, using FAO-66 ch. 2 Table 2 stage values'),
  ('drought.reduced_fraction', '0.5', 'Share of the normal amount for zones between the two Ky limits (0.5 = half).', 'Policy (AgroFlow brief example: "Zone 2 at half")'),
  ('community.report_limit', '2', 'Reports one farmer may add in the window below.', 'AgroFlow brief'),
  ('community.report_window_hours', '36', 'The rolling window for the report limit, in hours.', 'AgroFlow brief'),
  ('community.radius_km.pest', '50', 'Farms within this distance hear about a major pest report.', 'AgroFlow brief default'),
  ('community.radius_km.disease', '25', 'Farms within this distance hear about a suspected crop disease.', 'AgroFlow brief default'),
  ('community.radius_km.fire', '50', 'Farms within this distance hear about a fire.', 'AgroFlow brief default'),
  ('community.radius_km.water', '20', 'Farms within this distance hear about a water problem.', 'AgroFlow brief default'),
  ('community.radius_km.weather', '30', 'Farms within this distance hear about severe weather.', 'AgroFlow brief default'),
  ('community.expiry_hours.pest', '168', 'A pest report is shown for this long (7 days).', 'AgroFlow brief'),
  ('community.expiry_hours.disease', '168', 'A disease report is shown for this long (7 days).', 'AgroFlow brief'),
  ('community.expiry_hours.water', '72', 'A water problem report is shown for this long (3 days).', 'AgroFlow brief'),
  ('community.expiry_hours.weather', '24', 'A severe weather report is shown for this long.', 'AgroFlow brief'),
  ('community.expiry_hours.fire', '48', 'A fire report closes after this long if nobody marks it out.', 'AgroFlow brief'),
  ('community.group_hours', '48', 'Reports of the same kind within the radius and this many hours are grouped ("3 nearby farms have reported similar activity").', 'AgroFlow brief'),
  ('fire.downwind_factor', '1.5', 'Downwind farms are alerted out to this many times the fire radius.', 'AgroFlow brief'),
  ('fire.cone_degrees', '45', 'A farm is downwind when it lies within this many degrees either side of the wind''s direction.', 'AgroFlow brief (±45°)'),
  ('fire.escalate_confirmations', '3', 'When this many farms confirm a fire, its radius grows.', 'AgroFlow brief'),
  ('fire.escalate_factor', '1.5', 'How much the fire radius grows when it is escalated.', 'Policy'),
  ('fire.emergency_text', '"your local emergency number (112 from a mobile phone)"', 'Shown in every fire message: "If you''re in danger, leave and call ..."', 'Admin setting; 112 is the emergency number from mobile phones in South Africa')
on conflict (key) do nothing;

alter table farm
    add column if not exists drought_override text,
    add column if not exists drought_active   boolean not null default false,
    add column if not exists drought_since    timestamptz,
    add column if not exists drought_reason   text;

do $guard$
begin
    if not exists (select 1 from pg_constraint where conrelid = 'public.farm'::regclass and conname = 'farm_drought_override_check') then
        alter table farm add constraint farm_drought_override_check check (drought_override is null or drought_override in ('on', 'off'));
    end if;
end $guard$;

comment on column farm.drought_override is 'on/off when drought mode was switched by hand (farmer or staff); null = automatic.';
comment on column farm.drought_active is 'Whether drought mode is on now (automatic decision or the override), written by the API.';

create table if not exists drought_event (
    id          bigint generated always as identity primary key,
    farm_id     bigint not null references farm (farm_id) on delete cascade,
    active      boolean not null,
    source      text not null check (source in ('automatic', 'farmer', 'staff')),
    reason      text not null,
    changed_by  uuid references profile (id) on delete set null,
    created_at  timestamptz not null default now()
);

create index if not exists idx_drought_event_farm_created on drought_event (farm_id, created_at desc);

alter table drought_event enable row level security;
revoke all on drought_event from anon, authenticated;
