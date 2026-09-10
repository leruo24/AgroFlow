# AgroFlow.Api

ASP.NET Core Web API (net8.0, minimal APIs) — the backend ESP32 devices and
admin actions talk to. References `../AgroFlow.Domain/AgroFlow.Domain.csproj` directly for the
`AgroFlow.Business` domain model (`Zone.CalculateHealthStatus`,
`ShouldStartIrrigation`/`ShouldStopIrrigation`, `AddWaterUsage`), which is
where irrigation decision logic actually lives.

## Run

```bash
cd backend/AgroFlow.Api
dotnet build
dotnet run
```

Requires `appsettings.json` filled in first — see Configuration below.

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

## Configuration (`appsettings.json`)

| Key | Where to find it | Notes |
|---|---|---|
| `ConnectionStrings:Supabase` | Supabase dashboard → Project Settings → Database → Connection string | Direct Postgres connection (not the REST API) |
| `ApiKey` | You choose it | Must exactly match `API_KEY` in the firmware's `.ino` |
| `Supabase:Url` | Project Settings → API | e.g. `https://<project-ref>.supabase.co` |
| `Supabase:ServiceRoleKey` | Project Settings → API → `service_role` key | Bypasses Row Level Security — server-side only, never expose to a client app |
| `Supabase:JwksUrl` | `{Supabase:Url}/auth/v1/.well-known/jwks.json` | Used to validate admin bearer tokens |
| `Firmware:LatestVersion` / `Firmware:DownloadUrl` | You set these per release | `DownloadUrl` must point at an actual hosted `.bin` — this project doesn't host firmware binaries itself |
| `Mqtt:Host` / `Port` / `Username` / `Password` | HiveMQ Cloud console → your cluster → Access Management | |

**`appsettings.json` is not gitignored.** Once you've filled in real values,
either keep that in mind before committing, or move secrets to
`appsettings.Local.json` / environment variables / user-secrets first.

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
