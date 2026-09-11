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
  AgroFlow.Api (backend/AgroFlow.Api)
    - inserts sensor readings, computes zone health, decides auto-irrigation
      start/stop (Zone.cs in backend/AgroFlow.Domain/), publishes commands back over MQTT
    - admin-only device enrollment + farmer onboarding endpoints
    - MQTTnet client + Postgres LISTEN/NOTIFY bridge
        │
        ▼
  Supabase (Postgres + Auth) — supabase/migrations/
        │
        ├─ apps/mobile     farmer-facing mobile app (Expo)
        └─ apps/web/admin  admin console (Vite)
```

Data maturity varies by piece — see each sub-project's own README/status
notes rather than assuming everything below is fully live end-to-end yet.

## Repository layout

| Path | What it is |
|---|---|
| `apps/mobile` | Expo/React Native mobile app for farmers. Zone data and live sensor readings come from real Supabase queries + a Realtime subscription; auth is still mocked (no real Supabase Auth sign-in flow yet). |
| `apps/web/admin` | Vite + vanilla TypeScript admin console. Mostly mock data (see its own README) — the exception is farmer onboarding, which calls AgroFlow.Api with a real admin bearer token, though there's no admin login flow built yet either, so that call currently has nothing to authenticate with. Domain types and the mock dataset live in `src/types/models.ts` and `src/data/mock.ts`. |
| `backend/AgroFlow.Api` | ASP.NET Core Web API — see [backend/AgroFlow.Api/README.md](backend/AgroFlow.Api/README.md). |
| `backend/AgroFlow.Domain` | C# domain model (`Zone`, `Farm`, `Sensor`, etc. under `AgroFlow.Business`) plus a console entry point (`Program.cs`) demonstrating polymorphism. `backend/AgroFlow.Api` references this project directly for its business logic. |
| `hardware/` | Device firmware, one sketch folder per device type — see [hardware/README.md](hardware/README.md). Currently just the ESP32 irrigation node (WiFiManager provisioning, MQTT for sensor readings/commands, HTTP for irrigation event logging and OTA updates); [hardware/shared/MQTT_TOPICS.md](hardware/shared/MQTT_TOPICS.md) documents the MQTT topic structure shared across all future device types. |
| `supabase/migrations/` | Full Postgres schema history, in order. |

## Getting started

Each sub-project has its own setup:

- **Mobile app**: `cd apps/mobile && npm install && npm start`
- **Admin dashboard**: `cd apps/web/admin && npm install && npm run dev`
- **Backend API**: see [backend/AgroFlow.Api/README.md](backend/AgroFlow.Api/README.md)
- **Firmware**: see [hardware/README.md](hardware/README.md) for the overall layout, or go straight to [hardware/esp32/AgroFlowIrrigationNode/README.md](hardware/esp32/AgroFlowIrrigationNode/README.md) for setup instructions
- **Database**: apply `supabase/migrations/*.sql` in order (via the Supabase CLI or SQL editor) against a Supabase project

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
