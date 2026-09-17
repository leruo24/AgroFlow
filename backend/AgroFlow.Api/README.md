# AgroFlow.Api

ASP.NET Core Web API (net8.0, minimal APIs) — the backend ESP32 devices and
admin actions talk to. References `../AgroFlow.Domain/AgroFlow.Domain.csproj` directly for the
`AgroFlow.Business` domain model (`Zone.CalculateHealthStatus`,
`ShouldStartIrrigation`/`ShouldStopIrrigation`, `AddWaterUsage`), which is
where irrigation decision logic actually lives.

## Run

```bash
cd backend/AgroFlow.Api
dotnet user-secrets set "ConnectionStrings:Supabase" "Host=...;Password=...;..."
dotnet user-secrets set "Supabase:ServiceRoleKey" "sb_secret_..."
dotnet user-secrets set "ApiKey" "<shared device key>"
dotnet user-secrets set "Mqtt:Password" "<HiveMQ password>"
dotnet build
dotnet run
```

For Expo web, run this API alongside Metro. Development requests from
`localhost`/`127.0.0.1` are allowed across ports. For a deployed web app or
a browser opened on a LAN hostname, configure `Cors:AllowedOrigins:0` with
the exact web origin (for example via `Cors__AllowedOrigins__0`). Restart the
API after changing its code or CORS configuration; rebuilding alone does not
update an already-running process.

The four secrets above must be set first — the app throws on startup if the
connection string, `ApiKey`, `Supabase:JwksUrl`, or any `Mqtt:*` value is
missing. Everything else is in the committed `appsettings.json`. See
Configuration below.

## What it does

| Concern | Transport | Endpoint / mechanism |
|---|---|---|
| Sensor readings | MQTT | Subscribes `agroflow/farm/+/device/+/sensors` (see `hardware/shared/MQTT_TOPICS.md`) |
| Irrigation commands (out) | MQTT | Publishes `agroflow/farm/{farmId}/device/{deviceId}/commands` — triggered by a Postgres `LISTEN`/`NOTIFY` bridge, not a poll loop, so it picks up commands from *any* insert path (app, auto-irrigation logic, or the `pg_cron` schedule job) |
| Irrigation event logging | HTTP | `POST /api/irrigation-events` |
| Device enrollment | HTTP, admin-only | `POST /api/devices/enroll` |
| Device claim | HTTP, device shared-secret | `POST /api/devices/claim` |
| OTA version check | HTTP, device shared-secret | `GET /api/devices/firmware-check` |
| Farmer onboarding (direct create) | HTTP, admin-only | `POST /api/farmers/create` |
| Farmer onboarding (invite link) | HTTP, admin-only | `POST /api/farmers/invite` |
| Sensor readings (fallback) | HTTP | `POST /api/sensor-readings` — same processing as the MQTT path, shared via `Services/SensorReadingProcessor.cs` |

## Auth model

Two separate mechanisms, not one:

- **Device-facing endpoints** (`sensor-readings`, `irrigation-events`,
  `devices/claim`, `devices/firmware-check`) require an `X-Api-Key` header
  matching `ApiKey` in config — a single shared secret baked into every
  board's firmware, proving "this is a genuine AgroFlow device," not any
  individual device's identity (that's what enrollment/claim establishes).
- **Admin-facing endpoints** (`devices/enroll`, `farmers/*`) require a
  Supabase Auth JWT bearer token, validated against Supabase's JWKS endpoint
  (`Supabase:JwksUrl`), plus a `profile.role = 'admin'` database check
  (`Auth/AdminOnlyFilter.cs`) — a valid token only proves a real logged-in
  user, not that they're an admin.

## Configuration

Config is split by sensitivity:

- **`appsettings.json`** — committed, no secrets. Holds `Logging`,
  `AllowedHosts`, `Supabase:Url`, `Supabase:JwksUrl`, `Firmware:*`, and
  `Mqtt:Host` / `Mqtt:Port` / `Mqtt:Username`.
- **.NET user-secrets** (`dotnet user-secrets`, keyed by the `UserSecretsId`
  in `AgroFlow.Api.csproj`, stored outside the repo) — the four secrets.
  In CI/production, supply the same keys via environment variables instead
  (`ConnectionStrings__Supabase`, `Supabase__ServiceRoleKey`, `ApiKey`,
  `Mqtt__Password`).

| Key | Location | Where to find it | Notes |
|---|---|---|---|
| `ConnectionStrings:Supabase` | **user-secrets** | Supabase dashboard → Project Settings → Database → Connection string | Direct Postgres connection (not the REST API) |
| `ApiKey` | **user-secrets** | You choose it | Must exactly match `API_KEY` in the firmware's `secrets.h` |
| `Supabase:ServiceRoleKey` | **user-secrets** | Project Settings → API → `service_role` key | Bypasses Row Level Security — server-side only, never expose to a client app |
| `Mqtt:Password` | **user-secrets** | HiveMQ Cloud console → your cluster → Access Management | Password for the `Mqtt:Username` account |
| `Supabase:Url` | `appsettings.json` | Project Settings → API | e.g. `https://<project-ref>.supabase.co` |
| `Supabase:JwksUrl` | `appsettings.json` | `{Supabase:Url}/auth/v1/.well-known/jwks.json` | Used to validate admin bearer tokens |
| `Firmware:LatestVersion` / `Firmware:DownloadUrl` | `appsettings.json` | You set these per release | `DownloadUrl` must point at an actual hosted `.bin` — this project doesn't host firmware binaries itself |
| `Mqtt:Host` / `Mqtt:Port` / `Mqtt:Username` | `appsettings.json` | HiveMQ Cloud console → your cluster → Access Management | Endpoint identity, not a credential |
| `Cors:AllowedOrigins` | deployment configuration | Your Expo web origin(s) | Exact browser origins allowed to call the API; local loopback origins are allowed only in Development |

> A real `appsettings.json` with live secrets (DB password, `ApiKey`,
> `service_role` key, HiveMQ password) was committed under the old
> `api/AgroFlow.Api/` path before this split. Those values are still in git
> history and must be rotated.

## Project structure

```
Program.cs                              Composition root: auth, MQTT wiring, middleware, route registration
Endpoints/
  SensorReadingEndpoints.cs             HTTP entry point for sensor readings
  IrrigationEventEndpoints.cs           Irrigation event logging + water-usage update
  DeviceEnrollmentEndpoints.cs          Enroll / claim / firmware-check
  FarmerOnboardingEndpoints.cs          Admin-triggered farmer create/invite via Supabase Admin Auth API
Services/
  SensorReadingProcessor.cs             Shared insert + health/auto-irrigation logic (HTTP and MQTT both call this)
Mqtt/
  MqttConnectionService.cs              Owns the single HiveMQ connection (pub + sub)
  IrrigationCommandNotifyService.cs     Postgres LISTEN/NOTIFY → MQTT publish bridge
  MqttTopics.cs                         Topic building/parsing - see hardware/shared/MQTT_TOPICS.md
Auth/
  AdminOnlyFilter.cs                    profile.role = 'admin' check for admin-only endpoints
```
