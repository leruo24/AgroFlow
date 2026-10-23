# Audit fix report: 2026-10-23

Branch `fix/audit-oct22`, made from `dev` at 79c1ad4. It is pushed but **not merged**. Sources:
- [agroflow-consolidated-audit-2026-10-22.md](agroflow-consolidated-audit-2026-10-22.md) (AF-01 to AF-25)
- [agroflow-ui-service-design-brief-2026-10-22.md](agroflow-ui-service-design-brief-2026-10-22.md) (B3-01 to B3-03)
- [Bugs_3.pdf](Bugs_3.pdf)

Every finding was checked against the code before it was fixed. The withdrawn items were left alone: the calibration shortcut, the enquiry claim, the history filter and browser logout. Codex is doing the visual redesign on `feat/visual-redesign`. This branch does no restyling: new screens use the existing tokens, and the fields Codex needs are listed in [ui-contracts.md](ui-contracts.md).

| Commit | Part |
|---|---|
| 8fb7c87 | A: trust and data (migration 0057) |
| 6fa2cff | B: journey API (0058) and the UI contract |
| 0877647 | B: journey UI (app wizard, staff case drawer) |
| 2352a8b | C: language (AF-02) |
| be78191 | D: RLS on the core tables (0059), plus the isolation and RLS tests |
| 165e685 | D: e2e cases (the cap on every path, broker and API restarts, no acknowledgement, double-tap), plus the temporary-password checks |
| (this commit) | the report, and the replay evidence |

## Findings

Status key:
- **Fixed** means done and covered by a test.
- **Partly** means done with a stated gap.
- **Codex** means visual or accessibility work left to the redesign branch.
- **Not done** gives the reason.

| ID | Finding | Status | Main files | Tests |
|---|---|---|---|---|
| AF-01 / B3-01 | A rural location blocks onboarding | **Fixed**. Valid coordinates win, and staff's place name is kept. A failed town search returns `location_not_found` and saves nothing. Retrying continues the same farm (requestId plus an `onboarding_request` row). Aliases such as Mafeking → Mahikeng are used for search only. | `FarmerOnboardingEndpoints.cs`, `Domain/OnboardingOperation.cs`, `LocationRules.cs`, admin `interactions.ts`, `pages/onboarding.ts` | `OnboardingDbTests` (Sesobe from coordinates; a halfway failure then retry; nothing saved with no location or a taken email); `AuditFixTests.Valid_coordinates_win…`, `…town_search_also_tries_a_former_name…`, `Once_anything_is_saved_the_only_offer_is_retry…`; Playwright `audit-onboarding.spec.ts` |
| AF-02 | Advice stays in English | **Partly**. Advice arrives as a code plus arguments and is written in en, af or tn (`lib/advice.ts`); old English history is shown with "Shown in English". 152 strings were moved to `t()`. A test fails on hard-coded English. *Gap:* `forgot-password`, `update-password` and `zone-hardware` are on the unmerged `fix/i18n-remaining` branch and are listed as pending in the guard. The af/tn strings are drafts awaiting review. | `Domain/TodayRules.cs` (Code/Args), `lib/advice.ts`, `i18n/*.json`, 21 screens | `advice.test.ts`, `hardcodedEnglish.test.ts`, `AuditFixTests.Every_advice_code_has_an_app_sentence_in_english_afrikaans_and_setswana` |
| AF-03 | Missing weather shows as "Dry / No rain" | **Fixed**. Weather is available, missing, stale or unknown, and unknown is never shown as dry. The staff health check uses `fetched_at`. | `Domain/WeatherAvailability.cs`, `lib/weatherStatus.ts`, `TodayEndpoints.cs`, `docs/engine/missing-weather.md` | `AuditFixTests.Weather_is_available_missing_or_stale…`; `auditFixtures.test.ts` (weather cases) |
| AF-04 | Alert read state is unreliable | **Fixed**. `POST /api/farmer/alerts/{id}/read` saves first; the app only marks the alert read after the save, and offers Retry if it fails. | `FarmerEndpoints.cs`, app `context`, `alerts.tsx` | `SimDatabaseTests.An_alert_reads_as_read_only_once_saved…`; `auditPartA.test.tsx` |
| AF-05 | The schedule conflicts with the run limit | **Fixed**. Every manual, scheduled and automatic run is capped at the zone maximum, in both the API and the database trigger (0057). The user sees "Capped to 5 min (this zone's limit)", and saved schedules show the capped length. | `IrrigationRunRules`, `FarmerEndpoints.cs`, 0057 trigger, `lib/schedule.ts`, `zone/[id].tsx` | `AuditFixTests.Every_run_is_capped…`; `SimDatabaseTests.A_run_above_the_zones_maximum_is_capped…`, `Every_insert_path_is_capped…`; e2e §8b, §9a |
| AF-06 | Tank and budget messages disagree | **Fixed**. A saved tank is never called "not set up", and there is one tank summary. | `Domain/TankSummary.cs`, `DroughtEvaluator`, `DroughtCard`, `index.tsx` | `AuditFixTests.A_saved_tank_is_never_called_not_set_up` |
| AF-07 | Areas are inconsistent or rounded away | **Fixed**. Areas are never rounded to 0, and small farms show m². The same rule is used in C#, the app and admin, from shared fixtures. | `Domain/AreaFormat.cs`, `lib/area.ts`, admin `lib/format.ts` | `AuditFixTests.Areas_are_never_rounded_to_zero…`; `auditFixtures.test.ts`; `audit-fixtures.spec.ts` |
| AF-08 | Settings Back enters earlier wizard steps | **Fixed**. Settings links open `/setup?task=…&screen=…&from=settings` and Back returns to Settings. The URL follows the step. | `app/setup.tsx`, `settings.tsx` | `setupWizard.test.tsx` |
| AF-09 | No-kit preparation looks like failure | **Fixed**. The farm shows "Awaiting installation". Staff book the first-installation visit and run an installer checklist (kit linked, calibration, flow measured, run limit, test start/stop). Each item is checked against real data or an acknowledged command. | `Domain/Journey.cs`, `JourneyStore.cs`, `JourneyEndpoints.cs`, admin `caseView.ts`, `pages/farms.ts` | `JourneyDbTests.A_farm_goes_from_details_to_commissioned…`; `AuditFixTests.A_zone_is_commissioned_by_four_things…`; Playwright `audit-case.spec.ts` |
| AF-10 | Text contrast | **Codex** | n/a | n/a |
| AF-11 | Product nav disappears at phone width | **Codex** | n/a | n/a |
| AF-12 | Farmer viewport restricts zoom | **Codex** | n/a | n/a |
| AF-13 | Form and selection semantics | **Codex**. The new screens use the existing labelled controls. | n/a | n/a |
| AF-14 | Gallery has no keyboard entry point | **Codex** | n/a | n/a |
| AF-15 | Staff weather health shows a schema error | **Fixed**. The message is plain, with a log reference, and reads `fetched_at`. | `HealthEndpoints.cs`, admin `data/api.ts` | none of its own |
| AF-16 | Broken logo and backdrop paths | **Codex** (public site assets) | n/a | n/a |
| AF-17 | Forecast error has no Retry | **Fixed**. The error now has Retry, and stale data is labelled. | `forecast.tsx` | `auditPartA.test.tsx` |
| AF-18 | Advice dates and crop model are unclear | **Fixed**. The advice says which crop model and weather dates it used (`calculatedAt`, provenance), and never reads the crop from the zone name. | `Domain/Agronomy/AdviceProvenance.cs`, `TodayEndpoints.cs`, `TodayCard` | `AuditFixTests.Advice_says_which_crop_model…` |
| AF-19 | Request area has no unit | **Fixed**. The unit is ha, m² or "I don't know" (`service_request.rough_size_unit`, 0057). | `FarmerEndpoints.cs`, `request.tsx`, admin `pages/requests.ts` | `audit-fixtures.spec.ts` ("request sizes say their unit…") |
| AF-20 | Phone check accepts all zeros | **Fixed**. One rule is used everywhere, and numbers made of a single repeated digit fail. | `Domain/PhoneRules.cs`, `EnquiryRules`, `lib/phone.ts` (app and admin) | `AuditFixTests.Phone_numbers_are_checked_the_same_way…`; fixtures in all three test suites |
| AF-21 | Browser-hardening headers | **Not done**. This is hosting configuration (Vercel/Railway). It needs a report-only CSP first, and it is outside Parts A–D. See the by-hand steps. | n/a | n/a |
| AF-22 | Loading briefly shows missing data as fact | **Fixed**. The tank, weather and schedule each have a loading or unknown state. | `index.tsx`, `zone/[id].tsx`, `DroughtCard` | `auditPartA.test.tsx` (schedule state); tank/weather loading: none of its own |
| AF-23 | Staff user count differs between views | **Fixed**. The farm list counts members from `farm_member` (member_ids, member_count, kit_count). | `FarmEndpoints.cs`, admin `data/api.ts`, `pages/farms.ts` | none of its own (the mock in `audit-case.spec.ts` uses the new counts) |
| AF-24 | Direct onboarding leaves an enquiry unresolved | **Fixed**. Onboarding links the enquiry to the case, and staff can link an enquiry to an existing farmer without inventing a call. | `JourneyEndpoints.cs`, `JourneyStore.LinkCaseAsync`, admin `pages/enquiries.ts` | `JourneyDbTests.An_enquiry_is_linked_to_an_existing_farmer…`; `enquiries.spec.ts` |
| AF-25 | Reset view accessible name | **Codex** (public product page) | n/a | n/a |
| B3-02 | Predictable wizard | **Fixed**. There are four farmer tasks (Your preferences, Your farm, Your water, Your crops). Each screen saves on Continue and keeps a draft. The progress line reads "Your details: X of 4" and "Installation: \<stage\>". Installer-only steps are handed to staff, and "I don't know – help me" creates a staff follow-up with an owner. | `app/setup.tsx`, `lib/farmerTasks.ts`, `JourneyEndpoints.cs` (tasks, help) | `setupWizard.test.tsx` (22) |
| B3-03 | Show the whole journey | **Fixed**. "Where you are now" shows the stage (Enquiry → … → Commissioned/Live), who acts next, and no invented dates. There is an automatic-watering offer after commissioning, a "Before you start" step that records terms acceptance, and Settings → Service & support with the staff-editable price. | `Domain/Journey.cs`, `WhereYouAreNow.tsx`, `AutoOfferCard.tsx`, `ServiceSupportCard.tsx`, `app/legal.tsx`, `LegalDocuments.cs` | `AuditFixTests.The_stage_moves…`, `Where_you_are_now_names_who_acts_next…`, `The_draft_documents_are_served…`; `JourneyDbTests.Zones_from_before_the_journey_keep_their_mode…` |

These decisions were applied as given:
- **Manual mode:** new zones start in Manual, and existing zones are marked `legacy` and keep their mode.
- **Automatic offer:** "Turn on automatic watering?" is asked only once a zone is commissioned. That means four things are done: kit linked, a real wet/dry calibration, a measured flow, and a test start/stop the kit acknowledged. The farmer API refuses automatic mode on a zone still pending (409 `not_commissioned`), and staff can switch it.
- **Pricing:** R4,000 installation and R610/month, labelled "example for a 2-zone farm; final quote after a site visit". It is staff-editable through the `service.*` settings.
- **Legal documents:** the terms and privacy documents are version `0.1-draft` and marked "Draft – needs approval".

## Security (Part D)

**Found and fixed:** a database built from the migrations had RLS **off** on `farm`, `zone` and `farm_member`, and `profile` had RLS on but no policy:
- **Why:** migration 0011 assumed these were set up in the Supabase dashboard.
- **Who is affected:** any database rebuilt from the migrations, such as a new project, a restore or the sim.
- **The risk:** on such a database, with Supabase's default grants, any signed-in farmer could read every farm and zone through the client API.
- **The fix, migration 0059:** it enables RLS on the four tables. It adds read policies **only** where a table has none, so the live dashboard policies are untouched. It grants SELECT to `authenticated` and revokes everything from `anon`.
- **Live database:** its state is unverified from here. The 0059 row in verify-migrations shows it.

**Tests**, in `SecurityDbTests.cs`, run against a full migration replay. Evidence is in [evidence/](evidence/).
- **The API, as another farmer:** each of 22 farmer routes was called for another farmer's farm, zone, command, alert, report and service record:
  - 20 are refused (404, or 400 for a request with a farm that isn't theirs).
  - Two answer 200: `dashboard?farmId=` and `zones/{id}/commands`. The test checks that neither response contains any of the other farmer's data. ([security-api-isolation.txt](evidence/security-api-isolation.txt))
- **Staff routes, as a farmer:** all 9 sampled staff routes answer 403. These are farms, case, visits, checklist, mode, health, enquiries, onboard and users. ([security-staff-routes.txt](evidence/security-staff-routes.txt))
- **RLS, reading directly** as `authenticated` (with another farmer's JWT claims) and as `anon`:
  - Another farmer's farm, zone, sensor_reading, irrigation_event, irrigation_commands, alert, service_request, report_request and profile return **0 rows**; anon is refused (42501).
  - The new tables (onboarding_request, help_request, terms_acceptance, service_case) are refused to both roles.
- **RLS, writing directly:** all are refused or touch 0 rows. The attempts were:
  - rename another farmer's zone;
  - start their pump;
  - mark their alert read;
  - delete their farm;
  - make yourself admin. ([security-rls.txt](evidence/security-rls.txt))
- **The inventory:** RLS is on for every public table except `irrigation_schedule` (legacy, dropped by 0010), and anon has no write grant anywhere. The full inventory is in [rls-inventory.md](rls-inventory.md).
- **Temporary passwords:** 8 easy characters, a 72-hour expiry and a forced change at first sign-in. These were already tested in `PasswordResetFlowTests`. `OnboardingDbTests` now also checks them for the rewritten onboarding: 8 characters, `temp_password_expires_at` within 71.9–72 h, and `must_change_password`. A repeat submit gives no new password.
- **Telegram reset codes** were already covered by `PasswordResetFlowTests`:
  - 6 digits, stored only hashed;
  - a 10-minute expiry;
  - single use, with other unused codes ended;
  - 5 wrong tries end the code, even the right one;
  - 3 requests per hour;
  - the same reply for an unknown email.
- **Not changed:** the e2e cannot sign in as a farmer, because the API requires HTTPS for Supabase's key URL. Making a plain-HTTP exception for the simulation was refused as a weakening of sign-in checks, so sign-in checking is unchanged. The farmer-route sim cases run in-process instead, with the test sign-in, against the same e2e Postgres. They are reported as their own e2e lines.

**Watering checks.** These are software checks with a pretend pump. They say nothing about the physical kit, its relay or its wiring.

| Case | Result |
|---|---|
| Double-tapped Irrigate | PASS. A second press, and two presses at the same instant, return the same command; one row is created. (`SimDatabaseTests`, reported in the e2e) |
| No acknowledgement | PASS. The app reads "Waiting for kit", then "No response" after 60 s. |
| Broker restart | PASS. The API notices; a command made meanwhile stays `pending` with no `published_at` (no false "Waiting for kit"). When the broker returns, the API reconnects by itself and the command reaches the kit once. A new command then arrives as normal. |
| API restart | PASS. A command saved while the API was down (as the database scheduler does) is sent when it is back. Readings and the kit's login keep working. |
| Cap on every path | PASS. Manual: 240 s becomes 180 s, with the message. Scheduled and auto commands asking for 3600 s arrive as 300 s, with the 3600 s kept in `requested_duration_seconds`. Automatic watering's own start is limited by `maxRunSeconds` 300. A 10-minute schedule on a 3-minute zone arrives as 180 s. |

**Finding, not fixed:** the firmware does not ignore a command id it has already run. Replay only resends commands still `pending` (not acknowledged), and every start is capped. Even so, if a kit runs a command and its acknowledgement is lost, a replay within 2 hours could run it a second time (at most the zone maximum). The firmware was not changed in this job. Remembering the last command id on the board would close this.

## Tests

| Check | Result |
|---|---|
| `dotnet test backend/AgroFlow.Domain.Tests` | 1543 passed, 0 failed, 32 skipped. The skipped ones are the DB tests, which need the sim Postgres; they ran in the e2e. |
| e2e simulation `hardware/sim/run-e2e.mjs` | **37 passed, 0 failed**, including the API DB tests: 54 of 54. ([evidence/e2e-sim.txt](evidence/e2e-sim.txt)) |
| Migration replay ×2 on empty databases ([result-with-0057-0059.json](../test-evidence/migration-replay/result-with-0057-0059.json)) | All 55 apply (0001–0059). 0007 and 0010 re-run with no schema change. **0057, 0058 and 0059 re-run cleanly with no change** to schema, policies, grants, the cap trigger, the service settings or commission states. verify-migrations: 56 rows, all migration rows true. |
| Admin `npm run build` | OK |
| Admin Playwright (`PW_PORT=5191`) | Full run, 150 tests: **146 passed, 4 failed**. The failures were the homepage demo (experience-agroflow:15), the register wizard Recommended card (recommend:80), Set up the farm from a request (requests:98) and robustness mqttLogins (robustness:31). **All 4 pass when rerun alone.** They are timeouts under load: the run took 18 minutes alongside the e2e and other work on the machine. They are not fixed here; rerun before merging. The audit specs (Sesobe onboarding, retry, location error, first-installation booking, installer checklist, fixtures) passed in the full run. The new AF-19 test passes (3 of 3 in audit-fixtures). |
| Mobile `tsc --noEmit` | clean |
| Mobile jest | 23 suites, **270 passed** |
| `expo export` web / android | both OK |

## Your by-hand steps

1. **Apply 0057, 0058 and 0059 in order** in the Supabase SQL editor (each is safe to run twice). Then run `docs/ops/verify-migrations.sql`: the 0057, 0058 and 0059 rows must read true.
   - Before applying 0059, check that nothing reads `farm`, `zone`, `farm_member` or `profile` with the **anon** key. 0059 revokes anon from those tables. The apps read them signed in, and the public site goes through the API, but confirm on the live project.
   - After 0059, compare the dashboard policies on those four tables with what you expect. 0059 adds none where some exist.
2. **Translation review:** the new af/tn strings are drafts, listed in `docs/translations-review.md`.
3. **After merging `fix/i18n-remaining`**, remove `PENDING_ON_I18N_BRANCH` from `apps/mobile/src/lib/__tests__/hardcodedEnglish.test.ts`. The guard then covers those three screens too.
4. **Legal approval** of `backend/AgroFlow.Api/Legal/terms-of-service.md` and `privacy-notice.md`. When approved, change the version in `LegalDocuments.cs` from `0.1-draft` and remove the draft banner. A new version asks farmers to accept again.
5. **Pricing:** confirm the `service.*` amounts and wording in the staff console (seeded as R4,000 and R610/month, an example for a 2-zone farm).
6. **Firmware:** decide whether to add the remembered last command id (see the finding above).
7. **AF-21:** set hosting headers on Vercel or Railway, starting with a report-only CSP.
8. **Codex:** AF-10 to AF-14, AF-16 and AF-25 are on `feat/visual-redesign`. Field names are in [ui-contracts.md](ui-contracts.md).
9. **Merge** when you are ready. This branch has not been merged anywhere.

## Migration SQL

### 0057_audit_trust_and_data.sql

```sql
-- Audit fixes, Part A: trust and data (docs/audit/fix-report-2026-10-23.md).
--
--   1. onboarding_request (AF-01, B3-01): one row per staff "Onboard farmer" attempt, keyed by
--      the request id the admin site makes when the form opens. The farm, its zones and the
--      coordinates are saved in one transaction with this row; the account is created after.
--      A retry with the same id continues the same farmer and farm instead of making new ones,
--      and the admin site reads the row's status instead of offering "Create again".
--   2. zone.irrigation_mode now defaults to 'manual' (decision: new zones start in Manual and
--      only switch to Automatic after commissioning). Existing zones keep their mode: only the
--      column default changes, no row is updated.
--   3. The run cap (AF-05): every start is capped at the zone's maximum run time
--      (zone.max_run_minutes, 0052), whichever path inserted it: Water now (the API), a
--      schedule (fire_due_irrigation_schedules, pg_cron) or automatic watering. A trigger does it
--      so no path can miss it; the API also caps first, so it can tell the farmer.
--      irrigation_commands.requested_duration_seconds keeps what was asked for.
--   4. irrigation_commands.published_at: when the API handed the command to the broker, so the
--      app can tell "Request sent" (saved) from "Waiting for kit" (sent to the kit, no answer yet).
--
-- The firmware's own cap (min(requested, maxRunSeconds)) is unchanged and stays independent.
-- RLS: onboarding_request is read and written by the API only. irrigation_commands keeps its
-- grants and policies (0011); new columns are covered by them.
-- Safe to run more than once.

-- 1. Onboarding requests ---------------------------------------------------------------------

create table if not exists onboarding_request (
    request_id      uuid primary key,
    -- started: validated, nothing saved yet; farm_saved: farm + zones + coordinates committed;
    -- account_created: the farmer's sign-in exists and owns the farm; completed: handover ready;
    -- failed: stopped at last_step, retry with the same request_id to continue.
    status          text not null default 'started'
                    check (status in ('started', 'farm_saved', 'account_created', 'completed', 'failed')),
    last_step       text,
    email           text not null,
    farm_id         bigint references farm (farm_id) on delete set null,
    profile_id      uuid references profile (id) on delete set null,
    enquiry_id      bigint references enquiry (id) on delete set null,
    created_by      uuid references profile (id) on delete set null,
    last_error      text,
    attempts        integer not null default 1,
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now()
);

create index if not exists idx_onboarding_request_email on onboarding_request (lower(email));
create index if not exists idx_onboarding_request_farm on onboarding_request (farm_id);

alter table onboarding_request enable row level security;
revoke all on onboarding_request from anon, authenticated;

comment on table onboarding_request is
    'One staff onboarding attempt (AF-01). The farm, zones and coordinates are saved in one transaction with it; a retry with the same request_id continues the same farmer and farm. API only.';

-- 2. New zones start in Manual ---------------------------------------------------------------

alter table zone alter column irrigation_mode set default 'manual';

comment on column zone.irrigation_mode is
    'manual (default for new zones), automatic or scheduled. A new zone is switched to automatic only after commissioning (kit linked, wet/dry calibration, measured flow, an acknowledged test start/stop); zones that existed before 0057 keep their mode.';

-- 3 + 4. The run cap and the publish time ----------------------------------------------------

alter table irrigation_commands
    add column if not exists requested_duration_seconds integer,
    add column if not exists published_at timestamptz;

comment on column irrigation_commands.requested_duration_seconds is
    'What was asked for, when it was more than the zone''s maximum run time; duration_seconds is then the capped length the kit is sent. Null when nothing was capped.';
comment on column irrigation_commands.published_at is
    'When the API published the command to the kit over MQTT. Null: saved, not sent yet ("Request sent").';

create or replace function cap_irrigation_command_duration()
returns trigger
language plpgsql
as $$
declare
    v_max_minutes integer;
    v_cap_seconds integer;
begin
    if new.command <> 'start' or new.duration_seconds is null then
        return new;
    end if;

    select max_run_minutes into v_max_minutes from zone where id = new.zone_id;
    -- Out of range or missing reads as the default (IrrigationRunRules.ZoneMaxOrDefault).
    if v_max_minutes is null or v_max_minutes < 1 or v_max_minutes > 120 then
        v_max_minutes := 5;
    end if;
    v_cap_seconds := v_max_minutes * 60;

    if new.duration_seconds > v_cap_seconds then
        new.requested_duration_seconds := coalesce(new.requested_duration_seconds, new.duration_seconds);
        new.duration_seconds := v_cap_seconds;
    end if;
    return new;
end;
$$;

comment on function cap_irrigation_command_duration() is
    'Caps every start at the zone''s maximum run time (AF-05), on every insert path; keeps the request in requested_duration_seconds.';

drop trigger if exists trg_irrigation_commands_cap on irrigation_commands;
create trigger trg_irrigation_commands_cap
    before insert on irrigation_commands
    for each row execute function cap_irrigation_command_duration();

-- 5. A request's rough size has a unit (AF-19) ------------------------------------------------
-- rough_size stays in hectares (what staff already read); rough_size_unit says what the farmer
-- chose: 'ha', 'm2' (converted to hectares, 1 ha = 10 000 m2), 'unknown' ("I don't know - help me
-- measure", rough_size null) or 'unstated' (an older app that sent a bare number). Staff never see
-- an unqualified number again.

alter table service_request
    add column if not exists rough_size_unit text;

do $guard$
begin
    if not exists (select 1 from pg_constraint
                   where conrelid = 'public.service_request'::regclass and conname = 'service_request_rough_size_unit_check') then
        alter table service_request
            add constraint service_request_rough_size_unit_check
            check (rough_size_unit is null or rough_size_unit in ('ha', 'm2', 'unknown', 'unstated'));
    end if;
end $guard$;

comment on column service_request.rough_size_unit is
    'What the farmer chose for rough_size (AF-19): ha, m2 (rough_size is still stored in hectares), unknown (help me measure; rough_size null) or unstated (an older app sent a bare number).';
```

### 0058_service_journey.sql

```sql
-- Audit fixes, Part B: the enquiry-to-installation journey (docs/audit/fix-report-2026-10-23.md,
-- docs/audit/ui-contracts.md). Everything here is read and written by AgroFlow.Api only; RLS is
-- on for every new table and clients get no grants (the API connects as the table owner).
--
--   service_case             one case per farm, linking the enquiry, farmer, farm, its visits, its
--                            kits and the service status. Its stage is WORKED OUT by the API from
--                            the facts (JourneyStage), not typed in, so it cannot drift:
--                            Enquiry -> Details -> Service agreed -> Account active ->
--                            Ready for installation -> Visit booked -> Installing -> Commissioned/Live.
--   installation_visit       a booked visit: farm, date, named installer. A first installation
--                            needs no device (AF-09).
--   installer_check          the installer checklist per zone: kit linked, wet/dry calibration,
--                            flow measured, run limit, test start/stop. Who, when, and whether the
--                            value was measured or estimated.
--   zone.commission_state    'legacy' for every zone that existed before 0058 (nothing about them
--                            changes, their mode included), 'pending' for new zones, 'commissioned'
--                            once the four checks are done. Only then does the app ask the farmer
--                            "Turn on automatic watering?" (zone.auto_offer_answer).
--   farmer_task              the farmer's four tasks (preferences, farm, water, crops) and when
--                            each was finished, so "Your details: X of 4" is the server's count.
--   help_request             "I don't know - help me": a staff follow-up with an owner.
--   terms_acceptance         who accepted which version of the draft terms / privacy notice, when.
--   app_setting service.*    the example price (R4 000 installation, R610 a month for a 2-zone farm),
--                            staff-editable; no billing exists.
-- Existing zones keep their mode. Safe to run more than once.

-- 1. The case -------------------------------------------------------------------------------

create table if not exists service_case (
    id                 bigint generated always as identity primary key,
    farm_id            bigint references farm (farm_id) on delete cascade,
    enquiry_id         bigint references enquiry (id) on delete set null,
    farmer_profile_id  uuid references profile (id) on delete set null,
    owner_profile_id   uuid references profile (id) on delete set null,
    next_action        text check (next_action is null or char_length(next_action) <= 300),
    follow_up_at       timestamptz,
    -- Recorded by staff when the farmer agreed the service (quote, sponsorship); no billing.
    service_agreed_at  timestamptz,
    service_status     text not null default 'not_agreed'
                       check (service_status in ('not_agreed', 'sponsored', 'paying', 'trial', 'paused', 'ended')),
    payer              text check (payer is null or char_length(payer) <= 120),
    plan_description   text check (plan_description is null or char_length(plan_description) <= 500),
    created_at         timestamptz not null default now(),
    updated_at         timestamptz not null default now()
);

create unique index if not exists ux_service_case_farm on service_case (farm_id) where farm_id is not null;
create unique index if not exists ux_service_case_enquiry on service_case (enquiry_id) where enquiry_id is not null;

alter table service_case enable row level security;
revoke all on service_case from anon, authenticated;

comment on table service_case is
    'One case per farm: enquiry, farmer, farm, visits, kits and service status (Part B). The stage is worked out by the API from these facts. API only.';

-- 2. Visits -----------------------------------------------------------------------------------

create table if not exists installation_visit (
    id                    bigint generated always as identity primary key,
    farm_id               bigint not null references farm (farm_id) on delete cascade,
    kind                  text not null default 'first_installation'
                          check (kind in ('first_installation', 'follow_up', 'maintenance')),
    scheduled_for         timestamptz not null,
    installer_profile_id  uuid references profile (id) on delete set null,
    installer_name        text not null check (char_length(installer_name) between 2 and 120),
    status                text not null default 'booked'
                          check (status in ('booked', 'in_progress', 'done', 'cancelled')),
    notes                 text check (notes is null or char_length(notes) <= 1000),
    created_by            uuid references profile (id) on delete set null,
    created_at            timestamptz not null default now(),
    started_at            timestamptz,
    completed_at          timestamptz,
    cancelled_at          timestamptz
);

create index if not exists idx_installation_visit_farm on installation_visit (farm_id, scheduled_for desc);

alter table installation_visit enable row level security;
revoke all on installation_visit from anon, authenticated;

comment on table installation_visit is
    'A booked installation or follow-up visit: farm, date, named installer. Needs no device (AF-09). API only.';

-- 3. The installer checklist ------------------------------------------------------------------

create table if not exists installer_check (
    id              bigint generated always as identity primary key,
    zone_id         bigint not null references zone (id) on delete cascade,
    item            text not null check (item in ('kit_linked', 'calibration', 'flow_measured', 'run_limit', 'test_start_stop')),
    -- measured: on site with an instrument or a timed container; estimated: a guess or default;
    -- confirmed: checked by eye (for example the kit linked to the right zone).
    provenance      text not null check (provenance in ('measured', 'estimated', 'confirmed')),
    value_text      text check (value_text is null or char_length(value_text) <= 200),
    notes           text check (notes is null or char_length(notes) <= 500),
    done_by         uuid references profile (id) on delete set null,
    done_by_name    text not null,
    done_at         timestamptz not null default now(),
    -- The acknowledged start and stop of the test run, for test_start_stop.
    command_ids     uuid[]
);

create unique index if not exists ux_installer_check_zone_item on installer_check (zone_id, item);

alter table installer_check enable row level security;
revoke all on installer_check from anon, authenticated;

comment on table installer_check is
    'The installer checklist per zone (Part B): who did each item, when, and whether it was measured or estimated. API only.';

-- 4. Commissioning on the zone ----------------------------------------------------------------

alter table zone
    add column if not exists commission_state text,
    add column if not exists commissioned_at timestamptz,
    add column if not exists auto_offer_answer text,
    add column if not exists auto_offer_answered_at timestamptz;

-- Zones that existed before this migration are 'legacy': their mode and behaviour are unchanged.
-- Only the very first run marks them; later runs leave every row alone.
do $guard$
begin
    if not exists (select 1 from pg_constraint where conrelid = 'public.zone'::regclass and conname = 'zone_commission_state_check') then
        update zone set commission_state = 'legacy' where commission_state is null;
        alter table zone add constraint zone_commission_state_check
            check (commission_state in ('legacy', 'pending', 'commissioned'));
    end if;
    if not exists (select 1 from pg_constraint where conrelid = 'public.zone'::regclass and conname = 'zone_auto_offer_answer_check') then
        alter table zone add constraint zone_auto_offer_answer_check
            check (auto_offer_answer is null or auto_offer_answer in ('automatic', 'manual'));
    end if;
end $guard$;

alter table zone alter column commission_state set default 'pending';
alter table zone alter column commission_state set not null;

comment on column zone.commission_state is
    'legacy (existed before 0058, unchanged), pending (new, not commissioned yet), commissioned (kit linked, wet/dry calibration, measured flow and an acknowledged test start/stop). A pending zone cannot be switched to automatic by the farmer.';
comment on column zone.auto_offer_answer is
    'The farmer''s answer to "Turn on automatic watering?", asked once the zone is commissioned: automatic or manual (Keep manual).';

-- 5. The farmer's four tasks ------------------------------------------------------------------

create table if not exists farmer_task (
    profile_id   uuid not null references profile (id) on delete cascade,
    farm_id      bigint not null references farm (farm_id) on delete cascade,
    task         text not null check (task in ('preferences', 'farm', 'water', 'crops')),
    done_at      timestamptz not null default now(),
    primary key (profile_id, farm_id, task)
);

alter table farmer_task enable row level security;
revoke all on farmer_task from anon, authenticated;

comment on table farmer_task is
    'The four farmer tasks (Your preferences / Your farm / Your water / Your crops) and when each was finished. API only.';

-- 6. "I don't know - help me" -----------------------------------------------------------------

create table if not exists help_request (
    id                bigint generated always as identity primary key,
    farm_id           bigint not null references farm (farm_id) on delete cascade,
    zone_id           bigint references zone (id) on delete cascade,
    profile_id        uuid references profile (id) on delete set null,
    topic             text not null check (topic in (
                          'location', 'water_source', 'tank_capacity', 'tank_level', 'crop', 'planting_date',
                          'irrigation_type', 'soil_type', 'area', 'other')),
    note              text check (note is null or char_length(note) <= 500),
    status            text not null default 'open' check (status in ('open', 'resolved')),
    owner_profile_id  uuid references profile (id) on delete set null,
    created_at        timestamptz not null default now(),
    resolved_at       timestamptz,
    resolved_by       uuid references profile (id) on delete set null,
    resolution        text check (resolution is null or char_length(resolution) <= 500)
);

create index if not exists idx_help_request_open on help_request (farm_id, created_at desc) where status = 'open';
-- One open request per farm, zone and topic: asking twice is the same request.
create unique index if not exists ux_help_request_open_topic
    on help_request (farm_id, coalesce(zone_id, 0), topic) where status = 'open';

alter table help_request enable row level security;
revoke all on help_request from anon, authenticated;

comment on table help_request is
    '"I don''t know - help me" from a farmer task: a staff follow-up with an owner (the case owner, else whoever onboarded the farm). API only.';

-- 7. Terms and privacy acceptance -------------------------------------------------------------

create table if not exists terms_acceptance (
    id            bigint generated always as identity primary key,
    profile_id    uuid not null references profile (id) on delete cascade,
    document      text not null check (document in ('terms', 'privacy')),
    version       text not null check (char_length(version) between 1 and 40),
    accepted_at   timestamptz not null default now(),
    method        text not null default 'app_checkbox' check (method in ('app_checkbox')),
    unique (profile_id, document, version)
);

alter table terms_acceptance enable row level security;
revoke all on terms_acceptance from anon, authenticated;

comment on table terms_acceptance is
    'Who accepted which version of the (draft) terms of service and privacy notice, when, and how. Recorded only from the farmer''s own sign-in. API only.';

-- 8. Example service price (no billing) -------------------------------------------------------

insert into app_setting (key, value, description, source) values
  ('service.installation_price_zar', '4000', 'Example installation price shown to farmers, in rand, for the example farm (hardware included).', 'AgroFlow pricing model (audit decision)'),
  ('service.monthly_price_zar', '610', 'Example monthly service price shown to farmers, in rand, for the example farm.', 'AgroFlow pricing model (audit decision)'),
  ('service.example_zones', '2', 'How many zones the example price is for.', 'AgroFlow pricing model (audit decision)'),
  ('service.price_label', '"example for a 2-zone farm; final quote after a site visit"', 'The words shown with the example price.', 'AgroFlow pricing model (audit decision)')
on conflict (key) do nothing;
```

### 0059_core_tables_rls.sql

```sql
-- Row Level Security on the four core tables, in a migration at last (audit fixes, Part D).
--
-- 0011 says RLS on farm, zone, farm_member and profile was "already live": it was set up in the
-- Supabase dashboard and never written down in a migration. A database built from the migrations
-- (the kit simulation, a new Supabase project, a restore into an empty project) therefore had RLS
-- OFF on farm, zone and farm_member, and profile had RLS on with no policy. SecurityDbTests found
-- this on a full replay. On such a database, with Supabase's default grants, any signed-in farmer
-- could read every farm and zone through the client API.
--
-- What this does, and why it is safe on the live database:
--   1. Turns RLS on for the four tables. Already on: nothing changes.
--   2. Adds read policies ONLY to a table that has no policy at all. The live tables already have
--      their dashboard policies, so nothing is added or replaced there; a rebuilt database gets the
--      same rule the rest of the schema uses (0011): the farm's owner or a member, or staff.
--   3. Grants SELECT to authenticated on the four tables, which the apps' reads need (the admin
--      site's farm and zone lists, the app's own profile, the alert history's zone names). RLS
--      decides which rows. No insert, update or delete is granted: those go through AgroFlow.Api.
--   anon gets nothing.
-- ENABLE, never FORCE: the API connects as the table owner and keeps its own access checks.
-- Safe to run more than once.

alter table farm enable row level security;
alter table zone enable row level security;
alter table farm_member enable row level security;
alter table profile enable row level security;

do $guard$
begin
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'farm') then
        create policy farm_select_member_or_staff on farm for select to authenticated
            using (app_is_admin() or app_can_access_farm(farm_id));
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'zone') then
        create policy zone_select_member_or_staff on zone for select to authenticated
            using (app_is_admin() or app_can_access_farm(farm_id));
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'farm_member') then
        create policy farm_member_select_own_or_staff on farm_member for select to authenticated
            using (app_is_admin() or profile_id = auth.uid());
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'profile') then
        create policy profile_select_own_or_staff on profile for select to authenticated
            using (app_is_admin() or id = auth.uid());
    end if;
end $guard$;

grant select on farm, zone, farm_member, profile to authenticated;
revoke all on farm, zone, farm_member, profile from anon;

comment on table farm_member is
    'Which profiles can use which farms. RLS: a farmer sees their own rows, staff see all (0059 writes down what 0011 assumed was live).';
```

### verify-migrations.sql rows added

```sql
 ('0057','audit_trust_and_data', exists(select 1 from rel where relname='onboarding_request' and relkind='r') and exists(select 1 from c where t='irrigation_commands' and col='requested_duration_seconds') and exists(select 1 from c where t='irrigation_commands' and col='published_at') and exists(select 1 from pg_trigger where tgname='trg_irrigation_commands_cap') and exists(select 1 from c where t='service_request' and col='rough_size_unit'), 'onboarding_request, run-cap trigger, irrigation_commands.requested_duration_seconds/published_at, service_request.rough_size_unit'),
 ('0058','service_journey', exists(select 1 from rel where relname='service_case' and relkind='r') and exists(select 1 from rel where relname='installation_visit' and relkind='r') and exists(select 1 from rel where relname='installer_check' and relkind='r') and exists(select 1 from rel where relname='farmer_task' and relkind='r') and exists(select 1 from rel where relname='help_request' and relkind='r') and exists(select 1 from rel where relname='terms_acceptance' and relkind='r') and exists(select 1 from c where t='zone' and col='commission_state') and (select count(*) from app_setting where key like 'service.%') = 4, 'service_case, installation_visit, installer_check, farmer_task, help_request, terms_acceptance, zone.commission_state, 4 service.* settings'),
 ('0059','core_tables_rls', (select bool_and(relrowsecurity) from pg_class where relnamespace = 'public'::regnamespace and relname in ('farm','zone','farm_member','profile')) and (select count(distinct tablename) from pg_policies where schemaname = 'public' and tablename in ('farm','zone','farm_member','profile')) = 4 and has_table_privilege('authenticated','public.zone','SELECT') and not has_table_privilege('anon','public.farm','SELECT'), 'RLS on with a policy for farm, zone, farm_member, profile; authenticated may read, anon may not'),
```
