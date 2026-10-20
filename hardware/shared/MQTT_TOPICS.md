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

Boards on **v1.4.0** also take the broker address from that last call — see
"The broker address" below.

An unknown or revoked token gets **401**. Three consecutive 401s make the board
wipe its own credentials and reopen its setup page for a fresh enrollment code.

Boards still on v1.1.0 or earlier have no token; `Devices:LegacyApiKeyEnabled`
(default `true`) keeps accepting `X-Api-Key` from them and logs a warning on
every use. Turn it off once every board reports firmware 1.3.0.

Each board also fetches its own MQTT username/password from
`GET /api/devices/mqtt-credentials` on every boot and holds them in RAM only,
so rotating a login needs no reflash.

## The broker address (v1.4.0)

`GET /api/devices/mqtt-credentials` returns the **broker address** alongside the
login:

```json
{
  "mqttUsername": "agroflow-kit-07",
  "mqttPassword": "…",
  "mqttHost": "853fe2eddcd24d0c8e0f4d69869c5dab.s1.eu.hivemq.cloud",
  "mqttPort": 8883
}
```

`mqttHost` / `mqttPort` come from the API's own `Mqtt:Host` and `Mqtt:Port` —
the **same two keys `MqttConnectionService` connects with**, deliberately not a
second pair, so the API and the boards can never end up pointing at different
brokers.

Both are optional in both directions. Unset on the server → omitted from the
response. Absent from the response → the board keeps its compiled-in
`MQTT_HOST` / `MQTT_PORT`.

**Why this matters:** HiveMQ Cloud Serverless is **retired on 31 December
2026**. Until v1.4.0 the broker hostname was a compiled-in constant, so moving
to a different broker meant reflashing every board in the field by hand over
USB. It is now a Railway variable — set `Mqtt__Host`, `Mqtt__Port`,
`Mqtt__Username` and `Mqtt__Password` at the new broker, re-paste the per-kit
logins into the admin MQTT logins page, and restart the boards. No reflash, and
no site visit.

`{farmId}` and `{deviceId}` are always the real `farm.farm_id` and
`hardware.device_id` (the device's `ESP.getEfuseMac()`-derived ID, not its
WiFi MAC — see 0009_mqtt_and_device_identity.sql). Both values come back in
the `/api/devices/claim` response and are persisted to flash (`Preferences`)
so they survive reboots.

## Topics

| Direction | Topic | Payload |
|---|---|---|
| Device → backend | `agroflow/farm/{farmId}/device/{deviceId}/sensors` | `{"sensorType":"SoilMoisture","value":42.5}` |
| Backend → device | `agroflow/farm/{farmId}/device/{deviceId}/commands` | `{"id":"<uuid>","command":"start","durationSeconds":300,"source":"auto","maxRunSeconds":300}` |

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

### Readings kept while offline (v1.5.0)

While MQTT is down a v1.5.0 board keeps one soil + temperature + humidity sample
every 10 minutes in a bounded ring in its flash (180 readings, about 10 hours;
the oldest is dropped first). When it reconnects it publishes them **oldest
first** on the same topic, with two extra fields:

```json
{"sensorType":"SoilMoisture","value":31.5,"recordedAt":"2026-10-19T07:00:00Z","seq":4211}
```

| Field | Meaning |
|---|---|
| `recordedAt` | when the board took the reading (UTC, from NTP). Absent on a live reading. |
| `seq` | the board's own counter, increasing by one per kept reading |

The API (`ReadingAge`, `SensorReadingProcessor`) stores a kept reading with its
own time. If it is more than **10 minutes** old it is stored only: it never
changes the zone's health, raises an alert or sends a pump command. Older than
7 days, or more than 5 minutes in the future, it is dropped. The same zone,
type and `recordedAt` twice is stored once, so a resend after a power cut does
not duplicate. While anything is still waiting, new readings join the back of
the queue, so the server receives them in the order they were taken.

### Commands

| `command` | Meaning |
|---|---|
| `start` | run the pump for min(`durationSeconds`, `maxRunSeconds`), never over 120 minutes; `maxRunSeconds` is the zone's maximum run time (5 minutes when missing, from an older server). Firmware 1.6.0 also stops a run after 3 minutes with no MQTT contact. |
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
