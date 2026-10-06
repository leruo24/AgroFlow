# Progress — `feat/actionable`

**Resuming? Read this file first.** The last row says where work stopped and
what is next.

| Item | Status | Commit | What's left | Next |
|---|---|---|---|---|
| pre-flight | done | 116f773 | — | 0b |
| 0b | done | 43a9ce0 | — | 2 |
| 2 | done | 68ce29d | Confidence badge in the apps' UI → 2c/6 | 2b |
| 2b | done | 6888586 | — | 2c |
| 2c | done | 70a1c31, d3040c3, 86ad320, 41d351e, 4342ef4 | Recommended-settings Why → 6b; alert priority bug → 5; fixed-date KPIs → 4 | 3 |
| 3 | done | 154025b | — | 4 |
| 4 | done | 74efb2d | Apply migration 0040 | 5 |
| 5 | done | 5e067d0 | Apply migration 0041 | 6 |
| 6 | done | 77b9533, be80a1a | Apply migration 0042 | 6b |
| 6b | done | (this commit) | Apply migration 0043 | 6c |

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

---

## 2b — The rule book

`backend/AgroFlow.Domain/Agronomy/RuleBook/`: `SoilRules`, `CropRules`,
`WaterRules`, `VerdictRules`, `ConfidenceRules`, `KitRules`. Every method is
pure, every threshold a named constant with its reason, and every method cites
a printed FAO-56 page or says `DATA RULE`. Pages were checked against
`docs/Fao56.pdf`, not memory: soil p-adjustment **p. 167**; "irrigate before or
at the moment RAW is depleted" and "net depth ≤ depletion" **p. 171**; Ks = 1
below RAW **p. 169**; sensitive stage **p. 176**, with mid-season defined on
**p. 96** and full cover at the start of flowering on **p. 95**.

- `ZoneInsightBuilder` now only words the answer; every decision is a rule
  call, in the numbered order written at the top of the file. All 669
  existing tests passed unchanged through the refactor.
- The data layer's kit decisions (stuck, DHT11 offline, pump ran with no
  change) moved into `KitRules`; `Fao56EngineXDB` reads rows and calls them.
- **One behaviour change, on purpose:** the schedule report's own threshold
  check said "below" (strict `<`) while the insights said "at or below"
  (`<=`), so at exactly the threshold the two disagreed. Both now use
  `WaterRules.AtOrBelowFarmerThreshold`.
- `water_now` with no zone size now uses the brief's own sentence: "For each
  square metre, run the pump about N minutes".
- `docs/rule-book.md` is **generated** by `RuleBookDocument.cs` from the
  rules themselves - every outcome and farmer sentence is computed, never
  typed - and a test fails if it drifts. Includes the brief's soil × stage ×
  RAW × rain table and "Needs another source".

### Tests

669 → 773: `RuleBookTests` (table-driven per rule, boundaries: exactly at RAW,
rain exactly equal to need, ratio exactly 1.2 and 0.8, 3 h / 6 h / 15%) and
`RuleBookDocumentTests`. Mutations checked: `>=` → `>` at RAW fails both the
rule test and the doc test; changing a constant fails the doc test.

### Known, not changed

`fao56-crop-knowledge.json` still exists beside `Fao56EngineReference.cs`
(pre-existing; maize and potato use a different Table 11 row there, explained
at the top of `Fao56EngineReference.cs`). No rule reads it. Merging them would
change the schedule report's FAO-56 notes for maize and potato; that is a
decision about which planting season to plan against, not a cleanup, so it is
stated in the rule book rather than done silently.

---

## 2c — "Why am I seeing this?"

Five commits (parts 1-5), each green on its own.

### What carries an explanation now

| Output | Where the explanation comes from | Shown in |
|---|---|---|
| Every insight type (19) | `RuleBook/Explanations.For` - from the same engine result, signals and recorded data the rule used; stored in `ai_recommendation.data.explanation` | mobile insights card, Drip, admin "Run advice" drawer, report previews, PDFs, workbooks |
| Confidence badge | `Explanations.Confidence` - the same setup state `ConfidenceRules` judged | mobile insights card (badge + the one "Improve your advice" step) |
| Alerts (critical, DHT11 callout) | `Explanations.CriticalAlert` / `DhtCallout`, saved in `explanation` keyed by `alert_id` | mobile Alerts, admin alert drawer |
| Telegram alerts (zone critical, weather, equipment) | `AlertExplanations` - quoting the configured thresholds | a "Why: ..." line, a "Why am I seeing this?" button, `/why <id>` |
| Report verdicts | `Explanations.Verdict` over `VerdictRules` | PDF "Why:" line + appendix, workbook "Why" column |
| Admin KPI tiles (42) and Needs-attention cards (7) | written beside each tile from the same filter that makes its number | admin side panel; admins also see the query/technical line |

`technical` (FAO-56 page and numbers, or the query behind a count) is shown
only to admins and in report appendices; the farmer endpoints strip it and
the app never renders it (tested).

### Telegram

Migration **0039** `explanation` (additive, RLS: farm members and admins may
read; only the API writes). The button carries `why:<id>` and nothing else.
A tap or `/why <id>` is answered only for a chat linked to someone on that
farm; an unknown id and someone else's id get the same refusal, so ids cannot
be probed. Mutation-checked: removing the farm check fails two tests.
`getUpdates` now asks for `callback_query`; the webhook route runs the same
handler. **If the deployment uses the webhook,** it was registered with
Telegram outside this repo - if that registration listed `allowed_updates`,
it needs `callback_query` added, or taps will not arrive (Telegram's default,
when none is listed, includes it).

### Found on the way, fixed here

- **A hidden rule in the PDFs:** both water-usage PDFs judged "about right"
  with their own 15% band, written only in the renderer. They now use
  `VerdictRules` (20%, documented). A week at 1.15x the need was "a surplus";
  it is now "about right" - deliberate, tested.
- **Item 2 leaks:** Telegram's zone-critical message, the critical alert text
  and the moisture PDF's min/max columns still printed a raw reading with a
  %. Now "soil sensor reading N".
- The admin "Zones missing setup" card said "the engine cannot advise" - no
  longer true after item 2.
- `CollectInsights` (moisture and legacy usage reports) had never passed
  explanations into its JSON - caught while wiring the admin preview.

### Found, NOT fixed here (belongs to a later item)

- **Admin alerts never reach "Critical"/"High" priority**: `getAlerts` sets
  every alert's priority to a hard-coded "Medium" (there is no priority
  column), so Home's "Open critical alerts" card can never appear and the
  Operations "Critical" tile is always 0. → item 5 (accountability touches
  alerts).
- "New Farms since 1 May" / "New Users since 1 June" count from fixed dates,
  and "Platform Availability" always shows 0 (nothing measures uptime). Their
  explanations now say exactly that. → item 4 (Reports page rebuilt).

### Not yet, by design

The "recommended settings" card does not exist until 6b; it gets its Why
link there.

### Tests

Backend 773 → 813 (`ExplanationTests` - every insight type, facts match
inputs, jargon scan, mutation-checked; `TelegramWhyTests`; `ReportWhyTests` -
the appendix page is counted, 4 pages vs 3 without). Mobile 22 → 31
(`whySheet.test.tsx`; RNTL 14 is async - `render`/`fireEvent` are awaited).
Admin Playwright 11 → 14 (`why.spec.ts`).

---

## 3 — Reports rebuilt around actions

All three farmer PDFs - water usage, soil moisture, watering schedule; one
zone or all zones - are now one report, `ActionReportPdf`, laid out from
words composed in `ActionReport.Compose`:

1. **This week, do this** - 1-5 actions, each with when and how much, a
   confidence badge and a grey "Why:" line ("Water Tub 1 today (Tue 10 Feb):
   about 39 minutes (about 58 L).").
2. **How your farm did {period}** - one row per zone with a verdict: Watered
   about right / Too much / Too little / Not enough data.
3. **Three questions** - "Did my crop get the water it needed?" (weekly bars
   past 14 days), "Was my soil in the healthy range?" (only when calibrated;
   otherwise one line saying why), "What's coming this week?" (seven day
   cards with an action each).
4. **Area weather vs at your plants** - only days the tub sensor reported;
   none -> one sentence.
5. **Improve your advice** - one step per zone, grouped so the same sentence
   is never printed per zone ("Tub 1, Tub 2 and Tub 3: Add the planting date").
6. **Technical appendix** on its own page - FAO-56 figures with printed page
   numbers, notes every zone shares printed once, assumptions, and the
   numbered "Why we said this" notes.

The moisture PDF is the action report for its zone; the schedule PDF is the
farm's action report over the last 7 days plus the coming week. The JSON
endpoints the apps read are unchanged.

### Found on the way

- The old `NeededVsGotNote` said "this week" whatever the period - the bug
  item 1 quotes. Gone with the old layout.
- I had written the ETo assumption from memory as "Penman-Monteith, falling
  back to Hargreaves (Eq. 6 p. 65)". Checked against the PDF and the code:
  Eq. 6 is on **p. 24**, and the resolver does not fall back to Hargreaves -
  it estimates radiation with Eq. 50 (p. 60) and humidity with Eq. 64
  (p. 124). Corrected before committing.
- An explanation printed "Watering level: 2000%". The zone's level is stored
  in its sensor's own units, so it never carries a % now.
- Two zones with the same reason printed the same "Why:" sentence. A shared
  reason is now one note; the second line reads "the same reason as note 1".

### Tests

813 -> 854 (`ActionReportTests`: actions have when/how much/badge/why; never
more than 5; rain -> skip with the rain in it; overwatering says by how much
and what to shorten to; period words for 7/14/30 days and past periods;
weekly past 14 days; weather section only with tub data; jargon/ISO scan over
every farmer sentence for full/partial/no-kit x 7/14/30 days x one/two zones
(mutation-checked); no sentence repeated across three zones; shared notes
once; length: one zone 3-4 pages = 2 farmer pages + appendix, about a page
per extra zone. `SampleReportsTests` renders every combination.)

Samples: `docs/sample-reports/` (27 files + README) - three setups x three
types x one/all zones, 30-day versions, workbooks. Checked by eye page by
page; the README says they are generated sample data.

---

## 4 — Admin Reports page, and automatic reports

### The Reports page

Before: ten generic report cards (Device Performance, Support Performance,
Hardware Downtime...). "Generate" only showed a message, and **every card's
Excel exported the same irrigation table whatever its name**. A "Platform
Availability" tile always read 0, and the growth charts always said "No data
in this range" because `getGrowth()` returned empty arrays. The comparison
offered "Device uptime" and "Alert volume" and showed water litres under
those names.

Now, in this order:
1. **Farm reports** - farm (the last one used, else the newest) → zone or all
   → period (7/14/30 days or dates) → report → Preview / PDF / Excel.
   Preview is the PDF itself in the page, so it cannot differ from the file.
2. **Farms needing attention this week** - grouped from the same stored
   advice the farmers see (short of water, over-watering, kit offline,
   pump ran with no effect, level too late, setup to finish); each line opens
   the farms and zones behind it, each with its "Why am I seeing this?".
3. **Automatic reports** for the chosen farm - what is set, last sent, next
   send, who turned it off - and the editor.
4. **Water use comparison** - kept, because it produces real numbers; the
   metric picker that relabelled water as other things is gone, and the
   default periods are the last two 30-day windows rather than fixed dates.
5. **Growth** - new farmers, farms and maintenance per month, counted from
   the records (also fixes the same empty charts on Home). Connectivity is
   not shown: no history of it exists.

### Automatic reports

Migration **0040** (renumbered from the plan's 0041 because it was written
first; the plan's table is updated): `daily` frequency, `day_of_week`,
`per_zone_pdf`, `send_to_handler`, `admin_chat_enabled`,
`turned_off_by`/`turned_off_at`. Every default is what a 0035 row already
meant, so existing schedules behave exactly as before. Until 0040 is applied
the new options are read as their defaults, shown disabled with the reason,
and refused on save with a plain message - nothing is silently dropped.

- **Daily** at 07:00: a one-page brief, "Today, do this", per zone.
- **Weekly** on a chosen day (default Monday, as before), covering the seven
  days before it. **Monthly** on the 1st.
- **Scope**: all zones or chosen ones; one all-zones PDF or one tailored PDF
  per zone. **Farm summary** = the farm's all-zones report (no new
  `report_request` type, so the 0034 check constraint is untouched).
- **Recipients**: the farmer; optionally the admin who set it up, and the
  admin group chat (`Telegram__AdminGroupChatId` - configuration only).
- **Send test now**: the schedule's reports for its current period, to the
  calling admin's own Telegram only, at most five PDFs.
- **Delivery**: a failed Telegram send is retried once, then raises an
  admin alert naming the report.
- The farmer's own "stop" now records that they did it.

### Tests

Backend 854 → 869 (`AutoReportScheduleTests`: daily once a day after 07:00;
a chosen weekday fires that day only, for the 7 days before; no day chosen =
exactly the old behaviour; Off never fires over a whole month for any
frequency; next send; per-zone vs all-zones requests, once per period per
zone; farm summary never duplicated; retry once then give up; recipients;
the daily brief is one page). Admin Playwright 14 → 17 (`reports.spec.ts`).

### Assumption to confirm

"The handling admin" is read as the admin who set the schedule up
(`report_schedule.created_by`): nothing else ties an admin to a farm yet.
Item 5 adds who handles requests and alerts, not farms.

---

## 5 — Accountability

### What was wrong (found, not assumed)

- Requests, alerts and maintenance each had an "Assign to {someone}" picker:
  the name on an item was whoever somebody else chose.
- **The console's alert and maintenance actions never reached the
  database.** Resolve, close, reopen, escalate, note, priority, assign
  technician, complete, schedule, "upload report", "replace hardware" - all
  changed an in-memory copy and showed a success message. A resolved alert
  was open again on reload.
- The technician pickers offered **four invented names** from
  `referenceData.TECHNICIANS`. "Schedule maintenance" created nothing.
- Every alert's priority was a hard-coded "Medium", so Home's "Open critical
  alerts" card could never appear (noted in 2c).

### What it is now

Migration **0041**: `handled_by_profile_id`, `claimed_at` on
`service_request`, `alert`, `maintenance`; `resolved_by_profile_id`,
`resolved_at`, `escalated_at` on `alert`; `completed_by_profile_id`,
`completed_at` on `maintenance`. Additive; `assigned_to_profile_id` stays
readable for history.

`/api/admin/handling/{requests|alerts|maintenance}/{id}/...`:
- **claim** ("I'll handle this") - the caller, atomically (two admins
  pressing at once cannot both win); **take-over** - needs a reason, records
  who had it and why; **release** - only by the handler.
- **action** - alerts: note, resolve, close, reopen, escalate; maintenance:
  note, schedule, complete; requests: note (status keeps its own route, which
  messages the farmer and already stamps who). Plus **create** a maintenance
  job, handled by whoever booked it.
- The actor is always the login's subject. No body has an actor field, and
  one sent is ignored (tested).
- Every step goes to `admin_audit_log` under the item's entity, which is the
  item's timeline; the timeline now shows a take-over's reason and who had it
  before, and notes. "Resolved by {name} on {date}" / "Completed by ...".
- The old `PUT /api/admin/requests/{id}/assign` stays (nothing 404s) but only
  accepts the caller's own id or null; anyone else's → **403** (tested,
  without touching a database).

Console: one "Handled by" cell everywhere - **I'll handle this**, **Let go**,
or **Take over** (reason required). Priority comes from the alert's severity.
The fake actions and the invented technician list are removed, not hidden.

### Tests

Backend 869 → 894 (`AccountabilityTests`: claim / take over / release rules,
reasons, fixed action lists with no "assign", `/assign` 403 for another id,
bodies cannot carry an actor). Admin Playwright 17 → 20
(`accountability.spec.ts`: no Assign anywhere; claim and resolve send no
actor; take-over sends the reason). One existing check updated: the alert
drawer's section is now "Timeline" (it reads the real audit trail) rather
than "History".

### Not changed here

The maintenance "Overdue / Upcoming / In progress" statuses and "Waiting for
user" have no column behind them (the table allows Pending / Scheduled /
Completed). Left for Part 2's admin coherence review rather than widened
silently.


## 6 — Onboarding that leads to good advice, and farms without a kit

### What was wrong (found, not assumed)

- Registering a farm asked for a zone's size in hectares and its crop - and
  nothing else. Soil, watered area and planting date were left empty, so every
  new zone started on assumed loam, no litres, and "peak growth assumed".
- A farm with no kit, or a kit that was offline, had no way to tell the app
  anything: no "I watered", no "the soil is dry". Advice was weather-only and
  said so.
- Home showed farm-wide tiles ("Avg soil moisture", "Irrigating: Unknown");
  the one thing a farmer opens the app for - what to do today, per zone - was
  three taps away on each zone page.

### What it is now

- **Register a farm / Onboard a farmer**: each zone row has soil as three
  cards with Loam already chosen ("Not sure? Pick Loam." - the engine assumes
  loam anyway, so the default is honest), a size preset (Small tub ~0.2 m²,
  Bed 1×2 m, Custom m²), hectares only for bigger plots, and an optional
  "planted about how many weeks ago?". The review step shows soil and
  planting. Both register routes write `soil_type`, `area_m2`,
  `planting_date` (and take `root_depth_limit_m`, `flow_rate_lpm`); all
  optional on the wire so older admin builds still work, checked by
  `ZoneSetupFields.Check` (400 with the zone's name).
- **Home (mobile)**: one card per zone from `GET /api/farmer/farms/{id}/today`
  - the one action (`TodayRules`, order in the rule book §8), a confidence
  badge with its Why, **I watered**, **How does the soil feel?**, and
  **Finish setup** when something is missing.
- **Finish setup (mobile, `/zone-setup`)**: planting (weeks ago), soil (the
  existing soil screen), size presets or m², flow rate with the 500 mL bottle
  helper (L/min = 0.5 ÷ seconds × 60), and the wet/dry sensor setup when there
  is a kit. Each saves on its own (`PUT /api/farmer/zones/{id}/setup`) and the
  confidence at the top is re-read, so the farmer sees it change.
- **I watered / soil feel**: `POST /api/farmer/zones/{id}/manual-watering`
  (minutes or litres, up to 7 days back) and `/soil-feel` (dry/moist/wet).
  Migration 0042 adds `irrigation_event.logged_by_profile_id` and
  `soil_feel_check`. The person is the login; no body carries an actor.
  Both writes go through the app's single-flight path, so a double tap logs
  once.
- **Engine**: a hand-logged watering counts in the balance (litres as given,
  else minutes × flow rate) and as a full watering; a soil check corrects the
  day's dryness - wet = field capacity, Dr 0 (FAO-56 p. 167), dry = at least
  RAW (p. 171), moist held at 25-75% of RAW (DATA RULE, listed under "Needs
  another source"). A check within 24 h is named in the confidence ("based on
  the weather and your own soil check") and never makes it High.
- **Reports and history** label hand entries: report day notes start
  "Watered by hand (logged)", and the app's History says "Watering logged by
  hand · Entered by hand", never a pump run.
- **Admin farm drawer**: the Zones table shows each zone's action, confidence
  (with Why) and next step - the same text the farmer sees.

Reads of 0042's columns go through `to_jsonb`, and the writes answer 409
"needs migration 0042" until it is applied - nothing breaks before then.

### Tests

Backend 894 → 922 (`ManualLoggingTests`: soil-feel boundaries, a dry check
means water and a wet one does not, latest check of the day wins, fresh check
named in confidence and never High, rain beats watering, plain one-sentence
text, entry checks, registration field checks, report labels). Removing the
engine's soil-check step fails three of them. Mobile jest 31 → 39 (bottle
and weeks arithmetic, history lines, Today card actions). Admin Playwright
20 → 22 (`setup.spec.ts`: farm drawer columns; the wizard's soil cards,
required size, custom m² box, review and the POSTed zone). The custom-size
box was found always visible (`.drawer-field` overrode `hidden`) by that
spec and fixed.

### Not changed here

- The older "Onboard a Farmer" page uses the same zone row and checks, but
  only the Register-a-farm wizard has a browser test.
- Root depth is never guessed: the wizard asks for the soil depth in cm as an
  optional field (tubs and raised beds) and leaves it empty otherwise, since
  no source gives a tub's usable depth. Flow rate is optional there too - the
  app's bottle helper measures it on site. (Follow-up be80a1a: both fields
  were missing from the first item 6 commit; the zone page also gained a
  "Finish setup" row.)


## 6b — Recommended settings, and the farmer changes the crop

### What it is now

- **"Recommended for you"** (`RecommendationRules`, rule book §9): one
  sentence from the farm's climate, the crop and the soil - "Based on your
  climate in Mafikeng and since you want to grow potato on loam soil, we
  recommend: water when the soil reaches about 65% (relative), stop at 100%;
  expect to water about every 2–3 days in October, about 3 minutes each time
  for a 0.2 m² tub." With a confidence badge.
  - Water at = (1 − p × soil factor) × 100 - the same number "Reset to
    recommended" saves (tested equal for all three soils), so **Use these
    settings** is that existing route and the card can never disagree with
    what is saved. It needs the wet/dry setup (thresholds are in the
    sensor's units); without it the button is off and says so.
  - How often = RAW ÷ ETc; how long = RAW × area ÷ flow; RAW is the daily
    balance's own, root depth capped by the tub depth.
  - Climate: the last 30 days of measured ETo when there are at least 14,
    else the forecast, else what history there is. With no weather (a farm
    being registered) RAW uses Table 22's own basis, ETc ≈ 5 mm/day
    (footnote, p. 163), and the card says how often will follow.
- **Where**: mobile Finish setup and the new Crop screen; admin farm drawer
  → zone → **Recommended settings** (Use these settings / Keep my own);
  the register wizard shows it per zone once a crop is chosen
  (`POST /api/admin/recommended-settings/preview`). The wizard's card is
  information only - there is no sensor to save to yet - and says where to
  apply it later.
- **The farmer changes the crop**: mobile Zone → **Crop and planting date**
  (crop list as in admin; a built-in day/week stepper for the date - no
  date-picker package, as no production dependency may be added).
  `PUT /api/farmer/zones/{id}/crop` updates the shared zone row, so the admin
  sees it at once; writes `zone.crop_changed` to `admin_audit_log` with
  `actorRole` in the details, read on the Activity page and timelines as
  "Crop changed from Citrus to Potato by {name}"; returns the new card.
  Another farmer's zone → **403**, a missing zone → 404.
- **Past reports keep the old crop**: a report reads the zone's crop changes
  and uses the crop (and planting date) in effect on its last day.
- **Migration 0043** adds a trigger so a farmer's own login can change only
  crop, planting date, soil and size on a zone directly; the API (no JWT) and
  admins are unaffected, and neither app writes zones directly. Thresholds
  therefore only change through the API.

### Decision

The crop-change record went into `admin_audit_log` (with `actorRole`), not a
new `zone_change_log`: it is already append-only, already read by the
Activity page and the per-item timelines, and a second log would split one
history in two.

### Tests

Backend 922 → 935 (`RecommendationTests`: the card's numbers equal the rule
calculation for potato/loam/0.2 m²/1.5 L/min/ETo 5; threshold equals what
Reset saves; tub depth cap; known stage; missing inputs and confidence;
climate source; crop-change checks; crop history for past reports; the
Activity sentence; 403 for another farmer's zone). The 403 is tested on the
route's decision function: the ownership lookup itself needs a database.
The trigger cannot be tested without a database - it is probed in
`verify-migrations.sql` and `SchemaCheck`. Mobile jest 39 → 44, admin
Playwright 22 → 25 (`recommend.spec.ts`).

### Not changed here

- The existing `PUT /settings` route still accepts a crop (baseline
  contract) and does not write the crop-change record; the app's own crop
  screen uses the new route.
