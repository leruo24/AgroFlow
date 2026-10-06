# Narration — AgroFlow Showcase demo (active part, 0:00–4:00)

Read at a calm, confident pace (about 125–135 words a minute). Time codes are where
each paragraph starts. Nothing is spoken during the editor end plate (4:00–4:30).
Word count: about 510.

---

**0:00 — Title**
This is AgroFlow, a smart irrigation management system, built by Team 2 for INF3003W.

**0:10 — Persona and problem**
Meet our farmer: a smallholder growing tomatoes, spinach and maize in separate zones.
Each crop, and each patch of soil, dries out at its own pace. Watering everything the
same way wastes water in one place and stresses plants in another. Today, Zone 2 needs
attention.

**0:30 — Opening AgroFlow**
Our farmer signs in on their phone. The home screen shows today's weather and a summary
of the farm, including one unread alert. One tap on Manage Irrigation shows every zone
side by side. Zone 2, the spinach, immediately stands out: its health is critical.

**1:00 — Understanding the zone**
Opening Zone 2 shows the latest readings. Soil moisture is nineteen percent, and the app
labels it dry, because it is below the start level set for this zone. Temperature and
humidity sit alongside it.

These values are not typed in by hand. A soil-moisture probe and a temperature and
humidity sensor feed an ESP32 controller in the field. It publishes readings over a
secure MQTT connection to the AgroFlow service, which stores them in our Supabase
database, and the app shows the latest values.

**1:35 — From data to action**
Raw numbers are only half the story. AgroFlow combines the crop and its growth stage,
the soil, the zone's own moisture levels and the weather forecast, using the FAO-56
water-balance method. It is a deterministic calculation, not a guess. The result is a
plain instruction: water Zone 2 now, for about five minutes, roughly eight litres. And
the week ahead shows why waiting is not an option: no rain is expected.

**2:05 — Taking action**
Zone 2 normally waters on a schedule, but its next run is days away. So the farmer
switches it to manual. They type ninety minutes by mistake, and AgroFlow stops them
with a clear message: a manual run must be between one and sixty minutes. They correct
it to five, confirm, and the command is sent.

That command travels back the way the data came: from the app, through the AgroFlow
service and the MQTT broker, to the ESP32, which switches the relay and runs the pump.
When the run finishes, the controller reports it, and the irrigation event is recorded.
Later, the farmer can see it in their history: five minutes, Zone 2, started
manually.

**2:58 — The platform administrator**
One farmer's decision is part of a larger, connected platform. Our second persona is
the platform administrator. Their console opens on what needs attention across every
farm, the platform's key numbers and the health of its services. From there they can
review farms, check every field kit's connection, firmware and when it was last seen,
follow up the critical alert from Zone 2, and see the maintenance jobs planned for the
field kits. Every
administrator action is recorded. The same console adapts to a phone-sized screen.
Farmers manage their farms; administrators oversee the platform.

**3:36 — The complete system**
Put together, AgroFlow connects the field to the people who depend on it. Sensors and
controllers in the soil, a connected platform in the middle, and an app for the farmer
and a console for the administrator. Sense, understand, act, and monitor.

**3:52 — Close**
AgroFlow: from field conditions to informed irrigation.
