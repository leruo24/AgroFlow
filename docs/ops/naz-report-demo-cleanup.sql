-- REVIEW ONLY — paired cleanup for naz-report-demo-seed.sql.
--
-- Removes only the seed's labelled irrigation events and its exact simulated
-- daily readings. It never touches authentic readings, devices, enrollment,
-- ownership, commands, farms or zones.

begin;

create temporary table _agroflow_naz_demo_config (
    profile_email text not null,
    farm_id bigint not null,
    farm_name text not null,
    zone_ids bigint[] not null,
    first_day date not null,
    last_day date not null,
    event_marker text not null
) on commit drop;

insert into _agroflow_naz_demo_config values (
    'nazreenryklief@gmail.com',
    27,
    'Naz''s',
    array[25]::bigint[],
    date '2026-07-27',
    date '2026-10-24',
    'DEMO-SEED:naz-report:2026-10-25'
);

select pg_advisory_xact_lock(hashtext('agroflow:naz-report-demo:2026-10-25'));

-- Same fail-closed identity/ownership guard as the seed.
do $guard$
declare
    c _agroflow_naz_demo_config%rowtype;
    v_profile_id uuid;
begin
    select * into strict c from _agroflow_naz_demo_config;
    select id into strict v_profile_id
      from profile
     where lower(email) = lower(c.profile_email);

    if not exists (
        select 1
          from farm f
         where f.farm_id = c.farm_id
           and f.name = c.farm_name
           and (
                f.owner_id = v_profile_id
                or exists (
                    select 1 from farm_member fm
                     where fm.farm_id = f.farm_id
                       and fm.profile_id = v_profile_id
                )
           )
    ) then
        raise exception 'Target farm identity or access no longer matches the reviewed values.';
    end if;

    if not exists (
        select 1
          from zone z
         where z.farm_id = c.farm_id
           and z.id = any(c.zone_ids)
    ) then
        raise exception 'The reviewed zone no longer belongs to the reviewed farm.';
    end if;
end
$guard$;

-- Delete events first only for a clear receipt; neither table references the
-- other for these demo rows (command_id is null).
with deleted as (
    delete from irrigation_event e
     using _agroflow_naz_demo_config c
     where e.zone_id = any(c.zone_ids)
       and e.action = c.event_marker
     returning e.id
)
select count(*) as deleted_demo_irrigation_events from deleted;

with deleted as (
    delete from sensor_reading r
     using _agroflow_naz_demo_config c
     where r.zone_id = any(c.zone_ids)
       and r.sensor_type = 'SoilMoisture'
       and r.simulated = true
       and r.hardware_id is null
       and r.simulation_day between c.first_day and c.last_day
       and r.recorded_at =
           ((r.simulation_day::timestamp + time '06:30')
            at time zone 'Africa/Johannesburg')
     returning r.id
)
select count(*) as deleted_demo_sensor_readings from deleted;

commit;
