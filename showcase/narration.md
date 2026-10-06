# Narration — AgroFlow Showcase demo (active part, 0:00–4:20)

Read at a brisk, clear pace (about 150 words a minute). Each *(m:ss)* is where a line starts in the video. Nothing is spoken during the editor end plate (4:20–4:50). Word count: about 616.


**Voiceover in the render:** generated locally with Kokoro TTS, voice `am_michael` (US male), speed 1.15 with long pauses
trimmed, normalised to −16 LUFS, one file per paragraph in `assets/vo/` (text and start times:
`assets/vo/vo-lines.json`). The spoken text is this script; a few terms are spelled for the
voice (I N F three-oh-oh-three W, E S P thirty-two, M Q T T, P D F). The administrator
paragraph is split into three lines so each part lands on its screen. To use a human
narrator instead, record this script and replace the files in `assets/vo/`, keeping the names.

Every claim below is implemented on branch `dev` (see `system-audit.md`). Lines from the
team's description that are *not* in the code are listed in `CLIP-REVIEW.md` and are
deliberately not narrated.

---

**0:00 — Title**
*(0:00)* This is AgroFlow, a smart irrigation system, built by Team 2 for INF3003W.

**0:10 — Persona and problem**
*(0:10)* Meet our farmer: a smallholder growing tomatoes, spinach and maize in separate zones. Most small farms water by habit: the same amount, on the same days. But each crop, and each patch of soil, dries out at its own pace. Today, Zone 2 needs attention.

**0:30 — Opening AgroFlow**
*(0:30)* Our farmer opens the app. Drip, the app's helper, points straight at the one thing that matters today: water Zone 2 now, about five minutes. Below it: today's weather, and a farm summary with one unread alert. One tap on Manage Irrigation shows every zone side by side, each with its crop, mode, health and latest readings. Zone 2, the spinach, stands out: its health is critical. Opening it shows the details.

**0:58 — Understanding the zone**
*(0:58)* Zone 2's soil moisture is nineteen percent, below the start level set for this zone, so the app marks it dry. Temperature and humidity sit alongside it.

*(1:12)* These readings come from a kit in the field: a soil probe and a temperature and humidity sensor on an ESP32. About every thirty seconds it publishes them over a secure MQTT connection. The AgroFlow service, hosted on Railway, stores them in Supabase and updates the zone's health.

**1:35 — How AgroFlow works out the advice**
*(1:35)* The advice comes from the FAO-56 method, in four steps: how thirsty the weather is, the crop's growth stage, how much water the soil and roots can hold, and a daily tally, like a bank balance. When the deficit reaches the safe limit, it is time to water. The sensor keeps the tally honest, and forecast rain can skip a watering. A deterministic calculation, not AI. In the app, that becomes one plain line of advice: water now, about five minutes, roughly eight litres. The farmer can tap it away once it's done. And the week ahead confirms it: each day says what it means for watering, and no rain is expected.

**2:14 — Taking action**
*(2:14)* Zone 2 normally waters on a schedule, but its next run is days away. So the farmer switches it to manual. They type ninety minutes by mistake, and AgroFlow stops them: a manual run must be between one and sixty minutes. They correct it to five. The app asks them to confirm, and the command is sent.

*(2:37)* It travels back the way the data came. The service checks it and saves it; the database notifies a dispatcher, which publishes it over MQTT to the ESP32. The kit switches the relay and runs the pump. When the run ends, the kit reports how long it ran, and AgroFlow estimates the water used from the run time and the zone's flow rate, because the kit has no flow meter. Later, the farmer sees it in their history: five minutes, Zone 2, started manually.

**3:06 — The platform administrator**
*(3:06)* Our second persona is the platform administrator. Their console opens on what needs attention across every farm. They review farmers' requests for new farms and zones, check every kit's connection and last check-in, and can change a kit's Wi-Fi, reopen its setup page or revoke it remotely.

*(3:26)* They follow up Zone 2's critical alert, raised automatically when its soil moisture fell below twenty percent.

*(3:33)* They produce farm reports as PDF or Excel, and every administrator action is recorded. The console also works at phone size. Farmers manage their farms; administrators oversee the platform.

**3:50 — The complete system**
*(3:50)* Put together: kits in the field, a connected platform in the middle, Telegram alerts and reports, an app and a console. Readings flow up; commands flow down. And each kit is safe on its own: no pump run lasts over five minutes, and if it goes offline, it waters itself in short, rested bursts. Sense, understand, act, monitor.

**4:12 — Close**
*(4:12)* AgroFlow: from field conditions to informed irrigation.
