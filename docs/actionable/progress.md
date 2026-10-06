# Progress — `feat/actionable`

**Resuming? Read this file first.** The last row says where work stopped and
what is next.

| Item | Status | Commit | What's left | Next |
|---|---|---|---|---|
| pre-flight | done | 116f773 | — | 0b |
| 0b | done | 43a9ce0 | — | 2 |
| 2 | done | (this commit) | Confidence badge in the apps' UI → 2c/6 | 2b |

---

## Pre-flight

- Working tree clean, on `dev`, `git pull` already up to date.
- Branch `feat/actionable` cut from `dev` at `bb1c0a1`.
- Baseline recorded in `baseline.md`: 650 tests, 73 routes, firmware v1.4.0
  and mobile contracts.
- Plan in `plan.md`.
- **Repaired `docs/Fao56.pdf`.** The committed copy was corrupt (text-encoded:
  every non-ASCII byte replaced with `EF BF BD`, 6.4 MB → 11.3 MB, unreadable
  by any PDF tool). Restored from the intact `Downloads\Fao56.pdf` (6,432,919
  bytes, matching its own linearization header; `pypdf` reads all 326 pages).
  Added `.gitattributes` so binaries are never text-converted again.

---

## 0b — Fast clicks

### Root cause (proven by a failing test before the fix)

**Eight sidebar clicks produced seventy-five hash changes.** Three causes
compounded:

1. **Every click navigated twice.** The nav click called `go()`, and `go()`
   wrote `location.hash`, which fired `hashchange`, which called `go()` again.
2. **No navigation token.** `go()` awaited the page and then `swapContent`'s
   own 140 ms pause. An older page that answered later painted over the newer
   one.
3. **The stale page wrote its hash back** when it finished, firing another
   `hashchange` for a page nobody wanted - which started another navigation.
   That loop is the "vibration": the console kept cycling after the clicks
   stopped.

Plus a fourth, independent: **every Supabase auth event rebuilt the whole
shell** (`TOKEN_REFRESHED` on a timer, `SIGNED_IN` re-emitted on tab focus),
re-running the router mid-navigation. And on Windows, the scrollbar appearing
and disappearing between skeleton and page slid the layout sideways.

### Fix

- Only `hashchange` calls `go()`; clicks call `navigate()`, which only sets the
  hash. Clicking the current page does nothing.
- A navigation token: every await in `go()` is followed by a check; a
  superseded navigation stops. An `AbortController` per navigation cancels its
  **reads** (never writes); a cancelled read never settles, so it produces no
  error, modal or console noise. Background polling is exempt.
- Rendering never writes the hash; redirects use `history.replaceState`.
- The shell is rebuilt only when the view state actually changes.
- One delegated click listener for every `[data-act]`, `[data-go]` and tab,
  with a per-element busy guard: a double-click sends one request.
- Detail panels carry an intent; the last one asked for opens.
- Drawer confirm fires once (disabled on first click).
- `scrollbar-gutter: stable`; the skeleton holds the page height.

Mobile: a guarded `router` (push/navigate/back locked for one transition;
`replace` deliberately not, as it is the auth redirect), and every write is
single-flight in the data layer. **A double tap on "Water now" was sending two
pump-start commands** - `startManualIrrigation` checks whether the pump is
running, but that flag is only set after the request returns.

### Tests, and proof they test something

Admin (Playwright, mocked backend with random 50-600 ms delays): 11 tests.
Mobile (jest): 17 tests.

Each guard was removed and the suite re-run, to make sure the test fails
without it. Three tests initially passed **vacuously** and were rewritten:

- Playwright's `toHaveText` retries until it sees a match, then stops - so it
  passed the instant the right panel appeared, even though the wrong one
  replaced it a second later. Final-state checks are now one-shot reads after
  the slowest response is guaranteed to have landed.
- `visibilitychange` never actually triggered a Supabase auth event; the test
  now sends a real one on supabase-js's own BroadcastChannel.
- A same-frame double-click on a drawer's confirm didn't reach the button the
  second time - because `button.disabled = true` was still in place (my
  mutation had removed only the check). Removing both proved the guard.

Dev dependencies added: `@playwright/test` (admin); `jest`, `jest-expo` (the
Expo preset for jest, pinned to SDK 57's `~57.0.5`), `@testing-library/
react-native`, `@types/jest` (mobile). TypeScript 6 no longer auto-includes
`@types`, so test files carry `/// <reference types="jest" />` rather than
putting jest's globals in scope for the whole app.

---

## 2 — Advice is never blocked

### What was blocking it (read from the code, not assumed)

1. `Fao56Engine.Run` **returned early with no planting date** - no balance,
   no amount, nothing but "add the planting date".
2. `IrrigationAdvisor.Decide` set the schedule report's action only from a
   calibrated reading against a threshold. Without one it was
   `InsufficientData` → **"No recommendation possible"**, even when the
   zone's own insights (from the balance) said "water now". The two disagreed.
3. Without a flow rate or a zone size, a watering could not be turned into
   mm, so the balance **only ever dried**: such a zone was told to water
   every day, however often it was watered.
4. The schedule report's 24 h gate dropped a stale reading and with it the
   advice; and every report and app screen showed the raw sensor number
   **with a %**, calibrated or not.

### What changed

- `RuleBook/ConfidenceRules.cs`, `CropRules.cs`, `WaterRules.cs` (created
  here; 2b completes the rule book).
- Engine: runs with no planting date on the **assumed peak stage** (highest
  Table 12 Kc - citrus is the exception where that is not Kc mid); a reading
  older than 24 h no longer anchors the balance; with no flow/area, a pump
  run of at least 2 minutes resets the balance (DATA RULE, flagged in the
  limitations). Every result carries `Confidence` (High/Medium/Low + one
  line) and **one** `NextStep`.
- Insights: `setup_missing` is now the single next step, and a heads-up
  rather than act-now unless there is no crop. `water_now` always carries an
  amount: minutes + litres, or minutes per m² + mm, or mm (= L per m²).
  Stale → "Based on the weather (your kit hasn't sent data since 10 Feb): …".
  Assumed stage → "Maize: assumed peak growth (no planting date yet)", and no
  stage-change / harvest insights, which need a real date.
- Advisor: when the balance ran, the action IS the balance's verdict.
- API (additive only): insights gains `confidence`, `nextStep`,
  `stageAssumed`; schedule zones gain `confidence`, `nextStep`, and
  `latestMoisture.{reading, calibrated, label}`; moisture report gains
  `calibrated`, `readingUnit`. `latestMoisture.pct` and the moisture report's
  `...Pct` fields are now a real relative % when calibrated (converted with
  the engine's own formula) - they were the raw number before.
- Apps: one formatter (`lib/moistureDisplay.ts`) - "Sensor reading 612 (not
  yet set up)" before the wet/dry setup, never a %. Admin moisture preview
  likewise.
- `zone_water_balance.stage` is written as null for an assumed stage, so an
  assumption is never stored as a fact.

### Tests

Backend 650 → 669 (19 new, `AdviceNeverBlockedTests`). Mobile 17 → 22.
Admin Playwright 11/11. Each new guard was removed and the suite re-run:
four of the first versions of these tests did **not** fail without their
guard (a label-only check; rain that turned "water now" into "skip rain")
and were tightened until every one did.

### Not done here

The confidence badge in the apps' UI - the API carries it; showing it is
2c ("Why am I seeing this?") and 6 (Home cards).
