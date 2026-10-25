// The setup page's words (firmware 1.7.2): what the installer reads after pressing Link.
// Plain C++ with no Arduino headers, so it is unit-tested natively
// (hardware/esp32/tests/setup_portal_test.cpp). The server's side of the claim codes is
// KitLink.Refusal (backend/AgroFlow.Domain/SensorMonitoring/KitLink.cs).
#pragma once

#include <stddef.h>
#include <string.h>

namespace agroflow {

// Why joining the farm Wi-Fi failed, from the ESP-IDF disconnect reason (wifi_err_reason_t).
enum class JoinProblem { None, WrongPassword, NotFound, Other };

inline JoinProblem joinProblemFromReason(int reason) {
  switch (reason) {
    case 0:
      return JoinProblem::None;
    case 2:     // AUTH_EXPIRE
    case 15:    // 4WAY_HANDSHAKE_TIMEOUT: the usual sign of a wrong password
    case 202:   // AUTH_FAIL
    case 204:   // HANDSHAKE_TIMEOUT
      return JoinProblem::WrongPassword;
    case 201:   // NO_AP_FOUND
    case 210:   // NO_AP_FOUND_W_COMPATIBLE_SECURITY
    case 211:   // NO_AP_FOUND_IN_AUTHMODE_THRESHOLD
    case 212:   // NO_AP_FOUND_IN_RSSI_THRESHOLD
      return JoinProblem::NotFound;
    default:
      return JoinProblem::Other;
  }
}

inline const char *joinMessage(JoinProblem problem) {
  switch (problem) {
    case JoinProblem::WrongPassword:
      return "Wrong Wi-Fi password. Check it and press Link again.";
    case JoinProblem::NotFound:
      return "Network not found. Is it a 5 GHz network? The kit needs 2.4 GHz. Move closer to the router or choose another network.";
    case JoinProblem::Other:
      return "Could not join the Wi-Fi. Check the network name and password, and that the router is on.";
    default:
      return "";
  }
}

// What the claim's answer means. httpCode < 0: no answer at all (no internet, or AgroFlow is
// down). serverCode: the "code" in the API's error body, or "" when there was none.
inline const char *claimMessage(int httpCode, const char *serverCode) {
  if (httpCode >= 200 && httpCode < 300) return "";
  const char *code = serverCode ? serverCode : "";
  if (strcmp(code, "code_expired") == 0) return "This code has expired. Ask AgroFlow for a new code.";
  if (strcmp(code, "code_used") == 0) return "This code has already been used. Ask AgroFlow for a new code.";
  if (strcmp(code, "code_invalid") == 0) return "That code is not right. Check the 6 digits.";
  if (strcmp(code, "wrong_kit") == 0) return "This code was made for a different kit.";
  if (strcmp(code, "kit_linked_elsewhere") == 0) return "This kit is still linked to another farm. Ask AgroFlow staff to unlink it, then press Link again.";
  if (strcmp(code, "rate_limited") == 0) return "Too many wrong codes. Wait 15 minutes and try again.";
  if (httpCode < 0 || httpCode >= 500) return "Can't reach AgroFlow. The Wi-Fi works, but the internet or AgroFlow does not answer. Try again in a minute.";
  return "AgroFlow did not accept the link. Ask AgroFlow for a new code.";
}

// The code as typed ("123 456", "123-456") without spaces or dashes, upper case. Returns false
// when it is not 6 to 8 letters or digits (older codes had 8 characters).
inline bool normaliseSetupCode(const char *typed, char *out, size_t outSize) {
  if (!typed || !out || outSize == 0) return false;
  size_t n = 0;
  for (const char *p = typed; *p; ++p) {
    char c = *p;
    if (c == ' ' || c == '-') continue;
    bool digit = c >= '0' && c <= '9';
    bool lower = c >= 'a' && c <= 'z';
    bool upper = c >= 'A' && c <= 'Z';
    if (!digit && !lower && !upper) { out[0] = '\0'; return false; }
    if (n + 1 >= outSize) { out[0] = '\0'; return false; }
    out[n++] = lower ? (char)(c - 'a' + 'A') : c;
  }
  out[n] = '\0';
  return n >= 6 && n <= 8;
}

}  // namespace agroflow
