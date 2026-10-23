# Visual redesign: review handoff

The public site previously hid its navigation on phones and kept every destination
on one long page; the staff entry used a broken relative logo path. This change adds
separate public pages, accessible navigation and a shared visual language across the
public site, staff console and farmer app, with a restrained reusable personality layer.

Branch: `feat/visual-redesign`, based on `origin/dev` at `79c1ad4`.
Review only. Do not merge or deploy as part of this pass.

## Sources and scope

The user's pasted **Visual redesign + personality layer** request is the implementation
scope. The supplied design brief (22 October 2026), consolidated audit (AF-10–14,
AF-16, AF-25), all nine PNG concepts and all three rendered pages of Bugs 3 were
reviewed as supporting evidence. Broader backend/security recommendations in those
documents are not authorisation to change behaviour here. The PDFs duplicating the
Markdown briefs are supporting copies; the Markdown is the copy source.

The concepts supply palette, spacing and imagery direction, not product data. We retain
the approved existing AgroFlow asset, reuse the existing illustrative field backdrop,
and omit their invented testimonials, performance claims and long watering runs.

## Inspection and conflicts

- The public site was one `WELCOME_HTML` string with anchor navigation. Staff has a
  separate `/staff/` entry and hash router; those boundaries remain.
- Mobile already has device-local Light / Dark / System in `ThemeContext`. Reused;
  no replacement theme context or server setting was introduced.
- Mobile already has shared `colors`, `Card`, `ScreenHeader`, `DataState`, help and
  layout modules. New presentation components build on those.
- Existing public forms, hardware showcase, demo reducer and app data requests remain
  authoritative. Their existing English copy is not silently machine-retranslated.
- The old four/five-tab app navigation is retained: the brief's proposed More tab
  would require a separately coordinated navigation change.
- The current setup component still reflects the existing 17-step model. It is not
  relabelled as four completed tasks. Four-task progress is a pure-props specimen.
- `origin/fix/audit-oct22` appeared on the final fetch at `6fa2cff`. Its
  [UI contract](https://github.com/leruo24/AgroFlow/blob/6fa2cff/docs/audit/ui-contracts.md)
  was read without switching or changing that branch. The catalogue now uses its exact
  eight command phases, and progress accepts authoritative server labels verbatim.
- No admin `vercel.json` existed. Added only explicit rewrites for the ten new public
  paths. No catch-all captures `/staff/` or `/admin/`.

## Main files changed

- Web: `src/pages/publicSite.ts`, `publicCopy.ts`, `visualCatalogue.ts`, `welcome.ts`;
  `src/ui/brand.ts`, `appearance.ts`; `src/styles/visual.css`; `src/app/shell.ts`;
  `src/main.ts`, `src/pages/login.ts`; demo `SoilCutaway.tsx`, view and mount;
  `apps/web/admin/vercel.json`; focused public regression tests.
- Mobile: `src/constants/colors.ts`; shared headers, data states, modal accessibility,
  radio semantics and filled-action style tokens; Home, Settings, login and tank
  **presentation only**; `src/components/visual/*`; `en/af/tn` dictionaries;
  `public/index.html`; visual component tests, intentional layout snapshot and fixture
  screenshot script.
- No backend, migration, firmware, FAO-56, PrimaryAction, command, auth, context,
  data-hook, API-client or setup-transition implementation is changed.

## Route-by-route changes

| Surface / route | Presentation |
|---|---|
| Public `/` | Short service overview; approved hero copy; primary call request; three outcomes; kit/app/support and getting-started links |
| `/experience` | Explicit simulated-data introduction; existing demo; default 2D root-zone cutaway; optional lazily loaded 3D; focus return |
| `/solutions` | Conditions / advice / watering capabilities; requirements and service links; connectivity/confirmation limitations |
| `/how-it-works` | Enquiry → assessment → details → installation → handover/support; existing sensor-to-action concepts |
| `/technology` | Existing labelled conceptual hardware showcase and prototype details; Reset view accessible name repaired |
| `/about` | Purpose, intended users, responsibilities, connected components, prototype limits and how to start; no invented people or sponsor approval |
| `/get-the-app` | Existing supported web/APK links, sign-in eligibility and keyboard-operable simulated-farm screenshot gallery |
| `/contact` | Existing enquiry component and submission semantics; explicit enquiry-versus-installation distinction |
| `/service-pricing` | R4,000 installation and R610/month examples, each qualified for two zones and final site-visit quote; no tiers/payments |
| `/terms`, `/privacy` | Claude's actual English `0.1-draft` documents dated 2026-10-23, explicitly unapproved, with a translation-review notice |
| Legacy public fragments | Explicit compatibility mapping to corresponding pages; `/#enquire` still opens the enquiry form |
| `/staff/` and existing console hashes | Root-relative shared brand, staff identity/subtitle, forest sidebar, theme in account menu, bounded content, phone drawers and grouped form styling |
| Farmer Home | Real farm name postcard, honest tank illustration, existing setup/advice/operational state and controls |
| Farmer Settings | Existing theme choice with water motif; device-local Simple view; field guide; draft legal notice and service-support layout |
| Farmer login | Approved brand mark, explicit field names and button roles; unchanged authentication |
| Farmer tank | Real estimate/capacity illustration; unknown has no fill; existing refill/capacity operations |
| Farmer shared screens | Cream/sage and night tokens, 16px body baseline, readable filled actions, literal loading/value/empty/stale/error layouts, named sheets and selected radios |

Public pages have their own titles and selected navigation. Mobile menu supports
Enter, Escape and focus return. Gallery previews use native named dialogs and return
focus to their triggers. Decorative SVGs are hidden from assistive technology.

## Personality components and contracts

1. `FarmPostcard` consumes a supplied farm name, and invents no weather or health.
2. `SoilCutaway` consumes existing simulated moisture. It never indicates real valve
   actuation. The original demo reducer is unchanged.
3. `FieldGuide` provides translated static explainers for zones, soil feel,
   calibration, tank estimates and drought mode.
4. `HosepipeProgress` consumes a supplied 0–4 completed count plus a separate
   installation-stage label. It never converts legacy setup progress.
5. `SimpleViewControl` saves on this device only. Home removes map/weather visual
   clutter and enlarges advice. Existing setup, drought, command and fault controls
   retain their meaning and remain reachable. There is no server preference.

`VisualCatalogue.tsx` is a specimen component, not a production route. The web
`/component-catalogue` is available only under Vite development; no production rewrite
is added. Both label their examples simulated. Continue for acceptance remains
disabled, even after checking the box. No local choice is treated as recorded consent.

The following contracts now exist on Claude's separate branch, but remain merge-time
integration dependencies: this presentation branch does not introduce their API calls.

- Four farmer task completion and installation-stage contract.
- Installer checklist persistence and permissions.
- Linked customer case, current stage, next action, owner and confirmed date.
- Service status, payer, approved scope, quote and staff-editable prices.
- Approved terms/privacy text and recorded acceptance response. The public pages include
  exact copies of the team's English source drafts (not an approved legal agreement).
- Authoritative command `phase` / `phaseLabel`: `request_sent`, `waiting_for_kit`,
  `kit_confirmed_start`, `finished`, `stop_requested`, `kit_confirmed_stop`, `no_response`,
  `failed`. `CommandPhaseLabel` presents these supplied values with no timers. The
  simulated catalogue shows every phase. Production command polling remains unchanged.
- Rural-location recovery/atomic creation and retained save/resume state. This branch
  styles the existing form and prototypes grouped alternatives; it does not fix those rules.

## Localisation and accessibility review

Every added app string is in `visual.*` for en/af/tn; new public/staff strings use
`publicCopy.ts` triples. Afrikaans and Setswana additions are drafts requiring
fluent-speaker review, consistent with their existing `needs_review` flags.
Existing English-only form/demo/staff strings remain an identified wider localisation
dependency; screenshots do not imply full language completion.
The supplied legal drafts also remain in their source English, marked `lang="en"`
with an en/af/tn notice that document translations await review. Unapproved legal
translations are not presented as authoritative.

Core text, supporting text, links and white-on-filled-action palette pairs are
checked at 4.5:1 in both mobile themes. This is not a whole-app WCAG certification.
Zoom restriction is removed from the generated web template; decorative motion is
disabled by reduced-motion CSS. The new mobile artwork is static.

## Verification and evidence

Final check counts and remaining limitations are recorded below before PR creation.
Screenshots live in `docs/test-evidence/visual-redesign/`; all farmer data is synthetic.
External map tiles are deliberately blocked in the isolated screenshot harness.
Builds/tests use dummy service hosts; no live farm is read or controlled.

| Check | Result |
|---|---|
| Admin locked install | 218 packages; lockfile unchanged |
| Admin production build | Passed; 814 modules transformed; existing large-chunk advisory remains |
| Playwright discovery | 174 tests in 25 files: all 143 original cases retained, plus 31 visual cases |
| Playwright first full run | 154 passed / 8 failed / 162 total at that point; compatibility/assertion/focus issues were repaired |
| Playwright failed-case recheck | 6 passed; 2 interrupted during live source formatting/reload, then rerun successfully below |
| Final public/demo/evidence regression | 34 passed / 0 failed; includes every new visual case, original demo cases and remaining failures |
| Final dark-menu/deep-link/gallery/menu recheck | 4 passed / 0 failed after correcting dark work surfaces |
| Newly published contract/legal alignment | 14 passed / 0 failed; refreshed all catalogue/public language-width combinations |
| Final demo copy regression | 4 passed / 0 failed after removing the derived 80-minute label |
| Final demo responsive evidence | 3 original demo cases passed; screenshot/overflow loop covers six widths, including all four requested widths |
| Mobile locked install | 952 packages; lockfile unchanged; pre-existing peer-dependency advisory |
| Mobile `tsc --noEmit` | Passed |
| Mobile Jest | 20 suites, 210 tests, 1 snapshot passed; original 187 tests retained, plus 23 visual/contract-label tests |
| Expo web export | Passed; 2,852 modules, 20 assets |
| Expo Android export | Passed; 3,399 modules, 30 assets; this is a bundle export, not an APK/device test |
| Farmer screenshot matrix | 48 screen/width/language overflow checks passed; 0 JavaScript page errors |
| Protected-scope diff | No changes under backend/hardware/supabase, context, data hooks or API services |
| Whitespace check | `git diff --check` passed |

All discovered Playwright cases have a successful run across the full and focused
runs; this is **not** a claim that one final monolithic 174-test invocation was run.
Machine-readable final/follow-up Playwright results are included with the evidence.
The focused reruns preserved every original test; only expected page locations and
approved copy were updated for the new route structure.

Evidence contains 165 PNGs: 72 farmer views (including Simple view and doubled text),
68 public/catalogue/legal/demo views (including doubled text), and 25 staff views. The viewport
matrix is 320×844, 390×844, 768×1024 and 1366×768, in en/af/tn. Public and staff
captures include full-page content beyond the viewport. Historical regression screenshots
regenerated in unrelated evidence folders are excluded from this PR.

Not tested here: installed APK on physical Android, native keyboard/safe-area behaviour
on devices, physical screen readers/voice control, real-farmer comprehension, fluent-speaker
translation approval, and live Vercel route-refresh behaviour after deployment.
Direct links/reloads and legacy entry points were tested locally; explicit Vercel rewrites
are included for review. No deployment or merge was requested or performed.

The demo's former volume/flow-derived 80-minute runtime label is removed. The
unchanged simulated crop-water amount is explicitly distinguished from a single
permitted watering run; no new run cap or agronomic calculation is introduced.

Integration caution: the untouched legacy setup screen still contains inline colour
roles and its old action area. Claude's replacement wizard must adopt the shared
action token/components and receive the final dark-theme/keyboard review. This
branch deliberately does not edit that screen while the behaviour branch replaces it.
The separate audit branch also requires its own migrations 0057/0058; this visual
branch adds none. Coordinate numbering with the separately pending ESP32 migration
before any later integration; do not apply or merge them as part of this PR.

## Suggested extras, not implemented

After the five components and behavioural contracts are reviewed: a first-real-reading
milestone from an authoritative commissioning event, a static handover card, and
contextual zone markers that always preserve text labels. No chatbot, tracking,
gamified savings, forced tour or animated unconfirmed watering is added.
