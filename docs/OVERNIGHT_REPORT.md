# Overnight report — 20 September 2026

Written for Leruo. Everything below is on `dev`, pushed.

**Read these four things first, then the rest at your leisure:**

1. **`docs/Fao56.pdf` in this repo is destroyed** and cannot be recovered. I used FAO's own published PDF instead. → [§0](#0-the-pdf-is-corrupt)
2. **Nine commits, all pushed to `dev`.** Backend builds clean, 221 unit tests pass, mobile and admin typecheck, admin builds. → [§1](#1-commits)
3. **Four migration files are waiting for you** (`0016`–`0019`). None were run. → [§6](#6-migrations-awaiting-your-sql-editor)
4. **Seven decisions I need from you.** → [§9](#9-decisions-i-need-from-you)

I did not touch any of Phili's files, did not run the backend, did not touch the live database, did not flash anything, and did not print or rotate a secret. `hardware/.../secrets.h` is untouched and still gitignored. I grepped every staged diff before every push.

`docs/tasks/LERUO_NEXT.md` does not exist — not in the working tree, not in git history on any branch. I used `docs/ORIENTATION.md` for context instead. If LERUO_NEXT was meant to carry constraints beyond the prompt, I never saw them.

---

## 0. The PDF is corrupt

`docs/Fao56.pdf` cannot be opened. Not "needs a password" — destroyed.

```
total size:                11,343,998 bytes
U+FFFD replacement chars:   2,466,553 occurrences (7,399,659 bytes)
```

Roughly **2.47 million distinct byte positions have lost their original values.** The file was at some point round-tripped through a lossy UTF-8 decode (`errors='replace'`), which rewrote every byte sequence that was not valid UTF-8 as `EF BF BD`. That includes the PDF's binary marker line, every FlateDecode stream, and the encryption dictionary's `/O` and `/U` strings — which is why `pdftotext` reports "Invalid encryption key length / Incorrect password" rather than a password prompt. There is nothing to decrypt; the key material itself is gone.

It was committed already corrupt (`fa208e6`, "Add orientation and status docs") — there is no earlier, intact blob in history. Same size, same hash, one commit only. No recovery path exists locally.

**What I did instead.** The brief's requirement was "do not use values from memory", and its intent was that every value be verifiable against the textbook. I downloaded the full published FAO Irrigation and Drainage Paper 56 PDF and extracted from that. It is the same document, same edition (Allen, Pereira, Raes & Smith, 1998, ISBN 92-5-104219-5), so every citation in the knowledge file — table number *and* printed page number — checks out against any copy you open, including the one in your hand. I have flagged this rather than quietly substituting, because you asked me to.

**Extraction method matters here.** Naive text extraction gets Tables 11 and 12 *wrong* — `pdftotext -layout` mis-associates continuation rows with the wrong crop, because those tables have unlabelled continuation rows and a ragged right-hand region column. Reading it that way, "Citrus" appears to have four stage-length rows and Tomato's regions shift by one. I reconstructed every row from **word x/y coordinates** (pdfplumber) instead and spot-checked against the naive extraction to find exactly where they disagreed. Every value in the knowledge file came from the coordinate reconstruction.

**Action for you:** replace `docs/Fao56.pdf` with a clean copy when you get a moment. Nothing depends on it — the values are extracted and committed — but the next person who tries to open it will hit the same wall.

---

## 1. Commits

All on `dev`, oldest first.

| Hash | Subject |
|---|---|
| `8b3dcf9` | feat(agronomy): extract FAO-56 crop knowledge base with per-value citations |
| `0ae4774` | feat(agronomy): ET0, growth-stage engine and FAO-56 advice, with 144 tests |
| `506b7cd` | feat(db): migration files 0016-0019 |
| `4a4155b` | fix(api): don't auto-start a pump on a zone set to manual |
| `ed19073` | fix(api): reject negative and absurd irrigation-event values with 400 |
| `ba8ea67` | fix(api): replay pending irrigation commands on startup, reconnect and a timer |
| `db04988` | feat(api): collect daily weather from Open-Meteo into weather_daily |
| `1b29f5f` | feat(firmware,api): HTTPS to the deployed API, and a real command-ACK endpoint |
| `43af262` | feat(api,db): per-zone water estimates and a per-zone-per-day usage view |

### Verification (all green, final run)

| Check | Result |
|---|---|
| `dotnet build AgroFlow.Domain` | Build succeeded, 0 warnings, 0 errors |
| `dotnet build AgroFlow.Api` | Build succeeded, 0 warnings, 0 errors |
| `dotnet test AgroFlow.Domain.Tests` | **221 passed, 0 failed, 0 skipped** |
| `tsc --noEmit` (mobile) | exit 0 |
| `tsc --noEmit` (admin) | exit 0 |
| admin production build | exit 0, built in 2.75s |

One gotcha: **`npx` is currently broken in this repo.** Your uncommitted `apps/web/admin/package.json` change adds `"npm": "^12.0.2"` and `"run": "^2.1.4"` as dependencies — the signature of a stray `npm install npm run build`. That local `npm` package shadows `npx`, so `npx tsc --noEmit` prints npm notices and exits 0 **without running tsc**. I caught it and ran `./node_modules/.bin/tsc` directly instead; the exit codes above are from the real tsc. Those two dependencies are your uncommitted work, not mine, so I left them alone — but you almost certainly want to remove them.

### New test project

`backend/AgroFlow.Domain.Tests` (xUnit, net8.0). There was nowhere to put a unit test before. It references `AgroFlow.Domain` only — the computational work all lives in the domain layer precisely so it can be tested without a database, a broker or a network. Run it with:

```powershell
cd backend/AgroFlow.Domain.Tests; dotnet test
```

---

## 2. The FAO-56 knowledge base

**`backend/AgroFlow.Domain/Agronomy/fao56-crop-knowledge.json`** — committed, human-readable, and **every single numeric value carries a `cite` field naming the FAO-56 table and the book's printed page number.** Open the book at that page and the number is there. It ships as an embedded resource so the values travel inside the assembly and a deployment can never run with the file missing.

### Stage lengths — Table 11

Every published row for each crop is recorded verbatim under `allPublishedRows`; exactly one is marked `"selected": true`. Table 11 gives several rows per crop (one per planting date and region) and a daily engine needs one. Selection preferred, in order: a **Mediterranean** row (Western Cape is a Mediterranean climate), then arid/semi-arid, then the first row listed.

| Crop | L_ini | L_dev | L_mid | L_late | Total | Selected row | Page |
|---|---|---|---|---|---|---|---|
| maize | 30 | 40 | 50 | 30 | 150 | April, Spain (spr, sum.); Calif. | 106 |
| potato | 30 | 35 | 50 | 25 | 140 | Dec, Calif. Desert, USA | 105 |
| tomato | 30 | 40 | 45 | 30 | 145 | April/May, Mediterranean | 104 |
| dry beans | 20 | 30 | 40 | 20 | 110 | May/June, Continental Climates | 105 |
| leafy veg (lettuce) | 20 | 30 | 15 | 10 | 75 | April, Mediterranean | 104 |
| citrus | 60 | 90 | 120 | 95 | 365 | Jan, Mediterranean | 107 |

Two rows worth knowing about:

- **Potato's `(Semi)Arid Climate` row is the closest climate match but I did not select it.** Table 11 prints its mid-season length as `30/45` and its total as `115/130` — two alternatives, and picking a half would be my judgement, not a tabulated value. It is recorded with `"ambiguous": true` and an explanation. I selected the unambiguous Calif. Desert row instead.
- **Dry beans has no good row.** FAO-56 publishes only Continental Climates, Pakistan/Calif. and Idaho — no Mediterranean, arid or semi-arid row at all. It fell through to "first listed". Flagged in the file. This crop's stage lengths are the weakest-matched of the six.

Changing a selection is a one-line JSON edit — no code change. The selected row's plant date and region are surfaced to the farmer, so the assumption is visible rather than hidden.

### Crop coefficients — Table 12

| Crop | Kc_ini | Kc_mid | Kc_end | Max height (m) | Page |
|---|---|---|---|---|---|
| maize | 0.30 † | 1.20 | 0.60 (alt. 0.35) | 2.0 | 111 |
| potato | 0.50 † | 1.15 | 0.75 (alt. 0.40) | 0.6 | 110 |
| tomato | 0.60 † | 1.15 | **0.80 ‡** | 0.6 | 110 |
| dry beans | 0.40 | 1.15 | 0.35 | 0.4 | 111 |
| leafy veg (lettuce) | 0.70 † | 1.00 | 0.95 | 0.3 | 110 |
| citrus | 0.70 | **0.65** | 0.70 | 4.0 | 113 |

**† Table 12 prints Kc_ini once per crop GROUP and omits it on every crop row that shares the group value.** Maize's own row shows only Kc_mid, Kc_end and height — its 0.30 comes from the `i. Cereals` group row. Same for potato (`d. Roots and Tubers`, 0.50), tomato (`b. Solanaceae`, 0.60) and lettuce (`a. Small Vegetables`, 0.70). Each of those four says so explicitly in its `cite`. This is the single easiest thing to get wrong when reading Table 12 and it is worth checking me on.

**‡ Tomato's Kc_end is the one derived number in the whole file.** FAO-56 prints a bare range, `0.70-0.90`, with no interpretive footnote (unlike maize and potato, whose footnotes explain what each alternative means). I used the midpoint 0.80 for computation, recorded `valueMin`/`valueMax`/`isMidpointOfPublishedRange: true`, **and the advice output tells the farmer out loud whenever a tomato zone is in late season** that this number is a midpoint of a published range rather than a tabulated value. I did not want a derived figure passing as a cited one anywhere.

**Citrus Kc_mid (0.65) is LOWER than Kc_ini (0.70).** This is correct, not a transcription error. FAO-56 Table 12 footnote 21 (p. 113): *"The midseason value is lower than initial and ending values due to the effects of stomatal closure during periods of peak ET."* The interpolation therefore runs **downward** through development and back **up** through late season for citrus. There is a dedicated test for this and the advice output carries the explanation, so nobody files it as a bug.

Alternative Kc_end values, where FAO-56 gives them with a footnote explaining the management choice:
- **maize** — 0.60 for harvest at high grain moisture, 0.35 after complete field drying (fn 11, p. 111). 0.60 is the default: it is the irrigated-to-harvest case, which is what an irrigation controller is for.
- **potato** — 0.75 default, ~0.40 for long-season potatoes with vine kill (fn 4, p. 110).

### Rooting depth and depletion fraction — Table 22

| Crop | Zr min (m) | Zr max (m) | p | Page |
|---|---|---|---|---|
| maize | 1.0 | 1.7 | 0.55 | 164 |
| potato | 0.4 | 0.6 | 0.35 | 163 |
| tomato | 0.7 | 1.5 | 0.40 | 163 |
| dry beans | 0.6 | 0.9 | 0.45 | 164 |
| leafy veg (lettuce) | 0.3 | 0.5 | 0.30 | 163 |
| citrus (70% canopy) | 1.2 | 1.5 | 0.50 | 165 |

### Values that are genuinely NOT in the tables

You asked me to say so rather than invent or substitute. Three things:

1. **"Leafy veg" is not an FAO-56 category.** FAO-56 has no such crop. I mapped it to **Lettuce** and recorded, with citations, how the near neighbours differ: Spinach shares Lettuce's Kc (1.00/0.95) and root depth (0.3–0.5 m) but has **p = 0.20, not 0.30**; Cabbage has Kc_mid 1.05, Zr 0.5–0.8 m and **p = 0.45**. If a farmer's "leafy veg" zone is really spinach, this mapping *overstates* how much drying it tolerates. See [decision 2](#9-decisions-i-need-from-you).

2. **Citrus is not one crop in FAO-56 — it is six.** With or without active ground cover, each at 70%/50%/20% canopy, with different Kc triplets. I defaulted to *no ground cover, 70% canopy* (mature, clean-floor commercial orchard) and recorded all six variants' values in the file so a farm with a different orchard floor can be switched without touching code.

3. **FAO-56 does NOT contain per-crop stage sensitivity to water stress.** This is the one part of brief item 3e I could not deliver as asked, and I want to be direct about it rather than bury it. You asked for "which stages are most sensitive to water stress for that crop". FAO-56 does not publish that for any crop. It belongs to **FAO Irrigation and Drainage Paper 33** (Doorenbos & Kassam, *Yield response to water*) and its successor Paper 66, via the yield response factor **Ky** — and FAO-56 mentions Ky *only* in its symbol table and never tabulates it. I grepped the full text to confirm.

   So I left that specific claim out entirely, per your instruction, and recorded the absence under `notInFao56` in the JSON. What I built instead is described in [§4](#4-what-actually-makes-the-advice-feel-intelligent) and **is** textbook-supported. If you want real per-crop stage sensitivity, we need FAO-33 — that is [decision 1](#9-decisions-i-need-from-you).

---

## 3. ET0 — verified against the textbook

`backend/AgroFlow.Domain/Agronomy/ReferenceEvapotranspiration.cs`.

**Hargreaves–Samani (Eq. 52), not Penman–Monteith — and the older notes are wrong to say otherwise.** Penman–Monteith (Eq. 6) needs solar radiation, wind speed and vapour pressure. There is no pyranometer and no anemometer on any node, and no wind at all in the weather rows, so Eq. 6 cannot be evaluated from measured inputs — only from estimates of its own inputs. FAO-56 p. 64 offers Eq. 52 explicitly for exactly this case: *"when solar radiation data, relative humidity data and/or wind speed data are missing"*. FAO-56's own caveat travels with the code: Eq. 52 *"has a tendency to underpredict under high wind conditions (u2 > 3 m/s) and to overpredict under conditions of high relative humidity"*.

### The worked example you asked for

**FAO-56 Example 8, p. 47** — extraterrestrial radiation for 3 September at 20°S. I checked **every intermediate**, not just the final answer, so a regression points at the equation that broke rather than just "the number moved":

| Quantity | FAO-56 Example 8 | Computed | Δ |
|---|---|---|---|
| φ (latitude, rad) | −0.35 | −0.3491 | 0.0009 |
| J (day of year) | 246 | 246 | exact |
| d_r (Eq. 23) | 0.985 | 0.9848 | 0.0002 |
| δ (declination, Eq. 24) | 0.120 | 0.1197 | 0.0003 |
| ω_s (sunset hour angle, Eq. 25) | 1.527 | 1.5270 | 0.0000 |
| **R_a (Eq. 21)** | **32.2 MJ m⁻² d⁻¹** | **32.194** | **0.006** |
| **R_a as evaporation (Eq. 20)** | **13.1 mm/day** | **13.135** | **0.035** |

Every deviation is within the rounding of the book's own printed precision. 20°S is also conveniently close to our latitudes.

**FAO-56 publishes no worked example for Eq. 52 itself** — it gives the equation on p. 64 and moves on. There is no book figure to match, so I did not manufacture one. The Hargreaves tests instead pin the equation **term by term** on top of that verified R_a, plus behavioural checks: a wider diurnal range must raise ET0 (the `(Tmax−Tmin)^0.5` term is a cloudiness proxy), equal Tmin/Tmax gives exactly zero, Tmax < Tmin throws rather than taking a root of a negative, extreme cold is floored at zero rather than returning negative evapotranspiration, and the polar-circle case clamps instead of returning NaN.

---

## 4. What actually makes the advice feel intelligent

This is the part I would most like you to sanity-check, because it is where I made judgement calls about what FAO-56 does and does not license us to say.

Since FAO-56 gives no per-crop stage sensitivity, the engine leans on three things it *does* give, all cited:

1. **The depletion fraction p tightens as ETc rises.** FAO-56 p. 162: `p = p_Table22 + 0.04 (5 − ETc)`, bounded to 0.1 ≤ p ≤ 0.8. This is the genuinely weather-aware, crop-specific, fully-sourced claim that replaces the FAO-33 material. On a hot day the same soil moisture reading is *more* urgent than it would be in mild weather, and we can say exactly why and cite it. In the potato sample below, p goes from 0.35 to **0.22** because ETc is 8.2 mm/day.

2. **Kc_end encodes a management choice, so "should I dry this down?" is answerable from the table.** FAO-56 p. 97: Kc_end *"reflects crop and water management practices... high if the crop is frequently irrigated until harvested fresh... small if the crop is allowed to senesce and dry out in the field before harvest."* So:
   - maize (Kc_end 0.60, alt. 0.35) and dry beans (0.35) → the engine surfaces the dry-down option with FAO-56's own footnote text.
   - lettuce (Kc_end 0.95, against Kc_mid 1.00) → the engine says dry-down is **not** appropriate, because on FAO-56's own reading a Kc_end that close to Kc_mid is the signature of a crop watered right through to harvest.

3. **Approaching-transition warnings** are arithmetic off the table, not a claim: "Entering mid-season in about 5 days — Kc reaches its maximum 1.20 there, roughly 42% above today's Kc of 0.84."

### One honest limitation, stated in the output itself

FAO-56's p is a fraction of *plant-available water*, which needs the soil's field capacity and wilting point (Table 19) to turn into a moisture percentage — and **AgroFlow does not record soil texture per zone.** So p is reported as context and **is never the trigger**. The trigger stays the farmer's configured `zone.moisture_threshold`. The engine says this in its own limitations list rather than implying more precision than we have. See [decision 3](#9-decisions-i-need-from-you).

### It is not an LLM, and the tests prove it

No API key, no subscription, no vendor. `IrrigationAdvisor.Advise()` is a deterministic function of sensor readings, weather rows and the committed JSON — same inputs, same words, every time, asserted by a test. MafiHub owns it outright.

---

## 5. Sample advice output — all six crops

Generated from fabricated inputs (Cape Town latitude −33.9, 20 January 2026). **This is the agronomy for you to check.**

```
North Field (maize). Mid-season, day 111 of ~150 (9 day(s) left in this stage).
  Kc 1.20, ETc 8.0 mm/day. Soil moisture 26%, below the 30% threshold.
  Irrigate today; 8 mm forecast Friday may cover the next cycle.

River Block (potato). Mid-season, day 70 of ~140 (45 day(s) left in this stage).
  Kc 1.15, ETc 8.2 mm/day. Soil moisture 22%, below the 28% threshold. Irrigate today.

Tunnel 3 (tomato). Mid-season, day 85 of ~145 (30 day(s) left in this stage).
  Kc 1.15, ETc 6.7 mm/day. Soil moisture 34%, at or above the 30% threshold.
  No irrigation needed today.

Orchard South (citrus). Mid-season, day 200 of ~365 (70 day(s) left in this stage).
  Kc 0.65, ETc 3.8 mm/day. Soil moisture 19%, below the 25% threshold. Irrigate today.

Salad Beds (leafy veg (lettuce)). Mid-season, day 55 of ~75 (10 day(s) left in this stage).
  Kc 1.00, ETc 4.8 mm/day. Soil moisture 41%, at or above the 35% threshold.
  No irrigation needed today.

Dryland 2 (dry beans). Late season, day 95 of ~110 (15 day(s) left in this stage).
  Kc 0.95, ETc 6.4 mm/day. Soil moisture 24%, below the 30% threshold. Irrigate today.
```

### One zone in full, so you can see the traceability

Every number carries its provenance. This is `River Block`, potato, day 70:

```
SUMMARY
  River Block (potato). Mid-season, day 70 of ~140 (45 day(s) left in this stage).
  Kc 1.15, ETc 8.2 mm/day. Soil moisture 22%, below the 28% threshold. Irrigate today.

REASONING
  - Soil moisture 22% is below the 28% threshold set for this zone, so the crop needs water.

NUMBERS AND WHERE THEY CAME FROM
  - Soil moisture: 22%
      source: latest SoilMoisture sensor reading for this zone
  - Moisture threshold: 28%
      source: zone.moisture_threshold, configured by the farmer
  - Growth stage: Mid-season, day 70 of 140
      source: FAO-56 Table 11, p. 105 (row: planted Dec, Calif. Desert, USA)
  - Kc today: 1.15
      source: Kc is constant at Kc_mid = 1.15 through mid-season (FAO-56 Table 12, p. 110).
  - ET0: 7.1 mm/day
      source: FAO-56 Eq. 52 (Hargreaves) from Tmin 15.0 C / Tmax 33.0 C on 2026-01-20
              (actuals row), latitude -33.900
  - ETc: 8.2 mm/day
      source: ETc = Kc x ET0 = 1.15 x 7.1 (FAO-56 Eq. 58)

FAO-56 STAGE INSIGHTS
  - Water demand is at its peak for the season: FAO-56 notes that "at the mid-season
    stage the Kc reaches its maximum value" (FAO-56 p. 96). Kc will not go higher than
    1.15 for this crop.
  - FAO-56 gives this crop a soil-water depletion fraction p = 0.35 - the share of
    plant-available water it can lose before it starts suffering stress (FAO-56
    Table 22, p. 163), at a reference ETc of about 5 mm/day. At today's ETc of
    8.2 mm/day that tightens to p = 0.22 (FAO-56 p. 162: p = p_Table22 + 0.04 (5 - ETc)),
    so in this heat the crop tolerates LESS drying than the table alone suggests.

LIMITATIONS
  - FAO-56's depletion limit p is a fraction of plant-available water, which needs the
    soil's field capacity and wilting point (FAO-56 Table 19) to convert into a moisture
    percentage. AgroFlow does not record soil texture per zone, so p is reported as
    context only - the irrigation trigger remains the farmer's configured moisture
    threshold.
```

### The degraded case — null planting date (brief item 3c)

Does not guess, does not fail:

```
SUMMARY
  North Field (maize). stage-aware guidance unavailable. Soil moisture 26%,
  below the 30% threshold. Irrigate today.

LIMITATIONS
  - Stage-aware guidance needs a planting date, and this zone does not have one.
    Advice below is moisture-threshold only. Set the zone's planting date to get
    growth stage, Kc and ETc.
```

The same degradation happens, with its own explanation, for an unknown crop, a missing weather row, missing farm coordinates and a missing moisture reading. An unknown crop resolves to **null** rather than borrowing another crop's Kc curve — `Grapes`, `Wheat` and `Apples` from the admin crop list all do this, with a test asserting it.

### Test coverage for the agronomy (brief item 3f)

- Stage and Kc at multiple days-after-planting for all six crops, **including exactly on every stage boundary** and one day past season end.
- Interpolation correctness mid-development, checked at 5 points across maize's development stage and against citrus's *inverted* curve.
- A monotonicity test that walks **every day of every crop's whole season** and asserts Kc never jumps more than the largest single-day step the table implies — this is what catches an off-by-one in a stage boundary, which shows up as a discontinuity rather than a wrong single value.
- Kc never leaves the range the tables define, for every day of every season.
- Null planting date, unknown crop, no weather, no coordinates, no moisture — all degrade gracefully.
- Determinism.

---

## 6. Migrations awaiting your SQL editor

**None of these were run. Nothing touched the live database.** All four are idempotent and safe to re-run. Paste in order.

| File | What it does |
|---|---|
| `0016_weather_daily.sql` | New `weather_daily` table + RLS |
| `0017_zone_planting_date.sql` | `zone.planting_date date` (nullable) |
| `0018_zone_flow_rate.sql` | `zone.flow_rate_lpm real` + `zone_water_usage_daily` view |
| `0019_irrigation_commands_pending_index.sql` | Partial index for the replay sweep |

Notes worth reading before you paste:

- **`0016` creates a NEW table rather than extending `weather`.** `weather` (from 0003) is a point-in-time observation table from the C# class diagram — temperature/humidity/pressure/wind_speed/recorded_at, no notion of a day and no notion of a forecast. What ET0 needs is one row per farm per *day* with tmin/tmax/rainfall, where a forecast row is later overwritten by actuals. Bolting that onto `weather` leaves a table that is two things at once with half its columns null in each mode. **`weather` is left completely untouched.**
- **`0016`'s foreign key is `references farm (farm_id)`, not `farm (id)`.** `farm`'s primary key is `farm_id` — easy to get wrong because `zone`, `sensor_reading` and `irrigation_event` all key on `id`.
- **`0016` grants no client write.** RLS matches 0011 exactly: `ENABLE` not `FORCE`, SELECT for `authenticated` via `app_can_access_farm(farm_id)`, blanket admin policy. The collector writes as `postgres` and bypasses policies.
- **`0017` is nullable on purpose**, so it is a zero-coordination, zero-downtime add. Every existing zone gets NULL and the advisor degrades gracefully (§5). Each zone starts producing stage-aware advice the moment someone fills it in.
- **`0018`'s view uses `security_invoker = true`** — same treatment 0011 gave the `zone_*` views. Without it a farmer could read every farm's water usage through the view, around `irrigation_event`'s RLS.

After `0016` is applied, the weather collector starts populating on its own within 6 hours of the next deploy. The **backfill is a separate, manual trigger** — see §8.

---

## 7. The three backend bugs

Each is its own commit with tests proving the fix.

### 7a. `SensorReadingProcessor.cs:40` — auto-irrigation ignored `irrigation_mode` — `4a4155b`

It never read `zone.irrigation_mode` at all. A farmer who deliberately set a zone to Manual could still have the pump started under them by an incoming sensor reading — a physical action on their field that they had explicitly opted out of.

The gate is now a pure domain rule, `IrrigationMode.AllowsAutoCommands()`, consulted **before** any command decision. It **fails closed**: only `'automatic'` is permissive. `null`, empty, unknown text, and any value added to 0010's check constraint later all return false, because the safe default when the mode is not understood is to leave the pump alone.

**I also blocked `'scheduled'`, and you should agree or overrule me.** In scheduled mode the pg_cron job `fire_due_irrigation_schedules()` (migration 0010) owns the decision. If the moisture path also fired, the two would fight — an off-schedule auto `'start'` would then cause the *real* scheduled `'start'` to be suppressed by the processor's own "same as last command" de-dup. That is [decision 4](#9-decisions-i-need-from-you).

Health status is still written for manual and scheduled zones — observing a zone is always allowed. Only the command is suppressed. `irrigation_mode` is read directly off `zone`, because 0010's `zone_latest_reading` view does not carry the column and widening it would mean another migration for no gain.

### 7b. `IrrigationCommandNotifyService.cs:53` — commands stuck pending forever — `ba8ea67`

A command reached a device exactly once, at insert time, via the NOTIFY. If the API or MQTT was down at that instant it went nowhere and the row sat at `'pending'` forever with nothing to retry it. You were right that this matters more now: it was tolerable on a laptop during a demo, not on a Railway container that restarts on every deploy.

Three triggers now feed one sweep:
- **MQTT connect**, including the first one. `MqttConnectionService` exposes `Connected` (raised only *after* the subscription is in place, so a handler that publishes immediately is not racing a half-ready connection) and `IsConnected`.
- **A periodic timer**, `Irrigation:ReplaySweepIntervalSeconds`, default 120s — deliberately independent of the LISTEN loop, so a wedged LISTEN connection cannot also stop replay.
- **Startup**, which falls out of the first MQTT connect.

A `SemaphoreSlim` with a zero timeout means concurrent triggers **skip rather than queue** — a container restart fires the first two within a second of each other.

**The part I want you to review: stale commands are EXPIRED, not replayed.** A pending `'start'` is an instruction to open a valve. Replaying one queued three days ago because a deploy restarted the container would irrigate a field for reasons nobody watching could explain — possibly at night, possibly after rain, possibly on a crop since harvested. `CommandReplayPolicy` replays anything **up to 2 hours old** and marks the rest `'failed'` (already in 0004's check constraint, so no schema change). A farmer who wants water now can ask again; a farmer who gets an unexplained midnight flood cannot un-flood the field. The 2-hour window is [decision 5](#9-decisions-i-need-from-you).

**Honest scope note:** the *decision* (replay vs expire, window edges, clock skew) is unit-tested — 14 tests. The *plumbing* (LISTEN, the reconnect hook, the timer) needs a live Postgres and a live broker and is **not** unit-tested. I am not going to imply the whole fix is covered when it isn't. It is worth watching the Railway logs after the next deploy: you should see `Replay (MQTT connected): N pending irrigation command(s) found`.

### 7c. `IrrigationEventEndpoints.cs:38` — negative values corrupted zone totals — `ed19073`

The endpoint increments `zone.water_used_total` by whatever `estimatedLitres` arrives, but validated only zoneId/triggerSource/syncStatus. A negative value was accepted and **silently subtracted** from the running total. Nothing recomputes that total from the event rows, so the corruption never healed.

This is a device-facing endpoint and the device buffers events to flash while offline and replays them later, so a garbled buffer or a half-written flash record is a realistic source of nonsense, not a hypothetical one.

Now rejected with **400 and a reason naming the field**:
- negative `runtimeSeconds` or `estimatedLitres`
- **NaN or Infinity litres** — NaN slips past `< 0` because *every* comparison with NaN is false, and would poison `water_used_total` permanently since `NaN + anything` stays NaN
- runtime beyond **6 hours** (inclusive bound, so a long but legitimate flood-irrigation run still passes)
- litres > 0 with runtime 0
- an implied delivery rate above **1000 L/min**, meaning runtime and litres disagree so neither is trustworthy

Validation runs before a connection or transaction is opened. 28 tests.

**Not fixed, and you should know:** any `water_used_total` already corrupted by this bug stays corrupted. The fix stops new corruption; it does not repair history. Recomputing the totals from `irrigation_event` is a data-repair job against the live database, which I was not to touch — see [decision 6](#9-decisions-i-need-from-you).

---

## 8. Weather collection

`WeatherCollectionService` (`db04988`), a hosted service alongside the MQTT and LISTEN ones. Every `Weather:FetchIntervalHours` (default 6) it walks every farm and fetches yesterday's actuals plus today and seven forecast days.

**Open-Meteo is free and keyless and I kept it that way** — no account, no key to rotate, no per-call cost, nothing extra to configure on Railway. A test asserts the URL carries no `key`, `apikey` or `token` parameter, so a future "upgrade" to a keyed provider trips a test rather than quietly adding a secret.

Failure posture, as asked:
- **Coordinate-less farms are skipped and logged ONCE per process**, not every six hours. (A `HashSet` of already-warned farm ids. Logging the same warning every cycle is how everyone learns to ignore the logs.)
- **Per-farm failures log and continue.** One farm's bad coordinate or one timeout does not stop the others. Nothing here can take the host down — the host is also the MQTT bridge and the irrigation command path.
- Rows with no usable temperature pair are dropped rather than stored as holes that look like data.

**The upsert guard is the bit worth a look.** An incoming *actual* always wins, but an incoming *forecast* may only overwrite another forecast:

```sql
on conflict (farm_id, date) do update set ...
where excluded.is_forecast = false or weather_daily.is_forecast = true
```

Without that `WHERE`, a cycle running just after midnight could replace yesterday's real observations with a model value and quietly degrade the history the advice engine reads.

**The backfill is written and NOT run**, exactly as instructed. `WeatherBackfillService` is registered as a plain singleton — **not** an `IHostedService` — and is called from nowhere. It uses Open-Meteo's archive (ERA5) endpoint, chunks by year, clamps to the ~5-day reanalysis lag, continues past a failed chunk, and paces itself at 1 req/s out of courtesy to a service that costs us nothing. Its file header carries the steps to trigger it once `0016` exists. **Do not run it before `0016` is applied** — there is no table to write to.

Response parsing lives in the domain as a pure function, so the column-oriented parallel-array format is tested offline with no network: index alignment, nulls vs zeroes, an entirely absent variable, ragged arrays, unparseable dates, Open-Meteo's own error shape, and invariant coordinate formatting (a comma-decimal server locale would otherwise split the query string).

---

## 9. Decisions I need from you

Listed roughly by how much they affect the product.

**1. Do we want FAO-33 for real stage-sensitivity guidance?**
FAO-56 does not have it (§2). The engine is genuinely good without it — the ETc-adjusted depletion fraction is a real, citable, crop- and weather-specific stress limit — but "flowering is the most sensitive stage for maize" is the kind of sentence that makes a farmer trust the app, and I could not write it from FAO-56. Getting it means sourcing FAO-33/66 and extending the knowledge file the same way. Say the word and it is a contained piece of work.

**2. Should "leafy veg" be split into real crops?**
Lettuce, spinach and cabbage have materially different depletion fractions (0.30 / 0.20 / 0.45). A spinach zone advised as lettuce is told it tolerates 50% more drying than it does. Related: **the admin dashboard's crop list does not match these six at all.** `apps/web/admin/src/data/referenceData.ts` offers Maize, Grapes, Citrus, Wheat, Potatoes, Apples — so Grapes, Wheat and Apples get no stage-aware advice (they resolve to null and degrade, correctly), and tomato, leafy veg and dry beans cannot be selected in the admin UI at all. Reconciling the two lists is a product decision, not a code fix, and the file is adjacent to Phili's work.

**3. Do we want to capture soil texture per zone?**
It is the difference between "p = 0.35, for context" and a real mm-of-depletion irrigation trigger. FAO-56 Table 19 gives field capacity and wilting point by texture class, so one nullable `zone.soil_texture` column plus a small lookup would turn the advice from threshold-based into genuinely FAO-56-based. Not in scope tonight; flagging it because it is the single highest-value follow-up.

**4. Should `'scheduled'` zones block moisture-triggered auto commands?** (§7a)
I blocked them and explained the reasoning. If you'd rather scheduled zones *also* respond to a dry sensor, it is a one-line change in `IrrigationMode.AllowsAutoCommands` plus a test.
Related: **`zone.automation_enabled` also exists and I did NOT gate on it.** You asked specifically for `irrigation_mode`, so I stayed in scope. Gating on both is arguably more correct — your call.

**5. Is a 2-hour command replay window right?** (§7b)
It covers a deploy, a restart or a broker blip, and stops well short of "the situation has changed". One constant in `CommandReplayPolicy.MaxReplayAge`.

**6. Repairing already-corrupted `water_used_total` values.** (§7c)
Needs a one-off UPDATE recomputing each zone's total from `irrigation_event` — a live-database write, so it is yours. I can write the SQL as a migration file if you want it.

**7. The `planting_date` UI field is Phili's lane and I did not touch it.**
Migration `0017` adds the column; nothing captures it. It belongs in the farmer-onboarding / zone-setup flow (`apps/web/admin` onboarding, `FarmerOnboardingEndpoints.cs`) — both on your do-not-touch list. **Until someone adds that field, every zone has `planting_date = NULL` and the entire stage-aware engine degrades to moisture-only.** The engine is done; it is waiting on one input. This needs coordinating with her, not doing behind her back. It is the single thing standing between what I built tonight and a farmer seeing it.

---

## 10. Admin persist-vs-stub audit — report only, nothing changed

Investigation only, as instructed. **I changed nothing in `apps/web/admin`, nothing in `FarmerOnboardingEndpoints.cs` or `DeviceEnrollmentEndpoints.cs`, and nothing in Phili's rollback helpers.** Everything below is from reading code and migrations.

Phili is right on both counts, and here is the exact picture.

### 10a. Every admin mutation, and whether it persists

`api.ts`'s own header is accurate: mutations update a module-level in-memory working copy (`let users`, `let farms`, `let hardware`, ...) seeded from real rows, and return it. **Nothing below writes to Postgres.** Refresh the page and every one of them is gone.

| Admin action | `api.ts` function | Persists? | Why not |
|---|---|---|---|
| Disable/enable user | `setUserStatus` | ❌ | **Missing column.** `profile` has no `disabled`/`status` column. `getUsers()` hardcodes `status: "Active"` for every real account — there is currently no way to represent Disabled or Pending for a real user at all. |
| Edit user details | `updateUser` | ❌ | **Missing grant.** 0011+0012 grant `UPDATE (name, phone)` on `profile` to `authenticated`, but the policy scopes it to the *owning* user. An admin cannot write another user's profile row. |
| Delete user | `deleteUser` | ❌ | **Missing grant + missing policy.** No DELETE grant or policy on `profile` in any migration. See 10b. |
| Reset password | `resetPassword` | ❌ | **Pure stub.** Returns `undefined`. Would need Supabase Admin Auth via service_role, i.e. a new API endpoint. |
| Approve farm | `approveFarm` | ❌ | **Missing grant.** No UPDATE grant/policy on `farm` for `authenticated`. |
| Set farm status | `setFarmStatus` | ❌ | Same as above. |
| **Register farm** (`add-farm` drawer) | *none* | ❌ | **Pure toast stub.** The drawer has no write behind it at all — it opens, collects three fields, and shows a success toast. Nothing in the codebase creates a `farm` row from the admin UI. |
| Restart device | `restartDevice` | ❌ | **Pure stub + no mechanism.** Sets `status: "Online"` locally. There is no reboot command path to a device — MQTT carries irrigation commands only. |
| Remove device | `removeDevice` | ❌ | **Missing grant.** 0011 grants `SELECT` on `hardware` to `authenticated`, not DELETE. |
| Replace device | `replaceDevice` | ❌ | **Missing grant.** Also rewrites `device_id`, which is the efuse MAC and the MQTT topic key — a real implementation is an enrollment operation, not an UPDATE. |
| Set alert status | `setAlertStatus` | ❌ | **Deliberate deferral — this one COULD be real.** 0011 grants `SELECT, UPDATE` on `alert` to `authenticated` *and* there is an admin all-commands policy. Left on the working copy because nothing populates real `alert` rows yet. |
| Assign alert | `assignAlert` | ❌ | **Missing column.** `alert` has no assignee column. |
| Set alert priority | `setAlertPriority` | ❌ | Grant exists (as above); deferred. |
| Add alert note | `addAlertNote` | ❌ | **Missing table.** No notes table anywhere. |
| Assign technician | `assignTechnician` | ❌ | **Missing grant + column.** 0011 grants SELECT only on `maintenance`. |
| Complete maintenance | `completeMaintenance` | ❌ | Same. |
| Upload maintenance report | `uploadMaintenanceReport` | ❌ | **Missing table + no storage.** No report-file mechanism exists. |
| Schedule visit | `scheduleVisit` | ❌ | Missing grant. |
| Update schedule | `updateSchedule` | ❌ | **Missing table.** `irrigation_schedule` was dropped by 0010 — schedules are now columns on `zone`, one per zone, not a list. The whole Schedules page models a shape that no longer exists. |
| Delete schedule | `deleteSchedule` | ❌ | Same. |
| Onboard farmer (wizard) | `onboardFarmer` | ❌ | **Pure stub.** Fabricates `newFarmId = max(id)+1` and `id: "pending-${n}"`. Writes nothing. (Per ORIENTATION §9 — and this is Phili's active area.) |
| Create farmer (Users page) | `createFarmer` | ✅ **REAL** | POSTs `/api/farmers/create` → Supabase Admin Auth via service_role. |
| Invite farmer (Users page) | `inviteFarmer` | ✅ **REAL** | POSTs `/api/farmers/invite`. Delivery depends on project SMTP. |
| Log report generated | `logReportGenerated` | ❌ | **Pure stub**, and honest about it. |
| Platform Activity | `getActivity` | ❌ | **No table exists.** Returns an explicit not-implemented sentinel; the page shows a labelled placeholder. `recordActivity()` is an intentional no-op. |
| System Health | `getSystemHealth` | ❌ | **No table exists.** Same treatment. |

**Summary: 2 of 26 admin actions persist** — `createFarmer` and `inviteFarmer`, both of which go through `AgroFlow.Api` with the service role key.

Causes, tallied: **missing table** 5 · **missing column** 4 · **missing grant/policy** 10 · **pure toast stub** 5 · **deliberate deferral (grant exists)** 2.

The pattern is clear: the reads are real and the writes are not, and the dominant blocker is **table-level grants**, not policies. Worth saying explicitly because it is easy to assume RLS policies are the problem — they mostly aren't.

### 10b. The deletion root cause, read from the migrations

You suspected `service_role` has no DELETE on `farm`/`zone`/`farm_member`/`profile` in the live DB (42501), and that this is drift. **Confirmed, from the migration files alone:**

```
grep -rn -i "service_role" supabase/migrations/
→ NO MATCHES. The string service_role appears in NO migration file in this repo.
```

Here is the complete list of **every** `GRANT` and `REVOKE` in **every** migration:

```
0011:103-111  grant select [,update on alert] on 9 tables          to authenticated
0011:304      revoke update (id, email, role) on profile           from authenticated
0011:307      grant  update (name)            on profile           to authenticated
0012:12       revoke update                   on profile           from authenticated
0012:13       grant  update (name, phone)     on profile           to authenticated
0016:104      grant  select on weather_daily                        to authenticated   (mine, not yet run)
0018:76       grant  select on zone_water_usage_daily               to authenticated   (mine, not yet run)
```

**What the migrations therefore do NOT contain, anywhere:**
- No `GRANT` of any kind to `service_role`, on any table.
- No `REVOKE` of any kind from `service_role`, on any table.
- No `GRANT DELETE` to *anyone*, on any table.
- No `REVOKE DELETE` from anyone, on any table.
- No DELETE policy on `farm`, `zone`, `farm_member` or `profile`. In fact **0011 does not touch those four tables' RLS at all** — it enables RLS on nine *other* tables (`sensor_reading`, `irrigation_event`, `irrigation_commands`, `alert`, `hardware`, `weather`, `report`, `maintenance`, `ai_recommendation`). Those four tables' RLS predates every migration file and was set up by hand on the live database, exactly as ORIENTATION §6 says.

**So the live 42501 is drift by definition** — no migration in this repo produced the current privilege state on those four tables, in either direction. Nothing here granted DELETE and nothing here revoked it.

**Why the deletes hit the privilege system at all.** The rollback helpers call **PostgREST**, not Npgsql:

```
TryDeleteZonesAsync → DELETE {supabaseUrl}/rest/v1/zone?farm_id=eq.{farmId}
TryDeleteFarmAsync  → DELETE {supabaseUrl}/rest/v1/farm?farm_id=eq.{farmId}
```

with the service-role JWT. PostgREST does `SET ROLE service_role` for that request. **`service_role` bypasses RLS (it is `BYPASSRLS`) but it does NOT bypass table-level GRANTs.** So if `GRANT DELETE ON farm TO service_role` was never issued on this project, the delete fails with 42501 no matter how privileged the key is. Supabase's standard template does grant it, which is why this reads as drift rather than as a design choice — something removed it, or these tables were created in a way the default privileges never covered.

Both helpers also **swallow the failure**: they log a warning and return void. So a failed rollback leaves an orphaned `farm`/`zone` row behind and the caller never learns. That is why "deletion doesn't work" presents as silence rather than as an error.

**Two viable fixes, and both are yours to choose — I have implemented neither:**

- **(a) Grant it:** `grant delete on farm, zone, farm_member, profile to service_role;` in a migration. Smallest change, restores what the Supabase template intends. But it widens what any holder of the service role key can do.
- **(b) Route deletes through Npgsql instead of PostgREST.** `AgroFlow.Api` already holds a direct Postgres connection as `postgres`, which **owns** these tables and so bypasses both RLS and the grant problem entirely — it is how every other write in the API already works, and it is what ORIENTATION §5 describes. Architecturally more consistent, and no privilege widening.

I lean towards **(b)**, but it means editing `FarmerOnboardingEndpoints.cs` — Phili's file, her active work tonight. **So I stopped, as instructed.** This needs the two of you to agree before anyone writes it.

### 10c. Is the hardware wired to the DB?

Phili is right to be unsure, and the answer is genuinely mixed:

- **Sensor readings → DB: YES, real and working.** ESP32 → MQTT → `MqttConnectionService` → `SensorReadingProcessor` → `sensor_reading` + `zone.health_status`.
- **Irrigation commands → device: YES, real** — and now more reliable (§7b).
- **Irrigation events → DB: YES, real.** POST `/api/irrigation-events` → `irrigation_event` + `zone.water_used_total`.
- **Command acknowledgements → DB: NO, and never worked.** Fixed tonight (§11).
- **Admin hardware page → DB: READS yes, WRITES no.** Every button on that page is working-copy-only (10a).

So "the hardware is wired to the DB" is true for the ingestion path and false for every admin control surface. Both halves of Phili's impression are correct about different things.

---

## 11. Firmware — code only, nothing flashed

`1b29f5f`. **No board was flashed and no device was claimed.**

### The dead ACK path, and why it could never have worked

The sketch marked commands executed by PATCHing Supabase's REST API directly. That path was dead **twice over**:

1. `SUPABASE_URL` and `SUPABASE_ANON_KEY` were still `"YOUR_PROJECT_REF"` and `"YOUR_SUPABASE_ANON_KEY"` in the committed sketch.
2. **Even fully configured it would have been refused.** Migration 0011 turned RLS on for `irrigation_commands` and grants anon `SELECT` only — there is deliberately no UPDATE policy, because an anon write to that table drives a physical valve.

The consequence was not cosmetic: **acknowledgements never landed, so every executed command stayed `'pending'` forever** — and the manual-override cooldown in `SensorReadingProcessor` keys off `status = 'pending'`, so it treated every past manual command as still outstanding.

**New endpoint: `POST /api/devices/commands/{id}/executed`**, in its **own new file** `backend/AgroFlow.Api/Endpoints/DeviceCommandEndpoints.cs`. It did **not** need to go in `DeviceEnrollmentEndpoints.cs` and does not touch enrollment or claim, so I did not have to stop. X-Api-Key gated by the existing middleware (the path does not start with `/api/devices/enroll`), written via Npgsql as the table owner.

It **verifies the acknowledging device actually owns that command's zone** (via `irrigation_commands → zone → hardware`). X-Api-Key is shared by every board and proves only "a genuine AgroFlow device", so without that check any board could acknowledge any other board's commands — including marking a command executed that its zone never physically ran, which would suppress the replay sweep for irrigation that never happened. Unknown-device ACKs get 404 rather than 403, so a device cannot probe which command ids exist.

It is **idempotent**, and has to be: the firmware retries a failed ACK and the replay sweep can redeliver a command the device already ran. The first ACK wins and its `executed_at` is preserved — overwriting it with a retry's timestamp would misreport when the pump actually ran.

### HTTPS

You were right that this was going to break. `API_BASE_URL` is an `https://` Railway URL now, but three call sites — `claimDevice`, `checkFirmwareUpdate`, `postIrrigationEvent` — each constructed a plain `WiFiClient`, which cannot speak TLS. They now go through one `beginApiRequest()` helper using `WiFiClientSecure`.

`setInsecure()` for now, matching the existing MQTT approach, with an explicit TODO in the code. **Documented plainly because it matters:** the connection is encrypted but **unauthenticated**, so someone positioned on the network could impersonate the API host and feed the board forged firmware-update URLs. Fixing it means pinning the ISRG Root X1 certificate with `setCACert()`, and it should fix `mqttTlsClient` at the same time — they carry the same caveat.

The OTA download path keeps its plain-`WiFiClient` branch. That is correct and I left it: it is guarded by a `startsWith("https://")` check, because a firmware URL may legitimately be either.

### ⚠️ Action needed before you next build the firmware

`API_BASE_URL` moved into `secrets.h` / `secrets.example.h` — it changes per deployment, and the hardcoded LAN address is what made every network change a reflash.

**`secrets.h` is gitignored, so `git pull` will NOT update yours.** Your existing one will fail to compile with `"API_BASE_URL was not declared in this scope"`. Add this one line to it:

```c
const char *API_BASE_URL = "https://agroflow-production-998d.up.railway.app";
```

Your `API_KEY` and `MQTT_PASSWORD` are untouched. I deliberately did not edit your `secrets.h` — it holds real credentials and it is not mine to write to. Both the template and the sketch carry this instruction, and the build fails loudly rather than silently using a stale address.

**The Supabase constants are deleted from the sketch.** This board now holds no Supabase credential of any kind. Everything else is preserved: enrollment/claim, offline buffering, MQTT handling, OTA, the efuse-MAC device identity.

---

## 12. Water usage

`43af262`. **No flow meter exists anywhere in AgroFlow**, so every figure is an estimate and the code is built so a caller cannot accidentally render it as a measurement.

`WaterUsageEstimator.EstimateEventLitres()` returns a `WaterVolumeEstimate` carrying `IsEstimate` and a `Basis` string — there is deliberately **no overload returning a bare double**. An unconfigured zone returns **null**, not a guessed rate, exactly as an unset `moisture_threshold` never triggers a pump.

**Per-zone rate beats the firmware constant.** The sketch computes litres from `PUMP_FLOW_LPS`, one hardcoded constant compiled into every board (0.05 L/s, marked a placeholder in the sketch itself). `POST /api/irrigation-events` now prefers `zone.flow_rate_lpm` when it is set, so a zone whose emitters or line size differ can be corrected **server-side without reflashing anything**. When it is not set, the device's own estimate is used unchanged. The response echoes `EstimatedLitres`, `IsMeasured: false` and a `LitresBasis` string saying which of the two it came from.

**Daily aggregation:** new `zone_water_usage_daily` view (in `0018`). `zone.water_used_total` is a single number that only goes up — fine for "how much ever", useless for "how much last Tuesday", for week-on-week comparison, or for spotting the day a valve stuck open.

Two details worth reviewing:
- It groups on **`started_at`** (when irrigation actually ran), **not** insert time. Those differ by as much as the offline buffer holds: the ESP32 buffers to flash while offline and flushes on reconnect, so an event inserted this morning may belong to Sunday. That distinction is exactly what 0005's note about `started_at` was about.
- `security_invoker = true`, or a farmer could read every farm's water usage through the view.

The column is named `estimated_litres_total`, not `litres_total`, on purpose.

---

## 13. Skipped, or not done

| Item | Status | Why |
|---|---|---|
| Extract from `docs/Fao56.pdf` | **Substituted, disclosed** | File is destroyed (§0). Used FAO's published PDF; citations verify against any copy. |
| Per-crop stage sensitivity to water stress | **Left out** | Not in FAO-56 — it is FAO-33's Ky. Per your instruction not to invent. See decision 1. |
| `planting_date` UI field | **Not done — Phili's lane** | Migration only. Needs coordinating. Decision 7. |
| Admin persist/stub fixes | **Not done — report only** | As instructed. §10. |
| DELETE grant / Npgsql delete rewrite | **Not done — needs your decision** | Fix (b) requires editing `FarmerOnboardingEndpoints.cs`. I stopped. §10b. |
| Running the weather backfill | **Not done — as instructed** | `weather_daily` does not exist yet. §8. |
| Running any migration | **Not done — as instructed** | §6. |
| Repairing corrupted `water_used_total` | **Not done** | Live-database write. Decision 6. |
| Removing stray `npm`/`run` deps | **Not done** | Your uncommitted change, not mine to revert. §1. |
| Integration tests for replay plumbing | **Not done** | Needs live Postgres + broker. Policy is tested; plumbing isn't. §7b. |
| `zone.automation_enabled` gating | **Not done — out of scope** | You asked for `irrigation_mode`. Decision 4. |

Nothing hit the three-build-attempts limit. Every build and test run went green.

---

## 14. Where things are

```
backend/AgroFlow.Domain/Agronomy/
  fao56-crop-knowledge.json        ← the extracted textbook, cited per value
  Fao56Knowledge.cs                ← typed reader + crop-name resolution
  ReferenceEvapotranspiration.cs   ← Ra (Eq. 21-25), Hargreaves ET0 (Eq. 52)
  GrowthStageCalculator.cs         ← stage determination + Kc interpolation
  IrrigationAdvisor.cs             ← the advice engine
  WaterUsageEstimator.cs           ← litres, always labelled an estimate
  OpenMeteoDailyParser.cs          ← pure response parsing

backend/AgroFlow.Domain/
  IrrigationMode.cs                ← bug 7a
  IrrigationEventValidation.cs     ← bug 7c
  CommandReplayPolicy.cs           ← bug 7b

backend/AgroFlow.Api/Services/
  WeatherCollectionService.cs      ← hosted, every 6h
  WeatherBackfillService.cs        ← written, NOT wired, NOT run

backend/AgroFlow.Api/Endpoints/
  DeviceCommandEndpoints.cs        ← new ACK endpoint

backend/AgroFlow.Domain.Tests/     ← new xUnit project, 221 tests

supabase/migrations/
  0016_weather_daily.sql                          ← awaiting your SQL editor
  0017_zone_planting_date.sql                     ← awaiting your SQL editor
  0018_zone_flow_rate.sql                         ← awaiting your SQL editor
  0019_irrigation_commands_pending_index.sql      ← awaiting your SQL editor
```

Migration range used: **0016–0019**, as assigned. I did not create or touch 0014–0015.
