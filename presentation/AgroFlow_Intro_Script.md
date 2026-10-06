# AgroFlow — Showcase Introduction Script

INF3003W Systems Development Project I · Team 2 · University of Cape Town · 2026
Deck: `AgroFlow_Showcase_Intro_2026.pptx` (10 slides)

**Target:** 5:30–6:30 · **Hard limit:** 7:00
**Spoken length:** 766 words (counted). At 140 words per minute that is 5:28, plus about 20–30 s for handovers and slide changes, so roughly **5:50–6:00**.

| Speaker | Role (Milestone 1, Table 14) | Slides | Words | Time at 140 wpm |
|---|---|---|---|---|
| 1 · Lubaelihle Msuku | Project Manager | 1–3 | 180 | ~1:17 |
| 2 · Leruo Matlhatsi | Software Developer | 4–5 | 199 | ~1:25 |
| 3 · Philisile Tyobeka | Business Analyst | 6–7 | 174 | ~1:15 |
| 4 · Olwethu Nkabinde | Soft Skills Specialist | 8–10 | 213 | ~1:31 |

The split follows your suggested structure and matches each person's documented role. The developer explains the architecture, and the business analyst explains the process and the domain model.

**Before rehearsing, do these three things (see the source audit):**
1. Put real team photos into the four circles on slide 2.
2. Put a real kit photo into the dashed box on slide 8.
3. If the demo includes a manual pump run, choose **5 minutes or less**. The app accepts 1–60 minutes, but the firmware stops every run at 5 minutes.

---

## Speaker 1 — Lubaelihle Msuku

### Slide 1 · AgroFlow (~20 s)
Good morning. We're Team 2, and this is AgroFlow, a smart irrigation management system.
It combines agriculture, IoT hardware in the field, irrigation control and software. The screens on the right are our real farmer app. The project was sponsored by the Mafikeng Cisco Edge Centre, MDiHub.

### Slide 2 · Meet Team 2 (~20 s)
I'm Lubaelihle, the project manager. Leruo is our software developer, Philisile our business analyst, and Olwethu our soft-skills specialist. All four of us will present today.
Our sponsor is Boingotlo Molefhe, and our tutor and mentor were Nazreen Ryklief and Jodie Thorburn.

### Slide 3 · The irrigation challenge (~40 s)
Farmers have to decide when and how much to water without reliable, real-time visibility of their fields.
In practice that means walking from zone to zone to judge the soil, or relying on fixed timers that ignore the weather. The result is over- and under-watering, extra labour, and no record of the water used.
Rural sites also have weak signal and load-shedding, so the system has to keep working offline.
Our persona, Sipho Dlamini, wants to check his soil without walking to every zone.
*Handover:* Leruo will show how AgroFlow answers that.

---

## Speaker 2 — Leruo Matlhatsi

### Slide 4 · From field conditions to informed irrigation (~35 s)
Thanks, Luba. AgroFlow is one connected system.
Each zone has an ESP32 kit that reads soil moisture, temperature and humidity every thirty seconds and switches the pump through a relay.
The platform stores those readings, checks each zone, and uses the FAO-56 method to advise how much water the crop needs. When a person needs to act, it sends a Telegram alert.
The farmer can leave a zone on automatic, schedule it, or water manually.
The advice is rule-based and sourced, not an AI model.

### Slide 5 · How AgroFlow works (~50 s)
This is the system as built, traced from our code.
The kit's sensors feed the ESP32, which drives the relay and pump. It publishes readings over MQTT, encrypted with TLS, to HiveMQ Cloud; enrolment and event logging use HTTPS.
Our ASP.NET Core API, running in Docker on Railway, stores readings in Supabase, decides whether automatic zones need water, runs the advice engine with Open-Meteo weather, and sends Telegram alerts.
Both apps read straight from Supabase, where row-level security keeps each farmer to their own farm.
Along the bottom is the command path: queued in the database, picked up by the API, sent over MQTT to the ESP32.
*Handover:* Philisile will walk through the process.

---

## Speaker 3 — Philisile Tyobeka

### Slide 6 · From monitoring to irrigation (~45 s)
Thank you, Leruo. Our To-Be process has three lanes: farmer, platform and hardware.
The kit reads its sensors every thirty seconds. The platform stores each reading and updates the zone's health. If the zone is on automatic and below the farmer's threshold, it queues a start command; otherwise it keeps monitoring.
Meanwhile the farmer reviews the FAO-56 advice and can start a manual run for a chosen number of minutes.
Either way the command reaches the relay and the pump runs, until the time is up, a stop arrives, or a safety limit is hit. The event is logged and appears in the farmer's history.

### Slide 7 · Designed as a connected system (~35 s)
This is our domain model, simplified. A farm user owns farms, and each farm has zones.
The zone is the centre: it has hardware — the ESP32, sensors and pump all inherit from Hardware — and it collects irrigation logs, alerts and advice.
On the right is the real Zone class. ShouldStartIrrigation only returns true when the farmer has set a threshold; it never guesses.
*Handover:* Olwethu will show what we built.

---

## Speaker 4 — Olwethu Nkabinde

### Slide 8 · From design to implementation (~30 s)
Thanks, Philisile. This is our evidence that AgroFlow is built, not just designed.
Top left is the farmer app; top right, the admin console, which opens on what needs attention. Bottom left is our kit *(describe the photo once added)*, and bottom right is the ESP32 firmware switching the pump on a start command and off on a stop.

### Slide 9 · What AgroFlow delivers (~35 s)
Here is where we stand. The field kit enrols with a one-time code, keeps watering locally when offline, and caps every pump run at five minutes.
The platform, farmer app and admin console are all working, as listed.
Some things aren't finished. Maintenance and alert assignment don't persist yet, uptime isn't measured, and the ESP-NOW gateway from our design wasn't built.

### Slide 10 · The journey we will demonstrate (~45 s)
Our demo follows one end-to-end journey.
An administrator registers a farm, choosing the farmer, a map pin and a supported crop. They register a kit and receive a one-time code. The board is enrolled with that code and comes online, and we run the zone's advice.
Then we switch to the farmer's app for the forecast, a water report and the Telegram message, and finish on the activity log.
We'll also show a validation check: if the farm name is cleared before saving, the wizard returns to the step that is wrong.
Now, let's see AgroFlow in action.

---

## Timing check

Word counts below are counted from this script. Times assume 140 words per minute and do not include pauses.

| Slide | Words | Est. | Running total |
|---|---|---|---|
| 1 | 47 | 0:20 | 0:20 |
| 2 | 42 | 0:18 | 0:38 |
| 3 | 91 | 0:39 | 1:17 |
| 4 | 85 | 0:36 | 1:53 |
| 5 | 114 | 0:49 | 2:42 |
| 6 | 105 | 0:45 | 3:27 |
| 7 | 69 | 0:30 | 3:57 |
| 8 | 54 | 0:23 | 4:20 |
| 9 | 61 | 0:26 | 4:46 |
| 10 | 98 | 0:42 | 5:28 |
| Handovers and transitions | — | ~0:25 | **~5:53** |

These are estimates, not measurements. Time a full rehearsal. If it falls **under 5:30**, slow down on slides 5 and 6 rather than adding words. If it runs **past 6:30**, shorten slide 5 to the command-path sentence and drop the HTTPS clause.
