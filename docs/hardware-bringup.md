# Bringing up an AgroFlow kit

Step by step, from a bare ESP32 to a kit that reports readings, waters on command and shows
in the admin console. Every value here comes from firmware **1.7.1** in this repository. If something
on screen does not match, the
repository is the source of truth: the sketch is
[`hardware/esp32/AgroFlowIrrigationNode/AgroFlowIrrigationNode.ino`](../hardware/esp32/AgroFlowIrrigationNode/AgroFlowIrrigationNode.ino).

You need: an ESP32 dev board (ESP32-WROOM-32, "ESP32 Dev Module"), a USB data cable, a
YL-69 resistive soil probe with its comparator board, a DHT11, a 5 V single-channel relay
module, a small pump with its own power supply, jumper wires, a phone, and the farm's
**2.4 GHz** WiFi name and password.

---

## 1. Arduino IDE and the ESP32 core

1. Install **Arduino IDE 2.x** (arduino.cc/en/software).
2. **File → Preferences → Additional boards manager URLs**, add:
   `https://espressif.github.io/arduino-esp32/package_esp32_index.json`
3. **Tools → Board → Boards Manager**, search **esp32**, install **esp32 by Espressif
   Systems, version 3.3.11** (the version this firmware was compiled and checked with).
4. Plug the board in. If no port appears, install the USB-serial driver for the chip on
   your board: **CP210x** (Silicon Labs) or **CH340** (WCH). The chip name is printed on the
   small square chip next to the USB socket.

## 2. Libraries (Tools → Manage Libraries)

| Library (search for) | Author | Version | Header the sketch includes |
|---|---|---|---|
| ArduinoJson | Benoit Blanchon | **7.4.3** | `ArduinoJson.h` |
| WiFiManager | tzapu | **2.0.17** | `WiFiManager.h` |
| PubSubClient | Nick O'Leary | **2.8** | `PubSubClient.h` |
| DHT sensor library for ESPx | beegee_tokyo | **1.19** | `DHTesp.h` |

Not Adafruit's "DHT sensor library": it provides `DHT.h`, not `DHTesp.h`, and the sketch
fails with `DHTesp.h: No such file or directory`. `WiFi.h`, `WiFiClientSecure.h`,
`HTTPClient.h`, `HTTPUpdate.h`, `WebServer.h` and `Preferences.h` come with the core.

## 3. `secrets.h`

```bash
cd hardware/esp32/AgroFlowIrrigationNode
cp secrets.example.h secrets.h
```

`secrets.h` (gitignored) has **one** setting:

| Field | What to put | Example (placeholder) |
|---|---|---|
| `API_BASE_URL` | the AgroFlow API address, `https://`, no trailing `/` | `https://<your-api>.up.railway.app` |

Nothing else goes in it, and **no key, password or token is ever compiled in**. These come
from enrollment instead, and are kept in the board's flash (or RAM):

| Credential | Where it comes from | Kept |
|---|---|---|
| Farm and zone | `POST /api/devices/claim`, using the one-time enrollment code typed on the setup page | flash |
| Device token (`X-Device-Token`) | the same claim, issued once for this board | flash, never printed |
| MQTT username and password | `GET /api/devices/mqtt-credentials`, on every boot | RAM only |
| MQTT broker host and port | the same call (falls back to `MQTT_HOST` / `MQTT_PORT` in the sketch) | RAM |
| Farm WiFi | typed on the setup page | flash (WiFiManager) |

## 4. Board and upload settings (Tools menu)

| Setting | Value |
|---|---|
| Board | **ESP32 Dev Module** |
| Upload Speed | **921600** (use 115200 if uploads fail) |
| CPU Frequency | 240 MHz (WiFi/BT) |
| Flash Frequency | 80 MHz |
| Flash Mode | QIO |
| Flash Size | 4MB (32Mb) |
| Partition Scheme | **Default 4MB with spiffs (1.2MB APP/1.5MB SPIFFS)**. v1.7.1 uses 92% of it; if a later change does not fit, use **Minimal SPIFFS (1.9MB APP with OTA)** |
| Core Debug Level | None |
| PSRAM | Disabled |
| Erase All Flash Before Sketch Upload | Disabled (Enabled only to wipe a kit completely) |
| Port | the board's COM port |
| **Serial Monitor** | **115200 baud**, "Both NL & CR" |

The 92% figure is program space. Offline data uses the separate NVS partition:

| Kept in flash (NVS) | Size | Key |
|---|---|---|
| Offline readings: a ring of **180 readings** (`READING_BUFFER_CAPACITY`) | `180 × 20 B + 24 B header = 3,624 B` | `readbuf` |
| Offline pump runs: **32 runs** (`RUN_BUFFER_CAPACITY`) | `32 × 16 B + 24 B header = 536 B` | `runbuf` |
| Recent command IDs: **32 IDs** (`RECENT_COMMAND_IDS`), each with its first acknowledgement time | `32 × 44 B + 20 B header = 1,428 B` | `cmdids` |

That is at most **5,588 B plus NVS overhead**. At one soil, temperature and humidity sample
every 30 seconds (3 readings), 180 readings cover **30 minutes** offline; after that the
oldest reading is dropped first, so the newest 30 minutes always survive. Each kept reading
has the time it was measured, and after a reconnect they upload **oldest first**, 5 per pass
of the main loop so watering checks keep running. The API stores a reading from a kit once
per sensor and measured time (migration 0060), so a reading sent twice is not stored twice.
Every reading the kit publishes says how many are still waiting (`backlog`); the admin
**Kits** page and the farmer's kit screen show it while it is above 0.

Open the sketch folder, press **Upload**. Some boards need the **BOOT** button held while
"Connecting..." shows.

## 5. Wiring (fixed in the firmware, do not change the pins)

| From | To ESP32 | Notes |
|---|---|---|
| Soil probe comparator **AO** | **GPIO 32** | `MOISTURE_PIN`. Analogue in (ADC1, works with WiFi on). Leave DO unconnected. |
| Soil probe **VCC** / **GND** | **3V3** / **GND** | 3.3 V, not 5 V: the ADC reads up to 3.3 V. |
| DHT11 **DATA** | **GPIO 27** | `DHT_PIN`. A bare 4-pin DHT11 needs a 10 kΩ pull-up from DATA to 3V3; most 3-pin modules have one on board. |
| DHT11 **VCC** / **GND** | **3V3** / **GND** | |
| Relay module **IN** | **GPIO 25** | `RELAY_PIN`, `RELAY_ACTIVE_LOW = true`: LOW switches the relay on. |
| Relay module **VCC** / **GND** | **5V (VIN)** / **GND** | |
| Pump supply **+** | relay **COM** | The pump has its own supply. Never power a pump from the ESP32. |
| Relay **NO** | pump **+** | Normally open: the pump is off if the board is off. |
| Pump **−** | pump supply **−** | |

Before connecting the pump, check the relay clicks only when you expect (step 9).

## 6. In the admin console: farmer, farm, zone, kit, code

Sign in at the admin site (**Staff sign-in**).

1. **Farmers → + Onboard Farmer** (or **+ Create Farmer**): create a test farmer.
2. **Farms & zones**: create the farm with its location, and **one zone** for this kit, with
   its crop and a flow rate (litres per minute) if you know it.
3. **Set the zone to Manual for the bring-up**, so no reading can start the pump while you
   test. If the console has no Manual switch for the zone, run in the Supabase SQL editor:
   `update zone set irrigation_mode = 'manual' where id = <zone id>;`
   Put it back to `automatic` when you finish.
4. **Kits → MQTT logins**: check **Free** is at least 1. If it is 0, create a login in the
   HiveMQ console (Access Management) and paste it on that page. With none free, the kit
   still connects on the shared login and the admin is warned.
5. **Kits → + Register a kit**: farmer → farm → zone → kit type **ESP32** → **Create the
   enrollment code**. Write down the **8-letter code** (no 0/O/1/I/L). It works **once**, for
   **24 hours**.

## 7. First boot: the setup network

1. Power the kit (USB is fine). Open the Serial Monitor at 115200. You should see:
   ```
   AgroFlow node v1.7.1 - device 0123456789AB
   ===== AgroFlow kit =====
   Device ID: 0123456789AB
   Setup Wi-Fi: AgroFlow-Setup-89AB
   Password: AF-6789AB
   Setup page: 192.168.4.1
   =======================
   Not set up yet: join WiFi "AgroFlow-Setup-89AB" to enter farm WiFi + enrollment code
   ```
2. On the phone, join the WiFi **`AgroFlow-Setup-XXXX`** (XXXX = the last 4 characters of
   the device ID). Password: **`AF-` + the last 6 characters of the device ID**, e.g.
   `AF-6789AB`. Put the device ID on a label on the kit.
3. The setup page opens by itself (otherwise browse to **http://192.168.4.1**). Press
   **Configure WiFi**.
4. Choose the farm WiFi. **2.4 GHz only**: the ESP32 cannot see 5 GHz networks. If the farm
   router shows two names, pick the one without "5G". Type its password.
5. In **Enrollment Code (from admin)**, type the 8-letter code. Press **Save**.
6. The setup network closes. The Serial Monitor should show:
   ```
   Device claimed, zoneId=12 farmId=4 (credentials stored on device)
   MQTT login received from server (held in memory only)
   Connecting to MQTT broker...connected
   Subscribed to agroflow/farm/4/device/0123456789AB/commands; backlog 0 readings, 0 pump runs to upload
   Soil raw=3120 (38%)
   DHT11 22.0 C 55 %
   ```
   and every 30 seconds after that, a new `Soil raw=...` and `DHT11 ...` pair.

The setup page stays open **5 minutes**; if it times out the kit restarts and opens it again.

## 8. What the Serial Monitor says, and what to do

| You see | Means | Do |
|---|---|---|
| `Device claim rejected, http=401` then `Device claim failed - wiping and restarting into setup.` | the code was wrong, already used or older than 24 h | create a new code (step 6.5) and enter it again |
| `Device claim rejected, http=429` | 10 wrong codes from this network within 15 minutes | wait 15 minutes, then try the correct code |
| `ERROR: could not open HTTP(S) connection to ...` | `API_BASE_URL` in `secrets.h` is wrong or has a typo | fix it, upload again |
| `Setup timed out - restarting to retry.` | nobody saved the setup page within 5 min | join the setup network again |
| `WiFi not connected yet - running offline, will keep retrying` | wrong WiFi password, 5 GHz network, or out of range | power-cycle 3 times quickly (step 10) and re-enter the WiFi |
| `WARN: MQTT credential fetch failed, http=401` | the kit was revoked in the console, or never claimed | re-register the kit and give it a new code |
| `Connecting to MQTT broker...failed, rc=4` or `rc=5` | the MQTT login is wrong or was changed | it fetches a fresh login by itself; if it keeps failing, check the login on **MQTT logins** and the API's `Mqtt__*` settings |
| `Connecting to MQTT broker...failed, rc=-2` | cannot reach the broker (no internet, broker address, firewall) | check the internet on that WiFi; the kit keeps its readings meanwhile |
| `WARN: API rejected device token (1/3)` ... `(3/3)` then `FACTORY RESET` | the server revoked this board's token | expected after a revoke; enrol it again |
| `WARN: soil reading 0 out of range - not sent (probe fault?)` | probe not connected, wrong pin, or shorted | check AO → GPIO 32 and 3V3/GND |
| `WARN: DHT11 TIMEOUT - temperature/humidity not sent` | DHT11 not answering | check DATA → GPIO 27, power, and the pull-up |
| `Offline: 3 readings kept for upload` | MQTT is down; readings are kept (one set of 3 every 30 s, up to 180) | nothing; they upload when it is back |
| `WARN: offline reading buffer full, dropped the oldest reading` | offline for more than 30 minutes | nothing; the newest 30 minutes are kept |
| `Subscribed to ...; backlog 60 readings, 0 pump runs to upload` | reconnected with kept readings | nothing; watch them upload |
| `Offline readings uploaded - buffer empty` | back online, kept readings sent | nothing |
| `Command 0f9b952c-... already carried out - acknowledging again, not repeating it` | the API resent a command whose acknowledgement was lost | nothing; the pump does not run a second time |
| `SAFETY: max run time reached, stopping pump` | a run reached the 5-minute cap | expected; no run is ever longer than 5 min |

## 9. Checks before you leave the kit

Tick each one.

- [ ] **Online in the admin.** **Kits** shows the kit **Online**, on the right farm and zone,
      firmware **1.7.1**.
- [ ] **Readings every 30 s.** The Serial Monitor prints a soil and a DHT11 line every 30 s,
      and the farmer's app (zone screen) shows a recent reading.
- [ ] **Probe reads sensibly.** On the Serial Monitor: probe in dry air reads about
      `Soil raw=4095`; up to its line in a glass of water, about `Soil raw=1550` (the sketch's
      `ADC_DRY` / `ADC_WET`). Far off either way means a wiring or probe fault.
- [ ] **Wet/dry calibration in the soil.** In the farmer app, open the zone → **Teach the
      sensor your soil** ("Set up your soil sensor"): soak the soil, wait a day, tap **Save
      wet**; when the soil is properly dry, tap **Save dry** (two different days, as the app
      says). Until then the app shows the raw number, never a %. **Finish setup** on the
      zone shows "Soil sensor wet/dry setup" as Done afterwards.
- [ ] **A 1-minute manual run.** With the pump connected: in the app, zone → **Manual** →
      **How many minutes?** `1` → **Water now** → **Start** (before `feat/sponsor-mobile` is
      merged the app says **Duration (minutes)** and **Start Manual Run**). The relay clicks on, the pump runs,
      and after a minute the Serial Monitor shows
      `Commanded duration elapsed, auto-stopping pump` and `Pump OFF, runtime_seconds=60`.
- [ ] **The run is in the history.** The app's **History** (and the admin's farm view) shows a
      manual irrigation event of about 1 minute.
- [ ] **Telegram.** The farmer opens the AgroFlow bot from the QR code or link and presses
      **Start**; the bot answers with a welcome. The admin console shows them **Connected**.
- [ ] **Zone back to automatic** if it should water by itself (step 6.3).

## 10. Later: changing WiFi, the local page, factory reset

| To | Do |
|---|---|
| Change the WiFi (new router or password) | **Power-cycle 3 times quickly** (within about 10 s each). The setup network opens; the kit keeps its farm and zone. It also opens by itself when the saved WiFi has been gone for 15 minutes, or from the admin's **Open setup page** (on the kit, in **Kits**) while the kit is online. |
| Water or check readings **without internet** | While the setup network is open, join it and browse to **http://192.168.4.1/local** (or press **Kit readings and pump** on the setup page). Login: user **`agroflow`**, password the same `AF-…` as the network. Start a 1–5 minute run or stop the pump. Runs are logged and uploaded when the kit is back online. |
| Move the kit to another zone, or start again | **Power-cycle 5 times quickly**: a factory reset wipes WiFi, farm, zone and credentials and opens setup for a new enrollment code. |

## 11. No hardware? The simulation

`hardware/sim/run-e2e.mjs` runs the real API against a local Postgres (every migration) and
a local MQTT broker, with a pretend kit that follows the firmware's contract: claim with a
one-time code, readings, a manual 1-minute command with its ACK and irrigation event, and
readings kept offline. See [`hardware/sim/README.md`](../hardware/sim/README.md).
