# Web polish — 23 October 2026

Branch: `fix/web-polish-oct23`, based on `dev` at `7ea3798`. Source:
[journey retest](../../audit/AgroFlow-Web-Journey-Retest-2026-10-23.pdf).
Presentation and the existing isolated simulation only. No backend, firmware,
migration, API contract, auth, commissioning, agronomy or persistence changes.
Do not merge this PR or deploy to production.

## Retest coverage

Paths below are relative to the repository root. Images are in this folder.

| Item | Status | Implementation | Screenshot |
| --- | --- | --- | --- |
| RET-03 | Fixed | `apps/web/admin/src/lib/downloads.ts`, `src/pages/publicSite.ts`: direct approved `/login` destination, including Already registered | `get-the-app-light-1366.png` |
| RET-04 | Fixed | `apps/web/admin/src/styles/web-polish.css`: opaque stage text/numbers, theme tokens, current-stage border | `technology-dark-1366.png` |
| RET-05 | Fixed | Same stylesheet: gallery caption and eyebrow theme tokens | `get-the-app-dark-390.png` |
| RET-07 | Fixed (web semantics) | `apps/mobile/src/components/WebRadioSemantics.tsx`; checked metadata and named groups on existing choices, roving focus and arrows/Home/End; existing callbacks unchanged | `farmer-settings-light-390.png` |
| RET-08 | Partly — frontend complete | `apps/mobile/src/components/ZoneOverviewCards.tsx`, `src/app/(tabs)/index.tsx`: pending data is Loading; empty tank only after successful empty response, errors are unavailable; old-farm responses cannot replace current farm | `farmer-zone-light-390.png`; deferred-response Jest cases |
| RET-11 | Fixed | `apps/web/admin/src/styles/web-polish.css`: phone hint uses full-opacity text token | `contact#enquire-light-390.png` |
| RET-12 | Fixed | `apps/mobile/src/styles/loginStyles.ts`, `src/app/login.tsx`: call-request target >=44px with spacing | `farmer-login-light-390.png` |
| RET-13 | Fixed | `apps/web/admin/src/pages/publicSite.ts`: caption outside home image; Technology leads with controller, Get app screenshots, About approved team/purpose | `homepage-light-1366.png`, `about-dark-1366.png` |
| RET-14 | Fixed | `apps/web/admin/src/main.ts`, `src/app/router.ts`: sign-in/reset and route-specific staff titles | Automated title checks |
| Soil-feel | Fixed (web) | `apps/mobile/src/components/BlurSheet.tsx`, `src/hooks/useWebDialogFocus.ts`: heading-named dialog, entry, Tab/Shift+Tab trap, Escape, return focus | `soil-feel-dark-390.png` |
| Technology viewer | Fixed | `apps/web/admin/src/features/hardware3d.ts`, `viewerFraming.ts`, `src/styles/web-polish.css`: remove container negative margin, stable canvas, ResizeObserver fitting, complete swing envelope, persistent manual angle, external controls, cached scenes, static fallback | `viewer-open-dark-390.png`, `viewer-light-1366.webm` |

## Fixtures and boundaries

All farmer screenshots and browser checks use the existing simulated Mahikeng farm
with intercepted fake Supabase/API hosts. This check's service and journey fixtures
match the existing contract. Wizard screenshots demonstrate the existing UI, not a
real saved onboarding journey. No irrigation command or live account is used.
The new viewer Preview button delegates only to the existing disposable DOM demo;
Stop and Reset remain outside the clipped viewport.

Missing approved photographs: **crop rows, drip irrigation, open field** in
`apps/web/admin/public/media/scenes/`. The shipped SVG landscapes are explicitly
labelled representative illustrations, not photographs or real AgroFlow farms.
Afrikaans and Setswana additions are drafts for fluent-speaker review.

Claude handoff: RET-01/02/06 message codes/09/10 remain outside this PR. Retain the
existing journey endpoints, task saves, wizard validation and legal/persistence
flow. Check real account/task persistence and irrigation/installation outcomes on
Claude's logic branch; this PR does not establish those outcomes from fixtures.
For RET-08, confirm the server's current-farm data and empty/error contracts with
real accounts; presentation here consumes the existing responses only.

Concrete integration checks for Claude (not implemented or simulated as saved here):

- Follow `apps/mobile/src/app/setup.tsx` through the existing `finishFarmerTask`
  calls and `src/hooks/useJourney.ts` reload. Verify all four task results survive
  refresh, sign-out/sign-in and a second device; keep details progress separate
  from installer commissioning and the automatic-watering offer.
- Verify `acceptTerms` against the server's current document versions and stored
  acceptance times; the fixture screenshot does not establish legal acceptance.
- Validate real help requests, action/message codes, commissioning/irrigation
  outcomes and persistence for RET-01/02/06/09/10 on the logic branch. Do not add
  a second save path to the radio or dialog presentation helpers.

## Reproduce locally

With the usual local environment already configured (never commit credentials):

```powershell
cd apps/web/admin
npm ci
npm run dev -- --port 5187
# http://localhost:5187/technology
# http://localhost:5187/get-the-app
```

```powershell
cd apps/mobile
npm ci
npx expo start --web
```

For isolated checks, use only fake values, in the admin directory:

```powershell
$env:VITE_SUPABASE_URL='https://testproject.supabase.co'
$env:VITE_SUPABASE_ANON_KEY='test-anon-key'
$env:VITE_AGROFLOW_API_BASE='https://api.agroflow.test'
npm run build
npx playwright test
node scripts/check-deep-links.mjs
```

For farmer fixture screenshots, from `apps/mobile`:

```powershell
$env:EXPO_PUBLIC_SUPABASE_URL='https://testproject.supabase.co'
$env:EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY='test-anon-key'
$env:EXPO_PUBLIC_AGROFLOW_API_BASE='https://api.agroflow.test'
npx expo export --platform web --output-dir <temporary-export-dir>
node scripts/web-polish-checks.mjs <temporary-export-dir> ../../docs/test-evidence/web-polish-oct23 ../web/admin
$env:VISUAL_THEME='dark'
node scripts/web-polish-checks.mjs <temporary-export-dir> ../../docs/test-evidence/web-polish-oct23 ../web/admin
```

`apps/web/admin/scripts/record-web-polish.mjs` records both sizes/themes using a
local fake-host server on 5187. It rejects nonlocal base URLs and blocks external
requests. Keyboard checks cover rotation, six door swings, backgrounds, demo
controls, resize and scroll. Reduced motion and normal motion are both exercised.
The projection test checks 72 angles × 13 door positions at two aspect ratios.

## Verification

| Check | Result |
| --- | --- |
| Admin `npm ci`, TypeScript and production build | Pass; existing >500 kB bundle warning |
| Full admin Playwright | **226 passed / 1 failed / 0 skipped** (227 total, two workers); one `ERR_NETWORK_IO_SUSPENDED` console failure in the existing deletion-cancel test |
| Isolated repeat of that failed case | **3/3 passed**, one worker, same final source; does not turn the failed full run into a clean pass |
| Mobile `npm ci`, `npx tsc --noEmit` | Pass; existing npm peer/deprecation warnings |
| Mobile Jest | 26 suites, 324 tests, 1 snapshot passed; existing setup test `act()` warnings |
| Mobile Expo web export | Pass; fake service hosts only |
| Local production-build deep links/security headers | Admin 20/20; farmer 6/6 passed |
| Farmer browser checks | Both themes × both widths: login axe, 49px call target, checked/group semantics, radio arrows, sheet focus/Tab/Escape/return passed; no page errors |
| Viewer recording checks | Both themes × both widths: keyboard turn/swing/scenes/demo, resize/scroll stability, normal/reduced motion passed |

The axe JSON files report zero violations. Offscreen carousel captions and the
symbol-only rotate buttons remain in axe's **incomplete/manual-review** results
(the rotate buttons have explicit localized accessible names). `contrast-*.json` separately checks
their computed text colours against both theme surfaces (minimum 4.5:1 required),
as well as every active/inactive stage heading, paragraph and number. This is not
a claim that an automated scan certifies the complete application.

Run history: initial contrast was corrected, native Jest assertions were changed
to inspect native accessibilityState, old service/journey fixtures were completed,
and login axe now waits for the existing startup overlay to finish. An early demo
timeout passed on the next focused run without changing the demo. The first full
227-test run had 225 passes and two legacy expectation failures: tabbing to every
radio and expecting no configured farmer-app link. Both assertions now check the
requested behaviour. A later overlapping diagnostic invocation lost one trace
artifact (ENOENT); the final full run uses its own output directory, with no
concurrent Playwright invocation.

The final full run's failure is `tests/sponsor-admin.spec.ts:40`, “removing a
farmer asks first, and Cancel removes nothing”. Its functional cancel/no-delete
assertions passed; `expect(errors).toEqual([])` failed on Chromium's
`Failed to load resource: net::ERR_NETWORK_IO_SUSPENDED`. The first diagnostic
repeat had one dialog timeout while generated HTML/screenshots were being
restored (2 passed / 1 failed); after restoration finished, an untouched-server
repeat passed 3/3. No error filtering or production logic was changed to hide it.
**The full suite is not recorded as green.** Rerun the complete suite in CI or
serially before marking the PR ready.

Not exercised: native Android/iOS builds, real kit/broker commands, production
accounts or deployments, backend/firmware tests (unchanged scope), fluent-speaker
review, and physical assistive-technology testing. Browser evidence is Chromium,
not a claim of Safari/Firefox or native screen-reader certification.
