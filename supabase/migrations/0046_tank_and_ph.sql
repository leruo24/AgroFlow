-- One refillable water tank per farm, optional water pH on each refill, and
-- farmer-entered soil pH history per zone. Tank levels are estimates derived
-- from pump runtime and the zone's configured flow rate; no level sensor is
-- implied by this schema.

alter table farm
    add column if not exists tank_capacity_litres numeric(12,1)
        check (tank_capacity_litres > 0);

create table if not exists tank_refill (
    id                              bigint generated always as identity primary key,
    farm_id                         bigint not null references farm (farm_id) on delete cascade,
    litres_added                    numeric(12,1) not null check (litres_added > 0),
    water_ph                        numeric(3,1) check (water_ph between 0 and 14),
    refilled_at                     timestamptz not null default now(),
    estimated_used_since_previous  numeric(12,1),
    observed_used_since_previous   numeric(12,1),
    logged_by_profile_id            uuid references profile (id) on delete set null,
    created_at                      timestamptz not null default now()
);

create index if not exists idx_tank_refill_farm_refilled
    on tank_refill (farm_id, refilled_at desc, id desc);

create table if not exists soil_ph_log (
    id                    bigint generated always as identity primary key,
    zone_id               bigint not null references zone (id) on delete cascade,
    ph                    numeric(3,1) not null check (ph between 0 and 14),
    measured_at           timestamptz not null default now(),
    note                  text check (char_length(note) <= 500),
    logged_by_profile_id  uuid references profile (id) on delete set null,
    created_at            timestamptz not null default now()
);

create index if not exists idx_soil_ph_log_zone_measured
    on soil_ph_log (zone_id, measured_at desc, id desc);

-- Farm-wide alerts need a farm key because they do not belong to one zone.
alter table alert
    add column if not exists farm_id bigint references farm (farm_id) on delete cascade;

create index if not exists idx_alert_farm_id on alert (farm_id);

create unique index if not exists idx_alert_one_open_tank_low
    on alert (farm_id)
    where zone_id is null
      and status = 'Open'
      and message = 'Your tank is getting low — refill and log the reading.';

update alert a
   set farm_id = z.farm_id
  from zone z
 where a.zone_id = z.id
   and a.farm_id is null;

alter table tank_refill enable row level security;
alter table soil_ph_log enable row level security;

grant select on tank_refill, soil_ph_log to authenticated;

drop policy if exists tank_refill_select_member on tank_refill;
create policy tank_refill_select_member on tank_refill
    for select to authenticated
    using (app_can_access_farm(farm_id));

drop policy if exists tank_refill_select_admin on tank_refill;
create policy tank_refill_select_admin on tank_refill
    for select to authenticated
    using (app_is_admin());

drop policy if exists soil_ph_log_select_member on soil_ph_log;
create policy soil_ph_log_select_member on soil_ph_log
    for select to authenticated
    using (exists (
        select 1 from zone z
         where z.id = soil_ph_log.zone_id
           and app_can_access_farm(z.farm_id)
    ));

drop policy if exists soil_ph_log_select_admin on soil_ph_log;
create policy soil_ph_log_select_admin on soil_ph_log
    for select to authenticated
    using (app_is_admin());

drop policy if exists alert_select_member on alert;
create policy alert_select_member on alert
    for select to authenticated
    using (
        (farm_id is not null and app_can_access_farm(farm_id))
        or exists (
            select 1 from zone z
             where z.id = alert.zone_id
               and app_can_access_farm(z.farm_id)
        )
    );

drop policy if exists alert_update_member on alert;
create policy alert_update_member on alert
    for update to authenticated
    using (
        (farm_id is not null and app_can_access_farm(farm_id))
        or exists (
            select 1 from zone z
             where z.id = alert.zone_id
               and app_can_access_farm(z.farm_id)
        )
    )
    with check (
        (farm_id is not null and app_can_access_farm(farm_id))
        or exists (
            select 1 from zone z
             where z.id = alert.zone_id
               and app_can_access_farm(z.farm_id)
        )
    );

comment on column farm.tank_capacity_litres is
    'Configured tank size. Null means the farm has not set up tank tracking.';
comment on table tank_refill is
    'Farmer-entered refill amounts and optional water pH. Comparisons are snapshots only and never alter zone flow rates.';
comment on table soil_ph_log is
    'Farmer-entered soil pH observations. Soil pH is displayed only and does not change irrigation decisions.';
