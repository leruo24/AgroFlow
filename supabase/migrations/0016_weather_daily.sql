-- weather_daily: the table nothing in AgroFlow has today.
--
-- WHY A NEW TABLE RATHER THAN REUSING `weather`
-- ---------------------------------------------
-- `weather` (0003_csharp_domain.sql) is a point-in-time OBSERVATION table
-- shaped from the C# class diagram: temperature / humidity / pressure /
-- wind_speed / weather_conditions / recorded_at, one row per reading, no
-- notion of a day and no notion of a forecast. It is also, right now, empty -
-- nothing writes to it.
--
-- What the FAO-56 ET0 calculation needs is different in kind: one row per
-- FARM per DAY carrying that day's minimum and maximum air temperature and
-- its rainfall total, where a row starts life as a forecast and is later
-- overwritten by the actuals for the same date. Bolting a date, a
-- tmin/tmax pair and an is_forecast flag onto `weather` would leave a table
-- that is two different things at once, with half its columns null in each
-- mode. This is a separate concern, so it gets a separate table.
--
-- `weather` is deliberately left completely untouched by this migration.
--
-- Run this in the Supabase SQL editor. Idempotent - safe to re-run.

-- ---------------------------------------------------------------------------
-- 1. The table.
--
--    NOTE ON THE FOREIGN KEY: farm's primary key is `farm_id`, not `id`
--    (see 0001_foundation.sql) - the same shape 0003's weather/report/
--    maintenance tables reference. Getting this wrong is an easy mistake
--    because zone/sensor_reading/irrigation_event all key on `id`.
-- ---------------------------------------------------------------------------
create table if not exists weather_daily (
    id                bigint generated always as identity primary key,
    farm_id           bigint not null references farm (farm_id) on delete cascade,

    -- The calendar day this row describes, in the farm's local sense of the
    -- day. Open-Meteo returns daily aggregates keyed by local date when a
    -- timezone is requested, which is what the collector asks for.
    date              date not null,

    tmin_c            real,
    tmax_c            real,
    precipitation_mm  real,

    -- Mean relative humidity for the day. Collected because it is free from
    -- the same Open-Meteo call and is worth having for display, NOT because
    -- ET0 uses it: Hargreaves (FAO-56 Eq. 52) takes only tmin/tmax and
    -- latitude. Nullable - the archive endpoint does not always return it.
    humidity_mean     real,

    -- true while this row is a prediction. The collector overwrites the same
    -- (farm_id, date) row with is_forecast = false once that day has passed
    -- and real observations exist, so history converges on actuals.
    is_forecast       boolean not null default false,

    -- When this row was last written, as opposed to which day it describes.
    -- Lets an operator see whether the collector is actually running without
    -- reading logs.
    fetched_at        timestamptz not null default now(),

    -- Provenance of the numbers, e.g. 'open-meteo-forecast' /
    -- 'open-meteo-archive'. Kept as free text rather than an enum so adding a
    -- second provider later does not need a migration.
    source            text not null default 'open-meteo'
);

-- ---------------------------------------------------------------------------
-- 2. The upsert key. This is the point of the whole design: the collector
--    writes with
--
--        on conflict (farm_id, date) do update set ...
--
--    so re-running it is harmless, a forecast row for Thursday is replaced by
--    a better forecast each cycle, and is finally replaced by Thursday's
--    actuals once Thursday is in the past. Without this constraint the table
--    would accumulate one row per farm per day per fetch.
-- ---------------------------------------------------------------------------
create unique index if not exists uq_weather_daily_farm_date
    on weather_daily (farm_id, date);

-- Supports the advisor's "latest actuals + next 7 days for this farm" read.
create index if not exists idx_weather_daily_farm_date_desc
    on weather_daily (farm_id, date desc);

-- ---------------------------------------------------------------------------
-- 3. RLS, consistent with 0011_row_level_security.sql.
--
--    ENABLE, never FORCE - AgroFlow.Api connects as `postgres`, owns this
--    table, and therefore bypasses these policies, which is how the weather
--    collector writes rows without needing a write policy of its own. See
--    0011's header for the full reasoning.
--
--    Farm users get SELECT via app_can_access_farm(farm_id), matching exactly
--    what 0011 does for `weather`. Admins get the usual blanket policy.
--
--    NO CLIENT WRITE GRANT, deliberately: nothing in the mobile app or the
--    admin dashboard should be able to write weather rows. The only writer is
--    the collector inside AgroFlow.Api. farm_id is NOT NULL here (unlike
--    0003's weather table where it is nullable), so there is no
--    "farm_id is not null and ..." guard to write - every row belongs to a
--    farm.
-- ---------------------------------------------------------------------------
alter table weather_daily enable row level security;

grant select on weather_daily to authenticated;

do $$
begin
    begin
        create policy weather_daily_select_member on weather_daily
            for select to authenticated
            using (app_can_access_farm(farm_id));
    exception when duplicate_object then null; end;

    begin
        create policy weather_daily_all_admin on weather_daily
            for all to authenticated
            using (app_is_admin()) with check (app_is_admin());
    exception when duplicate_object then null; end;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Documentation that travels with the database rather than with the repo.
-- ---------------------------------------------------------------------------
comment on table weather_daily is
    'One row per farm per calendar day: tmin/tmax/rainfall used to compute FAO-56 reference evapotranspiration (ET0, Hargreaves Eq. 52). Written only by AgroFlow.Api''s WeatherCollectionService from Open-Meteo. Forecast rows are overwritten by actuals via the (farm_id, date) upsert key.';

comment on column weather_daily.is_forecast is
    'true while this row is a prediction; set false when overwritten with observed values for a past date.';

comment on column weather_daily.humidity_mean is
    'Collected for display only. FAO-56 Eq. 52 (Hargreaves) does not use humidity - it takes tmin, tmax and latitude.';

comment on column weather_daily.source is
    'Which upstream produced these numbers, e.g. open-meteo-forecast or open-meteo-archive.';
