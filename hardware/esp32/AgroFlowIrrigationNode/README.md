# AgroFlowIrrigationNode

ESP32 firmware for one irrigation zone: reads a soil moisture probe and a DHT11,
drives a relay-controlled pump, and talks to `AgroFlow.Api` over MQTT and HTTP.
The watering decisions (health status, when to start and stop) are made on the
server; the board reports readings and carries out commands, with a 5-minute
safety cap on every run and a simple offline fallback.

The comment block at the top of `AgroFlowIrrigationNode.ino` is the full
picture. MQTT topics and payloads: [`../../shared/MQTT_TOPICS.md`](../../shared/MQTT_TOPICS.md).
Step-by-step bring-up of a new kit (board settings, wiring, enrollment, what the
Serial Monitor should say): [`docs/hardware-bringup.md`](../../../docs/hardware-bringup.md).

## Files

| File | What it is |
|---|---|
| `AgroFlowIrrigationNode.ino` | the sketch |
| `OfflineBuffer.h` | the offline ring buffer and replay, plain C++ (no Arduino headers) so it is unit-tested natively: [`../tests/`](../tests/) |
| `CommandIds.h` | the last 32 command IDs the kit carried out, so a repeat is acknowledged again but never run twice; plain C++, unit-tested natively |
| `RunLimits.h` | how long a run may last; plain C++, unit-tested natively |
| `secrets.example.h` | copy to `secrets.h` (gitignored); holds only `API_BASE_URL`, which is not a secret |

## Board and libraries

ESP32 Dev Module, arduino-esp32 core **3.3.11** (Boards Manager). Libraries, from
the Library Manager:

| Library | Version tested | Header |
|---|---|---|
| ArduinoJson (Benoit Blanchon) | 7.4.3 | `ArduinoJson.h` |
| WiFiManager (tzapu) | 2.0.17 | `WiFiManager.h` |
| PubSubClient (Nick O'Leary) | 2.8 | `PubSubClient.h` |
| DHT sensor library for ESPx (beegee_tokyo) | 1.19 | `DHTesp.h` |

Not Adafruit's "DHT sensor library": it has `DHT.h`, not `DHTesp.h`, and the
sketch will not compile with it alone. `WiFi.h`, `WiFiClientSecure.h`,
`HTTPClient.h`, `HTTPUpdate.h`, `WebServer.h` and `Preferences.h` come with the core.

v1.7.0 uses 92% (1,217,328 of 1,310,720 bytes) of the default "Default 4MB with spiffs"
app partition, compiled with esp32 core 3.3.11. If a later change does not fit, pick
**Tools → Partition Scheme → Minimal SPIFFS (1.9MB APP with OTA)**; OTA keeps working.

## How long a run lasts (v1.6.0)

- **Each zone has a maximum run time**, 1 to 120 minutes (5 by default), set by staff on
  the farm's page in the admin site. Every command carries it as `maxRunSeconds`, and the
  board runs **min(asked, maximum)**, never more than `ABSOLUTE_MAX_RUN_MS` (120 minutes).
  A command with no maximum (an older server) runs at most 5 minutes.
- **Lost-connection stop.** A run the server started stops when the board has had no MQTT
  contact for 3 minutes (`LOST_CONTACT_STOP_MS`), so a lost "stop" can never leave the pump
  on. The run is kept and uploaded when it is back, like any offline run.
- The rule lives in `RunLimits.h` and is unit-tested natively (`hardware/esp32/tests`).

## What the board does when the internet is down (v1.7.0)

- **Readings are kept.** While MQTT is down it keeps every 30-second soil + temperature +
  humidity sample in flash: 180 readings, about 30 minutes. When
  full, the oldest goes first. A power cut does not lose them. On reconnect they
  are published oldest first with their own time (`recordedAt`), a few per loop
  so watering and the safety cap keep running. The server stores them but never
  starts automatic watering from a reading more than 10 minutes old.
- **Pump runs are kept.** A run the server did not hear about (local page,
  offline fallback, a failed report) is kept in flash (32 runs) and uploaded as
  an `offline_queued` irrigation event on reconnect. The server ignores a repeat
  of the same run.
- **Offline fallback, Automatic zones only.** After 10 minutes without MQTT the
  board waters by itself from the raw soil reading (start at raw ≥ 2600, stop at
  ≤ 2300, at most 60 s a run, 5 minutes' rest between runs), but only if the last
  answer from `GET /api/devices/config` (boot, then every 10 minutes online, kept
  in flash) said the zone is Automatic. A Manual or Scheduled zone, or a kit that
  has never had an answer, is never watered by the kit on its own.
- **A command runs once.** The kit keeps the last 32 command IDs in flash, each with
  the time it first acknowledged it, and saves a new ID before it acts. When the API
  resends a command whose acknowledgement was lost (or MQTT delivers it twice), the kit
  acknowledges it again with that first time and does not water again, even after a reboot.
- **The backlog is in the kit's status.** Every reading carries `backlog`, the readings
  still waiting to upload; the admin **Kits** page and the farmer's kit screen show it.

## Local page (no internet needed)

When the setup network is open, a phone joined to it can open
**http://192.168.4.1/local** (or press **Kit readings and pump** on the setup
page) to see the latest readings and start or stop the pump.

- Opening the setup network: power-cycle the kit 3 times quickly (within ~10 s
  each); it also opens by itself when the saved WiFi has been gone 15 minutes,
  and from the admin's "Open setup page" button (Kits) while the kit is online.
- Network: `AgroFlow-Setup-XXXX` (last 4 characters of the device ID), password
  `AF-` + the last 6 characters of the device ID (on the kit label). 2.4 GHz only.
- The page asks for a login: user **`agroflow`**, password **the same `AF-…`
  password**. It only answers on the kit's own WiFi, never on the farm's router.
- A run is 1 to 5 minutes and stops by itself; the 5-minute safety cap applies
  as to every run. It is logged as a **manual** irrigation event (uploaded when
  the kit is back online).
- The setup network stays open while a phone is connected to it.
- In this mode the setup menu has no firmware-upload page; updates come by OTA.

## Secrets

```bash
cd hardware/esp32/AgroFlowIrrigationNode
cp secrets.example.h secrets.h
```

`secrets.h` holds `API_BASE_URL` only. No key, password or token is compiled in:
the board gets its own device token from `POST /api/devices/claim` (the one-time
enrollment code authorises that call) and keeps it in flash, and it fetches its
MQTT login from `GET /api/devices/mqtt-credentials` on every boot (RAM only).

## Fixed settings (top of the `.ino`)

| Constant | Value | Notes |
|---|---|---|
| `MOISTURE_PIN` | 32 | YL-69 AO, ADC1 (works with WiFi on) |
| `RELAY_PIN` | 25 | `RELAY_ACTIVE_LOW = true` |
| `DHT_PIN` | 27 | DHT11 data |
| `ADC_DRY` / `ADC_WET` | 4095 / 1550 | raw → % for the report; the app's wet/dry setup is the real calibration |
| `ABSOLUTE_MAX_RUN_MS` | 120 minutes | the ceiling for every run, whatever a command says |
| `DEFAULT_MAX_RUN_MS` | 5 minutes | a command with no `maxRunSeconds` |
| `LOST_CONTACT_STOP_MS` | 3 minutes | a server-started run stops after this long without MQTT |
| `LOCAL_MAX_RUN_MS` | 5 minutes | the local page's own limit |
| `SENSOR_REPORT_INTERVAL_MS` | 30 s | live readings |
| `FIRMWARE_VERSION` | 1.7.0 | match `Firmware:LatestVersion` on the API when the `.bin` is hosted |

`ZONE_ID` and `FARM_ID` are not settings: they come back from the claim and are
kept in flash.
