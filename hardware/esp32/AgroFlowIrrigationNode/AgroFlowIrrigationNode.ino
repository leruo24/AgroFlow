// AgroFlow irrigation node - ESP32 firmware (v1.7.0).
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
//   7. Offline buffer (v1.5.0, every reading since v1.7.0): while MQTT is down the
//      board keeps each 30-second sensor reading in a bounded ring in flash (oldest
//      dropped first, each with its time), and publishes them in order with "recordedAt" when it is
//      back. The API stores them but never starts automatic watering from an old
//      reading. Pump runs the server has not heard about are kept the same way and
//      uploaded as irrigation events. The ring logic is OfflineBuffer.h (unit-tested
//      natively in hardware/esp32/tests).
//   8. Local page (v1.5.0): while the setup network is open, http://192.168.4.1/local
//      shows the latest readings and Start/Stop pump buttons. Only on the kit's own
//      WiFi, and it asks for the kit's local password (user "agroflow", the same
//      password as the setup network). Runs are capped at 5 minutes like every run,
//      and logged as manual irrigation events (uploaded on reconnect if offline).
//   9. The zone's mode (v1.5.1, from v1.4.1): GET /api/devices/config on boot and every
//      10 minutes while online says whether the zone is Automatic. The offline fallback only waters
//      when the last answer said so, kept in flash; a Manual or Scheduled zone, or a kit
//      that has never had an answer, is never watered by the kit on its own.
//  10. Run limits (v1.6.0): each zone has a maximum run time (1 to 120 minutes, set by staff),
//      sent with every command as "maxRunSeconds". A run lasts min(requested, that maximum),
//      never more than ABSOLUTE_MAX_RUN_MS, and 5 minutes when a command has no maximum
//      (an older server). RunLimits.h holds the rule (unit-tested natively).
//  11. Lost-connection failsafe (v1.6.0): a run the server started stops when the kit has had
//      no MQTT contact with the server for LOST_CONTACT_STOP_MS (3 minutes). The offline
//      fallback and the local page are meant to run offline and keep their own limits.
//  12. A command runs once (v1.7.0): the kit remembers the last RECENT_COMMAND_IDS command
//      IDs in flash, with the time it first acknowledged each. A repeated ID (the API resends
//      a command whose acknowledgement was lost; MQTT can deliver twice) gets that original
//      acknowledgement again and is never carried out a second time. The ID is saved before
//      the pump moves, so a reboot mid-run cannot repeat it either. Logic: CommandIds.h.
//  13. Backlog in the kit's status (v1.7.0): every published reading carries "backlog", the
//      number of readings still waiting to upload. The API keeps it on the kit's record.
//
// Libraries: ArduinoJson 7.x, WiFiManager (tzapu), PubSubClient (knolleary),
// DHTesp ("DHT sensor library for ESPx", beegee_tokyo).

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
#include "OfflineBuffer.h"
#include "CommandIds.h"
#include "RunLimits.h"
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
const char *FIRMWARE_VERSION = "1.7.0";
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
const time_t MIN_VALID_EPOCH = 1700000000;

// Offline buffer (OfflineBuffer.h). Sized to fit the board's settings flash (NVS)
// next to the WiFi details: 180 readings x 20 bytes, one soil + temperature +
// humidity sample every 30 seconds = about 30 minutes offline before the oldest
// is dropped. 32 pump runs x 16 bytes.
const size_t READING_BUFFER_CAPACITY = 180;
const size_t RUN_BUFFER_CAPACITY = 32;
const size_t REPLAY_BATCH = 5;            // per loop pass, so sensors and the safety cap keep running

// Command IDs already carried out (see 12. above): 32 x 44 bytes in flash, NVS key "cmdids".
const size_t RECENT_COMMAND_IDS = 32;

// Local page on the setup network (see 8. above).
const char *LOCAL_PAGE_USER = "agroflow";


// Run limits (see 10. and 11. above) and offline fallback.
const unsigned long ABSOLUTE_MAX_RUN_MS      = 120UL * 60UL * 1000UL; // no run longer than 120 min, ever
const unsigned long DEFAULT_MAX_RUN_MS       = 5UL * 60UL * 1000UL;   // a command with no maxRunSeconds
const unsigned long LOST_CONTACT_STOP_MS     = 3UL * 60UL * 1000UL;   // server run, no MQTT this long -> stop
const unsigned long LOCAL_MAX_RUN_MS         = 5UL * 60UL * 1000UL;   // the local page's own limit
const unsigned long LOCAL_MAX_RUN_MINUTES    = LOCAL_MAX_RUN_MS / 60000UL; // the local page offers 1..5
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
bool serverRun = false;       // true when the current run came from a server command (failsafe applies)
unsigned long runLimitMs = DEFAULT_MAX_RUN_MS;   // this run's own cap (checkSafetyCap)
unsigned long lastServerContactMillis = 0;       // last loop pass with MQTT connected

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

// Kept in flash (NVS keys "readbuf" / "runbuf") so a power cut does not lose them.
agroflow::RingBuffer<agroflow::BufferedReading, READING_BUFFER_CAPACITY> readingBuffer;
agroflow::RingBuffer<agroflow::BufferedRun, RUN_BUFFER_CAPACITY> runBuffer;
agroflow::RecentCommandIds<RECENT_COMMAND_IDS> recentCommands;
uint32_t nextReadingSeq = 1;
uint32_t nextRunSeq = 1;
uint16_t bootId = 0;

// The latest values, for the local page.
int lastSoilRaw = -1;
float lastSoilPercent = -1.0f;
float lastTemperature = NAN;
float lastHumidity = NAN;
bool localRoutesWanted = false;

void logIrrigationEvent(long zoneId, unsigned long runtimeSeconds, const String &source, time_t startedAtEpoch);
void markCommandExecuted(const char *commandId, uint32_t ackEpoch);
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

void saveRunBuffer();

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
  serverRun = false;
  runLimitMs = DEFAULT_MAX_RUN_MS;
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

// Safety: applies to every pump run, so a lost "stop" command can't flood the zone. Each
// run's cap is its own (the zone maximum, the local page's 5 minutes), and never more than
// ABSOLUTE_MAX_RUN_MS.
void checkSafetyCap() {
  unsigned long cap = runLimitMs < ABSOLUTE_MAX_RUN_MS ? runLimitMs : ABSOLUTE_MAX_RUN_MS;
  if (pumpRunning && millis() - pumpStartMillis >= cap) {
    Serial.println("SAFETY: max run time reached, stopping pump");
    stopPumpCycle();
  }
}

// Lost-connection failsafe (11. above): a run the server started stops after 3 minutes with
// no MQTT contact, so a kit that lost the server mid-run never keeps watering unattended.
void checkLostContact() {
  unsigned long nowMs = millis();
  if (mqttClient.connected()) { lastServerContactMillis = nowMs; return; }
  if (agroflow::lostContactShouldStop(serverRun, pumpRunning, nowMs, lastServerContactMillis, LOST_CONTACT_STOP_MS)) {
    Serial.println("SAFETY: no contact with the server for 3 minutes during a run, stopping pump");
    stopPumpCycle();   // the run is kept and uploaded on reconnect, like any offline run
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

// recordedAt is only sent for a buffered reading (epoch > 0): a live reading is
// timed by the server when it arrives, as before.
bool postSensorReading(const char *sensorType, float value, uint32_t recordedEpoch = 0, uint32_t seq = 0) {
  if (!mqttClient.connected()) return false;
  JsonDocument doc;
  doc["sensorType"] = sensorType;
  doc["value"] = value;
  if (recordedEpoch > 0) {
    doc["recordedAt"] = isoFromEpoch((time_t)recordedEpoch);
    doc["seq"] = seq;
  }
  // Readings still waiting after this one: a replayed reading is still in the ring.
  size_t waiting = readingBuffer.size();
  doc["backlog"] = (unsigned)(recordedEpoch > 0 && waiting > 0 ? waiting - 1 : waiting);
  String body;
  serializeJson(doc, body);
  return mqttClient.publish(mqttSensorsTopic.c_str(), body.c_str());
}

// Offline buffer persistence. One blob per ring; a failed write is logged and the
// ring is still kept in memory.
void saveReadingBuffer() {
  static uint8_t blob[decltype(readingBuffer)::blobSize()];
  size_t len = readingBuffer.toBytes(blob, sizeof(blob));
  if (readingBuffer.empty()) preferences.remove("readbuf");
  else if (preferences.putBytes("readbuf", blob, len) != len) Serial.println("WARN: could not save offline readings to flash");
  preferences.putULong("rseq", nextReadingSeq);
}

void saveRunBuffer() {
  static uint8_t blob[decltype(runBuffer)::blobSize()];
  size_t len = runBuffer.toBytes(blob, sizeof(blob));
  if (runBuffer.empty()) preferences.remove("runbuf");
  else if (preferences.putBytes("runbuf", blob, len) != len) Serial.println("WARN: could not save offline pump runs to flash");
  preferences.putULong("runseq", nextRunSeq);
}

void saveRecentCommands() {
  static uint8_t blob[decltype(recentCommands)::blobSize()];
  size_t len = recentCommands.toBytes(blob, sizeof(blob));
  if (preferences.putBytes("cmdids", blob, len) != len) Serial.println("WARN: could not save recent command IDs to flash");
}

void loadRecentCommands() {
  static uint8_t blob[decltype(recentCommands)::blobSize()];
  size_t len = preferences.getBytesLength("cmdids");
  if (len > 0 && len <= sizeof(blob) && preferences.getBytes("cmdids", blob, len) == len) recentCommands.fromBytes(blob, len);
}

void loadOfflineBuffers() {
  static uint8_t blob[decltype(readingBuffer)::blobSize()];
  size_t len = preferences.getBytesLength("readbuf");
  if (len > 0 && len <= sizeof(blob) && preferences.getBytes("readbuf", blob, len) == len) readingBuffer.fromBytes(blob, len);
  static uint8_t runBlob[decltype(runBuffer)::blobSize()];
  len = preferences.getBytesLength("runbuf");
  if (len > 0 && len <= sizeof(runBlob) && preferences.getBytes("runbuf", runBlob, len) == len) runBuffer.fromBytes(runBlob, len);
  nextReadingSeq = preferences.getULong("rseq", 1);
  nextRunSeq = preferences.getULong("runseq", 1);
  if (!readingBuffer.empty() || !runBuffer.empty()) {
    Serial.printf("Offline buffer restored: %u readings, %u pump runs waiting to upload\n",
                  (unsigned)readingBuffer.size(), (unsigned)runBuffer.size());
  }
}

void bufferReading(uint8_t kind, float value) {
  agroflow::BufferedReading r{};
  r.seq = nextReadingSeq++;
  r.epoch = hasValidTime() ? (uint32_t)time(nullptr) : 0;
  r.uptimeSec = millis() / 1000UL;
  r.value = value;
  r.bootId = bootId;
  r.kind = kind;
  if (readingBuffer.push(r)) Serial.println("WARN: offline reading buffer full, dropped the oldest reading");
}

// Sends buffered readings oldest first while MQTT is up. Stops at the first failed
// publish so the order holds; a reading leaves the buffer only once it was sent.
void replayBufferedReadings() {
  if (readingBuffer.empty() || !mqttClient.connected()) return;
  uint32_t nowEpoch = hasValidTime() ? (uint32_t)time(nullptr) : 0;
  uint32_t nowUptime = millis() / 1000UL;
  size_t sent = readingBuffer.replay([&](const agroflow::BufferedReading &r) {
    const char *type = agroflow::sensorKindName(r.kind);
    uint32_t when = agroflow::resolveEpoch(r, bootId, nowEpoch, nowUptime);
    if (type == nullptr || when == 0) return true;   // cannot be placed in time: drop it
    return postSensorReading(type, r.value, when, r.seq);
  }, REPLAY_BATCH);
  if (sent > 0) {
    saveReadingBuffer();
    if (readingBuffer.empty()) Serial.println("Offline readings uploaded - buffer empty");
  }
}

// Live while MQTT is up and nothing is waiting; otherwise into the buffer, so the
// readings reach the server in the order they were taken.
void sendOrBuffer(uint8_t kind, float value) {
  if (readingBuffer.empty() && postSensorReading(agroflow::sensorKindName(kind), value)) return;
  bufferReading(kind, value);
}

// Called every 30 seconds: read the soil probe and the DHT11, and publish each
// value to this board's MQTT sensors topic. While MQTT is down, keep every value
// in the offline buffer instead.
void reportSensorReadings() {
  bool online = mqttClient.connected();
  size_t bufferedBefore = readingBuffer.size();
  uint32_t droppedBefore = readingBuffer.dropped();

  int raw = readMoistureRaw();
  lastSoilRaw = raw;
  if (moistureValid(raw)) {
    float pct = rawToPercent(raw);
    lastSoilPercent = pct;
    if (online) sendOrBuffer(agroflow::kSoilMoisture, pct);
    else bufferReading(agroflow::kSoilMoisture, pct);
    Serial.printf("Soil raw=%d (%.0f%%)\n", raw, pct);
  } else {
    lastSoilPercent = -1.0f;
    Serial.printf("WARN: soil reading %d out of range - not sent (probe fault?)\n", raw);
  }

  TempAndHumidity v = dht.getTempAndHumidity();
  if (dht.getStatus() == DHTesp::ERROR_NONE &&
      v.temperature > -10 && v.temperature < 60 && v.humidity >= 0 && v.humidity <= 100) {
    lastTemperature = v.temperature;
    lastHumidity = v.humidity;
    if (online) {
      sendOrBuffer(agroflow::kTemperature, v.temperature);
      sendOrBuffer(agroflow::kHumidity, v.humidity);
    } else {
      bufferReading(agroflow::kTemperature, v.temperature);
      bufferReading(agroflow::kHumidity, v.humidity);
    }
    Serial.printf("DHT11 %.1f C %.0f %%\n", v.temperature, v.humidity);
  } else {
    lastTemperature = NAN;
    lastHumidity = NAN;
    // Send nothing: the server notices the gap (dht_offline), uses weather-app data,
    // and alerts the farmer and the team.
    Serial.printf("WARN: DHT11 %s - temperature/humidity not sent\n", dht.getStatusString());
  }

  if (readingBuffer.size() != bufferedBefore || readingBuffer.dropped() != droppedBefore) {
    saveReadingBuffer();
    if (!online) Serial.printf("Offline: %u readings kept for upload\n", (unsigned)readingBuffer.size());
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
  bool known = strcmp(command, "start") == 0 || strcmp(command, "stop") == 0 ||
               strcmp(command, "open_setup") == 0 || strcmp(command, "change_wifi") == 0;
  if (!known) return;

  // Already carried out (its acknowledgement was lost, or MQTT delivered it twice): send the
  // original acknowledgement again and do nothing else. Never waters a second time.
  int64_t firstAck = recentCommands.acknowledgedAt(commandId);
  if (firstAck >= 0) {
    Serial.printf("Command %s already carried out - acknowledging again, not repeating it\n", commandId);
    markCommandExecuted(commandId, (uint32_t)firstAck);
    return;
  }
  // Saved before acting, so a reboot part-way through cannot carry it out twice.
  uint32_t ackEpoch = hasValidTime() ? (uint32_t)time(nullptr) : 0;
  recentCommands.remember(commandId, ackEpoch);
  saveRecentCommands();

  if (strcmp(command, "start") == 0) {
    // One run at a time: a second start while watering changes nothing (it is still ACKed).
    if (!pumpRunning) {
      JsonVariantConst cmd = doc.as<JsonVariantConst>();
      long durationSeconds = cmd["durationSeconds"].isNull() ? 0 : cmd["durationSeconds"].as<long>();
      long maxRunSeconds = cmd["maxRunSeconds"].isNull() ? 0 : cmd["maxRunSeconds"].as<long>();
      if (durationSeconds < 0) durationSeconds = 0;
      if (maxRunSeconds < 0) maxRunSeconds = 0;
      // min(requested, zone maximum), never more than ABSOLUTE_MAX_RUN_MS (RunLimits.h).
      runLimitMs = agroflow::effectiveRunMs((unsigned long)durationSeconds * 1000UL,
                                            (unsigned long)maxRunSeconds * 1000UL,
                                            DEFAULT_MAX_RUN_MS, ABSOLUTE_MAX_RUN_MS);
      hasDurationDeadline = true;
      cycleDeadlineMillis = millis() + runLimitMs;
      const char *source = doc["source"] | "unknown";
      startPumpCycle(String(source), false);
      serverRun = true;
      lastServerContactMillis = millis();   // the command just came over MQTT
      Serial.printf("Run limit %lu s (asked %ld s, zone maximum %ld s)\n", runLimitMs / 1000UL, durationSeconds, maxRunSeconds);
    }
  } else if (strcmp(command, "stop") == 0) {
    stopPumpCycle();
  } else if (strcmp(command, "open_setup") == 0) {
    markCommandExecuted(commandId, ackEpoch);
    openSetupPortal("remote open_setup command");
    return;
  } else {   // change_wifi
    markCommandExecuted(commandId, ackEpoch);   // ACK while we still have the old WiFi
    forgetWifiAndOpenSetup("change WiFi requested from the app");
    return;
  }
  markCommandExecuted(commandId, ackEpoch);
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
    Serial.printf("Subscribed to %s; backlog %u readings, %u pump runs to upload\n",
                  mqttCommandsTopic.c_str(), (unsigned)readingBuffer.size(), (unsigned)runBuffer.size());
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

// ackEpoch: when the kit first carried the command out (0 if the clock was not set), so a
// repeat sends the same time as the original acknowledgement.
void markCommandExecuted(const char *commandId, uint32_t ackEpoch) {
  if (WiFi.status() != WL_CONNECTED) { Serial.println("WARN: offline, cannot ACK command - the API will redeliver it"); return; }
  WiFiClientSecure client;
  HTTPClient http;
  String url = String(API_BASE_URL) + "/api/devices/commands/" + String(commandId) + "/executed";
  if (!beginApiRequest(client, http, url)) return;

  JsonDocument doc;
  doc["deviceId"] = getDeviceId();
  if (ackEpoch > 0) doc["executedAt"] = isoFromEpoch((time_t)ackEpoch);
  else if (hasValidTime()) doc["executedAt"] = nowIso8601();
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

uint8_t runSourceCode(const String &source) {
  if (source == "auto") return agroflow::kRunAuto;
  if (source == "manual") return agroflow::kRunManual;
  if (source == "scheduled") return agroflow::kRunScheduled;
  return agroflow::kRunUnknown;
}

void bufferOfflineEvent(long zoneId, unsigned long runtimeSeconds, const String &source, time_t startedAtEpoch) {
  (void)zoneId;   // always this board's zone; ZONE_ID is used when it is uploaded
  agroflow::BufferedRun run{};
  run.seq = nextRunSeq++;
  run.startedEpoch = startedAtEpoch > MIN_VALID_EPOCH ? (uint32_t)startedAtEpoch : 0;
  run.runtimeSec = (uint32_t)runtimeSeconds;
  run.source = runSourceCode(source);
  if (runBuffer.push(run)) Serial.println("WARN: offline pump-run buffer full, dropped the oldest run");
  saveRunBuffer();
  Serial.printf("Pump run kept for upload (%u waiting)\n", (unsigned)runBuffer.size());
}

void logIrrigationEvent(long zoneId, unsigned long runtimeSeconds, const String &source, time_t startedAtEpoch) {
  if (WiFi.status() != WL_CONNECTED ||
      !postIrrigationEvent(zoneId, runtimeSeconds, source, "synced", startedAtEpoch)) {
    bufferOfflineEvent(zoneId, runtimeSeconds, source, startedAtEpoch);
  }
}

// Uploads kept pump runs oldest first, as offline_queued irrigation events. The API
// ignores a repeat of the same run (same zone, start time, runtime and source).
void flushOfflineBuffer() {
  if (runBuffer.empty() || WiFi.status() != WL_CONNECTED) return;
  size_t sent = runBuffer.replay([&](const agroflow::BufferedRun &run) {
    return postIrrigationEvent(ZONE_ID, run.runtimeSec, String(agroflow::runSourceName(run.source)),
                               "offline_queued", (time_t)run.startedEpoch);
  }, REPLAY_BATCH);
  if (sent > 0) {
    saveRunBuffer();
    Serial.printf("Uploaded %u kept pump run(s), %u still waiting\n", (unsigned)sent, (unsigned)runBuffer.size());
  }
}

// Local page (on the setup network only)

// The page itself: plain HTML and a little script that asks /local/status every 5 s.
// Kept small; the board has about 100 KB of program space to spare.
const char LOCAL_PAGE_HTML[] PROGMEM = R"HTML(<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>AgroFlow kit</title>
<style>body{font-family:system-ui,sans-serif;margin:0;padding:16px;background:#f5f6f5;color:#253126}
h1{font-size:20px;margin:0 0 4px}p{margin:6px 0}.card{background:#fff;border-radius:12px;padding:14px;margin:12px 0;box-shadow:0 1px 3px #0002}
.row{display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #eee}.row:last-child{border:0}
button,select{font-size:18px;min-height:48px;border-radius:10px;border:0;padding:0 16px}
.go{background:#168f99;color:#fff;width:100%;margin-top:10px}.stop{background:#d65a50;color:#fff;width:100%;margin-top:10px}
select{width:100%;border:1px solid #9fb799;background:#fff}.muted{color:#637064;font-size:14px}</style></head><body>
<h1>AgroFlow kit</h1><p class="muted">On this kit's own WiFi. Changes here do not need the internet.</p>
<div class="card"><div class="row"><span>Soil moisture</span><b id="soil">...</b></div>
<div class="row"><span>Temperature</span><b id="temp">...</b></div><div class="row"><span>Humidity</span><b id="hum">...</b></div>
<div class="row"><span>Pump</span><b id="pump">...</b></div><div class="row"><span>Internet</span><b id="net">...</b></div>
<div class="row"><span>Waiting to upload</span><b id="wait">...</b></div></div>
<div class="card"><label for="min">Run the pump for</label><select id="min"></select>
<button class="go" onclick="pump('start')">Start pump</button><button class="stop" onclick="pump('stop')">Stop pump</button>
<p class="muted" id="cap"></p><p id="msg" role="status"></p></div>
<p><a href="/">Back to WiFi setup</a></p>
<script>
var max=5;function q(i){return document.getElementById(i)}
function load(){fetch('/local/status').then(function(r){return r.json()}).then(function(s){
q('soil').textContent=s.soilPercent<0?'Probe not reading':Math.round(s.soilPercent)+'% (raw '+s.soilRaw+')';
q('temp').textContent=s.temperature==null?'Not reading':s.temperature.toFixed(1)+' C';
q('hum').textContent=s.humidity==null?'Not reading':Math.round(s.humidity)+'%';
q('pump').textContent=s.pumpRunning?'Running, '+Math.ceil(s.secondsLeft/60)+' min left at most':'Off';
q('net').textContent=s.online?'Connected':'Offline';q('wait').textContent=s.pendingReadings+' readings, '+s.pendingRuns+' pump runs';
if(s.maxMinutes!==max||!q('min').options.length){max=s.maxMinutes;q('min').innerHTML='';
for(var m=1;m<=max;m++){var o=document.createElement('option');o.value=m;o.textContent=m+(m==1?' minute':' minutes');q('min').appendChild(o)}}
q('cap').textContent='Every run stops by itself after '+max+' minutes at most.'}).catch(function(){q('msg').textContent='The kit did not answer. Are you still on its WiFi?'})}
function pump(a){q('msg').textContent='...';fetch('/local/pump?action='+a+'&minutes='+q('min').value,{method:'POST'})
.then(function(r){return r.text()}).then(function(t){q('msg').textContent=t;load()})
.catch(function(){q('msg').textContent='The kit did not answer.'})}
load();setInterval(load,5000);
</script></body></html>)HTML";

// Security: only on the kit's own WiFi (a phone on the farm's router never reaches
// it), and only with the kit's local password, which is also the setup network's.
bool localRequestAllowed() {
  WebServer &server = *wm.server;
  if (server.client().localIP() != WiFi.softAPIP()) {
    server.send(403, "text/plain", "The local page only works on the kit's own WiFi (AgroFlow-Setup-...).");
    return false;
  }
  if (!server.authenticate(LOCAL_PAGE_USER, apPassword().c_str())) {
    server.requestAuthentication(BASIC_AUTH, "AgroFlow kit");
    return false;
  }
  portalStartedMs = millis();   // someone is using it: keep the setup network open
  return true;
}

void handleLocalPage() {
  if (!localRequestAllowed()) return;
  wm.server->send_P(200, "text/html", LOCAL_PAGE_HTML);
}

void handleLocalStatus() {
  if (!localRequestAllowed()) return;
  JsonDocument doc;
  int raw = readMoistureRaw();
  doc["soilRaw"] = raw;
  doc["soilPercent"] = moistureValid(raw) ? rawToPercent(raw) : -1.0f;
  if (isnan(lastTemperature)) doc["temperature"] = nullptr; else doc["temperature"] = lastTemperature;
  if (isnan(lastHumidity)) doc["humidity"] = nullptr; else doc["humidity"] = lastHumidity;
  doc["pumpRunning"] = pumpRunning;
  unsigned long ranMs = pumpRunning ? millis() - pumpStartMillis : 0;
  unsigned long leftMs = 0;
  if (pumpRunning) {
    leftMs = ranMs < runLimitMs ? runLimitMs - ranMs : 0;
    if (hasDurationDeadline) {
      long toDeadline = (long)(cycleDeadlineMillis - millis());
      if (toDeadline < 0) toDeadline = 0;
      if ((unsigned long)toDeadline < leftMs) leftMs = (unsigned long)toDeadline;
    }
  }
  doc["secondsLeft"] = leftMs / 1000UL;
  doc["online"] = mqttClient.connected();
  doc["pendingReadings"] = (unsigned)readingBuffer.size();
  doc["pendingRuns"] = (unsigned)runBuffer.size();
  doc["maxMinutes"] = LOCAL_MAX_RUN_MINUTES;
  String body;
  serializeJson(doc, body);
  wm.server->send(200, "application/json", body);
}

// Start/Stop from the local page. The same rules as a command from the server: one
// run at a time, a duration, and the local page's 5-minute cap (checkSafetyCap) on top.
void handleLocalPump() {
  if (!localRequestAllowed()) return;
  WebServer &server = *wm.server;
  if (server.method() != HTTP_POST) { server.send(405, "text/plain", "Use the buttons on the page."); return; }
  String action = server.arg("action");
  if (action == "stop") {
    if (!pumpRunning) { server.send(200, "text/plain", "The pump is already off."); return; }
    stopPumpCycle();
    server.send(200, "text/plain", "Pump stopped. The run is logged.");
    return;
  }
  if (action != "start") { server.send(400, "text/plain", "Unknown action."); return; }
  long minutes = server.arg("minutes").toInt();
  if (minutes < 1) minutes = 1;
  if (minutes > (long)LOCAL_MAX_RUN_MINUTES) minutes = (long)LOCAL_MAX_RUN_MINUTES;
  if (pumpRunning) { server.send(409, "text/plain", "The pump is already running. Stop it first."); return; }
  if (!moistureValid(readMoistureRaw())) {
    // Watering is still allowed (the probe may be the fault), but say so.
    Serial.println("Local page: starting with the soil probe not reading");
  }
  hasDurationDeadline = true;
  cycleDeadlineMillis = millis() + (unsigned long)minutes * 60000UL;
  startPumpCycle("manual", false);
  runLimitMs = LOCAL_MAX_RUN_MS;   // not a server run: no lost-contact stop on the kit's own network
  Serial.printf("Local page: pump started for %ld min\n", minutes);
  server.send(200, "text/plain", "Pump started for " + String(minutes) + (minutes == 1 ? " minute." : " minutes."));
}

// Called by WiFiManager each time it (re)starts its web server, before its own pages.
void bindLocalRoutes() {
  if (!localRoutesWanted || !wm.server) return;
  wm.server->on("/local", HTTP_GET, handleLocalPage);
  wm.server->on("/local/status", HTTP_GET, handleLocalStatus);
  wm.server->on("/local/pump", handleLocalPump);
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
  if (WiFi.softAPgetStationNum() > 0) portalStartedMs = millis();   // someone is on the kit's WiFi
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

  // Which boot this is, so a buffered reading taken before the clock was set can
  // still be timed within the same boot (OfflineBuffer.h resolveEpoch).
  bootId = (uint16_t)(preferences.getUShort("bootId", 0) + 1);
  preferences.putUShort("bootId", bootId);
  loadOfflineBuffers();
  loadRecentCommands();

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

    // The setup network also serves the local page (readings, Start/Stop pump).
    // Its menu leaves out WiFiManager's firmware-upload page: firmware arrives by OTA.
    localRoutesWanted = true;
    wm.setWebServerCallback(bindLocalRoutes);
    wm.setCustomMenuHTML("<form action='/local' method='get'><button>Kit readings and pump</button></form><br/>");
    static const char *menu[] = {"wifi", "custom", "info", "exit"};
    wm.setMenu(menu, 4);
    wm.setAPClientCheck(true);   // do not time out while a phone is connected

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
    if (WiFi.status() == WL_CONNECTED && !runBuffer.empty()) flushOfflineBuffer();
    replayBufferedReadings();
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
  checkLostContact();
  runOfflineFallback();
}
