# AgroFlow

Smart irrigation platform: ESP32 field hardware, a Supabase/Postgres
backend with Row Level Security, a .NET API bridging MQTT + device
enrollment to the database, a farmer-facing mobile app, and an admin web
dashboard.

## Architecture

```
ESP32 board (per irrigation zone)
  │
  ├─ MQTT (HiveMQ Cloud, TLS)  ── sensor readings, irrigation commands
  ├─ HTTP (AgroFlow.Api)       ── device enrollment/claim, irrigation event logging, OTA check
  └─ HTTP (Supabase REST)      ── mark irrigation_commands executed
        │
        ▼
  AgroFlow.Api (backend/AgroFlow.Api)
    - the ONLY thing that connects to Postgres as service_role / postgres:
      inserts sensor readings, computes zone health, decides auto-irrigation
      start/stop (Zone.cs in backend/AgroFlow.Domain/), publishes commands
      back over MQTT
    - admin-only device enrollment + farmer onboarding endpoints
    - MQTTnet client + Postgres LISTEN/NOTIFY bridge
        │
        ▼
  Supabase (Postgres + Auth, Row Level Security — supabase/migrations/)
        ▲                              ▲
        │ direct read/write,           │ direct read/write,
        │ RLS-scoped to the            │ RLS-scoped to
        │ signed-in farmer             │ profile.role = 'admin'
        │                              │
  apps/mobile                    apps/web/admin
  (farmer-facing, Expo)          (admin console, Vite)
```

**The split that matters:** apps/mobile and apps/web/admin do not go
through AgroFlow.Api to read or write their own data — they hold a
Supabase Auth session and query Postgres directly with the anon key,
and Row Level Security (migration `0011_row_level_security.sql`) is what
actually enforces "a farmer only sees their own farm's zones" / "only an
admin can see every farm." AgroFlow.Api exists only for the things a
client genuinely cannot do itself: talking to hardware over MQTT,
device enrollment, and anything that needs the `service_role` key.
Neither app calls a REST wrapper around the database — there isn't one.

## Repository layout

| Path | What it is |
|---|---|
| `apps/mobile` | Expo/React Native app for farmers. Real Supabase Auth (email/password, session persisted). Zones, sensor readings, irrigation history, water usage, weather and alerts are fetched directly from Postgres per signed-in farmer (`context/AgroFlowContext.tsx`), scoped by RLS. |
| `apps/web/admin` | Vite + vanilla TypeScript admin console. Real Supabase Auth gated on `profile.role = 'admin'` (`app/auth.ts`); a rejected non-admin login is signed back out immediately. Users, farms, hardware, alerts, maintenance and irrigation-event data (`data/api.ts`) are real queries; see "Not yet implemented" below for what still isn't. |
| `backend/AgroFlow.Api` | ASP.NET Core Web API — see [backend/AgroFlow.Api/README.md](backend/AgroFlow.Api/README.md). |
| `backend/AgroFlow.Domain` | C# domain model (`Zone`, `Farm`, `Sensor`, etc. under `AgroFlow.Business`) plus a console entry point (`Program.cs`) demonstrating polymorphism. `backend/AgroFlow.Api` references this project directly for its business logic. |
| `hardware/` | Device firmware, one sketch folder per device type — see [hardware/README.md](hardware/README.md). Currently just the ESP32 irrigation node (WiFiManager provisioning, MQTT for sensor readings/commands, HTTP for irrigation event logging and OTA updates); [hardware/shared/MQTT_TOPICS.md](hardware/shared/MQTT_TOPICS.md) documents the MQTT topic structure shared across all future device types. |
| `supabase/migrations/` | Full Postgres schema history, in order. **Not ground truth for live DB state** — the two have diverged before; when in doubt, query the live database rather than trusting these files. |

## What each app can do today

**Mobile (farmer-facing):** sign in/out with a real account; view real
zones for the signed-in farmer's farm, each zone's latest sensor reading
(soil moisture/temperature/humidity), a derived Online/Offline sensor
status, the day's water usage, latest weather, and open alerts for that
zone. Relay/pump "status" is always shown as Off — the schema has no
column that says a device is *actively* running one, so nothing invents
one. In-app activity history is logged locally (AsyncStorage) and is not
yet synced to Postgres — there is no `irrigation_commands` insert policy
for farm users yet.

**Admin dashboard:** sign in/out gated to `profile.role = 'admin'`; view
real users, farms, hardware, alerts, maintenance jobs and irrigation
events across every farm, with working filters derived from the real
data returned. Alert/maintenance/user mutations (assign, resolve,
disable, etc.) update in the current browser session only — see below.

**Backend / firmware:** device enrollment, MQTT-based sensor ingestion,
auto-irrigation decisioning, and OTA update checks are implemented and
unchanged by this pass — see `backend/AgroFlow.Api/README.md` and
`hardware/README.md`.

## Not yet implemented

Said plainly, not hedged:

- **Platform Activity** (admin) — no activity-log table exists anywhere
  in the schema. The nav item stays, and shows a labelled "not yet
  implemented" state instead of a fake or silently empty page.
- **System Health** (admin) — no monitoring/health-check table exists.
  The old hardcoded "All systems operational" / "All core services
  operational" strings have been removed; the panel now says plainly
  that this isn't built.
- **Admin Irrigation Schedules** — left out of this pass entirely; it
  overlaps with reporting work still to be specified.
- **Report generation** (`report` table) and **AI-driven insights**
  (`ai_recommendation` table) — both tables exist and are queried where
  relevant, but nothing writes to them yet, and no generation/inference
  logic has been built. Scope for this is still being defined.
- **Alerts, maintenance, weather, hardware** — all have real tables and
  real read queries with a proper empty state ("No alerts yet," etc.),
  but nothing currently writes rows into most of them outside a handful
  of manually-seeded records — there's no automated alert-raising,
  maintenance-scheduling, or weather-ingestion job yet.
- **Admin dashboard mutations** (disable user, assign alert, complete
  maintenance, edit/delete records, schedule visits, etc.) update an
  in-memory copy for the current browser session only — refreshing the
  page reverts them. They are not wired to Postgres writes (missing
  columns/grants in a few cases, not yet built in others).
- **Hardware-dependent features** — anything that needs a live device
  in the field (real relay/pump run-state, live connectivity telemetry
  beyond "last reading seen") has no real signal to show yet.

## Getting started

Each sub-project has its own setup:

- **Mobile app**: `cd apps/mobile && npm install && npm start`
- **Admin dashboard**: `cd apps/web/admin && npm install && npm run dev`
- **Backend API**: see [backend/AgroFlow.Api/README.md](backend/AgroFlow.Api/README.md)
- **Firmware**: see [hardware/README.md](hardware/README.md) for the overall layout, or go straight to [hardware/esp32/AgroFlowIrrigationNode/README.md](hardware/esp32/AgroFlowIrrigationNode/README.md) for setup instructions
- **Database**: apply `supabase/migrations/*.sql` in order (via the Supabase CLI or SQL editor) against a Supabase project — then verify against the live database, since the two can diverge

## Configuration & secrets

Non-secret config is committed; secrets are kept out of the tree per
sub-project:

| Sub-project | Non-secret config | Secrets |
|---|---|---|
| `apps/mobile`, `apps/web/admin` | — | `.env` (copy from `.env.example`), gitignored |
| `backend/AgroFlow.Api` | `appsettings.json` (committed) | .NET user-secrets — `ConnectionStrings:Supabase`, `Supabase:ServiceRoleKey`, `ApiKey`, `Mqtt:Password`. See [backend/AgroFlow.Api/README.md](backend/AgroFlow.Api/README.md#configuration). |
| `hardware/esp32/AgroFlowIrrigationNode` | inline constants in the `.ino` | `secrets.h` (copy from `secrets.example.h`), gitignored — `API_KEY`, `MQTT_PASSWORD` |

> **Rotate these:** a real `appsettings.json` (DB password, `ApiKey`,
> Supabase `service_role` key, HiveMQ password) and the firmware's HiveMQ
> password were committed before this hardening. They remain in git history
> and must be rotated. History was deliberately left unrewritten.
