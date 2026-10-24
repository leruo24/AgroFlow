# Code evaluation walkthrough (INF3003W Code Evaluation, /50)

Team 2: Leruo Matlhatsi, Lubaelihle Msuku (Luba), Olwethu Nkabinde, Philisile Tyobeka (Phili).

The walkthrough follows the package diagram (`docs/diagrams/package-diagram-v2.drawio`, mapped to folders in `docs/architecture.md`): Presentation → Logic → Data → Hardware. Each step names the mark-sheet criterion it serves:

- **D**: Design and functionality of code
- **OO**: OO features
- **C**: Complexity and maintainability
- **W**: Web, mobile and other components
- **E**: Functionality and extras

Paths are from the repository root, and line numbers are from branch `merge/oct24-structure`. Open each file in the editor at the line given. Log in to the demo accounts before the session; no password is written in this document.

## Before you start (1 minute, Leruo)

Leruo: "AgroFlow has four parts. There's a staff console and a farmer app, both talking to one .NET API, plus a Supabase Postgres database and an ESP32 kit in the field. The backend folders now follow our package diagram, and `docs/architecture.md` maps each package to its folder. We'll go layer by layer and show the test that proves each point."

---

## 1. Presentation layer

### 1.1 Staff console: routing and the enquiry-to-kit flow (D, W) — Luba
- **Open:** `apps/web/admin/src/app/router.ts:28`, then `apps/web/admin/src/app/interactions.ts:1288` (the "register-hardware" wizard).
- **Say:** "The staff console is TypeScript with Vite and no framework. Every screen is a route here, and the hash-based router lets staff refresh or share any page. The kit wizard walks through Farmer → Farm → Zone → Kit → Review, then shows the kit setup card and fills it in by itself once the kit connects."
- **Proof:** `apps/web/admin/tests/kit-setup.spec.ts` (wizard, card, label) and `apps/web/admin/tests/staff-nav.spec.ts`.

### 1.2 Staff console: server-side role check (D, OO) — Luba
- **Open:** `backend/AgroFlow.Api/Auth/AdminOnlyFilter.cs:8`.
- **Say:** "Staff routes are protected on the server, not just hidden in the page. This endpoint filter checks the caller's role from the database before any staff route runs. A farmer token gets 403 even if they find the URL."
- **Proof:** `backend/AgroFlow.Domain.Tests/StaffOnlyAndUnlinkTests.cs`, `SecurityTests.cs`.

### 1.3 Public enquiry form: validation without data annotations (D) — Luba
- **Open:** `backend/AgroFlow.Api/Endpoints/EnquiryEndpoints.cs:20`, then `backend/AgroFlow.Domain/EnquiryRules.cs:30` and `backend/AgroFlow.Domain/PhoneRules.cs:9`.
- **Say:** "We use minimal APIs with request records, so validation is explicit code rather than data annotations. The rules live in one domain class, which the endpoint calls and the tests exercise directly. For example, an all-zero phone number is refused, and every refusal says which field to fix."
- **Proof:** `backend/AgroFlow.Domain.Tests/EnquiryTests.cs`; `apps/web/admin/tests/enquiry-form.spec.ts`.

### 1.4 Farmer app: tabs and the Kit tab (W, E) — Phili
- **Open:** `apps/mobile/src/app/(tabs)/_layout.tsx:88`, then `apps/mobile/src/app/(tabs)/kit.tsx:33`.
- **Say:** "The farmer app is React Native with Expo Router. One codebase builds the Android app and the farmer web app. The bar is Home, Irrigation, Kit, Alerts and More. The Kit tab shows only what the kit really reports: connection, Wi-Fi signal, soil sensor and pump confirmation. It never shows battery or water flow, because the kit can't measure them."
- **Proof:** `apps/mobile/src/components/__tests__/kitTab.test.tsx`, `moreTab.test.tsx`.

### 1.5 Farmer app: honest Home summary (D) — Phili
- **Open:** `apps/mobile/src/lib/farmState.ts:21`.
- **Say:** "Drip and the Home summary follow a fixed priority: fault, then no kit, no readings, stale, low confidence, normal. 'All your zones look good' appears only when the readings are fresh and nothing is wrong. If data fails to load, it says so instead of guessing."
- **Proof:** `apps/mobile/src/components/__tests__/retestLogic.test.tsx`.

### 1.6 Languages, dark mode, accessibility (E) — Phili
- **Open:** `apps/mobile/src/i18n/index.ts:45`, `apps/mobile/src/app/(tabs)/settings.tsx:233` (language and appearance), then `apps/mobile/src/components/WebRadioSemantics.tsx:6`.
- **Say:** "Every screen string comes from one catalogue in English, Afrikaans and Setswana, and a test fails the build if English is hard-coded. Farmers choose light, dark or system appearance in Settings. On the web, choices are real radio groups that work with arrow keys and screen readers."
- **Proof:** `apps/mobile/src/lib/__tests__/hardcodedEnglish.test.ts`; `apps/web/admin/tests/web-polish-oct23.spec.ts` (axe scan, both themes); `apps/web/admin/tests/keyboard.spec.ts`.

---

## 2. Logic layer

### 2.1 Classes, inheritance and polymorphism (OO) — Leruo
- **Open:** `backend/AgroFlow.Domain/User.cs:8` (abstract `User`, virtual `GetDashboardRoute` at line 56), `backend/AgroFlow.Domain/Admin.cs:19` and `backend/AgroFlow.Domain/FarmUser.cs:17` (overrides).
- **Say:** "`User` is abstract, because a person is always an Admin or a FarmUser. Each subclass overrides `GetDashboardRoute`, so the same call sends each person to the right place. That's polymorphism through a virtual method."
- **Proof:** `backend/AgroFlow.Domain.Tests/DomainModelTests.cs` (`Each_kind_of_user_goes_to_its_own_dashboard_through_the_same_call`).

### 2.2 Hardware hierarchy and composition (OO) — Leruo
- **Open:** `backend/AgroFlow.Domain/SensorMonitoring/Hardware.cs:72` (virtual `ReadValue`, `IsWorking`), `Sensor.cs:54`, `ESP32.cs:36` and `backend/AgroFlow.Domain/IrrigationControl/Pump.cs:36` (overrides), then `backend/AgroFlow.Domain/Farm.cs:12` (`Collection<Zone>`).
- **Say:** "Sensor, ESP32 and Pump all inherit from Hardware, and each reads its value differently. A pump also counts as working while it's running, not just when online. A Farm is composed of Zones, which is the same 'farm has zones' relationship as the database."
- **Proof:** `backend/AgroFlow.Domain.Tests/DomainModelTests.cs` (hardware values, `IsWorking`, a farm composed of zones).

### 2.3 Sensor monitoring: MQTT in, readings stored (D, W) — Olwethu
- **Open:** `backend/AgroFlow.Api/SensorMonitoring/MqttConnectionService.cs:34`, then `backend/AgroFlow.Api/SensorMonitoring/SensorReadingProcessor.cs:19`.
- **Say:** "The API is a background service subscribed to the HiveMQ broker. Each kit message is checked, matched to its zone and stored. A reading the kit buffered while offline keeps its real time, and is stored once even if the kit sends it twice."
- **Proof:** `backend/AgroFlow.Domain.Tests/LateReadingTests.cs`; `node hardware/sim/run-e2e.mjs` (end-to-end, 43 checks).

### 2.4 Kit health from real data (D) — Olwethu
- **Open:** `backend/AgroFlow.Domain/SensorMonitoring/KitHealth.cs:50`.
- **Say:** "This one pure function turns the kit's facts into the Kit tab's checklist and its overall state. It has no database code, so it's easy to unit-test. The firmware 'update available' line appears only for a real published https download."
- **Proof:** `backend/AgroFlow.Domain.Tests/KitHealthTests.cs`, `KitDbTests.cs`.

### 2.5 Irrigation control: commands and run limits (D, C) — Leruo
- **Open:** `backend/AgroFlow.Domain/IrrigationControl/IrrigationRunRules.cs:12`, then `backend/AgroFlow.Domain/IrrigationControl/CommandState.cs:9`.
- **Say:** "Every run is capped at the zone's maximum, on the server and again on the kit. A command moves from sent to started to finished only when the kit confirms it. The app says 'Waiting for kit' until then, and never claims water flowed."
- **Proof:** `backend/AgroFlow.Domain.Tests/IrrigationRunTests.cs`, `CommandStateTests.cs`, `CommandReplayPolicyTests.cs`.

### 2.6 FAO-56 recommendations: our own ET₀ (W, D) — Leruo
- **Open:** `backend/AgroFlow.Domain/IrrigationControl/Agronomy/Fao56Engine.cs:259`, `PenmanMonteithEto.cs:181`, `SoilWaterBalance.cs:12`.
- **Say:** "Advice comes from the FAO-56 method. We calculate reference evapotranspiration ourselves with Penman–Monteith, from Open-Meteo's temperature, humidity and wind, and keep a daily soil-water balance per zone. We don't use machine learning or AI: every recommendation follows written rules, and the 'Why am I seeing this?' sheet shows those rules."
- **Proof:** `backend/AgroFlow.Domain.Tests/ReferenceEvapotranspirationTests.cs`, `Fao56EngineVerificationTests.cs`, `RuleBookTests.cs`; the rule book is generated from the code (`docs/engine/rule-book.md`, checked by `RuleBookDocument.cs`).

### 2.7 Confidence and drought (D) — Olwethu
- **Open:** `backend/AgroFlow.Domain/IrrigationControl/Agronomy/RuleBook/ConfidenceRules.cs:150`, then `backend/AgroFlow.Domain/IrrigationControl/Agronomy/DroughtManager.cs:41`.
- **Say:** "Each piece of advice comes with High, Medium or Low confidence and the one thing that would improve it. Drought mode is worked out from the farm's own tank, soil and forecast, and it says plainly that it isn't an official declaration. The reason has a code, so the app can show it in the farmer's language."
- **Proof:** `backend/AgroFlow.Domain.Tests/RetestLogicTests.cs`, `DroughtCommunityRulesTests.cs`.

### 2.8 Notifications: an interface with two implementations (OO, E) — Phili
- **Open:** `backend/AgroFlow.Api/Notifications/INotificationService.cs:18`, `TelegramNotificationService.cs:13`, and `NullNotificationService` in `INotificationService.cs:178`.
- **Say:** "Endpoints depend on the `INotificationService` interface, not on Telegram. In production it's the Telegram service, and in tests it's a null or recording version, so the logic can be tested without sending messages. Only farmers who linked Telegram and opted in get messages, in their own language."
- **Proof:** `backend/AgroFlow.Domain.Tests/StaffTelegramTests.cs`, `KitDbTests.cs` (one message per kit claim, opted-in farmers only).

### 2.9 Community reports (E) — Phili
- **Open:** `backend/AgroFlow.Api/Notifications/CommunityService.cs:52`.
- **Say:** "Farmers can report pests, fire or water problems, and nearby farms are told by distance only, never who reported. Staff can hide a report with a reason. Reports expire on their own."
- **Proof:** `backend/AgroFlow.Domain.Tests/DroughtCommunityDbTests.cs`; `apps/web/admin/tests/drought-community.spec.ts`.

---

## 3. Data layer

### 3.1 Database design: migrations, not code-first (D, C) — Olwethu
- **Open:** `supabase/migrations/` (0001 to 0062), `supabase/migrations/0059_core_tables_rls.sql:30`, then `docs/ops/verify-migrations.sql`.
- **Say:** "We design the database first, in numbered SQL migrations. That suits Supabase and keeps row-level security in the database itself. Every migration can run twice safely, and a verify script checks that each one is applied."
- **Proof:** `docs/test-evidence/migration-replay/replay.mjs` (replays all migrations twice, 59 verify rows true); `backend/AgroFlow.Domain.Tests/SecurityDbTests.cs`.

### 3.2 Data access: parameterised SQL and LINQ (OO, D) — Olwethu
- **Open:** `backend/AgroFlow.Api/Endpoints/KitStatusEndpoints.cs:55` (one query with lateral joins), then `backend/AgroFlow.Api/DataManagement/JourneyStore.cs:183` (LINQ `Where`, `Sum`, `Count`).
- **Say:** "Queries go through Npgsql with numbered parameters, never string-built values, and a test scans the code for that. This query gets each zone's newest reading and last command in one round trip. In C#, we use LINQ to work out the installer checklist totals."
- **Proof:** `backend/AgroFlow.Domain.Tests/SqlGuardTests.cs`, `JourneyDbTests.cs`.

### 3.3 Activity log, settings and health (D, E) — Luba
- **Open:** `backend/AgroFlow.Api/DataManagement/AuditLog.cs:67`, `AppSettingsStore.cs:15`, `SchemaCheck.cs:187`.
- **Say:** "Every staff action is written to the activity log with who did it and when. Staff-tunable values, like drought thresholds and the terms setting, live in one settings table with validation. The health page checks that each migration is applied, and a failed check is never shown as an outage."
- **Proof:** `backend/AgroFlow.Domain.Tests/AuditLogAndSchemaCheckTests.cs`, `HealthDbTests.cs`; `apps/web/admin/tests/health-status.spec.ts`.

### 3.4 Seeding and offline sync (C) — Luba
- **Open:** `supabase/migrations/0056_demo_mahikeng.sql:19`, then `apps/mobile/src/lib/offlineQueue.ts:61`.
- **Say:** "The demo farms near Mahikeng are seeded by a migration and clearly marked as simulated. A real farm never gets demo values. In the app, actions taken offline are queued and sent once the phone reconnects."
- **Proof:** `backend/AgroFlow.Domain.Tests/SimulationTests.cs`; `apps/mobile/src/services/__tests__/offline.test.ts`.

### 3.5 Reports (W) — Olwethu
- **Open:** `backend/AgroFlow.Api/Reports/ActionReportPdf.cs:13`, then `backend/AgroFlow.Api/Reports/XlsxWriter.cs:39`.
- **Say:** "Reports are built on the server as PDF (QuestPDF) and Excel. We wrote our own small XLSX writer, so there's no heavy dependency. Water use is always marked as estimated from run time × the measured flow rate, because the kit has no water meter."
- **Proof:** `backend/AgroFlow.Domain.Tests/ActionReportTests.cs`, `WaterUsageWorkbookTests.cs`; `apps/web/admin/tests/reports.spec.ts`.

---

## 4. Hardware layer

### 4.1 Firmware: pins and fail-safes (W, D) — Leruo
- **Open:** `hardware/esp32/AgroFlowIrrigationNode/AgroFlowIrrigationNode.ino:105` (pins), line 139 (`LOST_CONTACT_STOP_MS`), and line 703 (`handleMqttCommand`).
- **Say:** "The kit is an ESP32 with a soil probe, a DHT11 and a relay, which switches off before anything else at boot. If it loses the server for 3 minutes during a run it stops by itself, and it never runs longer than the zone's limit. Each command ID is carried out once, even after a restart."
- **Proof:** `hardware/esp32/tests/run_limits_test.cpp`, `command_ids_test.cpp`, `offline_buffer_test.cpp`; `backend/AgroFlow.Domain.Tests/FirmwareContractTests.cs` (the firmware against the API contract).

### 4.2 Setup Wi-Fi without opening the box (E) — Leruo
- **Open:** `hardware/esp32/AgroFlowIrrigationNode/AgroFlowIrrigationNode.ino:382` (`printKitSetupInfo`), then the guide `apps/web/admin/public/guides/reconnect-or-reset-your-kit.html`.
- **Say:** "A farmer changes Wi-Fi from the app, or by switching the kit off and on 3 times. The kit then opens its own setup network. Five times is a full reset, which staff follow up with a new enrollment code. The printable guide and the Kit tab explain the same steps."
- **Proof:** `apps/mobile/src/components/__tests__/kitHelp.test.tsx` (it also checks the firmware's numbers).

---

## 5. Across the project (C, E) — Leruo
- **Open:** `docs/architecture.md`, `apps/web/admin/vercel.json:62`, then `git log --oneline --graph -15`.
- **Say:** "Work happens on feature branches merged into `dev` through pull requests, and `main` is never pushed directly. The API runs on Railway, and the staff site and farmer web app on Vercel, with security headers. We have about 1,600 .NET tests, about 360 jest tests and about 240 Playwright tests, plus the end-to-end kit simulation."
- **Proof:** `dotnet test backend/AgroFlow.Domain.Tests`; `npx jest` in apps/mobile; `npx playwright test` in apps/web/admin; `node hardware/sim/run-e2e.mjs`.

---

## Mark-sheet coverage

| Criterion | Bullets | Steps |
|---|---|---|
| Design and functionality (/10) | standards, few globals, little duplication, parameters, validation, DB design, layers, advanced concepts | 1.1, 1.2, 1.3, 1.5, 2.3–2.7, 3.1–3.3, 4.1 |
| OO features (/10) | namespaces/assemblies (AgroFlow.Api, AgroFlow.Domain), classes/objects, composition, interfaces, inheritance, polymorphism, LINQ/SQL | 1.2, 2.1, 2.2, 2.8, 3.2 |
| Complexity and maintainability (/10) | not over-engineered, tests, comments, naming, seeding, version control | 2.5, 3.1, 3.4, 5 |
| Web/mobile/other components (/10) | complex APIs, ML/AI (none, said honestly in 2.6), complex platform, 3rd-party, hosted | 1.1, 1.4, 2.3, 2.6, 3.5, 4.1, 5 |
| Extras (/10) | cloud hosted, installation packages, integrations, APIs, dark/light mode, languages, accessibility | 1.4, 1.6, 2.8, 2.9, 3.3, 4.2, 5 |

## Live demo order (about 6 minutes)

1. **Enquiry (Luba):** on the public site, fill in Request a call; in the staff console, open Enquiries and claim it.
2. **Onboarding (Phili):** onboard the farmer from the enquiry; on the farmer app, sign in and show Home: Account, Your details 0 of 4, Installation not booked yet.
3. **Kit (Leruo):** in the staff console, register a kit with the wizard and show the setup card and printable label. Power the kit and show the card fill in, then the farmer's Kit tab turning Working.
4. **Water now (Olwethu):** on the farmer app, Irrigation, choose a zone, Water now for 1 minute. Show "Waiting for kit", then started and finished once the kit confirms, then Stop.
5. **History (Olwethu):** open More, then History, and show the run with its estimated litres. In the staff console, open the Activity log for the same actions.

If the kit or the broker isn't available on the day, use the simulated Mahikeng farm (`hardware/sim/fake-kit.mjs`) and say that it's simulated.
