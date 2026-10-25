// AgroFlow irrigation node - ESP32 firmware (v1.7.2).
//
// Setup hotspot (no password) with its own setup page + a 6-digit code -> /api/devices/claim.
// MQTT readings on agroflow/{deviceId}/telemetry as {"sensorType","value"}; commands on
// agroflow/{deviceId}/cmd; acknowledgements on agroflow/{deviceId}/ack; online/offline on
// agroflow/{deviceId}/status. Pump runs logged to POST /api/irrigation-events; OTA check
// every 4 h. Pins: soil 32, relay 25, DHT11 27.
//
// What the board can do:
//   1. Link to a farm in one go (1.7.2). Unlinked, the kit opens the Wi-Fi "AgroFlow-Setup-XXXX"
//      with NO password; a phone joining it is shown the setup page (or open http://192.168.4.1).
//      One form: the farm Wi-Fi (from a scan list, or typed), its password and the 6-digit code
//      from AgroFlow. The hotspot stays up while the kit joins the Wi-Fi and calls the claim
//      endpoint, and the page shows "Linked to <farm> - <zone>" or a clear problem (wrong Wi-Fi
//      password, network not found / 5 GHz, code expired or used, kit linked to another farm,
//      AgroFlow not reachable). The hotspot closes only after success. SetupPortal.h holds the
//      words (unit-tested natively).
//   2. Change Wi-Fi without opening the box. The setup page reopens (asking for Wi-Fi only) when
//      the board is power-cycled 3 times quickly (within ~10 s each), when the saved Wi-Fi has
//      been gone for 15 minutes, or on an {"command":"open_setup"} MQTT command. Watering keeps
//      running.
//   3. Factory reset: power-cycle 5 times quickly. Wipes Wi-Fi, zone/farm and every
//      credential, then opens setup for a new code.
//   4. Security: no secrets in the firmware image. secrets.h only holds API_BASE_URL.
//      The claim returns this board's device token, AgroFlow's MQTT login and broker, and its
//      topics; the board keeps them in flash (NVS), never prints them, and wipes them on
//      unlink, factory reset or when the server revokes the token.
//   5. "Change WiFi" from the app: a {"command":"change_wifi"} command forgets the Wi-Fi
//      and opens setup asking for Wi-Fi only; the board keeps its farm and zone. Setup
//      keeps reopening until a new Wi-Fi is saved, and watering uses the offline fallback.
//   6. "Unlink" (1.7.2): an {"command":"unlink"} message (the kit was replaced or moved) makes the
//      board forget its farm, zone and logins and reopen the setup hotspot for a new code.
//   7. Offline buffer (v1.5.0, every reading since v1.7.0): while MQTT is down the
//      board keeps each 30-second sensor reading in a bounded ring in flash (oldest
//      dropped first, each with its time), and publishes them in order with "recordedAt" when it is
//      back. The API stores them but never starts automatic watering from an old
//      reading. Pump runs the server has not heard about are kept the same way and
//      uploaded as irrigation events. The ring logic is OfflineBuffer.h (unit-tested
//      natively in hardware/esp32/tests).
//   8. Local page (v1.5.0): while the setup network is open, http://192.168.4.1/local
//      shows the latest readings and Start/Stop pump buttons. Only on the kit's own
//      Wi-Fi, and it asks for the kit's local password (user "agroflow", "AF-" + the last 6
//      characters of the device ID, printed at boot). Runs are capped at 5 minutes like every
//      run, and logged as manual irrigation events (uploaded on reconnect if offline).
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
//  14. Setup details on Serial Monitor (v1.7.1): at boot and whenever the setup page opens, the
//      kit prints its device ID, setup Wi-Fi name, local page password and the setup page
//      address. Every reading also carries "rssi" (the Wi-Fi signal, dBm) and "soilProbeOk".
//  15. Online/offline (1.7.2): the MQTT last will is "offline" on agroflow/{deviceId}/status
//      (retained); on every connect the kit publishes {"state":"online","firmware","rssi"} there
//      (retained), so AgroFlow shows it online or offline at once.
//
// Libraries: ArduinoJson 7.x, PubSubClient (knolleary), DHTesp ("DHT sensor library for
// ESPx", beegee_tokyo). WebServer and DNSServer come with the ESP32 core. WiFiManager is no
// longer used.

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <HTTPUpdate.h>
#include <WebServer.h>
#include <DNSServer.h>
#include <PubSubClient.h>
#include <Preferences.h>
#include <ArduinoJson.h>
#include <time.h>
#include <string.h>
#include "DHTesp.h"
#include "OfflineBuffer.h"
#include "CommandIds.h"
#include "RunLimits.h"
#include "SetupPortal.h"
#include "secrets.h"

// Config

// Used only if the claim's answer has no broker (an older server).
const char *MQTT_HOST = "853fe2eddcd24d0c8e0f4d69869c5dab.s1.eu.hivemq.cloud";
const uint16_t MQTT_PORT = 8883;
const unsigned long MQTT_RECONNECT_INTERVAL_MS = 5000;

const uint16_t CONFIG_PORTAL_TIMEOUT_SECONDS = 300;               // change-Wi-Fi page stays open 5 min
const unsigned long WIFI_JOIN_TIMEOUT_MS = 25000;                  // setup page: give up joining after this
const unsigned long PORTAL_CLOSE_AFTER_SUCCESS_MS = 60000;         // keep showing the result this long
const unsigned long WIFI_DOWN_PORTAL_AFTER_MS = 15UL * 60UL * 1000UL; // saved WiFi gone this long -> open setup
const unsigned long BOOT_COUNTER_WINDOW_MS = 10000;                // power-cycle within this to count
const int BOOTS_FOR_PORTAL = 3;
const int BOOTS_FOR_FACTORY_RESET = 5;
const int MAX_AUTH_FAILURES = 3;                                   // consecutive 401s -> token revoked

// Update this and Firmware:LatestVersion in backend/AgroFlow.Api/appsettings.json each release.
const char *FIRMWARE_VERSION = "1.7.2";
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
WiFiClient mqttPlainClient;
PubSubClient mqttClient(mqttTlsClient);
String mqttSensorsTopic;
String mqttCommandsTopic;
String mqttAckTopic;
String mqttStatusTopic;
unsigned long lastMqttReconnectAttemptMillis = 0;
unsigned long lastMqttConnectedMillis = 0;

DHTesp dht;
WebServer server(80);
DNSServer dnsServer;

// From the claim, kept in flash (NVS) and never printed: the device token (revocable), AgroFlow's
// MQTT login and broker. A kit linked by older firmware has only the token; it fetches the login
// from GET /api/devices/mqtt-credentials once and keeps it.
String deviceToken = "";
String mqttUser = "";
String mqttPass = "";
int authFailures = 0;

String mqttHostOverride = "";        // from the server; must outlive setServer(), so kept global
uint16_t mqttPortOverride = 0;
bool mqttUseTls = true;
bool wifiForgotten = false;          // "change WiFi" requested; cleared once a new WiFi is saved
unsigned long lastCredFetchMs = 0;
const unsigned long CRED_FETCH_RETRY_MS = 60000;

// The setup page (1. and 2. above).
bool isLinked = false;               // has a farm, zone and token
bool portalActive = false;
bool portalRoutesReady = false;
unsigned long portalStartedMs = 0;
enum class SetupStep : uint8_t { Idle, Joining, Claiming, Done, Failed };
SetupStep setupStep = SetupStep::Idle;
String setupMessage = "";
String pendingSsid = "";
String pendingPass = "";
String pendingCode = "";
unsigned long joinStartedMs = 0;
unsigned long portalCloseAtMs = 0;
volatile int lastDisconnectReason = 0;
String linkedFarmName = "";
String linkedZoneName = "";
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

void logIrrigationEvent(long zoneId, unsigned long runtimeSeconds, const String &source, time_t startedAtEpoch);
void markCommandExecuted(const char *commandId, uint32_t ackEpoch);
void openSetupPortal(const char *reason);
void closeSetupPortal();
void forgetWifiAndOpenSetup(const char *reason);
void factoryReset(const char *reason);
void unlinkKit(const char *reason);

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

// The local page's password (8. above). Not a secret on its own (it is printed at boot); it stops
// passers-by on the open setup hotspot running the pump. The hotspot itself has no password (1.7.2).
String apPassword() {
  String id = getDeviceId();
  return "AF-" + id.substring(id.length() - 6);
}

// The details an installer or farmer needs to reach the setup page, printed at boot and
// whenever the setup page opens (14. above). The hotspot password is low-sensitivity, like the
// sticker on the box; the device token and MQTT login are never printed.
void printKitSetupInfo() {
  Serial.println("===== AgroFlow kit =====");
  Serial.printf("Device ID: %s\n", getDeviceId().c_str());
  Serial.printf("Setup Wi-Fi: %s (no password)\n", apName().c_str());
  Serial.printf("Kit page password (user agroflow): %s\n", apPassword().c_str());
  Serial.println("Setup page: 192.168.4.1");
  Serial.println("=======================");
}

// The kit's own topics (1.7.2): agroflow/{deviceId}/telemetry | cmd | ack | status. The claim's
// answer names the same ones; they follow from the device ID, so a kit linked by older firmware
// gets them too.
void buildMqttTopics() {
  String base = "agroflow/" + getDeviceId() + "/";
  mqttSensorsTopic  = base + "telemetry";
  mqttCommandsTopic = base + "cmd";
  mqttAckTopic      = base + "ack";
  mqttStatusTopic   = base + "status";
}

// The broker to use: the one the server gave (kept in flash), else the compiled-in one.
void applyBroker() {
  if (mqttHostOverride.length() > 0) mqttClient.setServer(mqttHostOverride.c_str(), mqttPortOverride > 0 ? mqttPortOverride : MQTT_PORT);
  else mqttClient.setServer(MQTT_HOST, MQTT_PORT);
  if (mqttUseTls) mqttClient.setClient(mqttTlsClient);
  else mqttClient.setClient(mqttPlainClient);
}

void saveMqttLogin() {
  preferences.putString("mqttUser", mqttUser);
  preferences.putString("mqttPass", mqttPass);
  preferences.putString("mqttHost", mqttHostOverride);
  preferences.putUShort("mqttPort", mqttPortOverride);
  preferences.putBool("mqttTls", mqttUseTls);
}

// Security: the 6-digit code is the only authorisation for this call, so no shared key is
// compiled in. The API answers with this board's zone/farm, its device token, AgroFlow's MQTT
// login and broker, and its topics. All kept in NVS, never printed. On a refusal, problem is the
// sentence the setup page shows (SetupPortal.h).
bool claimDevice(const String &enrollmentCode, String &problem) {
  problem = "";
  if (enrollmentCode.length() == 0) { problem = agroflow::claimMessage(401, "code_invalid"); return false; }
  if (WiFi.status() != WL_CONNECTED) { problem = agroflow::claimMessage(-1, ""); return false; }

  WiFiClientSecure client;
  HTTPClient http;
  deviceToken = "";   // no token yet
  if (!beginApiRequest(client, http, String(API_BASE_URL) + "/api/devices/claim")) { problem = agroflow::claimMessage(-1, ""); return false; }
  http.setTimeout(15000);

  JsonDocument doc;
  doc["deviceId"] = getDeviceId();
  doc["enrollmentCode"] = enrollmentCode;
  doc["firmwareVersion"] = FIRMWARE_VERSION;
  String body;
  serializeJson(doc, body);

  int httpCode = http.POST(body);
  String payload = httpCode > 0 ? http.getString() : "";
  http.end();
  JsonDocument r;
  bool parsed = payload.length() > 0 && !deserializeJson(r, payload);
  if (httpCode < 200 || httpCode >= 300) {
    const char *code = parsed ? (r["code"] | "") : "";
    Serial.printf("Device claim refused, http=%d %s\n", httpCode, code);
    problem = agroflow::claimMessage(httpCode, code);
    // The server's own sentence names the other farm; prefer it for that case.
    if (parsed && strcmp(code, "kit_linked_elsewhere") == 0 && (r["error"] | "")[0] != '\0') problem = (const char *)(r["error"] | "");
    return false;
  }
  if (!parsed) { problem = agroflow::claimMessage(-1, ""); return false; }

  long claimedZoneId = r["zoneId"] | 0L;
  long claimedFarmId = r["farmId"] | 0L;
  const char *tok = r["deviceToken"] | "";
  const char *mu  = r["mqttUsername"] | "";
  const char *mp  = r["mqttPassword"] | "";
  if (claimedZoneId <= 0 || claimedFarmId <= 0 || strlen(tok) == 0) {
    Serial.println("Claim response incomplete (needs zoneId, farmId, deviceToken)");
    problem = agroflow::claimMessage(-1, "");
    return false;
  }

  ZONE_ID = claimedZoneId;
  FARM_ID = claimedFarmId;
  deviceToken = tok; mqttUser = mu; mqttPass = mp;
  const char *host = r["mqttHost"] | "";
  mqttHostOverride = host;
  mqttPortOverride = r["mqttPort"] | 0;
  mqttUseTls = r["mqttTls"] | true;
  linkedFarmName = (const char *)(r["farmName"] | "");
  linkedZoneName = (const char *)(r["zoneName"] | "");
  preferences.putBool("claimed", true);
  preferences.putLong("zoneId", ZONE_ID);
  preferences.putLong("farmId", FARM_ID);
  preferences.putString("token", deviceToken);
  preferences.putString("farmName", linkedFarmName);
  preferences.putString("zoneName", linkedZoneName);
  saveMqttLogin();
  buildMqttTopics();
  applyBroker();
  isLinked = true;
  Serial.printf("Linked to %s - %s (zone %ld, farm %ld); logins kept on the kit\n",
                linkedFarmName.c_str(), linkedZoneName.c_str(), ZONE_ID, FARM_ID);
  return true;
}

// Ask the API for the current MQTT login: for a kit linked by older firmware (no login kept), and
// when the broker refuses the kept one (a new password in Railway). Kept in NVS from then on.
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
    Serial.printf("MQTT broker from server: %s:%u\n", mqttHostOverride.c_str(), mqttPortOverride);
  }
  saveMqttLogin();
  applyBroker();
  Serial.println("MQTT login received from server (kept on the kit, never printed)");
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
  // The kit's state now, sent with every reading (14. above): Wi-Fi signal, and whether its last
  // soil sample was in range. An out-of-range sample is never sent as a reading.
  if (WiFi.status() == WL_CONNECTED) doc["rssi"] = WiFi.RSSI();
  if (lastSoilRaw >= 0) doc["soilProbeOk"] = moistureValid(lastSoilRaw);
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
  // "unlink" (1.7.2) is not an irrigation command: AgroFlow sends it when this kit was replaced
  // or moved, after revoking its token. Nothing to acknowledge.
  if (strcmp(command, "unlink") == 0) { unlinkKit("AgroFlow unlinked this kit"); return; }
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
  // Last will (15. above): if the kit drops off without saying goodbye, the broker publishes
  // "offline" on its status topic, retained.
  if (mqttClient.connect(clientId.c_str(), mqttUser.c_str(), mqttPass.c_str(),
                         mqttStatusTopic.c_str(), 1, true, "offline")) {
    Serial.println("connected");
    lastMqttConnectedMillis = millis();
    mqttClient.subscribe(mqttCommandsTopic.c_str());
    JsonDocument online;
    online["state"] = "online";
    online["firmware"] = FIRMWARE_VERSION;
    online["rssi"] = WiFi.RSSI();
    String status;
    serializeJson(online, status);
    mqttClient.publish(mqttStatusTopic.c_str(), status.c_str(), true);
    Serial.printf("Subscribed to %s; backlog %u readings, %u pump runs to upload\n",
                  mqttCommandsTopic.c_str(), (unsigned)readingBuffer.size(), (unsigned)runBuffer.size());
    if (fallbackCycle) {
      Serial.println("MQTT back - ending offline-fallback watering, server control resumes");
      stopPumpCycle();
    }
  } else {
    int rc = mqttClient.state();
    Serial.printf("failed, rc=%d\n", rc);
    if (rc == 4 || rc == 5) { mqttUser = ""; mqttPass = ""; }   // bad/rotated login: ask the server again
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
// Over MQTT on agroflow/{deviceId}/ack (1.7.2), or over HTTP when MQTT is not up. A lost
// acknowledgement is safe: the API sends the command again and 12. above answers it once more.
void markCommandExecuted(const char *commandId, uint32_t ackEpoch) {
  if (WiFi.status() != WL_CONNECTED) { Serial.println("WARN: offline, cannot ACK command - the API will redeliver it"); return; }
  JsonDocument doc;
  doc["deviceId"] = getDeviceId();
  if (ackEpoch > 0) doc["executedAt"] = isoFromEpoch((time_t)ackEpoch);
  else if (hasValidTime()) doc["executedAt"] = nowIso8601();
  if (mqttClient.connected()) {
    JsonDocument ack;
    ack["id"] = commandId;
    if (!doc["executedAt"].isNull()) ack["executedAt"] = doc["executedAt"];
    String ackBody;
    serializeJson(ack, ackBody);
    if (mqttClient.publish(mqttAckTopic.c_str(), ackBody.c_str())) return;
  }

  WiFiClientSecure client;
  HTTPClient http;
  String url = String(API_BASE_URL) + "/api/devices/commands/" + String(commandId) + "/executed";
  if (!beginApiRequest(client, http, url)) return;
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
// it), and only with the kit's local password. The setup hotspot is open (1.7.2), so this
// password is what keeps passers-by from running the pump.
bool localRequestAllowed() {
  if (server.client().localIP() != WiFi.softAPIP()) {
    server.send(403, "text/plain", "The local page only works on the kit's own WiFi (AgroFlow-Setup-...).");
    return false;
  }
  if (!isLinked) {
    server.send(409, "text/plain", "Link the kit to a farm first.");
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
  server.send_P(200, "text/html", LOCAL_PAGE_HTML);
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
  server.send(200, "application/json", body);
}

// Start/Stop from the local page. The same rules as a command from the server: one
// run at a time, a duration, and the local page's 5-minute cap (checkSafetyCap) on top.
void handleLocalPump() {
  if (!localRequestAllowed()) return;
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

// The setup page (1. and 2. above)

// One form: the farm Wi-Fi from a scan (or typed), its password and, when the kit is not linked,
// the 6-digit code. The script asks /state every second and shows the result in plain words.
const char SETUP_PAGE_HTML[] PROGMEM = R"HTML(<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>AgroFlow kit setup</title>
<style>body{font-family:system-ui,sans-serif;margin:0;padding:16px;background:#f5f6f5;color:#253126;max-width:520px}
h1{font-size:21px;margin:0 0 4px}.card{background:#fff;border-radius:12px;padding:14px;margin:12px 0;box-shadow:0 1px 3px #0002}
label{display:block;font-weight:600;margin:12px 0 4px}input,select{box-sizing:border-box;width:100%;font-size:18px;min-height:48px;border:1px solid #9fb799;border-radius:10px;padding:0 12px;background:#fff}
button{width:100%;font-size:19px;min-height:52px;border:0;border-radius:10px;background:#1f7a3a;color:#fff;margin-top:16px}button:disabled{opacity:.6}
.muted{color:#637064;font-size:14px}.ok{color:#1f7a3a;font-weight:700;font-size:19px}.bad{color:#b3261e;font-weight:600}#msg{min-height:24px;margin-top:12px}
.show{font-size:14px;margin-top:6px;display:flex;gap:6px;align-items:center}.show input{width:auto;min-height:0}</style></head><body>
<h1>Set up this AgroFlow kit</h1><p class="muted" id="kitname"></p>
<form class="card" id="f">
<label for="ssid">Farm Wi-Fi</label><select id="ssid" name="ssid"><option value="">Looking for networks...</option></select>
<div id="otherbox" hidden><label for="other">Wi-Fi name</label><input id="other" name="other" autocomplete="off" autocapitalize="none"></div>
<p class="muted">The kit needs a 2.4 GHz network. 5 GHz networks do not show here.</p>
<label for="pw">Wi-Fi password</label><input id="pw" name="password" type="password" autocomplete="off">
<div class="show"><input type="checkbox" id="sp"><span>Show password</span></div>
<div id="codebox"><label for="code">6-digit code from AgroFlow</label><input id="code" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="9"></div>
<button id="go" type="submit">Link</button><div id="msg" role="status" aria-live="polite"></div></form>
<p id="localp" hidden><a href="/local">Kit readings and pump</a></p>
<script>
function q(i){return document.getElementById(i)}var needCode=true,polling=null;
fetch('/info').then(function(r){return r.json()}).then(function(i){needCode=i.needCode;q('codebox').hidden=!needCode;
q('go').textContent=needCode?'Link':'Connect';q('kitname').textContent=i.apName+(i.linkedTo?' · linked to '+i.linkedTo:'');q('localp').hidden=!i.linked});
function scan(){fetch('/scan').then(function(r){return r.json()}).then(function(s){if(s.scanning){setTimeout(scan,1500);return}
var sel=q('ssid'),keep=sel.value;sel.innerHTML='<option value="">Choose your farm Wi-Fi</option>';
s.networks.forEach(function(n){var o=document.createElement('option');o.value=n.ssid;o.textContent=n.ssid+(n.rssi>-67?' (strong)':n.rssi>-80?' (fair)':' (weak)');sel.appendChild(o)});
var o=document.createElement('option');o.value='__other';o.textContent='Other network (type its name)';sel.appendChild(o);if(keep)sel.value=keep}).catch(function(){setTimeout(scan,3000)})}
scan();q('ssid').onchange=function(){q('otherbox').hidden=q('ssid').value!=='__other'};q('sp').onchange=function(){q('pw').type=q('sp').checked?'text':'password'};
function show(t,cls){q('msg').className=cls||'';q('msg').textContent=t}
function poll(){fetch('/state').then(function(r){return r.json()}).then(function(s){
if(s.step==='joining'){show('Joining '+s.ssid+'...')}else if(s.step==='claiming'){show('Wi-Fi works. Contacting AgroFlow...')}
else if(s.step==='done'){clearInterval(polling);q('go').disabled=false;show('✓ '+s.message,'ok')}
else if(s.step==='failed'){clearInterval(polling);q('go').disabled=false;show(s.message,'bad')}}).catch(function(){show('Waiting for the kit... (your phone may reconnect to AgroFlow-Setup)')})}
q('f').onsubmit=function(e){e.preventDefault();var ssid=q('ssid').value==='__other'?q('other').value.trim():q('ssid').value;
if(!ssid){show('Choose the farm Wi-Fi first.','bad');return}if(needCode&&q('code').value.replace(/[\s-]/g,'').length<6){show('Type the 6-digit code from AgroFlow.','bad');return}
var b='ssid='+encodeURIComponent(ssid)+'&password='+encodeURIComponent(q('pw').value)+'&code='+encodeURIComponent(q('code').value);
q('go').disabled=true;show('Starting...');fetch('/link',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:b})
.then(function(r){return r.json()}).then(function(s){if(!s.ok){q('go').disabled=false;show(s.message,'bad');return}polling=setInterval(poll,1000)})
.catch(function(){q('go').disabled=false;show('The kit did not answer. Are you still on its Wi-Fi?','bad')})};
</script></body></html>)HTML";

void sendJson(int status, JsonDocument &doc) {
  String body;
  serializeJson(doc, body);
  server.send(status, "application/json", body);
}

void handleSetupPage() {
  server.sendHeader("Cache-Control", "no-store");
  server.send_P(200, "text/html", SETUP_PAGE_HTML);
}

void handleSetupInfo() {
  JsonDocument doc;
  doc["needCode"] = !isLinked;
  doc["linked"] = isLinked;
  doc["apName"] = apName();
  doc["deviceId"] = getDeviceId();
  if (isLinked && linkedFarmName.length() > 0) doc["linkedTo"] = linkedFarmName + " - " + linkedZoneName;
  sendJson(200, doc);
}

// The networks the kit can see (2.4 GHz only: the ESP32 has no 5 GHz radio). The scan runs in
// the background; the page asks again until it is done.
void handleSetupScan() {
  JsonDocument doc;
  int n = WiFi.scanComplete();
  if (n == WIFI_SCAN_FAILED) { WiFi.scanNetworks(true); n = WIFI_SCAN_RUNNING; }
  if (n == WIFI_SCAN_RUNNING) { doc["scanning"] = true; doc["networks"].to<JsonArray>(); sendJson(200, doc); return; }
  JsonArray list = doc["networks"].to<JsonArray>();
  for (int i = 0; i < n; i++) {
    String ssid = WiFi.SSID(i);
    if (ssid.length() == 0) continue;
    bool seen = false;
    for (JsonObject o : list) if (ssid == (const char *)o["ssid"]) { seen = true; break; }
    if (seen) continue;
    JsonObject o = list.add<JsonObject>();
    o["ssid"] = ssid;
    o["rssi"] = WiFi.RSSI(i);
    if (list.size() >= 20) break;
  }
  doc["scanning"] = false;
  WiFi.scanDelete();
  sendJson(200, doc);
}

const char *stepName(SetupStep step) {
  switch (step) {
    case SetupStep::Joining: return "joining";
    case SetupStep::Claiming: return "claiming";
    case SetupStep::Done: return "done";
    case SetupStep::Failed: return "failed";
    default: return "idle";
  }
}

void handleSetupState() {
  JsonDocument doc;
  doc["step"] = stepName(setupStep);
  doc["message"] = setupMessage;
  doc["ssid"] = pendingSsid;
  sendJson(200, doc);
}

void failSetup(const String &message) {
  setupStep = SetupStep::Failed;
  setupMessage = message;
  Serial.printf("Setup page: %s\n", message.c_str());
}

// Link pressed: join the farm Wi-Fi while the hotspot stays up (both radios run together).
void handleSetupLink() {
  JsonDocument doc;
  if (setupStep == SetupStep::Joining || setupStep == SetupStep::Claiming) {
    doc["ok"] = true;   // already working on it; the page just follows /state
    sendJson(200, doc);
    return;
  }
  String ssid = server.arg("ssid");
  ssid.trim();
  String code = server.arg("code");
  char normalised[12];
  if (ssid.length() == 0 || ssid.length() > 32) {
    doc["ok"] = false; doc["message"] = "Choose the farm Wi-Fi first."; sendJson(200, doc); return;
  }
  if (!isLinked && !agroflow::normaliseSetupCode(code.c_str(), normalised, sizeof(normalised))) {
    doc["ok"] = false; doc["message"] = "Type the 6-digit code from AgroFlow."; sendJson(200, doc); return;
  }
  pendingCode = isLinked ? "" : String(normalised);
  bool sameNetwork = WiFi.status() == WL_CONNECTED && WiFi.SSID() == ssid && server.arg("password") == pendingPass;
  pendingSsid = ssid;
  pendingPass = server.arg("password");
  setupMessage = "";
  if (sameNetwork) {
    setupStep = isLinked ? SetupStep::Done : SetupStep::Claiming;   // Wi-Fi already works: straight to the code
    if (isLinked) setupMessage = "Connected to " + pendingSsid + ".";
  } else {
    lastDisconnectReason = 0;
    WiFi.disconnect(false, false);
    WiFi.begin(pendingSsid.c_str(), pendingPass.c_str());
    joinStartedMs = millis();
    setupStep = SetupStep::Joining;
    Serial.printf("Setup page: joining \"%s\"\n", pendingSsid.c_str());
  }
  doc["ok"] = true;
  sendJson(200, doc);
}

// Phones check a known address to find a captive portal; sending them to the setup page makes
// the page open by itself.
void redirectToSetup() {
  server.sendHeader("Location", String("http://") + WiFi.softAPIP().toString() + "/", true);
  server.send(302, "text/plain", "");
}

void registerPortalRoutes() {
  if (portalRoutesReady) return;
  portalRoutesReady = true;
  server.on("/", HTTP_GET, handleSetupPage);
  server.on("/info", HTTP_GET, handleSetupInfo);
  server.on("/scan", HTTP_GET, handleSetupScan);
  server.on("/state", HTTP_GET, handleSetupState);
  server.on("/link", HTTP_POST, handleSetupLink);
  server.on("/local", HTTP_GET, handleLocalPage);
  server.on("/local/status", HTTP_GET, handleLocalStatus);
  server.on("/local/pump", handleLocalPump);
  for (const char *probe : {"/generate_204", "/gen_204", "/hotspot-detect.html", "/library/test/success.html",
                            "/connecttest.txt", "/ncsi.txt", "/fwlink", "/redirect", "/canonical.html"})
    server.on(probe, redirectToSetup);
  server.onNotFound(redirectToSetup);
}

// WiFi

void onWifiEvent(arduino_event_id_t event, arduino_event_info_t info) {
  if (event == ARDUINO_EVENT_WIFI_STA_DISCONNECTED) lastDisconnectReason = info.wifi_sta_disconnected.reason;
  else if (event == ARDUINO_EVENT_WIFI_STA_GOT_IP) lastDisconnectReason = 0;
}

// Opens the setup hotspot (no password) and page without blocking: watering, sensors and the
// offline fallback keep running. Unlinked, the page also asks for the 6-digit code.
void openSetupPortal(const char *reason) {
  if (portalActive) return;
  Serial.printf("Opening setup page (%s): join WiFi \"%s\"\n", reason, apName().c_str());
  printKitSetupInfo();
  WiFi.mode(WIFI_AP_STA);
  WiFi.softAP(apName().c_str());
  delay(100);
  dnsServer.start(53, "*", WiFi.softAPIP());
  registerPortalRoutes();
  server.begin();
  WiFi.scanNetworks(true);   // the list is ready by the time a phone opens the page
  portalActive = true;
  portalStartedMs = millis();
  setupStep = SetupStep::Idle;
  setupMessage = "";
}

void closeSetupPortal() {
  if (!portalActive) return;
  server.stop();
  dnsServer.stop();
  WiFi.softAPdisconnect(true);
  WiFi.mode(WIFI_STA);
  portalActive = false;
  setupStep = SetupStep::Idle;
  Serial.println("Setup page closed");
}

// Forget the saved WiFi but keep the link (farm, zone, token), then open setup, which only asks
// for WiFi.
void forgetWifiAndOpenSetup(const char *reason) {
  Serial.printf("Forgetting saved WiFi (%s)\n", reason);
  wifiForgotten = true;
  preferences.putBool("wifiForgot", true);   // survive a reboot mid-setup
  mqttClient.disconnect();
  WiFi.disconnect(false, true);               // erases saved WiFi only; NVS "agroflow" untouched
  openSetupPortal(reason);
}

void servicePortal() {
  if (!portalActive) return;
  dnsServer.processNextRequest();
  server.handleClient();
  if (WiFi.softAPgetStationNum() > 0) portalStartedMs = millis();   // someone is on the kit's WiFi

  switch (setupStep) {
    case SetupStep::Joining: {
      if (WiFi.status() == WL_CONNECTED) {
        Serial.printf("Setup page: joined \"%s\"\n", pendingSsid.c_str());
        wifiDownSinceMs = 0;
        if (!timeConfigured) { configTime(0, 0, "pool.ntp.org", "time.nist.gov"); timeConfigured = true; }
        if (isLinked) {
          wifiForgotten = false;
          preferences.putBool("wifiForgot", false);
          setupStep = SetupStep::Done;
          setupMessage = "Connected to " + pendingSsid + ". You can close this page.";
          portalCloseAtMs = millis() + PORTAL_CLOSE_AFTER_SUCCESS_MS;
        } else {
          setupStep = SetupStep::Claiming;
        }
        return;
      }
      agroflow::JoinProblem problem = agroflow::joinProblemFromReason(lastDisconnectReason);
      bool timedOut = millis() - joinStartedMs > WIFI_JOIN_TIMEOUT_MS;
      if ((problem != agroflow::JoinProblem::None && millis() - joinStartedMs > 4000) || timedOut) {
        if (problem == agroflow::JoinProblem::None) problem = agroflow::JoinProblem::Other;
        WiFi.disconnect(false, false);
        failSetup(agroflow::joinMessage(problem));
      }
      return;
    }
    case SetupStep::Claiming: {
      server.handleClient();   // let the page see "Contacting AgroFlow" before the call blocks
      String problem;
      if (claimDevice(pendingCode, problem)) {
        setupStep = SetupStep::Done;
        setupMessage = "Linked to " + linkedFarmName + " - " + linkedZoneName + ". You can close this page.";
        portalCloseAtMs = millis() + PORTAL_CLOSE_AFTER_SUCCESS_MS;
        fetchZoneConfig();
        reconnectMqtt();
      } else {
        failSetup(problem);   // the Wi-Fi stays joined; fix the code and press Link again
      }
      return;
    }
    case SetupStep::Done:
      if ((long)(millis() - portalCloseAtMs) >= 0) closeSetupPortal();   // only after success
      return;
    default:
      break;
  }

  // An unlinked kit keeps its hotspot until it is linked. The change-Wi-Fi page times out as
  // before, unless the Wi-Fi was forgotten.
  if (!isLinked) return;
  if (millis() - portalStartedMs > (unsigned long)CONFIG_PORTAL_TIMEOUT_SECONDS * 1000UL + 5000UL) {
    closeSetupPortal();
    if (wifiForgotten) {
      openSetupPortal("still waiting for a new WiFi");
      return;
    }
    Serial.println("Setup page closed (timeout) - retrying saved WiFi");
    WiFi.begin();
  }
}

void maintainWiFi() {
  if (WiFi.status() == WL_CONNECTED) {
    wifiDownSinceMs = 0;
    if (!timeConfigured) { configTime(0, 0, "pool.ntp.org", "time.nist.gov"); timeConfigured = true; }
    return;
  }
  if (!isLinked) return;   // the setup page drives the Wi-Fi until the kit is linked
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
  WiFi.disconnect(true, true);
  delay(500);
  ESP.restart();
}

// The kit was replaced or moved (6. above): forget the farm, zone, logins and anything waiting to
// upload for that zone, keep the Wi-Fi, and reboot into the setup page for a new code.
void unlinkKit(const char *reason) {
  Serial.printf("UNLINK (%s): forgetting the farm, zone and logins\n", reason);
  stopPumpCycle();
  relayWrite(false);
  for (const char *key : {"claimed", "token", "zoneId", "farmId", "farmName", "zoneName", "mqttUser", "mqttPass",
                          "mqttHost", "mqttPort", "mqttTls", "autoOk", "readbuf", "runbuf", "wifiForgot"})
    preferences.remove(key);
  mqttClient.disconnect();
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
  mqttClient.setCallback(handleMqttCommand);
  WiFi.onEvent(onWifiEvent);
  WiFi.persistent(true);             // the farm Wi-Fi is remembered across reboots

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
  mqttUser = preferences.getString("mqttUser", "");
  mqttPass = preferences.getString("mqttPass", "");
  mqttHostOverride = preferences.getString("mqttHost", "");
  mqttPortOverride = preferences.getUShort("mqttPort", 0);
  mqttUseTls = preferences.getBool("mqttTls", true);
  linkedFarmName = preferences.getString("farmName", "");
  linkedZoneName = preferences.getString("zoneName", "");
  wifiForgotten = preferences.getBool("wifiForgot", false);
  // A board claimed by older firmware has no token, so we treat it as unclaimed.
  bool isClaimed = preferences.getBool("claimed", false) && deviceToken.length() > 0;
  buildMqttTopics();
  applyBroker();

  Serial.print("AgroFlow node v");
  Serial.print(FIRMWARE_VERSION);
  Serial.print(" - device ");
  Serial.println(getDeviceId());
  printKitSetupInfo();

  if (!isClaimed) {
    // First-time setup (or after unlink / factory reset): the hotspot and the setup page with the
    // code field stay up until the kit is linked; loop() serves them.
    isLinked = false;
    preferences.putInt("bootCount", 0);
    Serial.printf("Not set up yet: join WiFi \"%s\" (no password) and enter the farm WiFi + 6-digit code\n", apName().c_str());
    openSetupPortal("not linked to a farm yet");
  } else {
    isLinked = true;
    ZONE_ID = preferences.getLong("zoneId", 0);
    FARM_ID = preferences.getLong("farmId", 0);
    Serial.printf("Linked: zoneId=%ld farmId=%ld\n", ZONE_ID, FARM_ID);

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
  if (isLinked) {
    fetchZoneConfig();
    reconnectMqtt();
    checkFirmwareUpdate();
  }
}

void loop() {
  clearBootCounterWhenStable();
  servicePortal();
  if (!isLinked) return;             // nothing to report or water until the kit has a zone
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
