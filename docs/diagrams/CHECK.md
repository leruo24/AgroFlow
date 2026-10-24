# Diagram check against the code and the schema (24 October 2026)

The diagrams in this folder are copied as given and were not edited. This file lists where they differ from the code on `merge/oct24-structure` and from the database schema.

**How the schema was checked.** All 58 migration files (0001–0062, which are applied on the live project) were run into an empty, temporary Postgres, and its tables, columns and foreign keys were read back. The live database was not queried: no read-only credentials are kept in this repository. The partial live schema screenshot (`supabase-schema-zcoalyxzvemiumnipufz.png`, not in git) agrees with every column it shows (weather_daily ETo columns, notification_sent, admin_audit_log, report_schedule, farm). Anything that depends on live data, rather than on the schema, is marked **cannot confirm**.

`diagram-notes.md` was not supplied with the diagrams, so it is not in this folder and is not checked here.

## 1. FAO-56 reference evapotranspiration (ET₀)

**AgroFlow calculates ET₀ itself. It does not use Open-Meteo's ET₀.**

- `OpenMeteoDailyParser.DailyVariables` asks Open-Meteo only for `temperature_2m_max, temperature_2m_min, precipitation_sum, relative_humidity_2m_mean, relative_humidity_2m_min, relative_humidity_2m_max, wind_speed_10m_mean`. The archive backfill asks only for temperature and rain. `et0_fao_evapotranspiration` is never requested (`backend/AgroFlow.Domain/IrrigationControl/Agronomy/OpenMeteoDailyParser.cs`, lines 78–85).
- `DailyEtoResolver.Resolve` builds the day's inputs and calls `PenmanMonteithEto.Eto(...)`, the FAO-56 Penman–Monteith equation (`DailyEtoResolver.cs` line 280).
- Solar radiation is estimated from the temperature range (`PenmanMonteithEto.SolarRadiationFromTemperatureRangeMj`, line 175). Wind is converted to 2 m (`WindSpeedAt2M`), with FAO-56's 2 m/s default when it's missing. Temperature falls back to the kit's DHT11 when Open-Meteo has none.
- The source of each input is stored in `weather_daily.eto_source`, `rs_source` and `wind_height_m`.

**Mismatch.** The package diagram lists "+Reference ET₀ (FAO-56)" under *Weather API (Open-Meteo)*. In the code, Open-Meteo supplies the weather inputs and ET₀ belongs to *Irrigation Control* (Recommendations, FAO-56).

## 2. Package diagram: class names per package

The diagram uses analysis names. This table gives the real name for each, or "no class" where the idea is spread over several files.

| Package | Diagram name | In the code | Match |
|---|---|---|---|
| Admin Console | +User | `User` (backend/AgroFlow.Domain/User.cs); `User` type in apps/web/admin/src/types/models.ts | yes |
| Admin Console | +Farm | `Farm` (AgroFlow.Domain/Farm.cs; admin types/models.ts) | yes |
| Admin Console | +Enquiry / Onboarding | No class with this name. Enquiries: `EnquiryEndpoints`, `EnquiryAdminEndpoints`, `EnquiryRules`. Onboarding: `FarmerOnboardingEndpoints`, `OnboardingOperation`. Pages: pages/enquiries.ts, pages/onboarding.ts | name differs |
| Admin Console | +Installation / Kit wizard | No class. The wizard is in apps/web/admin/src/app/interactions.ts ("register-hardware"), with ui/kitSetupCard.ts, DeviceEnrollmentEndpoints and JourneyEndpoints (visits, installer checklist) | name differs |
| Admin Console | +Report | `Report` (AgroFlow.Domain/Report.cs), `ReportEndpoints`, the Reports/ folder | yes |
| Admin Console | +Settings & Moderation | No class. pages/droughtCommunity.ts (settings and moderation), `AppSettingsStore`, `DroughtCommunityEndpoints` | name differs |
| Farmer App | +FarmUser | `FarmUser` (AgroFlow.Domain/FarmUser.cs) | yes |
| Farmer App | +Dashboard | `HomeScreen` (apps/mobile/src/app/(tabs)/index.tsx) | name differs |
| Farmer App | +SetupTasks (4 tasks) | `SetupScreen` (apps/mobile/src/app/setup.tsx); `Journey.FarmerTasks` on the server | name differs |
| Farmer App | +ZoneView | `ZoneControlScreen` (apps/mobile/src/app/zone/[id].tsx) | name differs |
| Farmer App | +KitStatus (Kit tab) | `KitTabScreen` (apps/mobile/src/app/(tabs)/kit.tsx); `KitStatusEndpoints`, `KitHealth` | name differs |
| Farmer App | +AlertsView | `AlertsScreen` (apps/mobile/src/app/(tabs)/alerts.tsx) | name differs |
| Sensor Monitoring | +SoilMoistureSensor, +TemperatureSensor, +HumiditySensor | One class, `Sensor` (SensorMonitoring/Sensor.cs). Its type is the string `"SoilMoisture" \| "Temperature" \| "Humidity"` (`SensorReadingTypes`). There are no separate sensor classes | structure differs |
| Sensor Monitoring | +SensorReading | No `SensorReading` class. `SensorMqttPayload`, `SensorReadingProcessor`, `ZoneMoistureReading`, `RawMoistureReading`; table `sensor_reading` | name differs |
| Irrigation Control | +Zone | `Zone` (IrrigationControl/Zone.cs) | yes |
| Irrigation Control | +IrrigationCommand | No class. `IrrigationCommandNotification` (IrrigationControl/IrrigationCommandNotifyService.cs), `CommandState`; table `irrigation_commands` | name differs |
| Irrigation Control | +IrrigationLog | `IrrigationLog` (IrrigationControl/IrrigationLog.cs) | yes |
| Irrigation Control | +Schedule & RunLimit | No Schedule class: schedules are zone columns, run by the pg_cron function `fire_due_irrigation_schedules()`. Run limit: `IrrigationRunRules`, `ZoneRunLimit`, firmware `RunLimits.h` | name differs |
| Irrigation Control | +Recommendations (FAO-56) | `Fao56Engine`, `IrrigationAdvisor`, `Fao56EngineController`, `RuleBook/RecommendationRules` | yes (several classes) |
| Irrigation Control | +DroughtManager | The file is `DroughtManager.cs`, but it has no `DroughtManager` class. It holds `DroughtRules`, `DroughtPriorities`, `DroughtStages`, `YieldResponse`, `ApplicationEfficiency`; the API side is `DroughtEvaluator` | name differs |
| Notifications | +Alert | `Alert` (Notifications/Alert.cs) | yes |
| Notifications | +TelegramMessage (farmers) | No class. `TelegramClient`, `TelegramNotificationService`, `BotText` | name differs |
| Notifications | +InAppNotice | No class. Farmer in-app alerts are `FarmerMessenger.InAppAsync` (the `alert` table); staff notices are the `staff_notice` table | name differs |
| Notifications | +CommunityReport | No class. `CommunityService`, `CommunityRules`; table `community_report` | name differs |
| Hardware Layer | +ESP32Node (Wi-Fi + MQTT, fw 1.7.1) | `ESP32` (SensorMonitoring/ESP32.cs); firmware AgroFlowIrrigationNode.ino reports `FIRMWARE_VERSION = "1.7.1"` | name differs, version matches |
| Hardware Layer | +Relay | No class. `relayWrite()` and `RELAY_PIN = 25` (active LOW) in the firmware | name differs |
| Hardware Layer | +Pump | `Pump` (IrrigationControl/Pump.cs) | yes |
| Hardware Layer | +Maintenance | `Maintenance` (AgroFlow.Domain/Maintenance.cs); table `maintenance` | yes |
| Data Management | +SyncData (offline readings upload) | No class. The kit side is `OfflineBuffer.h`; the server reads `recordedAt` and the backlog in `SensorReadingProcessor` and `HardwareBacklog`; the app side is apps/mobile/src/lib/offlineQueue.ts | name differs |
| Data Management | +DataAccess | `DB` and `ZoneDB`, plus the `*XDB` classes (DataManagement/) | name differs |
| Data Management | +ActivityLog | `AuditLog` (DataManagement/AuditLog.cs); table `admin_audit_log`; staff "Activity" page | name differs |

Dependencies in the diagram that the code does not show:

- **Admin Console «use» Sensor Monitoring:** the console reads readings through the API (`SensorReadingEndpoints`, `ZoneHardwareEndpoints`). There is no direct dependency. It matches if "use" means "through the API".
- **Sensor Monitoring «use» Hardware Layer:** in the code, the dependency runs the other way at runtime. The kit publishes to HiveMQ and `MqttConnectionService` subscribes. Commands flow from Irrigation Control to HiveMQ to the kit, which matches the diagram's «use» from Irrigation Control to HiveMQ.
- **Notifications «use» Irrigation Control:** confirmed. `TelegramNotificationService` and `WeatherAlertService` read zone and command state.
- **Admin Console and Farmer App «use» Supabase (auth):** confirmed (`apps/*/src/lib/supabase.ts`).

## 3. Class diagram vs the real tables

| Diagram entity | Real table | Attributes: mismatches | Associations and multiplicities |
|---|---|---|---|
| User {abstract} | `profile` | name, email, phone, language, createdAt all match. Specialisation is one column, `role`, checked to `'admin' \| 'farm_user'` (0001); there are no separate tables. The API also accepts a `field_officer` staff role (`StaffRoles`), which the database check does not allow | Admin and FarmUser as subclasses of User: matches (single table) |
| Admin | `profile` with role = 'admin' | none | — |
| FarmUser | `profile` with role = 'farm_user' | `telegram_alerts_enabled` and `must_change_password` exist, but on every profile, staff included, not only farmers | — |
| AuditEntry | `admin_audit_log` | action, entityType, createdAt match. details is `jsonb` (diagram says Text). Missing: actor_name, entity_id, farm_id | Admin 1 records 0..*: in the schema `actor_profile_id` is nullable (system actions have no actor), so the Admin end is **0..1** |
| StaffNotice | `staff_notice` | **title: no such column** (there is `kind`). message matches. **publishedAt: no such column** (created_at, resolved_at) | "Admin publishes StaffNotice": the system raises staff notices about a farm (`farm_id`, `profile_id`), and a staff member **resolves** them (`resolved_by`, 0..1). No column records who published one |
| Enquiry | `enquiry` | contactName = `full_name`, phone, status and createdAt match | Admin claims Enquiry 0..1 / 0..*: matches (`handled_by_profile_id` nullable). **Enquiry becomes Farm 0..1 / 0..1: no direct foreign key.** The links are `enquiry.farmer_profile_id` to the profile, plus `service_case` and `onboarding_request`, which both hold `enquiry_id` and `farm_id` |
| Installation | `installation_visit` | scheduledFor and status match. **commissionedAt is not on this table**: it is `zone.commissioned_at` | **Zone 1 – Installation 0..***: the foreign key is `installation_visit.farm_id`, so this is **Farm** 1 – 0..*. There is no zone link |
| EnrollmentCode | **no table** | The code is two columns on `hardware`: `enrollment_code`, `enrollment_code_expires_at`. **usedAt does not exist**: a claim clears the code and sets `enrollment_status` | **Installation 1 – EnrollmentCode 0..1: no relation in the schema.** EnrollmentCode links HardwareKit 0..1 / 0..1: it is an attribute of `hardware` (one row, at most one live code) |
| TermsAcceptance | `terms_acceptance` | termsVersion = `version`. Also `document` (terms / privacy) and `method`. acceptedAt matches | FarmUser 1 accepts 0..*: matches (`profile_id` not null). Any profile can accept, not only farmers |
| NotificationPreference | `notification_preference` | **channel and enabled do not exist.** It is one row per profile with five booleans (`watering_telegram`, `low_tank_telegram`, `drought_telegram`, `community_telegram`, `weather_telegram`), `community_opt_in`, `quiet_start`, `quiet_end` | FarmUser 1 – 0..1: matches (`profile_id` is unique) |
| FarmMember | `farm_member` | **memberRole does not exist.** joinedAt = `created_at` | FarmUser 1 – 0..*: matches. **Farm 1 – FarmMember 1..*: should be 0..*.** A farm needs no member rows; its owner is `farm.owner_id`. **Missing association: FarmUser 0..1 owns Farm 0..*** (`farm.owner_id`, nullable) |
| Farm | `farm` | name, location, province, latitude, longitude, totalArea (`total_area`), tankCapacityLitres and status match. Missing: town, water_source, is_simulated, drought_active, drought_since, drought_reason, drought_override | — |
| Zone | `zone` | name, crop (`crop_type`), status, runLimitMinutes (`max_run_minutes`) and flowRateLpm (`flow_rate_lpm`) match. area = `area_m2` (also `size_value` and `size_unit`). **mode: the check allows `automatic`, `scheduled` and `manual`**; the diagram omits Scheduled | **Farm 1 – Zone 1..*: should be 0..*.** A farm can exist with no zones; the app has "This farm has no zones" states |
| HardwareKit | `hardware` | deviceId, firmwareVersion, wifiRssi, soilProbeOk and lastReportAt (`kit_report_at`) match. Also `last_seen`, `enrollment_status`, `offline_backlog` | **Zone 1 – HardwareKit 0..1:** `hardware.zone_id` is nullable and not unique. 0009 states that several hardware rows per zone are allowed, so the schema says **Zone 0..1 – HardwareKit 0..***. One kit per zone is practice, not a constraint |
| SensorReading | `sensor_reading` | **soilMoisturePct, temperatureC and humidityPct do not exist.** Each row is one measurement: `sensor_type` (SoilMoisture / Temperature / Humidity) and `value`, plus `raw_value` and `simulated`. recordedAt matches | HardwareKit 1 sends 0..*: `sensor_reading.hardware_id` is **nullable** (added in 0060), so the kit end is **0..1**. **Missing: Zone 1 – SensorReading 0..*** (`zone_id` not null) |
| IrrigationCommand | `irrigation_commands` | action = `command`, checked to **`start`, `stop`, `open_setup`, `change_wifi`** (0030); the diagram shows only Start and Stop. durationSeconds and status match. requestedAt = `created_at`. confirmedAt = `executed_at`. Also `published_at`, `finished_at`, `requested_duration_seconds` | Zone 1 – 0..*: matches |
| IrrigationEvent | `irrigation_event` | startedAt matches. **endedAt does not exist.** durationSeconds = `runtime_seconds`. trigger = `trigger_source`, checked to **`auto`, `manual`, `scheduled`, `unknown`** | IrrigationCommand 1 results in 0..1: `irrigation_event.command_id` is nullable and not unique, so the schema says **Command 0..1 – Event 0..***. A manual log has no command. **Missing: Zone 1 – IrrigationEvent 0..*** (`zone_id` not null) |
| WeatherRecord | `weather_daily` | date, etoMm, etoSource and windHeightM match. Also tmin_c, tmax_c, precipitation_mm, humidity, rs_source, is_forecast. A legacy `weather` table also exists | Farm 1 – 0..*: matches |
| TankRefill | `tank_refill` | litres = `litres_added`. refilledAt matches | Farm 1 – 0..*: matches |
| DroughtEvent | `drought_event` | **level, startedAt and endedAt do not exist.** Each row is one change: `active`, `source`, `reason`, `changed_by`, `created_at` | Farm 1 – 0..*: matches |
| ReportSchedule | `report_schedule` | enabled, frequency, reportTypes and lastRunAt match | Farm 1 – 0..1: matches (`farm_id` is unique) |
| Notification | `notification_sent` | alertType, subjectDate and sentAt match | Farm 1 – 0..*: matches |
| CommunityReport | `community_report` | type = `category` (plus `subtype`). description, status and createdAt match | FarmUser 1 posts 0..*: matches (`reporter_profile_id` not null) |
| ReportConfirmation | `community_report_confirmation` | confirmedAt = `created_at` | CommunityReport 1 – 0..* and FarmUser 1 – 0..*: matches |

Tables with no entity in the class diagram (the diagram says it is "analysis-level", so leaving these out may be deliberate):

- **Operational:** `alert`, `explanation`, `ai_recommendation`, `zone_water_balance`, `soil_feel_check`, `soil_ph_log`, `weather`, `maintenance`.
- **Journey:** `service_case`, `farmer_task`, `help_request`, `installer_check`, `enquiry_call`, `onboarding_request`, `service_request`, `service_request_notification`.
- **Reports:** `report`, `report_request`.
- **Settings and accounts:** `app_setting`, `dismissal`, `password_reset_code`, `sign_in_link`, `telegram_onboarding_code`, `mqtt_credential_pool`.
- **Community:** `community_notification`, `community_report_update`.

Note that the package diagram's *Alert* has no entity here, though the `alert` table exists.

## 4. Cannot confirm

- **Live row counts and data:** for example, whether every live zone has at most one kit, or whether any `irrigation_event` row shares a `command_id`. The schema allows both; only the data would show it.
- **Live objects outside the migrations:** anything added to the live database by hand, other than through 0001–0062.
- **Activity diagrams:** the three files were copied but not checked step by step. The brief asked for package and class checks only.
