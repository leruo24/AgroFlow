# AgroFlow MQTT topic structure

Broker: HiveMQ Cloud (free tier) — TLS on port 8883, username/password auth.

Enrollment/claim stays HTTP (`POST /api/devices/enroll`, `POST /api/devices/claim`,
see `api/AgroFlow.Api/Endpoints/DeviceEnrollmentEndpoints.cs`) — it's a
one-time, low-frequency handshake with no established MQTT identity yet.
Everything after a device is claimed and running normally goes over MQTT.

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
  `api/AgroFlow.Api/appsettings.json` need your actual HiveMQ Cloud cluster
  credentials (HiveMQ Cloud console → your cluster → Access Management).
- The firmware's `MQTT_HOST`/`MQTT_PORT`/`MQTT_USERNAME`/`MQTT_PASSWORD`
  constants need the same values.
- HiveMQ Cloud's free tier has a device/session limit and a message-rate
  limit - not a concern for a handful of course-project boards, but worth
  knowing before scaling up.
