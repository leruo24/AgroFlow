-- Which migrations have actually been applied?
--
-- ONE QUERY. ONE ROW. ONE COLUMN PER MIGRATION. READ-ONLY.
--
-- WHY THIS EXISTS
-- Migrations are applied by hand in the Supabase SQL editor, so "the code is
-- deployed" and "the schema is migrated" are two separate events and nothing
-- reconciles them. 0033 to 0036 were missed, nothing said so, and the first
-- anybody knew was a farmer's report failing with a bare 500 - the real cause,
-- `relation "report_request" does not exist`, being four layers down in a log
-- nobody was reading.
--
-- HOW TO READ THE RESULT
-- Every column should be 1. A 0 means that migration has not been applied, or
-- was applied partially. Columns are named for the migration and the thing
-- being checked, so a 0 tells you which file to run.
--
-- Each check is one cheap existence test, not a full verification. These files
-- are single statement batches: if one ran at all, it ran to the end. So one
-- well-chosen object per file catches a SKIPPED FILE, which is the failure
-- that actually happened.
--
-- Paste the whole thing into the Supabase SQL editor and run it. It writes
-- nothing. The API reports the same information for 0027 onwards under
-- "Database schema" in GET /api/admin/health, which is the easier place to
-- look day to day; this is the one that covers the whole history.
--
-- Note the gaps: 0014, 0015, 0022 and 0023 do not exist. They were never
-- written - the numbering has holes, which is not the same as a missing file.

select
    -- 0001: the foundation. profile, farm and zone.
    (select count(*) from pg_class where relname = 'profile' and relkind = 'r')          as m0001_profile,

    -- 0002: the relationships. sensor_reading, irrigation_event, farm_member.
    (select count(*) from pg_class where relname = 'sensor_reading' and relkind = 'r')   as m0002_sensor_reading,

    -- 0003: the C# domain tables. hardware, alert, maintenance, report.
    (select count(*) from pg_class where relname = 'hardware' and relkind = 'r')         as m0003_hardware,

    -- 0004: irrigation_commands, the queue the kits poll.
    (select count(*) from pg_class where relname = 'irrigation_commands' and relkind = 'r') as m0004_irrigation_commands,

    -- 0005: irrigation_commands.duration_seconds - how long a start runs for.
    (select count(*) from information_schema.columns
      where table_name = 'irrigation_commands' and column_name = 'duration_seconds')     as m0005_command_duration,

    -- 0006: the zone moisture thresholds the engine reads.
    (select count(*) from information_schema.columns
      where table_name = 'zone' and column_name = 'moisture_threshold')                  as m0006_moisture_threshold,

    -- 0007: moved the irrigation decision out of Postgres into the API. The
    -- check is INVERTED - this one passes when the trigger is GONE. A trigger
    -- still firing here would mean two things deciding to water the same zone.
    (select count(*) = 0 from pg_trigger
      where tgname = 'trg_sensor_reading_auto_irrigation')::int                          as m0007_trigger_removed,

    -- 0008: device enrollment. hardware.zone_id and the enrollment columns.
    (select count(*) from information_schema.columns
      where table_name = 'hardware' and column_name = 'enrollment_status')               as m0008_enrollment_status,

    -- 0009: the LISTEN/NOTIFY bridge the command dispatcher depends on.
    (select count(*) from pg_proc where proname = 'notify_irrigation_command')           as m0009_notify_function,

    -- 0010: the zone realignment - zone.name, and the schedule columns.
    (select count(*) from information_schema.columns
      where table_name = 'zone' and column_name = 'name')                                as m0010_zone_name,

    -- 0011: row-level security. app_is_admin() is what every admin policy calls.
    (select count(*) from pg_proc where proname = 'app_is_admin')                        as m0011_app_is_admin,

    -- 0012: profile.phone, which onboarding writes.
    (select count(*) from information_schema.columns
      where table_name = 'profile' and column_name = 'phone')                            as m0012_profile_phone,

    -- 0013: the trigger that creates a profile row for a new auth user.
    -- Without it, signing up produces an account with no profile at all.
    (select count(*) from pg_proc where proname = 'handle_new_auth_user')                as m0013_new_auth_user,

    -- 0016: weather_daily, which the FAO-56 engine and every forecast read.
    (select count(*) from pg_class where relname = 'weather_daily' and relkind = 'r')    as m0016_weather_daily,

    -- 0017: zone.planting_date. No planting date, no growth stage, no advice.
    (select count(*) from information_schema.columns
      where table_name = 'zone' and column_name = 'planting_date')                       as m0017_planting_date,

    -- 0018: zone.flow_rate_lpm. The only way litres are ever estimated.
    (select count(*) from information_schema.columns
      where table_name = 'zone' and column_name = 'flow_rate_lpm')                       as m0018_flow_rate,

    -- 0019: the partial index the command poller runs on every few seconds.
    (select count(*) from pg_class
      where relname = 'idx_irrigation_commands_pending_created' and relkind = 'i')       as m0019_pending_index,

    -- 0020: irrigation_event.estimated_litres made nullable, so an event with
    -- no flow rate records no volume rather than a false zero.
    (select count(*) from information_schema.columns
      where table_name = 'irrigation_event'
        and column_name = 'estimated_litres'
        and is_nullable = 'YES')                                                         as m0020_litres_nullable,

    -- 0021: service_request - the farmer's "please add a farm/zone".
    (select count(*) from pg_class where relname = 'service_request' and relkind = 'r')  as m0021_service_request,

    -- 0024: Telegram. No chat id, and a farmer receives nothing at all.
    (select count(*) from information_schema.columns
      where table_name = 'profile' and column_name = 'telegram_chat_id')                 as m0024_telegram_chat_id,

    -- 0025: what a Telegram code is for (link, password, onboarding).
    (select count(*) from information_schema.columns
      where table_name = 'telegram_onboarding_code' and column_name = 'purpose')         as m0025_code_purpose,

    -- 0026: notification_sent, the send-once ledger. Without it farmers get
    -- the same alert repeatedly.
    (select count(*) from pg_class where relname = 'notification_sent' and relkind = 'r') as m0026_notification_sent,

    -- 0027: the FAO-56 engine's stored water balance.
    (select count(*) from pg_class where relname = 'zone_water_balance' and relkind = 'r') as m0027_zone_water_balance,

    -- 0028: per-device tokens. Without this every kit shares the fleet key.
    (select count(*) from information_schema.columns
      where table_name = 'hardware' and column_name = 'device_token_hash')               as m0028_device_token,

    -- 0029: the MQTT credential pool new kits draw from.
    (select count(*) from pg_class where relname = 'mqtt_credential_pool' and relkind = 'r') as m0029_mqtt_pool,

    -- 0030: the setup commands. Not a table - a widened CHECK on
    -- irrigation_commands.command, so the probe reads the constraint itself.
    (select count(*) from pg_constraint
      where conname = 'irrigation_commands_command_check'
        and pg_get_constraintdef(oid) like '%change_wifi%')                              as m0030_setup_commands,

    -- 0031: admin-only select on the engine's water balance.
    (select count(*) from pg_policies
      where tablename = 'zone_water_balance'
        and policyname = 'zone_water_balance_all_admin')                                 as m0031_balance_policy,

    -- 0032: the per-request send-once ledger for farm request messages.
    (select count(*) from pg_class
      where relname = 'service_request_notification' and relkind = 'r')                   as m0032_request_notification,

    -- 0033: whether a farmer ever read an alert.
    (select count(*) from information_schema.columns
      where table_name = 'alert' and column_name = 'read_at')                            as m0033_alert_read_at,

    -- 0034: report_request. THIS IS THE ONE THAT CAUSED THE 500 - "Make me
    -- this report" in the app fails outright without it.
    (select count(*) from pg_class where relname = 'report_request' and relkind = 'r')   as m0034_report_request,

    -- 0035: report_schedule - the automatic weekly and monthly reports.
    (select count(*) from pg_class where relname = 'report_schedule' and relkind = 'r')  as m0035_report_schedule,

    -- 0036: archive_farm(). Archiving hides a farm and keeps every row.
    (select count(*) from pg_proc where proname = 'archive_farm')                        as m0036_archive_farm,

    -- 0037: admin_audit_log - who did what.
    (select count(*) from pg_class where relname = 'admin_audit_log' and relkind = 'r')  as m0037_audit_log,

    -- 0038: the grant that lets the API actually write those rows. Without
    -- it every admin action succeeds and the Activity page stays empty.
    (select has_table_privilege('service_role', 'public.admin_audit_log', 'INSERT'))::int as m0038_audit_insert_grant,

    -- 0039: explanation - what a Telegram "Why am I seeing this?" button
    -- points at. Without it messages go out with no button.
    (select count(*) from pg_class where relname = 'explanation' and relkind = 'r')      as m0039_explanation,

    -- 0040: report_schedule - daily, chosen weekday, per-zone PDFs, recipients.
    (select count(*) from information_schema.columns
      where table_name = 'report_schedule' and column_name = 'per_zone_pdf')               as m0040_report_schedule_extend,

    -- Not a migration, but applied by hand the same way and just as invisible
    -- when missed: the private bucket generated report PDFs are stored in.
    (select count(*) from storage.buckets where id = 'reports')                           as storage_reports_bucket;
