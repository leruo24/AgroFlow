# Plan — `feat/actionable`

Written after reading the code each item touches. Baseline (the contract) is
in `baseline.md`; progress is logged per item in `progress.md`.

---

## Pre-flight findings that change the plan

### 1. `docs/Fao56.pdf` in the repo is corrupt

Its linearization header says the file is **6,432,919 bytes**; the file is
**11,343,998**. The binary marker on line 2 is `EF BF BD` repeated — the UTF-8
replacement character. Someone copied the PDF through a text encoding, which
replaced every non-ASCII byte, and it was committed that way in `fa208e6`.
`pdftotext` and `pypdf` both refuse it.

An intact copy is in `C:\Users\leruo\Downloads\Fao56.pdf` — exactly
6,432,919 bytes, matching its own header. Every citation in this work is
taken from that copy, using the book's **printed** page numbers (the
convention `fao56-crop-knowledge.json` already uses). Verified against the
JSON's existing cites: Table 11 p.104 and Eqs 82/83 p.162 agree.

**Action:** restore the intact copy to `docs/Fao56.pdf` in pre-flight, and
add `.gitattributes` marking `*.pdf` (and other binaries) `binary` so it
cannot be text-converted again. This is a documentation file, not code; the
brief requires reading it, and the committed copy cannot be read.

Citations used throughout:

| Source | Printed page |
|---|---|
| Table 11 — stage lengths | 104–108 |
| Table 12 — Kc ini / mid / end | 110–114 |
| Table 19 — soil water characteristics | 144 |
| Table 22 — root depth, depletion fraction p | 163–165 |
| Eq. 58 — ETc = Kc × ETo | 103 |
| Eq. 66 — Kc between stages | 132 |
| Eq. 82 — TAW; Eq. 83 — RAW | 162 |
| p adjusted for ETc: p = pTable22 + 0.04(5 − ETc) | 162 |
| Eq. 84 — Ks | 169 |
| Eq. 85 — root-zone water balance | 170 |
| Chapter 8 — yield loss largest at flowering and yield formation | 176 |

### 2. Two advice engines exist

- `IrrigationAdvisor` (older) — used by the **schedule report** and the
  **forecast** endpoint. Returns `InsufficientData` → "No recommendation
  possible". By its own header it *never* fills a gap with a default.
- `Fao56Engine` + `ZoneInsightBuilder` (newer) — used by insights, the mobile
  app and the designed water-usage reports. Already has 19 insight types with
  named thresholds and FAO-56 sources.

Item 2 explicitly reverses the old engine's "never default" rule. That is a
**recorded design change**, not a bug fix: defaults are allowed only when
labelled, sourced, and paired with a confidence level and the step that
removes them.

### 3. The RuleBook must not be a second engine

The brief's `RuleBook/` classes are a readable layer **over** the existing
engine, which already holds the values. Duplicating the agronomy would create
two sources of truth that drift — exactly what "nothing is duplicated" forbids.
Each RuleBook method either wraps an existing calculation in
`SoilWaterBalance` / `Fao56EngineReference` or adds a rule that does not exist
yet. The engine then calls the RuleBook, not the other way round.

### 4. A conflict in the brief, and how it is resolved

Item 5 and the definition of done say **no endpoint may set someone else as
handler**. But `PUT /api/admin/requests/{id}/assign` is a baseline route and
takes the assignee from the request body. Keeping it unchanged would keep the
hole.

Resolution: the route **stays** (nothing 404s), but it accepts only the
caller's own id or `null` (release). Any other profile id returns **403** with
a plain message. Its only client is the admin console, which this work moves
to the new claim routes anyway. This tightens a check; it does not weaken one,
and it is not a device endpoint — so it is not a stop condition.

### 5. Item 1 is a problem statement, not a task

Its fixes are items 2 and 3. Each symptom in it maps to an acceptance
criterion below.

### 6. No test tooling exists in either app

Playwright (admin) is installed in item 0b, which requires it. jest +
`@testing-library/react-native` (mobile) is installed in item 0b too, for the
fast-tap guards. Both are the dev-dependencies the brief allows.

---

## Migrations

Numbered after the highest existing file (0038). None applied. Each gets a
probe in `docs/verify-migrations.sql` **and** in `Services/SchemaCheck.cs`.

| # | Item | Objects |
|---|---|---|
| 0039 | 5 | `handled_by_profile_id`, `claimed_at`, `resolved_by_profile_id`, `resolved_at` on `service_request`, `alert`, `maintenance`; `actor_role` on `admin_audit_log` |
| 0040 | 6 | `soil_feel_check` table (zone, feel, actor, at); `irrigation_event.logged_by_profile_id` |
| 0041 | 4 | `report_schedule`: `daily` frequency, `day_of_week`, `per_zone_pdf`, `send_to_handler`, `admin_chat_enabled`, `turned_off_by`, `next_send_at`; per-zone rows allowed |
| 0042 | 6c | `enquiry`, `enquiry_call` tables |

`ai_recommendation.data` (jsonb, 0027) already exists — explanations are stored
inside it under `explanation`, no migration. `irrigation_event.trigger_source`
already allows `'manual'` — "I watered" needs no schema change.

---

## Items

Each item: files, migrations, API, risks, **acceptance criteria**.

### 0b — Admin navigation goes haywire on fast clicks

**Causes found by reading the code** (to be confirmed by a failing test first):

1. **Every sidebar click navigates twice.** `initNav`'s click handler calls
   `go()` directly; `go()` then writes `location.hash` (router.ts:127), which
   fires `hashchange`, whose listener calls `go()` again.
2. **No navigation token.** `go()` awaits the page loader and then
   `swapContent`'s own 140 ms wait. A slower, older navigation finishes after a
   newer one, renders over it, **and writes its own hash back** — which fires
   `hashchange` for the stale page, which navigates again. That ping-pong is
   the "cycles through several tabs before settling".
3. **Every Supabase auth event rebuilds the whole shell.** `onAuthChange` →
   `render("signed-in")` tears down `#root` and re-runs `bootRouter()`.
   supabase-js re-emits `SIGNED_IN` when the tab regains focus and
   `TOKEN_REFRESHED` periodically, and item 2 of the last pass made
   `refreshAdminProfile()` notify too — so saving your own name rebuilds the
   entire console.
4. `go()` still calls `renderSettingsTab("General")`, a tab that no longer
   exists (falls back, but it is a leftover).

**Files:** `app/router.ts`, `main.ts`, `lib/animate.ts`, `app/auth.ts`,
`services/agroFlowApi.ts` + `data/api.ts` (abort signal on GETs),
`ui/patterns.ts` (`withErrorState` ignores aborts), `styles/main.css`.
Mobile: shared `useSingleFlight` hook; buttons on submit screens.

**Fix:** one `hashchange` listener (already guarded) is the **only** thing that
calls `go()`; nav clicks only set the hash; clicking the current route does
nothing. A navigation token drops stale results; an `AbortController` per
navigation cancels stale **GET** fetches (writes are never aborted — an
in-flight save must not be lost to a click). Rendering never writes the hash;
redirects use `history.replaceState`. The shell is rebuilt only when the view
state actually changes. In-page tabs use the same latest-wins token.
`scrollbar-gutter: stable` on the scroll container; skeleton sized to the page.

**Risk:** aborting a fetch that a page's own `try/catch` turns into an error
modal. Mitigation: an aborted GET never settles (the stale render is simply
abandoned) — no error, no modal, no console noise. Background polling (health)
opts out.

**Acceptance criteria:**
- [ ] A Playwright test with a mocked API (random 50–600 ms delays) clicks 5–10
      sidebar items within 1 s; the final page **and** `location.hash` equal the
      last click; zero console errors; no DOM change after settling for 1.5 s.
- [ ] The same test for Settings tabs and for opening detail panels.
- [ ] Double-clicking every primary button sends exactly one request.
- [ ] Each sidebar click calls `go()` exactly once (instrumented in the test).
- [ ] A token refresh while signed in does **not** rebuild the shell.
- [ ] Mobile: rapid taps on tabs, "Make me this report", "Save" and wizard
      submits produce one navigation / one request (jest).
- [ ] The root cause is written up in `progress.md` and the final report.

### 2 — Advice is never blocked

**Files:** `AgroFlow.Domain/Agronomy/Fao56Engine.cs`, new
`Agronomy/RuleBook/ConfidenceRules.cs` and `CropRules.cs` (created here,
completed in 2b), `ZoneInsightBuilder.cs`, `IrrigationAdvisor.cs` (schedule
report path), `Endpoints/ReportEndpoints.cs` (the 24 h reading gate),
`Endpoints/Fao56EngineEndpoints.cs` (insights response gains optional
`confidence`, `nextStep`).

**Design:**
- No planting date → run the balance with **Kc mid from Table 12 (p.110)**
  and stage "assumed peak growth". *DATA RULE:* mid-season Kc is the highest
  value for every crop in Table 12, so it errs toward enough water rather than
  too little. Labelled every time it is used.
- No area → water need as **minutes per m²** and mm: 1 mm over 1 m² is 1 L,
  so minutes/m² = depletion_mm ÷ flow_Lpm.
- No calibration → weather-and-crop balance (Eq. 85, p.170); the reading is
  shown as "sensor reading (not yet set up)", never a percentage.
- Old or no reading → weather-only balance, "Based on the weather (your kit
  hasn't sent data since 17 Sep)". The report's 24 h gate stops blocking
  advice and instead lowers confidence.
- Confidence **High / Medium / Low** + one-line reason; **one** next setup
  step per zone, chosen by a fixed priority order.

**API:** `GET /api/farmer/zones/{id}/insights` gains optional `confidence`
and `nextStep`. Old fields unchanged.

**Risk:** changes engine output for zones that today get "no advice". That is
the point, but every number must still trace to Table 12 or the balance.

**Acceptance criteria:**
- [ ] Crop + weather only (no planting date, area, calibration or readings)
      produces a watering recommendation, not "no recommendation", labelled
      Medium or Low with the right single next step.
- [ ] Full setup with a fresh calibrated reading → High.
- [ ] No area + a flow rate → advice in minutes per m² and mm.
- [ ] An uncalibrated reading is never rendered with a `%`.
- [ ] A reading older than 24 h lowers confidence; it does not block advice.
- [ ] "No recommendation possible" no longer appears in any report.
- [ ] Every default is labelled where it is shown.

### 2b — The rule book

**Files:** `AgroFlow.Domain/Agronomy/RuleBook/{Soil,Crop,Water,Verdict,
Confidence,Kit}Rules.cs`, `ZoneInsightBuilder.cs` (calls rules in a fixed,
commented order), `docs/rule-book.md` (generated by a test-time generator so
it cannot drift from the code).

**Design:** each method is pure (no DB/HTTP), has every threshold as a named
constant with its reason, and a doc comment citing the printed FAO-56 page or
`// DATA RULE: <reason>`. Values are read from the existing
`Fao56EngineReference` / `fao56-crop-knowledge.json`, never re-typed.

**Acceptance criteria:**
- [ ] Every method listed in the brief exists, is pure, and cites a printed
      page or carries a `DATA RULE`.
- [ ] No threshold is a magic number; each is a named constant with a reason.
- [ ] No crop or soil value is duplicated (a test asserts the RuleBook's
      values equal the reference table's).
- [ ] `ZoneInsightBuilder` calls the rules in a documented order.
- [ ] `docs/rule-book.md` has a decision table per rule, including the brief's
      soil × stage × RAW × rain table, plus "Needs another source".
- [ ] A table-driven test per rule, including boundaries (exactly at RAW, rain
      exactly equal to need, ratio exactly 1.2).

### 2c — "Why am I seeing this?"

**Files:** `RuleBook/Explanation.cs`; every RuleBook decision returns one;
`ZoneInsight.Explanation`, persisted in `ai_recommendation.data.explanation`;
insights endpoint returns it (optional); `Services/Notifications/
TelegramPollingService.cs` + `TelegramClient.cs` (`allowed_updates` gains
`callback_query`, inline button, `/why <id>`); mobile `WhySheet` component;
admin side-panel "Why"; PDF "Why:" lines + appendix entries; Excel "Why"
column.

**Risk:** the Telegram callback must answer only the chat that owns the
insight. The button carries the `ai_recommendation` id only; the handler
checks that chat → profile → farm → zone.

**Acceptance criteria:**
- [ ] Every insight type produces a non-empty explanation whose facts match
      the inputs (test per type).
- [ ] No jargon tokens (`ETc`, `ETo`, `Eq.`, `Tmin`, `Kc`, `RAW`, `TAW`,
      `moisture_threshold`, ISO timestamps) in summary/facts/rule (scanned).
- [ ] Mobile: a "Why am I seeing this?" link under each action card, insight,
      alert, settings card and confidence badge opens a bottom sheet (jest).
- [ ] Admin: the same on insights, alerts, Needs-attention cards, KPI tiles,
      verdicts (Playwright); admins also see `technical`.
- [ ] PDF: a grey "Why:" line under each action and verdict, numbered to an
      appendix entry.
- [ ] Telegram: a "Why: …" line and a "Why am I seeing this?" button; the
      callback answers only the owning chat; `/why <id>` works (tests).
- [ ] Excel: a "Why" column beside each advice row.

### 3 — Reports rebuilt around actions

**Files:** `Reports/*` (new `ActionReport` section builders reused by all three
types), `Endpoints/ReportEndpoints.cs` (moisture and schedule move onto the
shared model), `ReportShell.cs`, `ChartSvg.cs` (weekly bars, day-card row).

**Design:** order — This week, do this → How your farm did → three
question-charts → Area vs at your plants (only days with tub data) → Improve
your advice → Technical appendix (all jargon lives only here). Period wording
from the real period length. Shared notes printed once at farm level. Tables
never split a row; headers repeat.

**Acceptance criteria:**
- [ ] Page 1 opens with "This week, do this": 1–5 actions, each with when, how
      much, a confidence badge and a "Why:" line.
- [ ] No "this week" in a 30-day report (test across 7/14/30-day periods).
- [ ] Periods over 14 days chart weekly, not daily.
- [ ] The weather comparison is omitted when there is no tub data, replaced by
      one sentence.
- [ ] No ISO timestamps; no jargon outside the appendix (scanned test over the
      rendered farmer text).
- [ ] No sentence repeated across zones.
- [ ] Single-zone fits 2 pages + appendix; all-zones adds ~1 page per zone.
- [ ] Sample PDFs and Excel (single + all zones × full setup, partial, no kit)
      in `docs/sample-reports/`.

### 4 — Admin Reports page, and automatic reports

**Files:** `pages/analytics.ts` (reports page), `app/interactions.ts`,
`Endpoints/ReportScheduleEndpoints.cs`, `Services/AutoReportSchedulerService.cs`,
`Services/ReportGenerationService.cs`, migration **0041**.

**Acceptance criteria:**
- [ ] The generic report cards with no backing data are gone; no tile shows 0
      or "No data" because a feature is missing.
- [ ] "Farm reports" leads: farm → zone/all → period → type, with Preview,
      PDF and Excel; most recent farm pre-filled.
- [ ] "Farms needing attention this week", built from the same insights,
      each row clickable.
- [ ] The comparison report is kept only if it yields real numbers (it does —
      it reads irrigation events; verified) or removed.
- [ ] Schedules: Daily 07:00, Weekly (chosen day) 07:00, Monthly 1st 07:00,
      Off; whole farm or chosen zones; per-zone PDFs or one all-zones PDF;
      recipients; Send test now (admin's own Telegram only); Last / Next sent;
      turning off records who.
- [ ] Each schedule fires once per period per zone; Off never fires (tests).
- [ ] A failed send retries once, then raises an admin alert.
- [ ] Existing `report_schedule` rows keep working unchanged.

### 5 — Accountability

**Files:** migration **0039**; new `Endpoints/HandlingEndpoints.cs`
(claim / take-over / release / action, shared by requests, alerts,
maintenance); `AdminRequestEndpoints.cs` (`/assign` tightened, see finding 4);
admin `pages/requests.ts`, `pages/operations.ts`, `app/interactions.ts`;
`data/api.ts` (alerts and maintenance become real writes via the API).

**Acceptance criteria:**
- [ ] No "Assign to {someone}" picker anywhere.
- [ ] "I'll handle this" records the JWT actor and `claimed_at`; shows "Being
      handled by {name} since {time}".
- [ ] "Take over" requires a reason and records both names.
- [ ] Every action records the JWT actor, time and optional note, in the item
      timeline and `admin_audit_log`; final state "Resolved by {name} on
      {date}".
- [ ] There is no endpoint that sets another person as handler — including the
      tightened `/assign` (test sends another profile id → 403).
- [ ] A body field naming an actor is ignored (test).
- [ ] Activity and timelines show the chain; exportable to Excel.

### 6 — Practical with little setup

**Files:** admin register-farm wizard (`app/interactions.ts`,
`pages/onboarding.ts`), `Endpoints/FarmEndpoints.cs` (register writes soil,
area, depth, flow, planting date); mobile `zone/[id].tsx` + new
`zone-setup.tsx` checklist; new `Endpoints/ManualLogEndpoints.cs`
(`POST /api/farmer/zones/{id}/manual-watering`, `.../soil-feel`); engine reads
manual entries; migration **0040**; mobile Home cards.

**Acceptance criteria:**
- [ ] The wizard requires soil type per zone (three cards, default Loam, "Not
      sure? Pick Loam"); area presets + custom m²; optional planting date with
      "about how many weeks ago?"; all five fields reach the zone row.
- [ ] Mobile "Finish setup" checklist, including the 500 mL bottle helper
      (L/min = 0.5 ÷ seconds × 60), each step updating the confidence badge.
- [ ] "I watered" adds to the water balance, flagged manual.
- [ ] "How does the soil feel?" — Dry ≈ at/past RAW, Wet ≈ field capacity —
      nudges the balance, labelled manual and lower confidence.
- [ ] Both appear in reports and history.
- [ ] Mobile Home: one card per zone with today's single action, a confidence
      badge and a one-tap "I watered".
- [ ] Admin farm/zone pages show the same action, confidence and next step.

### 6b — Recommended settings; the farmer can change the crop

**Files:** `RuleBook/RecommendationRules.cs`; new
`GET /api/farmer/zones/{id}/recommended-settings` and admin equivalent;
`PUT /api/farmer/zones/{id}/crop` (new — the existing `/settings` route is
untouched); mobile zone settings; admin zone page and wizard; audit with
`actor_role = 'farm_user'`.

**Acceptance criteria:**
- [ ] The card's numbers equal the RuleBook calculation for fixed inputs
      (potato, loam, 0.2 m², 1.5 L/min, ETo 5 mm/day) — test.
- [ ] Threshold % = (1 − p × soil factor) × 100; interval = RAW ÷ ETc;
      minutes = RAW × area ÷ flow; "about", whole minutes and days.
- [ ] Missing inputs use the item 2 defaults with a confidence badge.
- [ ] Farmer changes crop/planting date on their own zone → zone updated,
      audit entry "Crop changed from Citrus to Potato by {name}", card shown.
- [ ] Changing another farmer's zone → 403 (test).
- [ ] Past reports keep the old crop for past days.

### 6c — Requests and the public enquiry flow

**Files:** admin `pages/requests.ts`; landing `pages/welcome.ts`; mobile
`login.tsx`; new `Endpoints/EnquiryEndpoints.cs`
(`POST /api/public/enquiries`, admin list / claim / log-call / anonymise /
start-onboarding); migration **0042**; enquiry report (PDF + Excel) on the
shared shell.

**Acceptance criteria:**
- [ ] Requests: [I'll handle this] → [Mark complete] (optional note); saving a
      wizard launched from a request completes it; actor recorded each step.
- [ ] The list shows email when there is no name; Request type is clear; no
      "New farm request" in the Farm column; no horizontal scroll at 1366 px.
- [ ] Public form with every field in the brief and the POPIA consent; server
      validation; per-IP rate limit; honeypot rejected.
- [ ] Admin Telegram notified on a new enquiry.
- [ ] Enquiries tab with badge; claim → log call → outcome; Not interested
      requires a reason (and text for Other); No answer counts attempts and
      suggests closing after 3; Call back later raises a Home reminder when due.
- [ ] Wants AgroFlow → onboarding prefilled; finishing it links the farmer and
      completes the enquiry.
- [ ] Anonymise removes name/phone/email, keeps province/crops/outcome/reason;
      audit-logged.
- [ ] Enquiry report counts match the data (test).

---

## Part 2

On `test/full-proof`, after Part 1 is merged. Rule-book table tests; the
adversarial sweep; admin coherence review; firmware review (compile only if
`arduino-cli` exists); evidence in `docs/test-evidence/`.

---

## Order of work

0b → 2 → 2b → 2c → 3 → 4 → 5 → 6 → 6b → 6c, then land, then Part 2.

Item 2 creates `RuleBook/` with only the rules it needs (confidence, the Kc
fallback); 2b completes it. Same order as the brief, without building the
confidence logic twice.
