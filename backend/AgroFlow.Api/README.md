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
dotnet user-secrets set "Telegram:BotToken" "<from @BotFather>"
dotnet build
dotnet run
```

For Expo web, run this API alongside Metro. Development requests from
`localhost`/`127.0.0.1` are allowed across ports. For a deployed web app or
a browser opened on a LAN hostname, configure `Cors:AllowedOrigins:0` with
the exact web origin (for example via `Cors__AllowedOrigins__0`). Restart the
API after changing its code or CORS configuration; rebuilding alone does not
update an already-running process.

### CORS (which websites may call the API)

There is one policy, `AgroFlowWeb` (`Services/CorsSetup.cs`), applied once in
`Program.cs`. It allows:

- every origin listed in `Cors:AllowedOrigins`, matched exactly (scheme, host
  and port; case and a trailing `/` do not matter);
- the local dev origins `http://localhost:5173`, `:5174` (admin, Vite),
  `:8081` and `:19006` (mobile, Expo web), in every environment;
- in Development only, any `http(s)` loopback origin on any port.

Any header and method is allowed; credentials (cookies) are not. Every route
still checks its own JWT or device key, so CORS decides only which websites a
browser lets read the answers. Error answers (401, 500, 503) carry the header
too, so the admin shows the API's sentence rather than "Failed to fetch".

On **Railway**, set one variable per website, numbered from 0, with no
trailing path:

| Variable | Example value |
|---|---|
| `Cors__AllowedOrigins__0` | `https://<github-user>.github.io` (the admin console on GitHub Pages) |
| `Cors__AllowedOrigins__1` | the mobile web app's origin, if it is hosted |
| `Cors__AllowedOrigins__N` | any further website, one per number |

An origin is only `scheme://host[:port]` - for a site served from
`https://<user>.github.io/agroflow/`, the origin is `https://<user>.github.io`.
Railway restarts the service when a variable changes.

`Telegram:BotToken` is optional locally: with no token the API starts
normally and every farmer notification becomes a logged no-op. The other four
secrets must be set first — the app throws on startup if the
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
| Farmer onboarding (full, on-site) | HTTP, admin-only | `POST /api/farmers/onboard` — creates farm + auth user + zones, then returns a one-time temporary password and a Telegram QR deep link |
| Telegram link codes | HTTP, admin-only | `POST /api/telegram/admin/codes/{profileId}` (regenerate), `POST /api/telegram/admin/password/{profileId}` (reset temporary password) |
| Telegram self-service | HTTP, signed-in farmer | `GET/POST/DELETE /api/telegram/me*` — link, alert toggle, unlink. Issues a `link` code, which does **not** touch the farmer's password; admin-issued codes are `onboarding` codes and do reset it (migration 0025) |
| Farmer notifications (out) | Telegram Bot API | `Services/Notifications/` — welcome, critical moisture, irrigation start/stop, device offline/online, request status |
| Inbound bot commands | Telegram long poll | `Services/Notifications/TelegramPollingService.cs` — `/start <code>`, `/status`, `/alerts on\|off`, `/help` |
| Device liveness | Background sweep | `Services/DeviceStatusMonitorService.cs` — marks hardware Offline/Online and alerts on the transition |
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
| `Cors:AllowedOrigins` | deployment configuration (Railway: `Cors__AllowedOrigins__0..N`) | The admin console's and web app's origins | Exact browser origins allowed to call the API, on top of the fixed local dev origins; any other loopback origin only in Development. See CORS above |
| `Telegram:BotToken` | **user-secrets / Railway** | @BotFather → `/newbot` or `/token` | Never commit. Absent ⇒ notifications become no-ops instead of failing |
| `Telegram:BotUsername` | `appsettings.json` | The bot's @name, without the `@` | Only used to build the `t.me/<bot>?start=<code>` deep link the admin screen renders as a QR |
| `Telegram:EnablePolling` | deployment configuration | — | **Exactly one running instance may set this true.** Defaults to `false`; Railway sets `Telegram__EnablePolling=true`. Two pollers on one token steal each other's `/start` messages (HTTP 409) |
| `Apk:DownloadUrl` | `appsettings.json` / Railway | Wherever the built APK is hosted | Empty ⇒ the bot tells new farmers the app is "coming soon" rather than sending a dead link |
| `DeviceMonitor:*` | `appsettings.json` | — | `OfflineAfterMinutes` (default 30), `CheckIntervalMinutes` (default 5), `Enabled` |
| `Logging:LogLevel:Npgsql` | `appsettings.json` | — | `Warning`. Npgsql logs connection waits and command text per statement; with sensor ingestion, the LISTEN/NOTIFY bridge and the device-status sweep all running, that buries everything worth reading. Raise to `Information` temporarily when debugging a query |
| `Logging:LogLevel:AgroFlow.Api` | `appsettings.json` | — | `Information`, stated explicitly so that lowering `Default` to quieten a dependency cannot silently take our own services (Telegram, weather, MQTT, irrigation) with it |

> Every logger in this project sits under the `AgroFlow.Api.*` category, so
> that one rule covers all of them. The few endpoints that build a logger from
> `ILoggerFactory` rather than `ILogger<T>` name their category explicitly to
> match — `AgroFlow.Api.Endpoints.FarmerOnboarding` and friends. Keep that
> convention when adding one, or the new logger silently falls under `Default`
> instead.

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
  TelegramEndpoints.cs                  Admin code regeneration / password reset, and farmer self-service linking
Services/
  SensorReadingProcessor.cs             Shared insert + health/auto-irrigation logic (HTTP and MQTT both call this)
  DeviceStatusMonitorService.cs         Offline/Online transition detection for hardware
  SupabaseAdminService.cs               Supabase Admin Auth API (temporary password resets)
  TemporaryPasswordGenerator.cs         The one generator for every temporary password
  Notifications/
    INotificationService.cs             Channel-independent farmer notifications; implementations never throw
    TelegramClient.cs                   sendMessage / getUpdates
    TelegramNotificationService.cs      Message composition + recipient resolution
    TelegramOnboardingService.cs        Single-use link codes (issue / redeem)
    TelegramPollingService.cs           Inbound long poll - ONE instance only
    TelegramOptions.cs                  Telegram / Apk / DeviceMonitor options
Mqtt/
  MqttConnectionService.cs              Owns the single HiveMQ connection (pub + sub)
  IrrigationCommandNotifyService.cs     Postgres LISTEN/NOTIFY → MQTT publish bridge
  MqttTopics.cs                         Topic building/parsing - see hardware/shared/MQTT_TOPICS.md
Auth/
  AdminOnlyFilter.cs                    profile.role = 'admin' check for admin-only endpoints
```
