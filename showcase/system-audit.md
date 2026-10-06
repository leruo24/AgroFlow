# AgroFlow system audit — INF3003W Showcase demo

Source of truth: this repository, branch `dev` (= "AgroFlow-dev").
Audited 2026-10-06. "Working" means implemented end-to-end in the code; it does not
mean verified against the live database (see "Run status").

## Run status

| Component | Ran? | Notes |
|---|---|---|
| Farmer app (`apps/mobile`, Expo) | **Yes** — production web build (`expo export -p web`), unmodified | Captured at 390×844 @2× |
| Admin console (`apps/web/admin`, Vite) | **Yes** — unmodified | Captured at 1440×810 @2× |
| AgroFlow.Api (Railway) | **No** — this environment's network policy blocks `agroflow-production-998d.up.railway.app` (proxy 403) | |
| Supabase dev project | **No** — `zcoalyxzvemiumnipufz.supabase.co` blocked (proxy 403); no account credentials in repo/env (correctly) | Public URL/key exist in `apps/mobile/eas.json` |
| ESP32 / HiveMQ | Not runnable here (physical hardware) | Shown as conceptual graphics only |

**Decision (approved by the team):** run the real, unmodified apps and answer their network
calls with clearly labelled demo data — the approach of `apps/mobile/scripts/ui-smoke.mjs`.
Every demo name carries "(demo)"; an on-screen tag says "illustrative demo data".
Data is in `capture/demo-data.mjs` and is chosen to obey the real backend rules.

## Feature table

| Feature | Working? | Where in code | Best demo screen | Persona value |
|---|---|---|---|---|
| Farmer sign-in (Supabase Auth) + inline validation | Yes | `apps/mobile/src/app/login.tsx`, `context/AuthContext.tsx` | Login | Secure personal access |
| Farm selection (multiple farms) | Yes | `components/FarmSelector.tsx` | Home / Irrigation header | Farmer with more than one farm |
| Home: weather, farm status, quick actions | Yes | `app/(tabs)/index.tsx`, `components/WeatherSummary.tsx` | Home | Whole farm at a glance |
| All zones overview with health | Yes | `app/(tabs)/irrigation.tsx` | Irrigation tab | Spot the zone that needs attention |
| Zone live readings (soil moisture, temperature, humidity) + Dry/Optimal label | Yes | `app/zone/[id].tsx`, `context/AgroFlowContext.tsx` (`deriveMoistureStatus`) | Zone → Live Overview | Understand conditions |
| Crop + growth stage | Yes | `components/ZoneGrowthBar.tsx`, API `/zones/{id}/insights` growth | Zone → Development bar | Context for water need |
| Irrigation advice (FAO-56 water balance, deterministic, not AI) | Yes | `backend/AgroFlow.Domain/Agronomy/*` (`IrrigationAdvisor.cs`: "NOT a language model"), `ZoneInsightBuilder.cs`, written to `ai_recommendation` | Zone → Advice | A clear action instead of raw numbers |
| 7-day forecast (Open-Meteo) | Yes | `WeatherCollectionService.cs`, `ForecastEndpoints.cs`, `app/forecast.tsx` | The week ahead | Why: no rain expected |
| Irrigation modes (Automatic / Scheduled / Manual) | Yes | `IrrigationMode.cs`, zone page mode buttons → `PUT /api/farmer/zones/{id}/settings` | Zone → Irrigation Control | Farmer stays in control |
| Manual irrigation start/stop | Yes | `app/zone/[id].tsx` `handleStartManualRun` → `POST /api/farmer/zones/{id}/commands` (`FarmerEndpoints.CreateManualCommandAsync`) | Zone → Start Manual Run | Two taps to water |
| Duration validation (1–60 min in app; 1–3600 s in API; firmware stops any cycle at 5 min) | Yes | `app/zone/[id].tsx` ("Invalid Duration…"), `FarmerEndpoints.cs` | Start Manual Run with 90 | Safe input |
| Command path to hardware | Yes | `irrigation_commands` → Postgres NOTIFY (0009) → `IrrigationCommandNotifyService.cs` → MQTT `.../commands` → ESP32 relay | Conceptual graphic | Action reaches the field |
| Irrigation event recording | Yes | Firmware `POST /api/irrigation-events` → `IrrigationEventEndpoints.cs` → `irrigation_event` | History → "Irrigation recorded" | Evidence of what ran |
| History (watering + alerts & advice) | Yes | `app/(tabs)/history.tsx`, `services/alertHistoryService.ts` | History | Look back later |
| Alerts (Critical zone) | Yes (writer: entering Critical) | `SensorReadingProcessor.InsertCriticalAlertAsync` | Alerts / History / Admin Alerts | Early warning |
| Telegram notifications | Yes (needs bot token) | `Services/Notifications/*` | Not shown (no phone capture) | Off-app warning |
| Sensor hardware: soil moisture probe, DHT11, relay, pump on ESP32 | Yes | `hardware/esp32/AgroFlowIrrigationNode/*.ino` | Conceptual graphic | Real field data |
| MQTT over TLS (HiveMQ Cloud) | Yes | `hardware/shared/MQTT_TOPICS.md`, `Mqtt/*` | Conceptual graphic | Connected system |
| Supabase Postgres + RLS | Yes | `supabase/migrations/*`, `0011_row_level_security.sql` | Conceptual graphic | Each farmer sees only their farm |
| Admin Home (needs attention, KPIs, system health) | Yes | `apps/web/admin/src/pages/dashboard.ts`, `app/health.ts` | Admin Home | Platform oversight |
| Admin Farms & zones | Partly — list real; health factors/user/device counts not computed (shown as 0) | `pages/farms.ts`, `data/api.ts getFarms` | Farms (brief) | Scale |
| Admin Kits (hardware): connection, last seen, token, status | Yes | `pages/operations.ts hardwarePage` | Kits | Fleet health |
| Admin Alerts list + detail | Yes (read); assign/resolve are session-only, DB allows Open/Resolved only | `pages/operations.ts alertsPage`, `interactions.ts` | Alerts → View | Follow-up |
| Admin Maintenance | Read: Yes; scheduling/assign: session-only (no writer) | `pages/operations.ts maintenancePage` | Maintenance | Planned field work |
| Admin Activity (audit log) | Yes (needs migration 0038 applied) | `0037_admin_audit_log.sql`, `pages/analytics.ts activityPage` | Activity | Accountability |
| Reports (designed PDF/XLSX) | Yes | `backend/AgroFlow.Api/Reports/*`, mobile `app/reports.tsx` | Not shown (time) | — |
| Responsive admin | Yes (5 breakpoints) | `apps/web/admin/src/styles/main.css` | Optional narrow view | — |
| Automated tests | Yes — 650 domain tests per `docs/final-finish-report.md` | `backend/AgroFlow.Domain.Tests` (29 files) | Not shown (code walkthrough) | — |

## Not shown, and why

- **Assigning/resolving alerts and scheduling maintenance in the console**: they update the
  browser session only and revert on reload (`data/api.ts` header; the `alert` table allows
  only Open/Resolved). Showing them as persistent would be inaccurate.
- **Live relay/pump state**: no run-state column exists; the app shows "Unknown". The pump
  OFF→ON appears only in the conceptual hardware graphic.
- **Drip helper on Home**: it can decide its greeting before zones load and then reads
  "All your zones look good today" even with a Critical zone (`DripHelper.tsx`, `ready` true
  while `zones` is `[]`). Switched off via the app's own preference for the capture.
- **Admin irrigation control**: does not exist by design (`apps/web/admin/README.md`).
- **AI**: not claimed; the advice engine is a deterministic FAO-56 calculation.
- **Water/yield savings, uptime figures**: no measurements exist; none shown.

## Consistency note for the team

The app accepts manual runs of 1–60 minutes and the API 1–3600 seconds, but the firmware
stops every pump cycle at 5 minutes (`SAFETY_MAX_RUN_MS` in `AgroFlowIrrigationNode.ino`).
A 15-minute command would run for 5 minutes and be recorded as 300 s. The demo therefore
uses a 5-minute run. Worth aligning the app limit (or the advice) with the firmware cap.

## Known app quirks seen during capture (for the team, not shown up close)

1. `DripHelper` greeting race (above).
2. A stored `irrigation_mode = 'manual'` is displayed as "Automatic" after reload
   (`AgroFlowContext.mapZoneRow` maps only scheduled/automatic).
3. Admin alert drawer prints the raw ISO timestamp.
4. Admin Farms search placeholder shows a mis-encoded ellipsis ("provinceâ€¦").
5. Admin alert Assign/Resolve toasts succeed, then the row reverts on refresh.
6. Dev build only: duplicate React key warning on History → Alerts & advice.
