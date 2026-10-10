# AgroFlow Showcase Intro: Slide Source Audit

Deck: `AgroFlow_Showcase_Intro_2026.pptx` · Audit date: 6 October 2026
Repository state: branch `dev` at `bb1c0a1` ("merge: final finish before the presentation")

> Some sources cited below were removed from `dev` on 10 Oct 2026: the `showcase/` video files, `docs/reports/` and `docs/ORIENTATION.md`. They are kept in the tag `archive/pre-tidy-2026-10-10` (the video work also on `feature/showcase-v4`).

## Sources examined

| ID | Source | Notes |
|---|---|---|
| M1 | `Milestone-1_Team-2.docx` | Team roles (Table 14), As-Is activity, early package diagram |
| M2 | `Milestone2_URS_Team2.docx` (submitted 14 Aug 2026) | Project definition, To-Be activity diagrams, use cases, class, sequence and state diagrams |
| M3 | `Milestone_3__Team_2.docx` (dated 28 Sep 2026 on its cover) | Latest milestone: business case, technology platform, network/deployment diagram, expanded class diagram, persona, wireframes |
| REPO | AgroFlow repository, `dev` @ `bb1c0a1` | Code, migrations, firmware, `docs/*.md` reports (latest: `docs/reports/final-finish-report.md`, `docs/presentation/presentation-runbook.md`, `docs/releases/release-notes-v2.md`) |
| RUN | Apps run locally on 6 Oct 2026 | See "What was run" below |
| SHOWCASE | `showcase/` and `showcase/walkthrough-video/` on `dev` (pushed 6 Oct 2026 while this deck was being built) | The team's system-demo video: narration, system audit and captured screens. Used for slide 10. |
| OLD DECK | Original AgroFlow presentation | **Not supplied.** It could not be audited, and none of its images could be reused. |

Priority applied: M3 → REPO → M2/M1. Where M3 and the code disagree, the deck follows the **code**, because the code is what will be demonstrated. Each disagreement is listed under "Contradictions".

---

## What was run, and what failed

| Component | Command | Result |
|---|---|---|
| Admin console | `cd apps/web/admin && npm ci && VITE_SUPABASE_URL=… VITE_AGROFLOW_API_BASE=… npx vite --port 5173` | **Ran.** The real Vite build served the landing page, sign-in and every page. |
| Farmer app | `cd apps/mobile && npm ci && EXPO_PUBLIC_*=… npx expo start --web --port 8098` | **Ran** on Expo web; all screens rendered. Env values are the public ones already in `apps/mobile/eas.json`. No `.env` file was created or read. |
| Live backend / database | `curl https://agroflow-production-998d.up.railway.app/`, `curl https://zcoalyxzvemiumnipufz.supabase.co/auth/v1/health`, `curl https://api.open-meteo.com/…` | **Failed:** `CONNECT tunnel failed, response 403`. This environment's network policy blocks these hosts, so no live data, sign-in, weather or map tiles could be reached. |
| AgroFlow.Api locally | — | **Not attempted.** The .NET SDK is not installed here, the API refuses to start without secrets (connection string, ApiKey, MQTT password), and the database is unreachable anyway. |
| Domain tests | — | **Not run** (no .NET SDK). `docs/reports/final-finish-report.md` reports "650 passed". That figure **could not be confirmed here**, so it is not on any slide. |
| ESP32 firmware | — | No hardware in this environment. Firmware was read, not run. |

**How the signed-in screens were captured.** Playwright intercepted the blocked network calls and returned a small local fixture. The fixture contains only the farm and zone **configuration** documented in `docs/ops/demo-account.md`: farmer "Sponsor Demo", "AgroFlow Demo Farm", Mafikeng, one zone "Tub 1", tomato, loam. **No sensor readings, irrigation events, weather values or alerts were invented.** That is why the screens show "No reading", "Weather unavailable" and "Map unavailable"; the last two are caused by this sandbox, not by the product. The UI itself (layout, wording, validation, wizard) is the real current code. **Recommendation:** re-capture slides 1, 4, 8 and 10 from the live system on a phone with a kit reporting, using the same file names in `presentation-assets/ui/`.

---

## Slide-by-slide audit

### Slide 1: AgroFlow (title)
| Content / visual | Type | Source | Path / section | Current or historical | Notes |
|---|---|---|---|---|---|
| AgroFlow logo | Brand asset | REPO | `showcase/assets/brand/agroflow-icon.png` | Current | Same artwork as the app icon (`apps/mobile/assets/images/icon.png`) |
| Title, subtitle, course, team, year | Text | User brief; M2/M3 covers | — | Current | |
| Sponsor line "Mafikeng Cisco Edge Centre (MDiHub)" | Text | M2 cover, M3 §1.1 | — | Current | |
| Two phone screens (zone irrigation control, reports) | Real app screenshot | RUN | `apps/mobile/src/app/zone/[id].tsx`, `src/app/reports.tsx` | Current UI, fixture config | `ui/mobile-zone-manual-run.png`, `ui/mobile-reports.png` |
| Colours | Brand tokens | REPO | `apps/web/admin/src/styles` (`--brand #168f99`, `--accent #42c3c7`, `#184d35`), `apps/mobile/src/constants/colors.ts` | Current | |

### Slide 2: Meet Team 2
| Content | Type | Source | Path / section | Current or historical | Notes |
|---|---|---|---|---|---|
| Names | Text | REPO landing page (`apps/web/admin/src/pages/welcome.ts`, "Who made this"); M1 cover | — | Current | **Spelling conflict:** M1 Table 14 writes "Masuku" and "Mathlatsi"; the repo and the M1/M2 covers write "Msuku" and "Matlhatsi". The deck uses Msuku / Matlhatsi. **Each person should confirm their own spelling.** |
| Roles | Text | M1 §11.3 and Table 14 "Summary of roles and contributions" | — | Historical (M1) | No later milestone changes the roles. |
| Sponsor, tutor, mentor | Text | M2 cover table | — | Current | |
| Photo circles | **Editable placeholder** | — | — | — | **No team photos were supplied**, and the original deck was not provided. Replace before presenting. |

### Slide 3: The irrigation challenge
| Content | Type | Source | Path / section | Notes |
|---|---|---|---|---|
| Central sentence | Paraphrase | M3 §1.1 Business Case Summary | "farmers having to physically inspect the moisture of soil… lack of real-time, data-driven decision-making" | |
| Manual checks, fixed timers, over/under-irrigation, labour, limited visibility | Text | M3 §1.1 | "Basic timers… irrigating at fixed intervals… over-irrigation… under-irrigation… high labour costs, limited visibility of water usage" | |
| Weak signal, load-shedding | Text | M3 §2 intro (R10 connectivity, R14 load shedding); M2 Terms of Reference ("unreliable connectivity") | | |
| Persona Sipho Dlamini and quote | Text | M3 §6.1, Figure 7.1 | Goal: "Ability to check soil conditions without having to walk to every zone" | The quote is shortened. The persona photo is **not used** because it is a watermarked iStock image. |
| **Omitted** | — | — | — | No yield or water-saving percentages. None were measured. |

### Slide 4: From field conditions to informed irrigation
| Content | Type | Source | Path | Notes |
|---|---|---|---|---|
| ESP32 kit per zone; reading every 30 s; relay switches pump | Text | REPO | `hardware/esp32/AgroFlowIrrigationNode/AgroFlowIrrigationNode.ino` (line 98 `SENSOR_REPORT_INTERVAL_MS = 30000`; lines 85–87 pins; `relayWrite`) | |
| Stores readings, checks each zone | Text | REPO | `backend/AgroFlow.Api/Services/SensorReadingProcessor.cs` | |
| FAO-56 advice from crop stage + forecast | Text | REPO | `backend/AgroFlow.Domain/Agronomy/IrrigationAdvisor.cs`, `SoilWaterBalance.cs`, `GrowthStageCalculator.cs`; `docs/fao56-engine-report.md` | |
| Telegram alerts | Text | REPO | `backend/AgroFlow.Api/Services/Notifications/TelegramNotificationService.cs` | |
| Automatic / scheduled / manual | Text | REPO | `backend/AgroFlow.Domain/IrrigationMode.cs`; zone screen | |
| "Rule-based and sourced, not a black box" | Text | REPO | `IrrigationAdvisor.cs` header: "This is NOT a language model… every number in the output traces to a sensor reading, a weather row, or a cited FAO-56 value" | Corrects any "AI" reading of the `ai_recommendation` table name. |
| Phone: Irrigation tab | Real app screenshot | RUN | `apps/mobile/src/app/(tabs)/irrigation.tsx` | `ui/mobile-irrigation.png` |

### Slide 5: How AgroFlow works (architecture)
| Content | Type | Source | Path | Notes |
|---|---|---|---|---|
| Whole diagram | **Redrawn, editable native shapes** | REPO, cross-checked with M3 §2.6 | `README.md` Architecture; files below | Exported as `diagrams/architecture-current-slide5.png` |
| Soil probe, DHT11, ESP32 v1.4.0, relay, pump | Shapes | REPO | firmware header (`v1.4.0`), pins 32/25/27 | Probe is a resistive YL-69 (firmware line 85). M3 says "capacitive". |
| Wi-Fi → HiveMQ Cloud MQTT over TLS | Shapes | REPO | firmware `MQTT_PORT = 8883`, `WiFiClientSecure`; `hardware/shared/MQTT_TOPICS.md` | |
| HTTPS: enrol, log events, confirm commands | Shapes | REPO | firmware calls `/api/devices/claim`, `/api/irrigation-events`, `/api/devices/commands/{id}/executed` | |
| AgroFlow.Api: ASP.NET Core .NET 8, Docker on Railway | Shapes | REPO, M3 §2.1.4/§2.2.2 | `backend/AgroFlow.Api/AgroFlow.Api.csproj`, `Dockerfile`, `docs/ORIENTATION.md` (Railway URL) | |
| Five API responsibilities | Shapes | REPO | `SensorReadingProcessor.cs`, `Zone.cs`, `Fao56EngineService.cs`, `Mqtt/IrrigationCommandNotifyService.cs`, `Notifications/` | |
| Open-Meteo, Telegram Bot API | Shapes | REPO | `Services/WeatherCollectionService.cs`, `WeatherBackfillService.cs`; `docs/fao56-engine-report.md` "The weather provider is Open-Meteo, not OpenWeatherMap" | |
| Supabase: PostgreSQL, Auth, RLS | Shape | REPO | `supabase/migrations/0011_row_level_security.sql`; README "The split that matters" | |
| Apps read Supabase directly and call the API | Arrows | REPO, RUN | Observed requests: `/rest/v1/profile`, `/rest/v1/ai_recommendation` plus `/api/farmer/dashboard` | |
| Command path band | Text | REPO | `FarmerEndpoints.CreateManualCommandAsync` → `irrigation_commands` insert → `pg_notify` trigger (0009) → `IrrigationCommandNotifyService` → MQTT → `handleMqttCommand` → `startPumpCycle` → `logIrrigationEvent` | |
| **Not shown** | — | — | — | GitHub Pages hosting of the admin console (M3 §2.1.4). The workflow file sits at `docs/ops/pages-workflow.yml` and is not active in `.github/workflows`, so the live hosting could not be confirmed. The slide says "web". |

### Slide 6: From monitoring to irrigation (To-Be process)
| Content | Type | Source | Path | Notes |
|---|---|---|---|---|
| Three-lane process diagram | **Redrawn, simplified, editable** | M2 §3 "To-Be Activity Diagram – Farmer" (`diagrams/historical-M2-to-be-activity-farmer.png`), updated against REPO | `SensorReadingProcessor.cs` lines 93–137; `FarmerEndpoints.cs` `CreateManualCommandAsync`; firmware `handleMqttCommand`, `checkSafetyCap` | Exported as `diagrams/to-be-process-current-slide6.png` |
| Why it was redrawn | — | — | — | The M2 diagram has the farmer start every cycle and the system "check hardware" first. The built system adds automatic-mode decisions from thresholds, FAO-56 advice, and duration-limited manual runs. Its "irrigate until conditions met" loop is replaced by duration, stop command or safety cap. The M2 diagram is kept in the assets folder as **historical**. |
| "Safety cap" | Text | REPO | firmware line 105 `SAFETY_MAX_RUN_MS = 5 min` | |

### Slide 7: Designed as a connected system
| Content | Type | Source | Path | Notes |
|---|---|---|---|---|
| Domain model | **Simplified class diagram, editable** | REPO, cross-checked with M3 §3 Figure 4.1 | `backend/AgroFlow.Domain/User.cs` (abstract), `FarmUser.cs`, `Admin.cs` (`: User`), `Farm.cs` (`Collection<Zone>`), `Zone.cs`, `Hardware.cs`, `ESP32.cs`/`Sensor.cs`/`Pump.cs` (`: Hardware`), `IrrigationLog.cs`, `Alert.cs`, `AIRecommendation.cs`, `Weather.cs`; FKs in `supabase/migrations` (`farm.owner_id`, `zone.farm_id`, `hardware.zone_id`, `alert.zone_id`, `weather.farm_id`) | Exported as `diagrams/domain-model-current-slide7.png` |
| "Advice" box | Label | REPO | class `AIRecommendation`, written by `Fao56EngineXDB.cs` | Labelled "Advice" so it is not read as AI. The slide footnote explains. |
| Code crop: `Zone.cs` lines 142–153 and 165–176 | **Real code screenshot** | REPO | `backend/AgroFlow.Domain/Zone.cs` | `code/zone-cs-irrigation-decision.png`. Rendered with Pygments from the file. Line numbers are real, "⋮" marks skipped lines, indentation reduced by 8 spaces, nothing else changed. No secrets. |
| **Omitted for readability** | — | — | — | `Maintenance` (→ Hardware) and `Report` exist in the code but are not drawn. |

### Slide 8: From design to implementation
| Tile | Type | Source | Path | Notes |
|---|---|---|---|---|
| Mobile: zone control and reports | Real app screenshots | RUN | `apps/mobile/src/app/zone/[id].tsx`, `src/app/reports.tsx` | Fixture config only (see above) |
| Admin: Home | Real app screenshot | RUN | `apps/web/admin/src/pages/dashboard.ts` | Shows 0 counts and "health check could not be reached" because of the blocked network. **Re-capture from the live console.** |
| Hardware photo | **Editable placeholder** | — | — | **No hardware photo exists** in M1–M3 (all 40 images checked) or the repo. See `presentation-assets/hardware/README.md`. |
| ESP32 firmware crop, lines 492–509 | **Real code screenshot** | REPO | `hardware/esp32/AgroFlowIrrigationNode/AgroFlowIrrigationNode.ino` | `code/esp32-handle-mqtt-command.png`. Lines 494 (parse-error log) and 499 (blank) are skipped and marked "⋮". The file's hard-coded HiveMQ hostname (line 66) is **not** in the crop. No secrets. |

### Slide 9: What AgroFlow delivers
| Item | Source |
|---|---|
| Kit: probe, DHT11, relay, pump | M3 §2.1.2; firmware |
| One-time enrolment code + Wi-Fi setup | firmware v1.2.0 header; `DeviceEnrollmentEndpoints.cs` |
| Offline fallback watering | firmware `runOfflineFallback`, `OFFLINE_FALLBACK_AFTER_MS` |
| 5-minute safety cap | firmware line 105 |
| MQTT over TLS via HiveMQ | firmware; `MqttConnectionService.cs` |
| Auto-irrigation from thresholds | `SensorReadingProcessor.cs`, `Zone.cs` |
| FAO-56 + Open-Meteo | `Agronomy/`, `WeatherCollectionService.cs` |
| Telegram alerts | `Services/Notifications/` |
| Live readings and health; three modes; manual start/stop | mobile `zone/[id].tsx`, `irrigation.tsx`; `FarmerEndpoints.cs` |
| Water-usage reports (PDF) | `Reports/DesignedWaterUsagePdf.cs`; `docs/releases/release-notes-v2.md` |
| Farm and kit wizards; kit online/offline; alerts and requests; Excel/PDF/CSV exports | admin `app/interactions.ts`; `DeviceStatusMonitorService.cs`; commit `2ff6594` ("exports people can actually open") |
| **Not yet** list | `docs/reports/final-finish-report.md` "Still not done" items 1–4; `docs/releases/release-notes-v2.md` "What is not connected yet"; ESP-NOW and Realtime: see Contradictions |

The admin audit log ("Activity") is built (commit `47cf5b0`), but the final report says it depends on migration 0038 being applied and on Railway deploying `dev`. For that reason it is **not** listed as delivered on this slide; it appears only as a demo step on slide 10.

### Slide 10: The journey we will demonstrate
| Content | Type | Source | Notes |
|---|---|---|---|
| Seven steps (farmer opens app → Zone 2 critical → advice → manual run → command to kit → run recorded → admin follows up) | Text | `showcase/narration.md` and `showcase/storyboard.md` (the team's system-demo video, added to `dev` on 6 Oct 2026) | Matches the demo that follows the introduction. The admin-led `docs/presentation/presentation-runbook.md` is an older live-demo plan. **If you present the runbook demo live instead, change this slide.** |
| Validation: 90 min → "Enter a duration between 1 and 60 minutes." → 5 min | Text | `apps/mobile/src/app/zone/[id].tsx` `handleStartManualRun`; demo narration 2:14 | The message is quoted exactly from the code. Five minutes fits the firmware's 5-minute cap. |
| Three phone screens + admin Kits | **Real app screenshots with illustrative demo data** | `showcase/assets/screens/m-zone2.png`, `m-zone2-sent.png`, `m-history.png`, `a-kits.png` → copied to `ui/demo-*.png` | Captured by the team's showcase work from the unmodified apps, answering with labelled demo data (`showcase/capture/demo-data.mjs`, every farm marked "(demo)"). `showcase/system-audit.md` records that the team approved this approach. **The slide says so on screen:** "real app, illustrative demo data". The values shown (e.g. 19% moisture) are **not** measurements. |
| "Now, let's see AgroFlow in action." | Text | Brief | |

---

## Contradictions found (milestones vs final code)

| # | Milestone says | Code says | Used in deck |
|---|---|---|---|
| 1 | M3 §2.1.2 and network diagram: Zone 2 board sends readings to a Zone 1 **gateway over ESP-NOW** | No ESP-NOW anywhere in the firmware. Every board connects directly over Wi-Fi to HiveMQ (`WiFiManager`, `PubSubClient`). | Code. Listed as "not built" on slide 9. |
| 2 | M3 §2.6: weather from **OpenWeatherMap** | **Open-Meteo** (forecast + ERA5 archive), keyless (`WeatherCollectionService.cs`, `docs/fao56-engine-report.md`) | Code |
| 3 | M3 §2.6: "Supabase **Realtime** then pushes the new reading to any open app" | No `.channel(` or `postgres_changes` subscription in `apps/mobile/src` or `apps/web/admin/src` | Code. Listed as "not built". |
| 4 | M3 diagram: soil sensor "capacitive" | Firmware: "resistive YL-69 probe" (line 85) | Diagram just says "Soil probe" |
| 5 | M3 DCD: `Admin` extends `FarmUser`; classes `RelaySwitch`, `WeatherService`, `DashboardService`, `NotificationService` | `Admin : User`; no such domain classes (the work is done by API services) | Code |
| 6 | M2 Terms of Reference: "12V water pump" | M3 and firmware: 3–5 V DC pump on AAA batteries switched by relay | M3 / code (the slide says "pump") |
| 7 | M2 To-Be: the farmer initiates every cycle; system irrigates "until conditions met" | Automatic mode starts and stops on thresholds; manual runs are duration-limited; firmware caps runs at 5 min | Redrawn diagram (slide 6) |
| 8 | **App vs firmware:** the app accepts manual runs of **1–60 min** (`zone/[id].tsx` line 619); the API accepts up to **3600 s** (`FarmerEndpoints.cs`) | Firmware stops **every** run after **5 min** (`SAFETY_MAX_RUN_MS`) | Not stated as a contradiction on a slide. The demo uses 5 min, which is safe. **A live run longer than 5 minutes will stop early.** |
| 9 | `README.md` "What each app can do today" says manual history is local-only (no insert policy) | `FarmerEndpoints.CreateManualCommandAsync` now inserts `irrigation_commands` through the API | Code. The README section is out of date. |
| 10 | Spelling of names: M1 Table 14 "Masuku", "Mathlatsi" | Repo and covers: "Msuku", "Matlhatsi" | Repo spelling. **Confirm.** |
| 11 | M2 project definition sponsor "Mafikeng Digital Innovation Hub"; M3 "Mafikeng Cisco Edge Centre" | Both appear on the M2 cover (MDiHub logo + Cisco Edge Centre) | "Mafikeng Cisco Edge Centre (MDiHub)" |

## Outdated claims checked

The original deck was not supplied, so its exact wording could not be checked. Each claim listed in the brief was checked against the code instead:

| Claim | Verdict |
|---|---|
| "Automatically controls irrigation valves" | **Reword.** There are no valves. A relay switches a pump, automatically only for zones in automatic mode. |
| "Water flow sensor" | **Remove.** None exists (M2 To-Be assumptions: "There is no reservoir-level sensor or flow meter"). Litres are *estimated* from runtime × configured flow rate. |
| "Reservoir level sensor" | **Remove.** None exists. |
| "Python backend" | **Remove.** The backend is C# / ASP.NET Core .NET 8. No Python in the repo. |
| "Node.js IoT processing" | **Remove.** IoT ingestion is in the .NET API (`MqttConnectionService.cs`). |
| "React Native / Flutter" | **Partly true.** React Native via Expo. No Flutter. |
| "React / Next.js" | **Remove.** The admin console is vanilla TypeScript + Vite (`apps/web/admin/package.json`: "no framework"). |
| "Docker" | **True** for the API only (`Dockerfile`, Railway). |
| "Mock/simulated data" | **Remove.** Apps query real data. The screenshots in this deck use a local fixture **only because the network was blocked here** (see above). |
| "Reduce water consumption by at least 30%" | **Remove.** No measurement supports any percentage. M2 lists water reduction only as an objective. |
| "AI recommendations" | **Reword.** The advice is a deterministic FAO-56 rule engine. The `ai_recommendation` table name is historical. |

## Could not verify

- Whether Railway currently runs the `dev` branch. The final report says the deployed branch is not recorded in the repo.
- Whether migrations 0034–0038 are applied to the live database.
- The "650 tests pass" figure (no .NET SDK here).
- Whether the admin console is actually hosted on GitHub Pages.
- Any live data, kit status or Telegram behaviour (network blocked).
- Team photos and hardware photos (none supplied).
- How the original deck looked or what it claimed (not supplied).
