# Blue/teal visual revision — review handoff

23 October 2026. Implementation: `6582759`, on `feat/visual-redesign`.
PR: https://github.com/leruo24/AgroFlow/pull/3 — keep draft; do not merge.
The user explicitly approved pushing PR updates with **automatic preview builds only**.
No manual deployment or production release is authorised.

## Reference and scope

Read the complete `PROMPT.md` in `AgroFlow-Codex-Prompt-and-NEW-Designs.zip`
and inspected all four panels of `NEW-blue-teal-concept-board.png` before editing.
The supplied board is preserved under [design/reference](design/reference/NEW-blue-teal-concept-board.png).
Written requirements govern; the board is a generated visual reference, not verified
hardware, product data, people or a replacement logo. The existing approved logo stays.
This is a focused continuation, not an app rebuild. The prior implementation report is
[visual-redesign.md](visual-redesign.md); this document supersedes its palette/check results.

No backend, firmware, migrations, authentication implementation, API client, data hook,
agronomic calculation, runtime cap or real irrigation-command implementation changed.
The existing farmer setup file has **style-only token replacements**: its 17-step
progression, saves, Back and resume behaviour are untouched. Other contributors'
password/recovery/hardware/translation edits in the original worktree are not included.

## What changed

- Public, staff and farmer surfaces now share water-blue/teal interactions, neutral
  backgrounds, readable sans-serif operational screens, and green crop/brand accents.
- Existing public destinations remain separate. Their shared header/footer now stay
  mounted during navigation; static public content no longer waits for authentication
  or the branded opening video. Staff and recovery retain their existing auth gates.
- Home/About retain the approved copy and concise linked sections. Existing-user
  access is explicit. Landscape disclosure is discreet, not a large image badge.
  Prices remain the existing qualified examples; drafts remain unapproved.
- The controller's lid now shares the physical hinge axis `(-2.86, 0, 0.73)`, opens
  outward around Y to a constrained -2.05 radians, and retains velocity on interrupted
  reversal through a critically damped update. Reduced motion jumps to the requested
  pose. Camera framing accommodates the opened lid. Explicit Open enclosure, Close
  enclosure and Reset view controls remain ordinary keyboard/touch buttons.
- The procedural model remains an illustrative working-prototype visualisation, not
  a certified enclosure drawing. Existing ESP32, YL-69, external DHT11, relay and pump
  roles were checked against the sketch/README (soil 32, relay 25, DHT 27); no pins changed.
  Existing lazy WebGL/static fallback and offscreen renderer suspension remain.
- A separate local-only **Try irrigation — simulation** panel on Experience/Technology
  has Start/Stop/Reset, a droplet button, clipped press feedback, deterministic pipe fill
  and lightweight outlet droplets. Stop removes the effect immediately. Reduced motion
  uses static state changes. The explanatory cutaway has equivalent readable text.
  There are no numeric hydraulic claims, kit identifiers, API calls, timers or MQTT
  imports in this component. This does not replace the existing agronomic demo engine.
- Farmer navigation retains Home/Irrigation/Alerts/History/Settings, with one rounded
  floating gradient dock, selected blue/teal capsule, solid readable inactive labels,
  safe-area clearance and existing keyboard hiding. Existing SVG is reused: no new
  native module. Each gradient has a unique ID, preventing web ID collisions.
- Filled action/danger/success tokens are separate from text/accent tokens, including
  setup buttons, the Stop button and alert badges. Dark dialogs/selects/errors and
  controller captions use theme surfaces/text rather than pale text on fixed white.
- History's actual recorded events gain a quiet notebook margin. Help sheets link to
  the static translated field guide. No generated save/commissioning stamp is added.

## Token roles

| Role | Light | Dark |
|---|---|---|
| Page | `#F7FAFC` | `#101C25` |
| Panel | `#FFFFFF` | `#192B37` |
| Supporting panel | `#E7F3FA` | `#203C4C` |
| Main text | `#183344` | `#EDF5FA` |
| Supporting text | `#526575` | `#BDCEDA` |
| Filled water action | `#126B91` + white | `#126B91` + white |
| Selected gradient | `#126B91` → `#087F8C` + white | same |
| Danger/success filled actions | `#B13B32` / `#28613C` + white | same |

Automated tests require at least 4.5:1 for core text, supporting text, selected
gradient icon colours and filled actions. Focus remains visible. This is not a
whole-app accessibility certification. Public generated imagery remains illustrative.

## Loader cause and measurements

Previously, ordinary anchors reloaded the entire document. The public boot awaited
`initAuth`, and `index.html` gated visibility on both app readiness and a nine-second
video (ten-second ceiling). That repeated for every destination. The new public
navigation changes only the main content and selected/title state, with Back/Forward,
direct refresh, legacy entry points and an honest unknown-page state covered by tests.
The header is verified to be the same DOM node and the document time origin unchanged.

One isolated localhost development-browser sample, same measurement script:

| Destination | Before | After initial change |
|---|---:|---:|
| First Home | 9,702 ms | 437 ms |
| Navigate About | 9,872 ms | 73 ms |
| Navigate Technology | 9,507 ms | 116 ms |

These are local samples, not production/mobile-network benchmarks. Reproduce with
`apps/web/admin/scripts/measure-public.mjs` against a fake-service Vite server on 5183.
Final committed-source sample while other checks were active: Home 1,030 ms,
About 103 ms, Technology 160 ms. Repeat navigation retained the same document
time origin. This variability is why these local samples are not advertised as an SLA.

## Personality inventory and Claude dependencies

| Feature | Production presentation / remaining dependency |
|---|---|
| Farm postcard | Existing real farm name; no invented weather or crop health |
| Underground cutaway | Explicit simulation; explanatory text; original demo values unchanged |
| Pocket field guide | Static en/af/tn explainers; reachable from Home, Settings and page-help sheets |
| Hosepipe progress | Pure supplied-progress component; catalogue only pending journey integration |
| Simple view | Device-only persisted Home simplification; not a complete alternate app layout |
| Day/night water motif | Existing theme preference reused; optional decorative web motion respects reduced motion |
| Drip | Existing optional contextual helper retained; no chatbot or new tracking |
| Notebook history | Existing recorded actions/timestamps, no invented events |
| Confirmed-save stamp | Not shown without authoritative persisted success |

Claude integration checklist (contract read at `origin/fix/audit-oct22`, `6fa2cff`):

1. Wire `HosepipeProgress` and `StickyActionBar` to the four saved farmer tasks in
   `GET /api/farmer/farms/{farmId}/journey`. Do not convert 17 legacy steps to four
   completions. Keep installation/commissioning separate from farmer information.
2. Advance once only after the approved successful save/task response. Preserve inputs
   on error; implement approved revisit/resume and recovery using the same onboarding
   requestId. Validate rural location alternatives without substituting invented places.
3. Wire case owner/next action/confirmed dates, installer evidence/permissions and
   staff-editable service/payer/pricing values. Catalogue values remain labelled simulated.
4. Present server command phase/phaseLabel without timer-inferred kit acknowledgement.
   No offline queuing/replay of real watering commands is introduced by this UI work.
5. Retrieve approved legal versions; keep acceptance unticked until chosen, and show
   recorded acceptance only after server success. Optional marketing/community/Telegram/
   location choices stay separate. Public English documents remain marked drafts.
6. Integrate real missing/stale weather and tank contracts; unknown is not zero or dry.
   Do not add a save stamp until its callback represents committed persistence.
7. Test the replacement wizard on real Android with keyboard open, safe areas, screen
   readers, interrupted saves and both themes. This pass styles the existing wizard only.
8. Coordinate audit migrations 0057/0058 with the separately pending ESP32 0057 before
   integration. This visual branch adds/applies no migrations and does not merge Claude's branch.

New public/demo labels are en/af/tn; Afrikaans/Setswana await fluent review. Existing
English-only staff/form/demo text is not claimed to be fully localised. Legal documents
remain source English with a translation-review notice, not invented approved translations.

## Evidence and verification

New screenshots/recordings: [test-evidence/visual-revision](test-evidence/visual-revision/).
Before screenshots are preserved in commit `7c50378`; do not compare them with locally
regenerated historical screenshots. Videos: `enclosure.webm`, `irrigation-demo.webm`.
All farmer/staff screenshot data is synthetic. Map tiles are blocked deliberately.
No live kit is read or controlled. Public matrix covers 320/390/768/1366, both themes,
en/af/tn; enlarged text has a dedicated 320px case. Farmer fixture coverage is recorded
separately so it is not mistaken for physical-device verification.

Final implementation checks (`6582759`; the browser run started before the last
mobile-only amend, with an identical admin source tree throughout):

| Check | Final result |
|---|---|
| Admin production build | Passed; 817 modules; existing large-chunk warning |
| Complete admin Playwright | **203 passed, 0 failed, 0 skipped, 0 flaky** (7.7 min); 174 retained + 29 revision cases |
| Mobile TypeScript | `npx tsc --noEmit` passed |
| Mobile Jest | **20 suites, 216 tests, 1 snapshot passed**; 210 retained + 6 revision cases |
| Expo web export | Passed; 2,853 modules, 20 assets |
| Expo Android export | Passed; 3,400 modules, 30 assets; bundle only, not APK |
| Protected-scope diff | No backend/hardware/supabase/API-client/context/data-hook changes |
| Whitespace | `git diff --check` passed |

Admin build ran before the uninterrupted suite, so its generated staff-page write
could not reload a test browser. `playwright-final.json` records the complete green run.
No application source changed after these checks; the handoff/evidence commit is docs only.

Evidence totals: **245 PNGs, two WebM recordings and two Playwright JSON reports**.
Public/demo: 100 PNGs; staff: 25; farmer: 120. Farmer English covers ten screens
at four widths in both themes, plus Simple view and doubled-text views. Afrikaans
and Setswana cover Home/zone/tank/Settings plus Simple/doubled-text at 390px in both
themes. All 96 distinct farmer screen/width/theme/language overflow checks were false,
with zero JavaScript page errors. This is not an all-language/all-screen physical-device matrix.

Earlier interrupted full browser run: 199 passed / 4 failed / 0 skipped, spanning an
approval/host pause and a build-triggered reload; retained as `playwright-interrupted.json`.
Development also caught and repaired an overbroad request observer (local module URLs
were mistaken for service calls), an intentionally changed colour snapshot, a test-helper
typing mismatch, duplicate SVG gradient IDs and foreground SVG stacking found by
visual inspection. Unique IDs and a positioned foreground now have regression tests.

Unrun: installed APK/physical Android, native keyboard/safe-area verification, physical
screen readers/voice control, real-farmer usability, fluent translation approval and
authenticated live Vercel deep-link inspection (preview protection requires sign-in).
Expo Android export is a bundle build, not an installed APK. Backend/hardware suites
are outside this presentation-only revision. No production deployment or merge.

## Preview and evidence index

- [Draft PR #3](https://github.com/leruo24/AgroFlow/pull/3)
- [Public/staff preview](https://agro-flow-git-feat-visual-redesign-agroflow3.vercel.app/)
- [Farmer web preview](https://agroflow-mobile-git-feat-visual-redesign-agroflow3.vercel.app/)

Those existing aliases update through the approved automatic preview builds after push;
Vercel sign-in is required. Authenticated screens also need their normal app sign-in.
The previews use their configured services, not the screenshot harness's fixtures;
backend isolation is not assumed. The component catalogue remains development-only.

| Screen | Before (`7c50378`) | After (this branch) |
|---|---|---|
| Homepage | [Before](https://github.com/leruo24/AgroFlow/blob/7c50378/docs/test-evidence/visual-redesign/public-home-en-1366.png) | [Light](test-evidence/visual-revision/home-en-light-1366.png), [dark](test-evidence/visual-revision/home-en-dark-1366.png) |
| About | [Before](https://github.com/leruo24/AgroFlow/blob/7c50378/docs/test-evidence/visual-redesign/public-about-en-1366.png) | [After](test-evidence/visual-revision/about-en-light-1366.png) |
| Staff | [Before](https://github.com/leruo24/AgroFlow/blob/7c50378/docs/test-evidence/visual-redesign/staff-dashboard-en-390.png) | [Light](test-evidence/visual-revision/staff-dashboard-en-390.png), [dark](test-evidence/visual-revision/staff-390-dark.png) |
| Farmer Home | [Before](https://github.com/leruo24/AgroFlow/blob/7c50378/docs/test-evidence/visual-redesign/mobile-home-en-390.png) | [Light](test-evidence/visual-revision/mobile-home-en-light-390.png), [dark](test-evidence/visual-revision/mobile-home-en-dark-390.png) |
| Existing farmer wizard | No newly integrated wizard in either revision | [Light](test-evidence/visual-revision/mobile-wizard-existing-en-light-390.png), [dark](test-evidence/visual-revision/mobile-wizard-existing-en-dark-390.png) |
| Controller | Existing procedural model | [Open left](test-evidence/visual-revision/enclosure-open-left.png), [open right](test-evidence/visual-revision/enclosure-open-right.png), [recording](test-evidence/visual-revision/enclosure.webm) |
| Isolated demo | New panel | [Running](test-evidence/visual-revision/demo-running.png), [recording](test-evidence/visual-revision/irrigation-demo.webm) |
