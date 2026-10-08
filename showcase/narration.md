# Narration — AgroFlow Showcase Walkthrough (v3)

Read at a clear, even pace. Each *(m:ss)* is where the line starts in the video. Total: 4:53 at 1920×1080, 25 fps.
Word count: about 755.

**Voiceover in the render:** generated locally with Kokoro TTS, voice `am_michael` (US male), speed 1.2, long pauses trimmed,
normalised to −16 LUFS, one file per paragraph in `assets/vo/` (spoken text and start times: `assets/vo/vo-lines.json`).
A few terms are spelled out for the voice there (F A O fifty-six, E S P thirty-two, Y L sixty-nine, D H T eleven, M Q T T, A P I).
To use a human narrator, record this script and replace the files in `assets/vo/`, keeping the names.

Every claim is implemented on branch `dev`; see `system-audit.md` (v3 section) for where each one lives in the code.
Every number comes from one worked scenario (`capture/v3/scenario_calc.py`), using the engine's own formulas.

---

**0:00 — Opening**
*(0:03)* This is AgroFlow, by MafiHub: smarter irrigation decisions from field data, weather and crop science.

**0:10 — The decision problem**
*(0:11)* A farmer must decide when to irrigate, how much, for how long, and whether the weather changes the plan. Poor connectivity, scarce water and uneven fields make that harder. AgroFlow is a rules-based decision-support system. It combines field sensors, weather, crop, soil and irrigation history through the FAO-56 crop water method: a deterministic calculation, not AI.

**0:34 — The field kit**
*(0:34)* Each irrigation zone has a field kit: an ESP32 controller, a YL-69 resistive soil moisture probe, a DHT11 temperature and humidity sensor, and a relay that switches the pump. It reports every thirty seconds. The firmware stops any pump run after five minutes, and if the connection is lost, it waters dry soil in short, rested bursts.

**0:58 — How it connects**
*(0:58)* Readings travel over secure MQTT to the AgroFlow API, and into a Supabase Postgres database. Open-Meteo supplies the weather. Farmers use the app, administrators use the web console, and alerts arrive on Telegram.

**1:14 — The farmer's app: water today**
*(1:14)* Our farmer opens the app. Home gives one line of advice per zone. Tomato field: water about seventy minutes this morning, about seventeen hundred and fifty litres. That is thirty-five millimetres over fifty square metres, at the pump's twenty-five litres a minute. Confidence is high: sensor, setup and weather agree. The spinach beds can wait until Saturday.

**1:35 — The science, simply (FAO-56)**
*(1:36)* Behind that line is the FAO-56 water balance. The weather gives the reference evapotranspiration: five point eight millimetres. The crop's growth stage sets its crop coefficient, so the tomatoes will use about six point four. Soil and root depth set how much water the root zone holds, and when the crop starts to struggle. Rain, irrigation and crop use are tallied daily as the root-zone depletion.

**2:00 — Why am I seeing this?**
*(2:00)* Every recommendation has a link: Why am I seeing this? It shows what was used, where each number came from, the rule, and what would change it. Here, the depletion is thirty-five millimetres, past the thirty-one and a half millimetre threshold, and two millimetres of rain won't cover the day's use. So: water today.

**2:18 — Farmer in control**
*(2:19)* AgroFlow recommends. The farmer decides. Our farmer applies fifteen hundred litres instead, and records it with, I watered. AgroFlow logs what actually happened and counts it: the field is no longer due today. A quick soil check by hand corrects the estimate too.

**2:35 — From the app to the pump**
*(2:36)* Where a kit controls the pump, a run can be started from the app. Ninety minutes is rejected: a manual run is one to sixty minutes. Five minutes is confirmed and sent, through the API and MQTT to the ESP32, which switches the relay and runs the pump. The kit reports the run, and it appears in the history.

**2:56 — Next 7 days**
*(2:56)* AgroFlow also looks ahead. The week-ahead screen says what each day means for watering. Underneath, the engine keeps a continuous, daily water balance and projects it onto the forecast. The tomatoes should next need water on Tuesday. The projection rolls forward every day; nothing resets at the end of the week.

**3:15 — Weather update: the plan recalculates**
*(3:15)* Then the forecast changes: twenty-two millimetres of rain on Saturday. AgroFlow recalculates. That rain is more than the crop will use, the balance refills, and no watering is now expected this week. It isn't simply, rain means skip. Today's two millimetres were too little, so watering went ahead. And if forecast rain fades, the next update brings watering forward again.

**3:37 — Alerts and checking the field**
*(3:38)* Heavy rain warnings reach farmers on Telegram, with the same Why button. And the soil sensor is treated as a check, not the whole truth: it reads one spot in the field. A stuck or drifting sensor raises its own warning, and the farmer's own soil check can correct the estimate.

**3:55 — Incomplete setup**
*(3:55)* When setup is incomplete, AgroFlow still advises, and names what is missing. The maize block has no flow rate, so its advice is in litres, at medium confidence, with one next step: time the tap filling a five hundred millilitre bottle.

**4:10 — Administrator oversight**
*(4:11)* Administrators start from the public website, and sign in to the console. Home shows what needs attention across every farm. They handle farmers' requests, see each zone's advice exactly as the farmer does, run the engine on demand, monitor every kit, follow up alerts and maintenance, and produce reports. Every administrator action is recorded.

**4:32 — System summary**
*(4:33)* Field sensing, weather, crop science, farmer decisions and irrigation history, turned into practical irrigation guidance. Sense. Understand. Act. Monitor.

**4:43 — Close**
*(4:44)* AgroFlow, by MafiHub. Practical irrigation decisions, grounded in field data.
