# AgroFlow MQTT topic structure

Broker: HiveMQ Cloud (free tier) — TLS on port 8883, username/password auth.

Enrollment/claim stays HTTP (`POST /api/devices/enroll`, `POST /api/devices/claim`,
see `backend/AgroFlow.Api/Endpoints/DeviceEnrollmentEndpoints.cs`) — it's a
one-time, low-frequency handshake with no established MQTT identity yet.
Everything after a device is claimed and running normally goes over MQTT.

## Device authentication (v1.3.0)

Device-facing HTTP endpoints authenticate with **`X-Device-Token`**, not the old
shared `X-Api-Key`. The token is minted per board by `POST /api/devices/claim`
(the one-time enrollment code is that call's own authorisation), returned once,
and stored only in the board's flash — the server keeps nothing but its
SHA-256 hash. Revoking one board therefore cuts off that board alone.

| Endpoint | Auth |
|---|---|
| `POST /api/devices/claim` | the one-time enrollment code in the body |
| `POST /api/irrigation-events` | `X-Device-Token` |
| `POST /api/devices/commands/{id}/executed` | `X-Device-Token` |
| `GET /api/devices/firmware-check` | `X-Device-Token` |
| `GET /api/devices/mqtt-credentials` | `X-Device-Token` |

An unknown or revoked token gets **401**. Three consecutive 401s make the board
wipe its own credentials and reopen its setup page for a fresh enrollment code.

Boards still on v1.1.0 or earlier have no token; `Devices:LegacyApiKeyEnabled`
(default `true`) keeps accepting `X-Api-Key` from them and logs a warning on
every use. Turn it off once every board reports firmware 1.3.0.

Each board also fetches its own MQTT username/password from
`GET /api/devices/mqtt-credentials` on every boot and holds them in RAM only,
so rotating a login needs no reflash.

`{farmId}` and `{deviceId}` are always the real `farm.farm_id` and
`hardware.device_id` (the device's `ESP.getEfuseMac()`-derived ID, not its
WiFi MAC — see 0009_mqtt_and_device_identity.sql). Both values come back in
the `/api/devices/claim` response and are persisted to flash (`Preferences`)
so they survive reboots.

## Topics

| Direction | Topic | Payload |
|---|---|---|
| Device → backend | `agroflow/farm/{farmId}/device/{deviceId}/sensors` | `{"sensorType":"SoilMoisture","value":42.5}` |
| Backend → device | `agroflow/farm/{farmId}/device/{deviceId}/commands` | `{"id":"<uuid>","command":"start","durationSeconds":300,"source":"auto"}` |

### Sensor payloads

The `{"sensorType","value"}` shape is unchanged, but v1.3.0 boards publish
**three** sensor types from the one DHT11 + soil probe wiring, each as its own
message on the same topic:

| `sensorType` | Unit | Source |
|---|---|---|
| `SoilMoisture` | percent, 0–100 | resistive probe on pin 32, scaled from raw ADC |
| `Temperature` | °C | DHT11 on pin 27 |
| `Humidity` | percent relative | DHT11 on pin 27 |

```json
{"sensorType":"Temperature","value":21.4}
{"sensorType":"Humidity","value":58.0}
```

All three are stored in `sensor_reading`; the column's CHECK constraint has
allowed these exact three values since `0002_relationships.sql`, so no
migration was needed for them. Only `SoilMoisture` drives watering decisions —
`Temperature`/`Humidity` feed zone health, the FAO-56 engine and the Kit
screen's "sensor working / not responding" readout. A DHT11 that fails to read
simply sends nothing, which is what the app reports as "Not responding: using
weather app data".

### Commands

| `command` | Meaning |
|---|---|
| `start` | run the pump, for `durationSeconds` if present |
| `stop` | stop the pump |
| `open_setup` | open the board's setup page, **keeping** the saved WiFi |
| `change_wifi` | forget the saved WiFi and open the setup page, keeping farm/zone/token |

`open_setup` and `change_wifi` use the same envelope as `start`/`stop` — a uuid
`id` and a `command` — and go to the same `.../commands` topic, so they travel
the existing `irrigation_commands` → `pg_notify` → publish path and are ACKed
the same way through `POST /api/devices/commands/{id}/executed`. Neither takes
`durationSeconds`. `change_wifi` is ACKed *before* the WiFi is dropped, while
the board can still reach the API.

After `change_wifi` the board raises its own network
**`AgroFlow-Setup-XXXX`** (last 4 of the device ID), password **`AF-`** plus the
last 6 of the device ID. Watering keeps running on the offline fallback while
the setup page is open. A board whose saved WiFi has been unreachable for 15
minutes opens the same page by itself, and three quick power-cycles do it by
hand — so `open_setup`/`change_wifi` are conveniences for a board that is still
online, never the only way back in.

`zoneId`/`farmId`/`deviceId` are never duplicated inside the JSON payload -
they're already in the topic. The backend subscribes with the wildcard
`agroflow/farm/+/device/+/sensors` and extracts both IDs from the topic
string on receipt (see `MqttTopics.cs`).

## Extending this for other device types

This structure isn't ESP32-irrigation-node-specific. Any future device type
(a standalone pump controller, a weather station, a gateway) should reuse the
same `agroflow/farm/{farmId}/device/{deviceId}/<channel>` shape with a new
`<channel>` segment (e.g. `.../weather`, `.../status`) rather than inventing
a parallel topic scheme - `MqttTopics.cs`'s parsing helpers only look at the
`farm`/`device` segments and the trailing channel name, so adding a channel
is a small, additive change there and in whatever backend handler consumes
it.

## What still needs to happen

- `Mqtt:Host` / `Mqtt:Port` / `Mqtt:Username` / `Mqtt:Password` in
  `backend/AgroFlow.Api/appsettings.json` need your actual HiveMQ Cloud cluster
  credentials (HiveMQ Cloud console → your cluster → Access Management). These
  are the API's own broker login, and the shared fallback handed to a board
  that has no pool login of its own.
- The firmware no longer holds any MQTT credential. It has `MQTT_HOST`/
  `MQTT_PORT` only, and asks the API for its username/password on every boot.
  Per-board logins are created by hand in the HiveMQ console and pasted into
  the admin "MQTT logins" page, because HiveMQ's credential API needs the paid
  Starter plan; `Mqtt:PoolEncryptionKey` is the AES-GCM key those pasted
  passwords are encrypted with at rest.
- HiveMQ Cloud's free tier has a device/session limit and a message-rate
  limit - not a concern for a handful of course-project boards, but worth
  knowing before scaling up.
