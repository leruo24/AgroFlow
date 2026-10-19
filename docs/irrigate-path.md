# The Irrigate path, end to end

Traced on the real code (branch `fix/irrigate-path`, off `dev`; `feat/kit-offline` is not merged
into dev, so this branch does not include it). Each hop names the file that does it.

| # | Hop | Where | Contract |
|---|---|---|---|
| 1 | Farmer presses **Start Manual Run** (zone screen), confirms | `apps/mobile/src/app/zone/[id].tsx` `handleStartManualRun` → `AgroFlowContext.startManualIrrigation` | 1–5 minutes (the kit's cap), default 5 |
| 2 | App calls the API | `apps/mobile/src/services/agroFlowApi.ts` `sendManualIrrigationCommand` → `POST /api/farmer/zones/{zoneId}/commands` | Supabase JWT; body `{ command: "start", durationSeconds }` |
| 3 | API checks access and inserts the command | `backend/AgroFlow.Api/Endpoints/FarmerEndpoints.cs` `CreateManualCommandAsync` | owner or farm member only; `irrigation_commands(zone_id, command, source='manual', duration_seconds)`; 202 `{ id }` |
| 4 | A trigger announces it | `supabase/migrations/0009_mqtt_and_device_identity.sql` `notify_irrigation_command()` | `pg_notify('irrigation_commands_channel', {id, zoneId, command, durationSeconds, source})` |
| 5 | The API hears it and publishes | `backend/AgroFlow.Api/Mqtt/IrrigationCommandNotifyService.cs` (LISTEN + a sweep every 120 s + a replay on MQTT connect) | to every **active** kit on the zone with a `device_id`; topic `agroflow/farm/{zone.farm_id}/device/{hardware.device_id}/commands` (`MqttTopics.CommandsTopic`); pending for more than 2 h → `failed` (`CommandReplayPolicy`) |
| 6 | The kit receives it | `hardware/esp32/AgroFlowIrrigationNode/AgroFlowIrrigationNode.ino` `handleMqttCommand` | subscribed to `agroflow/farm/{FARM_ID}/device/{getDeviceId()}/commands` (both from the claim); reads `id`, `command`, `durationSeconds`, `source` |
| 7 | Relay on, stops by itself | `startPumpCycle` / `checkDurationDeadline` / `checkSafetyCap` | GPIO 25, active LOW; the duration deadline, and **5 minutes at most** whatever was asked |
| 8 | ACK | `markCommandExecuted` → `POST /api/devices/commands/{id}/executed` → `DeviceCommandEndpoints.cs` | `X-Device-Token`; only the zone's own kit; `pending` → `executed` (compare-and-set). Sent when the run **starts**, not when it ends |
| 9 | Run logged | `stopPumpCycle` → `logIrrigationEvent` → `POST /api/irrigation-events` → `IrrigationEventEndpoints.cs` | `X-Device-Token`; `trigger_source` = the command's `source` (`manual`), litres from `zone.flow_rate_lpm` |
| 10 | History | dashboard `events` → `AgroFlowContext` → History tab and the zone screen | `irrigation_event` rows for the farm |

Checked end to end in the simulation (`hardware/sim/run-e2e.mjs`, on `feat/kit-offline` merged
with this branch): the command reached the kit with `durationSeconds: 60`, the ACK set it
`executed`, and the event was logged as `manual`, 60 s.

## Breaks and mismatches

**Fixed on this branch**

1. **A zone saved as Manual read as Automatic in the app.** `mapZoneRow` turned every mode
   except `scheduled` into `automatic`, and the app's mode type had no `manual`. Choosing
   Manual on the zone screen was only a preview and never saved. Now `lib/irrigationMode.ts`
   maps all three both ways (anything unknown reads as Manual), Manual is saved like the other
   two, and the admin farm drawer shows each zone's mode.
2. **An offline kit watered a Manual zone by itself.** The firmware's offline fallback (after
   10 min without MQTT) did not know the zone's mode. New `GET /api/devices/config` (device
   token) answers `autoWateringAllowed`; firmware 1.4.1 asks on boot and every 10 minutes,
   keeps the answer in flash, and only falls back on an Automatic zone, never before it has
   had an answer.
3. **The app allowed runs of up to 60 minutes; the kit stops every run at 5.** The box now
   takes 1–5 minutes and starts at 5.

**Fixed on release/oct-19**

4. **Runs over 5 minutes.** The API now refuses a manual run over 300 s (400, "A run can be at
   most 5 minutes (300 seconds). The kit stops every run at 5 minutes."). Schedules can still
   be set longer than 5 minutes; the kit still cuts those at 5.
5. **No confirmation in the app.** After Irrigate the zone screen polls
   `GET /api/farmer/commands/{id}` and shows "Sending…" → "Kit started watering" (the ACK) →
   "Finished" (the kit's run report), or "Kit didn't respond — check it's online" after 60 s.
6. **A zone with no kit.** A start is refused at once (409 "No kit connected to this zone.",
   reason `no_kit` or `kit_offline`: not heard from in 5 minutes), and the app turns Irrigate
   off with the same words.
7. **"Executed" vs "finished".** `status = 'executed'` still means the kit started (the
   30-minute manual cooldown reads it). Migration **0051** adds `irrigation_commands.finished_at`
   and `irrigation_event.command_id`: when the kit reports a run, the API links it to the
   zone's started, unfinished start command with the same source and start time (2-minute
   margin) and sets `finished_at`. The API's state words are sent / started / finished /
   no_response / failed; History rows say "Watering finished".

## What a real Irrigate needs to be live

- **Database:** migrations through **0047** applied (0047 makes the `irrigation_mode` check
  allow `manual`; without it, saving Manual fails), and **0051** for "Finished" (without it the
  app shows at most "Kit started watering"). `docs/ops/verify-migrations.sql`.
- **Railway, `ConnectionStrings__Supabase`:** a connection that supports `LISTEN` — the
  **direct** connection or the **session** pooler (port **5432**). Through the transaction
  pooler (port 6543) NOTIFY never arrives and commands only go out on the 120 s sweep.
- **Railway, MQTT:** `Mqtt__Host`, `Mqtt__Port`, `Mqtt__Username`, `Mqtt__Password` for the
  API's own HiveMQ login, which must be allowed to **publish** `agroflow/farm/+/device/+/commands`
  and **subscribe** `agroflow/farm/+/device/+/sensors`. `Mqtt__PoolEncryptionKey` set, and
  per-kit logins pasted on **Kits → MQTT logins** (each allowed to publish its sensors topic
  and subscribe its commands topic); with none free, kits use the shared login.
  Leave `Mqtt__UseTls` and `Mqtt__ProtocolVersion` unset in production (they exist only on
  `feat/kit-offline`, for the simulation).
- **The kit:** registered in the console, claimed with its one-time code
  (`hardware.enrollment_status = 'active'`, `device_id` set), online. Firmware **1.4.1** (or
  1.5.1 once merged with kit-offline) for the mode-aware offline fallback.

## Merging with `feat/kit-offline`

Both change the sketch's version line and header notes, so git stops on
`AgroFlowIrrigationNode.ino` (three hunks). Keep both features: version **1.5.1**, header
notes 7 and 8 from kit-offline and this branch's zone-mode note as **9**. With that
resolution, the firmware compiles (92% of flash), `dotnet test` passes (1360), and the
simulation passes 15/15, including: a Manual zone gets no command from a bone-dry live
reading, `/api/devices/config` tells its kit not to water offline (and allows it once the
zone is Automatic), and Water now still reaches it.
