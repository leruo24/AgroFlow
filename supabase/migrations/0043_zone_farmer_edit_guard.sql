-- A farmer may change only the crop, planting date, soil and size of a zone
-- on their own farm (item 6b).
--
-- WHY A TRIGGER
-- The zone update policy (zone_update_assigned_farm) already limits a farmer
-- to zones on farms they belong to - "their own zones". It cannot limit WHICH
-- COLUMNS they change: through the Supabase REST API a farmer's token could
-- set any column, including the watering thresholds, the calibration points
-- or the kit's identity. Thresholds are meant to change only through "Use
-- these settings" / "Reset to recommended", which the API works out from the
-- RuleBook.
--
-- WHO IT DOES NOT TOUCH
-- - AgroFlow.Api connects as the table owner with no JWT, so auth.uid() is
--   null and every API write (settings, reset, calibration, device routes)
--   passes unchanged.
-- - Admins pass unchanged.
-- Neither app writes zone rows directly today; this closes the door for a
-- hand-made request.
--
-- Additive and idempotent: safe to re-run. The function body is single-quoted
-- (no dollar quoting), as in 0036.

create or replace function zone_farmer_edit_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as '
begin
    if auth.uid() is null then
        return new;
    end if;

    if exists (select 1 from profile p where p.id = auth.uid() and p.role = ''admin'') then
        return new;
    end if;

    if (to_jsonb(new) - array[''crop_type'', ''planting_date'', ''soil_type'', ''area_m2'', ''size_value'', ''size_unit'', ''updated_at''])
       is distinct from
       (to_jsonb(old) - array[''crop_type'', ''planting_date'', ''soil_type'', ''area_m2'', ''size_value'', ''size_unit'', ''updated_at''])
    then
        raise exception ''A farmer can change only the crop, planting date, soil and size of a zone.''
            using errcode = ''42501'';
    end if;

    return new;
end;
';

comment on function zone_farmer_edit_guard() is
    'Item 6b: a farmer''s own JWT may change only crop_type, planting_date, soil_type, area_m2, size_value, size_unit on zone. The API (no JWT) and admins are not limited.';

drop trigger if exists zone_farmer_edit_guard on zone;
create trigger zone_farmer_edit_guard
    before update on zone
    for each row
    execute function zone_farmer_edit_guard();
