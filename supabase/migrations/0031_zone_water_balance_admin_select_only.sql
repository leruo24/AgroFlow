-- Narrow zone_water_balance_all_admin from FOR ALL to FOR SELECT.
--
-- WHY
-- ---
-- 0027_fao56_engine.sql gave admins `for all` on zone_water_balance, matching
-- the blanket admin policy 0011 uses on every other table. On this table that
-- is wrong, and differently wrong from the others.
--
-- zone_water_balance is not farm data an admin curates. It is DERIVED state:
-- every row is computed by the FAO-56 engine from weather, crop coefficients,
-- soil type and the zone's own readings, and recomputed on each pass. An admin
-- UPDATE here does not correct anything - it is silently overwritten by the
-- next run, and in the window before that it makes the engine's own inputs
-- disagree with its outputs, producing watering advice that cannot be traced
-- back to any observation. A DELETE loses the running depletion balance for
-- that zone, which cannot be reconstructed from the current readings alone.
--
-- Nothing has ever used the write half: the engine writes as `postgres`
-- (AgroFlow.Business.Fao56EngineController, via the Supabase connection
-- string) and so bypasses RLS entirely, and no admin screen writes to this
-- table. So this removes an unused capability, not a working one.
--
-- Admins keep full read access, which is what the admin dashboard actually
-- needs - and the farmer-facing select policy from 0027 is untouched.
--
-- Idempotent: drop-then-create, like 0027 itself does.

drop policy if exists zone_water_balance_all_admin on zone_water_balance;

-- Kept under the same name. It is referenced by name in 0027 and in the
-- engine report, and renaming it would make the two files look like they
-- describe different policies. The `_all_` in the name now reads as "all
-- rows", which is what it still grants - every row, read-only.
create policy zone_water_balance_all_admin
    on zone_water_balance
    for select
    to authenticated
    using (app_is_admin());

comment on policy zone_water_balance_all_admin on zone_water_balance is
    'Admins read every zone''s water balance. SELECT-only on purpose: these rows are derived by the FAO-56 engine and an admin write would be overwritten by the next pass (0031).';
