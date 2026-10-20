# Overnight report: 21 October 2026

## Summary

**Everything merged.**
- **Step 1:** `feat/drought-community` and `fix/app-spacing` went into `dev`, with the app at
  version 2.2.0. All checks passed, and `dev` then went into `feat/expo-web`.
- **Step 2:** the visual fixes a–h were built on `fix/visual-polish`.
- **Step 3:** that branch passed every check except the 3D demo test, which was already
  failing intermittently on `dev` (it passed when rerun). It was merged into `dev`, then into
  `feat/expo-web`.

`app.json` stays at 2.2.0, ready for you to build the APK. Nothing was force-pushed and `main`
was not touched. There are no new migrations and no changes to the database, the FAO-56
engine, `PrimaryAction` or the firmware.

| Branch | Tip | Pushed |
|---|---|---|
| `dev` | `aa0cec1` (merge of fix/visual-polish) | yes |
| `feat/expo-web` | `90289a9` (merge of dev) | yes |
| `fix/visual-polish` | `f3d8a08` | yes (merged) |
| `feat/drought-community` | `289f165` | yes (merged) |
| `fix/app-spacing` | `30b95a3` | yes (merged) |

## Step 1: the merges, and how each conflict was resolved

Before merging, `feat/drought-community` got the follow-ups from the verification report
(`289f165`):
- **Fire directions:** the app sends words. The API also accepts N…NW from older builds and
  saves the word.
- **Tests added or restored:** the 3 dropped wizard tests; staff never get Telegram for
  drought or community alerts; the efficiency note in Today's Why; the Simulation-flag
  drought demo.
- **Wording:** the soil note in en/af/tn, and plain words in admin moderation.

| Merge commit | What |
|---|---|
| `1d9366e` | `feat/drought-community` into `dev`: no conflicts |
| `e85710b` | `fix/app-spacing` into `dev`: 5 conflicts, resolved as below |
| `3333aee` | `apps/mobile/app.json` 2.1.0 to 2.2.0 |
| `48aea8a` | `dev` into `feat/expo-web`: no conflicts |
| `aa0cec1` | `fix/visual-polish` into `dev` (Step 3): no conflicts |
| `90289a9` | `dev` into `feat/expo-web` (Step 3): no conflicts |

How the conflicts in `e85710b` were resolved:
- **`apps/mobile/src/i18n/en.json`, `af.json`, `tn.json`:** merged key by key against the
  common base (`ef0bc0e`).
  - A key added or changed on one branch keeps that branch's value.
  - No key had been changed on both branches.
  - Each file ended with 599 keys: every 17-step wizard, drought and community key, and every
    label, empty-state and irrigation key.
- **`apps/mobile/src/app/(tabs)/index.tsx`:** kept both sides' imports. Home keeps the
  "Setup X/17" card, the drought card, the Today cards and the metrics grid; checked in the
  screenshots.
- **`apps/mobile/src/app/zone/[id].tsx`:** the spacing branch's soil tile (translated label,
  empty states) with the drought branch's translated soil note.
- **`apps/mobile/src/app/setup.tsx`:** merged by itself into the 17-step wizard with the
  spacing branch's 16 px gutter and bottom padding. I checked that the padding hook comes
  before any early return.

## Step 2: visual fixes a–h (`fix/visual-polish`)

Screenshots are in `docs/test-evidence/visual-polish/before` and `.../after`. The app is at
390 px; the admin and public site are at 1366 px and 390 px.

| | Fix | Status | Files | Screenshot (after) |
|---|---|---|---|---|
| a | Zone screen: Sensor Readings, Water Usage, Zone Details | **Partly** (see note) | `apps/mobile/src/components/ZoneOverviewCards.tsx`, `app/zone/[id].tsx`, `context/AgroFlowContext.tsx` | `390-zone.png`, `390-zone-nokit.png` |
| b | Soil-feel sheet | Done | `components/BlurSheet.tsx`, `components/ManualLogSheet.tsx`, `styles/todayStyles.ts` | `390-soil-feel-sheet.png` |
| c | Public site and the staff console on separate addresses | Done | `apps/web/admin/src/main.ts`, `pages/welcome.ts`, `pages/login.ts`, `app/auth.ts`, `staff/index.html`, `scripts/make-staff-page.mjs`, `vite.config.ts`, `public/admin/index.html` | `1366-public-top.png`, `1366-public-footer.png`, `1366-staff-sign-in.png` (and 390) |
| d | App screenshots on the product page | Done | `pages/welcome.ts`, `public/media/app/*.jpg`, `styles/main.css` | `1366-public-app-screens.png`, `390-public-app-screens.png` |
| e | Remove-account flow | Done | `app/interactions.ts`, `pages/users.ts` | `1366-admin-remove-confirm.png`, `1366-admin-remove-done.png` (and 390) |
| f | Loading: spinner, 10 s "Taking longer than usual" with Retry, error state | Done | `ui/components.ts`, `app/router.ts`, `styles/main.css` | `1366-admin-loading.png`, `1366-admin-loading-slow.png` (and 390) |
| g | No "Why am I seeing this?" in the admin | Done | `app/interactions.ts`, `ui/components.ts`, `ui/patterns.ts`, `lib/why.ts`, `styles/main.css` | `1366-admin-home.png`, `1366-admin-alert-drawer.png` |
| h | Every farmer screen: edges, raw values, translations | **Partly** (see note) | `app/login.tsx`, `forecast.tsx`, `reports.tsx`, `(tabs)/profile.tsx`, `zone/[id].tsx`, `context/AgroFlowContext.tsx`, `i18n/*.json` | `390-*.png` (every screen, top and bottom) |

### a. Zone screen (Partly)

What's in place:
- **Sensor Readings** replaces "Live readings". It has tiles for Soil Moisture, Temperature,
  Humidity, Water Tank and Flow.
  - Each tile shows a value, a unit and an icon.
  - Text wraps and is never cut off. A tile with no reading shows "—" and "No reading yet".
  - The card shows how old the readings are ("Updated 5 min ago") and has a Refresh button.
- **Water Usage** shows Today, This month and Water saved (est.). "This month" is the sum of
  this month's watering events, which the app already loads; there's no new request.
- **Zone Details** has an Edit button that opens the existing edit sheet. It shows only stored
  fields: crop, planted, soil type, size, place, watering mode, start and stop moisture, and
  longest run.
- **Below the new cards:** Irrigate, advice, schedule and kit status are unchanged in
  behaviour.

Why Partly: the status words come only from thresholds that already exist.
- Soil uses the zone's own start and stop moisture (Low / Good / High).
- The tank uses its existing low-level flag (Low / Good).
- Any tile shows "Check sensor" when a kit has stopped reporting.
- **Temperature, humidity and flow have no thresholds in AgroFlow, so their tiles show the
  value without a status word** rather than an invented one. "Normal" is unused for now.

Also:
- The zone screen has no drought card; the drought card is on Home, unchanged.
- The tank screenshot reads "Good" at 20% only because the mock leaves out the API's
  low-tank flag. The real API sends it.

### b. Soil-feel sheet

- The title wraps.
- Dry, Moist and Wet are three equal, full-width buttons, stacked.
- The body has the 16 px gutter.
- The sheet still sits above the tab bar and the phone's bottom edge.

### c. Public site and staff console

- **Public site:** both "Staff sign-in" links are removed, and nothing on it links to the
  console. No link labelled "Admin console" existed in the code; the staff links were the
  only ones.
- **`/staff/`:** staff sign in there, and the console lives there too (for example
  `/staff/#dashboard`). It's a second page in the build, generated from `index.html` before
  every build.
- **The root address:** always opens the product site, even with a staff session.
- **Old addresses:** `#/admin`, `#/login` and `/admin/` forward to `/staff/`.
- **Log out:** returns to staff sign-in.
- **Password reset:** links still use the root `?reset=1` address, the one on Supabase's
  allow-list, and then continue to `/staff/`.

### d. Product page

- A new "The app" section shows seven phone-framed screenshots: Home, Sensor readings, Water a
  zone, Alerts, two setup steps and Drought mode.
- They come from the simulated Mahikeng farm only, and each has alt text and a caption.
- On a phone they scroll sideways; on a wide screen they're a grid.

### e. Remove-account flow

- The question reads "Remove <name>'s account? Their farm, zones and readings stay on record."
  with a plain button, not the warning style.
- On success, a toast with a tick says "<name>'s account was removed. Farm records were kept."
- The list's red "Delete" link now reads "Remove account". The warning style is only used if
  removing fails.

### f. Loading

- Every page shows a spinner and "Loading…".
- After 10 s it shows "Taking longer than usual" with a Retry button, which loads the page
  again. A bug was found and fixed here: the busy page blocked clicks, so Retry couldn't be
  pressed.
- A page that fails shows the error state with its own Retry.

### g. No "Why am I seeing this?" in the admin

Removed everywhere in the admin:
- Home's tiles and needs-attention cards;
- the farm's Today and confidence cells;
- the advice lists and the attention-group drawer;
- the alert drawer, which no longer fetches the explanation.

The farmer app keeps its Why sheet.

### h. Every farmer screen (Partly)

Done:
- **Raw values:** "Health: Unknown" reads "Not enough data yet". Alerts no longer read
  "warning Alert"; the stored severity becomes "Urgent alert" / "Needs a look" / "For your
  information". "leafy_veg" and the stats row were already fixed by `fix/app-spacing`.
- **Cut-off text:** the zone's Mode / Valve / Health values wrap instead of "Not enoug…".
- **Translated in en/af/tn:** the zone's lower sections, sign-in, Forecast, Reports and
  Profile. Tank was already translated.
- **Soil note:** the old "Optimal/Dry/Wet" note became a status word on the soil tile.

Why Partly:
- **The rest of sign-in and reset:** the forgot-password and set-password screens, and the
  kit, soil and crop screens, still have some English-only text. About 60 strings are left;
  it ran out of time, not blocked.
- **Brief wording:** "Unknown 0" → "Scheduled: 0" was already covered: the stats row reads
  "On a schedule 0" and "Watering now".

## Step 3: checks

| Check | dev (Step 1) | fix/visual-polish (Step 3) | feat/expo-web |
|---|---|---|---|
| `dotnet test` | 1 503 passed, 19 skipped, 0 failed | 1 503 passed, 19 skipped, 0 failed | – |
| e2e kit simulation | 26 of 26 (DB tests 41 of 41) | not changed (no backend change) | – |
| Migration replay + `verify-migrations.sql` | 52 migrations; 52 of 53 rows true; 0053–0056 re-run twice cleanly | – | – |
| Admin build | passes | passes (now two pages: `/` and `/staff/`) | passes |
| Admin Playwright | 143 of 143 | 142 of 143 (see below) | – |
| Mobile `tsc` | 0 errors | 0 errors | 0 errors |
| Mobile jest | 187 of 187 | 187 of 187 | 187 of 187 |
| `expo export` web / android | pass / pass | pass / pass | web pass |

Notes:
- **Skipped `dotnet` tests:** the 19 are DB tests, which run inside the simulation.
- **Migration replay:** the only false row is the storage bucket, which only exists in
  Supabase.
- **Playwright on `fix/visual-polish`:** the one failure is the 3D demo (`experience-agroflow`
  "homepage demo opens…"). It's the intermittent failure already seen on `dev`, and all 3 tests
  in that file pass on a rerun.
- **jest on `feat/expo-web`:** the first run had 2 timeouts in the community tests on a busy
  machine. They pass alone, and that file now warms its renderer first.

## What ran out of time or couldn't be done

- **Admin BEFORE screenshots of the console:** on `dev`, the start-up splash never cleared in
  the screenshot runs (it does on this branch). Only the product page BEFORE shots were saved.
  For the console as it was, see `docs/test-evidence/release-oct-19/admin`.
- **Translations:** the rest of the forgot/set-password, kit, soil and crop screens (about 60
  strings). New af/tn strings are drafts that need review, as before.
- **Sensor status words:** for temperature, humidity and flow, waiting on thresholds AgroFlow
  doesn't have yet.

## Please check on your phone

1. **Zone screen:**
   - The Sensor Readings tiles show the right values and units for a real kit, and Refresh
     updates "Updated … ago".
   - The Water Tank tile says Low when the tank is low.
   - "This month" matches what you expect.
2. **Zone Details:** Edit opens the zone edit sheet and saves as before.
3. **Soil-feel sheet ("How does the soil feel?"):**
   - The title wraps.
   - The three buttons are equal and full width.
   - Nothing hides under the tab bar or the bottom edge, on Android and an iPhone.
4. **Irrigate:** works exactly as before. Water now, stop, and the max-run note.
5. **Translations:** switch to Afrikaans and Setswana and look at sign-in, Forecast, Reports,
   Profile and the zone's lower sections.
6. **Alerts:** titles read "Needs a look" / "Urgent alert", not "warning Alert".
7. **Status bar:** no grey haze at the top on Android, iPhone web and Android web (from
   `fix/app-spacing`).
8. **The website:**
   - The root address shows the product site, with no staff link.
   - `/staff/` shows sign-in, and the console after signing in.
   - Old bookmarks (`/#/admin`, `/admin/`) land on `/staff/`.
   - A password-reset email link still works.
9. **Product page:** the seven app screenshots load and look right on a phone.
10. **Admin:** removing a farmer shows the plain question and then the tick message. A slow
    page shows "Taking longer than usual" with Retry after 10 s.
