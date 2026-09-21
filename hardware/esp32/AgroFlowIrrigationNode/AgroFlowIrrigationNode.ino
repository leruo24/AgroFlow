// AgroFlow irrigation node - ESP32 firmware.
//
// One board per zone: reads a soil moisture sensor, drives a relay-controlled
// pump, and talks to two backends over two transports. This board is
// intentionally "dumb" - all irrigation DECISION-MAKING (health status,
// water usage, moisture-threshold auto-start/stop) lives in Zone.cs on the
// AgroFlow.Api host, not here:
//   1. reads the soil moisture sensor and PUBLISHES it over MQTT to
//      agroflow/farm/{farmId}/device/{deviceId}/sensors (see
//      hardware/shared/MQTT_TOPICS.md) - AgroFlow.Api's MQTT subscriber inserts it
//      into sensor_reading, computes health status, and decides start/stop
//      the same way the earlier Postgres-trigger version did.
//   2. SUBSCRIBES over MQTT to agroflow/farm/{farmId}/device/{deviceId}/commands
//      and executes whatever arrives - REST polling of irrigation_commands
//      is gone; this is now push-based. The board then acknowledges the
//      command to AgroFlow.Api over HTTP
//      (POST /api/devices/commands/{id}/executed - see markCommandExecuted()).
//      That ACK used to be a direct Supabase REST PATCH; it never worked and
//      never could, so this board no longer holds any Supabase credential at
//      all. See markCommandExecuted() for the full story.
//   3. logs the resulting run to AgroFlow.Api over HTTP
//      (POST /api/irrigation-events), which inserts it into irrigation_event
//      and updates the zone's running water usage total (with offline
//      buffering, unchanged - see the summary this shipped with for why this
//      one stayed on HTTP instead of moving to MQTT too).
//
// Device identity is ESP.getEfuseMac() (the chip's true unique hardware ID,
// burned in at manufacture), NOT WiFi.macAddress() - see getDeviceId(). This
// is what hardware.device_id stores and what MQTT topics are keyed on; it's
// stable regardless of which network interface/mode the radio is in, unlike
// a WiFi-interface-derived MAC.
//
// No WiFi credentials, zone ID, or farm ID are baked into this firmware
// image. On first boot (nothing saved in flash) it opens its own
// AgroFlow-Setup-XXXX access point, serves a form for the farm WiFi + a
// one-time enrollment code (see
// backend/AgroFlow.Api/Endpoints/DeviceEnrollmentEndpoints.cs), then calls
// /api/devices/claim to find out which zone/farm it belongs to. Every board
// runs the identical image.
//
// This is a from-scratch sketch - there was no existing ESP32 firmware in the
// repo to extend, so every pin/threshold/credential below is a placeholder.
// Search for "TODO" before flashing.
//
// Library dependencies (Arduino Library Manager):
//   - ArduinoJson (v7.x)
//   - WiFiManager by tzapu (captive-portal WiFi provisioning) - actively
//     maintained, the de facto standard for this on ESP32/ESP8266, built on
//     the same WiFi.h/DNSServer/WebServer APIs already in use here. Chosen
//     over rolling a custom AP+web-form since it already handles the fiddly
//     parts (DNS captive-portal redirect, credential persistence, portal
//     timeout) correctly.
//   - PubSubClient by knolleary (MQTT client) - the standard, lightweight
//     MQTT client for Arduino/ESP32, works over any Client&-derived
//     transport (used here with WiFiClientSecure for TLS to HiveMQ Cloud on
//     port 8883). Confirm it against your installed arduino-esp32 core
//     version before flashing - it's a mature, widely-used library with no
//     known incompatibility with current cores, but this hasn't been
//     compile-tested against real hardware in this environment.
// Built-in (ESP32 core, no install needed):
//   - WiFi.h, WiFiClientSecure.h, HTTPClient.h, HTTPUpdate.h, Preferences.h, time.h

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <HTTPUpdate.h>
#include <WiFiManager.h>
#include <PubSubClient.h>
#include <Preferences.h>
#include <ArduinoJson.h>
#include <time.h>
#include <string.h>

// Real credentials (API_KEY, MQTT_PASSWORD) live in secrets.h, which is
// gitignored. Create it before flashing:  cp secrets.example.h secrets.h
// then paste in the real values. The build will not compile without it.
#include "secrets.h"

// ---------------------------------------------------------------------------
// Config - TODO: fill in / adjust per board before flashing.
// ---------------------------------------------------------------------------

// SUPABASE_URL / SUPABASE_ANON_KEY are GONE, deliberately. They existed only
// to mark a command 'executed' by PATCHing Supabase's REST API directly, and
// that path was dead twice over: the values were never filled in past their
// placeholders, and migration 0011 grants the anon role SELECT only on
// irrigation_commands - no UPDATE policy exists, by design, because an anon
// write there drives a physical valve. The ACK now goes through AgroFlow.Api
// instead (see markCommandExecuted()), so this board holds no Supabase
// credential of any kind. Do not reintroduce one.

// API_BASE_URL now lives in secrets.h alongside API_KEY and MQTT_PASSWORD -
// see the #include above and secrets.example.h. It moved out of this file
// because it changes per deployment, and leaving a hardcoded LAN address here
// is what made every network change a reflash.
//
// IF YOUR BUILD FAILS WITH "API_BASE_URL was not declared in this scope",
// your secrets.h predates this change. Add this line to it:
//
//     const char *API_BASE_URL = "https://agroflow-production-998d.up.railway.app";
//
// (secrets.h is gitignored, so it does not get updated by a git pull.)

// API_KEY is defined in secrets.h (see the #include above). TODO: set it
// there - copy secrets.example.h to secrets.h first. It must match the
// "ApiKey" value in AgroFlow.Api's user-secrets. Same key on every board -
// it identifies "this is a genuine AgroFlow device", not any individual
// device or zone (that's what enrollment/claim is for).

// HiveMQ Cloud cluster connection (HiveMQ Cloud console -> your cluster ->
// Access Management). TLS on port 8883 - see hardware/shared/MQTT_TOPICS.md for the
// topic structure this connects to. The password is a secret and lives in
// secrets.h (MQTT_PASSWORD); host and username are not, and stay here.
const char *MQTT_HOST = "853fe2eddcd24d0c8e0f4d69869c5dab.s1.eu.hivemq.cloud";
const uint16_t MQTT_PORT = 8883;
const char *MQTT_USERNAME = "agroflow-device";
// TODO: set MQTT_PASSWORD in secrets.h (copy secrets.example.h to secrets.h
// first) - the agroflow-device credential's password from HiveMQ Cloud
// Access Management.

const unsigned long MQTT_RECONNECT_INTERVAL_MS = 5000;

// How long the captive setup portal waits for someone to connect and submit
// the form before giving up and restarting to try again. TODO: tune - a
// board freshly unboxed in the field might sit powered-on for a while before
// anyone gets to it.
const uint16_t CONFIG_PORTAL_TIMEOUT_SECONDS = 300;

// Reported to /api/devices/firmware-check and compared against
// Firmware:LatestVersion in backend/AgroFlow.Api/appsettings.json. TODO: bump
// this to match whatever you set there each time you cut a release.
const char *FIRMWARE_VERSION = "1.0.0";

// OTA check cadence - deliberately long. This must NOT interfere with the
// 30s sensor-report cadence or MQTT's own keep-alive/receive loop, so it
// runs on its own much slower timer (see loop()). TODO: tune.
const unsigned long FIRMWARE_CHECK_INTERVAL_MS = 4UL * 60UL * 60UL * 1000UL; // 4 hours

// The zone/farm this board belongs to - neither is a compile-time constant.
// Both are resolved once via /api/devices/claim on first setup and persisted
// to flash (Preferences), then loaded from flash on every subsequent boot.
// 0 means "not yet claimed". FARM_ID is needed alongside ZONE_ID because
// MQTT topics are keyed on farmId, not zoneId - see hardware/shared/MQTT_TOPICS.md.
long ZONE_ID = 0;
long FARM_ID = 0;

// TODO: confirm against your actual wiring.
const int RELAY_PIN = 26;
const int MOISTURE_PIN = 34; // ADC1 channel - stays usable while WiFi is active.

// Most relay modules pull their input LOW to energise the coil. Flip this if
// yours is active-HIGH.
const bool RELAY_ACTIVE_LOW = true;

// TODO: calibrate against your actual sensor (dry-in-air vs. wet-in-water
// raw ADC readings). These only affect the reported percentage now - the
// dry/wet thresholds that decide when to irrigate live in zone.
// moisture_threshold / desired_moisture in Postgres instead.
const int ADC_DRY = 3000; // raw reading in dry air ~= 0%
const int ADC_WET = 1200; // raw reading fully submerged ~= 100%

// NO FLOW CONSTANT LIVES HERE ANY MORE.
//
// This board used to carry PUMP_FLOW_LPS and compute litres itself. That made
// two sources of truth for the same number - this constant, compiled into
// every board, and zone.flow_rate_lpm in Postgres - so the same event could
// be valued two different ways depending on who did the arithmetic.
//
// The board now reports only what it actually observes: how many seconds the
// pump ran. AgroFlow.Api multiplies that by the zone's configured
// flow_rate_lpm. Correcting a zone's rate is a database update, not a reflash.

const unsigned long SENSOR_REPORT_INTERVAL_MS = 30000; // TODO: tune reporting cadence
const unsigned long CONNECTIVITY_CHECK_INTERVAL_MS = 2000;
const unsigned long WIFI_RECONNECT_INTERVAL_MS = 10000;

const int OFFLINE_BUFFER_CAPACITY = 10;

// Sanity floor for time(nullptr): anything at or below this means the clock
// is still at (or near) the Unix epoch, i.e. NTP has not synced yet - not a
// real wall-clock time. Bump this occasionally so it stays "clearly in the
// past" (currently 2023-11-14T22:13:20Z).
const time_t MIN_VALID_EPOCH = 1700000000;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

Preferences preferences; // NVS-backed flash storage: "claimed" flag + ZONE_ID/FARM_ID survive reboots/power loss

WiFiClientSecure mqttTlsClient;
PubSubClient mqttClient(mqttTlsClient);
String mqttSensorsTopic;  // built once FARM_ID is known - see buildMqttTopics()
String mqttCommandsTopic;
unsigned long lastMqttReconnectAttemptMillis = 0;

bool pumpRunning = false;
unsigned long pumpStartMillis = 0;
time_t cycleStartEpoch = 0; // wall-clock start time of the current cycle, 0 if unknown/unsynced

// Whatever irrigation_commands.source carried on the command that started
// the CURRENT cycle ("manual" | "auto" | "scheduled" | "unknown"), echoed
// straight into irrigation_event.trigger_source when the cycle ends. Empty
// while idle. The backend (Zone.cs on AgroFlow.Api) decides what caused a
// cycle now, not this board.
String currentCycleSource = "";

// Optional auto-stop deadline, set when the command that started the
// current cycle carried a non-null duration_seconds (manual commands with a
// duration, and every scheduled command, both use this).
bool hasDurationDeadline = false;
unsigned long cycleDeadlineMillis = 0;

unsigned long lastSensorReportMillis = 0;
unsigned long lastConnectivityCheckMillis = 0;
unsigned long lastWifiReconnectAttemptMillis = 0;
unsigned long lastFirmwareCheckMillis = 0;
bool wasConnected = false;

struct PendingEvent {
  long zoneId;
  unsigned long runtimeSeconds;
  String triggerSource;
  time_t startedAtEpoch; // 0 if the clock wasn't synced when the cycle started
};

PendingEvent offlineBuffer[OFFLINE_BUFFER_CAPACITY];
int offlineHead = 0;  // index of the oldest buffered event
int offlineCount = 0; // number of buffered events currently held

// ---------------------------------------------------------------------------
// Time helpers
// ---------------------------------------------------------------------------

bool hasValidTime() {
  return time(nullptr) > MIN_VALID_EPOCH;
}

String isoFromEpoch(time_t epoch) {
  struct tm timeinfo;
  gmtime_r(&epoch, &timeinfo);
  char buf[25];
  strftime(buf, sizeof(buf), "%Y-%m-%dT%H:%M:%SZ", &timeinfo);
  return String(buf);
}

String nowIso8601() {
  return isoFromEpoch(time(nullptr));
}

// ---------------------------------------------------------------------------
// Relay helpers
// ---------------------------------------------------------------------------

void relayWrite(bool energise) {
  bool level = RELAY_ACTIVE_LOW ? !energise : energise;
  digitalWrite(RELAY_PIN, level ? HIGH : LOW);
}

void startPumpCycle(const String &source) {
  if (pumpRunning) return; // already running, nothing to do
  relayWrite(true);
  pumpRunning = true;
  pumpStartMillis = millis();
  currentCycleSource = source;

  if (hasValidTime()) {
    cycleStartEpoch = time(nullptr);
  } else {
    cycleStartEpoch = 0;
    Serial.println("WARN: system clock not NTP-synced at pump start - this event's started_at will fall back to insert time");
  }

  Serial.print("Pump ON, source=");
  Serial.println(currentCycleSource);
}

void stopPumpCycle() {
  if (!pumpRunning) return; // already stopped, nothing to do
  relayWrite(false);
  pumpRunning = false;
  hasDurationDeadline = false;

  unsigned long elapsedMs = millis() - pumpStartMillis; // unsigned wraparound
  unsigned long runtimeSeconds = elapsedMs / 1000;

  // Runtime only - litres are the server's to work out from the zone's rate.
  Serial.print("Pump OFF, runtime_seconds=");
  Serial.println(runtimeSeconds);

  logIrrigationEvent(ZONE_ID, runtimeSeconds, currentCycleSource, cycleStartEpoch);
  currentCycleSource = "";
  cycleStartEpoch = 0;
}

// ---------------------------------------------------------------------------
// Moisture sensing - reporting only. Deciding what to DO about the reading
// (start/stop thresholds) is Zone.cs's job on AgroFlow.Api now, not this
// board's - see the sensor-readings endpoint below.
// ---------------------------------------------------------------------------

float readMoisturePercent() {
  int raw = analogRead(MOISTURE_PIN);
  // ADC_WET (fully wet) reads lower than ADC_DRY on resistive/capacitive
  // soil sensors - map and clamp to 0-100%.
  float percent = 100.0f * (float)(ADC_DRY - raw) / (float)(ADC_DRY - ADC_WET);
  if (percent < 0.0f) percent = 0.0f;
  if (percent > 100.0f) percent = 100.0f;
  return percent;
}

void checkDurationDeadline() {
  if (!hasDurationDeadline || !pumpRunning) return;
  if ((long)(millis() - cycleDeadlineMillis) >= 0) {
    Serial.println("Commanded duration elapsed, auto-stopping pump");
    stopPumpCycle();
  }
}

// ---------------------------------------------------------------------------
// AgroFlow.Api HTTP helpers
// ---------------------------------------------------------------------------

// applySupabaseHeaders() is gone along with SUPABASE_URL/SUPABASE_ANON_KEY -
// this board no longer talks to Supabase directly at all. See the config
// section above and markCommandExecuted().

void applyApiHeaders(HTTPClient &http) {
  http.addHeader("X-Api-Key", API_KEY);
  http.addHeader("Content-Type", "application/json");
}

// Opens an HTTPClient against API_BASE_URL over TLS.
//
// EVERY API CALL SITE MUST GO THROUGH THIS. API_BASE_URL is an https:// URL
// now that the API is deployed on Railway, and a plain WiFiClient cannot
// speak TLS - HTTPClient::begin() would fail outright, or (worse, on some
// core versions) connect and return garbage. Before this change these call
// sites each constructed their own plain WiFiClient, which was fine against
// the old http:// LAN address and is not fine now.
//
// setInsecure() skips server certificate validation.
//
//   TODO (security): pin the root CA instead of calling setInsecure(). As it
//   stands the connection is encrypted but unauthenticated, so an attacker
//   positioned on the network could impersonate the API host and feed this
//   board forged firmware-update URLs or swallow its irrigation events.
//   This matches the existing MQTT approach (mqttTlsClient.setInsecure(),
//   see setupMqtt()) and carries the same caveat - fixing one should fix
//   both. The fix is to embed the ISRG Root X1 / Let's Encrypt certificate
//   and call client.setCACert(); the cost is having to reflash when the root
//   rotates, which is why it has not been done yet.
bool beginApiRequest(WiFiClientSecure &client, HTTPClient &http, const String &url) {
  client.setInsecure(); // TODO: setCACert() - see the note above.
  if (!http.begin(client, url)) {
    Serial.print("ERROR: could not open HTTP(S) connection to ");
    Serial.println(url);
    return false;
  }
  applyApiHeaders(http);
  return true;
}

// ---------------------------------------------------------------------------
// Device enrollment / claim
// ---------------------------------------------------------------------------

// The ESP32's true unique hardware ID, burned into the chip at manufacture -
// NOT the WiFi station MAC (which is derived from this but is interface/mode
// specific). This is what hardware.device_id stores and what MQTT topics are
// keyed on (see hardware/shared/MQTT_TOPICS.md). Only the lower 48 bits are
// meaningful; formatted as 12 hex chars for a MAC-like, fixed-width string.
String getDeviceId() {
  uint64_t chipId = ESP.getEfuseMac();
  char buf[13];
  snprintf(buf, sizeof(buf), "%012llX", (unsigned long long)(chipId & 0xFFFFFFFFFFFFULL));
  return String(buf);
}

// Last 4 hex characters of the device ID - used to make the setup AP name
// unique per board.
String getDeviceIdSuffix() {
  String id = getDeviceId();
  return id.substring(id.length() - 4);
}

// Called once FARM_ID is known (either freshly from claimDevice(), or loaded
// from flash on a normal boot).
void buildMqttTopics() {
  String deviceId = getDeviceId();
  mqttSensorsTopic = "agroflow/farm/" + String(FARM_ID) + "/device/" + deviceId + "/sensors";
  mqttCommandsTopic = "agroflow/farm/" + String(FARM_ID) + "/device/" + deviceId + "/commands";
}

// Calls /api/devices/claim with this board's true device ID (see
// getDeviceId()) + the enrollment code entered into the setup portal. On
// success, persists the returned zoneId/farmId to flash and builds this
// board's MQTT topics - this is what replaces the old hardcoded per-board
// ZONE_ID constant. Returns false for any failure (bad/expired/already-used
// code, device ID mismatch against a pre-registered code, network error)
// without touching ZONE_ID/FARM_ID or flash state, so the caller can safely
// retry.
bool claimDevice(const String &enrollmentCode) {
  if (enrollmentCode.length() == 0) {
    Serial.println("No enrollment code entered - cannot claim device");
    return false;
  }
  if (WiFi.status() != WL_CONNECTED) return false;

  WiFiClientSecure client;
  HTTPClient http;
  String url = String(API_BASE_URL) + "/api/devices/claim";
  // Sends X-Api-Key (the shared device secret) in addition to the code itself.
  if (!beginApiRequest(client, http, url)) return false;

  JsonDocument doc;
  doc["deviceId"] = getDeviceId();
  doc["enrollmentCode"] = enrollmentCode;
  String body;
  serializeJson(doc, body);

  int httpCode = http.POST(body);
  if (httpCode < 200 || httpCode >= 300) {
    Serial.print("Device claim rejected, http=");
    Serial.println(httpCode);
    http.end();
    return false;
  }

  String payload = http.getString();
  http.end();

  JsonDocument responseDoc;
  if (deserializeJson(responseDoc, payload)) return false;

  long claimedZoneId = responseDoc["zoneId"] | 0L;
  long claimedFarmId = responseDoc["farmId"] | 0L;
  if (claimedZoneId <= 0 || claimedFarmId <= 0) return false;

  ZONE_ID = claimedZoneId;
  FARM_ID = claimedFarmId;
  preferences.putBool("claimed", true);
  preferences.putLong("zoneId", ZONE_ID);
  preferences.putLong("farmId", FARM_ID);
  buildMqttTopics();

  Serial.print("Device claimed successfully, zoneId=");
  Serial.print(ZONE_ID);
  Serial.print(" farmId=");
  Serial.println(FARM_ID);
  return true;
}

// ---------------------------------------------------------------------------
// OTA firmware updates
// ---------------------------------------------------------------------------

// Long-interval check only (see FIRMWARE_CHECK_INTERVAL_MS) - deliberately
// does not run every loop() iteration so it can't interfere with the 30s
// sensor-report cadence or MQTT's own keep-alive/receive loop.
void checkFirmwareUpdate() {
  if (WiFi.status() != WL_CONNECTED) return;

  WiFiClientSecure client;
  HTTPClient http;
  String url = String(API_BASE_URL) + "/api/devices/firmware-check?currentVersion=" + FIRMWARE_VERSION;
  if (!beginApiRequest(client, http, url)) return;

  int httpCode = http.GET();
  if (httpCode != 200) {
    http.end();
    return;
  }

  String payload = http.getString();
  http.end();

  JsonDocument doc;
  if (deserializeJson(doc, payload)) return;

  bool updateAvailable = doc["updateAvailable"] | false;
  const char *downloadUrl = doc["downloadUrl"];
  if (!updateAvailable || !downloadUrl) return;

  Serial.print("Firmware update available, fetching: ");
  Serial.println(downloadUrl);

  // downloadUrl comes from AgroFlow.Api config (Firmware:DownloadUrl) and
  // could point anywhere - Supabase Storage is always HTTPS, a plain file
  // server alongside the API might not be. Pick the client type to match
  // rather than assuming one.
  httpUpdate.rebootOnUpdate(true); // reboots automatically on a successful flash
  t_httpUpdate_return result;
  if (String(downloadUrl).startsWith("https://")) {
    WiFiClientSecure secureClient;
    secureClient.setInsecure(); // TODO: pin the real cert for production hardening.
    result = httpUpdate.update(secureClient, downloadUrl);
  } else {
    WiFiClient plainClient;
    result = httpUpdate.update(plainClient, downloadUrl);
  }

  switch (result) {
    case HTTP_UPDATE_FAILED:
      Serial.print("OTA update failed: ");
      Serial.println(httpUpdate.getLastErrorString());
      break;
    case HTTP_UPDATE_NO_UPDATES:
      Serial.println("OTA: server reported no update after all (race with a concurrent check?)");
      break;
    case HTTP_UPDATE_OK:
      Serial.println("OTA update applied - rebooting");
      break;
  }
}

// Publishes the current soil moisture reading to this board's MQTT sensors
// topic. AgroFlow.Api's MQTT subscriber inserts it into sensor_reading,
// computes the zone's health status, and decides whether to auto-start/stop
// irrigation - all logic that used to live in a Postgres trigger, then an
// HTTP endpoint, now lives in Zone.cs on that host, reached over MQTT.
//
// No temperature/humidity sensor is wired on this board (only a soil
// moisture probe), so only 'SoilMoisture' is reported. If a DHT11/DHT22 (or
// similar) is added later, report 'Temperature'/'Humidity' the same way -
// Zone.CalculateHealthStatus already handles those being null gracefully.
bool postSensorReading(const char *sensorType, float value) {
  if (!mqttClient.connected()) return false;

  JsonDocument doc;
  doc["sensorType"] = sensorType;
  doc["value"] = value;
  String body;
  serializeJson(doc, body);

  return mqttClient.publish(mqttSensorsTopic.c_str(), body.c_str());
}

void reportSensorReadings() {
  float moisture = readMoisturePercent();
  if (!postSensorReading("SoilMoisture", moisture)) {
    Serial.println("WARN: failed to publish SoilMoisture sensor reading over MQTT");
  }
}

// Fired by PubSubClient for any message on mqttCommandsTopic (subscribed in
// reconnectMqtt()). Applies the command to the relay, exactly like the old
// REST-polling checkForCommands() did, then acknowledges the command to
// AgroFlow.Api over HTTP (see markCommandExecuted() - that acknowledgement
// write stayed on HTTP; only command DELIVERY moved to MQTT). On any parse
// failure, leaves relay state untouched entirely - never guesses start or
// stop.
void handleMqttCommand(char *topic, byte *payload, unsigned int length) {
  JsonDocument doc;
  DeserializationError err = deserializeJson(doc, payload, length);
  if (err) {
    Serial.println("WARN: failed to parse MQTT command payload");
    return;
  }

  const char *commandId = doc["id"];
  const char *command = doc["command"];
  if (!commandId || !command) return;

  if (strcmp(command, "start") == 0) {
    hasDurationDeadline = !doc["durationSeconds"].isNull();
    if (hasDurationDeadline) {
      long durationSeconds = doc["durationSeconds"].as<long>();
      cycleDeadlineMillis = millis() + (unsigned long)durationSeconds * 1000UL;
      Serial.print("Start command with durationSeconds=");
      Serial.println(durationSeconds);
    } else {
      Serial.println("Start command with no duration - runs until explicit stop");
    }
    const char *source = doc["source"] | "unknown";
    startPumpCycle(String(source));
  } else if (strcmp(command, "stop") == 0) {
    stopPumpCycle();
  } else {
    return; // unrecognised command value - ignore rather than guess.
  }

  markCommandExecuted(commandId);
}

// Non-blocking reconnect attempt, rate-limited to MQTT_RECONNECT_INTERVAL_MS -
// safe to call every loop() iteration. Re-subscribes to mqttCommandsTopic on
// every successful (re)connect, since PubSubClient does not remember
// subscriptions across a dropped connection on its own.
void reconnectMqtt() {
  if (mqttClient.connected()) return;
  if (WiFi.status() != WL_CONNECTED) return;

  unsigned long nowMs = millis();
  if (nowMs - lastMqttReconnectAttemptMillis < MQTT_RECONNECT_INTERVAL_MS) return;
  lastMqttReconnectAttemptMillis = nowMs;

  Serial.print("Connecting to MQTT broker...");
  String clientId = "agroflow-" + getDeviceId();
  if (mqttClient.connect(clientId.c_str(), MQTT_USERNAME, MQTT_PASSWORD)) {
    Serial.println("connected");
    mqttClient.subscribe(mqttCommandsTopic.c_str());
    Serial.print("Subscribed to ");
    Serial.println(mqttCommandsTopic);
  } else {
    Serial.print("failed, rc=");
    Serial.println(mqttClient.state());
  }
}

// Acknowledges a command to AgroFlow.Api.
//
// WHAT THIS REPLACED, AND WHY
// ---------------------------
// This used to PATCH Supabase's REST API directly:
//
//     PATCH {SUPABASE_URL}/rest/v1/irrigation_commands?id=eq.{id}
//
// with the anon key. That never worked and never could have:
//
//   1. SUPABASE_URL and SUPABASE_ANON_KEY were still placeholders
//      ("YOUR_PROJECT_REF") in the committed sketch.
//   2. Even correctly filled in it would have been refused. Migration 0011
//      turned RLS on for irrigation_commands and grants the anon role SELECT
//      only - there is deliberately no UPDATE policy, because an anon write
//      to that table drives a physical valve.
//
// So acknowledgements never landed, every executed command stayed 'pending'
// forever, and the manual-override cooldown in SensorReadingProcessor - which
// keys off status = 'pending' - treated every past manual command as still
// outstanding.
//
// It now goes through AgroFlow.Api like every other call this board makes:
// X-Api-Key gated, written server-side via Npgsql as the table owner. The
// deviceId is sent so the API can verify this board is actually the one on
// that command's zone - X-Api-Key is shared by every board and proves only
// "a genuine AgroFlow device", so without it any board could acknowledge any
// other board's commands.
//
// Non-fatal on failure: the pump has already done what it was told. A missed
// ACK leaves the row 'pending', which means the API's replay sweep will
// redeliver the command - the endpoint is idempotent, so running it again and
// re-acknowledging is safe.
void markCommandExecuted(const char *commandId) {
  if (!hasValidTime()) {
    Serial.println("WARN: system clock not NTP-synced when marking command executed - executed_at will be wrong");
  }

  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("WARN: offline, cannot acknowledge command - the API will redeliver it");
    return;
  }

  WiFiClientSecure client;
  HTTPClient http;

  String url = String(API_BASE_URL) + "/api/devices/commands/" + String(commandId) + "/executed";
  if (!beginApiRequest(client, http, url)) return;

  JsonDocument doc;
  doc["deviceId"] = getDeviceId();
  if (hasValidTime()) {
    doc["executedAt"] = nowIso8601();
  }
  // executedAt omitted entirely when the clock is not NTP-synced, so the
  // server falls back to its own now() rather than recording an epoch-1970
  // timestamp - same fallback shape as started_at on irrigation events.
  String body;
  serializeJson(doc, body);

  int httpCode = http.POST(body);
  if (httpCode < 200 || httpCode >= 300) {
    Serial.print("WARN: failed to acknowledge command, http=");
    Serial.println(httpCode);
  }
  http.end();
}

// Posts one completed irrigation cycle to AgroFlow.Api, which inserts it
// into irrigation_event and updates the zone's running water usage total
// (Zone.AddWaterUsage) - the water-usage side of what used to be a Postgres
// trigger. syncStatus is 'synced' for a live post, 'offline_queued' when
// this call is flushing a previously buffered event - that value is kept
// permanently on the row as a record of how it was captured, not overwritten
// after the fact.
//
// startedAtEpoch is the wall-clock time the pump cycle actually started,
// captured on-device - this is what makes started_at correct for events that
// sat in the offline buffer for a while before syncing (otherwise the row
// would default to insert time, i.e. sync time, not irrigation time). If
// startedAtEpoch is 0 (clock wasn't synced when the cycle started), the
// startedAt field is omitted from the payload and AgroFlow.Api leaves it to
// Postgres's own default now() - a wrong-but-plausible fallback is worse for
// reporting than a visible gap, so we don't send a bogus 1970 timestamp.
bool postIrrigationEvent(long zoneId, unsigned long runtimeSeconds,
                          const String &source, const char *syncStatus, time_t startedAtEpoch) {
  if (WiFi.status() != WL_CONNECTED) return false;

  if (startedAtEpoch <= MIN_VALID_EPOCH) {
    Serial.println("WARN: posting irrigation event without a valid startedAt (NTP sync failed at cycle start) - AgroFlow.Api will fall back to insert time");
  }

  WiFiClientSecure client;
  HTTPClient http;

  String url = String(API_BASE_URL) + "/api/irrigation-events";
  if (!beginApiRequest(client, http, url)) return false;
  applyApiHeaders(http);

  JsonDocument doc;
  doc["zoneId"] = zoneId;
  doc["runtimeSeconds"] = runtimeSeconds;
  // estimatedLitres is deliberately NOT sent. The server derives litres from
  // zone.flow_rate_lpm; a value from here would be a second, competing answer.
  doc["triggerSource"] = source;
  doc["syncStatus"] = syncStatus;
  if (startedAtEpoch > MIN_VALID_EPOCH) {
    doc["startedAt"] = isoFromEpoch(startedAtEpoch);
  }
  String body;
  serializeJson(doc, body);

  int httpCode = http.POST(body);
  http.end();

  return httpCode >= 200 && httpCode < 300;
}

// ---------------------------------------------------------------------------
// Offline buffering
// ---------------------------------------------------------------------------

void bufferOfflineEvent(long zoneId, unsigned long runtimeSeconds,
                         const String &source, time_t startedAtEpoch) {
  if (offlineCount == OFFLINE_BUFFER_CAPACITY) {
    Serial.println("WARN: offline event buffer full, dropping oldest queued event");
    offlineHead = (offlineHead + 1) % OFFLINE_BUFFER_CAPACITY;
    offlineCount--;
  }

  int insertIndex = (offlineHead + offlineCount) % OFFLINE_BUFFER_CAPACITY;
  offlineBuffer[insertIndex] = { zoneId, runtimeSeconds, source, startedAtEpoch };
  offlineCount++;

  Serial.print("Buffered offline irrigation event, queue depth=");
  Serial.println(offlineCount);
}

void logIrrigationEvent(long zoneId, unsigned long runtimeSeconds,
                         const String &source, time_t startedAtEpoch) {
  if (WiFi.status() != WL_CONNECTED ||
      !postIrrigationEvent(zoneId, runtimeSeconds, source, "synced", startedAtEpoch)) {
    bufferOfflineEvent(zoneId, runtimeSeconds, source, startedAtEpoch);
  }
}

// Attempts to flush buffered events, oldest first. Stops at the first
// failure so a flaky connection doesn't reorder/skip entries - retried on
// the next connectivity check. An entry is only cleared once its POST
// actually succeeds. Each flushed event carries its ORIGINAL startedAtEpoch,
// captured back when the cycle actually ran - not the time of this flush.
void flushOfflineBuffer() {
  while (offlineCount > 0 && WiFi.status() == WL_CONNECTED) {
    PendingEvent &ev = offlineBuffer[offlineHead];
    bool ok = postIrrigationEvent(ev.zoneId, ev.runtimeSeconds,
                                   ev.triggerSource, "offline_queued", ev.startedAtEpoch);
    if (!ok) break;

    offlineHead = (offlineHead + 1) % OFFLINE_BUFFER_CAPACITY;
    offlineCount--;
    Serial.print("Flushed buffered irrigation event, queue depth=");
    Serial.println(offlineCount);
  }
}

// ---------------------------------------------------------------------------
// WiFi connectivity
// ---------------------------------------------------------------------------

void maintainWiFi() {
  bool isConnected = WiFi.status() == WL_CONNECTED;

  if (!isConnected) {
    unsigned long nowMs = millis();
    if (nowMs - lastWifiReconnectAttemptMillis >= WIFI_RECONNECT_INTERVAL_MS) {
      lastWifiReconnectAttemptMillis = nowMs;
      Serial.println("WiFi disconnected, attempting reconnect...");
      WiFi.reconnect();
    }
  }

  wasConnected = isConnected;
}

// ---------------------------------------------------------------------------
// Setup / loop
// ---------------------------------------------------------------------------

void setup() {
  Serial.begin(115200);

  pinMode(RELAY_PIN, OUTPUT);
  relayWrite(false); // start with pump definitively off

  analogReadResolution(12); // 0-4095, matches ADC_DRY/ADC_WET above

  mqttTlsClient.setInsecure(); // TODO: pin the HiveMQ Cloud root CA for production hardening.
  mqttClient.setServer(MQTT_HOST, MQTT_PORT);
  mqttClient.setCallback(handleMqttCommand);

  preferences.begin("agroflow", false);
  bool isClaimed = preferences.getBool("claimed", false);

  // WiFiManager owns WiFi.begin()/credential storage from here - no more
  // manual WiFi.begin(ssid, password). autoConnect() tries any previously
  // saved credentials first and only opens the captive portal if that fails
  // or none are saved yet.
  WiFiManager wm;
  wm.setConfigPortalTimeout(CONFIG_PORTAL_TIMEOUT_SECONDS);

  // Only prompt for an enrollment code when this device hasn't been claimed
  // yet - an already-claimed board reconnecting to known WiFi shouldn't show
  // this field (and WiFiManager wouldn't display it anyway on a silent
  // reconnect, since the portal page itself doesn't render).
  WiFiManagerParameter enrollmentCodeParam(
      "enrollcode", "Enrollment Code (from admin)", "", 9);
  if (!isClaimed) {
    wm.addParameter(&enrollmentCodeParam);
  }

  String apName = "AgroFlow-Setup-" + getDeviceIdSuffix();
  Serial.print("Starting WiFiManager, AP name if portal opens: ");
  Serial.println(apName);

  bool wifiOk = wm.autoConnect(apName.c_str());
  if (!wifiOk) {
    Serial.println("WiFi setup timed out with no credentials configured - restarting to retry.");
    delay(1000);
    ESP.restart();
  }

  Serial.print("WiFi connected, IP=");
  Serial.println(WiFi.localIP());

  // configTime() just kicks off SNTP - it does not block until synced, so
  // wait (bounded) and confirm the clock actually moved before trusting it.
  configTime(0, 0, "pool.ntp.org", "time.nist.gov");
  Serial.print("Waiting for NTP sync");
  unsigned long ntpStart = millis();
  while (!hasValidTime() && millis() - ntpStart < 10000) {
    delay(250);
    Serial.print(".");
  }
  Serial.println();

  if (hasValidTime()) {
    Serial.print("NTP synced, epoch=");
    Serial.println((long)time(nullptr));
  } else {
    Serial.println("WARN: NTP sync did not complete within 10s - event timestamps will fall back to insert time until it does");
  }

  if (isClaimed) {
    ZONE_ID = preferences.getLong("zoneId", 0);
    FARM_ID = preferences.getLong("farmId", 0);
    buildMqttTopics();
    Serial.print("Already claimed, using saved zoneId=");
    Serial.print(ZONE_ID);
    Serial.print(" farmId=");
    Serial.println(FARM_ID);
  } else {
    bool claimOk = claimDevice(enrollmentCodeParam.getValue());
    if (!claimOk) {
      // Never proceed as an unlinked device - wipe the WiFi credentials too
      // (not just the claim flag) so autoConnect() re-opens the full portal,
      // enrollment code field included, on the next boot instead of silently
      // reconnecting to WiFi with no zone assigned.
      Serial.println("Device claim failed - clearing WiFi credentials and restarting to show setup portal again.");
      wm.resetSettings();
      delay(1000);
      ESP.restart();
    }
  }

  reconnectMqtt(); // get the MQTT connection going immediately rather than waiting for the first loop() iteration

  // Give a freshly-provisioned (or just-rebooted) device a firmware check
  // right away rather than waiting a full FIRMWARE_CHECK_INTERVAL_MS.
  checkFirmwareUpdate();
}

void loop() {
  maintainWiFi();
  reconnectMqtt();
  mqttClient.loop(); // must be called frequently - processes incoming messages and keep-alive pings

  unsigned long nowMs = millis();

  if (nowMs - lastConnectivityCheckMillis >= CONNECTIVITY_CHECK_INTERVAL_MS) {
    lastConnectivityCheckMillis = nowMs;
    if (WiFi.status() == WL_CONNECTED && offlineCount > 0) {
      flushOfflineBuffer();
    }
  }

  if (nowMs - lastSensorReportMillis >= SENSOR_REPORT_INTERVAL_MS) {
    lastSensorReportMillis = nowMs;
    reportSensorReadings();
  }

  // Long interval, deliberately separate from the timers above - see
  // FIRMWARE_CHECK_INTERVAL_MS.
  if (nowMs - lastFirmwareCheckMillis >= FIRMWARE_CHECK_INTERVAL_MS) {
    lastFirmwareCheckMillis = nowMs;
    checkFirmwareUpdate();
  }

  checkDurationDeadline();
}
