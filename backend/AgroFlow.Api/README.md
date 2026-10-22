# AgroFlow.Api

This .NET 8 minimal API connects AgroFlow's apps, Postgres database, MQTT
broker, ESP32 kits, weather provider, Telegram notifications, and report
generation. It references `AgroFlow.Domain` for the domain and irrigation rules.

## Run

Store local credentials with .NET user-secrets for this project, then run from
the repository root:

```powershell
dotnet restore backend/AgroFlow.Api/AgroFlow.Api.csproj
dotnet run --project backend/AgroFlow.Api/AgroFlow.Api.csproj
```

The committed settings file contains non-secret defaults. Keep connection,
service-role, device, MQTT, and Telegram credentials outside the repository.

## Test

```powershell
dotnet build backend/AgroFlow.Api/AgroFlow.Api.csproj
dotnet test backend/AgroFlow.Domain.Tests/AgroFlow.Domain.Tests.csproj
```

The end-to-end kit path is covered separately by `hardware/sim/run-e2e.mjs`.

## Main files

| Path | Purpose |
|---|---|
| `Program.cs` | Composition root, middleware, hosted services, and endpoint registration. |
| `Endpoints/` | Minimal API route groups and request/response contracts. |
| `Services/` | Database-backed application services, weather, reports, and notifications. |
| `Mqtt/` | MQTT connection, topics, and Postgres notification bridge. |
| `Auth/` | JWT and staff authorization helpers. |
| `Reports/` | PDF and spreadsheet report builders. |

Railway builds this service with the repository-root `Dockerfile`; the build
context must remain the repository root so the sibling Domain project is
available. Production configuration is supplied with Railway variables.
