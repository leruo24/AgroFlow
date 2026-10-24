// Native unit tests for the setup page's words (AgroFlowIrrigationNode/SetupPortal.h, firmware
// 1.7.2). No board needed:
//
//   g++ -std=c++17 -Wall -Wextra -Werror -I../AgroFlowIrrigationNode setup_portal_test.cpp -o setup_portal_test
//   ./setup_portal_test
//
// Exit code 0 means every check passed.

#include <stdio.h>
#include <string.h>

#include <initializer_list>

#include "SetupPortal.h"

using agroflow::JoinProblem;

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

static bool contains(const char *text, const char *part) { return strstr(text, part) != nullptr; }

int main() {
  // Wi-Fi: a wrong password and a network the kit cannot see say different things.
  CHECK(agroflow::joinProblemFromReason(0) == JoinProblem::None);
  for (int reason : {2, 15, 202, 204}) CHECK(agroflow::joinProblemFromReason(reason) == JoinProblem::WrongPassword);
  for (int reason : {201, 210, 211, 212}) CHECK(agroflow::joinProblemFromReason(reason) == JoinProblem::NotFound);
  CHECK(agroflow::joinProblemFromReason(8) == JoinProblem::Other);
  CHECK(contains(agroflow::joinMessage(JoinProblem::WrongPassword), "Wrong Wi-Fi password"));
  CHECK(contains(agroflow::joinMessage(JoinProblem::NotFound), "5 GHz"));
  CHECK(contains(agroflow::joinMessage(JoinProblem::NotFound), "2.4 GHz"));
  CHECK(strlen(agroflow::joinMessage(JoinProblem::None)) == 0);

  // The claim: every refusal the API can give has its own sentence.
  CHECK(strlen(agroflow::claimMessage(200, "")) == 0);
  CHECK(contains(agroflow::claimMessage(401, "code_expired"), "expired"));
  CHECK(contains(agroflow::claimMessage(409, "code_used"), "already been used"));
  CHECK(contains(agroflow::claimMessage(401, "code_invalid"), "6 digits"));
  CHECK(contains(agroflow::claimMessage(409, "kit_linked_elsewhere"), "another farm"));
  CHECK(contains(agroflow::claimMessage(429, "rate_limited"), "15 minutes"));
  CHECK(contains(agroflow::claimMessage(-1, ""), "Can't reach AgroFlow"));       // no internet
  CHECK(contains(agroflow::claimMessage(503, "mqtt_not_configured"), "Can't reach AgroFlow"));
  CHECK(contains(agroflow::claimMessage(502, nullptr), "Can't reach AgroFlow"));
  CHECK(strlen(agroflow::claimMessage(400, "")) > 0);

  // The code as typed.
  char out[12];
  CHECK(agroflow::normaliseSetupCode("123 456", out, sizeof(out)) && strcmp(out, "123456") == 0);
  CHECK(agroflow::normaliseSetupCode("123-456", out, sizeof(out)) && strcmp(out, "123456") == 0);
  CHECK(agroflow::normaliseSetupCode("abcd2345", out, sizeof(out)) && strcmp(out, "ABCD2345") == 0);   // an older code
  CHECK(!agroflow::normaliseSetupCode("12345", out, sizeof(out)));          // too short
  CHECK(!agroflow::normaliseSetupCode("123456789", out, sizeof(out)));      // too long
  CHECK(!agroflow::normaliseSetupCode("12#456", out, sizeof(out)));
  CHECK(!agroflow::normaliseSetupCode("", out, sizeof(out)));
  CHECK(!agroflow::normaliseSetupCode("123456", out, 4));                   // never overflows
  CHECK(!agroflow::normaliseSetupCode(nullptr, out, sizeof(out)));

  printf("%d checks, %d failed\n", checks, failures);
  return failures == 0 ? 0 : 1;
}
