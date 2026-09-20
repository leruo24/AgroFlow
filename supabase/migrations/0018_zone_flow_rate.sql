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
