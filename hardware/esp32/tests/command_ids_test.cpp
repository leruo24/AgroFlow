// Native unit tests for the irrigation node's recent command IDs
// (AgroFlowIrrigationNode/CommandIds.h). No board needed:
//
//   g++ -std=c++17 -Wall -Wextra -I../AgroFlowIrrigationNode command_ids_test.cpp -o command_ids_test
//   ./command_ids_test
//
// (clang++ works the same way.) Exit code 0 means every check passed.

#include <stdio.h>
#include <string>
#include <vector>

#include "CommandIds.h"

using agroflow::RecentCommandIds;

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

static std::string uuid(int n) {
  char buf[40];
  snprintf(buf, sizeof(buf), "0f9b952c-fd98-49e4-99eb-%012d", n);
  return buf;
}

// The handler's rule, as in AgroFlowIrrigationNode.ino: a seen ID is acknowledged again
// with its first time and never carried out; a new ID is remembered first, then run.
struct Kit {
  RecentCommandIds<32> recent;
  int runs = 0;
  std::vector<uint32_t> acks;
  void handle(const std::string &id, uint32_t now) {
    int64_t first = recent.acknowledgedAt(id.c_str());
    if (first >= 0) { acks.push_back((uint32_t)first); return; }
    recent.remember(id.c_str(), now);
    runs++;
    acks.push_back(now);
  }
};

static void test_repeat_is_acknowledged_with_the_first_time_and_not_run() {
  Kit kit;
  kit.handle(uuid(1), 1760000000);
  kit.handle(uuid(1), 1760000300);   // the API resends: its acknowledgement was lost
  kit.handle(uuid(1), 1760000600);
  CHECK(kit.runs == 1);
  CHECK(kit.acks.size() == 3);
  CHECK(kit.acks[1] == 1760000000 && kit.acks[2] == 1760000000);
  kit.handle(uuid(2), 1760000900);   // a different command still runs
  CHECK(kit.runs == 2);
}

static void test_remembers_the_last_n_and_forgets_the_oldest() {
  RecentCommandIds<32> recent;
  for (int i = 0; i < 40; i++) recent.remember(uuid(i).c_str(), 1760000000 + i);
  CHECK(recent.size() == 32);
  CHECK(!recent.contains(uuid(7).c_str()));      // among the 8 oldest, forgotten
  CHECK(recent.contains(uuid(8).c_str()));       // the oldest still kept
  CHECK(recent.contains(uuid(39).c_str()));
  CHECK(recent.acknowledgedAt(uuid(20).c_str()) == 1760000020);
  // Remembering a known ID again keeps its first time and does not push anything out.
  recent.remember(uuid(20).c_str(), 1);
  CHECK(recent.acknowledgedAt(uuid(20).c_str()) == 1760000020);
  CHECK(recent.contains(uuid(8).c_str()));
}

static void test_survives_a_reboot_through_the_flash_blob() {
  Kit before;
  for (int i = 0; i < 25; i++) before.handle(uuid(i), 1760000000 + i);
  uint8_t blob[RecentCommandIds<32>::blobSize()];
  size_t len = before.recent.toBytes(blob, sizeof(blob));
  CHECK(len > 0);

  Kit after;   // power cut, reboot: only the flash blob is left
  CHECK(after.recent.fromBytes(blob, len));
  after.handle(uuid(24), 1760009999);   // the resend arrives after the reboot
  after.handle(uuid(3), 1760009999);
  CHECK(after.runs == 0);
  CHECK(after.acks[0] == 1760000024 && after.acks[1] == 1760000003);
  after.handle(uuid(99), 1760010000);
  CHECK(after.runs == 1);
}

static void test_a_blob_that_does_not_match_is_ignored() {
  RecentCommandIds<32> recent;
  recent.remember(uuid(1).c_str(), 5);
  uint8_t blob[RecentCommandIds<32>::blobSize()];
  size_t len = recent.toBytes(blob, sizeof(blob));

  RecentCommandIds<16> otherSize;   // another firmware's layout
  CHECK(!otherSize.fromBytes(blob, len));
  CHECK(otherSize.size() == 0);
  RecentCommandIds<32> torn;
  CHECK(!torn.fromBytes(blob, len - 10));   // a torn write
  CHECK(torn.size() == 0);
  uint8_t bad[RecentCommandIds<32>::blobSize()];
  memcpy(bad, blob, len);
  bad[0] ^= 0xFF;                           // not our magic
  CHECK(!torn.fromBytes(bad, len));
  CHECK(!torn.fromBytes(blob, 3));
}

static void test_edge_ids() {
  RecentCommandIds<4> recent;
  recent.remember("", 1);
  recent.remember(nullptr, 1);
  CHECK(recent.size() == 0);
  CHECK(!recent.contains(""));
  CHECK(recent.acknowledgedAt(nullptr) == -1);
  recent.remember("short-id", 0);   // a clock that was not set still counts as seen
  CHECK(recent.contains("short-id"));
  CHECK(recent.acknowledgedAt("short-id") == 0);
  CHECK(!recent.contains("short-i"));
}

int main() {
  test_repeat_is_acknowledged_with_the_first_time_and_not_run();
  test_remembers_the_last_n_and_forgets_the_oldest();
  test_survives_a_reboot_through_the_flash_blob();
  test_a_blob_that_does_not_match_is_ignored();
  test_edge_ids();
  printf("%d checks, %d failed\n", checks, failures);
  return failures == 0 ? 0 : 1;
}
