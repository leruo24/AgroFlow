# AgroFlow.Domain

This .NET 8 project contains AgroFlow's domain model and deterministic
irrigation rules. It preserves the project's DB/XDB/Controller data-access
pattern and embeds the FAO-56 crop knowledge used by the engine.

## Run and build

```powershell
dotnet run --project backend/AgroFlow.Domain/AgroFlow.Domain.csproj
dotnet build backend/AgroFlow.Domain/AgroFlow.Domain.csproj
```

## Test

```powershell
dotnet test backend/AgroFlow.Domain.Tests/AgroFlow.Domain.Tests.csproj
```

## Main files

| Path | Purpose |
|---|---|
| `Agronomy/` | FAO-56 calculations, rule book, crop knowledge, and recommendations. |
| `DB.cs` | Shared database access used by the established DB classes. |
| `*DB.cs`, `*XDB.cs`, `*Controller.cs` | Existing database and controller pattern. |
| `Zone.cs`, `Weather.cs`, `Sensor.cs`, `Hardware.cs` | Core farm and device domain types. |
| `Program.cs` | Domain console entry point. |

Do not change the FAO-56 engine or DB/XDB/Controller conventions as part of
general cleanup work; their behavior is covered by the xUnit suite and rule-book
documentation.
