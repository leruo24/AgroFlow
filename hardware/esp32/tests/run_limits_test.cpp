// Native unit tests for the irrigation node's run limits and lost-connection failsafe
// (AgroFlowIrrigationNode/RunLimits.h). No board needed:
//
//   g++ -std=c++17 -Wall -Wextra -Werror -I../AgroFlowIrrigationNode run_limits_test.cpp -o run_limits_test
//   ./run_limits_test
//
// Exit code 0 means every check passed.

#include <stdio.h>

#include "RunLimits.h"

using agroflow::effectiveRunMs;
using agroflow::lostContactShouldStop;

static int failures = 0;
static int checks = 0;

#define CHECK(cond)                                                     \
  do {                                                                  \
    checks++;                                                           \
    if (!(cond)) {                                                      \
      failures++;                                                       \
      printf("  FAIL %s:%d: %s\n", __FILE__, __LINE__, #cond);          \
    }                                                                   \
  } while (0)

static const unsigned long MIN = 60UL * 1000UL;
static const unsigned long DEFAULT_MAX = 5 * MIN;
static const unsigned long ABSOLUTE_MAX = 120 * MIN;

int main() {
  // min(requested, zone maximum)
  CHECK(effectiveRunMs(10 * MIN, 5 * MIN, DEFAULT_MAX, ABSOLUTE_MAX) == 5 * MIN);
  CHECK(effectiveRunMs(2 * MIN, 5 * MIN, DEFAULT_MAX, ABSOLUTE_MAX) == 2 * MIN);
  CHECK(effectiveRunMs(66 * MIN, 90 * MIN, DEFAULT_MAX, ABSOLUTE_MAX) == 66 * MIN);
  CHECK(effectiveRunMs(5 * MIN, 5 * MIN, DEFAULT_MAX, ABSOLUTE_MAX) == 5 * MIN);

  // No maximum in the command (an older server): the default 5 minutes.
  CHECK(effectiveRunMs(10 * MIN, 0, DEFAULT_MAX, ABSOLUTE_MAX) == DEFAULT_MAX);
  CHECK(effectiveRunMs(1 * MIN, 0, DEFAULT_MAX, ABSOLUTE_MAX) == 1 * MIN);

  // No duration given: the zone's maximum, never unlimited.
  CHECK(effectiveRunMs(0, 30 * MIN, DEFAULT_MAX, ABSOLUTE_MAX) == 30 * MIN);
  CHECK(effectiveRunMs(0, 0, DEFAULT_MAX, ABSOLUTE_MAX) == DEFAULT_MAX);

  // Never past the kit's own 120 minutes, whatever the command says.
  CHECK(effectiveRunMs(500 * MIN, 500 * MIN, DEFAULT_MAX, ABSOLUTE_MAX) == ABSOLUTE_MAX);
  CHECK(effectiveRunMs(0, 500 * MIN, DEFAULT_MAX, ABSOLUTE_MAX) == ABSOLUTE_MAX);

  // Lost-connection failsafe: 3 minutes without the server during a server-started run.
  const unsigned long LOST = 3 * MIN;
  CHECK(!lostContactShouldStop(true, true, 1000000, 1000000, LOST));               // in touch now
  CHECK(!lostContactShouldStop(true, true, 1000000 + LOST - 1, 1000000, LOST));    // just under
  CHECK(lostContactShouldStop(true, true, 1000000 + LOST, 1000000, LOST));         // 3 minutes
  CHECK(!lostContactShouldStop(false, true, 1000000 + 10 * LOST, 1000000, LOST));  // fallback / local page
  CHECK(!lostContactShouldStop(true, false, 1000000 + 10 * LOST, 1000000, LOST));  // pump already off

  // millis() wraps after ~49 days on the ESP32 (32-bit unsigned long): still counted from the
  // last contact. Only meaningful where unsigned long is 32 bits (the board, Windows).
  if (sizeof(unsigned long) == 4) {
    const unsigned long nearWrap = 0xFFFFFFFFUL - 60000UL;   // 1 minute before the wrap
    CHECK(!lostContactShouldStop(true, true, nearWrap + 2 * MIN, nearWrap, LOST));   // wrapped, 2 min
    CHECK(lostContactShouldStop(true, true, nearWrap + 4 * MIN, nearWrap, LOST));    // wrapped, 4 min
  }

  printf("%d checks, %d failed\n", checks, failures);
  return failures == 0 ? 0 : 1;
}
