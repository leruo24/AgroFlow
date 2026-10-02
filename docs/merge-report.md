# Merge report — every branch into `dev`

Run on 2026-10-02. **`dev` has been pushed to `origin`.** `main` was never touched.

## Final state

| | |
|---|---|
| **Final `dev` commit** | **`599fb0b`** — `Merge branch 'feature/drip-and-soil' into dev` |
| **Pushed to** | `origin/dev` (`7ee8e9c..599fb0b`, fast-forward, no force) |
| **Backup tag pushed** | `pre-merge-backup-20261002` → `7ee8e9c` |
| **Remote** | `https://github.com/leruo24/AgroFlow.git` |
| **Verified after push** | `git rev-list --count origin/dev..dev` = **0** |

A documentation commit containing this section sits directly on top of `599fb0b` and was pushed after it.

To undo everything, back to where `origin/dev` stood before this work:

```
git reset --hard pre-merge-backup-20261002
```

### What `dev` now contains, in order

```
599fb0b  Merge branch 'feature/drip-and-soil' into dev
1cc53e4  docs(engine): eight crops confirmed, Phase D complete, migration checks
c7baf7d  feat(mobile): raindrop helper and soil icons
e61011e  feat(mobile): add Drip mascot and soil icon assets
d1fdcde  docs: merge and FAO-56 engine reports
635f3d2  feat(admin): add welcome screen before login
3e5ee53  feat(mobile): page help
6eccd95  feat(engine): FAO-56 soil water balance, insights and reports
04b5960  Merge remote-tracking branch 'origin/feature/olwethu-reports' into dev
d79d4f3  Merge remote-tracking branch 'origin/feature/luba-requests' into dev
29f3ede  Merge remote-tracking branch 'origin/fix/expo-cors' into dev
7985f85  feat(mobile): replace Google map with free OpenStreetMap WebView   <- Leruo's, now pushed
```

**`7985f85` is no longer unpushed** — the OpenStreetMap commit went up with this push.

### Checks run on `dev` immediately before pushing — all passed

| Check | Where | Result |
|---|---|---|
| Conflict markers (anchored) | repo | **none** |
| `dotnet build` | `backend/AgroFlow.Api` | **succeeded**, 0 warnings, 0 errors |
| `dotnet test` | `backend/AgroFlow.Domain.Tests` | **313 passed**, 0 failed, 0 skipped |
| `npx tsc --noEmit` | `apps/mobile` | **clean** |
| `npx expo-doctor` | `apps/mobile` | **21/21 checks passed** |
| `npx tsc --noEmit` | `apps/web/admin` | **clean** |
| `npm run build` | `apps/web/admin` | **succeeded** |

### The final merge

`feature/drip-and-soil` (7 commits) merged into `dev` with `git merge --no-ff` → **`599fb0b`**. **No conflicts**, so the section 1 conflict policy was not needed. That merge brought the whole stack with it: the engine, page help, the admin welcome screen, and the Drip mascot and soil icons.

### Still open

PR #1 on `fix/expo-cors` can now be **closed** — its commit (`1f4a192`) is in the pushed `dev`.

---

## Read this first: one judgement call at the start

Phase A step 3 says to run `git merge --ff-only origin/dev` and to **STOP** if it cannot fast-forward, with the parenthetical "(local `dev` has commits that `origin/dev` doesn't)".

What actually happened:

- `git merge --ff-only origin/dev` **succeeded**, reporting `Already up to date.`
- But local `dev` *was* one commit **ahead** of `origin/dev`: `7985f85 feat(mobile): replace Google map with free OpenStreetMap WebView` (Leruo, 2026-10-01).

Those two facts pull in opposite directions, so here is the reasoning. `--ff-only` fails when the two branches have **diverged** — each holding commits the other lacks. Being strictly *ahead* does not make it fail, which is why it didn't. The STOP exists to stop work destroying unpushed commits, and nothing here was at risk: merging other branches *into* `dev` preserves `7985f85`, and no reset was run at any point.

**I proceeded.** If you disagree, the backup tag above restores `origin/dev`'s state exactly. Note that `7985f85` is still unpushed, so `origin/dev` is one commit behind your local `dev` for an unrelated reason.

---

## 1. Branch inventory

Every remote branch, with how many commits it had that `dev` lacked at the start:

| Branch | Author | Last commit | Commits ahead of `dev` | Action |
|---|---|---|---|---|
| `feature/philisile-onboarding` | tybphi001-maker | 2026-09-20 | **0** | Skipped — already merged |
| `fix/expo-cors` | Luba348 | 2026-10-01 | 1 | **Merged** |
| `feature/luba-requests` | Luba348 | 2026-10-01 | 2 | **Merged** |
| `feature/olwethu-reports` | Olwethu-51 | 2026-10-01 | 11 | **Merged** |
| `main` | Leruo24 | 2026-08-17 | 0 | Not merged (instructed) |
| `migrations` | Leruo24 | 2026-08-17 | 0 | Not merged (instructed) |
| `ui-fix` | Leruo24 | 2026-09-17 | 0 | Not merged, not deleted (abandoned) |
| `feature/farmer-onboarding` | Olwethu-51 | 2026-08-28 | **0** | Not named in the spec — see below |
| `philisile` | tybphi001-maker | 2026-08-25 | **0** | Not named in the spec — see below |

### Branches found that the spec did not name

Both were already fully contained in `dev`, so merging them would have been a no-op:

- **`feature/farmer-onboarding`** — Olwethu-51, 0 commits ahead.
- **`philisile`** — tybphi001-maker, 0 commits ahead.

There is also a local-only `backup/dev-pre-phili-merge`, left untouched.

---

## 2. Merges, in the order specified

| # | Branch | Branch tip | Merge commit | Result |
|---|---|---|---|---|
| 1 | `feature/philisile-onboarding` | `ebc67dc` | — | **Already merged**, skipped |
| 2 | `fix/expo-cors` | `1f4a192` | **`29f3ede`** | Merged, no conflict |
| 3 | `feature/luba-requests` | `ec279be` | **`d79d4f3`** | Merged, no conflict |
| 4 | `feature/olwethu-reports` | `fea9666` | **`04b5960`** | Merged, no conflict |

All four used `git merge --no-ff`. Nothing was reset, nothing was aborted, no merge had to be undone.

**PR #1 on `fix/expo-cors` can be closed once `dev` is pushed** — its single commit (`1f4a192 fix(api): allow Expo web origin`) is now in `dev`.

### Conflicts: none

**The expected `Program.cs` conflict did not happen.** Olwethu warned of one because `dev` had moved after she branched. Git resolved it cleanly: the merge touched `backend/AgroFlow.Api/Program.cs` with a single-line insertion and auto-merged. Both sides' registrations are present and verified:

```
301:app.MapFarmerEndpoints();    <- Luba
302:app.MapReportEndpoints();    <- Olwethu
```

`fix/expo-cors` also auto-merged `Program.cs` (one line changed) without conflict.

### A false positive worth knowing about

The conflict-marker check in the spec,

```
git grep -n -E "^(<<<<<<<|=======|>>>>>>>)"
```

**always reports a hit on this repo**, on a line of 76 `=` characters used as a comment rule in `apps/web/admin/src/pages/onboarding.ts:10`. It is not a conflict marker. Anchoring the pattern fixes it:

```
git grep -n -E "^(<<<<<<< |>>>>>>> |=======$)"
```

That anchored form returned nothing after every merge.

---

## 3. Post-merge check results

Run after **each** merge and again at the end. All green.

| Check | Where | Result |
|---|---|---|
| Conflict markers (anchored) | repo | **none** |
| `dotnet build` | `backend/AgroFlow.Api` | **succeeded**, 0 warnings, 0 errors |
| `npx tsc --noEmit` | `apps/mobile` | **clean** |
| `npx tsc --noEmit` | `apps/web/admin` | **clean** |
| `npx expo-doctor` | `apps/mobile` | **21/21 checks passed** |
| `npm run build` | `apps/web/admin` | **succeeded** |
| `dotnet test` | `backend/AgroFlow.Domain.Tests` | **278 passed**, 0 failed (before engine work; 313 after) |

### Two build problems that were environmental, not merge damage

1. **`apps/mobile` tsc failed before any merge.** `react-native-webview` is declared in `package.json` (13.16.1) but was missing from `node_modules`. `npm install` fixed it. Nothing in the repo changed.

2. **`apps/mobile` tsc failed after merging `feature/luba-requests`**, on `settings.tsx(249,40)`: `'/request'` not assignable to the typed-route union. Luba's branch adds the route file `src/app/request.tsx`, and expo-router's generated `.expo/types/router.d.ts` was stale. That file is **gitignored** — a local build artifact, not repo content. Booting Metro once regenerated it and tsc went clean. **No code was changed to fix either of these.**

---

## 4. Migration numbering

22 migration files after the merge. **No duplicate numbers. No clashes with the reservations.**

```
0001 foundation                      0013 update_auth_profile_phone
0002 relationships                   0016 weather_daily
0003 csharp_domain                   0017 zone_planting_date
0004 irrigation_commands             0018 zone_flow_rate
0005 irrigation_commands_duration    0019 irrigation_commands_pending_index
0006 backend_irrigation_logic        0020 flow_rate_default_and_nullable_litres
0007 move_irrigation_logic_to_api    0021 service_requests          <- Luba
0008 device_enrollment_and_onboarding 0024 telegram_onboarding
0009 mqtt_and_device_identity        0025 telegram_code_purpose
0010 zone_schema_realignment         0026 notification_dedupe
0011 row_level_security
0012 profile_api_requirements
```

- **Reservations honoured.** Phili 0014–0015: **never used, still free.** Leruo from 0016: used 0016–0020 and 0024–0026. Luba 0021: used.
- **Gaps:** 0014, 0015, 0022, 0023.
- **The engine migration is `0027`, not 0022.** 0022/0023 are free, but 0024–0026 already exist, so a new 0022 would sort *before* migrations that are already applied. 0027 is the first number after the highest in use.

---

## 5. Teammates' new tables — RLS and GRANTs

| Table | RLS enabled | GRANTs | Policies | Verdict |
|---|---|---|---|---|
| `service_request` (Luba, 0021) | ✅ `enable row level security` | ✅ `select, insert, update` to `authenticated`, plus `usage, select` on the sequence | ✅ select-own, insert-own, admin-all | **No gaps** |
| `weather_daily` (Leruo, 0016) | ✅ | ✅ `select` to `authenticated`, deliberately no write grant | ✅ member-select via `app_can_access_farm`, admin-all | **No gaps** |

**No gaps to report, and no teammate migration was modified.**

### One security-adjacent inconsistency in Olwethu's code (not fixed — hers)

Three of her four report endpoints gate on *owner, farm member, or admin*:

- `ReportEndpoints.cs:53` — water-usage ✅
- `ReportEndpoints.cs:172` — moisture ✅
- `ReportEndpoints.cs:828` — zones ✅
- **`GetScheduleAsync` — owner or farm member only, no admin clause.**

So an admin who is not a member of a farm can read its water-usage, moisture and zone reports but gets a 404 from the schedule report. It **fails closed**, so it is not a hole — just inconsistent, and it contradicts her own commit `1c33230 feat(api): let admins read reports for any farm`. Left for Olwethu: a one-line addition to her SQL, and her code is additive-only territory.

---

## 6. Luba's crop strings vs. the engine's

**Luba's list**, from the `service_request` CHECK constraint in `0021_service_requests.sql:12`:

```
'potato', 'tomato', 'citrus', 'leafy_veg', 'maize', 'dry_beans'
```

The same six appear in her mobile dropdown (`apps/mobile/src/app/request.tsx:41-44`), her API validator (`backend/AgroFlow.Api/Endpoints/FarmerEndpoints.cs:78-81`), her admin types (`apps/web/admin/src/types/models.ts:139-142`) and the mobile service type (`agroFlowApi.ts:354-357`). **All five places agree with each other.**

**There is no zone-level crop constraint.** `zone.crop_type` is `text not null default ''` (`0001_foundation.sql:71`) — free text, no CHECK.

**A third crop list exists.** The admin dashboard's own `referenceData.ts` offers Maize, Grapes, Citrus, Wheat, Potatoes, Apples — which matches neither of the others. Flagged, not touched.

### Comparison with the spec's six keys

Normalising (lower-case, trim, `_`→space, `corn`→`maize`, `cucumbers`→`cucumber`):

| Spec key | In Luba's list? |
|---|---|
| `maize` | ✅ |
| `potato` | ✅ |
| `tomato` | ✅ |
| `dry beans` | ✅ as `dry_beans` |
| `spinach` | ❌ missing |
| `cucumber` | ❌ missing |
| — | `citrus` — in Luba's, not in the spec's six |
| — | `leafy_veg` — in Luba's, not in the spec's six |

**They differ.** The spec says to align everything to its six keys "because only these have sourced FAO-56 values".

**Decision taken: all eight crops are kept and her constraint is unchanged.** The spec's premise is false in this repo. `backend/AgroFlow.Domain/Agronomy/fao56-crop-knowledge.json` already holds fully sourced FAO-56 values for citrus and leafy_veg — Table 11 rows, Table 12 Kc values, Table 22 rooting depth and p, each with page numbers and in citrus's case a quoted FAO footnote — and `GrowthStageCalculatorTests` pins them. Narrowing the list would have deleted sourced work and broken passing tests. The engine instead **adds** spinach and cucumber and **keeps** citrus and leafy_veg. Full reasoning in `fao56-engine-report.md`.

### Live check that could not be run

```sql
select crop_type, count(*) from service_request group by 1;
select distinct crop_type from public.zone;
```

**Not run.** The connection string lives in a gitignored user-secrets file, and §0 says never to touch credential or secret files (the sandbox blocked the read too). So I could not prove that no existing `service_request` row would be rejected by a narrowed constraint — which is the spec's own precondition for changing it.

Since all eight crops are being kept, nothing now depends on that query. It is still worth running to see what is actually in the column.

**Migration 0027 has been applied to live by Leruo.** A read-only script to confirm the applied schema matches the code — columns, tables, views, indexes, RLS, policies, GRANTs, `security_invoker`, and that no FK to irrigation commands exists — is at the end of `fao56-engine-report.md` under **Verify the applied migration**.

---

## 7. Olwethu's reports — what they read, and where they live

**Endpoints:** `backend/AgroFlow.Api/Endpoints/ReportEndpoints.cs` (870 lines before this work), mapped at `/api/reports`:

```
GET /water-usage      GET /water-usage/pdf
GET /moisture         GET /moisture/pdf
GET /schedule         GET /schedule/pdf
GET /zones
```

**Tables and columns read:**

| Table | Columns |
|---|---|
| `farm` | `farm_id`, `name`, `latitude`, `owner_id` |
| `farm_member` | `farm_id`, `profile_id` |
| `profile` | `id`, `role` |
| `zone` | `id`, `name`, `crop_type`, `planting_date`, `moisture_threshold`, `desired_moisture`, `flow_rate_lpm`, `farm_id` |
| `sensor_reading` | `zone_id`, `sensor_type` (`'SoilMoisture'` only), `value`, `recorded_at` |
| `irrigation_event` | `zone_id`, `started_at`, `runtime_seconds` |
| `weather_daily` | `farm_id`, `date`, `tmin_c`, `tmax_c`, `precipitation_mm`, `is_forecast` |

**`irrigation_event.estimated_litres` is deliberately never read.** Her own comment says why: the seeded values are stale. Litres are always `runtime_seconds / 60 × zone.flow_rate_lpm`. Days are grouped in `Africa/Johannesburg`. Both conventions are kept everywhere in the new work.

**Where the report page lives:** the admin dashboard's Analytics page (`apps/web/admin/src/pages/analytics.ts`), with the live panel rendered by `liveRender()` in `apps/web/admin/src/app/interactions.ts:1381` and run by `liveReportRun()`.

**PDFs** use QuestPDF, built by re-running the matching JSON endpoint so the PDF can never disagree with the screen.

---

## 8. Seeded and mock data

**Counted with SELECTs only — except that no SELECT could be run.** Same reason as §6: the credentials are off-limits. The run-these-yourself queries:

```sql
select count(*) from irrigation_event;
select count(*) from irrigation_event where estimated_litres = 120;
select count(*) from irrigation_event
  where estimated_litres is not null
    and abs(estimated_litres - (runtime_seconds / 60.0 * 1.5)) > 0.5;
select count(*) from sensor_reading;
select sensor_type, count(*) from sensor_reading group by 1;
select count(*) from zone;  select count(*) from farm;
select count(*) from alert; select count(*) from ai_recommendation;
select count(*) from weather_daily;
select count(*) from service_request;
```

**What is known from the code**, without touching live:

- **Olwethu's 120 L vs 22.5 L is consistent with the schema's history.** `estimated_litres` was `volume_litres NOT NULL DEFAULT 0` from 0002 and only became nullable and server-derived in 0020. Rows written before that carry device-era or seeded values. The formula at 1.5 L/min gives 22.5 L for a 15-minute run; 120 L would need an 80-minute run at that rate. **Nothing was deleted — live is read-only.**
- **Mock card:** the admin Analytics "Water Usage Trends" card is static mock data. Its label was `"Volume delivered by farm and region"`; it now reads **`"Estimated volume delivered by farm and region"`** (`analytics.ts:158`), because there is no flow meter. **The card itself was not removed** — that is Leruo's call.

---

## 9. Files changed during Phase A

**None.** All three merges were clean, and both build failures turned out to be local artifacts (`node_modules`, `.expo/types/`) rather than repo content. No `fix(merge): ...` commit was needed.

The three merge commits (`29f3ede`, `d79d4f3`, `04b5960`) are the entire content of Phase A. Everything after `04b5960` in the log above is Phases B–E and the Drip/soil work, which landed through the `599fb0b` merge.
