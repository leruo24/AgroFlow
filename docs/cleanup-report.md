# Repository cleanup inventory

Inventory base: `origin/dev` at `79c1ad4` (2026-10-22). Sizes are working-tree
bytes. Searches used tracked files only unless stated otherwise; generated dependency
and build folders were excluded.

## Unused files

The following Expo starter images have no references in source, app configuration,
tests, documentation, CI, or package scripts. For every file, the evidence search was
`rg -l -F --glob '!assets/**' --glob '!package-lock.json' -- <basename> apps/mobile`,
which returned no matches. `app.json` was checked separately: it names the current
adaptive icon, favicon, and splash assets, not any item below.

| Path | Size | Recommendation |
|---|---:|---|
| `apps/mobile/assets/images/expo-badge-white.png` | 4,129 B | Delete |
| `apps/mobile/assets/images/expo-badge.png` | 4,137 B | Delete |
| `apps/mobile/assets/images/expo-logo.png` | 3,317 B | Delete |
| `apps/mobile/assets/images/logo-glow.png` | 331,624 B | Delete |
| `apps/mobile/assets/images/react-logo.png` | 6,341 B | Delete |
| `apps/mobile/assets/images/react-logo@2x.png` | 14,225 B | Delete |
| `apps/mobile/assets/images/react-logo@3x.png` | 21,252 B | Delete |
| `apps/mobile/assets/images/tabIcons/explore.png` | 215 B | Delete |
| `apps/mobile/assets/images/tabIcons/explore@2x.png` | 347 B | Delete |
| `apps/mobile/assets/images/tabIcons/explore@3x.png` | 468 B | Delete |
| `apps/mobile/assets/images/tabIcons/home.png` | 253 B | Delete |
| `apps/mobile/assets/images/tabIcons/home@2x.png` | 343 B | Delete |
| `apps/mobile/assets/images/tabIcons/home@3x.png` | 479 B | Delete |
| `apps/mobile/assets/images/tutorial-web.png` | 58,959 B | Delete |

Total safe deletion: 446,089 B across 14 files.

## Duplicates

Evidence was an SHA-256 grouping of every tracked, non-migration file of at least
1 KiB (`Get-FileHash -Algorithm SHA256`). Migrations were deliberately excluded.

| Paths | Size per file | Evidence and recommendation |
|---|---:|---|
| `apps/mobile/assets/images/favicon.png`; `apps/web/admin/public/brand/agroflow-icon-48.png` | 4,238 B | Identical hash. Keep: each deploy root needs its own named asset. |
| `apps/mobile/assets/images/icon.png`; `docs/presentation/presentation-assets/brand/agroflow-icon.png` | 1,253,089 B | Identical hash. Keep: the first is an app build input and the second is read by `docs/presentation/build_deck.js`. |
| `apps/mobile/assets/media/agroflow-loading-poster.jpg`; `apps/web/admin/public/media/agroflow-loading-poster.jpg` | 20,324 B | Identical hash. Keep: separate mobile and product-site build roots. |
| `apps/mobile/assets/media/agroflow-loading.mp4`; `apps/web/admin/public/media/agroflow-loading.mp4` | 269,767 B | Identical hash. Keep: both builds reference the local copy. |
| `apps/mobile/public/icons/agroflow-192.png`; `apps/web/admin/public/brand/agroflow-icon-192.png`; `backend/AgroFlow.Api/Reports/Assets/agroflow-icon.png` | 43,863 B | Identical hash. Keep: web manifests/pages and the API embedded report resource load these by name. |
| `apps/mobile/public/icons/agroflow-512.png`; `apps/web/admin/public/brand/agroflow-icon-512.png` | 274,008 B | Identical hash. Keep: separate deploy roots. |
| `docs/test-evidence/app-spacing/**/{alerts,history,reports,setup}*-bottom.png` and the same names without `-bottom` | 32,274–108,604 B | Exact-copy sibling pairs found at 1366, 390, and 430 widths. Ask the team: the names document top/bottom viewport coverage even where the image is identical. |
| `docs/test-evidence/release-oct-19/mobile/setup-wizard/*` and `docs/test-evidence/setup-wizard/*` | 31,004–123,243 B | 20 exact-copy pairs by hash. Ask the team before pruning dated release evidence. |
| `docs/test-evidence/password-reset/*` and matching `docs/test-evidence/release-oct-19/mobile/sign-in-and-reset/*` | 15,955–185,370 B | Four exact-copy pairs by hash. Ask the team before pruning dated release evidence. |
| `docs/test-evidence/visual-polish/{before,after}/**` and matching files in `docs/test-evidence/app-spacing/**` | 54,384–166,118 B | Exact-copy pairs/groups. Ask the team: these are named evidence checkpoints, not runtime assets. |

No duplicate was deleted unless every consumer could use the remaining path without a
build, route, deployment, or evidence change; none of the groups above met that bar.

## Old video renders and binaries over 5 MB

| Path | Size | Evidence and recommendation |
|---|---:|---|
| `docs/Fao56.pdf` | 6,432,919 B (6.13 MiB) | The only tracked file over 5 MiB. `rg -n -F 'Fao56.pdf' docs README.md backend` finds references in engine docs and the embedded knowledge metadata. Existing reports say this copy is corrupt. Ask the team to replace it with a clean source copy, then track it with Git LFS. |
| `apps/mobile/public/media/agroflow-loading-v2.mp4` | 1,107,098 B | `WebLoadingVideo.web.tsx` loads it by exact URL. Keep; Git LFS candidate if binary history grows. |
| `apps/mobile/assets/media/agroflow-loading.mp4` and `apps/web/admin/public/media/agroflow-loading.mp4` | 269,767 B each | Native loading animation and product-site shell references were found. Keep. |
| `docs/presentation/AgroFlow_Showcase_Intro_2026.pptx` | 4,992,163 B | Below 5 MiB but close to the threshold and intentionally retained as the showcase deck. Git LFS candidate. |

No unreferenced old video render was found.

## Dead code

Evidence for TypeScript was
`npx tsc --noEmit --noUnusedLocals --noUnusedParameters` in both apps. The admin
app reported no unused declarations. The mobile app reported the items below.

| Path | File size | Evidence and recommendation |
|---|---:|---|
| `apps/mobile/src/context/AgroFlowContext.tsx` | 50,893 B | `FarmMemberRow` is declared once and never used; remove the type. `mapZoneRow` also receives an unused positional `index`; remove it and update its production/test callers without changing behavior. |
| `apps/mobile/src/styles/profileStyles.ts` | 6,522 B | `Spacing` is imported but never used; remove that import. |
| `apps/mobile/src/app/(tabs)/irrigation.tsx` | 6,419 B | Unused `View` import. Ask the team: this is an Expo Router screen and route files are protected in this cleanup. |
| `apps/mobile/src/app/(tabs)/settings.tsx` | 18,208 B | Unused `HelpButton` import. Ask the team: protected Expo Router screen. |
| `apps/mobile/src/app/setup.tsx` | 62,160 B | Unused local `t`. Ask the team: protected Expo Router screen. |
| `apps/mobile/src/app/zone/[id].tsx` | 54,966 B | Unused `modeLabel`, `dayLabel`, and `soilReadingText`. Ask the team: protected name-loaded route. |
| `backend/AgroFlow.Api/Endpoints/RecommendationEndpoints.cs` | 9,641 B | `dotnet build` emits CS1717 for a self-assignment. Ask the team: changing it could alter recommendation logic and is outside a cleanup-only pass. |

The C# compiler reported no unused-class diagnostics. A declaration-name search produced
many request/response records and endpoint classes that appear only in their defining file;
these are used by minimal-API binding/serialization or route registration and were kept.

## Leftover test output

| Path | Size | Evidence and recommendation |
|---|---:|---|
| `docs/test-evidence/backend.trx` | 1,828,979 B | Referenced by `docs/test-evidence/README.md` as a dated test artifact. Keep, or ask the team whether historical raw output should move to release artifacts. |
| `docs/test-evidence/admin-playwright/index.html` | 522,771 B | Referenced by `docs/README.md`; saved evidence, not an accidental current `playwright-report/`. Keep. |
| `docs/test-evidence/app-spacing/` | 15,803,110 B (208 files) | Deliberately named before/after evidence. Ask the team before pruning; many exact duplicates are noted above. |
| `docs/test-evidence/visual-polish/` | 7,212,264 B (82 files) | Deliberately named before/after evidence. Ask the team before pruning. |

`git ls-files` found nothing under build-output, `test-results/`,
`playwright-report/`, `bin/`, `obj/`, or `dist/` paths. Generated output from this audit
is not being committed.

## Stray scratch files

| Path | Size | Evidence and recommendation |
|---|---:|---|
| `apps/mobile/scripts/reset-project.js` | 3,824 B | Its own header says it is the create-expo-app reset helper, but `package.json` still references it as `reset-project`. Ask the team; it is dangerous for this established app, but it is not unreferenced and therefore is not safe to delete in this pass. |

No `.tmp`, `.bak`, `.old`, `.orig`, editor-swap, or scratch-named tracked files were found.

## Empty folders

No committed empty folders were found. Git does not track directories by themselves, and
`git ls-files` found no `.gitkeep` or `.keep` placeholders. Empty generated directories in
local build/dependency output are outside the tracked inventory.

## Out-of-date docs

| Path | Size | Evidence and recommendation |
|---|---:|---|
| `apps/mobile/README.md` | 3,127 B | Still mostly the create-expo-app welcome/reset text and points contributors at the wrong app directory. Rewrite for AgroFlow. |
| `apps/web/admin/README.md` | 4,453 B | Describes deleted `src/data/mock.ts`, old page names, and says to delete a file that no longer exists. Rewrite. |
| `hardware/sim/README.md` | 4,372 B | Says the API database slice has 8 checks; the current simulator reports 41 database checks and 26 top-level checks. Rewrite as a short run/test guide. |
| `README.md` | 5,586 B | Accurate overview, but deployment information is scattered and APK/Vercel/Railway responsibilities are not presented together. Rewrite to the requested structure. |
| `backend/AgroFlow.Api/README.md` | 12,054 B | Useful but no longer short; configuration prose is internally inconsistent about the number of required secrets. Replace with a focused folder guide without exposing values. |
| `docs/test-evidence/README.md` | 11,922 B | Its dated backend row records 1,201 tests from 2026-10-07, versus 1,522 discovered now. Keep as historical evidence; current dev/branch counts belong in this report and the PR. |
| `docs/reports/actionable/baseline.md` | 7,332 B | Says `docs/Fao56.pdf` is 11.3 MB; it is now 6,432,919 B. Ask the team whether this point-in-time baseline should remain immutable. |

A local Markdown-link scan covered every tracked `*.md` file, resolved relative paths and
ignored web URLs and anchors. It found no broken local Markdown links before cleanup.

## Ask the team

- Whether to remove the create-expo-app reset helper and its package script together.
- Whether named duplicate screenshots can be consolidated without weakening release/test evidence.
- Whether protected Expo Router screens should receive the compiler-only unused-symbol cleanup.
- Whether the self-assignment warning in `RecommendationEndpoints.cs` is a bug or intentional placeholder.
- Whether to replace the corrupt FAO-56 PDF and put it (plus the showcase PPTX) under Git LFS.
- Whether dated raw test output should stay in Git or move to CI/release artifacts.
- Whether route-loaded `public/admin/index.html`, generated `staff/index.html`, minimal-API endpoint types, reflection-visible types, and MQTT handlers can ever be retired. None were removed here.

## Git LFS candidates

- `docs/Fao56.pdf` — 6,432,919 B; replace the corrupt copy first.
- `docs/presentation/AgroFlow_Showcase_Intro_2026.pptx` — 4,992,163 B.
- `apps/mobile/public/media/agroflow-loading-v2.mp4` — 1,107,098 B if future renders are expected.

## Verification: `dev` versus `chore/cleanup`

Both runs used the same dependency lockfiles. The `dev` baseline was commit
`79c1ad4`; a final fetch confirmed it was still the tip of `origin/dev` before
the branch run. Test discovery counts did not drop.

| Check | `dev` | `chore/cleanup` | Result |
|---|---|---|---|
| `dotnet build backend/AgroFlow.Api/AgroFlow.Api.csproj` | Passed; 0 errors, 8 warnings | Passed; 0 errors, 8 warnings | Match |
| `dotnet test backend/AgroFlow.Domain.Tests/AgroFlow.Domain.Tests.csproj` | 1,503 passed, 19 skipped, 1,522 total | 1,503 passed, 19 skipped, 1,522 total | Match |
| Admin `npm ci` | 218 packages installed | 218 packages installed | Match |
| Admin `npm run build` | Passed; 803 modules transformed | Passed; 803 modules transformed | Match |
| Admin `npx playwright test` | 141 passed, 2 failed, 143 total | 142 passed, 1 failed, 143 total | Discovery count matches; branch has no drop |
| Mobile `npm ci` | 952 packages installed | 952 packages installed | Match |
| Mobile `npx tsc --noEmit` | Passed | Passed | Match |
| Mobile `npx jest --runInBand` | 19 suites, 187 tests, 1 snapshot passed | 19 suites, 187 tests, 1 snapshot passed | Match |
| Mobile `npx expo export --platform web` | Passed; 2,843 modules, 19 assets | Passed; 2,843 modules, 19 assets | Match |
| Simulation `npm ci` | 81 packages installed | 81 packages installed | Match |
| `node hardware/sim/run-e2e.mjs` | 26 passed, 0 failed; API database slice 41/41 | 26 passed, 0 failed; API database slice 41/41 | Match |

Playwright's `homepage demo opens, waters the field, explains the decision and
exits` failed on both runs because the experience dialog did not appear within
15 seconds. `saved farm coordinates populate the edit map and remain
authoritative` failed on `dev` but passed on the branch even though no admin
source or test file changed, so it is recorded as a baseline-only flaky failure.

Every requested check could run after installing locked dependencies and allowing
the build/test tools to spawn their local child processes. No check was skipped.
The Markdown link scan was repeated after the README changes and found no broken
local links. `git ls-files -ci --exclude-standard` returned no tracked files, so
there was nothing to remove with `git rm --cached` after the ignore rules changed.
