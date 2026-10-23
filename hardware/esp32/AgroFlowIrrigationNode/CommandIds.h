// Recent command IDs for the irrigation node, in plain C++ with no Arduino headers, so
// the same code runs on the ESP32 and in the native unit tests
// (hardware/esp32/tests/command_ids_test.cpp, built with g++ or clang++).
//
// Why: MQTT delivers at least once, and the API resends a command it has no
// acknowledgement for (CommandReplayPolicy, up to 2 hours). If the kit ran a start but
// its acknowledgement was lost, the resend must not water a second time.
//
// What it guarantees:
//   - Remembers the last N command IDs (oldest forgotten first), each with the time the
//     kit first acknowledged it, so a repeat re-sends that original acknowledgement.
//   - A repeated ID is recognised whatever happened in between, including a reboot:
//     toBytes()/fromBytes() turn the list into one blob for the board's flash (NVS),
//     written before the command is acted on. A blob that does not match is ignored.
#pragma once

#include <stddef.h>
#include <stdint.h>
#include <string.h>

namespace agroflow {

template <size_t N>
class RecentCommandIds {
 public:
  static_assert(N > 0, "RecentCommandIds needs room for at least one ID");
  // A command ID is a UUID (36 characters). Longer IDs are compared on their first 39.
  static constexpr size_t kIdChars = 39;

  // The time this ID was first acknowledged (seconds since 1970 UTC, 0 if the clock
  // was not set), or -1 when the ID has not been seen.
  int64_t acknowledgedAt(const char *id) const {
    if (id == nullptr || id[0] == '\0') return -1;
    for (size_t i = 0; i < count_; i++) {
      const Entry &e = items_[(head_ + i) % N];
      if (strncmp(e.id, id, kIdChars) == 0) return (int64_t)e.ackEpoch;
    }
    return -1;
  }

  bool contains(const char *id) const { return acknowledgedAt(id) >= 0; }

  // Remembers an ID. An ID already remembered keeps its first time. When full, the
  // oldest ID is forgotten to make room.
  void remember(const char *id, uint32_t ackEpoch) {
    if (id == nullptr || id[0] == '\0' || contains(id)) return;
    if (count_ == N) {
      head_ = (head_ + 1) % N;
      count_--;
    }
    Entry &e = items_[(head_ + count_) % N];
    memset(&e, 0, sizeof(e));
    strncpy(e.id, id, kIdChars);
    e.ackEpoch = ackEpoch;
    count_++;
  }

  size_t size() const { return count_; }
  static constexpr size_t capacity() { return N; }
  void clear() { head_ = 0; count_ = 0; }

  // Flash blob: magic, version, entry size, capacity, count, then the IDs oldest first.
  static constexpr size_t blobSize() { return kHeaderSize + N * sizeof(Entry); }

  size_t toBytes(uint8_t *out, size_t outSize) const {
    if (outSize < blobSize()) return 0;
    uint32_t header[kHeaderWords] = {kMagic, kVersion, (uint32_t)sizeof(Entry), (uint32_t)N, (uint32_t)count_};
    memcpy(out, header, kHeaderSize);
    for (size_t i = 0; i < count_; i++)
      memcpy(out + kHeaderSize + i * sizeof(Entry), &items_[(head_ + i) % N], sizeof(Entry));
    return kHeaderSize + count_ * sizeof(Entry);
  }

  bool fromBytes(const uint8_t *in, size_t len) {
    clear();
    if (len < kHeaderSize) return false;
    uint32_t header[kHeaderWords];
    memcpy(header, in, kHeaderSize);
    if (header[0] != kMagic || header[1] != kVersion || header[2] != sizeof(Entry) || header[3] != N) return false;
    size_t count = header[4];
    if (count > N || len < kHeaderSize + count * sizeof(Entry)) return false;
    for (size_t i = 0; i < count; i++) {
      memcpy(&items_[i], in + kHeaderSize + i * sizeof(Entry), sizeof(Entry));
      items_[i].id[kIdChars] = '\0';   // a torn write can never make an unterminated ID
    }
    head_ = 0;
    count_ = count;
    return true;
  }

 private:
  struct Entry {
    char id[kIdChars + 1];
    uint32_t ackEpoch;
  };
  static constexpr uint32_t kMagic = 0x41464331;  // "AFC1"
  static constexpr uint32_t kVersion = 1;
  static constexpr size_t kHeaderWords = 5;
  static constexpr size_t kHeaderSize = kHeaderWords * sizeof(uint32_t);

  Entry items_[N];
  size_t head_ = 0;
  size_t count_ = 0;
};

}  // namespace agroflow
