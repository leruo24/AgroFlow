-- Which migrations have actually taken effect?
--
-- ONE QUERY. ONE ROW PER MIGRATION. READ-ONLY.
--
-- WHY THIS EXISTS
-- Migrations are applied by hand in the Supabase SQL editor, so "the code is
-- deployed" and "the schema is migrated" are two separate events and nothing
-- reconciles them. 0033 to 0036 were once missed and only showed up as a failing
-- report. In October 2026 a subtler drift was found: some files had RUN but part
-- of them had not taken effect. 0010's `add column if not exists ... check (...)`
-- skipped its 'manual' check because the column already existed, its view rename
-- failed, 0007's auto_irrigation_check() survived and 0013's phone copy was
-- missing. So each row checks the thing that file was FOR, not just that it ran,
-- and checks several things where one file did several jobs.
--
-- HOW TO READ THE RESULT
-- applied = false means that migration's effect is missing. A false among trues
-- means part of a file did not take effect: the detail column says what was
-- checked (and for 0010, which part failed and the column types involved).
--
-- Paste the whole thing into the Supabase SQL editor and run it. It writes
-- nothing. GET /api/admin/health ("Database schema") reports 0027 onwards day to
-- day; this covers the whole history.
--
-- Gaps: 0014, 0015, 0022 and 0023 were never written.
-- Not a migration, but applied by hand too: the private 'reports' storage bucket
-- has its own row at the end.

with
c   as (select table_name t, column_name col, data_type dt, is_nullable nul
          from information_schema.columns where table_schema = 'public'),
rel as (select k.relname, k.relkind from pg_class k
          join pg_namespace n on n.oid = k.relnamespace where n.nspname = 'public'),
fn  as (select p.proname, p.oid from pg_proc p
          join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'),
m0010 as (
  select
    exists (select 1 from c where t = 'zone' and col = 'name') as zone_name,
    exists (select 1 from pg_constraint
             where conrelid = 'public.zone'::regclass and contype = 'c'
               and pg_get_constraintdef(oid) like '%irrigation_mode%'
               and pg_get_constraintdef(oid) like '%manual%') as mode_allows_manual,
    exists (select 1 from c where t = 'zone_latest_reading' and col = 'moisture_threshold') as view_renamed,
    (select dt from c where t = 'zone' and col = 'moisture_threshold') as zone_type,
    (select dt from c where t = 'zone_latest_reading' and col in ('moisture_threshold', 'moisture_dry_threshold')) as view_type
)
select num, name, applied, detail from (values
 ('0001','foundation', exists(select 1 from rel where relname='profile' and relkind='r') and exists(select 1 from rel where relname='farm' and relkind='r') and exists(select 1 from rel where relname='zone' and relkind='r'), 'profile, farm, zone'),
 ('0002','relationships', exists(select 1 from rel where relname='farm_member') and exists(select 1 from rel where relname='sensor_reading') and exists(select 1 from rel where relname='irrigation_event'), 'farm_member, sensor_reading, irrigation_event'),
 ('0003','csharp_domain', exists(select 1 from rel where relname='hardware') and exists(select 1 from rel where relname='alert') and exists(select 1 from rel where relname='zone_latest_reading' and relkind='v'), 'hardware, alert, zone_latest_reading view'),
 ('0004','irrigation_commands', exists(select 1 from rel where relname='irrigation_commands' and relkind='r'), 'irrigation_commands'),
 ('0005','irrigation_commands_duration', exists(select 1 from c where t='irrigation_commands' and col='duration_seconds'), 'irrigation_commands.duration_seconds'),
 ('0006','backend_irrigation_logic', exists(select 1 from c where t='irrigation_commands' and col='source') and exists(select 1 from rel where relname='zone_daily_water_usage' and relkind='v'), 'irrigation_commands.source, zone_daily_water_usage view'),
 ('0007','move_irrigation_logic_to_api', not exists(select 1 from fn where proname='auto_irrigation_check') and exists(select 1 from c where t='zone_latest_reading' and col in ('moisture_threshold','moisture_dry_threshold')), 'auto_irrigation_check() gone (0047 repairs); view carries thresholds'),
 ('0008','device_enrollment_and_onboarding', exists(select 1 from c where t='hardware' and col='enrollment_status'), 'hardware.enrollment_status'),
 ('0009','mqtt_and_device_identity', exists(select 1 from fn where proname='notify_irrigation_command'), 'notify_irrigation_command()'),
 ('0010','zone_schema_realignment', (select zone_name and mode_allows_manual and view_renamed from m0010),
        (select format('zone.name=%s, irrigation_mode allows manual=%s (0047 repairs), view renamed=%s, zone.moisture_threshold=%s, view column=%s',
                       zone_name, mode_allows_manual, view_renamed, zone_type, view_type) from m0010)),
 ('0011','row_level_security', exists(select 1 from fn where proname='app_is_admin'), 'app_is_admin()'),
 ('0012','profile_api_requirements', exists(select 1 from c where t='profile' and col='phone'), 'profile.phone'),
 ('0013','update_auth_profile_phone', exists(select 1 from fn where proname='handle_new_auth_user' and pg_get_functiondef(oid) like '%''phone''%'), 'handle_new_auth_user() copies phone (0047 repairs)'),
 ('0016','weather_daily', exists(select 1 from rel where relname='weather_daily' and relkind='r'), 'weather_daily'),
 ('0017','zone_planting_date', exists(select 1 from c where t='zone' and col='planting_date'), 'zone.planting_date'),
 ('0018','zone_flow_rate', exists(select 1 from c where t='zone' and col='flow_rate_lpm'), 'zone.flow_rate_lpm'),
 ('0019','irrigation_commands_pending_index', exists(select 1 from rel where relname='idx_irrigation_commands_pending_created' and relkind='i'), 'idx_irrigation_commands_pending_created'),
 ('0020','flow_rate_default_and_nullable_litres', exists(select 1 from c where t='irrigation_event' and col='estimated_litres' and nul='YES'), 'irrigation_event.estimated_litres nullable'),
 ('0021','service_requests', exists(select 1 from rel where relname='service_request' and relkind='r'), 'service_request'),
 ('0024','telegram_onboarding', exists(select 1 from c where t='profile' and col='telegram_chat_id'), 'profile.telegram_chat_id'),
 ('0025','telegram_code_purpose', exists(select 1 from c where t='telegram_onboarding_code' and col='purpose'), 'telegram_onboarding_code.purpose'),
 ('0026','notification_dedupe', exists(select 1 from rel where relname='notification_sent' and relkind='r'), 'notification_sent'),
 ('0027','fao56_engine', exists(select 1 from rel where relname='zone_water_balance' and relkind='r'), 'zone_water_balance'),
 ('0028','device_token', exists(select 1 from c where t='hardware' and col='device_token_hash'), 'hardware.device_token_hash'),
 ('0029','mqtt_credential_pool', exists(select 1 from rel where relname='mqtt_credential_pool' and relkind='r'), 'mqtt_credential_pool'),
 ('0030','device_setup_commands', exists(select 1 from pg_constraint where conname='irrigation_commands_command_check' and pg_get_constraintdef(oid) like '%change_wifi%'), 'command check allows change_wifi'),
 ('0031','zone_water_balance_admin_select_only', exists(select 1 from pg_policies where tablename='zone_water_balance' and policyname='zone_water_balance_all_admin'), 'policy zone_water_balance_all_admin'),
 ('0032','service_request_notification', exists(select 1 from rel where relname='service_request_notification' and relkind='r'), 'service_request_notification'),
 ('0033','alert_read_at', exists(select 1 from c where t='alert' and col='read_at'), 'alert.read_at'),
 ('0034','report_request', exists(select 1 from rel where relname='report_request' and relkind='r'), 'report_request'),
 ('0035','report_schedule', exists(select 1 from rel where relname='report_schedule' and relkind='r'), 'report_schedule'),
 ('0036','archive_farm', exists(select 1 from fn where proname='archive_farm'), 'archive_farm()'),
 ('0037','admin_audit_log', exists(select 1 from rel where relname='admin_audit_log' and relkind='r'), 'admin_audit_log'),
 ('0038','audit_log_insert_grant', case when to_regclass('public.admin_audit_log') is null then false else has_table_privilege('service_role','public.admin_audit_log','INSERT') end, 'service_role INSERT on admin_audit_log'),
 ('0039','explanation', exists(select 1 from rel where relname='explanation' and relkind='r'), 'explanation'),
 ('0040','report_schedule_extend', exists(select 1 from c where t='report_schedule' and col='per_zone_pdf'), 'report_schedule.per_zone_pdf'),
 ('0041','accountability', exists(select 1 from c where t='alert' and col='handled_by_profile_id'), 'alert.handled_by_profile_id'),
 ('0042','manual_logging', exists(select 1 from rel where relname='soil_feel_check' and relkind='r'), 'soil_feel_check'),
 ('0043','zone_farmer_edit_guard', exists(select 1 from pg_trigger where tgname='zone_farmer_edit_guard'), 'trigger zone_farmer_edit_guard'),
 ('0044','enquiry', exists(select 1 from rel where relname='enquiry_call' and relkind='r'), 'enquiry_call'),
 ('0045','dismissal', exists(select 1 from rel where relname='dismissal' and relkind='r'), 'dismissal'),
 ('0046','tank_and_ph', exists(select 1 from rel where relname='tank_refill') and exists(select 1 from rel where relname='soil_ph_log') and exists(select 1 from c where t='alert' and col='farm_id') and exists(select 1 from c where t='farm' and col='tank_capacity_litres'), 'tank_refill, soil_ph_log, alert.farm_id, farm.tank_capacity_litres'),
 ('0047','repair_live_drift', not exists(select 1 from fn where proname='auto_irrigation_check') and (select mode_allows_manual from m0010) and exists(select 1 from fn where proname='handle_new_auth_user' and pg_get_functiondef(oid) like '%''phone''%'), 'auto_irrigation_check() gone, irrigation_mode allows manual, handle_new_auth_user() copies phone'),
 ('0048','simulated_farms', exists(select 1 from c where t='farm' and col='is_simulated') and exists(select 1 from c where t='sensor_reading' and col='simulated') and exists(select 1 from c where t='zone_latest_reading' and col='moisture_simulated') and (select count(*) from farm where name in ('Rustlers Valley (Simulated)', 'Brits (Simulated)')) = 2, 'farm.is_simulated, sensor_reading.simulated, view.moisture_simulated, the 2 simulated farms of 0048'),
 ('0049','profile_language', exists(select 1 from c where t='profile' and col='language') and exists(select 1 from pg_constraint where conname='profile_language_check'), 'profile.language + profile_language_check'),
 ('0050','password_reset_and_sign_in', exists(select 1 from rel where relname='password_reset_code') and exists(select 1 from rel where relname='sign_in_link') and exists(select 1 from c where t='profile' and col='temp_password_expires_at'), 'password_reset_code, sign_in_link, profile.temp_password_expires_at'),
 ('0053','farm_location_water_irrigation', exists(select 1 from c where t='farm' and col='province') and exists(select 1 from c where t='farm' and col='water_source') and exists(select 1 from c where t='zone' and col='irrigation_type') and exists(select 1 from rel where relname='staff_notice'), 'farm.province/town/water_source, zone.irrigation_type, staff_notice'),
 ('0054','settings_and_drought', exists(select 1 from rel where relname='app_setting') and exists(select 1 from rel where relname='drought_event') and exists(select 1 from c where t='farm' and col='drought_override') and (select count(*) from app_setting) >= 26, 'app_setting (26 defaults), drought_event, farm.drought_*'),
 ('0055','community_reports', exists(select 1 from rel where relname='community_report') and exists(select 1 from rel where relname='community_report_confirmation') and exists(select 1 from rel where relname='community_report_update') and exists(select 1 from rel where relname='community_notification') and exists(select 1 from rel where relname='notification_preference'), 'community_report (+ confirmation, update, notification), notification_preference'),
 ('0056','demo_mahikeng', exists(select 1 from c where t='farm' and col='sim_scenario') and (select count(*) from farm where name in ('Mahikeng (Simulated)', 'Ottoshoop (Simulated)') and is_simulated) = 2, 'farm.sim_scenario, Mahikeng and Ottoshoop simulated farms'),
 ('0052','zone_max_run', exists(select 1 from c where t='zone' and col='max_run_minutes') and exists(select 1 from pg_constraint where conname='zone_max_run_minutes_check'), 'zone.max_run_minutes with its 1-120 check'),
 ('0051','command_finished', exists(select 1 from c where t='irrigation_commands' and col='finished_at') and exists(select 1 from c where t='irrigation_event' and col='command_id'), 'irrigation_commands.finished_at, irrigation_event.command_id'),
 ('0057','audit_trust_and_data', exists(select 1 from rel where relname='onboarding_request' and relkind='r') and exists(select 1 from c where t='irrigation_commands' and col='requested_duration_seconds') and exists(select 1 from c where t='irrigation_commands' and col='published_at') and exists(select 1 from pg_trigger where tgname='trg_irrigation_commands_cap') and exists(select 1 from c where t='service_request' and col='rough_size_unit'), 'onboarding_request, run-cap trigger, irrigation_commands.requested_duration_seconds/published_at, service_request.rough_size_unit'),
 ('0058','service_journey', exists(select 1 from rel where relname='service_case' and relkind='r') and exists(select 1 from rel where relname='installation_visit' and relkind='r') and exists(select 1 from rel where relname='installer_check' and relkind='r') and exists(select 1 from rel where relname='farmer_task' and relkind='r') and exists(select 1 from rel where relname='help_request' and relkind='r') and exists(select 1 from rel where relname='terms_acceptance' and relkind='r') and exists(select 1 from c where t='zone' and col='commission_state') and (select count(*) from app_setting where key like 'service.%') = 4, 'service_case, installation_visit, installer_check, farmer_task, help_request, terms_acceptance, zone.commission_state, 4 service.* settings'),
 ('0059','core_tables_rls', (select bool_and(relrowsecurity) from pg_class where relnamespace = 'public'::regnamespace and relname in ('farm','zone','farm_member','profile')) and (select count(distinct tablename) from pg_policies where schemaname = 'public' and tablename in ('farm','zone','farm_member','profile')) = 4 and has_table_privilege('authenticated','public.zone','SELECT') and not has_table_privilege('anon','public.farm','SELECT'), 'RLS on with a policy for farm, zone, farm_member, profile; authenticated may read, anon may not'),
 ('0060','sensor_reading_device_dedupe', exists(select 1 from c where t='sensor_reading' and col='hardware_id') and exists(select 1 from rel where relname='uq_sensor_reading_hardware_measured' and relkind='i') and exists(select 1 from c where t='hardware' and col='offline_backlog') and exists(select 1 from c where t='hardware' and col='offline_backlog_at'), 'sensor_reading.hardware_id, the per-kit measured-time unique index, hardware.offline_backlog and offline_backlog_at'),
 ('0061','kit_status_report', exists(select 1 from c where t='hardware' and col='wifi_rssi') and exists(select 1 from c where t='hardware' and col='soil_probe_ok') and exists(select 1 from c where t='hardware' and col='kit_report_at'), 'hardware.wifi_rssi, soil_probe_ok and kit_report_at'),
 ('0062','terms_acceptance_setting', exists(select 1 from app_setting where key='terms.acceptance_enabled'), 'app_setting terms.acceptance_enabled (default false)'),
 ('storage','reports bucket (not a migration)', exists(select 1 from storage.buckets where id = 'reports'), 'storage.buckets id = reports')
) as v(num, name, applied, detail)
order by num;
