-- One source of truth for water volume: zone.flow_rate_lpm.
--
-- Background. Until now three different places could turn a pump runtime into
-- litres, and they disagreed:
--
--   * the firmware's PUMP_FLOW_LPS  = 0.05 L/s  = 3.0 L/min  (a placeholder)
--   * IrrigationLog.RatedFlowLitresPerSecond = 0.05 L/s = 3.0 L/min (flagged
--     in the code as an unverified placeholder)
--   * zone.flow_rate_lpm (migration 0018), per zone, nullable, no default
--
-- The real test pump has since been measured with a bucket and a stopwatch:
-- 500 ml in 20 seconds = 1.5 L/min. Both hardcoded constants were therefore
-- WRONG BY A FACTOR OF TWO, and both have been removed. The firmware now
-- reports runtime only and AgroFlow.Api derives litres from the column below.
--
-- Run this in the Supabase SQL editor. Idempotent - safe to re-run.

-- ---------------------------------------------------------------------------
-- 1. Default new zones to the measured test-pump rate.
--
--    NOTE, because this reverses 0018's stated reasoning. 0018 deliberately
--    gave this column NO default, on the grounds that a zone nobody had
--    configured should yield "no estimate" rather than a confident number from
--    a made-up rate. That argument was about a MADE-UP rate. 1.5 is measured,
--    not invented, so a new zone on the current test rig now starts out
--    correct instead of starting out silent.
--
--    The caveat 0018 was protecting against has not disappeared: a zone whose
--    emitters, line size or head differ from the test rig will inherit 1.5 and
--    be confidently wrong rather than honestly null. Anyone adding a zone on
--    different hardware must set its real rate. The estimate is still only as
--    good as the number in this column.
-- ---------------------------------------------------------------------------
alter table zone
    alter column flow_rate_lpm set default 1.5;

comment on column zone.flow_rate_lpm is
    'Nominal irrigation delivery rate for this zone, litres per minute. THE single source of truth for water volume: AgroFlow.Api computes litres = runtime_seconds / 60 * flow_rate_lpm. No flow meter exists, so any figure derived from this column is an ESTIMATE and must be labelled as one. Defaults to 1.5, the measured test pump (500 ml in 20 s); set the real rate for any zone on different hardware. Null means no estimate can be made, which is correct, rather than guessing a rate.';

-- ---------------------------------------------------------------------------
-- 2. Let "no estimate" be representable.
--
--    estimated_litres has been NOT NULL DEFAULT 0 since 0002 (as
--    volume_litres) - fine when the device always sent a number, wrong now
--    that the server derives it and can legitimately have no answer. A zone
--    with no flow_rate_lpm must record NULL, not 0: zero reads as "this cycle
--    delivered no water", which is a different and false claim.
--
--    Existing rows are untouched - they keep whatever value they have.
-- ---------------------------------------------------------------------------
alter table irrigation_event
    alter column estimated_litres drop not null;

alter table irrigation_event
    alter column estimated_litres drop default;

comment on column irrigation_event.estimated_litres is
    'ESTIMATED water volume, derived server-side as runtime_seconds / 60 * zone.flow_rate_lpm. Never measured - no flow meter exists anywhere in AgroFlow. NULL means the zone had no flow_rate_lpm configured, so no estimate could be made; it does not mean zero water was delivered.';
