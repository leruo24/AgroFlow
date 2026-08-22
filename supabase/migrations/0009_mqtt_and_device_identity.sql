-- Device identity moves from WiFi MAC (WiFi.macAddress()) to the ESP32's
-- true unique hardware ID (ESP.getEfuseMac(), burned into the chip - stable
-- regardless of network interface). Same column, renamed to reflect what it
-- actually holds now; nothing else references the old name outside
-- AgroFlow.Api and the firmware, both updated alongside this migration.
--
-- Also adds the pg_notify trigger the backend's Postgres LISTEN/NOTIFY bridge
-- (IrrigationCommandNotifyService) listens on to publish new commands to
-- MQTT - see the summary this shipped with for why LISTEN/NOTIFY was chosen
-- over Supabase Realtime or polling.

alter table hardware
    rename column mac_address to device_id;

alter table hardware
    rename constraint hardware_mac_address_key to hardware_device_id_key;

-- Note: no schema change was needed to confirm "many hardware rows per
-- farm_id" - hardware.zone_id was always a plain indexed FK with no
-- uniqueness constraint, and zone.farm_id likewise. Multiple hardware rows
-- per zone (and therefore per farm) were already unconstrained.

create or replace function notify_irrigation_command()
returns trigger
language plpgsql
as $$
begin
    perform pg_notify(
        'irrigation_commands_channel',
        json_build_object(
            'id', new.id,
            'zoneId', new.zone_id,
            'command', new.command,
            'durationSeconds', new.duration_seconds,
            'source', new.source
        )::text
    );
    return new;
end;
$$;

-- Fires regardless of which of the three current write paths inserted the
-- row (the app's direct Supabase insert for manual commands, AgroFlow.Api's
-- auto-irrigation insert, or the fire_due_irrigation_schedules() pg_cron
-- job) - a table-level trigger catches all of them uniformly, which a
-- publish call added to only the C# code paths would not.
create trigger trg_irrigation_commands_notify
    after insert on irrigation_commands
    for each row execute function notify_irrigation_command();
