-- zone.flow_rate_lpm: the per-zone nominal flow rate used to turn pump
-- runtime into an estimated water volume.
--
-- THERE IS NO FLOW METER ON ANY AGROFLOW NODE and none is planned. Water
-- volume is therefore inferred, not measured:
--
--     litres = runtime_seconds / 60 * flow_rate_lpm
--
-- The value is per zone because zones differ in emitter count, line size and
-- head. It is nullable with NO DEFAULT, deliberately: a zone whose flow rate
-- nobody has entered must yield "no estimate available" rather than a
-- confident number derived from a made-up rate. WaterUsageEstimator returns
-- null in exactly that case, the same way an unset moisture_threshold never
-- falls back to a guessed default and silently starts a pump.
--
-- Anything rendering a figure derived from this column must label it an
-- estimate. It is not a measurement and it is not a billing figure: real
-- delivery drifts with pump wear, line pressure and emitter clogging, none of
-- which this system observes.
--
-- Run this in the Supabase SQL editor. Idempotent - safe to re-run.

alter table zone
    add column if not exists flow_rate_lpm real
        check (flow_rate_lpm is null or flow_rate_lpm > 0);

comment on column zone.flow_rate_lpm is
    'Nominal irrigation delivery rate for this zone, litres per minute. Used to ESTIMATE water volume as runtime_seconds/60 * flow_rate_lpm - no flow meter exists, so any figure derived from this column must be presented as an estimate. Nullable with no default: null means no estimate can be made, which is correct, rather than guessing a rate.';

-- ---------------------------------------------------------------------------
-- zone_water_usage_daily: per-zone, per-day water totals.
--
-- zone.water_used_total is a single running number that only ever goes up -
-- useful for "how much has this zone ever used", useless for "how much did it
-- use last Tuesday", for a week-on-week comparison, or for spotting the day a
-- valve stuck open. Those all need the event rows aggregated by day, which is
-- what this view does.
--
-- A VIEW, not a materialised view or a summary table, deliberately:
-- irrigation_event is small (one row per irrigation cycle per zone - tens per
-- zone per day at the very most) and idx_irrigation_event_zone_started_at
-- from migration 0005 already covers the grouping. There is no volume here
-- that justifies a refresh job and the staleness that comes with one.
--
-- Grouped on started_at (when the irrigation actually ran), NOT on the row's
-- insert time. Those differ by as much as the offline buffer holds: the ESP32
-- buffers events to flash while offline and flushes them on reconnect, so an
-- event inserted this morning may belong to Sunday. That distinction was the
-- whole point of 0005's note about started_at.
--
-- EVERY LITRE FIGURE HERE IS AN ESTIMATE. No flow meter exists anywhere in
-- AgroFlow; litres are inferred from runtime and flow_rate_lpm. The column is
-- named estimated_litres_total rather than litres_total so that nothing
-- downstream can render it as a measurement by accident.
-- ---------------------------------------------------------------------------
create or replace view zone_water_usage_daily as
select
    e.zone_id,
    z.farm_id,
    (e.started_at at time zone 'UTC')::date as usage_date,
    count(*)                                 as event_count,
    sum(e.runtime_seconds)                   as runtime_seconds_total,
    sum(e.estimated_litres)                  as estimated_litres_total,
    min(e.started_at)                        as first_event_at,
    max(e.started_at)                        as last_event_at
from irrigation_event e
join zone z on z.id = e.zone_id
group by e.zone_id, z.farm_id, (e.started_at at time zone 'UTC')::date;

-- security_invoker so the view is evaluated as the querying user and cannot
-- be used to read around irrigation_event's RLS policies - the same treatment
-- 0011 applied to the two zone_* views. Without this a farmer could read
-- every farm's water usage through the view.
alter view zone_water_usage_daily set (security_invoker = true);

grant select on zone_water_usage_daily to authenticated;

comment on view zone_water_usage_daily is
    'Per-zone, per-day irrigation totals aggregated from irrigation_event, grouped on started_at (when irrigation ran) rather than insert time, because the ESP32 buffers events offline and flushes them later. estimated_litres_total is an ESTIMATE derived from runtime and zone.flow_rate_lpm - no flow meter exists.';
