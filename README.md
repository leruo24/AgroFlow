# AgroFlow

AgroFlow is a smart-irrigation platform for small farms. An ESP32 field kit
reports sensor readings and operates a pump; a .NET 8 API handles devices,
recommendations, reports, notifications, and integrations; Supabase provides
Postgres and authentication; and the farmer and staff apps provide the user
interfaces.

Irrigation advice is deterministic and based on the project's FAO-56 water
balance. See the [engine rule book](docs/engine/rule-book.md) for the implemented
rules.

## Folder map

| Path | Purpose |
|---|---|
| [`apps/mobile/`](apps/mobile/README.md) | Expo farmer app for Android and the web. |
| [`apps/web/admin/`](apps/web/admin/README.md) | Vite product site and staff console. |
| [`backend/AgroFlow.Api/`](backend/AgroFlow.Api/README.md) | ASP.NET Core API, MQTT bridge, reports, weather, and notifications. |
| [`backend/AgroFlow.Domain/`](backend/AgroFlow.Domain/README.md) | Domain model and irrigation decision engine. |
| `backend/AgroFlow.Domain.Tests/` | xUnit tests for the domain and API. |
| [`hardware/esp32/`](hardware/esp32/README.md) | ESP32 irrigation-node firmware and native tests. |
| [`hardware/sim/`](hardware/sim/README.md) | End-to-end kit simulation using local Postgres and MQTT. |
| [`supabase/`](supabase/README.md) | Applied database migrations, diagnostics, and migration helpers. |
| [`docs/`](docs/README.md) | Architecture, operations, release, presentation, report, and test evidence. |

The root `Dockerfile` builds the API for Railway. Deployment manifests and
folder locations are part of the deployment contract and should not be moved.

## Local checks

Run commands from the repository root unless a row says otherwise.

| Part | Install/run | Checks |
|---|---|---|
| Backend | `dotnet run --project backend/AgroFlow.Api/AgroFlow.Api.csproj` | `dotnet build backend/AgroFlow.Api/AgroFlow.Api.csproj`; `dotnet test backend/AgroFlow.Domain.Tests/AgroFlow.Domain.Tests.csproj` |
| Admin web | `cd apps/web/admin`; `npm ci`; `npm run dev` | `npm run build`; `npx playwright test` |
| Farmer app | `cd apps/mobile`; `npm ci`; `npm start` | `npx tsc --noEmit`; `npx jest`; `npx expo export --platform web` |
| Hardware simulation | `cd hardware/sim`; `npm ci` | `node run-e2e.mjs` |
| ESP32 native code | See [`hardware/esp32/tests/README.md`](hardware/esp32/tests/README.md) | Build and run both C++ test programs. |

Copy each app's `.env.example` to its local `.env` before development. Backend
secrets belong in .NET user-secrets locally and deployment environment variables
in Railway. Never commit real credentials.

## Deployment

| Deliverable | Deployment path |
|---|---|
| Product site and staff console | Vercel builds `apps/web/admin` with `npm run build` and serves `dist/`. |
| Farmer web app | Vercel builds `apps/mobile` with `npx expo export --platform web` and serves `dist/`; `apps/mobile/vercel.json` supplies the router rewrite. |
| Android APK | Expo Application Services uses `apps/mobile/eas.json`; publish the resulting APK at the URL configured for the product site. |
| API | Railway builds the root `Dockerfile`, whose build context includes both backend projects. Runtime configuration is supplied by Railway variables. |
| Database | Apply `supabase/migrations` to Supabase in numeric order. Existing migration files are immutable because they have already been applied live. |
| Firmware | Build and flash `hardware/esp32/AgroFlowIrrigationNode` with the documented ESP32 toolchain; compiled firmware is not committed. |

## Documentation

Start with [`docs/README.md`](docs/README.md). The main references are the
[release notes](docs/releases/release-notes-v2.md), [FAO-56 engine report](docs/fao56-engine-report.md),
[rule book](docs/engine/rule-book.md), [hardware bring-up guide](docs/hardware-bringup.md),
and [test evidence index](docs/test-evidence/README.md).

The repository-cleanup findings and verification matrix are in
[`docs/cleanup-report.md`](docs/cleanup-report.md).
