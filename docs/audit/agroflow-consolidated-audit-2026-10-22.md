# AgroFlow: consolidated audit and improvement plan

22 October 2026 | Product site, staff console, farmer web app and installation journey

Prepared for the AgroFlow team and Mafikeng Cisco Edge Centre. This report consolidates the public web audit, subsequent authorised staff/farmer reviews, deployed frontend review and the HiveMind design comparison. It is a report of work performed during this session, not a new rerun of every check on the date it is downloaded.

## 1. Verdict and decisions

**AgroFlow has working web journeys and useful functionality, but it is not yet simple enough for a farmer with limited technical confidence to complete independently from enquiry to installation. The complete irrigation system has not been signed off.** This usability judgement is based on inspected screens and reproducible problems, not a field study with farmers.

**Full live irrigation demo ready: not verified. Unattended watering ready: not verified.** A staff/farmer interface walkthrough is possible, with the limitations stated. Actual device acknowledgement, physical watering, fault handling and the three-minute failsafe were not exercised. I cannot confirm these controls from this audit.

The team should make three decisions now:

1. Treat onboarding as a service journey: farmer information, staff preparation, installation and commissioning are different stages with different owners.
2. Fix misleading information before adding visual polish: unknown weather must not mean dry weather; saved tank, area, schedule and alert state must agree between screens.
3. Require separate evidence for security and physical irrigation safety. Successful navigation, a disabled button or an HTTP 401 is not enough to sign off the whole system.

### What to change first, in plain terms

1. Let staff create a Sesobe farm from a valid pin without entering a different town.
2. Replace missing-weather Dry/No labels with Unknown and explain the missing input.
3. Make saved tank, area, alert and schedule state agree across screens and reloads.
4. Give the farmer a short farm-information flow; give the installer the measurement, kit and safety checklist.
5. Translate the advice and errors, repair labels/contrast/zoom and make Back behave consistently.
6. Prove the API permissions and physical stop behaviour before claiming unattended irrigation is ready.

These are recommended implementation steps, not changes already applied. Each finding below includes a practical Change / Implement / Verify prescription. Suggested component/contract names describe a proposed design; original repository paths were not available for confirmation.

### Top five problems

| Priority | Problem | Evidence and implication |
| --- | --- | --- |
| 1 | Sesobe cannot be onboarded directly despite valid coordinates | Live failure; staff had to use a temporary recognised locality and correct it afterwards. Rural farms must not depend on a town-name geocoder. AF-01. |
| 2 | Farmer and installer work are mixed into 17 setup steps | Live inspection of all steps; calibration, flow measurement and technical limits appear alongside basic farm information. AF-09. |
| 3 | Decision information is inconsistent or misleading | Unknown weather becomes Dry/No in frontend logic; tank, area and schedule messages conflict. AF-03, AF-05 to AF-07. |
| 4 | Important information stays English in both beta languages | Live Afrikaans/Setswana checks; advice, uncertainty, drought and weather text remain English. AF-02. |
| 5 | Important security and safety claims remain unverified | No RLS/role/tenant isolation, MQTT ACL, command-path, outage or physical failsafe test. This is an evidence gap, not a verified exploit. Sections 8 and 9. |

### Top five strengths to preserve

- Product/staff entry separation works in the tested public navigation: no public staff/admin link found, and both legacy admin URLs redirect to /staff/ at both tested sizes. This is navigation evidence, not backend authorisation evidence. [S1]
- Five sampled protected API routes rejected tokenless requests; sampled CORS preflights allowed the two app origins and withheld permission for an unrelated origin. [S1]
- After loading, the tested no-kit zone disables Water now and explains that no kit is connected. Calibration setup also explains why it must wait for installation. UI safeguard only; no backend or hardware guarantee is inferred. [S2]
- The staff kit wizard is ordered: Farmer, Farm, Zone, Kit, Review. Its review explains the installation credential before creating it. No credential was generated in this review. [S2]
- Forecast, history, community empty states, report selection and tank tracking were accessible in the authorised farmer session. Water usage and tank copy identify their values as estimates, which should be retained. [S2]

## 2. Scope, evidence and exact results

### What was tested

The public product site, staff sign-in/recovery and farmer sign-in/recovery/enquiry were tested at 390x844 and 1366x768 using a separate headless live-site audit suite. A visible browser was also used. Later, authorised staff onboarding created a synthetic farmer and farm; an existing farmer account was explicitly authorised for navigation review after FarmTime login could not be completed. The authenticated pass used the visible desktop browser, not a repeated two-viewport suite. [S1, S2]

| Workstream | Actual result | What the number means |
| --- | --- | --- |
| Public functional checks | 68 unique cases: 60 Pass, 8 Fail | 34 checks at each viewport. Six hidden mobile navigation links plus the staff logo failing at both sizes account for the eight failures; these are not eight separate vulnerabilities. |
| Recorded functional assertions | 72 assertions across initial run and rechecks | 64 initial plus eight targeted assertions. Four replaced previous results and four added cases. Do not add 72 to 68. |
| Public accessibility | 5 axe scans; 9 rule-violation instances; 33 affected node instances | Four distinct failing rule IDs. Nodes/rules recur between scans; not 33 unique bugs and not full WCAG certification. |
| API GET probes | 7 | Public ping 200; five protected routes 401; /health 401 for missing/invalid API-key header. |
| CORS preflights | 3 | Two app origins allowed; unrelated origin not granted allow-origin. Sampled route only. |
| Direct asset probes | 3 | Canonical logo 200; staff-relative logo 404; backdrop direct probe timed out. Independent browser requests recorded backdrop 404. |
| APK download | 1 complete download; 121,081,035 bytes | HTTP 200 and ZIP signature observed. Installation, signing and Android execution were not tested. |
| Farmer navigation checkpoints | 43: 35 Pass, 3 Fail, 5 Partly | Corrected manual checklist; the earlier calibration failure was withdrawn after successful recheck. This count mixes navigation/display inspections, not backend acceptance. |
| Setup screens | All 17 inspected | Form saving, full wizard completion and hardware commissioning were not performed. Existing progress remained 9/17 after optional skips and loading. |
| Translation dictionaries | English 756; Afrikaans 756; Setswana 756 | Zero English keys absent and zero empty values for those keys in either target dictionary. This does not prove translation quality or coverage of hard-coded/server text. |
| Isolated frontend review | 5 weather cases; 4 duration cases; mocked alert failure; forecast branch inspection | Local expression/mock checks and code review, not production fault injection or backend tests. Kept separate from the functional counts. |

The APK SHA-256 was 4a794a8d40c1a9ad373ff64b13203ee9600d42b932d9287a9e791f9baf15fa0c. This identifies the downloaded bytes; no stronger authenticity conclusion is drawn. [S1]

### Important method limits

The headless browser required a special audit transport: a certificate-validating APIRequest client fetched GET/HEAD/OPTIONS responses through the environment proxy and fulfilled browser requests. Certificate checking was not disabled. Writes and service workers were blocked in that transport. This does not reproduce a real phone's service-worker, offline, certificate or networking experience. Authenticated visible-browser work was a separate phase. [S1]

Original private repository access was unavailable during the audit. Production frontend bundles were available and later inspected. Bundle line numbers below identify the deployed minified files, not original repository source. No backend, migration or firmware source was reviewed. No new full regression run was performed while compiling this report. [S1, S2]

### Corrections that must not become development tickets

- Calibration shortcut: earlier appeared unresponsive around a navigation transition. Recheck from a settled zone opened /setup?step=soil with the correct no-kit explanation. The dead-button claim is withdrawn.
- Enquiry claim: final synthetic enquiry state was Open / You with Log call. The earlier delayed update does not establish a claim failure.
- History seven-day filter: after loading, 20 advice entries dated 16-22 October were shown. It passed; initial stale results were not the final state.
- Browser session reset: old tabs disappeared and reopening led to login. The cause was not established; this is not reported as an AgroFlow logout defect.
- WebGL: the interactive product demo could not be verified in a browser with WebGL disabled. This does not prove failure on supported farmer devices.

## 3. Farmer-to-installation journey

### Observed journey

The public enquiry collected contact information, province/town, rough size, crops and preferred call time. Staff can claim/log a call and can separately create a farmer, farm and zones. Direct onboarding collected crop, soil, planting age, flow and root-depth values. FarmTime creation succeeded only after a location workaround; its locality and coordinates were then corrected and verified. Its enquiry remains open after separate onboarding. [S2]

The farmer app presents one 17-step sequence covering language, password, Telegram, location, water source, tank, zones/crop, irrigation method, soil, size, flow, calibration, longest run, alerts, community, help and summary. Some tasks require hardware or staff, while others are farmer preferences. The final summary lists outstanding tasks but does not clearly allocate responsibility. [S2]

The staff kit flow was inspected through Review without submitting. It describes a single-use 24-hour installation credential. That is observed UI copy, not verified expiry/enforcement. The Maintenance visit form asks for kit/device number, work and date. A first visit without an existing kit was not demonstrated; it is not proven impossible. [S2]

### Proposed replacement journey

| Stage | Farmer sees/does | Staff/installer does | Acceptance check |
| --- | --- | --- | --- |
| 1. Request contact | Name, language, preferred contact and village/landmark; optional crop/size | Assign enquiry owner and follow-up | Farmer knows when/how contact will happen; no duplicate enquiry/account |
| 2. Tell us about the farm | Water source, tank if present, plot names/crops, approximate area and planting age | Help with units/location; flag unknown values | Basic farmer details complete without invented technical measurements |
| 3. Ready for installation | Details received; waiting for booking, or appointment details | Confirm prerequisites, named installer and agreed visit | Enquiry, farmer, farm and visit linked in one case |
| 4. Installer checks | Simple explanation of what is happening | Confirm position, map kit to zone, enrol securely, measure flow, calibrate real sensors | Each commissioning check has evidence and an owner |
| 5. Connected and demonstrated | Recognise own field, advice, Water/Stop and Get help | Verify first real reading and controlled command/acknowledgement/stop | No Live/Ready badge until defined checks pass |

These are proposed product changes. Installation prerequisites must be confirmed against the actual water supply, pump, plumbing, power and connectivity arrangement. They were not established by the web review.

### Responsibility rules

- Farmer information should allow a clear I don't know - help me option where staff can resolve it. Do not silently turn an unknown value into a measurement.
- Farmer completion and installation commissioning need separate progress indicators. Waiting for hardware is not farmer failure.
- Staff must see an owner, next action and due/follow-up state. A new farm should not look like a broken installed farm.
- Installer measurements should be labelled measured, with date and provenance. Defaults and farmer estimates should be visibly different.
- Opening a preference from Settings should return to Settings. An incomplete preference must not force the user through unrelated setup steps.

## 4. Consolidated findings, suggested fixes and required checks

Severity describes impact within the audited scope. High usability issues below are not claims of High security exploits. No Critical security exploit was verified. Evidence types are Live, Code review, Isolated check or UX assessment; recommendations are not represented as implemented features.

### AF-01 | High | Rural location blocks initial onboarding

**Evidence:** Live + code review. Sesobe, North West with latitude -25.0368 and longitude 26.4337 was rejected because the location could not be found. The town search offered Sesibitswe, a different locality. Admin asset main-DpkqMOdE.js:2054 creates using locality text, then saves coordinates separately. [S2: ONB-01]

**Reproduce:** Staff onboarding, new farm in Sesobe, enter valid coordinates, submit. **Impact:** valid rural farms require misleading locality workarounds. **Required change:** accept validated manual coordinates independently of geocoder recognition and save farm/location atomically. **Done when:** Sesobe creates correctly without a substitute town, partial creation is recoverable, and repeated submissions do not create duplicates. Backend idempotency remains unverified.

**Suggested implementation:**

- **Change:** Staff onboarding should submit latitude, longitude, locality and province with the initial farm request. In the API, accept valid coordinates even when a town-name lookup has no match. Use geocoding to assist entry, not to veto a correctly pinned rural farm.
- **Implement:** Save the farm, zones and coordinates together where they share a database transaction. Give onboarding a unique request ID. If external account provisioning cannot share that transaction, record a recoverable provisioning state so Retry resumes the same account/farm rather than creating another one.
- **Verify:** Create a fresh synthetic farm in Sesobe using the known coordinates, repeat the same request, and interrupt the coordinate/provisioning stage. Expect one correctly located farm, no substitute town and no duplicate account.


### AF-02 | High | Important advice remains English in both beta languages

**Evidence:** Live language switches. Home headings/navigation changed, but drought explanation, wet/dry setup advice, confidence explanation, Why am I seeing this? and weather terms remained English. Dictionaries have 756 keys each, zero missing English keys. Farmer asset lines 15613-15615; literal shortcut strings also occur at 15751. [S2: UX-01, dictionary review]

**Reproduce:** Select Afrikaans, open Home; repeat with Setswana. Proper farm/zone names are excluded. **Impact:** users may locate a control yet not understand the action or uncertainty. **Required change:** localise UI, generated/advisory text and accessible labels consistently; obtain local-speaker review. **Done when:** essential watering, error, recovery and installation tasks can be understood in each language; English fallback is identified and intentional.

**Suggested implementation:**

- **Change:** Route every visible action, error, weather description and advice explanation through translation, including Why am I seeing this? and accessibility labels. Keep proper farm names unchanged.
- **Implement:** For new generated advice, return a stable message code and parameters rather than only an English sentence; render it in the selected language. Define an explicit fallback for older English history instead of treating complete dictionaries as complete localisation.
- **Verify:** Review Home, zone, setup, alerts, forecast, login/recovery and errors in all three languages. Have Afrikaans and Setswana speakers explain the action and uncertainty back to the team; check long text and restore the test account language afterwards.


### AF-03 | Medium | Missing weather becomes Dry / No rain

**Evidence:** Code review + five isolated cases. Farmer asset line 15548 turns absent conditions into an empty string and checks whether it contains rain. Line 15751 displays false as Dry / No. Null and empty input produced those labels locally. Drizzle also did; that input was illustrative, not captured from the production API. [S2: DEEP-01]

**Reproduce:** Feed null/empty weather into the inspected mapping/render expressions. **Impact:** missing knowledge can look like a confident weather decision. **Required change:** separate availability/freshness from rain likelihood and use structured precipitation fields. **Done when:** missing/stale/unrecognised weather displays Unknown with a reason. The backend irrigation engine must be independently checked; this audit did not prove that it uses this display branch.

**Suggested implementation:**

- **Change:** Make weather availability explicit: available, missing or stale. An absent rain value must be unknown, not false. Show Weather unavailable - check again later instead of Dry / No rain.
- **Implement:** Use precipitation amount/probability and timestamps from a documented API contract. Avoid inferring rain from an English description containing rain. Have the Domain team document a conservative missing-weather policy separately from the display fix.
- **Verify:** Test null, empty, unrecognised and stale weather, plus genuine zero precipitation and rain. Confirm the UI distinguishes unknown from zero and that the engine follows its documented fallback without an unintended watering command.


### AF-04 | Medium | Alert read state is not reliable across failure/reload

**Evidence:** Code review + isolated mock. At farmer asset line 15548, markAlertAsRead does not await/check persistence before marking locally read. Helper at 15631 returns false on database failure. Dashboard mapping at 15548 constructs unread state for fetched alerts. [S2: DEEP-02]

**Reproduce:** Mock a false persistence result; local alert still becomes read. Inspect the reload mapper's unconditional unread assignment. No live alert was changed. **Impact:** an alert can appear handled without a saved change or return as new after reload. **Required change:** await writes, handle/rollback failure, offer retry and hydrate persisted read state. **Done when:** success survives reload and failed/offline updates never silently claim success.

**Suggested implementation:**

- **Change:** Only display an alert as read after persistence succeeds, or clearly roll back an optimistic change on failure. Show Could not save - Try again when it fails.
- **Implement:** Await the read-state write and check its result. Populate read state from the returned saved timestamp/state instead of setting every fetched alert to unread. Keep the read update idempotent and farmer-scoped; prefer the owned API route if that is the agreed application boundary.
- **Verify:** Mark a test alert read, reload and sign back in: it stays read. Then reject or disconnect the write in an isolated test: the alert remains unread, Retry is available and another farmer cannot update it.


### AF-05 | Medium | Schedule display and validation conflict with run limit

**Evidence:** Live + code review/isolated predicate checks. The tested zone showed a five-minute maximum, a Saved 20-minute schedule and zero zones on a schedule in the list while mode was Automatic. At farmer asset line 15751, schedule duration validation accepts finite values 1-1440 without comparing the zone maximum; 5, 20, 1440 and 1.5 passed that local predicate. [S2: FARM-04]

**Reproduce:** Compare list/zone schedule panels; inspect duration predicate with maximum five. **Impact:** the farmer cannot tell what is active or how long watering can run. **Required change:** distinguish active, inactive, default and saved schedules; explain/reject/cap duration according to one documented policy across UI/API/device. **Done when:** the effective run duration is explicit and backend/device limit tests pass. No schedule was saved; a safety bypass is not established.

**Suggested implementation:**

- **Change:** As an initial clear policy, reject a single scheduled run longer than the zone maximum rather than silently shortening or repeating it. Label saved schedules as Inactive when they are not the active watering mode.
- **Implement:** Validate duration against the current zone limit in both UI and API; keep the firmware cap independent. If longer irrigation is required, the team must specify separately how multiple runs are safely scheduled. State units and the permitted duration precision.
- **Verify:** For a five-minute zone, test the minimum, five minutes, just over five and 20 minutes in manual/scheduled/automatic paths. Expect consistent rejection of over-limit requests and physical stop at the allowed cap. This proposed policy needs team approval; it is not an observed backend rule.


### AF-06 | Medium | Tank setup and budget messages disagree

**Evidence:** Live settled screens. Home budget says to set up a tank, while Tank and zone tiles show a 2500-litre capacity/estimate. [S2: FARM-03]

**Reproduce:** Compare Home, Tank and zone after loading. **Impact:** farmer cannot tell whether data was saved or what is actually missing. **Required change:** use one saved-data model and name the missing budget input precisely. **Done when:** existing tank setup is acknowledged everywhere, and any unavailable budget explains the exact missing data without saying the tank is absent.

**Suggested implementation:**

- **Change:** Replace the generic Set up your tank message with the actual missing input. If capacity and volume are present, show them and explain why days remaining cannot yet be calculated.
- **Implement:** Have Home, Tank, setup and zone tiles use the same saved tank summary and explicit missing-reason codes. For example, request field area or flow only when the calculation identifies those specific gaps. Do not infer no tank from an unavailable budget.
- **Verify:** Use fixtures for no tank, known capacity/no refill, known volume/no demand and complete data. All screens must agree; incomplete demand should not erase a valid tank estimate.


### AF-07 | Medium | Area values are inconsistent or rounded away

**Evidence:** Live. FarmTime input was 0.02 ha. Staff summary shows 0 ha, while the kit wizard shows 0.02 ha. Separately, the tested farmer zone says Size not set yet while setup proposes/shows 200 m2. Whether the latter is stored or a default is unverified. [S2: ONB-02, FARM-03]

**Reproduce:** Compare staff farm summary/kit farm picker; compare farmer zone/setup size. **Impact:** small farms look like zero-area farms; farmers may repeat or overwrite information. **Required change:** show appropriate precision/m2 and distinguish saved values from suggestions. **Done when:** 0.02 ha displays as 0.02 ha or 200 m2 consistently, and the farmer zone uses/labels the same source of area.

**Suggested implementation:**

- **Change:** Show FarmTime as 0.02 ha or 200 m2, not 0 ha. Label any suggested area as a suggestion rather than implying it is already saved.
- **Implement:** Choose one authoritative area representation and explicit units at the API boundary, with one conversion/formatting helper shared across views. Reconcile legacy size fields and setup fields before considering a schema migration; do not blindly overwrite existing areas.
- **Verify:** Check 0.01, 0.02, 0.5 and 1 ha across directory, drawer, kit picker, setup and zone details. Save/reload in a disposable test farm, and confirm that 100 m2 converts to 0.01 ha exactly.


### AF-08 | Medium | Settings Back enters earlier wizard steps

**Evidence:** Live. Settings alert preferences opens /setup?step=alerts, step 14; in-app Back shows step 13. The URL still says alerts. Browser Back returns to Settings. [S2: FARM-01]

**Reproduce:** Open Alert choices and quiet hours from Settings, press in-app Back. **Impact:** routine preferences become an unexpected setup journey. **Required change:** preserve entry context and synchronise route with displayed step. **Done when:** preference Back returns to Settings and direct/deep links identify the correct visible step.

**Suggested implementation:**

- **Change:** When alert preferences are opened from Settings, Back should return to Settings. When the same content is part of onboarding, Back should move to the previous onboarding step.
- **Implement:** Carry an explicit entry context/return destination and update the route when the active wizard step changes. Restrict return destinations to recognised internal routes. Do not infer context from a stale step query alone.
- **Verify:** Open from Settings, from fresh onboarding and from a direct step link. Test in-app Back, browser Back and reload; the visible screen and URL must agree, with no unrelated step traversal.


### AF-09 | Medium | No-kit preparation resembles failure; responsibilities are mixed

**Evidence:** Live + UX assessment. FarmTime with no hardware shows Active / Attention Required / Gateway Offline / 0% connectivity. Farmer steps mix information, technical commissioning and preferences. Maintenance booking asks for a device number, with no clear first-installation route demonstrated. [S2: UX-02 to UX-04]

**Reproduce:** Create/view an uninstalled farm; inspect the 17 steps and Maintenance booking form. **Impact:** normal preparation looks broken and responsibility is unclear. **Required change:** implement the stages and owners in section 3; allow a farm-linked first-installation visit before hardware registration. **Done when:** a new farmer can explain what they must do, what staff will do and the next appointment/action. Backend inability to book without a kit was not proven.

**Suggested implementation:**

- **Change:** Split the experience into Farmer details and Installation checks. Show Awaiting installation for a new farm, rather than Gateway Offline as the primary message.
- **Implement:** Model installation stage separately from operational device health. Add a first-installation job linked to the farm before a device exists, with owner, appointment and next action. Keep flow/calibration/commissioning with the installer and let farmers request help for unknown details.
- **Verify:** Use one new synthetic farmer end to end. They should finish their information without hardware, see who acts next, receive a visible booking state and only see Connected after defined real-reading and controlled-command checks pass.


### AF-10 | Medium | Text contrast fails on important public controls

**Evidence:** Five axe scans; sampled white #ffffff on teal #168f99 measured 3.87:1 against 4.5:1 for sampled small text. Product scan included a 3.57:1 pair. Login/recovery actions and product elements were affected. [S1: WEB-001]

**Reproduce:** Recheck affected colour tokens on the product, farmer login and staff login. **Impact:** key actions are harder to read. **Required change:** adjust shared foreground/background tokens and check all states. **Done when:** sampled normal text meets 4.5:1, with disabled/focus/error states separately reviewed. See W3C Contrast Minimum in sources.

**Suggested implementation:**

- **Change:** Use a darker green/teal for small white action text, or dark text on a lighter surface. Fix shared colour tokens so the repair applies to product, farmer and staff screens together.
- **Implement:** Inventory the failing normal-text pairs and check hover, focus and error styling separately. Keep a visible text/icon explanation for status so colour is not the only signal. Do not assume a darker-looking colour meets the contrast target without measuring it.
- **Verify:** Recalculate contrast for the actual foreground/background pairs, rerun the five sampled axe scans and inspect important actions on a real phone outdoors as a usability check, not a replacement for contrast measurement.


### AF-11 | Medium | Product navigation disappears at phone width

**Evidence:** Live suite at 390x844: six section links hidden, no visible replacement menu found; desktop equivalents passed. Hero calls to action remained available. [S1: WEB-003]

**Reproduce:** Open product at 390x844 and look for Experience, Solutions, How it works, Technology, About and Contact. **Impact:** a long phone page loses direct section navigation. **Required change:** accessible mobile menu or compact section navigation. **Done when:** all intended destinations work by touch and keyboard at the tested widths, with visible focus and correct menu state.

**Suggested implementation:**

- **Change:** Add a visible Menu control at phone width, containing the product section links currently hidden. Keep Request a call easy to reach and keep staff/admin access out of the customer menu.
- **Implement:** Use a labelled menu button with expanded state and a controlled navigation region. Support keyboard opening/closing, visible focus, Escape and closing after selection. Prevent the menu from covering the destination heading.
- **Verify:** At 390x844 and 1366x768, reach all six previously hidden sections by touch and keyboard. Confirm the selected section is visible and the header does not obscure it.


### AF-12 | Medium | Farmer viewport restricts zoom

**Evidence:** Farmer HTML viewport declares maximum-scale=1; axe flagged it at both tested widths. Physical-device pinch behaviour was not tested. [S1: WEB-002]

**Reproduce:** Inspect meta[name=viewport] on farmer login. **Impact:** magnification may be restricted for users who need it. **Required change:** remove the restrictive scale and test zoom/reflow. **Done when:** text can be enlarged on actual target Android browsers without losing necessary controls/content.

**Suggested implementation:**

- **Change:** Remove maximum-scale=1 and any equivalent setting that prevents user zoom in the farmer web document.
- **Implement:** Check the generated HTML head rather than changing only an unused template. Make cards and form actions reflow when text grows; avoid fixed heights that clip translated or enlarged text.
- **Verify:** Inspect the deployed viewport declaration, then zoom/enlarge text on target Android browsers. The user must still reach input labels, errors, Sign in, Water/Stop and Help.


### AF-13 | Medium | Form and selection semantics need repair

**Evidence:** Live DOM/AX. Farmer login captions are not explicitly associated with fields; Sign in/Forgot password/Show are focusable divs without button roles. Alert filter radios change results but lack checked/selected state. Request fields have placeholders but no associated labels. Soil-feel dialog has no associated accessible name. [S1: WEB-004; S2: FARM-02, FARM-07, DEEP-04]

**Reproduce:** Inspect these controls in an accessibility tree; select Dismissed on Alerts and compare radio state. **Impact:** screen-reader/voice users have weaker control identity and cannot reliably hear selections. **Required change:** associated visible labels, correct button/radio semantics and checked state, named groups/dialogs and keyboard behaviour. **Done when:** screen-reader users can identify fields/actions, hear selection changes and navigate the full task. Preserve the passing dialog focus trap, Escape and return focus.

**Suggested implementation:**

- **Change:** Give every field a persistent associated label, every action a proper button/link role, every radio a reported checked state and every dialog an accessible name.
- **Implement:** Replace anonymous clickable text where practical. Group related radio choices, update selected state on interaction and associate the soil-feel heading with its dialog. Preserve the already working focus trap, Escape close and focus return.
- **Verify:** Use keyboard and a screen reader to sign in, filter alerts, open/close soil-feel and fill a request. The user must hear field names, control purpose, selection and errors without relying on placeholders or colour.


### AF-14 | Medium | Screenshot gallery lacks a keyboard entry point

**Evidence:** Product phone axe scan flags horizontally scrollable .app-shots as unfocusable with no focusable content. Separate assistive-technology operation was not performed. [S1: WEB-006]

**Reproduce:** Run the gallery keyboard/accessibility check at 390x844. **Impact:** keyboard users may not reach off-screen screenshots. **Required change:** named focusable region or labelled previous/next controls. **Done when:** every screenshot is reachable without touch/mouse and focus remains visible.

**Suggested implementation:**

- **Change:** Provide named Previous screenshot and Next screenshot controls, or a named focusable gallery that supports keyboard scrolling.
- **Implement:** Keep the current descriptive image alternatives and simulated-farm caption. Expose the current image position, preserve visible focus and avoid trapping keyboard users in the gallery.
- **Verify:** Reach each of the seven screenshots without mouse/touch at phone width, then leave the gallery normally. Confirm alternatives and the simulated-data caption remain available.


### AF-15 | Medium | Staff weather health exposes a schema error

**Evidence:** Live staff observation: weather health displayed SQL error 42703, missing updated_at column, position 12. Backend query/migration state was unavailable. [S2: other observations]

**Reproduce:** Recheck the staff platform/weather health view; retain a restricted diagnostic rather than any credentials. **Impact:** a health check is not trustworthy and technical database text reaches the UI. **Required change:** reconcile the health query/schema, log technical detail safely and show staff an actionable explanation. **Done when:** the health check accurately distinguishes weather freshness/dependency failures and schema errors; the test is verified against the deployed migration set. This does not prove all forecasting is broken.

**Suggested implementation:**

- **Change:** Investigate the actual weather table/query and correct the reference to updated_at only after confirming the deployed schema. Do not add a guessed column merely to hide the error.
- **Implement:** Make the health query compatible with the intended migration state and timestamp semantics. Show Weather status unavailable with a diagnostic reference; keep SQL detail in access-controlled logs. Distinguish dependency failure from a broken health query.
- **Verify:** Run the health query against an empty migration replay and the expected deployed schema fixture, then test missing/stale weather and dependency failure. Confirm staff receive a useful message without raw SQL.


### AF-16 | Low | Broken logo and backdrop paths

**Evidence:** Staff-relative logo /staff/brand/agroflow-icon-192.png returned 404; canonical /brand/agroflow-icon-192.png returned 200. Browser requests recorded backdrop 404; later direct backdrop probe timed out. [S1: WEB-005]

**Reproduce:** Open staff login/recovery and inspect asset requests. **Impact:** broken branding and missing visuals reduce trust. **Required change:** root-relative/shared asset resolution and a deployment asset check. **Done when:** exact deployed paths resolve and render on both entry routes and viewports.

**Suggested implementation:**

- **Change:** Use the known working root-relative logo path /brand/agroflow-icon-192.png on staff pages. Correct or remove the stale backdrop reference.
- **Implement:** Centralise shared asset paths and include exact deployed URLs in a small release smoke check. Verify content type and actual image decoding, not HTTP status alone.
- **Verify:** Open product, /staff/ sign-in and staff recovery at both target sizes. The logo/backdrop must load with no broken-image request and appropriate alternative text.


### AF-17 | Low | Forecast error branch has no Retry action

**Evidence:** Farmer asset line 15729 renders plain error text after forecast fetch failure, with no retry control; loader runs on mount/dependency change. Code review only; no signed-in outage injection. [S2: DEEP-03]

**Reproduce:** Inject a rejected forecast fetch in a local/component test. **Impact:** intermittent connectivity requires the user to discover leave/reopen as recovery. **Required change:** accessible Try again, plus last known forecast with timestamp when available. **Done when:** retry recovers in place and stale data is clearly identified.

**Suggested implementation:**

- **Change:** Put a clear Try again button in the forecast error state. Explain when the displayed forecast is cached or old.
- **Implement:** Reuse the existing loader for Retry, expose loading state while retrying and prevent duplicate fetches from repeated taps. Retain the last successful forecast only with its saved timestamp and an explicit stale label.
- **Verify:** Make one request fail and the next succeed in an isolated test. Retry must recover on the same screen, preserve the selected farm/zone and remove the stale/error notice only after success.


### AF-18 | Low | Advice dates and crop model are unclear

**Evidence:** Live. Current forecast loads while advice reports missing weather for 22 September in an October record. The zone name is Spinach field, selected crop Leafy vegetables and growth label leafy veg (lettuce). A zone name does not establish the intended crop. [S2: FARM-06]

**Reproduce:** Compare forecast, advice timestamps and zone crop/growth labels. **Impact:** farmer cannot judge which date/model limits advice. **Required change:** show advice calculation time, relevant input dates, selected crop and any fallback model with a focused correction path. **Done when:** historical missing weather is explained and crop identity comes from confirmed crop data, not inferred from a zone name. No wrong agronomic calculation was established.

**Suggested implementation:**

- **Change:** Show which crop/model the advice uses and the dates of the weather inputs and calculation. Explain historical gaps instead of presenting a September warning as unexplained current advice.
- **Implement:** Return structured provenance alongside advice: selected crop, fallback model if any, input date range and calculated-at time. Offer a direct crop/date correction action. Recalculate according to the engine policy after a saved change; never infer crop from the zone name.
- **Verify:** Use a zone named Spinach field with different explicitly selected crops and missing historical weather. Confirm the display identifies the chosen model correctly and explains why advice is limited.


### AF-19 | Low | Request area lacks an explicit unit

**Evidence:** Live /request asks Rough size and says unit can be confirmed at installation. No request was submitted. [S2: FARM-07]

**Reproduce:** Open a new farm/zone request and inspect size entry. **Impact:** a value such as 2.5 is ambiguous for planning. **Required change:** collect a unit or explicitly store unknown/approximate size; provide a plain example. **Done when:** staff never receive an unqualified numeric area and farmers can ask for measurement help.

**Suggested implementation:**

- **Change:** Place a unit selector next to Rough size: square metres or hectares. Add I do not know - help me measure as an explicit alternative.
- **Implement:** Store value plus unit, or a normalised value with original unit/provenance. Make approximate and unknown separate states. Show staff the same qualification when they plan the visit.
- **Verify:** Submit only in local/disposable fixtures: 200 m2 and 0.02 ha must produce equivalent area, while unknown must remain unknown rather than zero.


### AF-20 | Low | Client phone validation accepts all-zero input

**Evidence:** Live. All-zero ten-digit input passed the public client format gate; subsequent complete submission was rejected by the server. The invented replacement was format-valid but subscriber ownership was not verified. [S1: WEB-008; S2: ONB-04]

**Reproduce:** Enter synthetic name/all-zero phone in the callback form. **Impact:** avoidable round trip and confusing correction. **Required change:** align client/server syntax validation and explain accepted formats. **Done when:** obvious invalid patterns fail consistently. Syntax must not be represented as proof of phone ownership. No server bypass was demonstrated.

**Suggested implementation:**

- **Change:** Reject all-zero input immediately and show a South African phone-format example beside the field.
- **Implement:** Use a single documented normalisation/validation policy on client and server. Support the agreed local/international formats and test punctuation/spacing; distinguish formatting from subscriber ownership. Keep errors linked to the field.
- **Verify:** Run paired client/server fixtures for empty, alphabetic, all-zero, supported formatted and unsupported-length values. Never call or message generated test numbers as part of syntax checks.


### AF-21 | Low | Sampled browser-hardening headers were absent

**Evidence:** Sampled product/staff/farmer HTML responses had HSTS but no observed CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy or Permissions-Policy. These were responses through the audit environment, not origin configuration review. [S1: WEB-009]

**Reproduce:** Inspect deployed entry-point response headers. **Impact:** intended browser restrictions cannot be confirmed. **Required change:** define and test suitable hosting policies, including framing restrictions where applicable. **Done when:** deployed headers match the agreed policy without breaking maps/assets/authentication. No clickjacking/XSS exploit was demonstrated; static-site wildcard CORS is not proof of an API leak.

**Suggested implementation:**

- **Change:** Define a hosting-level header policy for the product, staff and farmer routes. Begin CSP in report-only mode while identifying required scripts, styles, maps and API origins.
- **Implement:** Evaluate framing restrictions, nosniff, referrer and permissions policies, then a tested CSP. Allow only needed capabilities/origins; avoid copying a strict policy blindly because it may break authentication, map assets or generated styles.
- **Verify:** Inspect deployed response headers and test the intended embed/framing rule, sign-in, maps and assets. Review CSP reports for legitimate dependencies before enforcing the final policy; absence of a header alone is not a demonstrated exploit.


### AF-22 | Low | Loading briefly shows missing data as fact

**Evidence:** Live. Home briefly showed 3/17 and tank not set up, then settled to 9/17 and the existing tank estimate. Telegram/no-tank state also changed after loading. [S2: UX-05]

**Reproduce:** Return from setup or open data-dependent pages and observe initial versus settled content. **Impact:** unnecessary concern and repeated setup attempts. **Required change:** distinguish loading/unknown from absent and retain last confirmed values appropriately. **Done when:** unloaded data never asserts that a saved tank/link/progress is missing.

**Suggested implementation:**

- **Change:** Show Loading your setup or a skeleton instead of briefly asserting 3/17, no tank or no Telegram link before the relevant response arrives.
- **Implement:** Represent loading, failed, empty and loaded data explicitly. Keep prior confirmed values during refresh when appropriate, keyed to the correct farmer/farm. Do not reuse one farmer/farm cache for another.
- **Verify:** Throttle and fail the initial fetch in a test environment. No false empty state or other-farm value should appear; success, genuine empty data and failure must each have the correct message.


### AF-23 | Low | Staff user count differs between views

**Evidence:** Directory initially showed zero users for FarmTime; drawer showed one active user. Cache timing was not ruled out. [S2: ONB-03]

**Reproduce:** Repeat new-farm creation and compare settled directory/drawer counts. **Impact:** staff may repeat account setup. **Required change:** investigate membership definitions and invalidation/refresh after creation. **Done when:** counts agree after loading. This is an observed discrepancy requiring confirmation of persistence, not a proven database integrity failure.

**Suggested implementation:**

- **Change:** Make the farm directory count and drawer use the same membership definition. Show a loading placeholder when membership count is not known, not zero.
- **Implement:** Refresh/invalidate the directory summary after successful onboarding and membership changes. Confirm whether owner, active member and invited user are meant to count before aligning the query and labels.
- **Verify:** Create one synthetic farmer/farm and compare settled views, reload both, then exercise membership lifecycle in local fixtures. If the discrepancy cannot be reproduced, close it with evidence rather than changing the database blindly.


### AF-24 | Low | Direct onboarding can leave an unresolved enquiry

**Evidence:** Synthetic enquiry remained Open / You after the farmer was created through a separate path. No call was logged and no linking operation was verified. [S2: UX-06]

**Reproduce:** Compare the synthetic enquiry with the separately created farmer. **Impact:** duplicate work or duplicate account creation becomes possible. **Required change:** offer a controlled Link to existing farmer/Complete enquiry path and matching-record warning. **Done when:** one enquiry can be reconciled without inventing a call or creating another account. This is a workflow gap, not an established linking-service failure.

**Suggested implementation:**

- **Change:** Add Link to existing farmer to the enquiry flow, alongside new onboarding. Show a matching-record warning so staff do not create another account to clear an open enquiry.
- **Implement:** Carry the enquiry ID through normal onboarding and record the relationship once provisioning succeeds. For direct creation, let staff confirm a proposed match; do not automatically link identities solely because unverified contact text matches. Make linking staff-authorised and idempotent.
- **Verify:** Create an isolated enquiry, create the farmer via both supported paths and retry the link operation. Expect one account, a visible enquiry relationship and honest activity history, without logging a call that did not happen.


### AF-25 | Low | Reset view accessible name differs from visible wording

**Evidence:** Product hardware control displays Reset view but accessible name is Reset product view; axe flagged label-content-name-mismatch. [S1: WEB-007]

**Reproduce:** Inspect button[data-hardware-reset]. **Impact:** voice-control matching may be confusing. **Required change:** align accessible and visible wording. **Done when:** accessible name includes the visible phrase in order and keyboard/voice checks pass.

**Suggested implementation:**

- **Change:** Set the accessible name to Reset view, matching the visible text, or change both labels together to an agreed identical phrase.
- **Implement:** Use one text source for the visible label and accessible name so future translation changes cannot diverge them.
- **Verify:** Rerun the label-content-name check and activate the control by keyboard; include voice-control matching where available.


## 5. Requirements assessment

Works means only the specific observed behaviour works. Partly means some UI/flow evidence exists but completion, enforcement or outcome is missing. Can't verify is an evidence limit, not an assertion that the feature is absent. Repository test names and original source lines are unavailable; no such tests are invented.

| Requirement | Status | Evidence and remaining work |
| --- | --- | --- |
| Automate from soil/weather | Can't verify | Advice UI exists; no engine/device execution, weather failure or measured watering test. |
| At least 30% water saving | Can't verify | Runtime/flow estimates shown; no comparable baseline or measured savings calculation. Section 10. |
| Phone remote monitoring | Partly | Farmer web sensor/zone screens inspected; no kit readings, native Android run or authenticated phone-width test. |
| Data-driven decisions | Partly | Advice/growth/forecast screens observed; maths, input freshness and decision correctness unverified. |
| Less labour | Can't verify | No before/after task/labour measurement. |
| Failure/abnormal alerts | Partly | Alert screens/history exist; failure generation, receipt and escalation not exercised. |
| Able to scale | Can't verify | No load test, tenancy/concurrency review or capacity evidence. |
| Staff forgot password | Partly | Email-reset entry/return works; no reset delivered/completed. |
| Unlink Telegram for one farmer | Partly | Farmer unlink control visible; no unlink/relink action performed; staff-specific unlink unverified. |
| Offline features | Can't verify | No offline injection/cache replay/queued-action test. |
| Customer product page; keep customers out of staff console | Partly | Public page and link separation/redirects pass; backend role protection unverified. |
| Easiest possible farmer app | Partly | Essential pages reachable; responsibility, language, consistency and accessibility defects. No farmer study. |
| English/Afrikaans/Setswana | Partly | Switching works, English restored; important text still English; 756 keys each, zero missing en keys. |
| 17-step setup including tank/type/soil/crop/date | Partly | All 17 screens inspected; no complete fresh-account save/reload/commissioning run. |
| Manual and automatic watering per zone | Partly | Mode/run controls visible and no-kit UI guard works; actual commands/acknowledgements not sent. |
| Automatic/manual drought with water budget | Partly | Controls and explanations visible; mode changes, budget correctness and restoration not tested. |
| Community pest/disease/fire/water/weather | Partly | Categories described; no local simulation or report posted. |
| Max two reports per farmer per rolling 36 hours | Partly | UI states two per 36 hours, but one setup sentence says each farm; server identity/window enforcement unverified. |
| Fire alerts reach downwind farms | Can't verify | No local directional/geographic tests. |
| Reports unverified; reporter never shown | Partly | Anonymous/unverified explanatory copy exists; empty feed only, no populated payload/privacy test. |
| Admin province to town to pin to coordinates | Partly | North West, town search and coordinate editing exercised; Sesobe initial failure. Mafeking alias was not tested. |
| Temporary password eight characters / 72 hours | Can't verify | System generated a credential, but its value/length was not read; expiry not tested. |
| Reports | Partly | Selection/ranges and existing ready items load; one Open launched a blob tab; PDF contents/new generation not verified. |
| Requests | Partly | Farm/zone forms and staff views open; no farmer request submitted. |
| Forecast | Partly | Seven dated rows loaded; outage recovery and advice correctness unverified. |
| Tank tracking | Partly | Saved capacity/estimate visible; no refill/size save or accounting verification. |
| Alerts/history | Partly | Screens/filter/empty states pass; persistence failure/reload issues found in frontend review. |
| Product pages/links/screenshots/callback | Partly | Public checks and synthetic enquiry pass in scope; mobile links/assets/contrast need repair. |
| Staff attention list/bell/drawers/settings/moderation | Partly | Farm and onboarding/kit/maintenance/request views inspected; bell label observed. Full attention/retry/moderation/settings flows not exercised. |
| No Why am I seeing this? in staff | Can't verify | Phrase observed in farmer screens. Whole staff-console absence was not systematically established; clarify intended scope. |
| Remove-account dialog Cancel | Can't verify | Not exercised. No account deleted. |
| Farmer blocked from staff/other farms | Can't verify | No authenticated role/ownership API test. Tokenless 401 checks do not establish either. |
| APK downloads | Works | Complete download identified in section 2; execution not tested. |

## 6. Product and interface changes

### Farmer app

The proposed Home hierarchy is: current farm/installation stage, one today's action, watering status, tank, and help. Display advanced detail on demand. This is a recommendation, not a measured claim that a particular screen count is optimal.

- Before installation, show Details received / Waiting for booking / Visit booked, with a clear staff contact route. Hide fault-style kit metrics until hardware is expected.
- After commissioning, distinguish Request sent, Kit confirmed watering, Finished and No response. Do not let an optimistic command state look like physical confirmation.
- Keep main actions consistent: Home, My fields, Alerts, History and Help, with Settings/profile secondary. Explain that a zone is a field or growing area; do not require the farmer to understand database terms.
- Use plain outcome-oriented text: We need your tank size to estimate days remaining; Ask your field officer to measure this; No kit installed yet. Translate complete sentences, not just headings.
- Show units wherever a number is entered or displayed. Offer farmer estimates separately from installer measurements and explain uncertainty.
- Retain helpful sensor/flow/tank caveats. Simplify them where possible without hiding that a value is estimated.
- Use a short optional tour for the most important task and an optional brief video. Help must remain available afterwards and must not block urgent Stop/Get help actions.

### Staff console

Create one case view linking enquiry, farmer, farm, zones, appointment and hardware. Its header should show stage, owner, next action and follow-up date. Offer an explicit first-installation job, with farm linkage before a device number exists. Preselect the farmer/farm when registering a kit from that job and require final zone confirmation.

Separate Not installed, Waiting for connection and Installed but offline. Show staff the prerequisites that are unknown, who will resolve them and whether a value is estimated. Include a commissioning checklist and a restricted diagnostic view so raw SQL errors do not become the main explanation.

### Visual consistency, informed by HiveMind

HiveMind's signed-in empty map, dashboard and setup entry point were inspected. Its account had zero hives, so populated map/live-data behaviour was not evaluated. Its public guide describes completion after a real reading; enforcement was not tested. The inspected UI provides guided tours, a six-stage setup, an optional introductory video and consistent sidebar/card/button styling. [S5]

For AgroFlow, borrow that consistency and progressive disclosure while retaining a green irrigation identity: dark green staff navigation, light page background, white cards, restrained borders/shadows, readable contrast, consistent spacing and one primary action. Desktop staff navigation and phone farmer navigation need different layouts. Do not copy a large desktop sidebar onto a small phone or introduce 3D as a dependency for essential tasks.

HiveMind's self-service firmware/sensor choices should not automatically become farmer responsibilities in AgroFlow. Its implementation/security is not evidence about AgroFlow. All design suggestions here are proposals; no code or configuration was changed.

## 7. Prioritised implementation backlog

Proposed owners are roles for the team to assign, not commitments by named people. Priorities and effort are planning judgements; source access is needed to estimate delivery time. Do not equate a frontend fix with backend/device verification.

| Order | Work package | Proposed owner | Completion evidence |
| --- | --- | --- | --- |
| P0-1 | Rural coordinates and recoverable/idempotent creation; AF-01 | API + staff frontend | Sesobe integration test; valid manual coordinates; duplicate/retry and partial-failure tests |
| P0-2 | Unknown/stale weather and honest decision states; AF-03/18 | API/domain + farmer frontend | Missing/stale input fixtures; Unknown UI; verified engine fallback policy |
| P0-3 | One schedule/run-limit policy; AF-05 | Domain/API + firmware + frontend | Boundary tests through API/device, with observed physical stop/acknowledgement |
| P0-4 | Security and physical safety evidence gates | Backend/security + hardware | Section 8/9 results; no claim of unattended readiness until reviewed |
| P1-1 | Unified tank/area/alert read state; AF-04/06/07/22/23 | API + frontend | Cross-view fixtures; reload and failed-write tests; no false absence/success |
| P1-2 | Farmer details versus installer commissioning; AF-09/24 | Product/UX + full stack | Linked case/visit stages; completion owners; fresh test-account journey |
| P1-3 | Translate important actions/advice/recovery; AF-02 | Frontend + API + language reviewers | Essential tasks reviewed in all three languages; explicit fallbacks |
| P1-4 | Accessibility/mobile entry repairs; AF-08/10-14/25 | Frontend + QA | Two viewports, real phone zoom, keyboard and screen-reader evidence |
| P1-5 | Repair schema-health query and safe diagnosis; AF-15 | Backend/operations | Migration-compatible health query and dependency failure tests |
| P2-1 | Fix assets, phone validation, request units and Retry; AF-16/17/19/20 | Frontend + API as applicable | Exact path checks; paired validation; readable recovery |
| P2-2 | Hosting headers and operational documentation; AF-21 | Operations/security | Agreed policies deployed; regression checks; environment/backup/update runbooks |
| P2-3 | Consistent visual design and contextual help | UX/frontend | Reusable styles/components; representative farmer task review |

P0 means before unattended irrigation sign-off; P1 means before relying on a low-assistance farmer pilot; P2 is important completion/polish work. Backend/hardware investigations can run alongside interface work. Priority is not a fixed sprint schedule.

### Candidate quick wins to scope under one hour each

Correct the root-relative logo path; remove the restrictive maximum scale; align Reset view wording; add an accessible dialog name; reject the obvious all-zero phone pattern; label request units. Each is a candidate only, not a time guarantee. Run the focused acceptance check, then include the result in the relevant release regression.

### Larger changes

The linked enquiry-to-installation case, separate commissioning state machine, localisation of generated advice, shared data/read models, complete accessibility pass, security verification and physical fault tests require broader work. Cosmetic card/sidebar changes should follow or accompany these fixes, not replace them.

## 8. Security, database, architecture and operations sign-off gaps

No verified Critical/High security exploit was found in this scope. This is not a security clearance. I cannot confirm the controls in this table without the missing source, authorised fixtures and tests.

| Area | What is known | Required evidence before sign-off |
| --- | --- | --- |
| Anonymous API access | Five sampled routes return 401 | Full endpoint inventory; public/private classification; tokenless negative tests |
| Role and farm isolation | Not tested with farmer/staff tokens | Farmer denied staff routes and non-owned farms/zones, including guessed IDs and object relationships, using isolated test accounts |
| RLS and grants | No schema/policies inspected | Inventory every table/view/function/storage surface; inspect RLS and anon/authenticated grants; run tenant-isolation fixtures |
| Telegram recovery | UI describes six-digit farmer recovery and staff email recovery | Expiry, one-use consumption, attempt/rate limits, anti-enumeration and recovery alternatives; no live real-account messaging |
| Temporary passwords | Credential generated but not read | Exact length, 72-hour expiry, first-login enforcement, revocation/reissue and delivery/access controls |
| MQTT permissions | No broker ACL/config review | Per-device publish/subscribe boundaries, credential lifecycle and cross-topic denial tests; no direct live publishing |
| CORS/headers | Three sampled preflights selective; some HTML headers absent | Full environment policy and deployed checks; do not treat CORS as authorisation |
| Secrets and dependencies | No private history/manifests reviewed | Redacted secret/history scan reporting file and kind only; npm audit and dotnet vulnerable-package results with remediation |
| DB migrations | No migration replay | Empty Postgres replay, verify-migrations.sql and documented rerun/idempotency policy; compare deployed schema |
| Indexes/FKs/cascades | Not inspected | Main query plans, ownership joins, FK/delete behaviour and safe account-removal fixtures |
| Simulated farms | Public images labelled simulated; FarmTime is synthetic | Clear flags across API/UI, queries and reports; prove simulated commands cannot affect real hardware |
| Architecture/quality | Only deployed frontend fragments reviewed | Confirm apps -> API -> Domain boundaries, Domain dependencies, duplicate/dead/large code, settings, errors/logging; no whole-repo claim yet |
| Deployment/health | Ping 200; protected /health; staff SQL error observed | Docker/runtime checks, liveness versus readiness, dependency diagnosis and required environment-variable NAMES only |
| Backups | Not inspected | Backup policy, encryption/access, recovery point/time targets and an actual restore drill |
| Firmware update | Not inspected | Authenticated/provenance-checked update path, version visibility, rollback/recovery and safe interrupted-update behaviour |

### Required outage behaviours to define and test

HiveMQ outage: distinguish queued/requested commands from acknowledged actuation and verify independent device stop behaviour. Supabase/API outage: identify stale data, reject unsafe control assumptions, recover without duplicating commands. Open-Meteo outage: show unknown/stale weather and apply a documented engine fallback. Telegram outage: keep in-app information available and expose delivery/recovery limitations. These are proposed acceptance criteria, not observations that the current system satisfies them.

## 9. Irrigation path and physical safety test plan

The supplied architecture is irrigation_commands row -> Postgres NOTIFY -> API -> MQTT/HiveMQ -> ESP32 -> acknowledgement/finish -> app. This chain was provided as system context; it was not independently traced through source or simulation. The UI showed a five-minute zone limit. The declared three-minute connection-loss failsafe was not measured.

| Scenario | What the team must establish | Evidence required |
| --- | --- | --- |
| Command loss | Persisted commands cannot silently disappear between notification, publish and reconnect | Local end-to-end simulation with deliberate loss/restart and durable status checks |
| Duplicate delivery/double tap | One request/device command cannot produce unintended duplicate runs | Idempotency key/command identity tests; duplicate/out-of-order delivery fixture |
| Wi-Fi loss | Water stops within the declared safe bound independently of app/cloud | Controlled hardware disconnect, elapsed time and observed flow/valve state |
| Broker outage | Requests do not imply watering; recovery does not replay stale starts unsafely | Isolated broker stop/restart, command expiry and device event trace |
| API restart | Work/status recovers without loss or unsafe duplication | Restart fixture across row/notification/publish/ack boundaries |
| No acknowledgement | Farmer sees a bounded, actionable No response state | Simulated unacknowledged request and timed UI/status assertions |
| Maximum duration | Limit holds through manual, scheduled, automatic and offline paths | Boundary cases in domain/API/firmware plus measured physical stop |
| Stuck valve/relay | Detection and independent mitigation are defined for the fitted hardware | Physical fault analysis/test using actual flow/feedback capabilities; UI status alone is insufficient |
| Empty tank/no sensor/new zone | Unknown/invalid inputs do not become confident advice or unsafe starts | Domain/API fixtures, no-data UI checks and controlled device tests |
| Units/planting date | Area, depth, flow, time and crop-age conversions agree end to end | Explicit unit fixtures including m2/ha, cm/m, L/min and seconds/minutes; absent date policy |

Run these in the local simulator and controlled hardware environment, not by faulting live farms or posting live community/fire alerts. Do not claim the failsafe always fires from a finite UI test. Define coverage, inspect the mechanism and record measured results and residual limitations.

## 10. Agronomy and sponsor outcomes

FAO-56 maths, exact equation/table citations, Kc/Ky values, irrigation efficiencies, crop-stage handling, soil water balance and drought budgeting were not validated against Domain source/tests. A label mentioning FAO-56 or Table 19 is not numerical validation. The team must map each implemented formula/parameter to its primary reference, units, assumptions and independent expected-value fixtures before claiming correctness.

### Measuring water saving

Let B be comparable baseline water volume and A actual AgroFlow water volume, in the same units, with B > 0. Saving percent = (B - A) / B x 100. A 30% saving requires A <= 0.70 x B. No live saving percentage was calculated in this audit. [S1]

Record comparable crop/area, growth stage, weather, watering method, dates, measurement method and missing data. Distinguish metered litres from flow x runtime estimates. Verify the baseline definition and avoid treating incomplete/no watering data as a saving. The displayed 0 L saved does not substantiate the sponsor objective. Yield and crop-health effects require separate evidence.

Less labour also needs a baseline: record comparable manual tasks, time spent, visits, interventions and support calls before/after. Avoid claiming automation has reduced labour merely because an automatic mode exists. Remote monitoring, alert delivery and data-driven decisions need successful operational tasks, not just visible controls.

## 11. Retest and release gates

### UI and onboarding gate

Run the repository builds/tests when source access is available, then the live public smoke suite at 390x844 and 1366x768. Repeat authenticated farmer/staff checks at both widths and on a real target Android browser. Include zoom, long translations, keyboard focus, empty/loading/error states and a genuine failed request/retry. This authenticated width/device coverage has not yet been completed.

Use a dedicated synthetic farmer with an explicitly flagged simulated farm. Complete first login and all farmer-information saves, then reload and compare staff data. Book a test installation, register only isolated test hardware and verify commissioning states. Verify every change can be restored; record the restoration. Test account removal only in disposable fixtures and never confirm deletion of real accounts.

### Security and safety gate

Complete section 8 ownership/role/RLS/credential/ACL tests and section 9 simulation/hardware cases. No live real-account resets, Telegram messages, community reports, fire alerts, direct MQTT publishing or load tests were performed in this audit. Future testing must retain those boundaries unless separately authorised in an isolated environment.

### Farmer usability gate

Run an observed study with representative small-scale farmers, including English, Afrikaans and Setswana users. Ask each to request contact, provide basic farm details, identify what remains before installation, find an appointment/help route and explain whether water has actually started. Record unassisted completion, mistakes, assistance needed and recovery. Set success thresholds before the study. Do not substitute developer confidence or a friend's attractive UI for farmer evidence.

### Outstanding original test requests

| Test | Status and reason |
| --- | --- |
| dotnet build/test and vulnerable packages | Not run: private source unavailable; .NET executable absent during environment check |
| hardware/sim/run-e2e.mjs | Not run: simulation source unavailable |
| Empty Postgres migration replay/verify SQL | Not run: migrations unavailable; psql absent during environment check |
| Admin npm ci/build/repository Playwright | Not run: manifests, lockfiles and test source unavailable; separate live suite results above |
| Mobile npm ci/tsc/Jest/Expo web and Android export | Not run: source/manifests unavailable |
| Firmware compile | Not run: firmware unavailable; Arduino CLI and PlatformIO absent during check |
| Source/history secret and dependency scans | Not run: private source/history/lockfiles unavailable |
| FarmTime first login/full saved setup | Not run: generated credentials not read/transferred; existing authorised farmer session used instead |
| Physical irrigation/outage/failsafe cases | Not run: no isolated kit or simulator access in this audit |
| audit/system-review branch and PR from dev | Not created: dev/source repository inaccessible during audit; no branch changed or merge performed |

These reasons describe the audit environment and access at the time, not proof that the repository lacks those files or the production system lacks those features.

## 12. Live changes, restoration and questions

One synthetic enquiry, one synthetic farmer account, farmTime and two zones were created under explicit authorisation. FarmTime is in Sesobe, North West, with verified coordinates -25.03680, 26.43370. Entered area was 0.02 ha; zones FarmTime Maize and FarmTime Spinach were 100 m2 each. Synthetic soil/flow/root/age values were used for this no-hardware test farm. The phone was invented and ownership not verified; no call/message was made. Do not contact the synthetic record.

Initial creation used a temporary recognised Rustenburg locality to work around the Sesobe failure while retaining intended coordinates. The saved farm was immediately corrected to Sesobe, North West and verified. The synthetic enquiry remains open and needs a proper reconciliation decision, not a fabricated call log.

The authorised existing farmer account's language was temporarily switched English -> Afrikaans -> Setswana -> English; restoration was verified. Optional setup steps were skipped without changing their settings, and settled progress remained 9/17. No live watering, schedule/mode/drought/refill save, alert read/dismiss, Telegram link change, community report, installation credential or visit was submitted in that farmer review. No real farmers/farms/zones/users were created, edited or deleted. No application code, migration, configuration or Git branch was changed. Report/evidence files and local analysis expressions are the only authored audit artifacts.

Passwords, tokens, cookies, QR payloads and secret values are excluded. The generated temporary password was not read by the auditor. HiveMind inspection used the user's authorised account for design comparison, created no hives/devices and is not part of AgroFlow's functional test totals.

### Questions only the team can settle

1. Who owns each handoff: enquiry, farm-data confirmation, appointment, installation and commissioning?
2. What minimum information is truly needed before a visit, and which values must be measured on site?
3. Are farmer setup's area and schedule values saved data, suggestions or legacy-field fallbacks?
4. Why do October advice records refer to September weather, and what does the health-query schema mismatch mean?
5. What is the intended effective run-duration policy across UI, API, scheduler and firmware?
6. Which physical feedback/mitigation exists for a stuck valve or relay on the actual supplied kit?
7. What evidence will establish RLS, staff/farmer isolation, credential expiry and MQTT topic boundaries?
8. What baseline and volume records support the 30% water-saving and reduced-labour objectives?
9. Which deployed commits produced each web app, API, APK and firmware? Which migration set is actually deployed?
10. Who will validate Afrikaans/Setswana comprehension and conduct the observed farmer pilot?

## Sources and evidence register

Findings cite this register and earlier finding IDs so the consolidation remains traceable. The report does not invent original source lines. All live observations are from the 22 October 2026 audit session; they should be rechecked against the release being changed.

- **S1 - Public web audit:** system-audit-2026-10-22.md, 308 lines, original public audit. Evidence under docs/audit/evidence/: web-checks.json, accessibility.json, api-probes.json, http-entry-points.json, asset-probes.json and apk-download.json; screenshots under docs/audit/screens/. The earlier evidence ZIP is AgroFlow-web-audit-2026-10-22.zip. This source contains the detailed 34-by-two functional matrix and scan counts.
- **S2 - Onboarding/farmer/deeper review:** onboarding-audit-2026-10-22.md, version 3, including corrections, staff creation, 43 corrected checkpoints, all 17 screens and isolated review. Supporting data: docs/audit/onboarding/farmer-navigation-checks.json, translation-key-review.json, frontend-logic-review.json and location-reference-checks.json. This source contains the per-step screen inventory and detailed earlier reproductions.
- **S3 - Verified deployed frontend assets:** farmer entry-69719619d7decfe39e74230588a69e7a.js, mapped in audit-work/farmer-bundle.js; admin main-DpkqMOdE.js, mapped in audit-work/admin-bundle.js. These are minified production builds, not private repository source. Relevant line numbers are listed in each finding.
- **S4 - Primary AgroFlow targets:** https://agro-flow-gules.vercel.app/ ; https://agro-flow-gules.vercel.app/staff/ ; https://agroflow-mobile.vercel.app/login ; https://agroflow-production-998d.up.railway.app/api/public/ping ; https://github.com/leruo24/AgroFlow-appk/releases/latest/download/AgroFlowV2.apk . Routes such as /tank, /request, /history, /zone/25 and /setup?step=alerts identify the inspected farmer screens; zone 25 was the authorised existing account's zone, not FarmTime.
- **S5 - HiveMind design reference:** https://beehivemind.co.za/index.html ; https://beehivemind.co.za/login.html ; https://beehivemind.co.za/apiary_map.html ; https://beehivemind.co.za/main_dash.html ; https://beehivemind.co.za/register_hive.html ; https://beehivemind.co.za/public/how-it-works.html . Public pages and signed-in empty-account screens were directly inspected, not security audited.
- **S6 - Location reference:** Statistics South Africa, Sesobe locality page, https://www.statssa.gov.za/?id=10709&page_id=4286 . Used during the original onboarding work to check the test locality coordinates; not a survey of an actual farmer's property.
- **S7 - Accessibility references used in the original public audit:** W3C Contrast Minimum, https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum ; W3C Resize Text, https://www.w3.org/WAI/WCAG21/Understanding/resize-text . The audit is not a full accessibility-conformance certification.

This consolidated report supersedes earlier summaries where they conflict with the corrections above. It now includes practical implementation prescriptions for all 25 findings. It proposes work; it does not claim that fixes were made or that untested controls passed.
