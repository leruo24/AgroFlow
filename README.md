# AgroFlow

Smart irrigation for small farms: ESP32 field kits, a Supabase/Postgres
database with Row Level Security, a .NET API that talks to the hardware and
runs the FAO-56 water-balance engine, a farmer-facing mobile app, and an
admin web console with a public landing page.

The irrigation advice is deterministic: every recommendation comes from the
FAO-56 water balance (crop, soil, weather and sensor readings), and the same
inputs always give the same answer. See [docs/engine/rule-book.md](docs/engine/rule-book.md).

## Repository layout

| Path | What it is |
|---|---|
| [`apps/mobile/`](apps/mobile/) | Expo / React Native app for farmers (Android, iOS and an installable web build). Signs in with Supabase Auth and reads its own farm's data directly, scoped by RLS. |
| [`apps/web/admin/`](apps/web/admin/) | Vite + TypeScript admin console, the public landing page, the interactive 3D field controller and the Experience AgroFlow demo. Playwright tests in `tests/`. |
| [`backend/`](backend/) | `AgroFlow.Api` (ASP.NET Core 8: MQTT bridge, device enrollment, reports, Telegram, weather collection), `AgroFlow.Domain` (domain model in the DB / XDB / Controller pattern, the FAO-56 engine and the rule book), `AgroFlow.Domain.Tests` (xUnit). |
| [`hardware/`](hardware/) | ESP32 firmware, one sketch folder per device type, plus the shared MQTT topic notes. |
| [`supabase/`](supabase/) | `migrations/` (the schema history, applied in order), `diagnostics/`, and `scripts/` (`apply-migrations.ps1`, `replay-migrations.mjs`). |
| [`docs/`](docs/) | Engine documentation, feature notes, the UI contracts, diagrams, operations helpers and sample reports. See [docs/README.md](docs/README.md). |
| `Dockerfile`, `.dockerignore` | The Railway image for `backend/AgroFlow.Api`. The build context is the repo root because the Api references the sibling Domain project. |

## Architecture

```
ESP32 kit (per irrigation zone)
  ├─ MQTT (HiveMQ Cloud, TLS) ── sensor readings, irrigation commands
  └─ HTTP (AgroFlow.Api)      ── enrollment, irrigation event logging, OTA check
        │
        ▼
  AgroFlow.Api (backend/AgroFlow.Api)
    - the only component that connects to Postgres with elevated rights
    - stores readings, runs the FAO-56 engine, decides and sends commands
    - enrollment, onboarding, reports (PDF / Excel), Telegram, weather
        │
        ▼
  Supabase (Postgres + Auth, Row Level Security: supabase/migrations/)
        ▲                               ▲
        │ RLS-scoped to the farmer      │ RLS-scoped to profile.role = 'admin'
  apps/mobile                     apps/web/admin
```

The two apps read and write their own data directly against Postgres with a
Supabase Auth session; Row Level Security is what limits a farmer to their own
farm and the console to admins. They call `AgroFlow.Api` only for what a
client cannot do itself: hardware over MQTT, enrollment, reports, and anything
that needs the service role.

## Handover

### Deployed services

| Part | URL | Hosted on |
|---|---|---|
| Public site and admin console | https://agro-flow-gules.vercel.app (the console is at `/staff/`) | Vercel, built from `apps/web/admin` |
| Farmer web app | https://agroflow-mobile.vercel.app | Vercel, an Expo web export of `apps/mobile` |
| API | https://agroflow-production-998d.up.railway.app | Railway, built from the root `Dockerfile` |
| Database and auth | Supabase project `zcoalyxzvemiumnipufz` | Supabase |
| MQTT broker | HiveMQ Cloud; the host is in `backend/AgroFlow.Api/appsettings.json` | HiveMQ |

### Running each part locally

| Part | Commands |
|---|---|
| Mobile app | `cd apps/mobile`, `npm install`, copy `.env.example` to `.env`, then `npm start` (Expo). Tests: `npm test`. Type check: `npx tsc --noEmit`. |
| Admin console | `cd apps/web/admin`, `npm ci`, copy `.env.example` to `.env`, then `npm run dev` (http://localhost:5173). Build: `npm run build`. End-to-end tests (mocked backend, no live system): `npx playwright test`. |
| Backend API | `cd backend/AgroFlow.Api`, set the user-secrets listed in [backend/AgroFlow.Api/README.md](backend/AgroFlow.Api/README.md#run), then `dotnet run`. |
| Backend tests | `dotnet test backend/AgroFlow.Domain.Tests` |
| Firmware | Arduino IDE with the ESP32 core. Copy `hardware/esp32/AgroFlowIrrigationNode/secrets.example.h` to `secrets.h`, fill it in, then flash. See [hardware/README.md](hardware/README.md), [the irrigation node's setup guide](hardware/esp32/AgroFlowIrrigationNode/README.md) and [bringing up a kit](docs/features/hardware-bringup.md). |
| Kit simulation | `hardware/sim/` runs a local Postgres, MQTT broker and the real API end to end. See [hardware/sim/README.md](hardware/sim/README.md). |

### Secrets

The current tree holds no secrets. Each part reads them from a file or store
that git ignores:

| Part | Committed | Kept out of git |
|---|---|---|
| `apps/mobile`, `apps/web/admin` | `.env.example` | `.env`, copied from `.env.example` |
| `backend/AgroFlow.Api` | `appsettings.json` (non-secret settings) | .NET user-secrets locally (`dotnet user-secrets set ...`), environment variables on Railway: connection string, Supabase service-role key, `ApiKey`, MQTT password, Telegram token. See [backend/AgroFlow.Api/README.md](backend/AgroFlow.Api/README.md#configuration). |
| `hardware/esp32/AgroFlowIrrigationNode` | `secrets.example.h` | `secrets.h`, copied from `secrets.example.h` |

> **Rotate these:** an earlier `appsettings.json` (database password, `ApiKey`,
> Supabase service-role key, HiveMQ password) and the firmware's HiveMQ
> password were committed before the secrets were moved out. They remain in git
> history and must be rotated. History was deliberately left unrewritten.

### Database migrations

We apply migrations by hand in the Supabase SQL editor. There is no migration
runner, on purpose: the database holds real farm data.

1. `supabase/scripts/apply-migrations.ps1 -From <n>` puts migration `<n>` and
   every later one on the clipboard, in order.
2. Paste them into the SQL editor and run them.
3. Run `docs/ops/verify-migrations.sql`. Every row must be true.

We never edit a migration once it has been applied; a fix is a new numbered
file. `supabase/scripts/replay-migrations.mjs` replays the whole chain on an
empty local Postgres to check it still applies from scratch. The files are not
proof of the live schema, so check the live database (`supabase/diagnostics/`)
before relying on them.

## Where to read more

- What AgroFlow 2.0 does today: [docs/releases/release-notes-v2.md](docs/releases/release-notes-v2.md)
- How the irrigation advice is worked out: [docs/fao56-engine-report.md](docs/fao56-engine-report.md), [docs/engine/rule-book.md](docs/engine/rule-book.md), [docs/engine/fao56-engine-audit.md](docs/engine/fao56-engine-audit.md)
- Setting up a demo account: [docs/ops/demo-account.md](docs/ops/demo-account.md)
- Older reports, the September orientation notes and the showcase video project: tag `archive/pre-tidy-2026-10-10`
- Development reports, screenshot evidence, AI-agent notes and the course presentation removed for the handover: tag `archive/pre-handover-2026-10-30`
