-- FAO-56 insight engine: soil and calibration columns on zone, the weather
-- inputs Penman-Monteith needs on weather_daily, a daily DHT11 view, the
-- per-zone water balance table, and ai_recommendation reshaped to carry
-- insights.
--
-- NUMBERING: 0021 (Luba, service_request) was the highest reserved number when
-- this was specified, but 0024-0026 already exist in the repo, so 0022/0023
-- would sort BEFORE migrations that are already applied. 0027 is the first
-- number after the highest in use. Reservations honoured: Phili 0014-0015 (not
-- used - those numbers are still free), Leruo from 0016, Luba 0021.
--
-- NOT APPLIED TO LIVE. Run this in the Supabase SQL editor after review.
-- Idempotent - safe to re-run.
--
-- No dollar-quoting anywhere (the Supabase SQL editor mishandles it): policies
-- are made idempotent with DROP POLICY IF EXISTS instead of DO blocks, and the
-- one function body is single-quoted.

-- ---------------------------------------------------------------------------
-- 1. zone: soil, size and sensor calibration.
--
--    flow_rate_lpm is NOT added here - it already exists from 0018, with the
--    1.5 L/min default set in 0020.
--
--    size_value/size_unit (0010) are the farmer-facing size in hectares and are
--    left alone. area_m2 is a separate, measured figure in square metres: the
--    water balance needs m2 to turn a depth of water in mm into litres, and the
--    demo tubs are far too small to express in hectares without losing
--    precision.
-- ---------------------------------------------------------------------------
alter table zone
    add column if not exists soil_type           text not null default 'loam',
    add column if not exists area_m2             numeric,
    add column if not exists root_depth_limit_m  numeric,
    add column if not exists calibration_wet     numeric,
    add column if not exists calibration_dry     numeric;

-- Added separately so re-running the migration does not fail on an existing
-- constraint.
alter table zone drop constraint if exists zone_soil_type_check;
alter table zone
    add constraint zone_soil_type_check
    check (soil_type in ('sandy', 'loam', 'clay'));

alter table zone drop constraint if exists zone_area_m2_check;
alter table zone
    add constraint zone_area_m2_check
    check (area_m2 is null or area_m2 > 0);

alter table zone drop constraint if exists zone_root_depth_limit_check;
alter table zone
    add constraint zone_root_depth_limit_check
    check (root_depth_limit_m is null or root_depth_limit_m > 0);

comment on column zone.soil_type is
    'Soil texture class, used with FAO-56 Table 19 to get field capacity and wilting point. Set by the team at installation and changeable by the farmer on the Soil type screen. Defaults to loam, the most common garden soil and the documented assumption for the demo tubs.';

comment on column zone.area_m2 is
    'Wetted area of this zone in square metres, measured at installation. Converts a water depth in mm into litres (1 mm over 1 m2 = 1 L). NULL means litre amounts cannot be worked out, which is correct rather than guessing an area. Distinct from size_value/size_unit, which are the farmer-facing size in hectares.';

comment on column zone.root_depth_limit_m is
    'Physical rooting depth available, in metres - the depth of the tub or bed. Caps the FAO-56 Table 22 rooting depth so a 1.0 m maize root zone in a 0.3 m tub does not claim three times the water the tub can hold. NULL means unlimited, i.e. use the table value.';

comment on column zone.calibration_wet is
    'Raw soil sensor reading taken with the soil fully wetted. With calibration_dry this converts raw readings into a RELATIVE moisture percentage. The probe is resistive, so wet usually reads LOWER than dry; nothing assumes a direction. NULL means this zone is not calibrated - watering advice still works from weather and crop data, but no percentage can be shown.';

comment on column zone.calibration_dry is
    'Raw soil sensor reading taken with the soil properly dry. See calibration_wet.';

-- ---------------------------------------------------------------------------
-- 2. weather_daily: the remaining FAO-56 Penman-Monteith (Eq. 6) inputs.
--
--    All nullable and all additive. humidity_mean and source already exist from
--    0016 and are untouched: humidity_mean is the daily MEAN relative humidity,
--    which Eq. 19 can use, while rh_min_pct/rh_max_pct feed the better Eq. 17.
--
--    WHY A WIND HEIGHT COLUMN: FAO-56 Eq. 6 is defined for wind at 2 m, and
--    Open-Meteo reports wind at 10 m. Eq. 47 converts between them, but only if
--    the height the figure was measured at travels with it. Storing the height
--    rather than hard-coding 10 means a second provider later cannot silently
--    skew every ETo figure.
-- ---------------------------------------------------------------------------
alter table weather_daily
    add column if not exists rh_min_pct     real,
    add column if not exists rh_max_pct     real,
    add column if not exists wind_ms        real,
    add column if not exists wind_height_m  real,
    add column if not exists eto_mm         real,
    add column if not exists eto_source     text,
    add column if not exists rs_source      text;

comment on column weather_daily.rh_min_pct is
    'Daily minimum relative humidity, %, as returned by the weather provider. Feeds FAO-56 Eq. 17 with rh_max_pct. NULL falls back to humidity_mean (Eq. 19), then to an estimate from the temperatures (Eq. 64).';

comment on column weather_daily.rh_max_pct is
    'Daily maximum relative humidity, %. See rh_min_pct.';

comment on column weather_daily.wind_ms is
    'Daily wind speed in metres per second, at the height recorded in wind_height_m - stored as the provider returned it, not pre-converted. NULL means FAO-56 Table 15''s general default of 2 m/s is used and the day is marked as having a defaulted input.';

comment on column weather_daily.wind_height_m is
    'The height above ground wind_ms was measured at, in metres. Open-Meteo reports wind at 10 m; FAO-56 Eq. 6 needs it at 2 m, converted with Eq. 47.';

comment on column weather_daily.eto_mm is
    'Reference evapotranspiration for this farm-day, mm, from FAO-56 Eq. 6 (Penman-Monteith). Derived - never raw - and recalculable from the other columns on this row plus farm.latitude.';

comment on column weather_daily.eto_source is
    'Which inputs the eto_mm figure rested on: weather_app, weather_app_forecast, dht11_fallback, or none when the day had no usable temperature. Note the provider is Open-Meteo, not OpenWeatherMap.';

comment on column weather_daily.rs_source is
    'Where the solar radiation used for eto_mm came from. Always ''estimated'' today: AgroFlow has no sunlight sensor, so Rs is derived from the daily temperature range with FAO-56 Eq. 50.';

-- ---------------------------------------------------------------------------
-- 3. dht_daily: daily DHT11 values per zone, calculated rather than stored.
--
--    Storing a second copy of these would mean two numbers that can disagree.
--    sensor_reading already holds the raw rows; this view aggregates them.
--
--    Days are grouped in Africa/Johannesburg, matching the report endpoints.
--    South Africa has no daylight saving, so the offset is a fixed UTC+2.
--
--    IMPORTANT: as of this migration nothing writes 'Temperature' or 'Humidity'
--    rows. The ESP32 firmware reports SoilMoisture only (see
--    hardware/esp32/AgroFlowIrrigationNode: "No temperature/humidity sensor is
--    wired on this board"). The sensor_reading CHECK constraint from 0002
--    already allows both types, so this view starts empty and fills itself the
--    day a DHT11 is wired and the firmware reports it. That is why the engine's
--    DHT11 path is a fallback and never a requirement.
-- ---------------------------------------------------------------------------
drop view if exists dht_daily;

create view dht_daily
with (security_invoker = true)
as
select
    z.id                                                       as zone_id,
    z.farm_id                                                  as farm_id,
    (r.recorded_at at time zone 'Africa/Johannesburg')::date    as day,
    max(r.value) filter (where r.sensor_type = 'Temperature')   as tmax_c,
    min(r.value) filter (where r.sensor_type = 'Temperature')   as tmin_c,
    avg(r.value) filter (where r.sensor_type = 'Humidity')      as rh_mean_pct,
    count(*)     filter (where r.sensor_type = 'Temperature')   as temperature_reading_count,
    count(*)     filter (where r.sensor_type = 'Humidity')      as humidity_reading_count
from sensor_reading r
join zone z on z.id = r.zone_id
where r.sensor_type in ('Temperature', 'Humidity')
group by z.id, z.farm_id, (r.recorded_at at time zone 'Africa/Johannesburg')::date;

comment on view dht_daily is
    'Daily DHT11 maximum/minimum temperature and mean humidity per zone, grouped by Africa/Johannesburg calendar day, calculated from sensor_reading rather than stored. Used only as an ETo fallback when the weather app has no row for a day, and for the weather-comparison report. security_invoker = true so the reader''s own RLS on sensor_reading applies.';

grant select on dht_daily to authenticated;

-- ---------------------------------------------------------------------------
-- 4. zone_water_balance: one row per zone per day.
--
--    This is the engine's running record of how dry each zone's root zone is.
--    Every column is derived and recalculable from sensor_reading,
--    weather_daily, irrigation_event and the FAO-56 tables - nothing here is
--    raw data, and nothing here overwrites raw data.
-- ---------------------------------------------------------------------------
create table if not exists zone_water_balance (
    id              bigint generated always as identity primary key,
    zone_id         bigint not null references zone (id) on delete cascade,

    -- Calendar day in Africa/Johannesburg.
    day             date not null,

    -- Days since planting, 1 on the planting date itself.
    day_of_season   integer,

    -- Farmer-facing stage name: Establishing / Growing / Peak growth /
    -- Nearing harvest / Season complete.
    stage           text,

    kc              numeric,  -- FAO-56 Eq. 66
    etc_mm          numeric,  -- FAO-56 Eq. 58, Kc x ETo
    p               numeric,  -- depletion fraction, adjusted for ETc and soil
    taw_mm          numeric,  -- FAO-56 Eq. 82
    raw_mm          numeric,  -- FAO-56 Eq. 83
    rain_mm         numeric,
    irrigation_mm   numeric,
    dr_end_mm       numeric,  -- FAO-56 Eq. 85, depletion at end of day
    ks              numeric,  -- FAO-56 Eq. 84, 1.0 when unstressed

    -- true when any input that day was defaulted, estimated or fell back to the
    -- zone's own sensor, so a report can mark the day rather than present it as
    -- fully measured.
    incomplete      boolean not null default false,

    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now()
);

create unique index if not exists uq_zone_water_balance_zone_day
    on zone_water_balance (zone_id, day);

create index if not exists idx_zone_water_balance_zone_day_desc
    on zone_water_balance (zone_id, day desc);

drop trigger if exists trg_zone_water_balance_updated_at on zone_water_balance;
create trigger trg_zone_water_balance_updated_at
    before update on zone_water_balance
    for each row execute function set_updated_at();

comment on table zone_water_balance is
    'FAO-56 root-zone water balance, one row per zone per Africa/Johannesburg day. Entirely derived: recomputable from sensor_reading, weather_daily, irrigation_event and the FAO-56 tables. dr_end_mm is how many mm short of full the root zone was at the end of that day (Eq. 85); watering is due when it reaches raw_mm (Eq. 83).';

comment on column zone_water_balance.incomplete is
    'true when an input that day was defaulted, estimated, or taken from the zone''s own sensor instead of the weather app. Reports mark these days rather than presenting them as fully measured.';

comment on column zone_water_balance.ks is
    'FAO-56 Eq. 84 water stress coefficient. 1.0 means the crop drew water freely; below 1.0 means the soil was drier than the crop can comfortably draw from and growth was being held back that day.';

-- ---------------------------------------------------------------------------
-- 5. ai_recommendation: carry insights.
--
--    The table already exists from 0003 with recommendation_id / zone_id /
--    message / priority / estimated_water / created_at. Columns are ADDED, not
--    replaced: `priority` is left in place and untouched so anything already
--    reading it keeps working.
--
--    BR 6.9: no foreign key to irrigation_commands, and none is added here.
--    Insights are advisory only - nothing in this table can cause a pump to run.
-- ---------------------------------------------------------------------------
alter table ai_recommendation
    add column if not exists insight_type  text,
    add column if not exists severity      text,
    add column if not exists data          jsonb,
    add column if not exists valid_for     date,
    add column if not exists dismissed_at  timestamptz;

alter table ai_recommendation drop constraint if exists ai_recommendation_severity_check;
alter table ai_recommendation
    add constraint ai_recommendation_severity_check
    check (severity is null or severity in ('act_now', 'heads_up', 'info'));

-- One row per zone, per insight type, per day (spec section 7). Partial, because
-- rows predating this migration have no insight_type or valid_for.
create unique index if not exists uq_ai_recommendation_zone_type_day
    on ai_recommendation (zone_id, insight_type, valid_for)
    where insight_type is not null and valid_for is not null;

create index if not exists idx_ai_recommendation_zone_valid_for
    on ai_recommendation (zone_id, valid_for desc);

comment on column ai_recommendation.insight_type is
    'Which rule produced this row, e.g. water_now, water_soon, setup_missing, dht_offline. One row per zone per type per valid_for day.';

comment on column ai_recommendation.severity is
    'act_now (do something today), heads_up (worth knowing), or info. Drives ordering in the app.';

comment on column ai_recommendation.data is
    'The raw numbers behind the message and where each came from, so a report can show provenance that the farmer-facing message deliberately leaves out.';

comment on column ai_recommendation.valid_for is
    'The Africa/Johannesburg day this insight describes. Insights are not carried forward: a new day gets new rows.';

comment on column ai_recommendation.dismissed_at is
    'When the farmer tapped the insight away. The only column a farmer may update.';

-- ---------------------------------------------------------------------------
-- 6. Security.
--
--    Reads go through app_can_access_farm() via zone -> farm, exactly as 0011
--    does for ai_recommendation. Writes are service_role only: AgroFlow.Api
--    connects as the table owner and so bypasses RLS, which is how the engine
--    writes rows without a write policy. No client write grant is issued.
--
--    The one exception is ai_recommendation.dismissed_at, which farmers must be
--    able to set. That is granted as a COLUMN-level UPDATE, so a farmer cannot
--    rewrite an insight's message or severity.
-- ---------------------------------------------------------------------------
alter table zone_water_balance enable row level security;

grant select on zone_water_balance to authenticated;

drop policy if exists zone_water_balance_select_member on zone_water_balance;
create policy zone_water_balance_select_member
    on zone_water_balance
    for select
    to authenticated
    using (exists (
        select 1 from zone z
        where z.id = zone_water_balance.zone_id
          and app_can_access_farm(z.farm_id)));

drop policy if exists zone_water_balance_all_admin on zone_water_balance;
create policy zone_water_balance_all_admin
    on zone_water_balance
    for all
    to authenticated
    using (app_is_admin())
    with check (app_is_admin());

-- ai_recommendation already has select + admin policies from 0011. Add only the
-- farmer's ability to dismiss.
grant update (dismissed_at) on ai_recommendation to authenticated;

drop policy if exists ai_recommendation_dismiss_member on ai_recommendation;
create policy ai_recommendation_dismiss_member
    on ai_recommendation
    for update
    to authenticated
    using (exists (
        select 1 from zone z
        where z.id = ai_recommendation.zone_id
          and app_can_access_farm(z.farm_id)))
    with check (exists (
        select 1 from zone z
        where z.id = ai_recommendation.zone_id
          and app_can_access_farm(z.farm_id)));

-- ---------------------------------------------------------------------------
-- 7. report_daily_weather: weather app beside the tub sensor, for the
--    schedule report's "Weather: area vs tub" table (spec section 9c).
--
--    Observed weather days only - a forecast row has nothing to compare a
--    measured tub reading against. Difference columns are DHT11 minus weather
--    app, and are null rather than zero when either side is missing, so a
--    missing sensor never reads as perfect agreement.
-- ---------------------------------------------------------------------------
drop view if exists report_daily_weather;

create view report_daily_weather
with (security_invoker = true)
as
select
    w.farm_id                                   as farm_id,
    w.date                                      as day,

    -- Weather app, for the area.
    w.tmin_c                                    as app_tmin_c,
    w.tmax_c                                    as app_tmax_c,
    w.rh_min_pct                                as app_rh_min_pct,
    w.rh_max_pct                                as app_rh_max_pct,
    w.humidity_mean                             as app_rh_mean_pct,
    w.wind_ms                                   as app_wind_ms,
    w.wind_height_m                             as app_wind_height_m,
    w.precipitation_mm                          as app_rain_mm,
    w.eto_mm                                    as eto_mm,
    w.eto_source                                as eto_source,
    w.rs_source                                 as rs_source,

    -- DHT11, at the plants. Averaged across the farm's zones, since a farm can
    -- have more than one board.
    avg(d.tmin_c)                               as dht_tmin_c,
    avg(d.tmax_c)                               as dht_tmax_c,
    avg(d.rh_mean_pct)                          as dht_rh_mean_pct,
    count(d.zone_id)                            as dht_zone_count,

    -- Difference: tub minus area.
    avg(d.tmin_c) - w.tmin_c                    as diff_tmin_c,
    avg(d.tmax_c) - w.tmax_c                    as diff_tmax_c,
    avg(d.rh_mean_pct) - w.humidity_mean        as diff_rh_mean_pct
from weather_daily w
left join dht_daily d
       on d.farm_id = w.farm_id
      and d.day = w.date
where w.is_forecast = false
group by
    w.farm_id, w.date, w.tmin_c, w.tmax_c, w.rh_min_pct, w.rh_max_pct,
    w.humidity_mean, w.wind_ms, w.wind_height_m, w.precipitation_mm,
    w.eto_mm, w.eto_source, w.rs_source;

comment on view report_daily_weather is
    'Observed weather-app days beside the DHT11 readings from inside the tub, with the difference between them, for the schedule report. The weather app describes the area; the DHT11 sits at the plants, so differences are expected and are not an error. Difference columns are NULL, never zero, when either side is missing. security_invoker = true.';

grant select on report_daily_weather to authenticated;

-- ---------------------------------------------------------------------------
-- 8. What is deliberately NOT in this migration.
--
--    * Luba's service_request.crop_type CHECK is NOT narrowed to the engine's
--      crop keys. Doing that safely needs
--          select crop_type, count(*) from service_request group by 1;
--      against live to prove no existing row would be rejected, and live is
--      read-only for this piece of work. Her list also holds two crops
--      (citrus, leafy_veg) that DO have FAO-56-sourced values in
--      AgroFlow.Domain/Agronomy/fao56-crop-knowledge.json, so narrowing would
--      throw away sourced work. See docs/fao56-engine-report.md.
--
--    * service_request.request_type is NOT extended with 'maintenance'. Her
--      crop_type and farmer_id columns are both NOT NULL, so a
--      system-generated maintenance row would have to invent a crop and a
--      farmer. Spec section 8b's own fallback applies: the DHT11 fault logs an
--      `alert` row instead. Her table and her admin page are untouched.
-- ---------------------------------------------------------------------------
