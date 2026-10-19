// Offline buffer and replay for the irrigation node, in plain C++ with no Arduino
// headers, so the same code runs on the ESP32 and in the native unit tests
// (hardware/esp32/tests/offline_buffer_test.cpp, built with g++ or clang++).
//
// What it guarantees:
//   - Bounded: a fixed-size ring. When it is full the OLDEST entry is dropped to
//     make room, and dropped() counts how many were lost.
//   - In order: replay() hands entries to the sender oldest first and stops at the
//     first one that fails, so a later entry is never sent before an earlier one.
//   - No duplicates from the kit: an entry is removed only after it was sent, and
//     never sent again once removed. Each entry carries a sequence number, so the
//     server can also ignore a repeat (the same reading's time and type).
//   - Survives a reboot: toBytes()/fromBytes() turn the ring into one blob for the
//     board's flash (Preferences / NVS). A blob that does not match is ignored.
#pragma once

#include <stddef.h>
#include <stdint.h>
#include <string.h>

namespace agroflow {

template <typename T, size_t N>
class RingBuffer {
 public:
  static_assert(N > 0, "RingBuffer needs room for at least one entry");

  // Adds an entry. Returns true when the buffer was full and the oldest was dropped.
  bool push(const T &item) {
    bool dropped = false;
    if (count_ == N) {
      head_ = (head_ + 1) % N;
      count_--;
      dropped_++;
      dropped = true;
    }
    items_[(head_ + count_) % N] = item;
    count_++;
    return dropped;
  }

  // The oldest entry, without removing it.
  bool peek(T &out) const {
    if (count_ == 0) return false;
    out = items_[head_];
    return true;
  }

  // Removes the oldest entry.
  bool pop() {
    if (count_ == 0) return false;
    head_ = (head_ + 1) % N;
    count_--;
    return true;
  }

  // The i-th entry counted from the oldest (0 = oldest).
  const T &at(size_t i) const { return items_[(head_ + i) % N]; }

  size_t size() const { return count_; }
  bool empty() const { return count_ == 0; }
  bool full() const { return count_ == N; }
  static constexpr size_t capacity() { return N; }
  uint32_t dropped() const { return dropped_; }

  void clear() {
    head_ = 0;
    count_ = 0;
  }

  // Replays oldest first. send(item) returns true once the item is delivered.
  // At most maxItems are sent per call so the board's loop keeps running (sensors,
  // the pump safety cap). Returns how many were sent and removed.
  template <typename Sender>
  size_t replay(Sender send, size_t maxItems) {
    size_t sent = 0;
    while (count_ > 0 && sent < maxItems) {
      if (!send(items_[head_])) break;  // keep it; try again next time, still first
      pop();
      sent++;
    }
    return sent;
  }

  // Flash blob: magic, version, entry size, capacity, head, count, dropped, then the
  // entries in order oldest first (so head is always 0 after a load).
  static constexpr size_t blobSize() { return kHeaderSize + N * sizeof(T); }

  size_t toBytes(uint8_t *out, size_t outSize) const {
    if (outSize < blobSize()) return 0;
    uint32_t header[kHeaderWords] = {kMagic, kVersion, (uint32_t)sizeof(T), (uint32_t)N,
                                     (uint32_t)count_, dropped_};
    memcpy(out, header, kHeaderSize);
    for (size_t i = 0; i < count_; i++) memcpy(out + kHeaderSize + i * sizeof(T), &at(i), sizeof(T));
    return kHeaderSize + count_ * sizeof(T);
  }

  // Restores from a blob written by toBytes(). Anything that does not match this
  // build's layout (another firmware version, a torn write) leaves the buffer empty.
  bool fromBytes(const uint8_t *in, size_t len) {
    clear();
    if (len < kHeaderSize) return false;
    uint32_t header[kHeaderWords];
    memcpy(header, in, kHeaderSize);
    if (header[0] != kMagic || header[1] != kVersion || header[2] != sizeof(T) || header[3] != N) return false;
    size_t count = header[4];
    if (count > N || len < kHeaderSize + count * sizeof(T)) return false;
    for (size_t i = 0; i < count; i++) memcpy(&items_[i], in + kHeaderSize + i * sizeof(T), sizeof(T));
    head_ = 0;
    count_ = count;
    dropped_ = header[5];
    return true;
  }

 private:
  static constexpr uint32_t kMagic = 0x41464231;  // "AFB1"
  static constexpr uint32_t kVersion = 1;
  static constexpr size_t kHeaderWords = 6;
  static constexpr size_t kHeaderSize = kHeaderWords * sizeof(uint32_t);

  T items_[N];
  size_t head_ = 0;
  size_t count_ = 0;
  uint32_t dropped_ = 0;
};

// One sensor value taken while the kit could not reach the server.
enum SensorKind : uint8_t { kSoilMoisture = 1, kTemperature = 2, kHumidity = 3 };

struct BufferedReading {
  uint32_t seq;        // increases by one per reading, kept across reboots
  uint32_t epoch;      // seconds since 1970 (UTC) when known, else 0
  uint32_t uptimeSec;  // seconds since this boot when it was taken
  float value;
  uint16_t bootId;     // which boot took it (a counter kept in flash)
  uint8_t kind;        // SensorKind
  uint8_t reserved;
};

inline const char *sensorKindName(uint8_t kind) {
  switch (kind) {
    case kSoilMoisture: return "SoilMoisture";
    case kTemperature: return "Temperature";
    case kHumidity: return "Humidity";
    default: return nullptr;
  }
}

// When was this reading taken? The clock may not have been set yet (no internet
// since power-on), so a reading can carry only its uptime. That is still usable
// within the same boot: now - (uptime now - uptime then). From an earlier boot
// with no clock there is no way to place it, so 0 means "drop it".
inline uint32_t resolveEpoch(const BufferedReading &r, uint16_t currentBootId,
                             uint32_t nowEpoch, uint32_t nowUptimeSec) {
  if (r.epoch != 0) return r.epoch;
  if (r.bootId != currentBootId || nowEpoch == 0 || r.uptimeSec > nowUptimeSec) return 0;
  uint32_t age = nowUptimeSec - r.uptimeSec;
  return age < nowEpoch ? nowEpoch - age : 0;
}

// A pump run the server has not heard about yet (local page, offline fallback, or
// a run whose report failed). Uploaded as an irrigation event on reconnect.
enum RunSource : uint8_t { kRunAuto = 1, kRunManual = 2, kRunScheduled = 3, kRunUnknown = 4 };

struct BufferedRun {
  uint32_t seq;
  uint32_t startedEpoch;   // 0 when the clock was not set
  uint32_t runtimeSec;
  uint8_t source;          // RunSource
  uint8_t reserved[3];
};

inline const char *runSourceName(uint8_t source) {
  switch (source) {
    case kRunAuto: return "auto";
    case kRunManual: return "manual";
    case kRunScheduled: return "scheduled";
    default: return "unknown";
  }
}

}  // namespace agroflow
