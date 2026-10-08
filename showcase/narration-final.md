# Final narration — AgroFlow Showcase Walkthrough

Written against the rendered video `renders/AgroFlow_Showcase_Walkthrough_Final.mp4` (4:53.24, 1920×1080, 25 fps, 7,331 frames),
not against the storyboard. Each section is timed to what is on screen in that window (see `video-frame-analysis.md`).

- Total: **679 spoken words** over 4:53 → about **139 wpm** averaged over the whole video; every section is at or below ~160 wpm.
- Estimated speaking time at 150 wpm: **4.5 min** (4:31); the rest is breathing room between scenes.
- Word counts treat a four-digit number (1,750) as four spoken words.
- Wording rules: “Soil Moisture Sensor” / “YL-69 resistive soil moisture probe”; field and irrigation-zone language;
  no AI claim; the sensor is a *local signal*, not a measurement of the whole root zone.
- The video's own voice-over (in the render) is the older script in `narration.md`, at ~171 wpm. This script is the
  recommended replacement; it fits the same picture without changing the render.

---
## 00:00.0 – 00:10.9

**Visual:**  
A field of crop rows and a drip line rises into view; the AgroFlow field kit stands on a post with its soil probe in the ground. The AgroFlow icon, “AGROFLOW” and “by MafiHub” appear, then the tagline and the UCT showcase line.

**Voice-over:**  
“This is AgroFlow, by MafiHub. It helps farmers make better irrigation decisions from field data, weather and crop science.”

Estimated duration: 10.9 s · Estimated words: 19 · Approximate speaking rate: 105 wpm

## 00:10.9 – 00:21.4

**Visual:**  
“Four questions a farmer has to answer”: When should I irrigate? How much water? How long should the pump run? Does the weather change the plan? Three amber chips follow: poor connectivity, scarce water, uneven fields.

**Voice-over:**  
“A farmer must decide when to irrigate, how much, for how long, and whether the weather changes that. Poor signal, scarce water and uneven fields make it harder.”

Estimated duration: 10.5 s · Estimated words: 28 · Approximate speaking rate: 160 wpm

## 00:21.4 – 00:34.3

**Visual:**  
“Rules-based irrigation decision support.” Five inputs (field sensor readings, weather forecast, crop & growth stage, soil & root zone, irrigation history) connect into a dark-green “FAO-56 water balance” box, which leads to “An irrigation decision a farmer can act on”. Then: “Deterministic: the same inputs always give the same answer. Not AI.”

**Voice-over:**  
“AgroFlow combines sensor readings, the forecast, the crop, the soil and the irrigation history, using the FAO-56 crop-water method. Same inputs, same answer: it's a calculation, not AI.”

Estimated duration: 12.9 s · Estimated words: 28 · Approximate speaking rate: 130 wpm

## 00:34.3 – 00:45.2

**Visual:**  
“One kit per irrigation zone.” A labelled illustration: the closed enclosure on its post opens to show an ESP32 board, a blue relay module and a 5 V power block. Cables run through glands to the YL-69 probe in the soil and to a DHT11 sensor. Labels: Controller ESP32; Soil Moisture Sensor YL-69 resistive probe; Air DHT11.

**Voice-over:**  
“Each irrigation zone has a field kit. Inside the enclosure, an ESP32 controller reads a YL-69 resistive Soil Moisture Sensor and a DHT11 temperature and humidity sensor.”

Estimated duration: 10.9 s · Estimated words: 27 · Approximate speaking rate: 149 wpm

## 00:45.2 – 00:58.3

**Visual:**  
The pump is added on the right with the label “Relay module → pump”; the relay's LED turns red. Three chips appear: Reports every 30 s; Any pump run stops at 5 min; Offline > 10 min: waters dry soil in ≤ 60 s bursts, 5 min rest.

**Voice-over:**  
“A relay switches the pump. The kit reports every thirty seconds, stops any single run after five minutes, and if its connection drops, it waters dry soil in short, rested bursts.”

Estimated duration: 13.1 s · Estimated words: 31 · Approximate speaking rate: 142 wpm

## 00:58.3 – 01:14.5

**Visual:**  
“From the field to the farmer and the administrator.” Cards build left to right: ESP32 + sensors → MQTT over TLS (HiveMQ Cloud) → AgroFlow API (.NET, Railway) → Supabase Postgres; Open-Meteo above; AgroFlow app and Web console to the right; Telegram below.

**Voice-over:**  
“Readings travel over secure MQTT to the AgroFlow API and into a Supabase Postgres database. Open-Meteo provides the forecast. Farmers use the mobile app, administrators use a web console, and alerts go out on Telegram.”

Estimated duration: 16.2 s · Estimated words: 35 · Approximate speaking rate: 130 wpm

## 01:14.5 – 01:21.5

**Visual:**  
A phone slides in showing the real AgroFlow Home screen: Green Valley (demo), 26 °C, and the “Today” section. Caption: “One clear action per irrigation zone.” The Tomato field card is highlighted.

**Voice-over:**  
“On the farmer's phone, Home gives one clear action for each irrigation zone.”

Estimated duration: 7.0 s · Estimated words: 13 · Approximate speaking rate: 111 wpm

## 01:21.5 – 01:29.7

**Visual:**  
A “WATER TODAY” panel builds: Tomato field · 50 m² · pump 25 L/min; Apply 35 mm; ≈ 70 min; 1,750 L; then the arithmetic 35 mm × 50 m² = 1,750 L and 1,750 L ÷ 25 L/min = 70 min.

**Voice-over:**  
“For the tomato field: water about seventy minutes this morning, roughly seventeen hundred and fifty litres, or thirty-five millimetres of water.”

Estimated duration: 8.2 s · Estimated words: 21 · Approximate speaking rate: 154 wpm

## 01:29.7 – 01:36.0

**Visual:**  
A dark chip: “High confidence · sensor, setup and weather agree”. The phone switches to the next cards; the Spinach beds card is highlighted and a chip reads “Spinach beds · next watering Saturday”.

**Voice-over:**  
“Confidence is high: sensor, setup and weather agree. The spinach beds can wait until Saturday.”

Estimated duration: 6.3 s · Estimated words: 15 · Approximate speaking rate: 143 wpm

## 01:36.0 – 01:49.7

**Visual:**  
“How the decision is worked out.” Rows appear: Weather → ETo 5.8 mm/day; Crop + growth stage (tomato, day 66 of ~145) → Kc 1.09; ETo × Kc → ETc 6.4 mm/day.

**Voice-over:**  
“AgroFlow estimates how much water the weather is drawing, five point eight millimetres today. It adjusts that for the crop and its growth stage, so these tomatoes use about six point four.”

Estimated duration: 13.7 s · Estimated words: 32 · Approximate speaking rate: 140 wpm

## 01:49.7 – 02:00.5

**Visual:**  
Row: Soil + root zone → TAW 91 mm · RAW 31.5 mm. A root-zone gauge appears; a dashed red “watering point” line, then a brown fill rises to “Used up: 35 mm”. Row: Rain + irrigation − crop use → Dr 35 mm. Chip: “Dr 35 mm ≥ RAW 31.5 mm → irrigation needed”.

**Voice-over:**  
“Soil and root depth set when the crop starts to struggle. A daily tally of rain, irrigation and use puts this field past that point.”

Estimated duration: 10.8 s · Estimated words: 25 · Approximate speaking rate: 139 wpm

## 02:00.5 – 02:08.7

**Visual:**  
The phone shows Home; a tap on “Why am I seeing this?” opens the real sheet, which scrolls through its facts. Left: What was used · Where each number came from · The rule · What would change it.

**Voice-over:**  
“Each recommendation has a 'Why am I seeing this?' link: the inputs, their sources, the rule, and what would change it.”

Estimated duration: 8.2 s · Estimated words: 21 · Approximate speaking rate: 154 wpm

## 02:08.7 – 02:19.0

**Visual:**  
“Tomato field, today.” Six number cards (ETo 5.8, Kc 1.09, ETc 6.4, Dr 35 mm, RAW 31.5 mm, Rain 2 mm), the admin console's real technical line, then ticks: Dr 35 mm ≥ RAW 31.5 mm; Rain 2 mm < crop use 6.4 mm. Chip: “Water today”.

**Voice-over:**  
“Here, thirty-five millimetres have been used, past the thirty-one and a half millimetre threshold, and two millimetres of rain won't cover the day's use. So: water today.”

Estimated duration: 10.3 s · Estimated words: 27 · Approximate speaking rate: 157 wpm

## 02:19.0 – 02:28.0

**Visual:**  
Large heading: “AgroFlow recommends. The farmer decides.” Cards: AgroFlow suggested 1,750 L; The farmer applied 1,500 L. On the phone the farmer taps “I watered”, types 1500 litres and saves.

**Voice-over:**  
“AgroFlow recommends. The farmer decides. Here, the farmer applies fifteen hundred litres instead, and records it with 'I watered'.”

Estimated duration: 9.0 s · Estimated words: 19 · Approximate speaking rate: 127 wpm

## 02:28.0 – 02:35.9

**Visual:**  
Card: “What actually happened is what counts. Depletion 35 mm − 30 mm applied = 5 mm. Today's advice now: No watering needed today.” The phone's Home card now reads “No watering needed today”, then the “How does the soil feel?” sheet. Chips list the real controls.

**Voice-over:**  
“AgroFlow counts what actually happened: no watering needed today. A soil check by hand can correct the estimate too.”

Estimated duration: 7.9 s · Estimated words: 19 · Approximate speaking rate: 144 wpm

## 02:35.9 – 02:44.5

**Visual:**  
“Start a run from the app.” The phone shows Irrigation Control; 90 is typed, “Start Manual Run” tapped, and a dialog reads “Invalid Duration — Enter a duration between 1 and 60 minutes.” Card: INPUT VALIDATED.

**Voice-over:**  
“Where a kit controls the pump, a run can start from the app. Ninety minutes is rejected: the limit is one to sixty.”

Estimated duration: 8.6 s · Estimated words: 23 · Approximate speaking rate: 160 wpm

## 02:44.5 – 02:52.0

**Visual:**  
Card: CONFIRMED 5 minutes. A confirmation dialog appears, then the scene changes to “The command reaches the field”: Farmer app → AgroFlow API → MQTT → ESP32 (Relay ON) → Pump (Water flows); a packet travels along; “Pump off” switches to “Pump on · 5 min”.

**Voice-over:**  
“Five minutes is confirmed and sent, via the API and MQTT, to the ESP32, which starts the pump.”

Estimated duration: 7.5 s · Estimated words: 18 · Approximate speaking rate: 144 wpm

## 02:52.0 – 02:56.4

**Visual:**  
The soil strip darkens as it wets; card: “Run reported by the kit: 5 min · about 125 L, estimated from the flow rate (there is no flow meter)”. The phone shows History. Chip: “Visualisation, sped up · the showcase kit ends any run at 5 min”.

**Voice-over:**  
“The kit reports the run, and it appears in the history.”

Estimated duration: 4.4 s · Estimated words: 11 · Approximate speaking rate: 150 wpm

## 02:56.4 – 03:01.8

**Visual:**  
“What is likely this week, not only today.” The phone shows the real “The week ahead” screen for Tomato field, with each day's line highlighted.

**Voice-over:**  
“AgroFlow also looks ahead: the week-ahead screen says what each day means for watering.”

Estimated duration: 5.4 s · Estimated words: 14 · Approximate speaking rate: 156 wpm

## 03:01.8 – 03:09.0

**Visual:**  
A chart builds: “Rolling projection · root-zone depletion, day by day (mm)” – bars for Today (5) through Wed (43.7) with red dashed watering points; labels under each day.

**Voice-over:**  
“Underneath, the water balance carries on day by day: each day's ending state is the next day's starting point.”

Estimated duration: 7.2 s · Estimated words: 19 · Approximate speaking rate: 158 wpm

## 03:09.0 – 03:15.5

**Visual:**  
The Tuesday bar turns red: “Irrigation likely”. Text: “The balance carries over: each morning the window moves on one day.” Chip: “Continuous daily water balance · no weekly reset”.

**Voice-over:**  
“So the tomatoes next need water on Tuesday. The window rolls forward; nothing resets weekly.”

Estimated duration: 6.5 s · Estimated words: 15 · Approximate speaking rate: 138 wpm

## 03:15.5 – 03:22.6

**Visual:**  
“The forecast changes. The plan recalculates.” The same chart; a blue banner “HEAVY RAIN EXPECTED · Saturday · 22 mm forecast”; the phone switches to the updated week with Saturday and Sunday rain highlighted; “RECALCULATING…” blinks.

**Voice-over:**  
“Then the forecast changes: twenty-two millimetres of rain is now expected on Saturday, so AgroFlow recalculates the balance.”

Estimated duration: 7.1 s · Estimated words: 18 · Approximate speaking rate: 152 wpm

## 03:22.6 – 03:27.2

**Visual:**  
The bars drop: Saturday and Sunday empty, later days low. Labels: “Rain covers it”, “Postponed”. Chip: “Plan updated · no irrigation now expected this week”.

**Voice-over:**  
“The rain refills the root zone: no irrigation expected this week.”

Estimated duration: 4.6 s · Estimated words: 11 · Approximate speaking rate: 143 wpm

## 03:27.2 – 03:37.9

**Visual:**  
Heading: Not “rain = skip”: is the rain enough to change the deficit? Four cards: Still water (Today 2 mm < 6.4 mm); Watering can wait (Saturday 22 mm); Smaller next amount (rain is credited); Watering moves earlier (next forecast update recalculates).

**Voice-over:**  
“It isn't 'rain means skip'. Too little rain: still water. Enough rain: it waits. Some rain: a smaller amount. And if the rain fades, watering moves back.”

Estimated duration: 10.7 s · Estimated words: 27 · Approximate speaking rate: 151 wpm

## 03:37.9 – 03:42.7

**Visual:**  
“Decision-relevant warnings, where farmers already are.” A Telegram-style card with AgroFlow's real heavy-rain text (Farm, When: Saturday (10 Oct), Expected rainfall: 22 mm) and a “Why am I seeing this?” button; the Why explanation appears beside it.

**Voice-over:**  
“Heavy-rain warnings arrive on Telegram, with the same 'Why' button.”

Estimated duration: 4.8 s · Estimated words: 10 · Approximate speaking rate: 125 wpm

## 03:42.7 – 03:50.5

**Visual:**  
“The sensor is a check, not the whole truth.” A field drawing with one probe circled: “one probe = one spot”. The real Home card “Check the kit: it has stopped sending readings” appears.

**Voice-over:**  
“The soil sensor gives a local signal from one spot, so AgroFlow treats it as a check, not the whole truth.”

Estimated duration: 7.8 s · Estimated words: 21 · Approximate speaking rate: 162 wpm

## 03:50.5 – 03:55.5

**Visual:**  
Four check cards: kit offline 3 h; sensor stuck 6 h; sensor drifting; pump ran but soil didn't get wetter. The phone shows the “How does the soil feel?” sheet.

**Voice-over:**  
“Faulty sensors raise warnings; a farmer's own soil check can correct the estimate.”

Estimated duration: 5.0 s · Estimated words: 13 · Approximate speaking rate: 156 wpm

## 03:55.5 – 04:04.0

**Visual:**  
“Advice is never blocked. What's missing is named.” The phone shows Home with the Maize block card highlighted; an enlarged card reads “Water about 900 L this morning”, Medium confidence, Finish setup. Cards: Still advises · About 900 L, in litres only; Confidence · Medium.

**Voice-over:**  
“When setup is incomplete, AgroFlow still advises. The maize block has no flow rate, so its advice is in litres only.”

Estimated duration: 8.5 s · Estimated words: 21 · Approximate speaking rate: 148 wpm

## 04:04.0 – 04:10.9

**Visual:**  
Card: One next step · Add the pump's flow rate to get watering times in minutes. Amber chip “Add flow rate to see runtime”. The phone shows Finish setup → Flow rate, with the 500 mL bottle helper.

**Voice-over:**  
“It's marked medium confidence, with one next step: time the tap filling a half-litre bottle.”

Estimated duration: 6.9 s · Estimated words: 15 · Approximate speaking rate: 130 wpm

## 04:10.9 – 04:15.6

**Visual:**  
“One console for every farm, zone and kit.” A browser frame shows the public AgroFlow website (slow push-in). Label: Public website · how it works · Admin login.

**Voice-over:**  
“Administrators start from the public website and sign in to the console.”

Estimated duration: 4.7 s · Estimated words: 12 · Approximate speaking rate: 153 wpm

## 04:15.6 – 04:23.5

**Visual:**  
Admin Home (“what needs attention today”, highlighted), Requests from farmers, then Farm detail with each zone's Today advice highlighted.

**Voice-over:**  
“Home lists what needs attention. Farmers' requests come in here, and each zone shows the same advice the farmer sees.”

Estimated duration: 7.9 s · Estimated words: 20 · Approximate speaking rate: 152 wpm

## 04:23.5 – 04:32.7

**Visual:**  
Run advice now (engine drawer highlighted), Kits, Alerts, Maintenance, Reports, Activity – each for about a second; labels change with each page.

**Voice-over:**  
“They can run the engine on demand, monitor kits, follow up alerts and maintenance, produce reports, and every administrator action is recorded.”

Estimated duration: 9.2 s · Estimated words: 22 · Approximate speaking rate: 143 wpm

## 04:32.7 – 04:43.4

**Visual:**  
“From the field to a decision, and back.” Field sensing + Weather + Crop science + Farmer decisions + Irrigation history → “Actionable irrigation guidance” → SENSE → UNDERSTAND → ACT → MONITOR.

**Voice-over:**  
“Field sensing, weather, crop science, farmer decisions and irrigation history, combined into practical irrigation guidance. Sense. Understand. Act. Monitor.”

Estimated duration: 10.7 s · Estimated words: 19 · Approximate speaking rate: 107 wpm

## 04:43.4 – 04:53.2

**Visual:**  
End card: AgroFlow icon, AGROFLOW, by MafiHub, “Practical irrigation decisions, grounded in field data.”, University of Cape Town · School of IT Showcase 2026, INF3003W · Team 2.

**Voice-over:**  
“AgroFlow, by MafiHub. Practical irrigation decisions, grounded in field data.”

Estimated duration: 9.8 s · Estimated words: 10 · Approximate speaking rate: 61 wpm
