// How long one pump run may last, and when a run must stop because the server is gone
// (firmware 1.6.0). Plain C++ with no Arduino headers, so it is unit-tested natively
// (hardware/esp32/tests/run_limits_test.cpp). The server's twin is
// IrrigationRunRules.EffectiveRunSeconds (backend/AgroFlow.Domain/IrrigationRunRules.cs).
#pragma once

namespace agroflow {

// A run lasts the shortest of: what was asked (0 = no duration given), the zone's maximum
// run time from the command (0 = an older server sent none, so the default is used), and
// the kit's own ceiling, whatever the command says.
inline unsigned long effectiveRunMs(unsigned long requestedMs, unsigned long zoneMaxMs,
                                    unsigned long defaultMaxMs, unsigned long absoluteMaxMs) {
  unsigned long maxMs = zoneMaxMs > 0 ? zoneMaxMs : defaultMaxMs;
  if (maxMs > absoluteMaxMs) maxMs = absoluteMaxMs;
  if (requestedMs == 0 || requestedMs > maxMs) return maxMs;
  return requestedMs;
}

// Lost-connection failsafe: a run the server started stops once the kit has not been in
// touch with the server (MQTT) for limitMs. Runs the server did not start (the offline
// fallback, the local page) are meant to happen offline and have their own limits.
// Unsigned subtraction, so it stays right when millis() wraps after ~49 days.
inline bool lostContactShouldStop(bool serverRun, bool pumpRunning, unsigned long nowMs,
                                  unsigned long lastContactMs, unsigned long limitMs) {
  return serverRun && pumpRunning && (unsigned long)(nowMs - lastContactMs) >= limitMs;
}

}  // namespace agroflow
