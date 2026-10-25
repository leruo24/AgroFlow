## Scope

Presentation + existing isolated demo only, from dev `7ea3798`. Keep this PR draft;
do not merge or deploy to production. Automatic PR previews only are permitted.
No backend, firmware, migrations, API contracts, auth, agronomy, PrimaryAction,
commissioning or persistence changes. Original workspace/other branches preserved.

## Retest table

All evidence is under `docs/test-evidence/web-polish-oct23/`.

| RET | Status | Main files | Screenshot |
| --- | --- | --- | --- |
| 03 | Fixed | admin `lib/downloads.ts`, `pages/publicSite.ts` | `get-the-app-light-1366.png` |
| 04 | Fixed | admin `styles/web-polish.css` | `technology-dark-1366.png` |
| 05 | Fixed | admin `styles/web-polish.css` | `get-the-app-dark-390.png` |
| 07 | Fixed (web semantics) | mobile `WebRadioSemantics.tsx`, existing choice screens; admin `ui/radioKeyboard.ts` | `farmer-settings-light-390.png` |
| 08 | Partly — frontend complete | mobile `ZoneOverviewCards.tsx`, Home | `farmer-zone-light-390.png`; 4 deferred/loading tests |
| 11 | Fixed | admin `styles/web-polish.css` | `contact#enquire-light-390.png` |
| 12 | Fixed | mobile `login.tsx`, `loginStyles.ts` | `farmer-login-dark-390.png` |
| 13 | Fixed | admin `pages/publicSite.ts` | `homepage-light-1366.png`, `about-dark-1366.png` |
| 14 | Fixed | admin `main.ts`, `app/router.ts` | `staff-overview-dark-1366.png` + authenticated/signed-out title tests |
| Soil-feel | Fixed (web) | mobile `BlurSheet.tsx`, `useWebDialogFocus.ts` | `soil-feel-light-390.png` |
| Viewer | Fixed | admin `hardware3d.ts`, `viewerFraming.ts`, `web-polish.css` | `viewer-open-dark-390.png`, `viewer-light-1366.webm` |

[Full report, commands, fixture boundaries and Claude handoff](https://github.com/leruo24/AgroFlow/blob/fix/web-polish-oct23/docs/test-evidence/web-polish-oct23/README.md).

## Verification

- Admin install, TypeScript, build: pass (existing large-bundle warning).
- Full Playwright: **226 passed / 1 failed / 0 skipped** (227 total, two workers).
  Existing deletion-cancel test `sponsor-admin.spec.ts:40` failed only its console
  error assertion on Chromium `ERR_NETWORK_IO_SUSPENDED`. Its cancel/no-delete
  assertions passed. A subsequent untouched-server repeat passed **3/3** with one
  worker. **This is not a green full-suite result; rerun full CI/serially before ready.**
- Mobile install, TypeScript, Expo web export: pass.
- Mobile Jest: **26 suites / 324 tests / 1 snapshot passed**, with existing setup `act()` warnings.
- Local production deep-link/header checks: **admin 20/20; farmer 6/6**.
- Farmer web: both sizes/themes, login axe zero violations, call target 49px,
  named/checked radio groups + arrows, dialog focus/Tab/Escape/return, no page errors.
- Viewer: both sizes/themes, keyboard full turn and six door swings, scenes, isolated
  demo, resize + scroll stability, normal + reduced motion; static WebGL fallback.
  Projection checks cover 72 angles × 13 door positions at two aspect ratios.
- Axe: technology/Get app/contact/login JSON reports zero violations. Offscreen
  captions and symbol-only controls retain manual-review results; explicit computed
  stage/caption contrast tests require >=4.5:1 against both theme surfaces.

Initial full run: 225 passed / 2 obsolete expectation failures; tests were updated
for roving radio focus and the always-available approved farmer-login destination.
An overlapping diagnostic run lost a trace artifact (ENOENT); final run is isolated.
An initial failure-repeat run also had one dialog timeout while generated files
were restored (2 passed / 1 failed); the subsequent no-write repeat passed 3/3.
No production behaviour or console-error filtering was changed to conceal failures.

## Missing assets and untested boundaries

Missing approved scene **photographs**: crop rows, drip irrigation, open field.
Included SVG landscapes are labelled representative illustrations, not customer farms.
Afrikaans/Setswana additions are drafts for fluent-speaker review.

Screenshots use intercepted fake API/Supabase hosts and the simulated Mahikeng farm.
They do not prove live persistence. Claude retains RET-01/02/06 message codes/09/10,
wizard save/validation/journey integration and backend/firmware logic. RET-08 here
changes pending/empty/error display only, consuming existing responses.

Not run: native iOS/Android builds, physical screen readers, Safari/Firefox, live
accounts/kits/broker, production deployment, backend or firmware tests (unchanged).
No migration is introduced. Nothing has been merged.
