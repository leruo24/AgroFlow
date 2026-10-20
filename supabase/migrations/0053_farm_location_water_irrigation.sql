-- Easier locations, the farm's water source and each zone's irrigation type
-- (docs/drought-community.md, Parts 3 and 4).
--   1. farm.province / farm.town: chosen by staff (admin onboarding and the farm drawer) from a
--      province list and a town search, so a spelling mistake can no longer lose a farm. farm.latitude / longitude (0010) stay the
--      exact point; existing farms keep theirs.
--   2. farm.water_source: tank, borehole, municipal, river or dam, other. A tank's size and
--      level stay in the 0046 fields (farm.tank_capacity_litres, tank_refill): no copies here.
--   3. zone.irrigation_type: drip, sprinkler, micro-sprinkler, centre pivot, surface/furrow or
--      hand watering. Used only to turn the engine's net water need into the gross amount to
--      apply (FAO application efficiency); the FAO-56 engine itself is unchanged.
--   4. staff_notice: something a farmer flagged for staff ("Something's wrong with my farm's
--      location - tell my field officer" in the setup wizard). Staff see it on the admin site's
--      Home and under the bell; farmers never edit their farm's location themselves.
-- Clients keep their existing access to farm and zone (0011); farmers still cannot change a
-- zone's irrigation type with their own login (zone_farmer_edit_guard, 0043) - the API saves it.
-- Safe to run more than once.

alter table farm
    add column if not exists province     text,
    add column if not exists town         text,
    add column if not exists water_source text;

do $guard$
begin
    if not exists (select 1 from pg_constraint where conrelid = 'public.farm'::regclass and conname = 'farm_province_check') then
        alter table farm add constraint farm_province_check check (province is null or province in (
            'Eastern Cape', 'Free State', 'Gauteng', 'KwaZulu-Natal', 'Limpopo',
            'Mpumalanga', 'North West', 'Northern Cape', 'Western Cape'));
    end if;
    if not exists (select 1 from pg_constraint where conrelid = 'public.farm'::regclass and conname = 'farm_water_source_check') then
        alter table farm add constraint farm_water_source_check check (water_source is null or water_source in (
            'tank', 'borehole', 'municipal', 'river_dam', 'other'));
    end if;
end $guard$;

comment on column farm.province is 'One of the nine South African provinces, picked from a list.';
comment on column farm.town is 'The town or city picked from the province-filtered search (Open-Meteo geocoding), for display only. farm.latitude/longitude are the exact point.';
comment on column farm.water_source is 'tank, borehole, municipal, river_dam or other. A tank''s size and level are farm.tank_capacity_litres and tank_refill (0046).';

alter table zone
    add column if not exists irrigation_type text;

do $guard$
begin
    if not exists (select 1 from pg_constraint where conrelid = 'public.zone'::regclass and conname = 'zone_irrigation_type_check') then
        alter table zone add constraint zone_irrigation_type_check check (irrigation_type is null or irrigation_type in (
            'drip', 'sprinkler', 'micro_sprinkler', 'centre_pivot', 'surface', 'hand'));
    end if;
end $guard$;

comment on column zone.irrigation_type is
    'drip, sprinkler, micro_sprinkler, centre_pivot, surface or hand. Converts the engine''s net need into gross water to apply using FAO field application efficiency (Brouwer, Prins & Heibloem 1989, FAO Irrigation Water Management Training Manual 4, Annex I Table 8). Null: shown as the net need.';

create table if not exists staff_notice (
    id            bigint generated always as identity primary key,
    farm_id       bigint references farm (farm_id) on delete cascade,
    profile_id    uuid references profile (id) on delete set null,
    kind          text not null check (kind in ('location_wrong')),
    message       text not null check (char_length(message) <= 500),
    created_at    timestamptz not null default now(),
    resolved_at   timestamptz,
    resolved_by   uuid references profile (id) on delete set null
);

create index if not exists idx_staff_notice_open on staff_notice (created_at desc) where resolved_at is null;

-- Read and written by the API only.
alter table staff_notice enable row level security;
revoke all on staff_notice from anon, authenticated;
