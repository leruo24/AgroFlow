# Kit simulation (end to end, no hardware)

Runs the **real** `AgroFlow.Api` against a throwaway local Postgres with **every migration
applied** and a local MQTT broker, and drives it with a pretend kit that follows firmware
1.5.0's contract. Nothing reaches the live database, HiveMQ, Supabase or Telegram.

```bash
cd hardware/sim
npm install
node run-e2e.mjs        # exit code 0 = every check passed
```

Needs Node 20+ and the .NET 8 SDK. No Docker: Postgres comes from the `embedded-postgres`
package (PostgreSQL 17 binaries) and the broker is `aedes` (pure Node). `SIM_VERBOSE=1`
prints the API's log and the broker's connections.

## What it checks

| Check | How |
|---|---|
| The kit enrols with a one-time code, and the code works once | `POST /api/devices/claim`, then the same code again (401) |
| The kit shows online | `hardware.status = 'Online'`, `enrollment_status = 'active'`, `last_seen` within a minute |
| Readings are stored | three rounds of soil, temperature and humidity over MQTT, every 2 s |
| Late readings are accepted with their own time, once | a soil reading with `recordedAt` 3 hours ago, sent twice: one row, at that time |
| ... and do not start automatic watering | no `irrigation_commands` row after it, on an automatic zone |
| Control: a live reading of the same value does | the same dry value, live: an `auto` `start` reaches the kit |
| A manual 1-minute command reaches the kit and is acknowledged | an `irrigation_commands` row (what Water now creates) → MQTT → `POST .../executed` → `executed` |
| The run is logged | `POST /api/irrigation-events`: a `manual` event of 60 s |
| A pump run kept offline and uploaded twice is counted once | two identical `offline_queued` events: one row |

## What it does not cover

- **The admin and farmer endpoints** need a Supabase login (JWT), which this has no way to
  issue. Their database effect is written directly: the farmer, farm, zone and the kit's
  enrollment row (what **Register a kit** creates), and the command row (what **Water now**
  creates). The device side — claim, credentials, MQTT both ways, ACK, events — is the real
  API code.
- **Supabase itself.** `supabase-shim.sql` adds the few Supabase objects the migrations
  expect (`auth.users`, `auth.uid()`, the `anon` / `authenticated` / `service_role` roles, a
  no-op `cron.schedule`). RLS policies are created but no client logs in.
- **TLS and HiveMQ.** The broker is plain MQTT 3.1.1 on localhost; the API is run with
  `Mqtt__UseTls=false` and `Mqtt__ProtocolVersion=311` (both unset in production).
- **The firmware's own code.** The kit here is JavaScript following the same contract; the
  sketch is compile-checked with arduino-cli and its buffer is unit-tested natively
  (`hardware/esp32/tests`).

## A finding from building it

The migrations do not replay on an **empty** database as they are: `0007` (and later `0010`)
redefine `zone_latest_reading` with `create or replace view` while renaming its columns,
which Postgres refuses. The live database never replayed from empty (0047 repairs its
drift), so this only matters for a fresh install. The simulation drops that view just before
each of those two migrations; the migration files are unchanged.
