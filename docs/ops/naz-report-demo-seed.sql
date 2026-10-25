-- REVIEWED TARGET — NOT YET RUN ON LIVE. Execute only after final approval.
--
-- Three months of clearly labelled demonstration report data for Naz's existing
-- farm. This script never creates irrigation_commands, changes a device, changes
-- enrollment, or changes ownership. It therefore cannot publish MQTT commands.
--
-- Repeatable: a rerun replaces only this script's own rows. Authentic readings
-- are never deleted. See naz-report-demo-cleanup.sql to remove the demo rows.

begin;

-- Target confirmed by the read-only live lookup on 2026-10-25:
-- Naz R owns farm 27 ("Naz's"), whose reportable zone is 25 ("Spinach field").
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

-- One seed/cleanup at a time in this database.
select pg_advisory_xact_lock(hashtext('agroflow:naz-report-demo:2026-10-25'));

-- Fail closed if the reviewed identity, ownership, farm or zone setup differs.
do $guard$
declare
    c _agroflow_naz_demo_config%rowtype;
    v_profile_id uuid;
    v_count integer;
begin
    select * into strict c from _agroflow_naz_demo_config;

    select count(*) into v_count
      from profile
     where lower(email) = lower(c.profile_email);
    if v_count <> 1 then
        raise exception 'Expected exactly one profile for %, found %.', c.profile_email, v_count;
    end if;

    select id into v_profile_id
      from profile
     where lower(email) = lower(c.profile_email);

    if not exists (
        select 1
          from farm f
         where f.farm_id = c.farm_id
           and f.name = c.farm_name
           and coalesce(f.is_simulated, false) = false
           and (
                f.owner_id = v_profile_id
                or exists (
                    select 1 from farm_member fm
                     where fm.farm_id = f.farm_id
                       and fm.profile_id = v_profile_id
                )
           )
    ) then
        raise exception 'Reviewed farm % (%) is not an actual farm accessible to %.',
            c.farm_name, c.farm_id, c.profile_email;
    end if;

    select count(distinct z.id) into v_count
      from zone z
     where z.farm_id = c.farm_id
       and z.id = any(c.zone_ids);
    if v_count <> cardinality(c.zone_ids) then
        raise exception 'One or more reviewed zone IDs no longer belong to farm %.', c.farm_id;
    end if;

    if exists (
        select 1
          from zone z
         where z.id = any(c.zone_ids)
           and (
                z.flow_rate_lpm is null
                or z.flow_rate_lpm <= 0
                or z.max_run_minutes not between 1 and 120
           )
    ) then
        raise exception 'Every target zone needs a valid flow rate and safety limit.';
    end if;

    -- The unique simulated-row guard is one row per zone/day. Abort rather
    -- than overwrite simulated data from another source.
    if exists (
        select 1
          from sensor_reading r
         where r.zone_id = any(c.zone_ids)
           and r.simulated = true
           and r.simulation_day between c.first_day and c.last_day
           and not (
                r.sensor_type = 'SoilMoisture'
                and r.hardware_id is null
                and r.recorded_at =
                    ((r.simulation_day::timestamp + time '06:30')
                     at time zone 'Africa/Johannesburg')
           )
    ) then
        raise exception 'Another simulated data set already occupies part of the requested range.';
    end if;
end
$guard$;

-- Remove only a prior run of this exact seed. Sensor rows are identified by
-- all provenance fields plus this seed's exact local timestamp; real readings
-- have simulated=false and are untouched.
delete from sensor_reading r
 using _agroflow_naz_demo_config c
 where r.zone_id = any(c.zone_ids)
   and r.sensor_type = 'SoilMoisture'
   and r.simulated = true
   and r.hardware_id is null
   and r.simulation_day between c.first_day and c.last_day
   and r.recorded_at =
       ((r.simulation_day::timestamp + time '06:30')
        at time zone 'Africa/Johannesburg');

delete from irrigation_event e
 using _agroflow_naz_demo_config c
 where e.zone_id = any(c.zone_ids)
   and e.action = c.event_marker;

-- A seven-day drying cycle. A calibrated zone gets values corresponding to
-- 78%, 71%, ... 36%. Naz's zone is currently uncalibrated, so it instead gets
-- realistic raw ADC values from 1900 (wetter) to 3400 (drier). The report code
-- will correctly present those as raw readings, not invented percentages.
with config as (
    select * from _agroflow_naz_demo_config
), target_zones as (
    select z.*,
           row_number() over (order by z.id)::integer as zone_rank
      from zone z, config c
     where z.farm_id = c.farm_id
       and z.id = any(c.zone_ids)
), days as (
    select d::date as simulation_day
      from config c,
           generate_series(c.first_day, c.last_day, interval '1 day') d
), model as (
    select z.id as zone_id,
           d.simulation_day,
           (78.0 - 7.0 * mod(
               (d.simulation_day - c.first_day) + (z.zone_rank - 1) * 2,
               7
           )) as moisture_percent,
           z.calibration_wet,
           z.calibration_dry
      from target_zones z
      cross join days d
      cross join config c
)
insert into sensor_reading (
    zone_id, sensor_type, value, recorded_at, hardware_id, simulated, simulation_day
)
select m.zone_id,
       'SoilMoisture',
       case
           when m.calibration_wet is not null
            and m.calibration_dry is not null
            and m.calibration_wet <> m.calibration_dry
           then (m.calibration_dry
                 + (m.moisture_percent / 100.0)
                   * (m.calibration_wet - m.calibration_dry))::real
           else (1900.0 + (78.0 - m.moisture_percent) / 7.0 * 250.0)::real
       end,
       ((m.simulation_day::timestamp + time '06:30')
        at time zone 'Africa/Johannesburg'),
       null,
       true,
       m.simulation_day
  from model m
on conflict do nothing;

-- A matching run follows the driest reading in each seven-day cycle. Runtime
-- is varied but always capped by the zone's configured safety limit. These are
-- report-only historical events: command_id and logged_by_profile_id stay null,
-- and no irrigation_commands row is created.
with config as (
    select * from _agroflow_naz_demo_config
), target_zones as (
    select z.*,
           row_number() over (order by z.id)::integer as zone_rank
      from zone z, config c
     where z.farm_id = c.farm_id
       and z.id = any(c.zone_ids)
), days as (
    select d::date as simulation_day
      from config c,
           generate_series(c.first_day, c.last_day, interval '1 day') d
), runs as (
    select z.id as zone_id,
           d.simulation_day,
           least(
               z.max_run_minutes * 60,
               120 + 30 * mod(
                   ((d.simulation_day - c.first_day) / 7) + z.zone_rank,
                   3
               )
           )::integer as runtime_seconds,
           z.flow_rate_lpm,
           c.event_marker
      from target_zones z
      cross join days d
      cross join config c
     where mod(
               (d.simulation_day - c.first_day) + (z.zone_rank - 1) * 2,
               7
           ) = 6
)
insert into irrigation_event (
    zone_id, started_at, runtime_seconds, estimated_litres,
    trigger_source, sync_status, action, command_id, logged_by_profile_id
)
select r.zone_id,
       ((r.simulation_day::timestamp + time '06:45')
        at time zone 'Africa/Johannesburg'),
       r.runtime_seconds,
       round(((r.runtime_seconds / 60.0) * r.flow_rate_lpm)::numeric, 2),
       'manual',
       'synced',
       r.event_marker,
       null,
       null
  from runs r;

-- Roll back the whole seed if any daily reading was skipped.
do $verify$
declare
    c _agroflow_naz_demo_config%rowtype;
    v_expected integer;
    v_actual integer;
    v_events integer;
begin
    select * into strict c from _agroflow_naz_demo_config;
    v_expected := cardinality(c.zone_ids) * (c.last_day - c.first_day + 1);

    select count(*) into v_actual
      from sensor_reading r
     where r.zone_id = any(c.zone_ids)
       and r.sensor_type = 'SoilMoisture'
       and r.simulated = true
       and r.hardware_id is null
       and r.simulation_day between c.first_day and c.last_day
       and r.recorded_at =
           ((r.simulation_day::timestamp + time '06:30')
            at time zone 'Africa/Johannesburg');
    if v_actual <> v_expected then
        raise exception 'Expected % demo readings, found %. Nothing was committed.',
            v_expected, v_actual;
    end if;

    select count(*) into v_events
      from irrigation_event e
     where e.zone_id = any(c.zone_ids)
       and e.action = c.event_marker;
    if v_events = 0 then
        raise exception 'No matching demo irrigation events were created. Nothing was committed.';
    end if;
end
$verify$;

-- Reviewable receipt returned by the SQL editor.
select c.profile_email,
       c.farm_id,
       c.farm_name,
       z.id as zone_id,
       z.name as zone_name,
       count(distinct r.id) as demo_readings,
       count(distinct e.id) as demo_irrigation_events,
       min(r.recorded_at) as first_reading,
       max(r.recorded_at) as last_reading
  from _agroflow_naz_demo_config c
  join zone z on z.farm_id = c.farm_id and z.id = any(c.zone_ids)
  left join sensor_reading r
    on r.zone_id = z.id
   and r.sensor_type = 'SoilMoisture'
   and r.simulated = true
   and r.hardware_id is null
   and r.simulation_day between c.first_day and c.last_day
   and r.recorded_at =
       ((r.simulation_day::timestamp + time '06:30')
        at time zone 'Africa/Johannesburg')
  left join irrigation_event e
    on e.zone_id = z.id
   and e.action = c.event_marker
 group by c.profile_email, c.farm_id, c.farm_name, z.id, z.name
 order by z.id;

commit;
