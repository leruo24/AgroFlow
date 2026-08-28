# AgroFlow

Smart irrigation platform: ESP32 field hardware, a Supabase/Postgres
backend, a .NET API bridging MQTT + HTTP to the database, a farmer-facing
mobile app, and an admin web dashboard.

## Architecture

```
ESP32 board (per irrigation zone)
  │
  ├─ MQTT (HiveMQ Cloud, TLS)  ── sensor readings, irrigation commands
  ├─ HTTP (AgroFlow.Api)       ── device enrollment/claim, irrigation event logging, OTA check
  └─ HTTP (Supabase REST)      ── mark irrigation_commands executed
        │
        ▼
  AgroFlow.Api (api/AgroFlow.Api)
    - inserts sensor readings, computes zone health, decides auto-irrigation
      start/stop (Zone.cs in data/), publishes commands back over MQTT
    - admin-only device enrollment + farmer onboarding endpoints
    - MQTTnet client + Postgres LISTEN/NOTIFY bridge
        │
        ▼
  Supabase (Postgres + Auth) — supabase/migrations/
        │
        ├─ apps/agroflow-app        farmer-facing mobile app (Expo)
        └─ apps/web-dashboard/admin admin console (Vite)
```

Data maturity varies by piece — see each sub-project's own README/status
notes rather than assuming everything below is fully live end-to-end yet.

## Repository layout

| Path | What it is |
|---|---|
| `apps/agroflow-app` | Expo/React Native mobile app for farmers. Zone data and live sensor readings come from real Supabase queries + a Realtime subscription; auth is still mocked (no real Supabase Auth sign-in flow yet). |
| `apps/web-dashboard/admin` | Vite + vanilla TypeScript admin console. Mostly mock data (see its own README) — the exception is farmer onboarding, which calls AgroFlow.Api with a real admin bearer token, though there's no admin login flow built yet either, so that call currently has nothing to authenticate with. |
| `api/AgroFlow.Api` | ASP.NET Core Web API — see [api/AgroFlow.Api/README.md](api/AgroFlow.Api/README.md). |
| `data/` | C# domain model (`Zone`, `Farm`, `Sensor`, etc. under `AgroFlow.Business`) plus a console entry point (`Program.cs`) demonstrating polymorphism. `api/AgroFlow.Api` references this project directly for its business logic. |
| `hardware/` | Device firmware, one sketch folder per device type — see [hardware/README.md](hardware/README.md). Currently just the ESP32 irrigation node (WiFiManager provisioning, MQTT for sensor readings/commands, HTTP for irrigation event logging and OTA updates); [hardware/shared/MQTT_TOPICS.md](hardware/shared/MQTT_TOPICS.md) documents the MQTT topic structure shared across all future device types. |
| `supabase/migrations/` | Full Postgres schema history, in order. |
| `controllers/` | A TypeScript/C# "controller" layer meant to hold business logic shared across the apps. Not currently imported by either app — a real gap, not intentionally dead code. |

## Getting started

Each sub-project has its own setup:

- **Mobile app**: `cd apps/agroflow-app && npm install && npm start`
- **Admin dashboard**: `cd apps/web-dashboard/admin && npm install && npm run dev`
- **Backend API**: see [api/AgroFlow.Api/README.md](api/AgroFlow.Api/README.md)
- **Firmware**: see [hardware/README.md](hardware/README.md) for the overall layout, or go straight to [hardware/esp32/AgroFlowIrrigationNode/README.md](hardware/esp32/AgroFlowIrrigationNode/README.md) for setup instructions
- **Database**: apply `supabase/migrations/*.sql` in order (via the Supabase CLI or SQL editor) against a Supabase project

## Configuration & secrets

Every project's config file (`.env` in the two `apps/`, `appsettings.json` in
`api/AgroFlow.Api`) ships with placeholder values only — real credentials
are filled in locally per developer and should never be committed.
`api/AgroFlow.Api/appsettings.json` in particular is **not currently
gitignored**; if you've filled in real values there (database password, API
key, Supabase service role key), keep that in mind before committing it, or
gitignore it / move secrets to `appsettings.Local.json` or environment
variables first.

## Known loose ends

- `controllers/` (`@agroflow/controllers`) isn't wired into either app yet.
- A stray, git-nested `AgroFlow/` directory (with its own `apps/admin`,
  `apps/farmer`, `packages/database`) exists alongside this repo's real
  structure — it looks like an earlier scaffold, not part of the current
  architecture described above. Worth confirming and cleaning up separately.
