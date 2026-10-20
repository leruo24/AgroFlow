// Native unit tests for the irrigation node's offline buffer and replay
// (AgroFlowIrrigationNode/OfflineBuffer.h). No board needed:
//
//   g++ -std=c++17 -Wall -Wextra -I../AgroFlowIrrigationNode offline_buffer_test.cpp -o offline_buffer_test
//   ./offline_buffer_test
//
// (clang++ works the same way.) Exit code 0 means every check passed.

#include <stdio.h>
#include <vector>

#include "OfflineBuffer.h"

using agroflow::BufferedReading;
using agroflow::BufferedRun;
using agroflow::RingBuffer;

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

static BufferedReading reading(uint32_t seq, uint32_t epoch = 1760000000) {
  BufferedReading r{};
  r.seq = seq;
  r.epoch = epoch + seq * 300;
  r.uptimeSec = seq * 300;
  r.value = 40.0f + (float)seq;
  r.bootId = 7;
  r.kind = agroflow::kSoilMoisture;
  return r;
}

static void test_buffer_fills_in_order() {
  printf("buffer fills in order\n");
  RingBuffer<BufferedReading, 5> buf;
  CHECK(buf.empty());
  for (uint32_t i = 1; i <= 5; i++) CHECK(!buf.push(reading(i)));
  CHECK(buf.full());
  CHECK(buf.size() == 5);
  CHECK(buf.dropped() == 0);
  for (size_t i = 0; i < 5; i++) CHECK(buf.at(i).seq == i + 1);
  BufferedReading first{};
  CHECK(buf.peek(first) && first.seq == 1);
}

static void test_oldest_dropped_when_full() {
  printf("oldest is dropped first when full\n");
  RingBuffer<BufferedReading, 5> buf;
  for (uint32_t i = 1; i <= 5; i++) buf.push(reading(i));
  CHECK(buf.push(reading(6)));  // reports the drop
  CHECK(buf.push(reading(7)));
  CHECK(buf.size() == 5);
  CHECK(buf.dropped() == 2);
  // 1 and 2 are gone; 3..7 remain, oldest first.
  for (size_t i = 0; i < 5; i++) CHECK(buf.at(i).seq == i + 3);

  // Keeps working across many wrap-arounds.
  for (uint32_t i = 8; i <= 1000; i++) buf.push(reading(i));
  CHECK(buf.size() == 5);
  CHECK(buf.at(0).seq == 996);
  CHECK(buf.at(4).seq == 1000);
  CHECK(buf.dropped() == 995);
}

static void test_replay_order_and_stop_on_failure() {
  printf("replay sends oldest first and stops at the first failure\n");
  RingBuffer<BufferedReading, 8> buf;
  for (uint32_t i = 1; i <= 6; i++) buf.push(reading(i));

  std::vector<uint32_t> sent;
  int budget = 3;  // the broker takes three, then the link drops
  size_t n = buf.replay([&](const BufferedReading &r) {
    if (budget-- <= 0) return false;
    sent.push_back(r.seq);
    return true;
  }, 100);
  CHECK(n == 3);
  CHECK((sent == std::vector<uint32_t>{1, 2, 3}));
  CHECK(buf.size() == 3);
  CHECK(buf.at(0).seq == 4);  // the failed one is still first in line

  // Reconnect: the rest go out in order.
  n = buf.replay([&](const BufferedReading &r) { sent.push_back(r.seq); return true; }, 100);
  CHECK(n == 3);
  CHECK((sent == std::vector<uint32_t>{1, 2, 3, 4, 5, 6}));
  CHECK(buf.empty());
}

static void test_replay_respects_batch_limit() {
  printf("replay sends at most maxItems per call\n");
  RingBuffer<BufferedReading, 8> buf;
  for (uint32_t i = 1; i <= 7; i++) buf.push(reading(i));
  std::vector<uint32_t> sent;
  auto ok = [&](const BufferedReading &r) { sent.push_back(r.seq); return true; };
  CHECK(buf.replay(ok, 2) == 2);
  CHECK(buf.replay(ok, 2) == 2);
  CHECK(buf.replay(ok, 2) == 2);
  CHECK(buf.replay(ok, 2) == 1);
  CHECK(buf.replay(ok, 2) == 0);
  CHECK((sent == std::vector<uint32_t>{1, 2, 3, 4, 5, 6, 7}));
}

static void test_no_duplicates() {
  printf("no reading is sent twice, even with failures, new readings and reloads\n");
  RingBuffer<BufferedReading, 6> buf;
  std::vector<uint32_t> delivered;
  uint32_t nextSeq = 1;
  unsigned rng = 12345;
  auto coin = [&]() { rng = rng * 1103515245u + 12345u; return (rng >> 16) & 1u; };

  for (int round = 0; round < 400; round++) {
    // Sometimes a new reading arrives while still offline.
    if (coin()) buf.push(reading(nextSeq++));
    // Sometimes the board reboots: the ring goes through flash and back.
    if (coin() && coin()) {
      uint8_t blob[RingBuffer<BufferedReading, 6>::blobSize()];
      size_t len = buf.toBytes(blob, sizeof(blob));
      RingBuffer<BufferedReading, 6> reloaded;
      CHECK(reloaded.fromBytes(blob, len));
      buf = reloaded;
    }
    // Sometimes the link is up long enough to send a few.
    buf.replay([&](const BufferedReading &r) {
      if (!coin()) return false;
      delivered.push_back(r.seq);
      return true;
    }, 3);
  }
  buf.replay([&](const BufferedReading &r) { delivered.push_back(r.seq); return true; }, 1000);

  // Strictly increasing = in order and no repeats.
  bool increasing = true;
  for (size_t i = 1; i < delivered.size(); i++) if (delivered[i] <= delivered[i - 1]) increasing = false;
  CHECK(increasing);
  // Every reading was either delivered once or counted as dropped (buffer full).
  CHECK(delivered.size() + buf.dropped() == nextSeq - 1);
  CHECK(buf.empty());
}

static void test_flash_round_trip() {
  printf("the ring survives a reboot through its flash blob\n");
  RingBuffer<BufferedRun, 4> runs;
  for (uint32_t i = 1; i <= 6; i++) {
    BufferedRun r{};
    r.seq = i;
    r.startedEpoch = 1760000000 + i;
    r.runtimeSec = 60 * i;
    r.source = agroflow::kRunManual;
    runs.push(r);
  }
  uint8_t blob[RingBuffer<BufferedRun, 4>::blobSize()];
  size_t len = runs.toBytes(blob, sizeof(blob));
  CHECK(len > 0);

  RingBuffer<BufferedRun, 4> back;
  CHECK(back.fromBytes(blob, len));
  CHECK(back.size() == 4);
  CHECK(back.dropped() == 2);
  for (size_t i = 0; i < 4; i++) {
    CHECK(back.at(i).seq == i + 3);
    CHECK(back.at(i).runtimeSec == 60 * (i + 3));
  }

  // A blob from another layout (wrong capacity) or a torn write is refused, not misread.
  RingBuffer<BufferedRun, 5> otherSize;
  CHECK(!otherSize.fromBytes(blob, len));
  CHECK(otherSize.empty());
  CHECK(!back.fromBytes(blob, 10));
  CHECK(back.empty());
  blob[0] ^= 0xFF;
  CHECK(!back.fromBytes(blob, len));
}

static void test_resolve_epoch() {
  printf("a reading's time is recovered from uptime only within the same boot\n");
  BufferedReading withClock = reading(1);
  CHECK(agroflow::resolveEpoch(withClock, 7, 1770000000, 99999) == withClock.epoch);

  BufferedReading noClock{};
  noClock.epoch = 0;
  noClock.uptimeSec = 1000;
  noClock.bootId = 7;
  // Same boot, clock now set: placed 500 s before now.
  CHECK(agroflow::resolveEpoch(noClock, 7, 1770000000, 1500) == 1770000000 - 500);
  // Earlier boot with no clock: cannot be placed.
  CHECK(agroflow::resolveEpoch(noClock, 8, 1770000000, 1500) == 0);
  // Clock still not set.
  CHECK(agroflow::resolveEpoch(noClock, 7, 0, 1500) == 0);
}

static void test_names() {
  printf("sensor and run names match the API's\n");
  CHECK(strcmp(agroflow::sensorKindName(agroflow::kSoilMoisture), "SoilMoisture") == 0);
  CHECK(strcmp(agroflow::sensorKindName(agroflow::kTemperature), "Temperature") == 0);
  CHECK(strcmp(agroflow::sensorKindName(agroflow::kHumidity), "Humidity") == 0);
  CHECK(agroflow::sensorKindName(99) == nullptr);
  CHECK(strcmp(agroflow::runSourceName(agroflow::kRunManual), "manual") == 0);
  CHECK(strcmp(agroflow::runSourceName(agroflow::kRunAuto), "auto") == 0);
  CHECK(strcmp(agroflow::runSourceName(0), "unknown") == 0);
}

int main() {
  test_buffer_fills_in_order();
  test_oldest_dropped_when_full();
  test_replay_order_and_stop_on_failure();
  test_replay_respects_batch_limit();
  test_no_duplicates();
  test_flash_round_trip();
  test_resolve_epoch();
  test_names();
  printf("%d checks, %d failed\n", checks, failures);
  return failures == 0 ? 0 : 1;
}
