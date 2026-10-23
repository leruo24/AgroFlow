# Kit simulation (end to end, no hardware)

Runs the **real** `AgroFlow.Api` against a throwaway local Postgres with **every migration
applied** and a local MQTT broker, and drives it with a pretend kit that follows firmware
1.7.0's contract. Nothing reaches the live database, HiveMQ, Supabase or Telegram.

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
| A 10-minute broker outage is recovered | the broker stops, twenty 30-second three-sensor samples queue, the broker restarts, and all 60 upload oldest first with their measured times |
| Replayed readings are stored once | the oldest buffered MQTT message is retried; the per-kit/type/measured-time key still produces 60 rows, not 61 |
| An old buffered reading does not start automatic watering | no `irrigation_commands` row after the old dry sample, on an automatic zone |
| Control: a live reading of the same value does | the same dry value, live: an `auto` `start` reaches the kit |
| A manual 1-minute command reaches the kit and is acknowledged | an `irrigation_commands` row (what Water now creates) → MQTT → `POST .../executed` → `executed` |
| The run is logged | `POST /api/irrigation-events`: a `manual` event of 60 s |
| A pump run kept offline and uploaded twice is counted once | two identical `offline_queued` events: one row |
| The backlog shows in the kit's status | every replayed reading carries `backlog`; `hardware.offline_backlog` reads 30 halfway through the 60 and 0 at the end |
| A lost acknowledgement does not water twice | the kit waters, its acknowledgement is dropped, the API resends (replay sweep, 5 s here); the kit acknowledges again with the first time and does not water; a rebooted kit with the same flash also refuses it |
| A Manual zone is never watered automatically | a bone-dry live reading on a Manual zone: no command; `GET /api/devices/config` says `autoWateringAllowed: false` (true once Automatic) |
| Every command carries the zone's maximum run time | `maxRunSeconds` 300 by default; a zone limited to 3 min sends 180 for a 600 s request, and the kit runs 180 |
| A finished run marks its command finished | the run report sets `irrigation_commands.finished_at` and `irrigation_event.command_id` (migration 0051) |
| Lost-connection failsafe | MQTT dropped during a 2-minute run: the kit stops after 3 s here (3 min on the board) and the run is still reported |
| The API's farmer and admin routes on this database | `SimDatabaseTests` (8): no kit and kit offline refused (409), over the zone maximum refused (400), sent -> started -> finished through the real device routes, staff set the maximum (farmers cannot, the database checks 1-120), staff Telegram refused and unlinked with an audit row, staff cannot get a temporary password, a frost warning saved in the app once. `node run-db-tests.mjs` runs only these. |

## What it does not cover

- **The admin and farmer endpoints** need a Supabase login (JWT), which this has no way to
  issue. Their database effect is written directly: the farmer, farm, zone and the kit's
  enrollment row (what **Register a kit** creates), and the command row (what **Water now**
  creates). The routes themselves run in `SimDatabaseTests` against the same database, with
  the test sign-in. The device side — claim, credentials, MQTT both ways, ACK, events — is the real
  API code.
- **Supabase itself.** `supabase-shim.sql` adds the few Supabase objects the migrations
  expect (`auth.users`, `auth.uid()`, the `anon` / `authenticated` / `service_role` roles, a
  no-op `cron.schedule`). RLS policies are created but no client logs in.
- **TLS and HiveMQ.** The broker is plain MQTT 3.1.1 on localhost; the API is run with
  `Mqtt__UseTls=false` and `Mqtt__ProtocolVersion=311` (both unset in production).
- **The firmware's own code.** The kit here is JavaScript following the same contract; the
  sketch is compile-checked with arduino-cli and its buffer is unit-tested natively
  (`hardware/esp32/tests`).

## Migrations replay as written

Every migration is applied to the empty database exactly as written (only pg_cron's
`create extension` is skipped). The simulation used to drop `zone_latest_reading` before 0007
and 0010, which failed on an empty database; fix/migration-replay guarded those two files,
so the workaround is gone.
