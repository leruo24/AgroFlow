# Final report - the actionable-advice brief (MASTER-PROMPT)

Part 1 (items 0b → 6c) is merged into `dev` (c16bfaf). Part 2 (the full test
pass) is on `test/full-proof`, merged into `dev` with `--no-ff` (the merge commit following bf4bbad on `dev`). The
detailed per-item record - what was wrong, what changed, tests, decisions -
is [progress.md](progress.md); the plan with every acceptance criterion is
[plan.md](plan.md). Evidence for Part 2 is [docs/test-evidence/](../test-evidence/README.md).

## 1. Per item

| Item | Status | Commits | How the acceptance criteria were met |
|---|---|---|---|
| Pre-flight | done | 116f773 | Clean tree on `dev`, branch cut, baseline recorded (650 tests, 73 routes, firmware v1.4.0 and mobile contracts) in `baseline.md`. |
| 0b - one action per tap | done | 43a9ce0 | Panel intents, single-flight writes and a navigation lock; rapid-click Playwright and jest tests. |
| 2 - advice never blocked | done | 68ce29d | Engine advises with only crop + weather, labelled Medium/Low with the one next step; High only with full setup and a fresh calibrated reading. `AdviceNeverBlockedTests`. |
| 2b - the rule book | done | 6888586 | Every rule in `RuleBook/` with an FAO-56 page or a DATA RULE; `docs/rule-book.md` generated from code; `RuleBookTests`. |
| 2c - "Why am I seeing this?" | done | 70a1c31, d3040c3, 86ad320, 41d351e, 4342ef4 | Explanations for every insight, alert, KPI and report line; Telegram Why button; admin and mobile Why sheets; no jargon outside the technical line (scanned). |
| 3 - action reports | done | 154025b | One action-led report for all three types; real period wording; weather comparison only with local sensor data; samples in `docs/sample-reports/`. |
| 4 - Reports page and automatic reports | done | 74efb2d | Daily / weekly on a chosen day / monthly, per zone, recipients, test send, one retry then an admin alert. |
| 5 - accountability | done | 5e067d0 | Claim / take over with a reason / let go; real alert and maintenance actions; actor only from the login; `/assign` refuses anyone else's id (403). |
| 6 - practical with little setup | done | 77b9533, be80a1a | Wizard asks soil (Loam default), size presets, planting weeks, optional flow and depth; Home card per zone; Finish setup with the 500 mL bottle helper; "I watered" and soil feel in the balance, reports and history. |
| 6b - recommended settings; changing the crop | done | f079cde | Card numbers equal the RuleBook calculation (tested for potato/loam/0.2 m²/1.5 L/min/ETo 5); Use these settings = Reset to recommended; crop change recorded and denied on another farmer's zone (403); past reports keep the old crop; 0043 limits direct farmer zone edits. |
| 6c - requests and enquiries | done | b8cf3a2, 6c4982b, 2d7a988, 77e392a | I'll handle this → Mark complete (note); wizards prefilled from a request complete it; public form with server checks, per-IP limit and honeypot; Telegram notice; Enquiries tab with outcomes, reasons, call-backs on Home, onboarding link, anonymise; Enquiries & sales follow-up report (counts tested against hand-worked data). |
| Land Part 1 | done | c16bfaf | `--no-ff` merge into `dev`, all checks green on the merged tree, pushed. |
| Part 2 - full test pass | done | 791215c … bf4bbad | Rule book table-driven over every crop × soil × stage; API contract and permissions on the real route table; adversarial sweep; admin robustness and coherence; mobile screens; firmware contract. **Ten bugs found and fixed** ([bugs-found.md](../test-evidence/bugs-found.md)). |

## 2. Migrations to apply, in order

None has been applied (the brief forbids touching the live database). All are
additive and safe to re-run. From the repository root:

```powershell
.\supabase\scripts\apply-migrations.ps1 -From 39
```

| # | File | What it adds |
|---|---|---|
| 0039 | `0039_explanation.sql` | `explanation` - the stored "Why" behind Telegram messages and alerts |
| 0040 | `0040_report_schedule_extend.sql` | daily / chosen weekday / per-zone PDFs / recipients on `report_schedule` |
| 0041 | `0041_accountability.sql` | who is handling and who resolved alerts, requests and maintenance |
| 0042 | `0042_manual_logging.sql` | `irrigation_event.logged_by_profile_id`, `soil_feel_check` |
| 0043 | `0043_zone_farmer_edit_guard.sql` | trigger: a farmer's own login may change only crop, planting date, soil and size |
| 0044 | `0044_enquiry.sql` | `enquiry`, `enquiry_call` (append-only) |

Until each is applied, the features that need it answer "needs migration
00xx" (or keep working without it, read through `to_jsonb`); nothing breaks.
`docs/verify-migrations.sql` and the startup schema check (and Health) report
which are missing.

## 3. New configuration names

| Name | Used for | Required? |
|---|---|---|
| `Telegram__AdminGroupChatId` | Item 4: a copy of automatic reports and delivery alerts to an admin group chat | Optional |

No other configuration was added. The Telegram "Why am I seeing this?"
button needs no webhook: the existing polling service asks for
`callback_query` updates, answers each tap with `answerCallbackQuery`, and
sends the plain explanation only to a chat linked to the farm it belongs to
(tested end to end in `TelegramPollingWhyTests`). Polling must be on
(`Telegram__EnablePolling`) on exactly one instance, as before.

## 4. Mobile: EAS Update or a new APK?

**EAS Update is enough.** Every app change is JavaScript/TypeScript; the only
package changes are test-only dev dependencies (`jest`, `jest-expo`,
`@testing-library/react-native`, `@types/jest`), no native module was added
and `app.json` is unchanged. The new screens (Finish setup, Crop and planting
date, Ask for a call) are Expo Router files in the existing bundle.

The firmware needs **no reflash**: the contract review found no mismatch
(`FirmwareContractTests`).

## 5. Rule book - "Needs another source"

What FAO-56 cannot answer, kept out of the app until a source is found
(full table in [docs/rule-book.md](../rule-book.md)):

- How slowly clay should be watered to avoid run-off (infiltration rates).
- Which stage of each crop is most sensitive, and the yield lost (FAO Papers 33 / 66).
- When to plant each crop in the Western Cape (ARC; provincial calendars).
- Real stage lengths for local varieties.
- When and how much to fertilise.
- Pests and diseases that follow from wet leaves or over-watering.
- How much light rain reaches the roots in a small tub (FAO Paper 25; our own tubs).
- How often a resistive probe needs its wet/dry setup redone as it corrodes.
- How well a farmer can judge soil water by hand (USDA NRCS feel-and-appearance guide).
- Whether salty water or soil changes the advice (needs a salinity test).

## 6. Test evidence

- Final runs: backend **1201/1201**, admin **76/76**, mobile **59/59**; admin and mobile typecheck and build clean.
- [docs/test-evidence/README.md](../test-evidence/README.md) - summary, adversarial sweep, FAO-56 examples, manual test log, known limitations
- [traceability.md](../test-evidence/traceability.md) - every feature → its tests
- [bugs-found.md](../test-evidence/bugs-found.md) - ten bugs, root cause, fix commit, guarding test
- [coherence.md](../test-evidence/coherence.md) - admin coherence review
- `backend.trx`, `admin-playwright/` (HTML report), `admin-playwright.txt`, `mobile-jest.txt`, `admin-typecheck-build.txt`, `mobile-checks.txt`, `api-routes.md`, `fao56-worked-examples.txt`
- Sample reports: [docs/sample-reports/](../sample-reports/)

## 7. Honest notes

- The firmware was **not compiled** (`arduino-cli` is not installed here); it
  was checked against the API contract instead.
- Row-level security is asserted through the SQL the API runs and the
  migrations' text, not against a live Postgres.
- The "Recommended for you" card in the register-farm wizard is information
  only: there is no sensor to save thresholds to until the wet/dry setup is
  done, so it says where to apply it later rather than offering a button
  that would do nothing.
- `expo-doctor`: 20/21; seven Expo packages are a patch behind SDK 57, as
  they were before this work. Left alone (production packages are out of
  scope); upgrading them would need a new APK - see the evidence README §9.
- The enquiry report's "Do this next" is counts from the data only (overdue
  call-backs, uncalled enquiries, the most common reason for "no"); the
  brief's example suggestion of an "offline kit option" was removed, as no
  such option exists (follow-up, `fix/followups`).
