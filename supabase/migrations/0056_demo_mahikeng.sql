-- Demonstration farms for drought mode and community alerts (docs/drought-community.md),
-- flagged Simulated like 0048, so they never count as real farms.
--
-- Open-Meteo geocoding results captured 2026-10-20 (countryCode=ZA):
--   Mahikeng (Mafikeng): -25.86522, 25.64421 - North West, Ngaka Modiri Molema District Municipality
--   Ottoshoop:           -25.74916, 25.96766 - North West, Ngaka Modiri Molema District Municipality
-- They are about 35 km apart, so a pest or fire report on one reaches the other.
--
-- farm.sim_scenario = 'drought' gives Mahikeng a dry forecast for drought mode, but only while
-- Simulation__Enabled=true on the API (SimulationRules); otherwise the real forecast is used.
-- Its tank is 5 000 L with 1 000 L logged in it (20%), below the 25% drought line.
-- Safe to run more than once.

alter table farm
    add column if not exists sim_scenario text;

comment on column farm.sim_scenario is 'Demonstration scenario for a Simulated farm (e.g. drought). Ignored unless the farm is_simulated and Simulation__Enabled is on.';

insert into farm (name, location, total_area, status, latitude, longitude, is_simulated, province, town, water_source, tank_capacity_litres, sim_scenario)
select 'Mahikeng (Simulated)', 'Mahikeng, North West', 0.02, 'Active', -25.86522, 25.64421, true,
       'North West', 'Mahikeng', 'tank', 5000, 'drought'
where not exists (select 1 from farm where name = 'Mahikeng (Simulated)');

insert into farm (name, location, total_area, status, latitude, longitude, is_simulated, province, town, water_source)
select 'Ottoshoop (Simulated)', 'Ottoshoop, North West', 0.01, 'Active', -25.74916, 25.96766, true,
       'North West', 'Ottoshoop', 'borehole'
where not exists (select 1 from farm where name = 'Ottoshoop (Simulated)');

update farm set latitude = -25.86522, longitude = 25.64421, is_simulated = true, province = 'North West',
       town = 'Mahikeng', water_source = 'tank', tank_capacity_litres = coalesce(tank_capacity_litres, 5000), sim_scenario = 'drought'
where name = 'Mahikeng (Simulated)';

update farm set latitude = -25.74916, longitude = 25.96766, is_simulated = true, province = 'North West',
       town = 'Ottoshoop', water_source = 'borehole'
where name = 'Ottoshoop (Simulated)';

-- Mahikeng: three zones at different stages, so drought mode shows full, half and skip.
insert into zone (farm_id, name, location, crop_type, size_value, size_unit, soil_type, area_m2,
                  root_depth_limit_m, planting_date, flow_rate_lpm, calibration_wet, calibration_dry,
                  irrigation_mode, irrigation_type)
select f.farm_id, z.name, f.location, z.crop, 0.005, 'ha', 'loam', 50, 0.6, current_date - z.age, 6, 100, 0, 'manual', z.kind
from farm f
cross join (values ('Maize (Simulated)', 'maize', 55, 'drip'),
                   ('Beans (Simulated)', 'dry_beans', 20, 'sprinkler'),
                   ('Potato (Simulated)', 'potato', 110, 'surface')) as z(name, crop, age, kind)
where f.name = 'Mahikeng (Simulated)'
  and not exists (select 1 from zone x where x.farm_id = f.farm_id and x.name = z.name);

insert into zone (farm_id, name, location, crop_type, size_value, size_unit, soil_type, area_m2,
                  root_depth_limit_m, planting_date, flow_rate_lpm, calibration_wet, calibration_dry,
                  irrigation_mode, irrigation_type)
select f.farm_id, 'Tomato (Simulated)', f.location, 'tomato', 0.01, 'ha', 'loam', 100, 0.6, current_date - 60, 10, 100, 0, 'manual', 'drip'
from farm f
where f.name = 'Ottoshoop (Simulated)'
  and not exists (select 1 from zone x where x.farm_id = f.farm_id and x.name = 'Tomato (Simulated)');

-- The low tank: one refill of 1 000 L into the 5 000 L tank.
insert into tank_refill (farm_id, litres_added, refilled_at)
select f.farm_id, 1000, now()
from farm f
where f.name = 'Mahikeng (Simulated)'
  and not exists (select 1 from tank_refill t where t.farm_id = f.farm_id);
