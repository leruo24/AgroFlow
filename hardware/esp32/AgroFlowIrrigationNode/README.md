# AgroFlowIrrigationNode

ESP32 firmware for one irrigation zone: reads a soil moisture sensor, drives
a relay-controlled pump, and reports/receives over MQTT + HTTP. All
irrigation decision-making (health status, water usage, auto-start/stop
thresholds) lives server-side in `AgroFlow.Api` — this board just reports
readings and executes whatever command it's told. See the comment block at
the top of `AgroFlowIrrigationNode.ino` for the full picture, and
[`../../shared/MQTT_TOPICS.md`](../../shared/MQTT_TOPICS.md) for the MQTT
topic structure this device publishes/subscribes to.

## Board

ESP32 Dev Module (or equivalent) — Tools → Board → esp32 → your specific
board. Needs the [arduino-esp32](https://github.com/espressif/arduino-esp32)
core installed via Boards Manager.

## Required libraries (Arduino Library Manager)

| Library | Author | Why |
|---|---|---|
| ArduinoJson | Benoit Blanchon | JSON (de)serialization for every HTTP/MQTT payload |
| WiFiManager | tzapu | Captive-portal WiFi provisioning on first boot |
| PubSubClient | knolleary | MQTT client, used with `WiFiClientSecure` for TLS to HiveMQ Cloud |

`WiFi.h`, `WiFiClientSecure.h`, `HTTPClient.h`, `HTTPUpdate.h`,
`Preferences.h`, `time.h` are all built into the ESP32 core - nothing to
install for those.

## Secrets (`secrets.h`)

Two credentials live in `secrets.h`, which is **gitignored**. Before
flashing:

```bash
cd hardware/esp32/AgroFlowIrrigationNode
cp secrets.example.h secrets.h      # then edit secrets.h
```

The sketch will not compile without `secrets.h`.

| Constant (in `secrets.h`) | What it's for | Where the value comes from |
|---|---|---|
| `API_KEY` | Shared device secret sent as `X-Api-Key` on every `AgroFlow.Api` call | Must exactly match `ApiKey` in `AgroFlow.Api`'s user-secrets (`backend/AgroFlow.Api`: `dotnet user-secrets list`) |
| `MQTT_PASSWORD` | HiveMQ Cloud password for `MQTT_USERNAME` | HiveMQ Cloud console → your cluster → Access Management; must match `Mqtt:Password` in `AgroFlow.Api`'s user-secrets |

## Config placeholders (top of the `.ino`)

Every one of these is a `const` near the top of the file - fill in real
values there before flashing (values aren't repeated here, only what each
one is and where the value comes from):

| Constant | What it's for | Where the value comes from |
|---|---|---|
| `SUPABASE_URL` / `SUPABASE_ANON_KEY` | Marking a command `executed` via direct REST PATCH to Supabase | Supabase dashboard → Project Settings → API |
| `API_BASE_URL` | Base URL of the `AgroFlow.Api` host (device claim, irrigation event logging, firmware check) | Wherever you're running `backend/AgroFlow.Api` |
| `MQTT_HOST` / `MQTT_PORT` / `MQTT_USERNAME` | HiveMQ Cloud broker endpoint (not the password — that's in `secrets.h`) | HiveMQ Cloud console → your cluster → Access Management |
| `FIRMWARE_VERSION` | Reported to `/api/devices/firmware-check` for OTA update comparison | Bump to match `Firmware:LatestVersion` in `appsettings.json` each release |
| `RELAY_PIN` / `MOISTURE_PIN` | GPIO wiring | Your actual board wiring |
| `RELAY_ACTIVE_LOW` | Whether your relay module energises on LOW or HIGH | Your relay module's datasheet/behaviour |
| `ADC_DRY` / `ADC_WET` | Raw ADC calibration points for the soil moisture sensor | Measured dry-in-air vs. fully-submerged readings from your actual sensor |
| `PUMP_FLOW_LPS` | Estimated litres/second (no physical flow meter installed) | A real bucket-and-stopwatch measurement of your pump |

Everything else in the config block (poll/report intervals, portal timeout,
offline buffer size, etc.) has a working default and is optional to tune -
see the inline comment above each one.

`ZONE_ID` and `FARM_ID` are **not** placeholders to fill in - they're
resolved automatically via `/api/devices/claim` on first setup and persisted
to flash. Don't hardcode these.

## First boot / provisioning

No WiFi credentials, zone, or farm are baked into the image - every board
runs the identical sketch. On first boot it opens its own
`AgroFlow-Setup-XXXX` WiFi access point, serves a form for your WiFi
credentials plus a one-time enrollment code (generated server-side via
`POST /api/devices/enroll`), then claims itself automatically. See the
provisioning section of the file header comment for the full flow, including
what happens if claiming fails.
