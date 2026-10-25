# Premium visuals — 24 October 2026

`feat/premium-visuals`, from verified latest `dev` at `3d0ea56`.
PR #4 is an ancestor; Claude's Kit tab (`19c44e7`) and retest (`3d0ea56`) merges
were checked before branching. The original workspace and its firmware edit were
left untouched. This PR is presentation only: **do not merge it automatically**.

## What changed

**GO GREEN**, as selected by the user: #176B45 primary, #104B38 dark green,
#F7F8F4 warm background and #172822 text. Dark foregrounds are contrast-adjusted;
earth/gold/sky remain accents and operational status colours retain their meaning.
The dated colour decision is in the 22 October audit/design brief.

- Public: cinematic landscape hero with the same copy and CTA destinations;
  alternating photo/text features on Home and Solutions, irrigation imagery on
  How it works, seedling imagery on About, supplied photo backgrounds behind the
  existing Technology controller. Existing gallery, enquiry and demo wiring stays.
- Farmer: compact aerial postcard, id-stable farm-picker thumbnails with existing
  names/locations/status, conditional crop artwork on irrigation cards, contextual
  sensor photography separate from opaque numbers, and a green gradient dock.
- Staff: restrained Overview, Maintenance and Reports photo strips; id-stable farm
  card covers and a small farm-detail photo. KPIs, charts, tables, alerts and audit
  information are not replaced or painted over.
- Shared: reusable image registries/components, responsive WebP variants, fixed
  aspect ratios, lazy below-fold images and no new loading gate. Hero alone has
  eager/high-priority loading. No image prefetch of the full collection is added.
- Contrast fixes: dark date/form controls and selected settings tabs now use theme
  surfaces. Operational surfaces and navigation remain opaque; decorative photo
  overlays do not sit behind readings, watering controls, Stop or alerts.

## Images and performance

All **10 supplied originals** were read from
`apps/web/admin/public/images/agroflow/`; no replacement photographs were downloaded
or generated. Only the explicitly attached brief was read from Downloads.
Original files are unchanged. The optimizer removes metadata from derivatives
and never upscales the six 512px-wide originals.

| Original stem (`agroflow_…`) | Main placement |
| --- | --- |
| `hero_farm` | Public hero; generic farm fallback |
| `farm_aerial` | Farmer postcard, staff Overview, generic farm fallback/Technology scene |
| `sprinkler_closeup` | Public irrigation feature; mobile registry available |
| `field_irrigation` | Public feature/How it works; generic fallback/Technology scene |
| `planting_seedling` | Public sustainability/About; mobile registry available |
| `tomato_greenhouse_evening` | Mobile zone artwork only when existing crop data says tomato |
| `water_reservoir` | Public water-management feature, staff Reports, generic farm fallback |
| `more_field_sensor` | Public monitoring feature and farmer sensor section |
| `more_leafy_crops` | Leafy-crop artwork only for supported crop data; representative Technology rows |
| `more_water_tanks` | Staff Maintenance; mobile registry available |

Original total: **3,777,224 bytes**. The 10 mobile copies total **492,332 bytes**
(about **87% smaller**). There are **24 distinct web variants**, totalling
**1,205,438 bytes**; a browser selects one size per displayed image, not all 24.
Actual dimensions/bytes are in
`apps/web/admin/src/ui/agroflow-images.manifest.json`. Sizes are capped at the
original width, so no fake 960w/1600w descriptors or duplicate upscaled variants.
New variants are in `public/images/agroflow/optimized/`; mobile copies are in
`apps/mobile/assets/images/agroflow/`.

Reproduce from any working directory:

```powershell
cd apps/web/admin
npm ci
node scripts/optimise-agroflow-images.mjs
```

Photos are always **representative**, never proof of a named customer's farm,
installed equipment or a crop absent from the actual data. Public photos and farm
cards carry a small disclosure. Farm fallback choice is a deterministic hash of
id, not randomness or a guessed crop. Crop artwork is conditional; otherwise the
fallback is a landscape. The new en/af/tn caption is localized; af/tn remain drafts.

## Preserved behaviour and boundaries

No backend, firmware, migrations, API contracts, services, auth/context state,
agronomy or PrimaryAction changes. No route added, removed, renamed or redirected.
The irrigation route file has only image imports/markup; no handlers changed.
The staff interactions file has only an image helper import/template insertion.

Home / Irrigation / Kit / Alerts / More, Kit checklist/help, four-task setup,
hosepipe progress, terms preview, loading/empty/error state branches, existing
commands, schedules and reports are preserved. The layout remains 1200px with
16/24/32px public gutters; the existing bounded farmer frame is unchanged.
Reduced-motion CSS disables the optional image entrance/hover transitions; native
images use zero transition. No blur/native rendering dependency was added.

## Verification and screenshots

Evidence names are `home-light-390.png`, `staff-dashboard-dark-1366.png`,
`farmer-home-light-390.png`, etc. Each changed theme surface is captured at
**390×844 and 1366×768**, Light and Dark. Public/staff tests visit 11 public and
14 staff routes (100 route-size-theme combinations); farmer checks visit 19 routes
(76 combinations). The real web export is served locally with intercepted fake
API/Supabase hosts. All farmer screenshots use labelled simulated Mahikeng fixture
data, not real customer records or evidence of live persistence.

| Check | Result |
| --- | --- |
| Admin install, TypeScript, production build | Pass; existing >500kB bundle warning |
| Full Playwright | **247 / 247 passed**, configured single worker, 26.8 minutes; zero skips |
| Mobile install, TypeScript | Pass; existing npm peer/deprecation warnings |
| Mobile Jest | **31 suites / 361 tests / 1 snapshot passed** |
| Mobile web export | Pass |
| Mobile Android export | Pass (JS/Hermes/assets; not an APK build or a device test) |
| Farmer browser checks | **76 checks passed**, zero contrast/image-alt failures, page errors or horizontal overflow |
| Axe screenshot matrix | **176 scans**, zero contrast or image-alt violations, confirmed in final full-suite run |
| Deep-link/header checks | **20 public/staff + 6 farmer checks passed** |

Axe JSON files include **all** findings, not only contrast. The tests require zero
`color-contrast` violations; several other semantic findings (landmarks, heading
hierarchy, label/name associations) remain recorded rather than concealed. Some
offscreen carousel captions and symbol-only controls are axe manual-review items.
This is not an overall WCAG certification or a claim that every axe rule passes.

Other rules recorded across this matrix: `page-has-heading-one`, `empty-heading`,
`empty-table-header`, `label`, `scrollable-region-focusable`, `nested-interactive`,
`aria-required-attr`, `landmark-one-main`, `label-content-name-mismatch`,
`select-name`, `aria-required-children`, and `region`. Their exact affected nodes
are retained in the per-page JSON for separate accessibility triage.

Run history: initial snapshot failure contained only the requested token changes;
the reviewed snapshot was updated. The image manifest was moved from public to
source for Vite development imports. Initial dark date-field and selected-tab
contrast failures were corrected. No logic changes or error filtering were used
to hide a test failure. The first full two-worker run had **245 passed / 2 failed**:
the demo cold-open timed out and a legacy assertion expected blue theme values.
The colour assertion was updated for the requested green tokens; both cases then
passed three consecutive repetitions. The final configured single-worker full
run passed **all 247**. Expo's web image implementation did not forward its `alt`
alias to the current image node, so the supported `accessibilityLabel` prop is
used explicitly; the final farmer matrix has no missing image alternatives.

Not run: physical Android/iOS or assistive-technology testing, APK/EAS build, iOS
export, Safari/Firefox, live accounts/ESP32, backend/firmware suites (unchanged),
production deployment or fluent-speaker review. No migration is introduced.

## Local review and handoff

From this branch, in separate terminals:

```powershell
cd apps/web/admin
npm ci
npm run dev -- --host 127.0.0.1 --port 5188
```

Open `http://127.0.0.1:5188/`, `/about`, `/technology`, and `/staff/`.
Vite's developer server is not a production rewrite/header check; those were
tested separately against the production artifacts as recorded above.

```powershell
cd apps/mobile
npm ci
npx expo start --web --port 8088
```

Open `http://localhost:8088/`. Normal startup uses the developer's existing local
configuration and requires a real authorized account for protected screens. Do
not copy the test fixture into application services to make a preview appear
populated. The screenshots and browser harness use intercepted fixtures only.

For Claude / the next logic owner: retain the existing Kit checklist and five
tabs; the four-task setup and hosepipe progress are still the implementation from
`dev`, not a new wizard. Validate real account/farm/kit selection, setup completion
and persistence through the existing services, then refresh and sign in again;
fixture screenshots do not establish those behaviours. Terms acceptance remains
the inherited preview/feature-setting flow; this visual PR does not enable it or
apply its earlier migration. Review any outstanding logic or persistence in a
separate branch, never by replacing honest empty/error states with demo records.
Representative photos are static presentation, not uploaded customer farm photos.
