-- AgroFlow foundation schema
-- Core identity/ownership hierarchy: profile -> farm -> zone.
-- Field set finalized against the class diagram documentation:
--   User (base): name, email, role - no password column, Supabase Auth owns
--   credentials, so profile only stores what the app itself needs.
--   Admin / FarmUser: no extra fields beyond profile.role - both are covered
--   by profile's role check, no separate tables.
--   Farm: farm_id, name, location, total_area, status.
--   Zone: crop_type, water_saved, health_status stored directly. moisture,
--   temperature and humidity are deliberately NOT columns here - see the
--   zone_latest_reading view in 0003_csharp_domain.sql.

create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- profile: one row per authenticated user, keyed to Supabase auth.users.
-- Covers User/Admin/FarmUser - role distinguishes admin from farm_user,
-- matching the C# inheritance where neither subclass adds fields.
-- ---------------------------------------------------------------------------
create table profile (
    id          uuid primary key references auth.users (id) on delete cascade,
    name        text not null default '',
    email       text not null unique,
    role        text not null default 'farm_user'
                check (role in ('admin', 'farm_user')),
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now()
);

create trigger trg_profile_updated_at
    before update on profile
    for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- farm: owned by a profile.
-- ---------------------------------------------------------------------------
create table farm (
    farm_id     bigint generated always as identity primary key,
    owner_id    uuid references profile (id) on delete set null,
    name        text not null,
    location    text not null default '',
    total_area  real not null default 0,
    -- allowed values not specified by the class diagram docs; defaulting to
    -- 'Active' with no check constraint until the real value set is known.
    status      text not null default 'Active',
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now()
);

create index idx_farm_owner_id on farm (owner_id);

create trigger trg_farm_updated_at
    before update on farm
    for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- zone: belongs to a farm. moisture/temperature/humidity are intentionally
-- absent - they are computed from sensor_reading via a view, not stored.
-- ---------------------------------------------------------------------------
create table zone (
    id            bigint generated always as identity primary key,
    farm_id       bigint not null references farm (farm_id) on delete cascade,
    crop_type     text not null default '',
    water_saved   real not null default 0,
    health_status text not null default 'Unknown'
                  check (health_status in ('Unknown', 'Critical', 'Warning', 'Healthy')),
    created_at    timestamptz not null default now(),
    updated_at    timestamptz not null default now()
);

create index idx_zone_farm_id on zone (farm_id);

create trigger trg_zone_updated_at
    before update on zone
    for each row execute function set_updated_at();
