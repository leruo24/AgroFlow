# AgroFlow system demo v4 — PLAN (Phase 1)

Branch `feature/showcase-v4` (from `dev` at `4592bd7`). Work lives in `showcase/v4/`; v3 and its renders are untouched.
Output (Phase 2/3): `showcase/renders/INF3003W_Team02_ShowcaseDemo_v4.mp4` + `.srt`, 1920×1080, 25 fps, H.264 + AAC.

**One story, two personas** (fictional; labelled “persona” on screen): **Thabo**, a smallholder tomato farmer near
Mafikeng (North West) with one field split into two irrigation zones; **Naledi**, an AgroFlow field officer at the hub
who uses the admin website. All screens use mocked demo data (“(demo)” names, `.invalid` emails, fake codes) — no real farmers.

Planned length **4:40.9** (281 s), narration **607 words** (≈ 140 wpm spoken, ≈ 130 wpm over the whole video including pauses). Hard max 5:00.

---

## a) Feature check — does each step exist?

| Step | Exists? | Proof (files) | What is different / missing |
|---|---|---|---|
| 1 Problem hook | Yes (framing only) | — | Conceptual scene; no statistics are claimed (none were measured). |
| 2 Enquiry on the landing page | Yes | `apps/web/admin/src/pages/welcome.ts` (landing), `pages/enquiry.ts` (form + phone check “Please give a South African phone number…”), `backend/AgroFlow.Api/Endpoints/EnquiryEndpoints.cs` (POST /api/public/enquiries, server re-check, per-IP limit, honeypot, thank-you text) | The button reads **“Ask for a call”** under the heading “Interested in AgroFlow? Get a call back”. Thank-you text: “Thank you, a representative will call you within 2 working days.” |
| 3 Naledi gets it, I'll handle this, log call | Yes | `EnquiryEndpoints.cs` → `NotifyAdminsAsync` (`TelegramNotificationService.cs`), `EnquiryRules.AdminMessage` (`backend/AgroFlow.Domain/EnquiryRules.cs`), `apps/web/admin/src/pages/enquiries.ts` (I'll handle this, Log call, outcomes: Wants AgroFlow / Call back later / No answer / Not interested), `EnquiryAdminEndpoints.cs` | The Telegram notice is plain text (“New enquiry: {name}, {town}, {crops}, call in the {time}”), sent only to admins who linked Telegram; no buttons. Enquiries is a tab on the **Requests** page. |
| 4 Onboarding wizard, enquiry completed | Yes | `apps/web/admin/src/pages/onboarding.ts` (two steps + handover), `app/interactions.ts` (`onboardingFromEnquiry` → `markEnquiryOnboarded`), `FarmerOnboardingEndpoints.cs`, audit action `enquiry.onboarded` (`AuditLogEndpoints.cs`) | Started from the enquiry's “Start onboarding” link (only when the outcome is Wants AgroFlow). |
| 5 Codes and login over Telegram; temp password; forced change | Yes | Handover step in `onboarding.ts` (QR + “Or type this in” link + temporary password shown once); `TelegramOnboardingService.cs` (link `https://t.me/<bot>?start=<code>`); bot welcome text in `TelegramNotificationService.cs` (email, temporary password, app link or “download is coming soon”); `apps/mobile/src/context/AuthContext.tsx` (`must_change_password`), `_layout.tsx` guard, `app/update-password.tsx` (“Set Your Own Password”) | When the farmer scans the QR, **the bot issues a fresh temporary password** (the one on screen stops working). App link text depends on whether the APK URL is configured. |
| 6 Kit setup / enrollment | Yes | `apps/web/admin/src/app/interactions.ts` (“Register a kit” wizard → “Enrollment code” modal, shown once), `DeviceEnrollmentEndpoints.cs` (POST /api/devices/enroll, /api/devices/claim), firmware `AgroFlowIrrigationNode.ino` (WiFiManager portal “AgroFlow-Setup-XXXX”, parameter “Enrollment Code (from admin)”), 3D model `apps/web/admin/src/features/hardware3d.ts`, `hardwareModel.ts` | The setup page is served by the board itself; it can't be captured here (no hardware), so it is shown as a **labelled illustration** using the firmware's real field names. The 3D controller shows only real parts (ESP32, Soil Moisture Sensor, DHT11, 5 V relay, pump output, power input). |
| 7 Zone setup in the app | Yes | `apps/mobile/src/app/zone-setup.tsx` (Finish setup), `zone-crop.tsx`, `zone-soil.tsx`, `lib/setupHelpers.ts` (presets incl. “Field / plot (about 200 m²)”), `components/CalibrateSoilSheet.tsx` (wet/dry), 500 mL bottle helper | Planting date is asked as “about how many weeks ago”. |
| 8 Daily use: Today card, confidence, Why, 7-day | Yes | `components/TodayCard.tsx`, `WhySheet.tsx`, `app/forecast.tsx`; `RuleBook/TodayRules.cs`, `Explanations.cs`, `ConfidenceRules.cs`, `ForecastOutlook.cs` | Engine wording changed on 9 Oct (`c913b28`): Today now follows `Fao56Engine.PrimaryAction` (WaterNow, WaterNowReduced, PostponeForRain, CheckField…). Demo numbers will be produced by running the real domain engine (below). |
| 9 Execution | Partly different | App: `app/zone/[id].tsx` (Manual → “Start Manual Run”, 1–60 min check, confirm); command → `IrrigationCommandNotifyService.cs` → MQTT `agroflow/farm/{farmId}/device/{deviceId}/commands`; firmware relay; confirmation `POST /api/devices/commands/{id}/executed` (`DeviceCommandEndpoints.cs`) + `POST /api/irrigation-events`; 5-min cap `SAFETY_MAX_RUN_MS`; Experience demo `apps/web/admin/src/experience/*` | (a) The real app's button is **“Start Manual Run”**, not “Irrigate” (the website demo has an “Irrigate” button). (b) The board confirms over **HTTP**, not MQTT. (c) The app has no live pump-on indicator (Relay shows “Unknown”); the confirmation surfaces in History. (d) The Experience demo uses **its own example field** (“North Field”, 1,600 L); only its field-watering visual is used, cropped and tagged as a visualisation. |
| 10 Weather change, alert, Why | Yes | `Fao56Engine` PrimaryAction PostponeForRain / WaterNowReduced; `TodayRules.cs` (“No watering today: rain is expected to cover it.” / “Rain helps, but water …”); `WeatherAlertService.cs` (> 20 mm/day), Telegram text + Why button (`TelegramClient.WhyButtonText`, `TelegramPollingService.cs`, `AlertExplanations.Weather`) | Weather alerts go to **Telegram only** (not the app's Alerts tab). The Telegram text also says automatic mode does not pause for rain; we will show that line truthfully or crop it. |
| 11 Reports + auto-report schedule | Partly different | App `app/reports.tsx` (Water usage / Soil moisture / Watering schedule & advice → **PDF**); admin `pages/analytics.ts` (Farm reports: Preview · PDF · Excel; Automatic reports daily/weekly/monthly via Telegram) ; real samples `docs/sample-reports/` (written by backend test fixtures) | Farmers get **PDF only**; Excel is from the admin console. |
| 12 Naledi's view | Yes | `pages/dashboard.ts`, `farms.ts`, `requests.ts`, `operations.ts`, `analytics.ts` | — |
| 13 Testing & validation | Yes | Phone check (`enquiry.ts`, `EnquiryRules`), duration 1–60 (`zone/[id].tsx`), password ≥ 8 (`update-password.tsx`); suites: `backend/AgroFlow.Domain.Tests` (dotnet test), `apps/web/admin/tests` (Playwright), `apps/mobile` (jest) | The .NET 8 SDK is now installed in this container (Ubuntu package 8.0.131), so all three suites can be run in Phase 2 and the real counts used. |
| 14 Close, names and roles | Yes | `showcase/presentation/AgroFlow_Intro_Script.md` (names, roles) | **Please confirm spellings**: the deck uses Msuku / Matlhatsi; an earlier document used Masuku / Mathlatsi (`AgroFlow_Slide_Source_Audit.md`). |

**Nothing in the storyline is dropped.** Steps 9 and 11 are adjusted to what the code really does (see the last column).
Not shown because we don't have it: flow meter, rain sensor, pH sensor, LoRa, Raspberry Pi (none appear; the 3D model has none).

---

## b) Storyboard

| # | Time | On screen | Persona | Kind | Narration line |
|---|---|---|---|---|---|
| 1 · Problem hook | 0:00.0–0:17.1 (17.1 s) | Off-white title card over a field illustration (two irrigation zones, crop rows, drip line). Short kinetic text: “Too much wastes water. Too little stresses the crop.” AgroFlow logo. | — | Conceptual | On many small farms, watering is guesswork. Too much wastes water and electricity; too little stresses the crop. AgroFlow helps a farmer decide when to irrigate, and how much. Walking every field to check takes time too. |
| 2 · Enquiry | 0:17.1–0:38.4 (21.3 s) | Persona card “Thabo · persona · tomato farmer near Mafikeng · 1 field, 2 irrigation zones”. Browser: real landing page → scroll to “Interested in AgroFlow? Get a call back” → Ask for a call → form filled with fake details; a bad phone number shows the real error “Please give a South African phone number, for example 082 123 4567.” → fixed → thank-you message. | Thabo | Real website (Playwright) | Meet Thabo, one of our personas: a tomato farmer near Mafikeng, with one field split into two irrigation zones. He finds the AgroFlow website and asks for a call back. If he mistypes his phone number, the form tells him straight away. It takes about a minute. |
| 3 · Naledi handles it | 0:38.4–0:59.3 (20.9 s) | Persona card “Naledi · persona · AgroFlow field officer”. Mocked Telegram chat (labelled) with the real admin text “New enquiry: Thabo (demo), Mafikeng, tomato, call in the morning”. Admin console → Requests › Enquiries tab → “I'll handle this” → Log call drawer → outcome “Wants AgroFlow”. | Naledi | Real admin (Playwright) + mocked Telegram | Naledi, our second persona, is a field officer at the AgroFlow hub. Telegram tells her a new enquiry has arrived. In the Enquiries tab she taps 'I'll handle this', so nobody else calls him too. After the call, she logs how it went: Thabo wants AgroFlow. |
| 4 · Onboarding | 0:59.3–1:18.9 (19.6 s) | Admin: “Start onboarding” from the enquiry → onboarding wizard step 1 (prefilled, fake email) → step 2 farm “Thabo's Farm (demo)”, Mafikeng, North West, two zones (Zone 1 / Zone 2, tomato, loam) → “Farmer onboarded successfully” → enquiry shows Onboarded; Activity row “… onboarded the farmer from enquiry …”. | Naledi | Real admin | She starts onboarding straight from the enquiry, so his details are already filled in. She adds his farm and both zones, with the crop, soil and size. When she finishes, the enquiry closes as completed, and the activity log records who did it. |
| 5 · Login over Telegram | 1:18.9–1:40.7 (21.8 s) | Admin handover step: QR code + “Or type this in” link (fake bot code) and the temporary-password panel (value blurred). Mocked Telegram chat (labelled) with the bot's real welcome text (email demo, password blurred, app link). Phone: real sign-in screen → “Set Your Own Password” screen. | Naledi → Thabo | Real admin + real app + mocked Telegram | To hand over, Naledi shows a QR code. Thabo scans it, opens the AgroFlow bot in Telegram and presses Start. The bot sends his sign-in email, a temporary password and the app link. The first time he signs in, the app asks him to choose his own password. |
| 6 · Kit setup | 1:40.7–2:06.3 (25.6 s) | Website: the real 3D field controller (closed → open; component labels ESP32 · Soil Moisture Sensor · Temperature & Humidity · 5 V Relay · Pump · Power). Admin: Kits › “Register a kit” → modal “Enrollment code” (value replaced with DEMO-0000). Labelled illustration of the kit's setup page: network “AgroFlow-Setup-XXXX”, Wi-Fi fields and “Enrollment Code (from admin)”. Admin Kits list: kit online. | Naledi (installer) | Real website 3D + real admin + labelled illustration | Next, the field controller: an ESP32, a Soil Moisture Sensor, a temperature and humidity sensor, and a relay for the pump. Naledi registers the kit and gets a one-time code. On site, the kit opens its own setup Wi-Fi. The installer enters the farm Wi-Fi and the code, and the kit links itself to the right zone. |
| 7 · Zone setup in the app | 2:06.3–2:33.2 (26.9 s) | Phone: Finish setup for Zone 1: crop & planting weeks, soil cards, size preset “Field / plot”, flow rate with the 500 mL bottle helper, “Teach the sensor your soil” wet/dry sheet; checklist items turn Done; confidence rises. | Thabo | Real app (Expo web, Playwright) | In the app, Thabo finishes each zone: crop, planting date, soil and size. For the flow rate, he times how long his tap takes to fill a 500 millilitre bottle. Then he teaches the sensor his soil, with one wet and one dry reading. A checklist shows what is still missing, and the advice gets surer as he goes. |
| 8 · Daily use | 2:33.2–2:58.8 (25.6 s) | Phone: Home “Today” cards for Zone 1 / Zone 2 (action, minutes and litres from the real engine), confidence badge, “Why am I seeing this?” sheet; then “The week ahead” screen. | Thabo | Real app | Each morning, Home shows one action per zone. Today, zone one needs watering, with the minutes and litres worked out. It says how sure it is, and 'Why am I seeing this?' shows the reasons: the weather, the crop's stage and the water left in the soil. The week ahead shows what each day means for watering. |
| 9 · Execution | 2:58.8–3:21.9 (23.1 s) | Phone: zone screen → Manual → duration → Start Manual Run → confirm → “Manual command sent”. Diagram: app → API → MQTT → ESP32 relay → pump; kit reports the run (HTTP) → History “Irrigation recorded”. Website Experience AgroFlow: the field-watering moment (pump, sprinklers, soil wetting), cropped to the field, tagged “Website demo · visualisation”. Chip “Safety cap: any single run stops at 5 min”. | Thabo | Real app + conceptual + website demo (visualisation) | AgroFlow recommends; Thabo decides. He starts a run from the app. The command reaches the kit over MQTT, the relay switches the pump on, and the kit reports the run back. For safety, no single run lasts longer than five minutes. Here, our website demo shows the watering, as a visualisation. |
| 10 · Weather change | 3:21.9–3:42.0 (20.1 s) | Phone: updated week ahead with the rain day; Home card changes to “No watering today: rain is expected to cover it.” (or “Rain helps, but water …”), with Why. Mocked Telegram “Heavy rain expected … Expected rainfall: 22 mm” with the “Why am I seeing this?” button and its explanation. | Thabo | Real app + mocked Telegram | Then the forecast changes: heavy rain is on the way. AgroFlow works it out again. If the rain covers what the crop needs, it says wait. If it only helps, it says water less. Thabo also gets a Telegram alert, with a 'Why' button. |
| 11 · Reports | 3:42.0–3:56.9 (14.9 s) | Real backend-generated report PDF (first page, “Do this next” actions), rendered from the test fixtures; phone Reports screen; admin Reports › Farm reports (Preview · PDF · Excel) and Automatic reports (Daily / Weekly / Monthly, Telegram). | Thabo, Naledi | Real report + real app + real admin | Reports start with what to do next. Thabo gets his as a PDF in the app or on Telegram. Naledi can download PDF or Excel, and schedule automatic reports for each farm. |
| 12 · Naledi's view | 3:56.9–4:14.0 (17.1 s) | Admin Home (Needs attention: new requests, kits offline or faulty, zones missing setup), Farms & zones, Requests, Kits/Alerts; ≥ 3 s per page. | Naledi | Real admin | For Naledi, the dashboard shows what needs attention across every farm: new requests, kits that have gone quiet, and open alerts. Every action is logged, so a small team can look after many farms without losing track. |
| 13 · Testing and validation | 4:14.0–4:28.9 (14.9 s) | Two validation messages (phone number; “Invalid Duration – Enter a duration between 1 and 60 minutes.”), then three counters from today's runs: backend `dotnet test`, admin Playwright, mobile jest (exact numbers from the run logs). | — | Real messages + test logs | We tested as we built. Forms reject bad input, like a wrong phone number or a run over sixty minutes. Today's test runs: [B] backend, [A] admin and [M] mobile tests passed. |
| 14 · Close | 4:28.9–4:40.9 (12.0 s) | “AgroFlow recommends. The farmer decides.” Team 2: Lubaelihle Msuku – Project Manager · Leruo Matlhatsi – Software Developer · Philisile Tyobeka – Business Analyst · Olwethu Nkabinde – Soft-skills Specialist. UCT School of IT Showcase · INF3003W. | — | Brand | AgroFlow recommends. The farmer decides. Built by Team 2: Lubaelihle, Leruo, Philisile and Olwethu. Thank you. |

Every shot is held ≥ 3 s. Corner tags as in v3: “Real AgroFlow app / admin · demo data”, “Mocked Telegram chat · text from AgroFlow's code”,
“Illustration”, “Website demo · visualisation”, “Sped up”.

---

## c) Narration (607 words, plain and friendly)

**0:00.0 — Problem hook** (37 words, 17.1 s)  
On many small farms, watering is guesswork. Too much wastes water and electricity; too little stresses the crop. AgroFlow helps a farmer decide when to irrigate, and how much. Walking every field to check takes time too.

**0:17.1 — Enquiry** (47 words, 21.3 s)  
Meet Thabo, one of our personas: a tomato farmer near Mafikeng, with one field split into two irrigation zones. He finds the AgroFlow website and asks for a call back. If he mistypes his phone number, the form tells him straight away. It takes about a minute.

**0:38.4 — Naledi handles it** (46 words, 20.9 s)  
Naledi, our second persona, is a field officer at the AgroFlow hub. Telegram tells her a new enquiry has arrived. In the Enquiries tab she taps 'I'll handle this', so nobody else calls him too. After the call, she logs how it went: Thabo wants AgroFlow.

**0:59.3 — Onboarding** (43 words, 19.6 s)  
She starts onboarding straight from the enquiry, so his details are already filled in. She adds his farm and both zones, with the crop, soil and size. When she finishes, the enquiry closes as completed, and the activity log records who did it.

**1:18.9 — Login over Telegram** (48 words, 21.8 s)  
To hand over, Naledi shows a QR code. Thabo scans it, opens the AgroFlow bot in Telegram and presses Start. The bot sends his sign-in email, a temporary password and the app link. The first time he signs in, the app asks him to choose his own password.

**1:40.7 — Kit setup** (57 words, 25.6 s)  
Next, the field controller: an ESP32, a Soil Moisture Sensor, a temperature and humidity sensor, and a relay for the pump. Naledi registers the kit and gets a one-time code. On site, the kit opens its own setup Wi-Fi. The installer enters the farm Wi-Fi and the code, and the kit links itself to the right zone.

**2:06.3 — Zone setup in the app** (60 words, 26.9 s)  
In the app, Thabo finishes each zone: crop, planting date, soil and size. For the flow rate, he times how long his tap takes to fill a 500 millilitre bottle. Then he teaches the sensor his soil, with one wet and one dry reading. A checklist shows what is still missing, and the advice gets surer as he goes.

**2:33.2 — Daily use** (57 words, 25.6 s)  
Each morning, Home shows one action per zone. Today, zone one needs watering, with the minutes and litres worked out. It says how sure it is, and 'Why am I seeing this?' shows the reasons: the weather, the crop's stage and the water left in the soil. The week ahead shows what each day means for watering.

**2:58.8 — Execution** (51 words, 23.1 s)  
AgroFlow recommends; Thabo decides. He starts a run from the app. The command reaches the kit over MQTT, the relay switches the pump on, and the kit reports the run back. For safety, no single run lasts longer than five minutes. Here, our website demo shows the watering, as a visualisation.

**3:21.9 — Weather change** (44 words, 20.1 s)  
Then the forecast changes: heavy rain is on the way. AgroFlow works it out again. If the rain covers what the crop needs, it says wait. If it only helps, it says water less. Thabo also gets a Telegram alert, with a 'Why' button.

**3:42.0 — Reports** (32 words, 14.9 s)  
Reports start with what to do next. Thabo gets his as a PDF in the app or on Telegram. Naledi can download PDF or Excel, and schedule automatic reports for each farm.

**3:56.9 — Naledi's view** (37 words, 17.1 s)  
For Naledi, the dashboard shows what needs attention across every farm: new requests, kits that have gone quiet, and open alerts. Every action is logged, so a small team can look after many farms without losing track.

**4:14.0 — Testing and validation** (32 words, 14.9 s)  
We tested as we built. Forms reject bad input, like a wrong phone number or a run over sixty minutes. Today's test runs: [B] backend, [A] admin and [M] mobile tests passed.

**4:28.9 — Close** (16 words, 12.0 s)  
AgroFlow recommends. The farmer decides. Built by Team 2: Lubaelihle, Leruo, Philisile and Olwethu. Thank you.

`[B]`, `[A]`, `[M]` are filled with the real pass counts from today's runs (backend `dotnet test`, admin Playwright, mobile jest).
Names are said without surnames in the voice-over; full names and roles are on screen.

---

## d) Narration audio

- **How v3 was made:** `showcase/make-voiceover.py` → `npx hyperframes tts` → **Kokoro** (open-weight TTS, `kokoro-onnx`
  running locally), voice `am_michael`, then ffmpeg trims long pauses and normalises to −16 LUFS. No paid service, no account,
  no cloud API; the model (`kokoro-v1.0.onnx`) and voices are already cached in this container (`~/.cache/hyperframes/tts`).
- **Can I redo it here?** **Yes.** v4 gets its own `showcase/v4/assets/vo/` and `vo-lines.json`, made with the same script
  (copied to `showcase/v4/make-voiceover.py`). Speed set so speech lands at ≈ 140 wpm (about 1.0×, versus 1.2× in v3).
- It is a **synthetic voice**. If you want your own voices instead, record `narration` above (one file per scene, same
  names) and I'll swap them in; nothing else changes.
- One narrator for the whole video; I could use a second Kokoro voice for Naledi's scenes if you prefer.

---

## How Phase 2 will work (for your OK)

1. **Captures** (`showcase/v4/capture/`, with README): Playwright against the unmodified admin site (Vite) and the
   farmer app (Expo web, 390×844 @2×), backend calls answered by v4 demo fixtures (extending `capture/v3`), as in v3.
   The website's 3D controller and Experience AgroFlow are recorded from the same running site.
2. **Engine-true numbers:** a small throwaway .NET console (outside the repo) that calls `AgroFlow.Domain`'s real
   `Fao56Engine` / `TodayRules` / `Explanations` with Thabo's inputs, so every amount and “Why” sentence on screen is
   what the real engine says (v3 had to hand-copy templates).
3. **Report sample:** regenerate with the backend's own report tests (`AGROFLOW_WRITE_SAMPLES=1`) into a scratch folder,
   with Thabo's demo names if the fixtures allow; otherwise use the existing `docs/sample-reports/` and check them for private data.
4. **Telegram:** no screenshot of the real bot is available here, so chats are **mocked** and labelled, with the exact text
   from the code. Passwords, codes and links are blurred or replaced with obvious fakes (e.g. `DEMO-0000`).
5. **Tests:** run `dotnet test` (backend), `npx playwright test` (admin) and `npx jest` (mobile) today; counts go into scene 13
   and the logs into `showcase/v4/capture/test-runs/`.
6. Render 1080p with the existing HyperFrames pipeline (`showcase/v4/index.html`, own `package.json` script). Then the
   Phase 3 frame-by-frame QA, `.srt`, and the report.

## Decisions I need from you

1. Spelling of names: **Msuku / Matlhatsi** (deck) or Masuku / Mathlatsi (M1 Table 14)?
2. Length: the plan runs **~4:41**; OK, or trim to 4:30 (I'd shorten scenes 5 and 7)?
3. One narrator voice (`am_michael`), or a second voice for Naledi's scenes?
4. OK to show the Experience AgroFlow field visual even though that demo's own example field (“North Field”) differs from
   Thabo's — cropped to the field and tagged “Website demo · visualisation”?

---

## Phase 2 outcome (supersedes the narration draft above)

- Final narration, speaker split, timecodes and word counts: `VOICEOVER_SCRIPT.md` (606 words, about 140 wpm, 4:43).
  It was trimmed from the draft to stay near 4:41; the story and the 14 scenes are unchanged.
- Thabo's zones are 20 m² at 15 L/min (500 mL bottle in 2 s), so the bottle step is realistic; every advice
  sentence is re-computed by AgroFlow's engine (`capture/engine/`).
- Captures and their sources: `capture/README.md`. Build: `plan-timing.py` → `build-scenes.py` → `build-index.py`
  → render → `finish.sh`. Team voices: `VOICEOVER_README.md` and `mux-voiceover.ps1`.
