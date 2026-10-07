# AgroFlow - proof of testing

What was tested, how, what it found, and what is still checked by hand.
Everything automated here runs without the live database, Supabase,
Telegram, HiveMQ or Storage: the backend tests use pure functions or the real
API hosted in memory with every outside address pointing nowhere
(`ApiHost`); the admin tests use Playwright with a mocked API; the mobile
tests use jest with the network faked.

## 1. Summary

| Suite | Tests | Passed | Failed | Skipped | Duration | Date | Evidence |
|---|---|---|---|---|---|---|---|
| Backend (xUnit, .NET 8) | 1201 | 1201 | 0 | 0 | about 10 s of test time | 2026-10-07 | `backend.trx` |
| Admin console (Playwright, Chromium) | 76 | 76 | 0 | 0 | 8.7 min | 2026-10-07 | `admin-playwright/index.html`, `admin-playwright.txt` |
| Mobile app (jest + Testing Library) | 59 | 59 | 0 | 0 | 19.7 s | 2026-10-07 | `mobile-jest.txt` |
| Admin typecheck + build | - | pass | - | - | - | 2026-10-07 | `admin-typecheck-build.txt` |
| Mobile typecheck + expo-doctor | - | typecheck pass; expo-doctor 20/21 (see §9) | - | - | - | 2026-10-07 | `mobile-checks.txt` |
| Repo-wide: conflict markers | - | none found | - | - | - | 2026-10-07 | `git grep` over the tree |
| Contract audit: API routes | 100 routes; all 73 baseline routes present | | | | | 2026-10-07 | `api-routes.md` |
| Firmware compile (arduino-cli) | **not run**: `arduino-cli` is not installed on this machine | | | | | | see §5 |

## 2. Requirements → tests

See [traceability.md](traceability.md): every major feature mapped to the
tests that prove it - including the rule book, actionable insights, "Why am I
seeing this?", confidence and graceful degradation, recommended settings,
the farmer changing the crop, claim-based accountability, request
completion, the enquiry flow and its report, Telegram auto-report schedules
and rapid-click navigation.

## 3. FAO-56 worked examples (expected vs actual)

From `Fao56EngineVerificationTests`; the full print-out is
[fao56-worked-examples.txt](fao56-worked-examples.txt).

| Example | Quantity | FAO-56 | AgroFlow | Tolerance |
|---|---|---|---|---|
| 18 (ETo, p. 72) | ETo (mm/day) | 3.90 | 3.97 | 0.12 |
| 18 | Rn (MJ m⁻² d⁻¹) | 13.28 | 13.27 | 0.1 |
| 18 | es − ea (kPa) | 0.589 | 0.589 | 0.004 |
| 28 (Kc curve) | Kc day 20 / 40 / 70 / 95 | 0.15 / 0.77 / 1.19 / 0.56 | 0.150 / 0.774 / 1.190 / 0.560 | 0.005 |
| 36 (RAW) | TAW / RAW (mm) | 136 / 54 | 136.0 / 54.4 | 0.05 / 0.5 |
| 37 (TAW, RAW, Ks, balance) | TAW / RAW (mm) | 160 / 64 | 160.0 / 64.0 | 0.05 |
| 37 | Ks at Dr 67 / 72.8 mm | 0.97 / 0.91 | 0.969 / 0.908 | 0.005 |
| 37 | Dr after 10 days (mm) | 104.5 | 104.5 | 0.5 |

The rule book is also tested table-driven over every crop × soil × stage at
the boundaries (exactly at RAW, rain exactly equal to the need, verdict
ratios exactly 1.2 and 0.8) - `RuleBookMatrixTests`.

## 4. Adversarial sweep (TEST PLAN 1)

Each case, its outcome, and the fix where one was needed. Bugs are numbered
as in [bugs-found.md](bugs-found.md).

### Data edges
| Case | Outcome | Test |
|---|---|---|
| Empty database: every page | Every page loads and says it is empty; no endless skeleton | `robustness.spec.ts` "loads with an empty database" ×13 |
| Zone with no planting date / area / flow / soil / coordinates | Advice still given, labelled, with the one next step | `AdviceNeverBlockedTests`, `ManualLoggingTests`, `screens.test.tsx` |
| Planting date in the future, today, a year past the season | Advice given, no crash | `EdgeCaseTests.Any_planting_date_gives_advice_without_crashing` |
| Zero/negative area, depth, flow | Refused with a sentence | `ManualLoggingTests.Registration_setup_fields_are_checked`, `RequestCompletionTests` |
| Crop casing, spaces, plurals, Afrikaans names, unknown crop | Resolve; unknown → "Finish setup", never silence | `EdgeCaseTests` |
| 0, 1, 100 000 readings | Fine; 100 000 in well under 2 s | `EdgeCaseTests` |
| Sensor 0, 4095, NaN, ∞, −5, 5000; missing DHT11; stuck | Implausible values ignored; DHT offline and stuck paths raise their insight | `EdgeCaseTests`, `RuleBookTests` (KitRules), `ExplanationTests` |

### Time and locale
| Case | Outcome | Test |
|---|---|---|
| Events at 23:59 / 00:01 SAST | Land on the right day | `EdgeCaseTests.A_soil_check_at_23_59_SAST…`, `screens.test.tsx` "SAST times" |
| Month and year ends; a period spanning them | Each day counted once | `EdgeCaseTests.A_report_period_spanning_a_month_and_a_year_end…` |
| af-ZA / en-ZA (decimal comma) | Charts, workbooks and advice keep "." | `EdgeCaseTests.Numbers_in_charts_workbooks_and_advice…` |
| UTC vs SAST display | The app's Alerts and History showed the phone's own zone - **bug 10, fixed** | `screens.test.tsx` |

### Security and permissions
| Case | Outcome | Test |
|---|---|---|
| Farmer A at farmer B's zone, farm, reports, kit | Every farmer route that names a zone or farm checks ownership (owner, member or admin) | `SqlGuardTests`, `RecommendationTests` (403) |
| A farmer calling every admin endpoint | 403 on all 53 | `ApiContractTests` |
| No / expired / invalid JWT | 401 on every protected route; the real JWT check validates lifetime, signature and audience | `ApiContractTests`, `SecurityTests` |
| Revoked device token; legacy key switch | Refused; the switch is honoured | `DeviceTokenTests`, `SecurityTests` |
| `<script>`, quotes, `' OR 1=1 --`, emoji, Ngqeleni, Kroonstad Sôre, 500 characters, control characters | Shown as text in the console; PDFs, workbooks, charts and CSV stay valid and inert - **bugs 2, 3 and 4, fixed** | `HostileTextTests`, `hostile.spec.ts` |
| Audit log append-only; actor from the login even if the body names one | Nothing updates or deletes audit rows; no body carries an actor | `SqlGuardTests`, `AccountabilityTests`, `RequestCompletionTests`, `EnquiryTests` |
| An unprotected route slipping in | Only the nine known routes are open | `ApiContractTests.Only_the_known_routes_are_open…` |

### Concurrency and repeats
| Case | Outcome | Test |
|---|---|---|
| Double-click Submit/Confirm in every wizard | One record: drawer confirm runs once; writes are single-flight in the app | `rapid-actions.spec.ts`, `singleFlight.test.ts`, `doubleSubmit.test.ts`, `todayCard.test.tsx`, `enquiry.test.ts` |
| Two claims racing for the last MQTT login | `for update skip locked` in the claim's transaction: one wins, the other falls back | `SqlGuardTests` |
| Re-running the report scheduler in one period | Fires once per period | `AutoReportScheduleTests` |
| The same Telegram message twice | The ledger claims it once | `SqlGuardTests`, `FarmRequestNotifierResilienceTests` |

### Dependency failures
| Case | Outcome | Test |
|---|---|---|
| Weather API down or returning garbage | Parsed defensively; a `data_gap` insight; no crash | `OpenMeteoDailyParserTests`, `ExplanationTests` ("data gap") |
| Telegram send failing | Never fails the user's action | `FarmRequestNotifierResilienceTests` |
| Storage missing | **Not applicable**: this deployment stores no report files (each PDF is rebuilt on request - migration 0034); a failed build marks the report Failed with a plain reason | `ReportGenerationService` behaviour; `screens.test.tsx` shows Failed with its reason |
| MQTT broker unreachable | API still serves; health shows MQTT **down** after 2 minutes - **bug 6, fixed** | `DependencyFailureTests` |
| Database unreachable | Health names it; every route answers 503 with a sentence - **bug 5, fixed** | `DependencyFailureTests` |
| A migration missing | The startup schema check and health name it | `AuditLogAndSchemaCheckTests` |

### UI robustness (admin)
| Case | Outcome | Test |
|---|---|---|
| Every route with empty data and with every call failing | Empty states; the shared error panel with Retry and the server's sentence - **bug 8 and coherence 1, fixed** | `robustness.spec.ts` |
| Every button real, back/forward | Covered page by page in the specs; rapid back/forward | `rapid-navigation.spec.ts` |
| Wizards: Next blocked until valid, Back keeps values, review, Confirm toast | Yes | `setup.spec.ts`, `requests.spec.ts`, `keyboard.spec.ts` |
| 1366×768, 1920×1080, 390×844 | No page scrolls sideways | `robustness.spec.ts` |
| Keyboard only | The register-farm wizard completes with Tab, typing and Enter; focus visible at every stop | `keyboard.spec.ts` |
| Loading animation with the video blocked | Clears within 10 s | `robustness.spec.ts` |

## 5. Firmware sanity (TEST PLAN 3)

`arduino-cli` is **not installed** on this machine, so the sketch was not
compiled; no compile log exists. The firmware was reviewed against the API
contract instead, and that review is now a test (`FirmwareContractTests`,
reading `AgroFlowIrrigationNode.ino` only - never `secrets.h`): routes, the
`X-Device-Token` header, the claim request and response, the credentials
response (broker details optional on both sides), irrigation events, command
acknowledgements, the firmware check, MQTT topics and payloads. **No mismatch
was found; no reflash is needed.**

## 6. Admin coherence (TEST PLAN 2)

See [coherence.md](coherence.md) for every inconsistency found and its fix.

## 7. Manual test log (what cannot be automated)

Copy a row per run. Real hardware, real Telegram and a real phone are not
covered by the automated suites.

| Step | Expected | Actual | Pass/Fail | Tester | Date |
|---|---|---|---|---|---|
| Flash firmware v1.4.0, enter an enrollment code from the console on the board's setup page | Board claims, appears Online under Kits within a minute | | | | |
| Pour water on the probe | Reading rises in the app within a minute | | | | |
| "Water now" from the app | Pump runs for the chosen time; History shows it | | | | |
| Change WiFi from the console | Board opens its setup network; rejoins on the new network | | | | |
| Link Telegram from the app, trigger a Critical zone | Alert arrives on Telegram with a Why button that answers | | | | |
| Ask for a report in the app; open it on a phone | PDF opens and reads correctly on a small screen | | | | |
| Submit "Get a call back" on the live landing page | Thank-you shown; admins get the Telegram notice; it appears under Enquiries | | | | |
| Automatic weekly report on the chosen day | Arrives once, to the farmer and recipients | | | | |

## 8. Known limitations

- **Hardware is not covered by automated tests.** The firmware contract is;
  the board itself is checked by hand (section 7).
- **Resistive soil sensors** read relative wetness and drift as they corrode;
  advice uses the wet/dry setup and flags drift, but the probe is not a
  calibrated instrument.
- **HiveMQ Serverless is retiring on 31 Dec 2026.** The broker must move
  before then (configuration names `Mqtt__Host`, `Mqtt__Port`; boards accept
  a new broker from the credentials response).
- **No schedule editor** in the console: watering schedules are set in the
  app; automatic report schedules are edited per farm.
- The database's row-level security policies are asserted through the SQL the
  API runs and the migrations' text; they are not executed against a live
  Postgres in these tests (none may be touched).

## 9. expo-doctor

20 of 21 checks pass. The one that does not: seven Expo packages
(`expo`, `expo-router`, `expo-updates`, `expo-notifications`,
`expo-constants`, `expo-linking`, `@expo/ui`) are **one patch version behind**
what SDK 57 expects. These versions were already in the project before this
work - no change here touched them - and upgrading production packages is
outside this brief. Recommended as a separate change: `npx expo install
--check`, then a test build, since `expo-updates` and `expo-notifications`
include native code (a new APK, not just an EAS Update).
