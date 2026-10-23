# Release report: 2026-10-23

The release branch `merge/oct23-release` was made from `dev` at 79c1ad4. It combines three branches:
- `fix/audit-oct22` (72832ac): the audit fixes;
- `fix/i18n-remaining` (7bf9115): the last three translated screens;
- `feat/visual-redesign` (980d8aa, Codex's PR #3): the redesign.

It then wires Codex's components to the real contracts. Every check passed, apart from one test known to be flaky; the details are below. So the branch was merged into `dev`, `dev` was merged into `feat/expo-web`, and both were pushed. The app version is now **2.3.0**. Migrations 0057–0059 were already applied and verified on the live database before this release.

## 1. Codex's PR #3, checked against its brief

Sources:
- Codex's reports: [visual-revision.md](../visual-revision.md) (the latest) and [visual-redesign.md](../visual-redesign.md).
- The brief: [agroflow-ui-service-design-brief-2026-10-22.md](agroflow-ui-service-design-brief-2026-10-22.md), sections 3–6, 9–11, 14 and 18, and the personality layer (section 4).

Each item was checked in the code, not only in the reports.

| Item | Status | What is in the code |
|---|---|---|
| **Green-led tokens (Forest / Cream / Sage, teal as an accent)** | **Missing. It went mainly blue.** | In the latest revision (6582759, "blue/teal visual revision"), the tokens are mostly blue. The brand and main action colour is water-blue `#126B91`. The page is blue-white `#F7FAFC`. Text is blue-slate `#183344`, and the staff sidebar is `#143444`, which is slate-blue, not Forest. Forest `#143D2A` survives only as `secondaryDark`. Cream `#F7F5ED` and Sage `#E8EEE5` are not used. Green is kept for crops and success. This contradicts brief §3 (Forest for main buttons, headings and the staff sidebar; Cream on the public site) and §10 ("forest-green sidebar"). Codex's report says the blue/teal board came from a later prompt (`AgroFlow-Codex-Prompt-and-NEW-Designs.zip`). Whether that prompt replaced the brief is **your decision**. It was merged as it is. |
| Separate public pages, including /service-pricing, /terms and /privacy | Done | There are 11 routes, each with its own title and the matching nav link highlighted, and old fragment links still work. The deep-link refresh check against the production build passes (§4). |
| Mobile menu | Done | A real button with `aria-expanded`, Escape to close, focus returned to the button, and the same destinations as desktop. |
| Staff shell | Partly | Done: "AgroFlow Staff" with the line "Manage enquiries, farmers, installations and support", the shared logo, the theme in the account menu, and phone drawers. Not done: the sidebar is slate-blue, not forest-green, and the brief's suggested navigation (Overview / Enquiries / Farmers & farms / Installations / …) was not adopted. The existing Home / Requests / Farmers / … order stayed, and the brief offered that grouping as a proposal to validate. |
| Logo on /staff/ | Done | One shared brand helper, `/brand/agroflow-icon-192.png`, with a fixed size. The deep-link check confirms the image loads on every public route and on `/staff/` after a refresh. |
| 5 data states | Done | `DataState` has `loading`, `value`, `empty`, `stale` and `error`, each with its own icon. Retry is now translated. |
| Simple view | Done | Saved on the device only. It enlarges the advice and removes visual clutter on Home. Controls keep their meaning. |
| Postcard header | Done | `FarmPostcard` shows the real farm name, with no invented weather or crop health. |
| Hosepipe progress | **Was catalogue-only; wired in this release** | It is now driven by the server's four-task count, in the setup hub and in "Where you are now". |
| Field guide | Done | Static explainers in en, af and tn, reachable from Settings, the help sheets and the screen headers. |
| 2D cutaway | Done | The default view on /experience, marked as a simulation, with equivalent readable text. The 3D view is optional and loads only when asked for. |
| Theme toggle | Done | System / Light / Dark with written labels, in the public header, the staff account menu and the farmer's Settings. There is a decorative day/night motif. The brief's droplet-shaped switch and sunrise-to-moon transition are only partly there: there is a motif, but no switch shape or transition. |
| AF-10 text contrast | Done (Codex) | Tests require at least 4.5:1 for core text, supporting text, the selected tab and filled buttons, in both themes. This is not a whole-app WCAG audit. |
| AF-11 phone navigation | Done (Codex) | The mobile menu above. |
| AF-12 zoom | Done (Codex) | The web viewport no longer blocks zoom (`width=device-width, initial-scale=1, viewport-fit=cover`). |
| AF-13 form and selection semantics | Done (Codex) | Radio roles and selected state, named sheets and dialogs. Not tried with a physical screen reader. |
| AF-14 gallery keyboard | Done (Codex) | Native named dialogs, with focus returned to the trigger. |
| AF-16 logo and backdrop paths | Done (Codex) | Root-relative asset paths, verified by the deep-link check. |
| AF-25 Reset view name | Done (Codex) | The button reads "Reset view" and is labelled `aria-label="Reset view"`. |

The other big gaps from the brief:
1. **The palette** (above).
2. **Farmer navigation:** brief §9 suggests Home / Irrigation / Alerts / More. Codex kept the five tabs on purpose (prototype first), which is fine but still open.
3. **Staff navigation grouping:** as in the table.

Also found during the check: `fix/esp32-offline-buffer` has its own `0057_sensor_reading_device_dedupe.sql`. It is not part of this release. **Renumber it to 0060 before merging that branch**, because 0057 is now taken and applied.

## 2. Merge commits and conflicts

| Commit | What |
|---|---|
| 5f1b8f7 | Merge `fix/audit-oct22`. No conflicts. |
| 2267d00 | Merge `fix/i18n-remaining`. `en/af/tn.json` conflicted and were merged key by key with a three-way JSON merge. **0 keys were changed differently on the two sides.** Every key from both sides was kept: 1,174 in each language, checked for nothing dropped. |
| b27040c | Merge `feat/visual-redesign` (PR #3). There were 7 conflicts, resolved as in the next table. The translation files merged cleanly: 1,214 strings in each language. |
| 6981130 | Wiring (§3). |
| 14a8613 | The deep-link check, and the release evidence. |
| 7b8ea79 | Version 2.3.0, and the new strings added to the translation review. |

How the 7 conflicts in the PR #3 merge were resolved:

| File | Rule | Resolution |
|---|---|---|
| `components/BlurSheet.tsx` | Same file, both sides | Both sides translated the same labels with different keys and the same English text. My keys were kept. A duplicate `useI18n` import from the auto-merge was removed. |
| `components/DismissControls.tsx` | Same file, both sides | My key was kept (same text). |
| `components/DataState.tsx` | Styling → Codex | Codex's `FieldArtwork` and translated Retry label were kept (mine was hard-coded "Retry:"). A duplicate `const { t }` was removed. |
| `components/TodayCard.tsx` | My behaviour, Codex's styling on top | The translated advice and the "Shown in English" note are mine; Codex's Simple-view text size is applied to it. |
| `app/(tabs)/index.tsx` | My behaviour, Codex's styling on top | Codex's `FarmPostcard` comes first, then my "Where you are now" and the automatic-watering offer. Mine replaces `SetupCard`, which it still shows before 0058. The tank keeps my loading text and gains Codex's `TankIllustration`, which is **hidden while loading**, because an empty outline would read as "Unknown" before the answer arrives (AF-22). |
| `app/(tabs)/settings.tsx` | Both | Both sets of imports were kept. Codex's placeholder section was replaced during wiring (§3). |
| `app/setup.tsx` | Logic → mine; styles → Codex | My four-task wizard was kept. Codex's style changes were for the old 17-step screens, so styles they used that my wizard doesn't (stopwatch, date row, section chips) were dropped. Codex's filled-action token (`colors.action`) and disabled opacity are applied to my primary button and checkbox. My padding and centred text stay, so long Setswana labels still wrap. |

`vercel.json`: Codex's file is new (dev had none) and was kept as it is: 10 explicit public rewrites. `/staff/` and `/admin/` are real files (`staff/index.html`, `public/admin/index.html`), which Vercel serves before any rewrite, so nothing captures them. The deep-link check confirms this.

## 3. What was wired up

| Contract | Before | Now |
|---|---|---|
| Four farmer tasks + hosepipe progress | Hosepipe in Codex's catalogue only | Setup hub and "Where you are now" show `HosepipeProgress` from `journey.setupProgress` ("Your details: X of 4") and `journey.installation.stage` ("Installation: …"). Nothing is counted in the app. |
| Installer checklist | Staff case drawer (mine) | Unchanged and real. It now uses Codex's staff shell styles. |
| Case stage / "Where you are now" | Mine, with chips | Same facts, shown with the hosepipe and Codex's filled-action colour. |
| Terms acceptance | `LegalNotice` showed "awaiting approval, acceptance not recorded" | Settings → Terms & privacy shows each document's real version, date and draft status, and "You accepted these on …" **only when the server has recorded it**. Otherwise it says where to accept. It links to the full text (`/legal`). |
| Service status | Codex placeholder ("Contact AgroFlow for your service details") above my real card | The placeholder was removed. `ServiceSupportCard` (`GET /api/farmer/service`) is the one Service & support section. |
| Prices | Public /service-pricing hard-coded R4,000 and R610 | **New `GET /api/public/service-price`**, using the same staff-edited `service.*` settings as the farmer's card. The public page reads it on load and after in-page navigation, and keeps the published example if the API can't be reached. |
| Command status | `CommandPhaseLabel` in the catalogue only | The zone screen shows the server's `phase` (Request sent → Waiting for kit → … → No response) in the farmer's language. An API older than 0057 keeps the old line. |
| Tank summary | `TankIllustration` on Home and Tank with the real estimate | Kept, and hidden while loading. Unknown shows an empty outline labelled Unknown, never an empty tank. |
| Weather availability | Mine (available / missing / stale / unknown) | Unchanged. |
| Farm postcard header | Real farm name | Unchanged. |
| /terms, /privacy | Bundled copies, hard-coded "0.1-draft · 2026-10-23" | They read the version, date and text from `GET /api/public/legal[/{key}]`. An approved document drops the draft banner. The bundled copy (identical to the server's today) is the fallback. |

Simulated content left:
- Codex's `VisualCatalogue` (mobile) and `/component-catalogue` (web, Vite development only) are labelled "Simulated · catalogue only" and are not production routes.
- The "Try irrigation — simulation" panel and the demo farms' "Simulated" badges are deliberate and labelled.
- No placeholder text is left on production screens.

The hard-coded-English guard: the pending list was removed now that `fix/i18n-remaining` is merged, so the guard covers all 70 farmer files. It then found one more case: the `forgot-password` email placeholder, now `t('login.emailExample')`.

New tests:
- `releaseWiring.test.tsx` (4): Terms & privacy versions and recorded acceptance, not accepted, loading and failed states, and the hosepipe count.
- `irrigateRelease.test.tsx` (+1): the server phase "Waiting for kit", then "No response".
- `release-wiring.spec.ts` (4): the public price from the API on load and after navigation, its fallback, the approved terms without the draft banner, and a non-Markdown answer never replacing the document.

## 4. Test counts (`merge/oct23-release`)

| Check | Result |
|---|---|
| `dotnet test backend/AgroFlow.Domain.Tests` | **1543 passed**, 0 failed, 32 skipped. The skipped ones are the database tests, which run in the e2e below. |
| e2e simulation `hardware/sim/run-e2e.mjs` | **37 passed, 0 failed**, including the API database tests: 54 of 54. |
| Migration replay ×2 + verify-migrations | All 55 migrations apply from empty. 0007 and 0010 re-run with no change, and 0057, 0058 and 0059 re-run with no change. verify-migrations: 56 rows, all migration rows true. |
| Admin build (tsc + vite) | OK |
| Admin Playwright, full run (`PW_PORT=5195`, run alone) | **214 passed, 1 failed** of 215. The failure is the known flaky homepage 3D demo test (experience-agroflow:16): it timed out at 15 s waiting for the cutaway graphic after navigation. Rerun alone it **passed twice**. The other 3 tests that failed on timing last time (recommend:80, requests:98, robustness mqttLogins) **passed in the full run**. None of these truly fails. |
| Mobile `tsc --noEmit` | clean |
| Mobile jest | **25 suites, 319 passed** |
| `expo export` web and android | both OK |
| Deep-link refresh (`apps/web/admin/scripts/check-deep-links.mjs`) | **17 passed, 0 failed**. All 11 public routes open fresh and after a refresh, with the right nav link highlighted and the logo loaded. `/staff/`, `/staff`, `/admin/` and `/#/admin` reach the staff sign-in, and `/staff/` survives a refresh with the logo. An unknown address is a real 404. The check serves the production build the way Vercel does: files, then the `vercel.json` rewrites, then 404. The live deployment has not been checked from here. |

Evidence is in [docs/test-evidence/release-oct23/](../test-evidence/release-oct23/).

## 5. Final status of AF-01 to AF-25 and B3-01 to B3-07

| ID | Status | Where |
|---|---|---|
| AF-01 / B3-01 | Fixed | Recoverable onboarding, coordinates win, retry continues the same farm |
| AF-02 | Fixed. af/tn are drafts awaiting review. | Every farmer screen goes through translation, with no exceptions in the guard; advice is sent as a code |
| AF-03 | Fixed | Weather available / missing / stale / unknown |
| AF-04 | Fixed | Alert read state is saved first |
| AF-05 | Fixed | The cap in the API and the database, the capped message, and the capped schedule length |
| AF-06 | Fixed | One tank summary |
| AF-07 | Fixed | Areas never shown as 0 ha |
| AF-08 | Fixed | Settings links return to Settings |
| AF-09 | Fixed | Awaiting installation, visit booking, installer checklist |
| AF-10 | Fixed (Codex) | Token contrast tests |
| AF-11 | Fixed (Codex) | Mobile menu |
| AF-12 | Fixed (Codex) | Zoom allowed |
| AF-13 | Fixed (Codex); not tried with a physical screen reader | Radio and dialog semantics |
| AF-14 | Fixed (Codex) | Gallery keyboard access |
| AF-15 | Fixed | Plain weather health message |
| AF-16 | Fixed (Codex), verified | Logo on every route and on /staff/ |
| AF-17 | Fixed | Forecast Retry |
| AF-18 | Fixed | Advice dates and crop model |
| AF-19 | Fixed | Request area unit |
| AF-20 | Fixed | Phone rule |
| AF-21 | **Not done** | Hosting headers; start with a report-only CSP |
| AF-22 | Fixed | Loading states; the tank picture is hidden while loading |
| AF-23 | Fixed | Staff counts from `farm_member` |
| AF-24 | Fixed | Enquiry linked to an existing farmer |
| AF-25 | Fixed (Codex) | Reset view name |
| B3-02 | Fixed | Four tasks, save on Continue, the hosepipe |
| B3-03 | Fixed | "Where you are now" on Home and in the staff case |
| B3-04 | Fixed (Codex), verified | One brand component; loads on every entry point, including after a refresh |
| B3-05 | Fixed (Codex), verified locally | Separate pages, with deep links passing against the build served as Vercel does |
| B3-06 | Partly (Codex) | The About page has the requested blocks. Real team and contact details and the Mafikeng Cisco Edge Centre attribution need your approval before publishing. |
| B3-07 | Fixed (Codex) | Gutters and boundaries; Codex's evidence at 320, 390, 768 and 1366 px |

## 6. What to check on your phone and the live sites

**On your phone**: the farmer app, version 2.3.0, a new APK or the web app:
1. Sign in with a farmer who has not finished setup. Home shows the farm postcard, then "Where you are now" with the hosepipe ("Your details: X of 4") and "Installation: …". Tap Continue: the four tasks.
2. Do one task with the keyboard open. The Save and continue bar stays visible above the keyboard. Back keeps your answers. Try both themes and Setswana for clipped labels.
3. Settings → Help and documents → Terms & privacy shows "Version 0.1-draft, 2026-10-23" and "Draft – needs approval". After accepting under Your preferences → Before you start, it says "You accepted these on …".
4. Settings → Service & support appears **once**, with the example price and your service status.
5. On a zone with a kit, tap Irrigate. The line reads Request sent / Waiting for kit, then Kit confirmed start, then Finished. With the kit unplugged, after about a minute it reads **No response**. Don't run real water for this unless you mean to.
6. Simple view on and off. The tank picture shows the real estimate, and an empty outline only when the level is unknown.

**On the live sites**: after Vercel deploys `dev` and `feat/expo-web`:
1. Open each public address **in a new tab and refresh**: `/`, `/experience`, `/solutions`, `/how-it-works`, `/technology`, `/about`, `/get-the-app`, `/contact`, `/service-pricing`, `/terms` and `/privacy`. Each needs its own title and a logo, with no 404.
2. `/staff/` and `/admin/` reach the staff sign-in, and the logo shows; refresh on `/staff/`. Sign in, then open a farm's case and its installer checklist.
3. `/service-pricing` shows R4,000 and R610. Change a price in staff Settings (`service.*`) and reload: the public page shows the new number. Change it back afterwards.
4. `/terms` shows "0.1-draft · 2026-10-23" with the draft banner.
5. Decide on the **palette** (§1): blue as merged, or the brief's Forest, Cream and Sage. It's a token change in `apps/mobile/src/constants/colors.ts` and `apps/web/admin/src/styles/visual.css`.

## 7. Branches now safe to delete

All of these are fully contained in `dev` after this release. Nothing was deleted.

| Branch | Why it's safe |
|---|---|
| `merge/oct23-release` | Merged into dev |
| `fix/audit-oct22` | Merged |
| `fix/i18n-remaining` | Merged |
| `feat/visual-redesign` | Merged. Close draft PR #3 as merged. |

Kept: `fix/esp32-offline-buffer` (not merged; renumber its 0057 first), `main`, and everything not listed above.
