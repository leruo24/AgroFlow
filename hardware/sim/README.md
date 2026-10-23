# Kit end-to-end simulation

This simulator runs the real `AgroFlow.Api` against a throwaway embedded
Postgres database and a local MQTT broker, then drives it with a JavaScript kit.
It applies every migration in order and does not contact the live database,
HiveMQ, Supabase, or Telegram.

## Run and test

Node 20+ and the .NET 8 SDK are required.

```powershell
cd hardware/sim
npm ci
node run-e2e.mjs
```

The command is the test: exit code 0 means the migration replay, API database
tests, device enrollment, readings, commands, safety limits, offline replay,
and drought/community scenarios passed.

## Main files

| Path | Purpose |
|---|---|
| `run-e2e.mjs` | Starts the temporary services and orchestrates the complete scenario. |
| `run-db-tests.mjs` | Runs the API database-test slice against the temporary database. |
| `fake-kit.mjs` | Simulated firmware-side MQTT and HTTP behavior. |
| `db.mjs` | Embedded Postgres lifecycle and migration replay. |
| `supabase-shim.sql` | Minimal local substitutes for Supabase-owned database objects. |

This validates the protocol around the firmware; it does not compile or execute
the ESP32 sketch itself.
