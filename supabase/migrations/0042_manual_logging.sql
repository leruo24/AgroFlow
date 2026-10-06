-- Manual logging for farms without a kit, or when it is offline (item 6).
--
-- "I WATERED"
-- -----------
-- A watering the farmer did by hand - a hose, a bucket, a pump nobody's kit
-- controls - goes into irrigation_event like any other, so the water balance,
-- the reports and the history all count it. What marks it as hand-logged is
-- logged_by_profile_id: the person who logged it, from their login.
-- trigger_source alone cannot say this - 'manual' already means the app's
-- "Water now" button, which a kit carries out and reports back.
--
-- "HOW DOES THE SOIL FEEL?"
-- ------------------------
-- A farmer's own Dry / Moist / Wet check. The engine uses it to correct its
-- estimate of how dry the soil is (Dry ~ at the watering point, Wet ~ full),
-- labelled as a manual check and trusted less than a set-up sensor.
--
-- Additive and idempotent: safe to re-run.

alter table irrigation_event
    add column if not exists logged_by_profile_id uuid references profile (id) on delete set null;

comment on column irrigation_event.logged_by_profile_id is
    'Set when a farmer logged this watering by hand ("I watered"). Null for anything a kit carried out.';

create table if not exists soil_feel_check (
    id           bigint generated always as identity primary key,
    zone_id      bigint not null references zone (id) on delete cascade,
    feel         text not null check (feel in ('dry', 'moist', 'wet')),
    checked_at   timestamptz not null default now(),
    profile_id   uuid references profile (id) on delete set null,
    created_at   timestamptz not null default now()
);

create index if not exists idx_soil_feel_check_zone_checked
    on soil_feel_check (zone_id, checked_at desc);

-- ---------------------------------------------------------------------------
-- RLS. Farm members read their zones' checks; admins read all. Writes go
-- through the API (POST /api/farmer/zones/{id}/soil-feel), which takes the
-- person from the login - so there is no insert policy for anyone.
-- ---------------------------------------------------------------------------
alter table soil_feel_check enable row level security;

grant select on soil_feel_check to authenticated;

drop policy if exists soil_feel_check_select_member on soil_feel_check;
create policy soil_feel_check_select_member
    on soil_feel_check
    for select
    to authenticated
    using (exists (select 1 from zone z where z.id = soil_feel_check.zone_id and app_can_access_farm(z.farm_id)));

drop policy if exists soil_feel_check_select_admin on soil_feel_check;
create policy soil_feel_check_select_admin
    on soil_feel_check
    for select
    to authenticated
    using (app_is_admin());
