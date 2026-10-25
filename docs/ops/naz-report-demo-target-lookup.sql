-- READ ONLY. Safe to run against live Supabase.
--
-- Finds profiles whose name or email contains "naz", then lists every farm
-- they own or belong to, its zones, report prerequisites and enrolled kits.
-- It performs no insert, update, delete, DDL or function call.

with naz_profiles as (
    select p.id, p.name, p.email, p.role
      from profile p
     where p.name ilike '%naz%'
        or p.email ilike '%naz%'
), accessible_farms as (
    select p.id as profile_id,
           p.name as profile_name,
           p.email as profile_email,
           p.role,
           f.farm_id,
           f.name as farm_name,
           f.status as farm_status,
           coalesce(f.is_simulated, false) as farm_is_simulated,
           case when f.owner_id = p.id then 'owner' else 'member' end as access_kind
      from naz_profiles p
      join farm f
        on f.owner_id = p.id
        or exists (
            select 1
              from farm_member fm
             where fm.farm_id = f.farm_id
               and fm.profile_id = p.id
        )
)
select a.profile_id,
       a.profile_name,
       a.profile_email,
       a.role,
       a.access_kind,
       a.farm_id,
       a.farm_name,
       a.farm_status,
       a.farm_is_simulated,
       z.id as zone_id,
       z.name as zone_name,
       z.status as zone_status,
       z.irrigation_mode,
       z.calibration_wet,
       z.calibration_dry,
       z.flow_rate_lpm,
       z.max_run_minutes,
       count(h.hardware_id) filter (where h.enrollment_status = 'active') as active_kits,
       string_agg(
           distinct concat_ws(' / ', h.device_name, h.device_id, h.status, h.enrollment_status),
           '; '
       ) filter (where h.hardware_id is not null) as kits
  from accessible_farms a
  left join zone z on z.farm_id = a.farm_id
  left join hardware h on h.zone_id = z.id
 group by a.profile_id, a.profile_name, a.profile_email, a.role, a.access_kind,
          a.farm_id, a.farm_name, a.farm_status, a.farm_is_simulated,
          z.id, z.name, z.status, z.irrigation_mode, z.calibration_wet,
          z.calibration_dry, z.flow_rate_lpm, z.max_run_minutes
 order by a.profile_email, a.farm_id, z.id;
