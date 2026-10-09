# Repository cleanup plan

Written for: the AgroFlow team, before reviewing the `chore/repo-cleanup` branch.

Survey of `dev` at `918478b` (9 October 2026), what this branch changes, and
what it deliberately leaves for the team to decide. Nothing in git history is
rewritten, no branch is deleted and no large file is removed in this pass.

## 1. Top-level layout

| Path | Purpose | This pass |
|---|---|---|
| `apps/mobile/` | Expo / React Native farmer app (also builds as a web app) | kept; one unused file and one unused export removed |
| `apps/web/admin/` | Vite + TypeScript admin console, public landing page, 3D controller and the Experience AgroFlow demo | kept; one unused file and 12 unused exports removed |
| `backend/` | `AgroFlow.Api` (ASP.NET Core), `AgroFlow.Domain` (C# DB / XDB / Controller workshop pattern, FAO-56 engine), `AgroFlow.Domain.Tests` | kept, structure untouched |
| `hardware/` | ESP32 firmware (`esp32/`), shared MQTT topic notes (`shared/`) | kept, untouched |
| `supabase/` | `migrations/` (schema history), `diagnostics/` | kept; `scripts/` added (see below); migrations untouched |
| `showcase/` | HyperFrames walkthrough video for the UCT showcase, renders and edit kit | kept; now also holds the presentation deck and the older walkthrough video |
| `docs/` | Engine documentation, reports, runbooks, sample reports, test evidence | grouped into subfolders |
| `Dockerfile`, `.dockerignore` | Railway image for `backend/AgroFlow.Api`; the build context must be the repo root because the Api references the sibling Domain project | kept at the root; `showcase/` added to `.dockerignore` |
| `presentation/` | Showcase slide deck (`.pptx`), its generator, script and assets | **moved** to `showcase/presentation/` |
| `walkthrough-video/` | The earlier (v1) HyperFrames walkthrough project | **moved** to `showcase/walkthrough-video/` |
| `assets/brand/agroflow-icon.png` | One brand icon, byte-identical to `presentation/presentation-assets/brand/agroflow-icon.png` | **moved** to `showcase/assets/brand/agroflow-icon.png` |
| `scripts/apply-migrations.ps1` | Applies `supabase/migrations` in order | **moved** to `supabase/scripts/`, its relative path fixed |

After this pass the root holds only the six project roots, `docs/`, the
Docker files, `README.md` and the git config files.

### Second level

- `apps/mobile/`: `src/` (app, components, context, hooks, lib, services), `assets/`, `public/`, `scripts/`.
- `apps/web/admin/`: `src/` (app, data, experience, features, lib, pages, services, styles, types, ui), `public/`, `tests/` (Playwright).
- `backend/`: `AgroFlow.Api/` (Endpoints, Reports, Services), `AgroFlow.Domain/` (Agronomy, RuleBook, DB/XDB/Controller classes), `AgroFlow.Domain.Tests/`.
- `hardware/`: `esp32/AgroFlowIrrigationNode/`, `shared/`.
- `supabase/`: `migrations/`, `diagnostics/`, `scripts/` (new).
- `showcase/`: `assets/`, `capture/`, `compositions/`, `renders/` (+ `edit-kit/`), and now `presentation/` and `walkthrough-video/`.

## 2. Stray or misplaced files

| File | Problem | Action |
|---|---|---|
| `presentation/` at the root | Showcase material outside `showcase/` | moved into `showcase/presentation/` |
| `walkthrough-video/` at the root | A second video project outside `showcase/` | moved into `showcase/walkthrough-video/` |
| `assets/brand/agroflow-icon.png` | A one-file root folder, duplicate of the presentation's copy | moved into `showcase/assets/brand/` |
| `scripts/apply-migrations.ps1` | A one-file root folder; it only operates on `supabase/migrations` | moved into `supabase/scripts/` |
| `docs/presentation-runbook.md` | Demo-day runbook, belongs with the presentation | moved into `showcase/presentation/` |
| `docs/pages-workflow.yml` | GitHub Pages workflow parked in `docs/` because the push token lacks the `workflow` scope; inactive where it sits | moved into `docs/ops/`; still to be copied to `.github/workflows/` by someone with the scope |
| `showcase/presentation/build_deck.js` | `OUT_DIR` is the absolute sandbox path `/home/user/AgroFlow/presentation` | path string updated to the new folder; the script still needs `PPTX_SKILL` and was not run (not verified) |
| `.dockerignore` | Excludes `apps/`, `docs/`, `hardware/`, `supabase/` but not `showcase/` (~450 MB with the moved folders), so every Railway build uploads the videos as build context | `showcase/` added; not verified with a Docker build |

## 3. Tracked files over 5 MB

All are binary and already marked `binary` in `.gitattributes`. Nothing is
removed or rewritten in this pass. GitHub warns at 50 MB and rejects files
over 100 MB; the largest is 98.3 MB.

| File | Size | Recommendation |
|---|---|---|
| `showcase/renders/AgroFlow_Showcase_Walkthrough_Previous_4K.mp4` | 98.3 MB | **Remove from the repo and store externally** (a superseded render, 1.7 MB under GitHub's hard limit). Needs a history rewrite to reclaim the space, which is the team's call. |
| `showcase/renders/AgroFlow_Showcase_Walkthrough_Final_4K.mp4` | 88.6 MB | **Git LFS** or external storage (the deliverable; keep a link in `showcase/`) |
| `showcase/renders/AgroFlow_Showcase_Walkthrough_Final.mp4` | 52.4 MB | **Git LFS** |
| `showcase/renders/AgroFlow_Showcase_Walkthrough_Previous.mp4` | 48.1 MB | **Remove and store externally** (superseded) |
| `showcase/renders/edit-kit/picture-no-audio.mp4` | 46.2 MB | **Git LFS** (editing input) |
| `showcase/walkthrough-video/renders/agroflow-system-walkthrough.mp4` | 24.3 MB | **Git LFS** or external storage (v1 video) |
| `showcase/renders/edit-kit/voiceover.m4a` | 7.8 MB | **Git LFS** |
| `docs/Fao56.pdf` | 6.1 MB | **Keep** in git: it is the cited source for every FAO-56 page reference, and is small enough |

Moving to Git LFS later: `git lfs track "*.mp4" "*.m4a"`, commit
`.gitattributes`, then `git lfs migrate import --include="*.mp4,*.m4a" --everything`
(a history rewrite: every clone must re-clone, and open branches must be rebased).

## 4. docs/ by type

| Group | Files (new location) | Notes |
|---|---|---|
| Engine | `docs/engine/fao56-engine-audit.md`, `docs/engine/fao56-engine-report.md`, `docs/engine/rule-book.md` | `rule-book.md` is generated by `RuleBookDocument` tests; its path in the test is updated |
| Source | `docs/Fao56.pdf` | **stays**: cited by `AgroFlow.Domain/Agronomy/fao56-crop-knowledge.json`, the rule-book generator and the audit |
| Reports (historical) | `docs/reports/final-finish-report.md`, `final-predeploy-report.md`, `finish-features-report.md`, `merge-report.md`, `polish-report.md`, `docs/reports/actionable/` | point-in-time reports; **stale by design**, see below |
| Report (pinned) | `docs/OVERNIGHT_REPORT.md` | **stays**: cited by migration `0017_zone_planting_date.sql` (migrations are not touched) and by code comments |
| Releases | `docs/releases/release-notes-v2.md` | |
| Operations | `docs/ops/data-cleanup.sql`, `irrigation-data-checks.sql`, `verify-migrations.sql`, `demo-account.md`, `pages-workflow.yml` | |
| Onboarding | `docs/ORIENTATION.md` | **stays** (linked from `README.md` and `.env.example`); partly stale, see below |
| Generated / evidence | `docs/sample-reports/`, `docs/test-evidence/`, `docs/ui_review/` | **stay**: test fixtures and `playwright.config.ts` write to these paths |
| This plan | `docs/repo-cleanup-plan.md` | |

**Stale or overlapping, flagged and not deleted:**

- `README.md` (root): still says reports and insights are not built. **Refreshed in this pass.**
- `docs/ORIENTATION.md` (21 Sep): written for the September restructure; its directory map predates `showcase/` and the engine. Superseded by the refreshed README for layout; keep it for the RLS / schema-truth section.
- `docs/reports/final-predeploy-report.md`, `finish-features-report.md`, `polish-report.md`, `final-finish-report.md` and `docs/reports/actionable/final-report.md` overlap: each is a "what was done" record of a successive pass. They are history, not current documentation. Candidates to fold into one changelog if the team wants.
- `docs/test-evidence/*.txt` and `backend.trx`: snapshots from 7–8 October; they no longer match the current test count (1,301). Regenerate before submission or label as dated.
- `docs/ui_review/` (21 Sep): before/after screenshots of a UI pass that has since been redesigned twice.

## 5. Dead code

Found with `knip@5` (TypeScript) and confirmed with `git grep`: only items
whose name occurs nowhere except their own declaration are deleted.

**Deleted in this pass**

| Item | Evidence |
|---|---|
| `apps/web/admin/src/experience/components/WeeklyPlan.tsx` | knip: unused file; `WeeklyPlan` appears only in this file |
| admin exports `EVENT_TYPE_OPTIONS` (`data/referenceData.ts`), `SCENARIO_ORDER` (`experience/data/scenarios.ts`), `recommendationLabel` (`experience/engine/weeklyProjection.ts`), `exportRowsWorkbook` (`lib/workbook.ts`), `getReportJson`, `getPlatformConfig`, `assignRequest` (`services/agroFlowApi.ts`), `statPill`, `detailRow` (`ui/components.ts`), `detailPanel`, `relatedList`, `confirmBody` (`ui/patterns.ts`) | each name occurs exactly once in `src/` + `tests/` + `index.html` (its declaration) |
| `apps/mobile/src/services/notificationService.ts` | knip: unused file; `notificationService` occurs nowhere in the tracked mobile tree |
| mobile export `BlurSheetRow` (`components/BlurSheet.tsx`) | occurs once in `src/` + `app/` |

**Reported, not deleted**

| Item | Why it stays |
|---|---|
| ~11 more admin exports and ~11 mobile exports knip lists as unused (e.g. `animate.ts` helpers, `filters.ts` helpers, `colors.ts` `Fonts`/`Colors`) | used inside their own file, so only the `export` keyword is unused; harmless |
| `apps/mobile/src/components/FarmMapSurface.native.tsx` | knip false positive: Metro picks it by platform extension |
| `apps/mobile/scripts/ui-smoke.mjs` | a manually run tool; no references, but not proven dead. Team call. |
| mobile dependencies knip lists as unused (`@expo/ui`, `ansi-escapes`, `expo-device`, `expo-glass-effect`, `expo-notifications`, `expo-symbols`, `react-native-worklets`, `@expo/ngrok`) | Expo config plugins and native modules are used outside imports; removing them needs a device build to verify |
| admin `tests/location.spec.ts` "unresolved import" `/src/lib/coordinates.ts` | knip false positive: a browser-side dynamic import |
| `ForecastOutlook.PlainDayAdvice` / `PlainOutlookFromRainOnly` (backend) | no production caller since the Forecast endpoint reads the engine outlook, but covered by `ForecastOutlookTests`; candidate for removal with those tests |
| backend `*Endpoints` static classes flagged by a name scan | false positives: registered through `Map…` extension methods |

## 6. Branches

Merged status is `git merge-base --is-ancestor <branch> dev` after `git fetch`.
**No branch is deleted in this pass.**

| Branch | Last commit | In dev? | Recommendation |
|---|---|---|---|
| `3D-feature` (local + origin) | 2026-10-08 | merged | deletion candidate |
| `experience-agroflow-demo` (local + origin) | 2026-10-09 | merged | deletion candidate after review |
| `backup/dev-before-workflow-rewrite` (local) | 2026-10-03 | **not by hash** | content is in dev under rewritten hashes (see below); deletion candidate once the team is sure the rewrite is final |
| `backup/dev-pre-phili-merge` (local) | 2026-09-21 | merged | deletion candidate |
| `feat/actionable` (local + origin) | 2026-10-07 | merged | deletion candidate |
| `feat/designed-reports` (local) | 2026-10-05 | merged | deletion candidate |
| `feature/admin-welcome`, `feature/drip-and-soil`, `feature/fao56-engine`, `feature/final-predeploy`, `feature/help-mascot` (local) | 2026-10-02/03 | merged | deletion candidates |
| `feature/finish-features` (local) | 2026-10-03 | **not by hash** | every patch is already in dev (`git cherry` shows `-`), deletion candidate |
| `fix/loading-cap-and-splash` (local) | 2026-10-03 | **not by hash** | see below: do **not** merge; deletion candidate |
| `fix/admin-polish`, `fix/final-finish`, `fix/polish-before-deploy` (local) | 2026-10-05/07 | merged | deletion candidates |
| `fix/followups`, `test/full-proof` (local + origin) | 2026-10-07 | merged | deletion candidates |
| `main`, `migrations`, `ui-fix` (local + origin) | 2026-08-17 / 09-17 | merged | `main` stays; the others are deletion candidates |
| `philisile`, `origin/feature/philisile-onboarding`, `origin/feature/luba-requests`, `origin/feature/olwethu-reports`, `origin/fix/expo-cors`, `origin/feature/farmer-onboarding` | 2026-08-25 … 10-01 | merged | **teammate branches: keep unless their owners say otherwise** |

**`fix/loading-cap-and-splash` versus dev.** The branch is `feature/finish-features`
plus one fix, `9a12ca9` "10 s safety cap, and a white splash to match the
video". dev's history was rewritten after it was cut, so none of its hashes
are in dev, but `git cherry dev fix/loading-cap-and-splash` shows seven of its
eight commits as already applied (dev has the fix as `deeec19`). The eighth,
`3814b70`, differs from dev's `57af627` only in where the Pages workflow
lives: `.github/workflows/pages.yml` on the branch, `docs/pages-workflow.yml`
in dev (the token-scope workaround). Merging it would bring back that
workflow file (which the current token cannot push) and older versions of
files dev has since changed. **Recommendation: do not merge; delete when the
team is ready.**

## 7. Not done in this pass, and why

- **No history rewrite, no MP4 removal, no Git LFS migration**: recommended above; each needs a team decision and a coordinated re-clone.
- **No branch deletion**: candidates listed above.
- **`supabase/migrations/`, firmware pin assignments and the C# DB / XDB / Controller structure**: untouched by rule.
- **Committed dev secrets bundle**: untouched. Note that the bundle described to me (`appsettings.Development.json`, `.env` files, firmware `secrets.h`) is **not tracked** on `dev`: the tracked config files are `apps/mobile/.env.example`, `apps/web/admin/.env.example`, `backend/AgroFlow.Api/appsettings.json` and `hardware/esp32/AgroFlowIrrigationNode/secrets.example.h`; the real `.env` files are git-ignored. Worth confirming that is intended.
- **Expo patch upgrades**: `npx expo-doctor` reports 7 patch mismatches on `dev` before and after this pass; upgrading is the team's call.
