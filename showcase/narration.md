# Narration — AgroFlow Showcase demo (active part, 0:00–4:20)

Read at a calm, confident pace (about 125–135 words a minute). Time codes are where
each paragraph starts. Nothing is spoken during the editor end plate (4:20–4:50).
Word count: about 510.

Every claim below is implemented on branch `dev` (see `system-audit.md`). Lines from the
team's description that are *not* in the code are listed in `CLIP-REVIEW.md` and are
deliberately not narrated.

---

**0:00 — Title**
This is AgroFlow, a smart irrigation system, built by Team 2 for INF3003W.

**0:10 — Persona and problem**
Meet our farmer: a smallholder growing tomatoes, spinach and maize in separate zones.
Most small farms water by habit: the same amount, on the same days. But each crop, and
each patch of soil, dries out at its own pace. Today, Zone 2 needs attention.

**0:30 — Opening AgroFlow**
Our farmer opens the app. Drip, the app's helper, points straight at the one thing that
matters today: water Zone 2 now, about five minutes. Below it, today's weather and a
summary of the farm, with one unread alert. One tap shows every zone side by side, and
Zone 2, the spinach, stands out: its health is critical.

**1:00 — Understanding the zone**
Zone 2's soil moisture is nineteen percent, below the start level set for this zone, so
the app marks it dry. Temperature and humidity sit alongside it.

These readings come from a kit in the field: a soil probe and a temperature and
humidity sensor on an ESP32. About every thirty seconds it publishes them over a secure
MQTT connection. The AgroFlow service, hosted on Railway, stores them in Supabase and
updates the zone's health.

**1:35 — How AgroFlow works out the advice**
The advice comes from the FAO-56 method, in four steps: how thirsty the weather is,
the crop's growth stage, how much water the soil and roots can hold, and a daily tally,
like a bank balance. When the deficit reaches the safe limit, it is time to water. The
sensor keeps the tally honest, and forecast rain can skip a watering. A deterministic
calculation, not AI. In the app: water now, about five minutes, roughly eight litres.

**2:13 — Taking action**
Zone 2 normally waters on a schedule, but its next run is days away. So the farmer
switches it to manual. They type ninety minutes by mistake, and AgroFlow stops them: a
manual run must be between one and sixty minutes. They correct it to five, confirm, and
the command is sent.

It travels back the way the data came: through the AgroFlow service and the MQTT broker
to the ESP32, which switches the relay and runs the pump. When the run ends, the kit
reports it, and the event is recorded. Later, the farmer sees it in their history: five
minutes, Zone 2, started manually.

**3:06 — The platform administrator**
Our second persona is the platform administrator. Their console opens on what needs
attention across every farm. They review farmers' requests for new farms and zones,
check every kit's connection and last check-in, and can change a kit's Wi-Fi, reopen its
setup page or revoke it remotely. They follow up Zone 2's critical alert, produce farm
reports as PDF or Excel, and every administrator action is recorded. The console also
works at phone size. Farmers manage their farms; administrators oversee the platform.

**3:50 — The complete system**
Put together: kits in the field, a connected platform, Telegram alerts and reports, an
app and a console. And each kit is safe on its own: no pump run lasts over five
minutes, and offline, it waters itself in short bursts. Sense, understand, act, monitor.

**4:12 — Close**
AgroFlow: from field conditions to informed irrigation.
