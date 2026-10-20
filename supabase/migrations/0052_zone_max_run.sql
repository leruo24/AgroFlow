-- Each zone gets a maximum run time (docs/irrigate-path.md).
--
-- Every run used to stop at a fixed 5 minutes, the firmware's own cap. A bigger pump or a
-- larger zone needs longer runs, so the limit is now per zone:
--   zone.max_run_minutes: default 5, staff set 1 to 120 in the admin site (through the API).
-- The API refuses a manual run longer than the zone's maximum, sends the maximum to the kit
-- with every command (maxRunSeconds), and the kit runs min(requested, maximum).
-- Farmers cannot change it: zone_farmer_edit_guard (0043) lets a farmer's own login change
-- only crop, planting date, soil and size. Clients keep their existing read access (0011).
-- Safe to run more than once.

alter table zone
    add column if not exists max_run_minutes integer not null default 5;

do $guard$
begin
    if not exists (select 1 from pg_constraint
                   where conrelid = 'public.zone'::regclass and conname = 'zone_max_run_minutes_check') then
        alter table zone
            add constraint zone_max_run_minutes_check check (max_run_minutes between 1 and 120);
    end if;
end $guard$;

comment on column zone.max_run_minutes is
    'Longest single pump run for this zone, in minutes (1 to 120, default 5). Sent to the kit with every command; the kit stops at min(requested, this).';
