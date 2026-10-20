# Overnight report: release/oct-19 (20 October 2026)

**NOT MERGED.** `release/oct-19` is pushed, but **dev and feat/expo-web were not touched**.
Step 5 only allows the merge if no migration beyond 0050 was added tonight. Two were added and
are needed: **`0051_command_finished.sql`** (fix d, "executed" vs "finished") and
**`0052_zone_max_run.sql`** (fix a, per-zone maximum run time). Apply them in that order and run
`docs/ops/verify-migrations.sql` (see the by-hand list at the end), then merge.

## Summary

1. **Merged into dev:** no. Two new migrations (0051, 0052) were needed (above).
2. **Merged into feat/expo-web:** no, for the same reason.
3. **Ready for the phone test:** yes, from `release/oct-19`, once 0051 and 0052 are applied and the API is deployed from this branch. Every automated check passed, apart from one admin test that failed once on timing and passes on its own (below).
4. **Firmware:** it is **v1.6.0**, not v1.5.1. Fix a needs the kit to enforce the zone maximum and the 3-minute lost-connection stop. Flash 1.6.0.
5. **Watch on the phone:** the offline banner said "Nothing has been saved on this phone yet" in the mocked web screenshot while the farm was still on screen. This may be a quirk of the test session. Check it on a real phone.

## Branch and merges

`release/oct-19` was made off `origin/dev` (947ee32). Every merge used `--no-ff`, in this order:

| # | Merge | Conflicts | How they were resolved |
|---|---|---|---|
| 1 | feat/sponsor-admin (c820299) | none | |
| 2 | feat/sponsor-mobile (f79422f) | none | |
| 3 | fix/irrigate-path (5bc721b) | `apps/mobile/src/app/zone/[id].tsx`, `apps/mobile/src/context/AgroFlowContext.tsx` | The same conflict was resolved on feat/setup-wizard (60aea9b), on the same base: the release tree equalled sponsor-mobile. The resolution was taken from 60aea9b: the zone screen and context, plus the en/af/tn strings and the test it added. Afterwards the tree matched 60aea9b exactly. Part 0's Manual mode and 1–5 min run are kept, with sponsor-mobile's translations. |
| 4 | feat/setup-wizard (6bfae3e) | `apps/mobile/src/i18n/en.json`, `tn.json`, `af.json` | The same irrigate-path strings reached both sides through different merge commits. Setup-wizard's files were taken, since they hold both; the tree then equalled origin/feat/setup-wizard. |
| 5 | feat/telegram-reset (868c6fa) | none | Tree equalled origin/feat/telegram-reset. |
| 6 | feat/kit-offline (983e9a4) | `hardware/esp32/AgroFlowIrrigationNode/AgroFlowIrrigationNode.ino` (3 hunks: version line, feature list, `FIRMWARE_VERSION`) | **v1.5.1** as planned: kit-offline's notes 7 (offline buffer) and 8 (local page), plus the zone-mode note as 9. The code merged cleanly, and the README and bring-up guide were updated to match. Fix a then made it **v1.6.0**. |
| 7 | fix/migration-replay (7751574) | none | |

## Commits on release/oct-19 (after the merges)

| Commit | What |
|---|---|
| 8779c5c | fix a, first version: refuse manual runs over 300 s. **Superseded by 6482c3b.** |
| ebfe824 | fix c: no Irrigate without a connected kit. The API refuses a start at once (409 "No kit connected to this zone.", reason `no_kit`/`kit_offline`), and the app turns Irrigate off with the same words. |
| ff6e820 | fix d: "executed" (started) and "finished" are separate. Migration 0051, and runs are linked to their commands. `GET /api/farmer/commands/{id}` and `/zones/{id}/commands` return sent / started / finished / no_response / failed. History rows say "Watering finished". |
| 010f730 | fix b: after Irrigate the app shows "Sending…" → "Kit started watering" → "Finished", or "Kit didn't respond — check it's online" after 60 s. |
| 024d8a9 | fix e: weather warnings are saved in the app as a farm-wide alert, as well as sent on Telegram to linked farmers. |
| 26c23ed | docs: docs/irrigate-path.md items 4–7. |
| 6482c3b | fix a, final: per-zone maximum run time (migration 0052; default 5, staff set 1–120 in the farm drawer, audited). The API refuses runs above it, the app's picker uses it, and every command carries `maxRunSeconds`. Firmware 1.6.0 runs min(asked, maximum), never over 120 min, and stops a server-started run after 3 min without MQTT. Home shows "Recommended 66 min — your pump is limited to 5 min per run; run it again after it finishes". |
| a214c86 | fix f: Telegram is for farmers only. Staff can't link it (API and bot), already-linked staff are unlinked at start-up with an audit entry, and staff notices moved to Home's Needs attention and a new bell. Staff reset by email only ("check your spam folder"), and Change password is in the account menu. |
| a66fc3b | Simulation: the release checks end to end, plus 8 database tests of the API's routes on a real Postgres. The migrations now replay with no workaround. |
| 57ef2eb | Audit fixes: the flow-test tip names no container size; "Tub" fixture names became "Bed"; the polish tests were re-pointed (staff have no Telegram panel). |
| c7906d6 | Screenshots (66): 46 mobile and 20 admin. |
| (this commit) | This report. |

Staff notices that moved off Telegram (full list in `docs/telegram-farmers-only.md`):
1. A new farm or zone request → Requests, Home "New requests waiting", the bell.
2. A new enquiry → Enquiries, Home "Enquiries waiting for a call", the bell.
3. A call-back due → Home "Call-backs due", the bell.
4. A kit offline or faulty, or a critical zone alert, which reached a staff member on a farm → Kits / Alerts, Home, the bell. Farmers still get these on Telegram.
5. Weather, sensor and equipment alerts for a farm: staff are left out; farmers are unchanged.
6. The automatic-report copy to the staff member who set up the schedule, and to the admin group chat: stopped. Staff see reports in the admin site.

## Every test run (on release/oct-19, final state)

| Check | Result |
|---|---|
| `dotnet build` API, Release | **0 errors**, 4 warnings. All 4 are older: an obsolete PDF-library setting in Program.cs and ReportShell.cs, and two in RecommendationEndpoints.cs. |
| `dotnet test` (AgroFlow.Domain.Tests, the only test project) | **1453 passed, 0 failed, 8 skipped** (1461). The 8 skipped are the database tests: they need the simulation's Postgres and run inside it (next row). |
| End-to-end simulation (`hardware/sim/run-e2e.mjs`) | **19 passed, 0 failed**, including the database tests (**8 of 8**). Enrol (code works once), online, readings stored, late readings stored once without watering (and the same reading live does water), a **Manual zone never auto-waters** and its kit is told not to water offline, a 1-minute Irrigate reaches the kit with `maxRunSeconds` 300, is acknowledged and its run report marks it **finished** in the history, a zone limited to 3 min sends 180 s, the **lost-connection failsafe** stops a run, and a kept run uploaded twice counts once. The database tests check: **no kit refused**, **kit offline refused**, **over the zone maximum refused**, sent → started → finished through the real device routes, the staff-only maximum (the database checks 1–120 too), staff Telegram refused and unlinked with an audit row, no temporary password for staff, and a frost warning saved in the app once. |
| Migrations on an empty embedded Postgres, twice (two fresh databases) | **All 48 applied** (0001–0052) as written. Re-running 0007 and 0010 changed nothing. `verify-migrations.sql`: **49 rows, all true** except the storage-bucket row, which needs Supabase Storage (expected locally). 0049–0052 also run a second time cleanly. Evidence: `docs/test-evidence/release-oct-19/migration-replay.json`. |
| Admin `npm run build` | passed |
| Admin full Playwright | **129 passed, 1 failed** (130) in the final full run. The failure was `experience-agroflow.spec.ts` "homepage demo opens…": the 3D demo dialog had not opened when the test looked. That spec and the demo code are unchanged from dev. It passed in the earlier full run, and passes **6 of 6** when run on its own (`--repeat-each 2`). This is a timing flake, not a release fault. The earlier full run was 127/130; its 3 failures were the staff Telegram panel tests, fixed in 57ef2eb. |
| Mobile `tsc` | 0 errors |
| Mobile `jest` | **136 passed**, 17 suites, 0 failed |
| `npx expo export --platform web` | passed |
| `npx expo export --platform android` | passed |
| Firmware `arduino-cli compile` (esp32:esp32:esp32, from a copy with secrets.example.h) | passed: **1,216,292 of 1,310,720 bytes (92%)**, under 95%. RAM 19%. |
| Native firmware tests | `offline_buffer_test` **170 checks, 0 failed**; `run_limits_test` **17 checks, 0 failed** |
| Screenshots | 66 under `docs/test-evidence/release-oct-19/`. **Mobile (46):** the setup wizard (every step); Home online and offline; the zone screen's Irrigate states; Settings in en/af/tn; temporary-password sign-in; Telegram reset and one-tap. **Admin (20):** Home with the bell, the farmer page (Unlink Telegram, Reset password), the max run time, Change password, the product page, staff Forgot password. **No page errors.** The only console errors are 6 "Failed to load resource" from the offline shots, on purpose. |

## Step 4: requirements audit

| Requirement | Status | Proof |
|---|---|---|
| Clear delete message | Done | sponsor-admin.spec "removing a farmer asks first…", "…shows a success toast that says what was kept" |
| Loading indicator | Done | sponsor-admin.spec "a loading page shows a spinner and Loading…, then the connection hint after 8 s" |
| Staff-only admin | Done | sponsor-admin.spec "a farmer who signs in is shown the staff-only message…" |
| Product page | Done | sponsor-admin.spec "the public page links to staff sign-in…", polish.spec landing tests; screenshot admin/*-product-page.png |
| Forgot password | Done | sponsor-admin.spec (staff email + spam), PasswordResetFlowTests, mobile passwordReset.test.tsx |
| Unlink Telegram | Done | sponsor-admin.spec "Unlink Telegram on a farmer's profile…", sponsorMobile.test "asks first, then unlinks" |
| Offline mode | Done (see Summary 5) | sponsorMobile.test offline tests; screenshot mobile/*-home-offline.png |
| Easier app | Done | setup wizard: setupWizard.test.tsx (19 tests), docs/setup-wizard.md (24 → 18 taps) |
| 3 languages | Done | sponsorMobile.test "Settings lists English, Afrikaans (beta) and Setswana (beta)…"; docs/translations-review.md (332 app strings, 37 Telegram) |
| Manual-mode bug fixed | **Done** | irrigationMode.test.tsx, ManualModeTests.cs; simulation "a Manual zone gets no automatic command…" |
| Irrigate path end to end | **Done** | simulation (19/19) + SimDatabaseTests (8/8); docs/irrigate-path.md; screenshots mobile/*-zone-*.png |
| Setup wizard | Done | setupWizard.test.tsx; screenshots mobile/setup-wizard/ |
| Easy temp passwords + one-tap sign-in | Done (Android one-tap = browser) | PasswordResetFlowTests, passwordReset.test.tsx; docs/password-reset.md; Android App Links not built |
| Telegram reset for farmers | Done | PasswordResetFlowTests; screenshots mobile/sign-in-and-reset/ |
| Staff never use Telegram | **Done** | StaffTelegramTests.cs, SimDatabaseTests (staff), staff-telegram.spec.ts, docs/telegram-farmers-only.md |
| Kit offline buffering + local pump page | Done | offline_buffer_test (170), LateReadingTests (incl. local page), simulation late-reading and kept-run checks |
| Hardware bring-up guide | Done | docs/hardware-bringup.md (now v1.6.0) |
| Migrations replay | **Done** | migration-replay.json (48 applied, verify all true but storage) |
| Drip above the tab bar with the new artwork | Done | c959a79 "fix: keep Drip clear of the tab bar" (in this release); components/mascot/Drip.tsx (four SVG moods); visible in mobile/*-home-online.png |
| No container sizes in user-facing text | Done (fixed tonight) | setup.flow.tip no longer says "like 5 litres" (57ef2eb); no other bottle or litre sizes in app strings |
| iPhone-safe loading video | Done (not tested on an iPhone) | components/WebLoadingVideo.web.tsx (muted, playsinline, webkit-playsinline) |

**Scans of the release diff against dev:**

| Scan | Result |
|---|---|
| Secrets or keys | none found. `secrets.h` is not tracked and was never read; firmware was compiled from copies with secrets.example.h. |
| "AI" claims | none. The only "AI" text is the existing disclaimer in docs/presentation ("not an AI model"). |
| The word "tub" | it was only in admin test fixtures ("Tub 1/2/3"), now "Bed". |
| TODO / FIXME | none added. |
| Console errors in screenshots | none, apart from the 6 offline ones above. |
| Skipped tests | only the 8 database tests in a plain `dotnet test`, by design (they pass in the simulation). |

**Tests removed or rewritten (none were deleted to make a run pass):**
- **Part E (setup wizard):** the old zone-setup screen and TodayCard's "Finish setup" were replaced by the wizard, and their tests by setupWizard.test.tsx. 6 old test cases are gone: 3 in screens.test.tsx, 2 in todayCard.test.tsx, 1 in setupHelpers.test.ts (its function is still tested under a new name).
- **Part A (product page):** polish.spec's landing-page test was rewritten for the product page.
- **Tonight:** fix a's fixed-300-s tests became per-zone tests. The two plain-error tests moved from the staff Telegram panel (which no longer exists) to the Activity page.

## Decisions made on your behalf

1. **No merge into dev or feat/expo-web.** The brief's gate forbids it with new migrations, and fixes a and d need them.
2. **"Executed" keeps its meaning.** The kit's status stays `executed` (started); "finished" is the new `finished_at` column, not a new status value. The 30-minute manual cooldown reads `status = 'executed'`, and a new value would have weakened it.
3. **Runs are matched to commands on the server.** The firmware doesn't send a command id with a run, so the server matches by zone, source and start time (2-minute margin). The firmware's OfflineBuffer run record is unchanged.
4. **Firmware v1.6.0:**
   - The run limit is min(asked, zone maximum), with a hard ceiling of 120 min. With no maximum in a command (an older server) it is 5 min.
   - The 3-minute lost-connection stop applies only to runs the server started. The offline fallback (60 s runs) and the local page (5 min) are meant to work offline.
   - A second "start" while the pump runs no longer moves the deadline. Before, it could silently extend a run.
5. **"Connected kit"** means enrolled (active, with a device id) and heard from in the last 5 minutes, the same rule as the Kit screen. "Stop" is always let through.
6. **Staff** means admin and field_officer. The database only allows `admin` and `farm_user` today (`profile_role_check`), so field officers can't be stored yet; the code covers both.
7. **Already-linked staff** are unlinked when the new API starts, with an audit entry for each (Platform Activity, `telegram.staff_unlinked`). I can't read the live database, so the list exists after the deploy; `docs/telegram-farmers-only.md` has the queries.
8. **Automatic-report copies** to the staff member who set up a schedule and to the admin group chat stopped (staff never get Telegram).
9. **The admin console's Forgot password** is email-only (the console is for staff), with the spam-folder note.
10. **"Tub" renamed** in test fixtures, and the flow-test tip made size-neutral.
11. **Admin screenshot scripts** live in `apps/web/admin/scripts/` with their own config, outside the test suite.

## Skipped, broken, or worth knowing

- 8 database tests show as skipped in a plain `dotnet test`. They are run, and pass, inside the simulation.
- The offline banner wording seen in the screenshot (Summary 5).
- Schedules can still be set longer than a zone's maximum; the kit cuts them at the maximum.
- The in-app weather warning is stored in English, like every other stored alert. Telegram stays in the farmer's language.
- Android one-tap opens the browser: App Links (assetlinks.json, intent filter, new APK) are not built (docs/password-reset.md).
- `Firmware:LatestVersion` in appsettings.json is still 1.4.0. Raise it only once a 1.6.0 `.bin` is hosted, or kits would try to update to a file that isn't there.
- 4 older compiler warnings (above).
- **Not completed in the merge step:** nothing was merged (by design).

## What could NOT be tested here

- A real ESP32 and pump: relay, the real 3-minute stop, OTA, the local page on a phone.
- Live Supabase:
  - Auth admin calls (set password, generate_link, the recovery email and its delivery);
  - deleting `auth.sessions`;
  - RLS with real logins;
  - the storage bucket.
- Real Telegram delivery: codes, welcome, the one-tap button, alerts, reports, the staff refusal.
- Real phones: Android APK, iPhone Safari (loading video), the offline banner.
- HiveMQ with TLS and its ACLs; Railway; Vercel.

## Your by-hand list, in order

1. **Migrations** (Supabase SQL editor; 0001–0050 are already applied):
   1. Run `supabase/migrations/0051_command_finished.sql`.
   2. Run `supabase/migrations/0052_zone_max_run.sql`.
   3. Run `docs/ops/verify-migrations.sql`. Every row must be true, including 0051, 0052 and the storage bucket.
2. **Merge, when you're happy:** `git switch dev && git pull && git merge --no-ff release/oct-19`, run `dotnet test` and the admin build, push. Then feat/expo-web: merge dev, run mobile tsc, jest and the web export, push.
3. **Supabase Auth:**
   - Minimum password length must be 8 or less, and requirements "No required characters" or "Letters and digits".
   - Add the admin site's `https://<admin host>/?reset=1` to Redirect URLs.
   - Staff password emails use Supabase's built-in mailer. It is rate-limited and often lands in spam; set custom SMTP if staff will rely on it.
4. **Railway (API from release/oct-19, or dev after the merge):**
   - `SignIn__LinkBaseUrl` = the farmer web app's address.
   - `ConnectionStrings__Supabase` = the direct or session pooler on port 5432 (LISTEN needs it).
   - `Mqtt__Host`, `Mqtt__Port`, `Mqtt__Username`, `Mqtt__Password`, `Mqtt__PoolEncryptionKey`. Leave `Mqtt__UseTls` and `Mqtt__ProtocolVersion` unset.
   - The CORS variables, if not set yet.
   - Leave `Firmware__LatestVersion` alone until a 1.6.0 `.bin` is hosted.
   - After the deploy, open Platform Activity and filter `telegram.staff_unlinked` to see which staff were unlinked (or the API log line "Unlinked Telegram from N staff account(s)").
5. **Vercel:** deploy the admin site from the same branch. Deploy the farmer web app (feat/expo-web) after step 2.
6. **APK:**
   1. Build it (EAS preview or your usual profile) with the live `EXPO_PUBLIC_*` values.
   2. Install it on a test Android phone and run the phone test (step 8).
   3. Publish it on **AgroFlow-appk**.
7. **Firmware:** flash **v1.6.0** (not 1.5.1) with Arduino IDE.
   - Use your own `secrets.h` and the default 4 MB partition.
   - The serial log should say "AgroFlow node v1.6.0".
   - Claim the kit with a one-time code.
8. **Pump and phone test:**
   1. In the admin farm drawer, set the zone's **Max run** to 2 min.
   2. In the app, try 3 min: you should see "This zone's pump is limited to 2 min per run".
   3. Run 1 min: you should see "Sending…" → "Kit started watering" → "Finished", and History shows "Watering finished".
   4. Start a 2-minute run and unplug the router: the pump stops within about 3 minutes, and the run appears when the router is back.
   5. Unplug the kit: within 5 minutes Irrigate turns off with "No kit connected to this zone…".
   6. Set the zone to Manual and dry the probe: no automatic watering.
   7. Check Home offline (the banner wording), the frost or heat warning in Alerts, and Forgot password by Telegram on a farmer account.
   8. Check that the bot refuses a link code for a staff account.
