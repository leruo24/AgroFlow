# AgroFlow: visual and service design brief

22 October 2026 | Recommendations and implementation handoff | Updated with Bugs 3 notes

**Keep AgroFlow recognisable. Make the public site inviting, the farmer app reassuring and the staff console organised.** The strongest direction is the ZIP's green, cream and sage palette, with AgroFlow's existing teal retained as a supporting colour. Borrow HiveMind's consistency, helpful personality and theme switch, then adapt them to water and small-scale farming.

This is a proposed design specification, not an implemented redesign or a new system test. It reviews the supplied ZIP, builds on the consolidated audit and separates visual implementation for Codex from behavioural work for Claude Code. No application code, settings, accounts or Git branches were changed for this brief. Prices, service coverage, subscription terms and legal wording need team approval.

## 1. Decisions to make now

1. Keep one logo, a green-led palette and a shared component language across all three surfaces. Do not give every public page a different brand mark.
2. Use the editorial imagery and occasional serif heading on the product site. Use a plain sans-serif for farmer instructions, numbers, forms and staff work.
3. Replace the farmer's single 17-step burden with short farmer-information tasks plus a separate installation checklist. This needs behavioural work before it can ship.
4. Give the staff console a clear identity: AgroFlow Staff, a subtitle explaining its purpose, and work queues organised around customers and installations.
5. Treat AgroFlow as a supported irrigation service: explain equipment, installation, ongoing service, responsibilities and cost separately.
6. Add terms and privacy screens at activation, with optional permissions separate. A checkbox is only the interface; recorded acceptance and enforcement belong to Claude Code.
7. Add useful water-themed personality after repairing misleading states, navigation, contrast and language coverage.

**Definition of professional:** consistent spacing, readable copy, trustworthy states, real screenshots, clear responsibilities and a reliable next step. More animation, glass or decorative dashboards will not compensate for missing information.

## 2. Review of the supplied ZIP

The archive contains nine PNG concepts and one Markdown prompt document. It contains no working pages, reusable component code, responsive rules or tested interaction states. The prompt document identifies the images as generated visual concepts and the readings as illustrative. All nine images were inspected in a contact sheet; the mobile homepage and Experience concept were also inspected at full size. This is a design review, not pixel-by-pixel QA of every caption.

### What to keep

- Warm cream backgrounds, dark green headings, sage panels and restrained terracotta details.
- A clear photographic focal point and generous margins on the public site.
- A visible Android download route without invented app-store badges.
- An explicitly simulated demo and labelled conceptual hardware imagery.
- The relationship between field, advice and farmer action; show this before discussing API or microcontroller details.

### What to revise before implementation

| Concept | Keep | Change or confirm |
| --- | --- | --- |
| Desktop homepage | Strong farm imagery, green identity, clear feature groups | State what AgroFlow actually is before the slogan. Make Request a call the main acquisition action. Explain service and installation. |
| Mobile homepage | Stacked layout and large primary button | Replace the three narrow feature columns with stacked cards. Reduce decorative height so the service explanation and next action appear earlier. |
| Experience | Labelled simulation, scenarios and explanation beside the field | The displayed 80-minute run conflicts with the stated default five-minute zone limit. Separate agronomic water need from permitted command duration; get Claude's approved example. Keep a lightweight 2D fallback. |
| Solutions | Sensor, forecast, watering, alerts and reports grouped together | Show what a farmer can do, what equipment is needed and what depends on connectivity. Do not present a decorative chart as proof of saving. |
| How it works | Simple Sense / Understand / Act story | Add the real service steps: request, assessment, installation and support. Confirm the proposed 30-second reading interval before publishing it. |
| Technology | Concept-labelled enclosure and clear hardware relationships | Confirm every sensor, relay, enclosure and connection against the supplied kit. The prompt's exact hardware labels are not verified specifications. |
| About | Farmer-focused story and honest prototype context | Use relevant local imagery and approved sponsor attribution. Do not imply generated people are customers or that conceptual renders are installed units. |
| Get the app | Preview gallery and clear Android route | Replace generated UI with current, privacy-safe screenshots once implemented. Include Open web app, sign-in help, device requirements and approved release details. |
| Contact | Clear call request, optional email, contact-purpose wording | Allow village/landmark and unknown farm size. Do not require a recognised town to accept a rural enquiry. Separate enquiry contact permission from service terms and marketing choices. |

There is also a visible brand inconsistency: the mobile homepage uses a green leaf mark while Experience uses a green/orange droplet-like mark. Keep the approved existing AgroFlow logo; use a droplet as an interface motif, not a second logo. The mobile preview's Home / Fields / Insights / Settings navigation also differs from the current app. Do not copy those labels into production without a route and feature inventory.

## 3. Visual system: familiar, cleaner, more consistent

These are proposed tokens, not a claim that they already exist in the repository. Codex must first inspect the actual theme and reuse its green/teal anchors where they meet contrast requirements.

| Role | Proposed colour | Use |
| --- | --- | --- |
| Forest | #143D2A | Main buttons, headings, staff sidebar, brand anchor |
| Existing teal reference | #168F99 | Water accents and illustrations; not small white button text without adjustment |
| Accessible deep teal candidate | #0E6F77 | Water actions or links after checking actual foreground/background contrast |
| Cream | #F7F5ED | Public-site background; sparingly in operational screens |
| Sage | #E8EEE5 | Quiet sections and selected-row backgrounds |
| Ink | #18342B | Main operational text |
| Muted ink | #526359 | Supporting text; check each pairing |
| White | #FFFFFF | Forms, operational cards, drawers |
| Terracotta | #AD563A | Small decorative accents; not a universal warning colour |
| Night background / panel / text | #10231C / #19362B / #F1F5EE | Proposed dark theme; every state needs separate contrast review |

**Status colours are separate from branding.** Pair an icon and a word with every status. Offline should have a connection icon and last-contact time; a fault needs a fault label; waiting for installation needs a calendar or tool icon. A green crop illustration must not imply a connected kit.

Use an eight-unit spacing rhythm: 8, 16, 24, 32 and 48 px, with 4 px for small adjustments. Use approximately 12 px card corners and a consistent 1 px border. Reserve pill shapes for status chips and small selectors; every panel does not need rounded bubbles or a shadow.

Use the current readable sans-serif if suitable. Operational body text starts at 16 px, supporting text generally 14 px; public hero headings can be larger and editorial. Use at most one additional serif family on the public site, with limited weights and a readable fallback. Numbers need explicit units and consistent formatting: 200 m², 0.02 ha, 6 L/min, 5 min. Never round a real small farm to 0 ha.

Normal text needs at least 4.5:1 contrast, with the WCAG large-text exception at 3:1 [R1]. Aim for 48 px primary touch targets as an AgroFlow design choice; WCAG 2.2's AA minimum is 24 by 24 CSS px with stated exceptions, not 48 px [R2]. Support text enlargement to 200% without losing content or functionality [R3].

Use subtle glass only for nonessential marketing overlays, with a solid fallback. Forms, numbers, status and watering controls should sit on opaque surfaces. Do not lay essential white text directly over a changing farm photograph.

## 4. Water-themed personality: exact places to add it

Borrow the friendliness of HiveMind's theme control and helper, not its bee identity or every dashboard feature. The earlier comparison observed HiveMind's labelled theme control, grouped sidebar, optional tours and guided registration. It did not validate all its behaviour or security.

| Idea | Location and behaviour | Guardrail / owner |
| --- | --- | --- |
| Daylight / Night watering | A droplet-shaped switch in the public header, staff account area and farmer Appearance settings. Show literal Light / Dark labels too. | Codex: System / Light / Dark preference; honour system until explicitly changed. Theme changes appearance only. |
| Sunrise-to-moon transition | One short transition when the theme changes, using a sun and moon over a field line | Codex: no looping weather animation; remove motion when reduced motion is requested. |
| Drip, the field guide | Small optional droplet illustration beside Need help? on setup and empty screens | Codex can provide approved contextual help. A chatbot, messaging or AI service is a separate Claude dependency. |
| Filling tank illustration | Tank screen beside the numeric volume, capacity and last update | Only map real known inputs; label estimates. Unknown volume shows an unfilled outline and Unknown, not an empty tank. |
| One gentle ripple | Completion of a successful local preference change, or a confirmed save | No ripple on failed saves, queued requests or unacknowledged watering. Do not create a false success cue. |
| Field-name greeting | Home heading such as Your farm, at a glance, with the actual farm name underneath | Use saved data. Do not generate confident crop-health claims or invented local weather. |
| Quiet growing illustration | Empty reports/history state with a seedling and Data will appear after your kit is connected | Preserve the real reason. No reassuring empty-state copy when the actual state is a fetch error. |
| Water journey graphic | Public How it works: soil reading, advice card, controlled irrigation | Static or optional animation. Technical details expand below; essential content works without WebGL. |
| Personal field markers | Crop/plot icons beside named zones and a clear selected marker | User labels remain visible; never identify zones only by colour or crop artwork. |
| First real reading milestone | Small inline Your first reading is here message after verified commissioning | Requires authoritative event/state from Claude. No confetti during a command, fault or overdue task. |
| A drop of help | Short optional explanation under unfamiliar terms, e.g. A zone is an area watered together | Test the wording with local speakers. Use plain labels first; the pun is supplementary. |
| Watering progress strip | Zone detail: request, kit response, running, completion | Requires authoritative command state. A moving wave must never substitute for confirmation or flow feedback. |

Start with theme, tank illustration and contextual help. These contribute more than mascots everywhere. Avoid compulsory tours, sound effects, celebratory water-saving scores, parallax and gamified pressure to irrigate. Keep Stop, no response, unknown and faults plain and visible.

## 5. Public site: explain the product and sell the service honestly

### Recommended navigation and homepage order

**Updated direction from the additional notes: the public headings must open separate pages, not scroll to sections of one long page.** Retain recognisable destinations for Experience, Solutions, How it works, Technology, About, Get the app and Contact. Request a call remains the main acquisition button. Give Service & pricing its own page and clear links from Solutions, Contact and the footer; do not invent prices. A compact navigation menu may group destinations, but every page must remain discoverable. Use a real mobile menu with the same destinations, keyboard support and visible close control.

Keep the homepage as a concise overview with short previews linking to these pages. Section 18 specifies proposed routes and acceptance checks. This supersedes the earlier suggestion to combine public sections. Preserve old entry points with suitable redirects or routing compatibility rather than breaking bookmarked links.

1. Hero: what it is, who it helps, main action and farmer sign-in route.
2. Three outcomes: check conditions, understand advice, manage watering.
3. What you receive: field kit, farmer app, installation and ongoing service, subject to approved scope.
4. How you get started: request contact, assessment, account details, installation, handover.
5. What is required: water source, appropriate irrigation plumbing, power/connectivity and site assessment. Team must approve exact requirements.
6. Service and cost explanation, with inclusions and exclusions.
7. Real app preview or clearly labelled simulation, followed by practical FAQs and a final call request.

**Proposed hero copy:** AgroFlow: smart irrigation for small farms. Check your soil and weather, understand when your crops need water, and manage connected irrigation from your phone. Main button: Request a call. Secondary: See how it works. Small text link: Already registered? Open farmer app.

Keep Every drop counts as supporting brand language. Avoid guaranteed savings or yield claims. The sponsor's 30% saving is a target requiring a comparable baseline and measured or clearly estimated water records; it is not a proven product result from this audit.

The public audience is farmers, assisted smallholders and organisations supporting farms. Explain who each service is for. Present the sponsor in an approved footer/About block without implying certification or an unconfirmed commercial partnership. Keep staff entry separate from customer navigation; backend authorisation is still essential.

### Contact and app access

Contact form: name, preferred language, phone or approved contact method, province, village/town and landmark; crop and size can be optional at enquiry stage. Show units next to size and provide I don't know. Confirmation must state that this is an enquiry, not an activated subscription or booked installation. Display a reference and response expectation only when the system and team can support them.

Get the app should offer Open web app and Download Android APK. Explain who can sign in and how account details are supplied. Give the approved APK version/date and installation help without asking users to disable device protection broadly. Do not invent Play Store or iOS availability. Make release-link checking part of deployment verification.

## 6. Subscription service: make the commercial relationship understandable

Do not invent prices or launch three artificial tiers. Start with one clear service explanation and quote-based pricing until the team approves its commercial model. This recommendation does not assert that billing or subscriptions currently exist.

| Cost or responsibility | What the customer needs to see |
| --- | --- |
| Equipment | Purchase, rental or included equipment; ownership and replacement terms |
| Installation | Site assessment, travel, plumbing/electrical work and commissioning inclusions/exclusions |
| Ongoing subscription | Agreed charge, billing period, supported farms/zones, service scope and support route |
| Additional costs | Connectivity, power, consumables, repairs or extra zones where applicable |
| Sponsored service | Who pays, what the farmer owes, what happens when sponsorship ends |
| Cancellation or suspension | Approved notice, equipment return and data-access policy; technical watering consequences require engineering review |

The quote/review screen should summarise setup cost, recurring cost, payer, start date, inclusions, exclusions and approved terms before confirmation. Avoid an unexplained From R... headline. If billing is undecided, say Request a quote rather than showing fake plans.

In farmer Settings, add Service & support: service status, payer, approved plan description, contact route and next billing date only if authoritative data exists. A sponsored farmer must not see an unexplained overdue balance. Staff sees the related service agreement in the same customer case, with appropriate access controls.

Codex can design pricing cards, quote summary, sponsor state and billing-empty/error screens. Claude owns prices from the backend, entitlements, billing integrations, renewals and suspension policies. **A subscription check must not make Stop or fault assistance disappear.** Engineering must define physical operation on suspension; this brief does not choose a valve or automation policy.

## 7. A realistic enquiry-to-installation journey

The service should work for a farmer who can explain their field but cannot measure pump flow, configure hardware or recognise FAO terminology. Support both independent use and an honest staff-assisted path. Do not require an email address unless an actual identity/recovery dependency makes it necessary; if it does, explain the dependency rather than inventing one.

| Stage | Farmer experience | Responsible person and next action |
| --- | --- | --- |
| 1. Enquiry received | We received your request; here's how we will contact you | Assigned staff member follows up; enquiry remains distinguishable from an account |
| 2. Needs confirmed | Review contact, location, crops, water and rough area; mark unknowns | Staff checks suitability and links the enquiry to the proposed farmer/farm |
| 3. Service agreed | Understand equipment, ongoing charge or sponsorship, responsibilities and terms | Staff supplies approved quote/service summary; farmer accepts through an authorised process |
| 4. Account activation | Choose language, set own password, read/accept terms, confirm contact preferences | System provides secure activation; staff helps without impersonating consent or retaining passwords |
| 5. Farm information | Complete a few short tasks with I don't know and Save and continue later | Farmer or identified helper supplies estimates; staff resolves missing essentials |
| 6. Installation booking | See proposed vs confirmed appointment, prerequisites and who to contact | Staff confirms suitability, visit, installer and required kit; no invented confirmed date |
| 7. Installation | Installer visits; farmer sees plain-language progress | Installer measures, connects, calibrates, maps zones and records checks |
| 8. Demonstration and handover | Recognise own field, understand advice, practise supported Water/Stop and find help | Installer verifies real readings and controlled command response; gives a simple handover card |
| 9. Ongoing use | One next action, meaningful alerts, support and service information | Staff owns unresolved issues and follow-up; farmer can review information and preferences |

Stages may be assisted during a visit; the exact commercial sequence needs team approval. Repeated enrolment must resolve to the same case rather than create duplicates. Backend identity/linking and state transitions are Claude work.

### Replace the single Setup X/17 burden

Present four farmer tasks: **Your preferences / Your farm / Your water / Your crops**. Each task contains short screens, so this is not a claim that all existing fields fit into four inputs. Show Your details: 3 of 4 sections complete separately from Installation: awaiting booking. If the existing backend still provides only a 17-step count, do not invent a new completion percentage in the frontend.

- Preferences: language, secure account activation, contact/notification choices and optional community participation. Terms acceptance is its own explicit step.
- Farm: name, village/landmark, optional pin and estimated size; map permission is optional, with a manual alternative. Staff can check coordinates.
- Water: source, whether a tank exists and capacity if known. Unknown capacity differs from no tank and empty tank.
- Crops: named plots, crop, planting date or approximate age, irrigation method if known. Show which values are estimates and which will be measured.

Move flow measurement, sensor wet/dry calibration, kit enrolment, device-to-zone mapping, safety-limit configuration and controlled command checks to the installer checklist. Farmers can view explanations and later reference the results. Do not hide settings that farmers need to understand; assign who can edit them through approved roles.

Unknown values need an explicit route to staff, with an owner and status. Merely adding I don't know while leaving submission blocked recreates the same problem. Save/resume requires a defined persistence contract; a frontend success message is insufficient.

## 8. Terms, privacy and optional permissions

This is a screen and journey proposal, not legal advice or a claim of compliance. Have the team and appropriate legal adviser approve the agreement, privacy notice, subscription terms, eligibility and assisted-acceptance process.

Add a standalone **Before you start** screen during activation, before service use where the approved policy requires it. Give a short readable summary followed by accessible links to the full documents. Show the document version/date and an obvious way back. Do not put the whole agreement into a tiny scroll box or imply that scrolling proves understanding.

Suggested layout: service provider and service summary; what the farmer does; what AgroFlow does; important connectivity/installation limitations; price/sponsorship summary where applicable; Terms of service link; Privacy notice link; explicit unchecked acceptance control; Continue; Get help. The actual acceptance wording must be approved.

Keep optional marketing, community participation, Telegram linking and location permission separate. Do not describe all data handling as something cured by one bundled consent checkbox. Explain contact permission at enquiry time separately from accepting a paid service. Community screens must explain that reports are unverified and reporter identity is not publicly displayed; actual enforcement remains Claude's responsibility.

The acceptance record needs authenticated identity, version, timestamp and a defined method. Backend verification, version changes, revocation consequences, retention and staff-assisted acceptance are Claude/team decisions. Do not treat local storage, a screenshot or staff ticking a box as proven farmer agreement. Provide Help me understand without letting staff silently accept on someone else's behalf.

Codex acceptance checks: keyboard-operable controls, unchecked default, readable links, errors announced, language preserved, Back retains unsent state, no double-submit appearance, and a clear failure message if acceptance cannot be recorded. Continue must only report success after the approved server response.

## 9. Farmer app: recommended screen design

Use a consistent top bar with farm name, language/help access and connection status. Recommended phone navigation: **Home / Irrigation / Alerts / More**. Keep History, Reports, Tank, Forecast, Settings and Help clearly listed under More, with relevant shortcuts from Home and zones. Prototype this choice before removing current primary routes; returning users need recognisable names.

### Home hierarchy

Before installation, lead with Your farm details are received, the next task or appointment, who acts next, and Get help. Do not fill the page with red offline warnings for a kit that has never been installed. If booking data does not exist, show Booking information unavailable rather than promising a visit.

After commissioning, lead with urgent issues, then Today's next action, then named zones, tank and forecast summaries. Show last reading time and availability. A recommendation can read Check Maize plot with a short reason; agronomic wording must come from approved data. Put complex confidence/FAO explanations behind a plain How this advice was made link.

| Screen | Visual and interaction requirements |
| --- | --- |
| Login / activation | Large labelled fields, Show password, clear recovery route, no dependency on staff jargon; keep credentials out of notifications and screenshots |
| Home | One obvious next action, actual farm identity, installation vs operational state, fresh/stale/unknown distinctions |
| Irrigation list | Zone name, crop, current mode, kit availability, last update; direct route to the zone rather than an ambiguous whole-card gesture |
| Zone | Named Sensor readings, Water usage and Zone details sections; use tabs only if labels fit. Prominent command status and Stop when relevant |
| Water control | Plain action and duration/limit, pending state, acknowledged running state, completion and no-response state. Do not change command semantics in a styling PR |
| Soil-feel sheet | Short illustrated options with text, selected state and clear submit/cancel; explain that this is farmer input, not a sensor measurement |
| Alerts | Severity, plain message, affected zone, time and next action; read state must come from persisted data. Empty and failed fetch are distinct |
| History | Default date range, filters with visible selection, loading indication, readable timestamps and data origin |
| Reports | Period, units and metered/estimated label. No savings percentage without an approved baseline. Clear generation/downloading/error state |
| Tank | Known/unknown volume, capacity, last update, estimate label and water-source detail; accessible numeric equivalent to the illustration |
| Forecast | Place, provider/update time, readable days, Retry on failure; unknown is not dry and stale is visibly labelled |
| Drought | Plain explanation, active state, budget with units/period, source of the mode and approved manual override state; no joking copy |
| Settings | Language, Appearance, Notifications, Service & support, Account, Terms & privacy. Back returns to Settings rather than unrelated setup |
| Help | Contextual how-to, installation/support route, connection explanation and approved physical-stop instructions if available |

### Watering feedback must tell the truth

Use distinct labels for Request sent, Waiting for kit, Kit confirmed start, Stop requested, Kit confirmed stop and No response, according to the actual API model. A device report of completion is not proof of measured water flow if the hardware lacks that feedback. Keep estimated litres separate from measured litres.

If there is no acknowledgement, show Watering has not been confirmed, with the command's actual status and approved next steps. Do not claim a retry is safe until Claude verifies idempotency. When Stop cannot be confirmed, show a persistent serious warning and approved field-contact instructions. Do not infer water is stopped from a local timer or disconnected interface.

Offline design can show clearly dated cached information and saved help. Draft farm-information edits may be proposed if sync/conflict behaviour is implemented. Do not queue irrigation Start, Stop or mode changes for later delivery as a visual convenience. Loss of app connectivity must not make the screen promise that a command succeeded.

## 10. Staff console: a clear workplace, not a marketing page

Use a forest-green sidebar, white work surfaces and compact but readable forms. Header: **AgroFlow Staff**. Supporting line: Manage enquiries, farmers, installations and support. Show the signed-in role and separate customer-data actions from global settings. Actual permissions remain server-enforced.

Recommended navigation: **Overview / Enquiries / Farmers & farms / Installations / Support & requests / Reports / Drought & community / Settings**. This is a proposal to validate against actual permissions and routes, not a claim that each workflow already exists. Community moderation, drought farms and global configuration should be clearly separated within that group; do not mix farm-level actions with global policy switches.

The overview should answer What needs my attention today? Group unassigned enquiries, next visits, overdue follow-ups and installed-kit faults. Each row needs customer/farm, state, owner, next action and date. Do not show raw database enums such as AttentionRequired or GatewayOffline; use approved human labels while preserving technical details in a restricted diagnostic section.

### Customer case and installation detail

One case should link enquiry, contact preferences, farmer, farms/zones, quote/service state, visit, kit and support history. Keep a chronological record of real actions. Staff should not need to invent a call log or search a second screen to reconcile direct onboarding.

Use a full detail page for extended onboarding work. Use a drawer for quick inspection and short edits; on a phone it becomes a full screen with a visible heading, Back/Close and safe keyboard handling. Distinguish saving, unsaved changes and failed saves. Never show a Save success toast before persistence succeeds.

Location picker: province, town/village search, landmark, optional map pin and editable coordinates with format hints. Accept manual coordinates when valid even if a rural name is unknown. Offer recognised aliases such as Mafeking as helpful search results, not silent replacements of a farmer's location. Show which source supplied the pin and ask staff to confirm it.

Bell and needs-attention list should use the same source and explain the next action. Error panels need Retry and a useful support reference, without raw SQL or internal secrets. Counts must settle consistently after loading; show placeholders until authoritative data arrives.

Keep Forgot password clearly visible on staff login and use the approved staff recovery route. Password changes, farmer Telegram unlinking and account removal must have precise identity/context. Removal uses a clear consequence summary and prominent Cancel; visual review never requires confirming removal of a real account. Do not put passwords or installation credentials in general activity feeds.

## 11. Plain language, localisation and accessible states

| Current or technical concept | Preferred presentation |
| --- | --- |
| GatewayOffline | Kit not connected, with last contact time and an appropriate next step |
| Setup 9/17 | Your farm details plus a separate installation stage, only after the model supports it |
| Primary action / engine advice | What to do next, with an expandable explanation |
| Unknown weather rendered Dry / No | Weather unavailable, with timestamp/retry if supported |
| Root depth / flow rate | Installer measurement with units and a short explanation |
| Provisioned / active | Account created / awaiting installation / connected, mapped to real states |
| Data loading zeros | Skeleton or Loading; real zero appears only after a valid response |
| Failed save | We couldn't save your changes. Your entries are still here. Try again. Only promise retention if it is implemented |

All visible and accessible text must pass through localisation: errors, validation, advice, theme labels, dates, units, consent, no-response messages and backend-generated explanations. Existing dictionaries had equal key counts in the audit, yet important English remained. Equal dictionary size is not completion. Have Afrikaans and Setswana speakers review action meanings, not just spellings.

Every data component needs five designed states: loading, known value, valid empty, stale/offline and error. Destructive or command controls additionally need submitting and authoritative result states. Document these in the component catalogue rather than improvising per screen.

Support visible focus, labelled fields, real button semantics, named dialogs, keyboard menus, focus return, text errors and screen-reader status announcements. Do not rely on hover, colour, gesture or icon shape alone. Respect safe areas, keyboard overlap, browser zoom and reduced motion. A 48 px button is not sufficient if its label is clipped in Setswana.

## 12. Ownership boundary: Codex visuals, Claude behaviour

| Codex can implement as presentation work | Claude dependency / constraint |
| --- | --- |
| Tokens, typography, spacing, responsive shells, imagery and logo path repair | No change to API, domain, firmware or migration behaviour |
| Light/dark/system preference and reduced-motion support | User-local preference only unless an existing supported settings API is used |
| Labels, unit formatting, accessible components and reusable state layouts | Backend message codes/units/provenance may need a contract change |
| Contextual help, literal empty/error states and mobile menu | Do not conceal operational faults or invent data |
| Terms/pricing/activation screen prototypes | Recorded acceptance, billing, entitlements and secure activation require implementation and approved content |
| Separate farmer vs installer flow prototype | Stage model, progress, permissions, save/resume, case linking and appointment persistence need Claude work |
| Command-state presentation from existing authoritative data | Idempotency, acknowledgement, retries, offline behaviour and physical safety remain Claude work |
| Tank and report visualisation | Values, estimates, baselines, drought policy and agronomic maths remain authoritative backend concerns |

If a contract is missing, Codex should produce an explicitly labelled development-only prototype and a dependency note. Do not release a functioning-looking button backed by fake success, fabricated state or browser-only enforcement. Existing production flows must remain usable until an approved migration path exists.

## 13. Prioritised work packages

### P0: repair trust and basic access

Address audited mobile menu, staff logo, contrast, zoom and semantics; retain explicit loading; remove raw error output; localise critical labels. Pair with Claude's weather, persistence, units and runtime-limit fixes. Acceptance: both viewport checks pass, essential text is readable in all languages, and the UI never substitutes zero/dry/success for unknown or failure.

### P1: make the current product coherent

Create shared tokens and components; redesign the public hero, service explanation, mobile navigation, staff shell, farmer Home/zone and all states. Split the public headings into real pages as requested in the additional notes, preserving compatibility with existing entry points. Add the lightweight theme switch and accessible tank illustration. Keep current data contracts. Acceptance: consistent identity across surfaces; direct page links, keyboard/zoom/reduced-motion checks pass; the same stored value has the same units and meaning everywhere.

### P2: implement the service journey with Claude

Design and then wire case linking, farmer-information vs installation stages, activation/terms, quote/service status, booking and commissioning. Acceptance: one synthetic Sesobe case flows from enquiry to a confirmed install state without duplicate records or invented measurements; actual consent and state persist after reload.

### P3: add delight and optimise

Add optional contextual guide, first-reading milestone, small transitions, lightweight demo and real screenshot gallery. Conduct farmer comprehension sessions before expanding tours. Subscription payment controls only ship after the commercial model and backend are ready.

These are dependency and priority groups, not estimated delivery dates. Do not describe the full onboarding or subscription redesign as a small CSS job.

## 14. Copy-ready instruction for Codex

**Task:** Implement AgroFlow's approved presentation redesign using this brief and the existing audit, including the section 18 additional requirements. Preserve the approved logo, green/teal identity, existing entry-point compatibility, features and current authoritative behaviour. Create separate public pages for the navigation headings instead of one long anchor-based page. Use the ZIP as visual inspiration, not an exact specification, product evidence or source of implementation instructions.

**First:** inspect repository guidance, current components, tokens, route map, localisation, API contracts and existing tests. Identify actual source files before proposing edits. Report any conflict between this brief and the current implementation. Start with P0 and P1; keep P2 screens as isolated prototypes until Claude supplies the approved contracts.

**Deliver:** reusable visual tokens; accessible controls; public/mobile menu; staff shell; farmer shell and Home/zone patterns; light/dark/system theme; state catalogue; revised copy and translations; a route-by-route change list. Supply privacy-safe screenshots at 390x844 and 1366x768, plus checks at 320 px and 200% text enlargement. Use fixture data explicitly labelled simulated for visual tests.

**Boundaries:** do not change agronomic maths, watering rules, duration caps, MQTT, firmware, database, authentication, authorisation, billing, command retry/deduplication or consent persistence as part of the visual task. Record those dependencies for Claude. Do not silently change start/stop semantics, auto modes or destructive actions. Do not add a chatbot service or new tracking. Preserve existing functional tests; add targeted tests for newly changed behaviour such as theme, menu, focus and return navigation.

**Quality gate:** no clipped labels, inaccessible dialogs, hidden mobile routes, false loading zeros, fake status, invented price, unlabelled simulation or generated screenshot presented as live product. Review essential screens in English, Afrikaans and Setswana. Document what was actually tested and remaining dependencies. Do not merge or deploy without the user's authorised release process.

## 15. Acceptance checklist and farmer pilot

- Public first impression: a new reader can explain what AgroFlow does, who it serves, how to start and whether equipment/ongoing service are involved.
- Journey: a farmer can identify their next task and who acts next, without measuring hardware parameters before a visit.
- Identity: the same logo and recognisable green/teal palette appear throughout; themes do not change operational meaning.
- Responsive access: 390x844 and 1366x768 screenshots are reviewed, with additional 320 px, keyboard, enlarged text and reduced-motion checks. Include long names and translations.
- Data trust: known zero, unknown, stale, empty and fetch failure have distinct appearances and copy. Simulated, estimated and measured data are labelled.
- Watering comprehension: users can explain whether they requested watering, received a kit response, or still lack confirmation. Stop remains findable in relevant states.
- Service clarity: approved price or quote route, payer/sponsor, inclusions, exclusions and contact route are understandable. No placeholder prices reach production.
- Terms: approved documents and explicit choices render accessibly; completion is only claimed after recorded acceptance succeeds.
- Recovery: errors retain appropriate entries, allow retry and do not create duplicate visible records. Backend guarantees require Claude's separate tests.
- Pilot: recruit representative small-scale farmers across the three languages. Ask them to request a call, activate a test account, mark unknown farm details, find the appointment/help route and interpret command states. Record unassisted completion, mistakes, help needed and explanations in their own words. Set target outcomes before testing.

No farmer study, new authenticated regression, actual subscription or new safety test was performed for this brief. The existing audit's test counts remain unchanged.

## 16. Decisions the team must supply

1. Is AgroFlow currently a prototype, paid service, sponsored pilot or combination, and in which locations is installation available?
2. Who owns equipment, connectivity, installation, maintenance and each customer handoff?
3. What are the approved setup/recurring costs, payer arrangements and consequences of cancellation or sponsorship ending?
4. Which basic farmer details are truly required before booking, and which measurements belong exclusively to the installer?
5. How are activation credentials delivered securely when a farmer has limited digital access, and which recovery channels actually work?
6. Who approves translated agronomic, consent and support wording? Who can legally accept on an organisation's behalf?
7. What exact backend evidence qualifies a farm as connected, commissioned, running and stopped? Does the kit provide measured flow feedback?
8. Which logo, hardware photographs, sponsor attribution and field imagery are approved for public use?

## 17. Evidence and reference notes

**Design source:** agroflow-complete-redesign(1).zip, supplied by the user. Nine images and agroflow-design-prompts.md; exact filenames are listed in the archive. Concept visuals are not implementation evidence. The proposed colour values above partly derive from its prompt document.

**Audit source:** agroflow-consolidated-audit-2026-10-22.md, current version 1, read for this brief. Particularly AF-01 rural location, AF-02 languages, AF-03 weather, AF-05 limits, AF-07 area, AF-08 Back, AF-09 preinstallation, AF-10 to AF-16 accessibility/navigation/assets and AF-22 loading. These are prior findings, not new reproductions in this design pass. No private source file paths are invented here.

**Comparison source:** earlier authorised visual inspection of https://beehivemind.co.za/apiary_map.html and related registration/dashboard pages, recorded in the audit. Theme control, navigation and guided stages inspired proposals; HiveMind code, private account data and artwork are not copied. Theme-switch behaviour was not independently exercised in this design pass.

**R1:** W3C, Understanding SC 1.4.3 Contrast (Minimum): https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html . Used for the text contrast thresholds, not a claim of certification.

**R2:** W3C, Understanding SC 2.5.8 Target Size (Minimum): https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html . Used to distinguish the AA minimum and exceptions from the proposed larger AgroFlow targets.

**R3:** W3C, Understanding SC 1.4.4 Resize Text: https://www.w3.org/WAI/WCAG22/Understanding/resize-text.html . Used for the 200% text-resize check. These primary references were opened while preparing this brief.

**Additional source:** Bugs 3 (2).pdf, user-supplied three-page document. All three pages were rendered and inspected for this update. Page 1 supplies a location-failure screenshot and wizard/onboarding notes; page 2 supplies a broken-logo screenshot and the separate-pages request; page 3 supplies public-site/About screenshots and spacing/responsiveness notes. These are supplied observations and preferences, not fresh live reproductions. The original attachment remains unchanged.

## 18. Additional requirements from Bugs 3

This section makes the new notes actionable and takes precedence where earlier design suggestions conflict. It adds no new automated test counts or confirmed backend defects. The phrase wizard misbehaves reports a problem but does not identify its exact failing transition. **I cannot confirm this** as a specific implementation fault without reproducing the sequence or reviewing the relevant source.

### B3-01: location failure must be recoverable

**Source:** page 1. The screenshot shows Unable to onboard farmer and a locality lookup error while coordinate fields are present. This is consistent with the previously audited location-failure category AF-01. It does not independently establish that the coordinates are correct or that both failures have the same backend cause.

**Requested design:** use distinct sections for Contact, Farm location and Zones, with a short review before submission. Keep the location summary beside the map or manual coordinates. Offer Town/village search, Pin location and Enter coordinates as clear alternatives, plus a landmark. Explain which fields are required and label suggested versus confirmed location. Valid manual coordinates must not require choosing an unrelated town; enforcement needs Claude's API work.

On failure, preserve entries and show an inline message near the location section, not only a generic blocking pop-up. Identify the actionable problem and provide Retry lookup, Edit location or the approved manual-coordinate path. If the system may have partly created the account or farm, do not offer an unconditional Create again. Claude must supply a recoverable operation status and duplicate-prevention contract.

**Owner and verification:** Codex owns field grouping, instructions, inline errors and accessible alternatives. Claude owns lookup rules, initial coordinate submission, atomic/recoverable creation and idempotency. In a disposable fixture, test a recognised town, a rural locality, a misspelling/alias, no lookup result, unavailable map/geocoder and interrupted submission. Expect retained entries and one correctly linked record after recovery. These checks have not been run for this update.

### B3-02: predictable wizard progression and button placement

**Source:** page 1 says Once you complete a step it must move the button and reports wizard glitches. The intended movement is ambiguous. This brief interprets it as progressing to the next step after Save and continue, while keeping the action button in a stable position. It does not claim that physically moving a button is the requested solution.

Use a consistent action area: Back, an optional Save and exit where supported, and one primary Save and continue. On small screens it can be a sticky footer with safe-area padding and sufficient content padding; it must not cover fields, validation or the on-screen keyboard. On desktop, align it consistently beneath the form or in a matching footer. Do not make users chase a button as content changes.

After a successful save, advance once, update the step heading/progress and move focus to the new heading. Do not advance merely because a dropdown, radio option or checkbox was selected. During saving, show Saving and prevent duplicate submission. On failure, remain on the same step, preserve inputs and identify the error. A successful local draft save is not equivalent to a persisted server save.

Completed steps should be visibly marked and revisitable without losing later answers. Back must retain entered values; browser Back/Forward, reload and resume need a defined supported behaviour. Optional Skip must say what remains incomplete. If a step belongs to the installer, say Your installer will complete this and provide a valid exit instead of making the farmer pretend to finish it.

**Owner and verification:** Codex owns the action area, focus, labels and visual states. Claude owns approved step-state, persistence and transition behaviour where it changes application logic; frontend routing can consume that contract. Test slow save, failed save, double click, Back, revisiting, reload, resume and all languages in an isolated environment. Verify exactly one successful transition, no lost answers and no hidden action beneath the keyboard. No particular glitch or root cause is newly confirmed here.

### B3-03: communicate the whole onboarding journey

**Source:** page 1 asks for clearer communication about what happens when and where.

Add a short Where you are now panel to the farmer Home and staff case. Show current stage, completed work, next action, responsible person/team and known date or Waiting for booking. Example proposal: Your farm details are saved. Next: AgroFlow staff will confirm an installation visit. Only use saved or confirmed when supported by the real state.

At entry to each task, say what information is needed, why it is being requested and whether the farmer or installer completes it. At the end, give a review and explicit next step rather than returning to an unexplained dashboard. In staff views, keep the linked case visible so enquiry, farm, zones and installation are not separate mysteries. Do not invent a staff member, booking date or promised response time when none is assigned.

**Verification:** ask a farmer to explain what they have finished, whether installation is booked, who acts next and how to get help. Staff should find the same stage and owner from the linked case. This extends section 7; it does not replace its farmer/installer separation.

### B3-04: repair the logo on every entry point

**Source:** page 2 visibly shows a broken image above AgroFlow / Staff sign-in. This supports the existing asset finding AF-16, but does not identify a new root cause from the image alone.

Use one shared brand component and an approved asset path that works from root, nested pages and /staff/. Set intrinsic dimensions to prevent layout jumps; provide appropriate alternative text and a text fallback. Do not replace the logo with a loading-looking blank box or introduce a second unapproved logo. Check both light/dark variants for legibility.

**Verification:** inspect root, staff login, recovery, each new public route, direct deep-link reload and mobile menu. Verify the asset response succeeds and inspect browser network errors. Do not mark this fixed solely because the logo appears through client-side navigation from the homepage.

### B3-05: separate public pages with working direct links

**Source:** page 2 explicitly requests separate pages for the headings instead of one long scrollable page. The paths below are proposed, not assertions about current deployment.

| Proposed path | Purpose and minimum content |
| --- | --- |
| / | Concise overview, audience, key benefits and next action |
| /experience | Clearly labelled simulation, explanation and lightweight fallback |
| /solutions | Farmer tasks, included capabilities, requirements and limitations |
| /how-it-works | Sensor-to-action explanation plus enquiry-to-installation journey |
| /technology | Approved kit/components and connectivity; conceptual imagery labelled |
| /about | Purpose, beneficiaries, project/team roles, sponsor context and service responsibility |
| /get-the-app | Web and Android routes, sign-in eligibility and installation help |
| /contact | Enquiry form, assistance and clear post-submission expectations |
| /service-pricing | Approved service scope, quote/pricing route, payer and inclusions |
| /terms and /privacy | Approved readable documents linked from activation and footer |

Each page needs a unique heading, relevant page title, selected navigation state, appropriate CTA and shared header/footer. Reuse components rather than copying entire page implementations. Keep the homepage short enough to scan; a separate page may still scroll naturally when its own content needs space.

Preserve legacy URLs and fragments through explicit compatibility behaviour. Keep the already required /admin/ and /#/admin staff redirects intact; do not accidentally capture /staff/ in a marketing-page fallback. Coordinate any Vercel route fallback with the deployment owner rather than changing configuration during a visual review.

**Verification:** navigate every menu item, open each URL in a fresh tab, refresh, use Back/Forward and check an unknown URL. Test both public mobile navigation and desktop navigation. A successful in-app transition alone does not prove deep-link hosting works.

### B3-06: About must explain the people and service

**Source:** page 3 asks for a better About section beside a short headline and paragraph.

Use a dedicated About page with these blocks: What AgroFlow is; Who it helps; Why it exists; How field kit, farmer app and staff support work together; Who does what; Project/sponsor context; Current availability and limitations; How to start. Link service/pricing details rather than burying costs in About.

Proposed introductory copy: AgroFlow brings field readings, weather information and irrigation advice into one service for small farms. Farmers use the app to understand their fields and manage connected watering. Staff help with setup, installation and support. Publish only after the team confirms that the described service scope is accurate.

Explain farmer, staff and installer responsibilities in plain language. Include approved Mafikeng Cisco Edge Centre attribution and real team/contact details only when supplied and approved. Use actual hardware/farm imagery where available; mark generated illustrations honestly. Avoid invented testimonials, deployment counts, water-saving achievements, subscription capabilities or 24-hour support promises.

**Verification:** an unfamiliar reader should explain what is provided, who it is for, who installs/supports it and how to ask for help. Confirm all named people, organisations and service promises before publication.

### B3-07: boundaries, breathing room and responsive layout

**Source:** page 3 asks for clearer UI boundaries, adjustment to different screen sizes and content that does not hug screen edges. This is a requested design improvement, not a measured overflow defect established from the screenshot. Responsive layout is separate from infrastructure scalability.

Use a centred public container with a proposed 1200 px maximum width, 16 px side gutters on narrow phones, 24 px on tablets and 32 px on desktop. Operational pages can use a wider bounded work area where tables need it. Full-width backgrounds and photographs may bleed to the edge; their text and controls must respect content gutters. Use 16-24 px inner card padding and the spacing rhythm in section 3.

Add subtle 1 px boundaries to real groups: enquiry form, zone card, tank summary, report controls and staff detail sections. Use headings, spacing and surface contrast alongside borders. Do not put a separate box around every label or create a border-within-border maze. Provide visible keyboard focus independently of card boundaries.

Cards should flow from one column on narrow phones to multiple columns only when labels and actions fit. Forms stack before controls become cramped; long labels wrap. On phones, convert appropriate tables to labelled cards or provide clearly indicated table-local scrolling. Avoid whole-page horizontal overflow. Drawers become full-screen detail views where needed; keep Close/Back reachable.

**Verification:** capture 320, 390, 768 and 1366 px widths, and check 200% text enlargement, long English/Afrikaans/Setswana labels, open keyboard, safe areas, menus and error messages. Confirm no clipped content, obscured actions or accidental page overflow. These widths and spacing values are proposed design checks, not results already achieved.

### Updated delivery order

First resolve recoverable location failure and wizard save/progress with Claude, while Codex repairs logo, spacing, accessible navigation and state presentation. Next implement distinct public pages and the fuller About page. Then wire the explicit farmer/staff/installer journey to approved contracts. Add playful details only when the critical steps are understandable and stable. The audit's existing test results and outstanding security/safety checks remain unchanged.
