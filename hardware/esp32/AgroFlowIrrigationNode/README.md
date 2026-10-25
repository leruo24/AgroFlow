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

## Flash firmware 1.7.2

1. Arduino IDE → **File → Open** → `hardware/esp32/AgroFlowIrrigationNode/AgroFlowIrrigationNode.ino`.
2. Copy `secrets.example.h` to `secrets.h` in the same folder (it holds only `API_BASE_URL`).
3. **Tools**: Board **ESP32 Dev Module** (esp32 core 3.3.11), Upload Speed 921600,
   Partition Scheme **Default 4MB with spiffs**, and **Erase All Flash Before Sketch Upload: Enabled**
   for a kit that ran older firmware (it then starts unlinked, with the setup hotspot).
4. Libraries (Library Manager): ArduinoJson, PubSubClient, DHT sensor library for ESPx.
   WiFiManager is no longer needed.
5. Plug in the board, pick its port, press **Upload**. Serial Monitor at 115200 shows the
   `===== AgroFlow kit =====` block with the device ID and `Setup Wi-Fi: AgroFlow-Setup-XXXX (no password)`.

## Linking a kit (1.7.2)

In the admin site press **Add kit** on the farmer or the zone. It shows a 6-digit code (30 minutes)
and the steps. On the installer's phone:

1. The farm Wi-Fi must be **2.4 GHz**; have its password ready.
2. Plug in the kit.
3. In the phone's Wi-Fi list tap **AgroFlow-Setup-XXXX** (no password).
4. The setup page opens by itself, or open **http://192.168.4.1**.
5. Choose the farm Wi-Fi (or type its name), type its password and the 6-digit code, press **Link**.
6. Wait for **✓ Linked to <farm> – <zone>**. The hotspot closes a minute later.

The hotspot stays up while the kit joins the Wi-Fi and asks AgroFlow, so the page can say what went
wrong: wrong Wi-Fi password, network not found (is it 5 GHz?), code expired or already used, kit
still linked to another farm (staff press **Unlink** there), or AgroFlow not reachable. Fix it and
press Link again; the same code works again for the same kit.

The claim answers with the device token, AgroFlow's existing MQTT login and broker (the API's own
`Mqtt__*` settings, nothing new in the HiveMQ console) and the kit's topics. The kit keeps them in
flash and never prints them. A kit on 1.7.1 keeps working on the old topics until it is reflashed.

## Files

| File | What it is |
|---|---|
| `AgroFlowIrrigationNode.ino` | the sketch |
| `OfflineBuffer.h` | the offline ring buffer and replay, plain C++ (no Arduino headers) so it is unit-tested natively: [`../tests/`](../tests/) |
| `CommandIds.h` | the last 32 command IDs the kit carried out, so a repeat is acknowledged again but never run twice; plain C++, unit-tested natively |
| `RunLimits.h` | how long a run may last; plain C++, unit-tested natively |
| `SetupPortal.h` | the setup page's words (Wi-Fi and claim problems) and the code check; plain C++, unit-tested natively |
| `secrets.example.h` | copy to `secrets.h` (gitignored); holds only `API_BASE_URL`, which is not a secret |

## Board and libraries

ESP32 Dev Module, arduino-esp32 core **3.3.11** (Boards Manager). Libraries, from
the Library Manager:

| Library | Version tested | Header |
|---|---|---|
| ArduinoJson (Benoit Blanchon) | 7.4.3 | `ArduinoJson.h` |
| PubSubClient (Nick O'Leary) | 2.8 | `PubSubClient.h` |
| DHT sensor library for ESPx (beegee_tokyo) | 1.19 | `DHTesp.h` |

Not Adafruit's "DHT sensor library": it has `DHT.h`, not `DHTesp.h`, and the
sketch will not compile with it alone. `WiFi.h`, `WiFiClientSecure.h`,
`HTTPClient.h`, `HTTPUpdate.h`, `WebServer.h`, `DNSServer.h` and `Preferences.h` come with the core.

v1.7.2 uses 88% (1,165,528 of 1,310,720 bytes) of the default "Default 4MB with spiffs"
app partition, compiled with esp32 core 3.3.11 (WiFiManager is gone). If a later change does not fit, pick
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
- **Setup details on Serial Monitor (v1.7.1).** At boot and whenever the setup page opens the
  kit prints its device ID, setup Wi-Fi name and password, and `192.168.4.1`, between
  `===== AgroFlow kit =====` lines. Every reading also carries `rssi` (Wi-Fi signal, dBm) and
  `soilProbeOk` (its last soil sample was in the valid range), for the farmer's Kit tab.

## Local page (no internet needed)

When the setup network is open, a phone joined to it can open
**http://192.168.4.1/local** (or press **Kit readings and pump** on the setup
page) to see the latest readings and start or stop the pump.

- Opening the setup network: power-cycle the kit 3 times quickly (within ~10 s
  each); it also opens by itself when the saved WiFi has been gone 15 minutes,
  and from the admin's "Open setup page" button (Kits) while the kit is online.
- Network: `AgroFlow-Setup-XXXX` (last 4 characters of the device ID), **no password** (1.7.2).
- The local page asks for a login: user **`agroflow`**, password `AF-` + the last 6 characters of
  the device ID (printed at boot). It only answers on the kit's own WiFi, never on the farm's router.
- A run is 1 to 5 minutes and stops by itself; the 5-minute safety cap applies
  as to every run. It is logged as a **manual** irrigation event (uploaded when
  the kit is back online).
- The setup network stays open while a phone is connected to it.
- The setup page has no firmware-upload page; updates come by OTA or USB.

## Secrets

```bash
cd hardware/esp32/AgroFlowIrrigationNode
cp secrets.example.h secrets.h
```

`secrets.h` holds `API_BASE_URL` only. No key, password or token is compiled in:
the board gets its own device token, AgroFlow's MQTT login and broker from
`POST /api/devices/claim` (the 6-digit code authorises that call) and keeps them in flash,
never printed. A kit linked by older firmware fetches the login once from
`GET /api/devices/mqtt-credentials`.

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
| `FIRMWARE_VERSION` | 1.7.2 | match `Firmware:LatestVersion` on the API when the `.bin` is hosted |

`ZONE_ID` and `FARM_ID` are not settings: they come back from the claim and are
kept in flash.
