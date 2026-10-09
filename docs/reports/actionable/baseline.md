# Baseline — `feat/actionable`, before any change

Recorded 6 Oct 2026, off `dev` at the commit `feat/actionable` was cut from.

**This is the contract.** Every route and payload below must keep working
after Part 1 and Part 2. New fields are added as optional; a route whose
behaviour must change gets a new route beside it.

---

## Builds and tests

| Check | Result |
|---|---|
| `dotnet build` (AgroFlow.Api) | 0 warnings, 0 errors |
| `dotnet test` (AgroFlow.Domain.Tests) | **650 passed**, 0 failed, 0 skipped |
| admin `tsc --noEmit` | 0 errors |
| admin `npm run build` | clean (chunk-size warning only, pre-existing) |
| mobile `tsc --noEmit` | 0 errors |
| mobile `npx expo-doctor` | 21/21 |

---

## Required files

| File | Present |
|---|---|
| `docs/Fao56.pdf` | yes (11.3 MB) |
| `backend/AgroFlow.Domain/Agronomy/fao56-crop-knowledge.json` | yes |
| `showcase/assets/brand/agroflow-icon.png` | yes |
| Report templates (`agroflow-report-template.pdf`, `agroflow-data-template.xlsx`) | in `Downloads`, already implemented in `backend/AgroFlow.Api/Reports/` |
| Firmware `hardware/esp32/AgroFlowIrrigationNode/AgroFlowIrrigationNode.ino` | yes — **v1.4.0** (`FIRMWARE_VERSION = "1.4.0"`) |

`secrets.h` exists beside the firmware. It has not been opened and will not be.

---

## API routes (73)

Extracted from every `Map{Get,Post,Put,Delete}` in `backend/AgroFlow.Api`,
with group prefixes resolved per variable (two files map two groups each).

```
GET    /api/admin/activity
GET    /api/admin/activity/{entityType}/{entityId}
GET    /api/admin/farms/{farmId:long}/report-schedule
PUT    /api/admin/farms/{farmId:long}/report-schedule
GET    /api/admin/hardware
GET    /api/admin/health
GET    /api/admin/mqtt-logins
POST   /api/admin/mqtt-logins
GET    /api/admin/platform-config
PUT    /api/admin/requests/{requestId:long}/assign
PUT    /api/admin/requests/{requestId:long}/status
GET    /api/admin/summary.pdf
GET    /api/admin/zones/{zoneId:long}/hardware
POST   /api/admin/zones/{zoneId:long}/hardware/change-wifi
POST   /api/admin/zones/{zoneId:long}/hardware/open-setup
POST   /api/admin/zones/{zoneId:long}/hardware/revoke
POST   /api/admin/zones/{zoneId:long}/run-advice
POST   /api/auth/forgot-password
POST   /api/devices/claim
POST   /api/devices/commands/{id}/executed
POST   /api/devices/enroll
GET    /api/devices/firmware-check
GET    /api/devices/mqtt-credentials
GET    /api/farmer/auto-reports
POST   /api/farmer/auto-reports/stop
GET    /api/farmer/dashboard
GET    /api/farmer/forecast
POST   /api/farmer/insights/{insightType}/dismiss
POST   /api/farmer/password-changed
PUT    /api/farmer/profile
GET    /api/farmer/report-requests
POST   /api/farmer/report-requests
GET    /api/farmer/reports/moisture
GET    /api/farmer/reports/moisture/pdf
GET    /api/farmer/reports/schedule
GET    /api/farmer/reports/schedule/pdf
GET    /api/farmer/reports/water-usage
GET    /api/farmer/reports/water-usage/pdf
GET    /api/farmer/reports/water-usage/xlsx
GET    /api/farmer/reports/zones
POST   /api/farmer/requests
POST   /api/farmer/telegram/link-code
GET    /api/farmer/weather/current
POST   /api/farmer/zones/{zoneId:long}/calibration
POST   /api/farmer/zones/{zoneId:long}/commands
GET    /api/farmer/zones/{zoneId:long}/hardware
POST   /api/farmer/zones/{zoneId:long}/hardware/change-wifi
GET    /api/farmer/zones/{zoneId:long}/insights
POST   /api/farmer/zones/{zoneId:long}/reset-recommended
PUT    /api/farmer/zones/{zoneId:long}/settings
PUT    /api/farmer/zones/{zoneId:long}/soil
POST   /api/farmers/create
POST   /api/farmers/invite
POST   /api/farmers/onboard
GET    /api/farms
POST   /api/farms/register
DELETE /api/farms/{id:long}
POST   /api/farms/{id:long}/archive
POST   /api/farms/{id:long}/restore
POST   /api/irrigation-events
POST   /api/sensor-readings
POST   /api/telegram/admin/codes/{profileId:guid}
POST   /api/telegram/admin/codes/{profileId:guid}/link
POST   /api/telegram/admin/password/{profileId:guid}
POST   /api/telegram/admin/password/{profileId:guid}/send
DELETE /api/telegram/me
GET    /api/telegram/me
POST   /api/telegram/me/alerts
POST   /api/telegram/me/code
POST   /api/telegram/webhook
GET    /api/users
GET    /api/users/farmers
DELETE /api/users/{id:guid}
```

---

## Firmware v1.4.0 contract — DO NOT CHANGE

The brief forbids touching these unless an item explicitly requires it. None
does.

### HTTP

| Call | Sends | Reads back |
|---|---|---|
| `POST /api/devices/claim` | `deviceId`, `enrollmentCode`, `firmwareVersion` | `deviceToken`, `farmId`, `zoneId`, `mqttHost`, `mqttPort`, `mqttUsername`, `mqttPassword` |
| `GET /api/devices/mqtt-credentials` | header `X-Device-Token` | `mqttHost`, `mqttPort`, `mqttUsername`, `mqttPassword` |
| `GET /api/devices/firmware-check?currentVersion=1.4.0` | header `X-Device-Token` | (update check) |
| `POST /api/devices/commands/{id}/executed` | `executedAt` | — |
| `POST /api/irrigation-events` | `zoneId`, `startedAt`, `runtimeSeconds`, `triggerSource`, `syncStatus` | — |

Headers used: `Content-Type`, `X-Device-Token`.

### MQTT

- Publishes readings to `agroflow/farm/{farmId}/device/{deviceId}/sensors` as
  `{"sensorType", "value"}`.
- Subscribes to `.../commands`; reads `id`, `command`, `durationSeconds`.

---

## Mobile contract (v1 and v2)

From `apps/mobile/src/services/agroFlowApi.ts`. Methods verified by hand where
the extraction was ambiguous (`zones/{x}/insights` is GET).

| Method | Path |
|---|---|
| GET | `/api/farmer/dashboard?farmId=` |
| GET | `/api/farmer/forecast?farmId=&zoneId=` |
| GET | `/api/farmer/weather/current?farmId=` |
| GET | `/api/farmer/zones/{id}/insights` |
| POST | `/api/farmer/insights/{type}/dismiss?zoneId=` |
| POST | `/api/farmer/zones/{id}/calibration` |
| POST | `/api/farmer/zones/{id}/commands` |
| POST | `/api/farmer/zones/{id}/reset-recommended` |
| PUT | `/api/farmer/zones/{id}/settings` |
| PUT | `/api/farmer/zones/{id}/soil` |
| GET | `/api/farmer/zones/{id}/hardware` |
| PUT | `/api/farmer/profile` |
| POST | `/api/farmer/password-changed` |
| POST | `/api/farmer/requests` |
| GET / POST | `/api/farmer/report-requests` |
| GET | `/api/farmer/auto-reports` |
| POST | `/api/farmer/auto-reports/stop` |
| GET / DELETE | `/api/telegram/me` |
| POST | `/api/telegram/me/code` |
| POST | `/api/telegram/me/alerts` |

### Response shapes the app reads

```ts
// GET /api/farmer/zones/{id}/insights
{ zoneId: number; day: string;
  insights: { insightType: string; severity: 'act_now'|'heads_up'|'info'; message: string }[];
  growth: { stage: string; dayOfSeason: number; totalDays: number; cropLabel: string } | null }

// GET /api/farmer/forecast
{ farmId; zoneId|null; zoneName|null; source; message|null;
  days: { date; weekday; minC|null; maxC|null; rainMm|null; humidityPercent|null;
          icon: 'sun'|'cloud'|'rain'; advice: string|null }[] }

// GET /api/farmer/dashboard — loose records: profile, farms, farm, zones,
// readings, events, usage, weather, alerts
```

**Any new field on these responses is added as optional.** A v1 or v2 app that
ignores it must keep working, which is what the Part 2 contract test asserts.
