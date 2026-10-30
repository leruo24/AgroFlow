# AgroFlow diagrams — narratives and assumptions (as built, October 2026)

Open each `.drawio` file in draw.io (app.diagrams.net or the desktop app). Export as PNG with File → Export as → PNG for the document and slides.

---

## 1. As-Is activity diagram — Manual irrigation

**Narrative.** Today the farmer decides everything by hand. The farmer walks to the field and inspects the soil by hand or eye. If the soil is moist enough and water is not running, the farmer leaves. If water is already running and the soil is now moist enough, the farmer closes the valve or stops the pump and leaves. If the soil is too dry, the farmer checks the weather on a phone or by looking at the sky. If rain is expected, the farmer leaves without watering. If not, the farmer opens the valve or starts the pump, the equipment supplies water, and the farmer waits and watches before inspecting the soil again. This loop repeats until the soil is moist enough.

**Assumptions.**
- There are no sensors, no recorded data and no water-use records.
- Decisions rely on the farmer's own judgement and a general weather check.
- The farmer must be physically present to start, watch and stop watering.
- The irrigation equipment (valve, pump, sprinklers or drip lines) only supplies water; it makes no decisions.

---

## 2. To-Be activity diagram — Farmer waters a zone

**Narrative.** The farmer opens a zone in the AgroFlow app. The system shows the latest soil, temperature and humidity readings, the watering advice and whether the kit is connected. If the kit is not connected, the system says so and shows how to get help, and the process ends. If it is connected, the farmer presses **Water now**. The system sends a watering command that is capped at the zone's run limit (5 minutes by default). The kit switches the pump on and confirms the start. If no confirmation arrives, the app shows **No response** and the farmer can try again or stop. Once the start is confirmed, the pump runs. The farmer can press **Stop** early; otherwise the kit stops by itself when the run limit is reached. The kit switches the pump off and confirms the stop, the system records the watering in History, and the farmer sees **Kit confirmed stop**.

**Assumptions.**
- The farmer is signed in and the zone has an installed, commissioned kit.
- The zone is in Manual mode. After commissioning, an Automatic zone starts from the FAO-56 recommendation at the "Send command" step and then follows the same flow.
- There is no flow meter, so "confirmed" means the kit switched the pump on or off, not that water flow was measured.
- The kit also stops by itself if it loses contact with the server for 3 minutes, and it ignores a repeated command, so a resend never waters twice.

---

## 3. To-Be activity diagram — Enquiry to live kit

**Narrative.** A farmer requests a call through the public website. The system records the enquiry and notifies staff. An admin claims it, calls the farmer and onboards them: contact details, location, farm and zone sizes and crops. The system creates the farmer's account with a temporary password and shows a Telegram QR code. The farmer scans it and presses Start, and the system sends a welcome, the app download and web app links and their login details on Telegram. The farmer signs in, sets their own password and reviews the setup tasks, which are already filled in from onboarding. If anything is missing, the admin follows up. The admin books the installation and presses **Add kit** on the zone, and the system creates a 6-digit setup code valid for 30 minutes. The installer joins the kit's setup hotspot (no password) and enters the farm Wi-Fi and the code. The system checks the code, links the kit to the zone and sends the kit its MQTT details. If the kit's page does not show "Linked", the installer fixes the problem it names (Wi-Fi password, a 5 GHz-only network or an expired code) and tries again. The installer then runs the guided check (dry and wet readings, a pump test and a bucket flow-rate test) and commissions the zone. The system marks it **Live** and tells the farmer on Telegram that the kit is working. If the farmer turns on automatic watering, the zone is set to Automatic; otherwise it stays Manual.

**Assumptions.**
- The enquiry comes from the public website; the farmer has a phone with Telegram or a browser.
- Setup tasks are prefilled from onboarding, so the farmer only adds what is missing.
- The kit's setup hotspot has no password; only a valid 6-digit code links a kit to a zone.
- New zones always start in Manual mode.
- Telegram is for farmers only; staff never receive Telegram messages.
- This diagram shows the onboarding and kit flow as redesigned in October 2026.

---

## 4. Package diagram v2 (as built)

**Narrative.** The diagram keeps the seven subsystems and three layers from Milestone 2. The **Presentation layer** has the Admin Console (staff work: users, farms, enquiries and onboarding, installations and kits, reports, settings and moderation) and the Farmer App (dashboard, the four setup tasks, zones, the Kit tab and alerts). The two front ends do not depend on each other; both use the same logic packages. The **Logic layer** has Sensor Monitoring (one Sensor class with a type: soil, temperature or humidity, and its readings), Irrigation Control (zones, commands, watering history, schedules and run limits, the FAO-56 engine, which calculates ET₀ itself with Penman–Monteith, and the drought rules) and Notifications (alerts, Telegram messages for farmers, in-app notices and community reports). The **Data layer** has the Hardware Layer (the ESP32 kit, the pump and kit linking with a 6-digit code) and Data Management (data access, uploading readings stored offline, and the audit log). Package items are the main classes or responsibilities in each package; docs/architecture.md maps them to folders. Outside the boundary are the services AgroFlow uses but does not own: Supabase, the Open-Meteo weather API (forecast and the weather inputs for ET₀), the HiveMQ MQTT broker, Telegram, and the Arduino IDE (build time only).

### What changed since Milestone 2

| Item | Milestone 2 | Now | Why |
|---|---|---|---|
| Recommendations | AiRecommendations (listed twice) | Recommendations (FAO-56), listed once | The ML model was removed; FAO-56 gives explainable advice from day one (see below) |
| Board communication | ESP-NOW between boards, via a gateway | Each ESP32 connects over Wi-Fi to the HiveMQ MQTT broker | Simpler: one kit per zone, no gateway needed |
| External packages | Weather API, Supabase, Arduino IDE | Added HiveMQ (MQTT) and Telegram | Commands and readings travel over MQTT; farmer alerts and onboarding use Telegram |
| Notifications | Alert only | Alert, Telegram message, in-app notice, community report | Features added after sponsor feedback |
| Admin Console | User, Admin, Farm, Report | Added enquiry/onboarding, installation/kit wizard, settings and moderation | The real onboarding and installation journey |
| Farmer App | FarmUser, Dashboard | Added the four setup tasks, zone view, Kit tab, alerts | Simpler setup and kit health for farmers |
| Pump | In both Irrigation Control and Hardware Layer | Hardware Layer only | Each class sits in one package |
| Weather dependency | Weather API → Supabase | Irrigation Control → Weather API | Irrigation Control is the package that uses the weather |
| ET₀ | Listed under the weather API | Calculated by AgroFlow's FAO-56 engine (Penman–Monteith) from Open-Meteo weather inputs | Matches the code |
| Sensor classes | Three sensor classes | One Sensor class with a type | Matches the code |
| Typos | "HumiditySesnor", stray "s" label | Fixed | — |

### Why FAO-56 replaced AI
FAO Irrigation and Drainage Paper 56 (Allen, Pereira, Raes & Smith, 1998) is the internationally used method for calculating crop water needs from reference evapotranspiration, a crop coefficient for the growth stage, and the soil water balance. An ML model was built earlier but removed because (1) there was no real farm data to train it, only simulated data generated by the same rules; (2) it performed worse than the simple baseline in testing; and (3) farmers need advice they can trust and that can be explained step by step, which FAO-56 allows through the app's "Why am I seeing this?". FAO-56 also works from the first day on a new farm without training data, and it is fully covered by automated tests. An ML model can be revisited once a season of real data exists, with FAO-56 as the baseline it must beat.



---

## 5. Class diagram — database (analysis level)

**Narrative.** The class diagram shows the main things AgroFlow stores and how they relate. **User** is abstract and specialises into **Admin** (staff) and **FarmUser**. A FarmUser owns farms, and can also be a member of other farms; that many-to-many relationship is resolved by **FarmMember**. A **Farm** is made up of **Zones** (composition). A zone can have **HardwareKits** (aggregation: a kit exists before it is linked and can move). A kit holds its one-time enrollment code and its expiry, and sends **SensorReadings**: one row per measurement, with a type (soil, temperature or humidity). Readings also belong to a zone. A zone receives **IrrigationCommands** (start, stop, open setup, change Wi-Fi) and has **IrrigationEvents** (the watering history); a command results in at most one event. Each farm keeps **WeatherRecords** (including ET₀ for FAO-56), **TankRefills**, **DroughtEvents**, **Installations**, **Notifications** sent, and an optional **ReportSchedule**. Admins claim **Enquiries**, publish **StaffNotices** and are the actor on **AuditEntries** (0..1, because some entries are made by the system). FarmUsers accept the terms (**TermsAcceptance**), have one **NotificationPreference** (five on/off alert switches), post **CommunityReports** and confirm others' reports (**ReportConfirmation**, which resolves a second many-to-many).

**Marker rules applied:** singular class names; multiplicity on both ends of every association; inheritance (User → Admin, FarmUser); composition and aggregation; both many-to-many relationships resolved; no ID or foreign-key attributes; shared attributes only in User.

**Assumptions.**
- FAO-56 recommendations are calculated when needed and not stored, so they appear in the package diagram, not here.
- App settings (key/value configuration) are left out because they are configuration, not a business entity.
- Attribute names are written in camelCase as logical attributes, not exact column names.
- The database stores two roles (admin, farm_user); the API also has a field_officer role.

**Corrected after checking the diagrams against the code:** EnrollmentCode is two attributes of HardwareKit, not a table; Installation belongs to Farm; there is no direct Enquiry–Farm link; SensorReading is one row per measurement; IrrigationEvent has no end time; Zone mode includes Scheduled; commands include OpenSetup and ChangeWifi; Farm–Zone, Farm–FarmMember and Zone–HardwareKit are 0..*; Command–Event and AuditEntry–Admin are 0..1; added Zone–SensorReading, Zone–IrrigationEvent and Farm ownership. Attributes still to confirm against the schema: StaffNotice, FarmMember, DroughtEvent, Installation, Enquiry and the five NotificationPreference switch names.
