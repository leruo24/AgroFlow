// AgroFlow irrigation node - ESP32 firmware (v1.4.1).
//
// WiFiManager setup portal + one-time enrollment code -> /api/devices/claim.
// MQTT readings on agroflow/farm/{farmId}/device/{deviceId}/sensors as
// {"sensorType","value"}; commands on .../commands; pump runs logged to
// POST /api/irrigation-events; OTA check every 4 h. Pins: soil 32, relay 25, DHT11 27.
//
// What the board can do:
//   1. Change WiFi without opening the box. The setup page reopens when the board
//      is power-cycled 3 times quickly (within ~10 s each), when the saved
//      WiFi has been gone for 15 minutes, or on an {"command":"open_setup"} MQTT
//      command. The setup network is "AgroFlow-Setup-XXXX", password "AF-" + the
//      last 6 characters of the device ID (on the kit label). Watering keeps running.
//   2. Factory reset: power-cycle 5 times quickly. Wipes WiFi, zone/farm and every
//      credential, then opens setup for a new enrollment code.
//   3. Security: no secrets in the firmware image. secrets.h only holds API_BASE_URL.
//      The board gets its own device token from /api/devices/claim, keeps it only in
//      flash (NVS), never prints it, and wipes it on factory reset or when the server
//      revokes it, so one stolen board can be cut off on its own.
//   4. The MQTT login is fetched from GET /api/devices/mqtt-credentials on every boot
//      and kept in RAM only, so changing the MQTT password in Railway needs no reflash.
//   5. "Change WiFi" from the app: a {"command":"change_wifi"} command forgets the WiFi
//      and opens setup asking for WiFi only; the board keeps its farm and zone. Setup
//      keeps reopening until a new WiFi is saved, and watering uses the offline fallback.
//   6. The broker address can come from the server: if mqtt-credentials returns
//      mqttHost/mqttPort the board uses them, otherwise the compiled-in
//      MQTT_HOST/MQTT_PORT. Moving brokers is a Railway setting, not a reflash.
//   7. The zone's mode (v1.4.1): GET /api/devices/config on boot and every 10 minutes
//      while online says whether the zone is Automatic. The offline fallback only waters
//      when the last answer said so, kept in flash; a Manual or Scheduled zone, or a kit
//      that has never had an answer, is never watered by the kit on its own.
//
// Libraries: ArduinoJson 7.x, WiFiManager (tzapu), PubSubClient (knolleary),
// DHT sensor library for ESPx (beegee_tokyo).

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
#include "DHTesp.h"
#include "secrets.h"

// Config

const char *MQTT_HOST = "853fe2eddcd24d0c8e0f4d69869c5dab.s1.eu.hivemq.cloud";
const uint16_t MQTT_PORT = 8883;
const unsigned long MQTT_RECONNECT_INTERVAL_MS = 5000;

const uint16_t CONFIG_PORTAL_TIMEOUT_SECONDS = 300;               // setup page stays open 5 min
const unsigned long WIFI_DOWN_PORTAL_AFTER_MS = 15UL * 60UL * 1000UL; // saved WiFi gone this long -> open setup
const unsigned long BOOT_COUNTER_WINDOW_MS = 10000;                // power-cycle within this to count
const int BOOTS_FOR_PORTAL = 3;
const int BOOTS_FOR_FACTORY_RESET = 5;
const int MAX_AUTH_FAILURES = 3;                                   // consecutive 401s -> token revoked

// Update this and Firmware:LatestVersion in backend/AgroFlow.Api/appsettings.json each release.
const char *FIRMWARE_VERSION = "1.4.1";
const unsigned long FIRMWARE_CHECK_INTERVAL_MS = 4UL * 60UL * 60UL * 1000UL; // 4 hours

long ZONE_ID = 0;
long FARM_ID = 0;

// Fixed wiring: do not change these without rewiring the board.
const int MOISTURE_PIN = 32;   // resistive YL-69 probe AO, ADC1 (works with WiFi on)
const int RELAY_PIN    = 25;
const int DHT_PIN      = 27;
const bool RELAY_ACTIVE_LOW = true;

// Measured on this kit: higher raw = drier. Dry air reads 4095, fully under water
// about 1550. We only use these to turn raw into the reported percentage (air 0%, water 100%).
// Watering thresholds live on the server in the same percentage units.
const int ADC_DRY = 4095;
const int ADC_WET = 1550;
const int SOIL_MIN_VALID = 200;   // below = shorted / faulty probe

const unsigned long SENSOR_REPORT_INTERVAL_MS = 30000;
const unsigned long CONNECTIVITY_CHECK_INTERVAL_MS = 2000;
const unsigned long WIFI_RECONNECT_INTERVAL_MS = 10000;
const int OFFLINE_BUFFER_CAPACITY = 10;
const time_t MIN_VALID_EPOCH = 1700000000;

// Safety cap and offline fallback.
const unsigned long SAFETY_MAX_RUN_MS        = 5UL * 60UL * 1000UL;   // no run longer than 5 min, ever
const unsigned long OFFLINE_FALLBACK_AFTER_MS = 10UL * 60UL * 1000UL; // MQTT down this long -> water locally
const int FALLBACK_START_RAW = 2600;     // raw at/above = dry enough to water (previously tested values)
const int FALLBACK_STOP_RAW  = 2300;     // raw at/below = wet enough to stop
const unsigned long FALLBACK_MAX_RUN_MS  = 60000UL;           // ~1.5 L at 1.5 L/min
const unsigned long FALLBACK_MIN_REST_MS = 5UL * 60UL * 1000UL; // let water soak down to the probe
const unsigned long ZONE_CONFIG_INTERVAL_MS = 10UL * 60UL * 1000UL; // re-ask the zone's mode while online

// State

Preferences preferences;
WiFiClientSecure mqttTlsClient;
PubSubClient mqttClient(mqttTlsClient);
String mqttSensorsTopic;
String mqttCommandsTopic;
unsigned long lastMqttReconnectAttemptMillis = 0;
unsigned long lastMqttConnectedMillis = 0;

DHTesp dht;
WiFiManager wm;

// deviceToken: issued at claim, the only credential stored in flash (NVS), and revocable.
// mqttUser/mqttPass: fetched from the server on every boot, kept in RAM only, never printed.
String deviceToken = "";
String mqttUser = "";
String mqttPass = "";
int authFailures = 0;

String mqttHostOverride = "";        // from the server; must outlive setServer(), so kept global
uint16_t mqttPortOverride = 0;
bool wifiForgotten = false;          // "change WiFi" requested; cleared once a new WiFi is saved
unsigned long lastCredFetchMs = 0;
const unsigned long CRED_FETCH_RETRY_MS = 60000;

bool portalActive = false;
unsigned long portalStartedMs = 0;
unsigned long wifiDownSinceMs = 0;
bool bootCounterCleared = false;
bool timeConfigured = false;

bool pumpRunning = false;
unsigned long pumpStartMillis = 0;
unsigned long pumpStopMillis = 0;
time_t cycleStartEpoch = 0;
String currentCycleSource = "";
bool fallbackCycle = false;   // true when the current run was started by the offline fallback

// Whether the zone is Automatic, from GET /api/devices/config (kept in flash as "autoOk").
// False until the server has said yes: a Manual zone must never be watered by the kit itself.
bool autoWateringAllowed = false;
unsigned long lastZoneConfigMillis = 0;
bool zoneConfigFetched = false;

bool hasDurationDeadline = false;
unsigned long cycleDeadlineMillis = 0;

unsigned long lastSensorReportMillis = 0;
unsigned long lastConnectivityCheckMillis = 0;
unsigned long lastWifiReconnectAttemptMillis = 0;
unsigned long lastFirmwareCheckMillis = 0;
unsigned long lastFallbackCheckMillis = 0;

struct PendingEvent {
  long zoneId;
  unsigned long runtimeSeconds;
  String triggerSource;
  time_t startedAtEpoch;
};
PendingEvent offlineBuffer[OFFLINE_BUFFER_CAPACITY];
int offlineHead = 0;
int offlineCount = 0;

void logIrrigationEvent(long zoneId, unsigned long runtimeSeconds, const String &source, time_t startedAtEpoch);
void markCommandExecuted(const char *commandId);
void openSetupPortal(const char *reason);
void forgetWifiAndOpenSetup(const char *reason);
void factoryReset(const char *reason);

// Time helpers

bool hasValidTime() { return time(nullptr) > MIN_VALID_EPOCH; }

String isoFromEpoch(time_t epoch) {
  struct tm timeinfo;
  gmtime_r(&epoch, &timeinfo);
  char buf[25];
  strftime(buf, sizeof(buf), "%Y-%m-%dT%H:%M:%SZ", &timeinfo);
  return String(buf);
}

String nowIso8601() { return isoFromEpoch(time(nullptr)); }

// Relay / pump

void relayWrite(bool energise) {
  bool level = RELAY_ACTIVE_LOW ? !energise : energise;
  digitalWrite(RELAY_PIN, level ? HIGH : LOW);
}

void startPumpCycle(const String &source, bool isFallback) {
  if (pumpRunning) return;
  relayWrite(true);
  pumpRunning = true;
  fallbackCycle = isFallback;
  pumpStartMillis = millis();
  currentCycleSource = source;
  cycleStartEpoch = hasValidTime() ? time(nullptr) : 0;
  Serial.printf("Pump ON, source=%s%s\n", source.c_str(), isFallback ? " (offline fallback)" : "");
}

void stopPumpCycle() {
  if (!pumpRunning) return;
  relayWrite(false);
  pumpRunning = false;
  hasDurationDeadline = false;
  fallbackCycle = false;
  pumpStopMillis = millis();

  unsigned long runtimeSeconds = (millis() - pumpStartMillis) / 1000;
  Serial.printf("Pump OFF, runtime_seconds=%lu\n", runtimeSeconds);

  logIrrigationEvent(ZONE_ID, runtimeSeconds, currentCycleSource, cycleStartEpoch);
  currentCycleSource = "";
  cycleStartEpoch = 0;
}

void checkDurationDeadline() {
  if (!hasDurationDeadline || !pumpRunning) return;
  if ((long)(millis() - cycleDeadlineMillis) >= 0) {
    Serial.println("Commanded duration elapsed, auto-stopping pump");
    stopPumpCycle();
  }
}

// Safety: applies to every pump run, so a lost "stop" command can't flood the zone.
void checkSafetyCap() {
  if (pumpRunning && millis() - pumpStartMillis >= SAFETY_MAX_RUN_MS) {
    Serial.println("SAFETY: max run time reached, stopping pump");
    stopPumpCycle();
  }
}

// Sensors

int readMoistureRaw() {
  long sum = 0;
  for (int i = 0; i < 8; i++) { sum += analogRead(MOISTURE_PIN); delay(5); }
  return (int)(sum / 8);
}

bool moistureValid(int raw) { return raw >= SOIL_MIN_VALID && raw <= 4095; }

float rawToPercent(int raw) {
  float percent = 100.0f * (float)(ADC_DRY - raw) / (float)(ADC_DRY - ADC_WET);
  if (percent < 0.0f) percent = 0.0f;
  if (percent > 100.0f) percent = 100.0f;
  return percent;
}

// AgroFlow.Api HTTP helpers

void applyApiHeaders(HTTPClient &http) {
  if (deviceToken.length() > 0) http.addHeader("X-Device-Token", deviceToken);
  http.addHeader("Content-Type", "application/json");
}

// Called with every device-endpoint response. Repeated 401s mean the server has
// revoked this board's token, so we wipe the credentials.
void noteAuthResult(int httpCode) {
  if (httpCode == 401) {
    authFailures++;
    Serial.printf("WARN: API rejected device token (%d/%d)\n", authFailures, MAX_AUTH_FAILURES);
    if (authFailures >= MAX_AUTH_FAILURES) factoryReset("device token revoked by server");
  } else if (httpCode > 0) {
    authFailures = 0;
  }
}

// Every API call goes through here (TLS, headers added once).
bool beginApiRequest(WiFiClientSecure &client, HTTPClient &http, const String &url) {
  client.setInsecure(); // TODO (security): setCACert() with ISRG Root X1 for production.
  if (!http.begin(client, url)) {
    Serial.print("ERROR: could not open HTTP(S) connection to ");
    Serial.println(url);
    return false;
  }
  applyApiHeaders(http);
  return true;
}

// Device identity / enrollment

String getDeviceId() {
  uint64_t chipId = ESP.getEfuseMac();
  char buf[13];
  snprintf(buf, sizeof(buf), "%012llX", (unsigned long long)(chipId & 0xFFFFFFFFFFFFULL));
  return String(buf);
}

String getDeviceIdSuffix() {
  String id = getDeviceId();
  return id.substring(id.length() - 4);
}

String apName() { return "AgroFlow-Setup-" + getDeviceIdSuffix(); }

// Not a secret on its own (it is on the kit label); it stops passers-by changing the WiFi.
String apPassword() {
  String id = getDeviceId();
  return "AF-" + id.substring(id.length() - 6);
}

void buildMqttTopics() {
  String deviceId = getDeviceId();
  mqttSensorsTopic  = "agroflow/farm/" + String(FARM_ID) + "/device/" + deviceId + "/sensors";
  mqttCommandsTopic = "agroflow/farm/" + String(FARM_ID) + "/device/" + deviceId + "/commands";
}

// Security: the one-time enrollment code is the only authorisation for this call,
// so no shared key is compiled in. The API returns this board's zone/farm and its
// own credentials, which we store in NVS only.
bool claimDevice(const String &enrollmentCode) {
  if (enrollmentCode.length() == 0) { Serial.println("No enrollment code entered - cannot claim device"); return false; }
  if (WiFi.status() != WL_CONNECTED) return false;

  WiFiClientSecure client;
  HTTPClient http;
  deviceToken = "";   // no token yet
  if (!beginApiRequest(client, http, String(API_BASE_URL) + "/api/devices/claim")) return false;

  JsonDocument doc;
  doc["deviceId"] = getDeviceId();
  doc["enrollmentCode"] = enrollmentCode;
  doc["firmwareVersion"] = FIRMWARE_VERSION;
  String body;
  serializeJson(doc, body);

  int httpCode = http.POST(body);
  if (httpCode < 200 || httpCode >= 300) {
    Serial.printf("Device claim rejected, http=%d\n", httpCode);
    http.end();
    return false;
  }
  String payload = http.getString();
  http.end();

  JsonDocument r;
  if (deserializeJson(r, payload)) return false;
  long claimedZoneId = r["zoneId"] | 0L;
  long claimedFarmId = r["farmId"] | 0L;
  const char *tok = r["deviceToken"] | "";
  const char *mu  = r["mqttUsername"] | "";
  const char *mp  = r["mqttPassword"] | "";
  if (claimedZoneId <= 0 || claimedFarmId <= 0 || strlen(tok) == 0) {
    Serial.println("Claim response incomplete (needs zoneId, farmId, deviceToken)");
    return false;
  }
  // The MQTT login may be missing here; fetchMqttCredentials() gets it on first connect.

  ZONE_ID = claimedZoneId;
  FARM_ID = claimedFarmId;
  deviceToken = tok; mqttUser = mu; mqttPass = mp;   // mqtt values may be empty
  preferences.putBool("claimed", true);
  preferences.putLong("zoneId", ZONE_ID);
  preferences.putLong("farmId", FARM_ID);
  preferences.putString("token", deviceToken);   // MQTT login stays in RAM only
  buildMqttTopics();
  Serial.printf("Device claimed, zoneId=%ld farmId=%ld (credentials stored on device)\n", ZONE_ID, FARM_ID);
  return true;
}

// Ask the API for the current MQTT login. It is kept in RAM only, so a new password
// in Railway reaches each board on its next boot or retry.
bool fetchMqttCredentials() {
  if (WiFi.status() != WL_CONNECTED || deviceToken.length() == 0) return false;
  lastCredFetchMs = millis();
  WiFiClientSecure client;
  HTTPClient http;
  if (!beginApiRequest(client, http, String(API_BASE_URL) + "/api/devices/mqtt-credentials")) return false;
  int httpCode = http.GET();
  noteAuthResult(httpCode);
  if (httpCode != 200) { http.end(); Serial.printf("WARN: MQTT credential fetch failed, http=%d\n", httpCode); return false; }
  String payload = http.getString();
  http.end();
  JsonDocument r;
  if (deserializeJson(r, payload)) return false;
  const char *mu = r["mqttUsername"] | "";
  const char *mp = r["mqttPassword"] | "";
  if (strlen(mu) == 0 || strlen(mp) == 0) return false;
  mqttUser = mu; mqttPass = mp;
  const char *host = r["mqttHost"] | "";
  uint16_t port = r["mqttPort"] | 0;
  if (strlen(host) > 0) {
    mqttHostOverride = host;
    mqttPortOverride = port > 0 ? port : MQTT_PORT;
    mqttClient.setServer(mqttHostOverride.c_str(), mqttPortOverride);
    Serial.printf("MQTT broker from server: %s:%u\n", mqttHostOverride.c_str(), mqttPortOverride);
  }
  Serial.println("MQTT login received from server (held in memory only)");
  return true;
}

// Zone config: may this kit water by itself while offline?

void fetchZoneConfig() {
  if (WiFi.status() != WL_CONNECTED || deviceToken.length() == 0) return;
  lastZoneConfigMillis = millis();
  zoneConfigFetched = true;
  WiFiClientSecure client;
  HTTPClient http;
  if (!beginApiRequest(client, http, String(API_BASE_URL) + "/api/devices/config")) return;
  int httpCode = http.GET();
  noteAuthResult(httpCode);
  if (httpCode != 200) { http.end(); Serial.printf("WARN: zone config fetch failed, http=%d\n", httpCode); return; }
  String payload = http.getString();
  http.end();
  JsonDocument r;
  if (deserializeJson(r, payload)) return;
  bool allowed = r["autoWateringAllowed"] | false;
  const char *mode = r["irrigationMode"] | "unknown";
  if (allowed != autoWateringAllowed) {
    autoWateringAllowed = allowed;
    preferences.putBool("autoOk", allowed);
  }
  Serial.printf("Zone mode: %s (offline watering %s)\n", mode, allowed ? "allowed" : "off");
}

// OTA

void checkFirmwareUpdate() {
  if (WiFi.status() != WL_CONNECTED) return;
  if (pumpRunning) return;   // never reboot mid-watering

  WiFiClientSecure client;
  HTTPClient http;
  String url = String(API_BASE_URL) + "/api/devices/firmware-check?currentVersion=" + FIRMWARE_VERSION;
  if (!beginApiRequest(client, http, url)) return;

  int httpCode = http.GET();
  noteAuthResult(httpCode);
  if (httpCode != 200) { http.end(); return; }
  String payload = http.getString();
  http.end();

  JsonDocument doc;
  if (deserializeJson(doc, payload)) return;
  bool updateAvailable = doc["updateAvailable"] | false;
  const char *downloadUrl = doc["downloadUrl"];
  if (!updateAvailable || !downloadUrl) return;

  Serial.print("Firmware update available, fetching: ");
  Serial.println(downloadUrl);
  httpUpdate.rebootOnUpdate(true);
  t_httpUpdate_return result;
  if (String(downloadUrl).startsWith("https://")) {
    WiFiClientSecure secureClient;
    secureClient.setInsecure(); // TODO: pin cert for production.
    result = httpUpdate.update(secureClient, downloadUrl);
  } else {
    WiFiClient plainClient;
    result = httpUpdate.update(plainClient, downloadUrl);
  }
  if (result == HTTP_UPDATE_FAILED) {
    Serial.print("OTA update failed: ");
    Serial.println(httpUpdate.getLastErrorString());
  }
}

// MQTT

bool postSensorReading(const char *sensorType, float value) {
  if (!mqttClient.connected()) return false;
  JsonDocument doc;
  doc["sensorType"] = sensorType;
  doc["value"] = value;
  String body;
  serializeJson(doc, body);
  return mqttClient.publish(mqttSensorsTopic.c_str(), body.c_str());
}

// Called on a timer: read the soil probe and the DHT11, and publish each value
// to this board's MQTT sensors topic.
void reportSensorReadings() {
  int raw = readMoistureRaw();
  if (moistureValid(raw)) {
    float pct = rawToPercent(raw);
    if (!postSensorReading("SoilMoisture", pct)) Serial.println("WARN: SoilMoisture publish failed");
    Serial.printf("Soil raw=%d (%.0f%%)\n", raw, pct);
  } else {
    Serial.printf("WARN: soil reading %d out of range - not sent (probe fault?)\n", raw);
  }

  TempAndHumidity v = dht.getTempAndHumidity();
  if (dht.getStatus() == DHTesp::ERROR_NONE &&
      v.temperature > -10 && v.temperature < 60 && v.humidity >= 0 && v.humidity <= 100) {
    postSensorReading("Temperature", v.temperature);
    postSensorReading("Humidity", v.humidity);
    Serial.printf("DHT11 %.1f C %.0f %%\n", v.temperature, v.humidity);
  } else {
    // Send nothing: the server notices the gap (dht_offline), uses weather-app data,
    // and alerts the farmer and the team.
    Serial.printf("WARN: DHT11 %s - temperature/humidity not sent\n", dht.getStatusString());
  }
}

// Commands from the backend (start / stop the pump, setup actions). After
// acting, the board acknowledges the command so the app can show it was done.
void handleMqttCommand(char *topic, byte *payload, unsigned int length) {
  JsonDocument doc;
  if (deserializeJson(doc, payload, length)) { Serial.println("WARN: failed to parse MQTT command payload"); return; }

  const char *commandId = doc["id"];
  const char *command = doc["command"];
  if (!commandId || !command) return;

  if (strcmp(command, "start") == 0) {
    hasDurationDeadline = !doc["durationSeconds"].isNull();
    if (hasDurationDeadline) {
      long durationSeconds = doc["durationSeconds"].as<long>();
      cycleDeadlineMillis = millis() + (unsigned long)durationSeconds * 1000UL;
    }
    const char *source = doc["source"] | "unknown";
    startPumpCycle(String(source), false);
  } else if (strcmp(command, "stop") == 0) {
    stopPumpCycle();
  } else if (strcmp(command, "open_setup") == 0) {
    markCommandExecuted(commandId);
    openSetupPortal("remote open_setup command");
    return;
  } else if (strcmp(command, "change_wifi") == 0) {
    markCommandExecuted(commandId);   // ACK while we still have the old WiFi
    forgetWifiAndOpenSetup("change WiFi requested from the app");
    return;
  } else {
    return;
  }
  markCommandExecuted(commandId);
}

void reconnectMqtt() {
  if (mqttClient.connected()) { lastMqttConnectedMillis = millis(); return; }
  if (WiFi.status() != WL_CONNECTED) return;
  if (FARM_ID <= 0) return;
  if (mqttUser.length() == 0) {
    if (millis() - lastCredFetchMs >= CRED_FETCH_RETRY_MS || lastCredFetchMs == 0) fetchMqttCredentials();
    if (mqttUser.length() == 0) return;
  }

  unsigned long nowMs = millis();
  if (nowMs - lastMqttReconnectAttemptMillis < MQTT_RECONNECT_INTERVAL_MS) return;
  lastMqttReconnectAttemptMillis = nowMs;

  Serial.print("Connecting to MQTT broker...");
  String clientId = "agroflow-" + getDeviceId();
  if (mqttClient.connect(clientId.c_str(), mqttUser.c_str(), mqttPass.c_str())) {
    Serial.println("connected");
    lastMqttConnectedMillis = millis();
    mqttClient.subscribe(mqttCommandsTopic.c_str());
    if (fallbackCycle) {
      Serial.println("MQTT back - ending offline-fallback watering, server control resumes");
      stopPumpCycle();
    }
  } else {
    int rc = mqttClient.state();
    Serial.printf("failed, rc=%d\n", rc);
    if (rc == 4 || rc == 5) { mqttUser = ""; mqttPass = ""; }   // bad/rotated login: fetch fresh
  }
}

// Offline fallback watering

void runOfflineFallback() {
  if (mqttClient.connected()) return;
  // Only an Automatic zone (last answer from /api/devices/config). Manual means never by itself.
  if (!autoWateringAllowed) {
    if (pumpRunning && fallbackCycle) stopPumpCycle();
    return;
  }
  unsigned long nowMs = millis();
  if (nowMs - lastMqttConnectedMillis < OFFLINE_FALLBACK_AFTER_MS) return;
  if (nowMs - lastFallbackCheckMillis < 1000) return;
  lastFallbackCheckMillis = nowMs;

  int raw = readMoistureRaw();
  if (!moistureValid(raw)) {
    if (pumpRunning && fallbackCycle) stopPumpCycle();
    return;
  }
  if (pumpRunning) {
    if (fallbackCycle && (raw <= FALLBACK_STOP_RAW || nowMs - pumpStartMillis >= FALLBACK_MAX_RUN_MS)) stopPumpCycle();
    return;
  }
  if (raw >= FALLBACK_START_RAW && nowMs - pumpStopMillis >= FALLBACK_MIN_REST_MS) {
    // Logged as "auto" to fit irrigation_event.trigger_source; Serial shows it was a fallback.
    startPumpCycle("auto", true);
  }
}

// Command ACK + irrigation events (HTTP)

void markCommandExecuted(const char *commandId) {
  if (WiFi.status() != WL_CONNECTED) { Serial.println("WARN: offline, cannot ACK command - the API will redeliver it"); return; }
  WiFiClientSecure client;
  HTTPClient http;
  String url = String(API_BASE_URL) + "/api/devices/commands/" + String(commandId) + "/executed";
  if (!beginApiRequest(client, http, url)) return;

  JsonDocument doc;
  doc["deviceId"] = getDeviceId();
  if (hasValidTime()) doc["executedAt"] = nowIso8601();
  String body;
  serializeJson(doc, body);
  int httpCode = http.POST(body);
  noteAuthResult(httpCode);
  if (httpCode < 200 || httpCode >= 300) Serial.printf("WARN: command ACK failed, http=%d\n", httpCode);
  http.end();
}

bool postIrrigationEvent(long zoneId, unsigned long runtimeSeconds,
                         const String &source, const char *syncStatus, time_t startedAtEpoch) {
  if (WiFi.status() != WL_CONNECTED) return false;
  WiFiClientSecure client;
  HTTPClient http;
  if (!beginApiRequest(client, http, String(API_BASE_URL) + "/api/irrigation-events")) return false;

  JsonDocument doc;
  doc["zoneId"] = zoneId;
  doc["runtimeSeconds"] = runtimeSeconds;
  doc["triggerSource"] = source;
  doc["syncStatus"] = syncStatus;
  if (startedAtEpoch > MIN_VALID_EPOCH) doc["startedAt"] = isoFromEpoch(startedAtEpoch);
  String body;
  serializeJson(doc, body);

  int httpCode = http.POST(body);
  http.end();
  noteAuthResult(httpCode);
  return httpCode >= 200 && httpCode < 300;
}

void bufferOfflineEvent(long zoneId, unsigned long runtimeSeconds, const String &source, time_t startedAtEpoch) {
  if (offlineCount == OFFLINE_BUFFER_CAPACITY) {
    Serial.println("WARN: offline event buffer full, dropping oldest");
    offlineHead = (offlineHead + 1) % OFFLINE_BUFFER_CAPACITY;
    offlineCount--;
  }
  int insertIndex = (offlineHead + offlineCount) % OFFLINE_BUFFER_CAPACITY;
  offlineBuffer[insertIndex] = { zoneId, runtimeSeconds, source, startedAtEpoch };
  offlineCount++;
}

void logIrrigationEvent(long zoneId, unsigned long runtimeSeconds, const String &source, time_t startedAtEpoch) {
  if (WiFi.status() != WL_CONNECTED ||
      !postIrrigationEvent(zoneId, runtimeSeconds, source, "synced", startedAtEpoch)) {
    bufferOfflineEvent(zoneId, runtimeSeconds, source, startedAtEpoch);
  }
}

void flushOfflineBuffer() {
  while (offlineCount > 0 && WiFi.status() == WL_CONNECTED) {
    PendingEvent &ev = offlineBuffer[offlineHead];
    if (!postIrrigationEvent(ev.zoneId, ev.runtimeSeconds, ev.triggerSource, "offline_queued", ev.startedAtEpoch)) break;
    offlineHead = (offlineHead + 1) % OFFLINE_BUFFER_CAPACITY;
    offlineCount--;
  }
}

// WiFi

// Opens the setup page without blocking: watering, sensors and the offline fallback
// keep running. Saving new WiFi details reconnects automatically.
void openSetupPortal(const char *reason) {
  if (portalActive) return;
  Serial.printf("Opening setup page (%s): join WiFi \"%s\"\n", reason, apName().c_str());
  wm.setConfigPortalBlocking(false);
  wm.setConfigPortalTimeout(CONFIG_PORTAL_TIMEOUT_SECONDS);
  wm.startConfigPortal(apName().c_str(), apPassword().c_str());
  portalActive = true;
  portalStartedMs = millis();
}

// Forget the saved WiFi but keep the enrollment (farm, zone, device token), then open
// setup, which only asks for WiFi.
void forgetWifiAndOpenSetup(const char *reason) {
  Serial.printf("Forgetting saved WiFi (%s)\n", reason);
  wifiForgotten = true;
  preferences.putBool("wifiForgot", true);   // survive a reboot mid-setup
  mqttClient.disconnect();
  wm.resetSettings();                         // erases saved WiFi only; NVS "agroflow" untouched
  openSetupPortal(reason);
}

void servicePortal() {
  if (!portalActive) return;
  if (wm.process()) {                       // new WiFi saved and connected
    Serial.println("Setup page: new WiFi saved, connected");
    portalActive = false;
    wifiDownSinceMs = 0;
    wifiForgotten = false;
    preferences.putBool("wifiForgot", false);
    return;
  }
  if (millis() - portalStartedMs > (unsigned long)CONFIG_PORTAL_TIMEOUT_SECONDS * 1000UL + 5000UL) {
    wm.stopConfigPortal();
    portalActive = false;
    if (wifiForgotten) {
      // No saved WiFi to fall back to: keep offering setup until someone completes it.
      openSetupPortal("still waiting for a new WiFi");
      return;
    }
    Serial.println("Setup page closed (timeout) - retrying saved WiFi");
    WiFi.mode(WIFI_STA);
    WiFi.begin();
  }
}

void maintainWiFi() {
  if (WiFi.status() == WL_CONNECTED) {
    wifiDownSinceMs = 0;
    if (!timeConfigured) { configTime(0, 0, "pool.ntp.org", "time.nist.gov"); timeConfigured = true; }
    return;
  }
  unsigned long nowMs = millis();
  if (wifiDownSinceMs == 0) wifiDownSinceMs = nowMs;

  if (wifiForgotten) { if (!portalActive) openSetupPortal("still waiting for a new WiFi"); return; }

  // Saved network gone for a long time (new router or password): offer setup.
  if (!portalActive && nowMs - wifiDownSinceMs >= WIFI_DOWN_PORTAL_AFTER_MS) {
    openSetupPortal("saved WiFi unreachable for 15 min");
    wifiDownSinceMs = nowMs;                // if it times out, wait another 15 min
    return;
  }
  if (!portalActive && nowMs - lastWifiReconnectAttemptMillis >= WIFI_RECONNECT_INTERVAL_MS) {
    lastWifiReconnectAttemptMillis = nowMs;
    Serial.println("WiFi disconnected, attempting reconnect...");
    WiFi.reconnect();
  }
}

// Wipes everything the board knows (WiFi, zone/farm, token, MQTT login) and reboots
// into setup. Used to reassign a kit, and when the token is revoked.
void factoryReset(const char *reason) {
  Serial.printf("FACTORY RESET (%s): wiping WiFi and all stored credentials\n", reason);
  relayWrite(false);
  preferences.clear();
  wm.resetSettings();
  delay(500);
  ESP.restart();
}

// Counts quick power cycles. Cleared once the board has run for BOOT_COUNTER_WINDOW_MS.
int bumpBootCounter() {
  int c = preferences.getInt("bootCount", 0) + 1;
  preferences.putInt("bootCount", c);
  return c;
}

void clearBootCounterWhenStable() {
  if (!bootCounterCleared && millis() > BOOT_COUNTER_WINDOW_MS) {
    preferences.putInt("bootCount", 0);
    bootCounterCleared = true;
  }
}

// Setup / loop

void setup() {
  pinMode(RELAY_PIN, OUTPUT);
  relayWrite(false);                 // pump definitively off before anything else
  Serial.begin(115200);

  analogReadResolution(12);
  analogSetPinAttenuation(MOISTURE_PIN, ADC_11db);
  dht.setup(DHT_PIN, DHTesp::DHT11);

  mqttTlsClient.setInsecure();       // TODO: pin HiveMQ root CA for production.
  mqttClient.setServer(MQTT_HOST, MQTT_PORT);
  mqttClient.setCallback(handleMqttCommand);

  preferences.begin("agroflow", false);

  int boots = bumpBootCounter();
  if (boots >= BOOTS_FOR_FACTORY_RESET) factoryReset("5 quick power cycles");

  deviceToken = preferences.getString("token", "");
  autoWateringAllowed = preferences.getBool("autoOk", false);
  preferences.remove("mqttUser");             // v1.2.0 stored these; v1.3.0 keeps them in RAM only
  preferences.remove("mqttPass");
  wifiForgotten = preferences.getBool("wifiForgot", false);
  // A board claimed by older firmware has no token, so we treat it as unclaimed.
  bool isClaimed = preferences.getBool("claimed", false) && deviceToken.length() > 0;

  Serial.print("AgroFlow node v");
  Serial.print(FIRMWARE_VERSION);
  Serial.print(" - device ");
  Serial.println(getDeviceId());

  if (!isClaimed) {
    // First-time setup (or after factory reset): blocking portal with the enrollment code field.
    WiFiManagerParameter enrollmentCodeParam("enrollcode", "Enrollment Code (from admin)", "", 9);
    wm.addParameter(&enrollmentCodeParam);
    wm.setConfigPortalBlocking(true);
    wm.setConfigPortalTimeout(CONFIG_PORTAL_TIMEOUT_SECONDS);
    Serial.printf("Not set up yet: join WiFi \"%s\" to enter farm WiFi + enrollment code\n", apName().c_str());
    preferences.putInt("bootCount", 0);
    if (!wm.startConfigPortal(apName().c_str(), apPassword().c_str())) {
      Serial.println("Setup timed out - restarting to retry.");
      delay(1000);
      ESP.restart();
    }
    configTime(0, 0, "pool.ntp.org", "time.nist.gov");
    timeConfigured = true;
    if (!claimDevice(enrollmentCodeParam.getValue())) {
      Serial.println("Device claim failed - wiping and restarting into setup.");
      preferences.clear();
      wm.resetSettings();
      delay(1000);
      ESP.restart();
    }
  } else {
    ZONE_ID = preferences.getLong("zoneId", 0);
    FARM_ID = preferences.getLong("farmId", 0);
    buildMqttTopics();
    Serial.printf("Claimed: zoneId=%ld farmId=%ld\n", ZONE_ID, FARM_ID);

    // Connect to the saved WiFi without blocking, so watering starts even if the network
    // is down. maintainWiFi() handles reconnects and the 15-minute setup offer.
    WiFi.mode(WIFI_STA);
    unsigned long t0 = millis();
    if (!wifiForgotten) {
      WiFi.begin();
      while (WiFi.status() != WL_CONNECTED && millis() - t0 < 15000) delay(250);
    }
    if (WiFi.status() == WL_CONNECTED) {
      Serial.print("WiFi connected, IP=");
      Serial.println(WiFi.localIP());
    } else {
      Serial.println("WiFi not connected yet - running offline, will keep retrying");
    }

    if (wifiForgotten) openSetupPortal("still waiting for a new WiFi");
    else if (boots >= BOOTS_FOR_PORTAL) openSetupPortal("3 quick power cycles");
  }

  pumpStopMillis = millis() - FALLBACK_MIN_REST_MS;
  lastMqttConnectedMillis = millis();   // offline-fallback timer starts from boot
  fetchZoneConfig();
  reconnectMqtt();
  checkFirmwareUpdate();
}

void loop() {
  clearBootCounterWhenStable();
  servicePortal();
  maintainWiFi();
  reconnectMqtt();
  mqttClient.loop();

  unsigned long nowMs = millis();

  if (nowMs - lastConnectivityCheckMillis >= CONNECTIVITY_CHECK_INTERVAL_MS) {
    lastConnectivityCheckMillis = nowMs;
    if (WiFi.status() == WL_CONNECTED && offlineCount > 0) flushOfflineBuffer();
  }

  if (nowMs - lastSensorReportMillis >= SENSOR_REPORT_INTERVAL_MS) {
    lastSensorReportMillis = nowMs;
    reportSensorReadings();
  }

  if (WiFi.status() == WL_CONNECTED &&
      (!zoneConfigFetched || nowMs - lastZoneConfigMillis >= ZONE_CONFIG_INTERVAL_MS)) {
    fetchZoneConfig();
  }

  if (nowMs - lastFirmwareCheckMillis >= FIRMWARE_CHECK_INTERVAL_MS) {
    lastFirmwareCheckMillis = nowMs;
    checkFirmwareUpdate();
  }

  checkDurationDeadline();
  checkSafetyCap();
  runOfflineFallback();
}
