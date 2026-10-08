# Presenter script — AgroFlow Showcase Walkthrough

A conversational version of `narration-final.md` to read live over the video (with the video's own voice-over muted).
Same timecodes as the final narration. Short sentences; technical terms are explained the first time they come up.

- Total: **686 words**, about 4.6 min at a relaxed 150 wpm. Every section fits its window.
- Tips: wait for the picture before each line — most scenes give you half a second of lead-in. If you fall behind,
  drop the last clause of a section rather than speeding up; the admin tour (4:15–4:32) is the
  fastest picture, so don't try to name every page.
- Terms explained on first use: ESP32 (0:34), FAO-56 (0:21), relay (0:45), MQTT/server (0:58), depletion/“the tally” (1:49).

---
## 00:00.0 – 00:10.9

*On screen:* A field of crop rows and a drip line rises into view; the AgroFlow field kit stands on a post with its soil probe in the ground. The AgroFlow icon, “AGROFLOW” and “by MafiHub” appear, then the tagline and the UCT showcase line.

**Say:**  
This is AgroFlow, built by MafiHub. It helps farmers decide when and how much to irrigate, using data from the field, the weather and crop science.

Estimated duration: 10.9 s · Estimated words: 26 · Approximate speaking rate: 143 wpm

## 00:10.9 – 00:21.4

*On screen:* “Four questions a farmer has to answer”: When should I irrigate? How much water? How long should the pump run? Does the weather change the plan? Three amber chips follow: poor connectivity, scarce water, uneven fields.

**Say:**  
Every day, a farmer has four questions. When? How much? How long? And what about the weather? Bad signal, scarce water and uneven fields make it harder.

Estimated duration: 10.5 s · Estimated words: 27 · Approximate speaking rate: 154 wpm

## 00:21.4 – 00:34.3

*On screen:* “Rules-based irrigation decision support.” Five inputs (field sensor readings, weather forecast, crop & growth stage, soil & root zone, irrigation history) connect into a dark-green “FAO-56 water balance” box, which leads to “An irrigation decision a farmer can act on”. Then: “Deterministic: the same inputs always give the same answer. Not AI.”

**Say:**  
AgroFlow pulls together the sensors, the forecast, the crop, the soil and past watering. It uses FAO-56, the UN food agency's crop-water method. It's a calculation, not AI.

Estimated duration: 12.9 s · Estimated words: 28 · Approximate speaking rate: 130 wpm

## 00:34.3 – 00:45.2

*On screen:* “One kit per irrigation zone.” A labelled illustration: the closed enclosure on its post opens to show an ESP32 board, a blue relay module and a 5 V power block. Cables run through glands to the YL-69 probe in the soil and to a DHT11 sensor. Labels: Controller ESP32; Soil Moisture Sensor YL-69 resistive probe; Air DHT11.

**Say:**  
Every zone gets one of these kits. Inside is an ESP32, a small Wi-Fi computer, reading a soil moisture probe and a temperature and humidity sensor.

Estimated duration: 10.9 s · Estimated words: 26 · Approximate speaking rate: 143 wpm

## 00:45.2 – 00:58.3

*On screen:* The pump is added on the right with the label “Relay module → pump”; the relay's LED turns red. Three chips appear: Reports every 30 s; Any pump run stops at 5 min; Offline > 10 min: waters dry soil in ≤ 60 s bursts, 5 min rest.

**Say:**  
A relay switches the pump on and off. The kit reports every thirty seconds. For safety, no pump run lasts more than five minutes. And if it loses signal, it still waters dry soil in short bursts.

Estimated duration: 13.1 s · Estimated words: 37 · Approximate speaking rate: 169 wpm

## 00:58.3 – 01:14.5

*On screen:* “From the field to the farmer and the administrator.” Cards build left to right: ESP32 + sensors → MQTT over TLS (HiveMQ Cloud) → AgroFlow API (.NET, Railway) → Supabase Postgres; Open-Meteo above; AgroFlow app and Web console to the right; Telegram below.

**Say:**  
The readings go over a secure connection to our server, and into the database. The weather comes from Open-Meteo. Farmers use the app. Admins use a web console. Alerts go out on Telegram.

Estimated duration: 16.2 s · Estimated words: 33 · Approximate speaking rate: 122 wpm

## 01:14.5 – 01:21.5

*On screen:* A phone slides in showing the real AgroFlow Home screen: Green Valley (demo), 26 °C, and the “Today” section. Caption: “One clear action per irrigation zone.” The Tomato field card is highlighted.

**Say:**  
Here's the farmer's app. Home gives one clear action for each zone.

Estimated duration: 7.0 s · Estimated words: 12 · Approximate speaking rate: 103 wpm

## 01:21.5 – 01:29.7

*On screen:* A “WATER TODAY” panel builds: Tomato field · 50 m² · pump 25 L/min; Apply 35 mm; ≈ 70 min; 1,750 L; then the arithmetic 35 mm × 50 m² = 1,750 L and 1,750 L ÷ 25 L/min = 70 min.

**Say:**  
For the tomato field: water for about seventy minutes this morning. That's about seventeen hundred and fifty litres.

Estimated duration: 8.2 s · Estimated words: 18 · Approximate speaking rate: 132 wpm

## 01:29.7 – 01:36.0

*On screen:* A dark chip: “High confidence · sensor, setup and weather agree”. The phone switches to the next cards; the Spinach beds card is highlighted and a chip reads “Spinach beds · next watering Saturday”.

**Say:**  
The app is confident, because everything agrees. The spinach can wait until Saturday.

Estimated duration: 6.3 s · Estimated words: 13 · Approximate speaking rate: 124 wpm

## 01:36.0 – 01:49.7

*On screen:* “How the decision is worked out.” Rows appear: Weather → ETo 5.8 mm/day; Crop + growth stage (tomato, day 66 of ~145) → Kc 1.09; ETo × Kc → ETc 6.4 mm/day.

**Say:**  
So how does it decide? First, the weather tells us how thirsty the air is today. Then we adjust for the crop and how far it's grown. These tomatoes will use about six and a half millimetres today.

Estimated duration: 13.7 s · Estimated words: 38 · Approximate speaking rate: 166 wpm

## 01:49.7 – 02:00.5

*On screen:* Row: Soil + root zone → TAW 91 mm · RAW 31.5 mm. A root-zone gauge appears; a dashed red “watering point” line, then a brown fill rises to “Used up: 35 mm”. Row: Rain + irrigation − crop use → Dr 35 mm. Chip: “Dr 35 mm ≥ RAW 31.5 mm → irrigation needed”.

**Say:**  
The soil and roots set when the crop starts to struggle. We keep a daily tally of rain, watering and use. This field is past that point.

Estimated duration: 10.8 s · Estimated words: 27 · Approximate speaking rate: 150 wpm

## 02:00.5 – 02:08.7

*On screen:* The phone shows Home; a tap on “Why am I seeing this?” opens the real sheet, which scrolls through its facts. Left: What was used · Where each number came from · The rule · What would change it.

**Say:**  
Every piece of advice has a 'Why am I seeing this?' link. It shows what we used, and the rule.

Estimated duration: 8.2 s · Estimated words: 20 · Approximate speaking rate: 146 wpm

## 02:08.7 – 02:19.0

*On screen:* “Tomato field, today.” Six number cards (ETo 5.8, Kc 1.09, ETc 6.4, Dr 35 mm, RAW 31.5 mm, Rain 2 mm), the admin console's real technical line, then ticks: Dr 35 mm ≥ RAW 31.5 mm; Rain 2 mm < crop use 6.4 mm. Chip: “Water today”.

**Say:**  
In numbers: the soil is thirty-five millimetres down, past the limit of thirty-one and a half. Two millimetres of rain isn't enough. So, water today.

Estimated duration: 10.3 s · Estimated words: 25 · Approximate speaking rate: 146 wpm

## 02:19.0 – 02:28.0

*On screen:* Large heading: “AgroFlow recommends. The farmer decides.” Cards: AgroFlow suggested 1,750 L; The farmer applied 1,500 L. On the phone the farmer taps “I watered”, types 1500 litres and saves.

**Say:**  
And this is important. AgroFlow recommends. The farmer decides. Our farmer waters fifteen hundred litres instead, and logs it with 'I watered'.

Estimated duration: 9.0 s · Estimated words: 22 · Approximate speaking rate: 147 wpm

## 02:28.0 – 02:35.9

*On screen:* Card: “What actually happened is what counts. Depletion 35 mm − 30 mm applied = 5 mm. Today's advice now: No watering needed today.” The phone's Home card now reads “No watering needed today”, then the “How does the soil feel?” sheet. Chips list the real controls.

**Say:**  
The app counts what really happened: no more watering today. A hand check of the soil counts too.

Estimated duration: 7.9 s · Estimated words: 18 · Approximate speaking rate: 137 wpm

## 02:35.9 – 02:44.5

*On screen:* “Start a run from the app.” The phone shows Irrigation Control; 90 is typed, “Start Manual Run” tapped, and a dialog reads “Invalid Duration — Enter a duration between 1 and 60 minutes.” Card: INPUT VALIDATED.

**Say:**  
With a kit, the farmer can start the pump from the phone. Ninety minutes? Rejected. The limit is one to sixty.

Estimated duration: 8.6 s · Estimated words: 21 · Approximate speaking rate: 147 wpm

## 02:44.5 – 02:52.0

*On screen:* Card: CONFIRMED 5 minutes. A confirmation dialog appears, then the scene changes to “The command reaches the field”: Farmer app → AgroFlow API → MQTT → ESP32 (Relay ON) → Pump (Water flows); a packet travels along; “Pump off” switches to “Pump on · 5 min”.

**Say:**  
Five minutes is fine. It goes to our server, then to the kit, which starts the pump.

Estimated duration: 7.5 s · Estimated words: 17 · Approximate speaking rate: 136 wpm

## 02:52.0 – 02:56.4

*On screen:* The soil strip darkens as it wets; card: “Run reported by the kit: 5 min · about 125 L, estimated from the flow rate (there is no flow meter)”. The phone shows History. Chip: “Visualisation, sped up · the showcase kit ends any run at 5 min”.

**Say:**  
The kit reports back, and the run shows up in the history.

Estimated duration: 4.4 s · Estimated words: 12 · Approximate speaking rate: 164 wpm

## 02:56.4 – 03:01.8

*On screen:* “What is likely this week, not only today.” The phone shows the real “The week ahead” screen for Tomato field, with each day's line highlighted.

**Say:**  
AgroFlow also looks at the whole week ahead, day by day.

Estimated duration: 5.4 s · Estimated words: 11 · Approximate speaking rate: 122 wpm

## 03:01.8 – 03:09.0

*On screen:* A chart builds: “Rolling projection · root-zone depletion, day by day (mm)” – bars for Today (5) through Wed (43.7) with red dashed watering points; labels under each day.

**Say:**  
Under the hood, the tally just keeps going. Each day starts where the last one ended.

Estimated duration: 7.2 s · Estimated words: 16 · Approximate speaking rate: 133 wpm

## 03:09.0 – 03:15.5

*On screen:* The Tuesday bar turns red: “Irrigation likely”. Text: “The balance carries over: each morning the window moves on one day.” Chip: “Continuous daily water balance · no weekly reset”.

**Say:**  
So the tomatoes should need water again on Tuesday. And nothing resets at the end of the week.

Estimated duration: 6.5 s · Estimated words: 18 · Approximate speaking rate: 166 wpm

## 03:15.5 – 03:22.6

*On screen:* “The forecast changes. The plan recalculates.” The same chart; a blue banner “HEAVY RAIN EXPECTED · Saturday · 22 mm forecast”; the phone switches to the updated week with Saturday and Sunday rain highlighted; “RECALCULATING…” blinks.

**Say:**  
Now the weather changes. Twenty-two millimetres of rain is coming on Saturday. So AgroFlow runs the numbers again.

Estimated duration: 7.1 s · Estimated words: 18 · Approximate speaking rate: 152 wpm

## 03:22.6 – 03:27.2

*On screen:* The bars drop: Saturday and Sunday empty, later days low. Labels: “Rain covers it”, “Postponed”. Chip: “Plan updated · no irrigation now expected this week”.

**Say:**  
That rain fills the soil back up. No watering needed this week.

Estimated duration: 4.6 s · Estimated words: 12 · Approximate speaking rate: 157 wpm

## 03:27.2 – 03:37.9

*On screen:* Heading: Not “rain = skip”: is the rain enough to change the deficit? Four cards: Still water (Today 2 mm < 6.4 mm); Watering can wait (Saturday 22 mm); Smaller next amount (rain is credited); Watering moves earlier (next forecast update recalculates).

**Say:**  
But it's not just 'rain means skip'. A little rain? Still water. Enough rain? Wait. Some rain? Water less. And if the rain doesn't come, watering moves back.

Estimated duration: 10.7 s · Estimated words: 28 · Approximate speaking rate: 157 wpm

## 03:37.9 – 03:42.7

*On screen:* “Decision-relevant warnings, where farmers already are.” A Telegram-style card with AgroFlow's real heavy-rain text (Farm, When: Saturday (10 Oct), Expected rainfall: 22 mm) and a “Why am I seeing this?” button; the Why explanation appears beside it.

**Say:**  
Big weather warnings come through Telegram, with the same 'Why' button.

Estimated duration: 4.8 s · Estimated words: 11 · Approximate speaking rate: 138 wpm

## 03:42.7 – 03:50.5

*On screen:* “The sensor is a check, not the whole truth.” A field drawing with one probe circled: “one probe = one spot”. The real Home card “Check the kit: it has stopped sending readings” appears.

**Say:**  
The soil sensor only measures one spot. So we treat it as a check, not the final word.

Estimated duration: 7.8 s · Estimated words: 18 · Approximate speaking rate: 138 wpm

## 03:50.5 – 03:55.5

*On screen:* Four check cards: kit offline 3 h; sensor stuck 6 h; sensor drifting; pump ran but soil didn't get wetter. The phone shows the “How does the soil feel?” sheet.

**Say:**  
If a sensor fails, the app says so. A hand check counts too.

Estimated duration: 5.0 s · Estimated words: 13 · Approximate speaking rate: 156 wpm

## 03:55.5 – 04:04.0

*On screen:* “Advice is never blocked. What's missing is named.” The phone shows Home with the Maize block card highlighted; an enlarged card reads “Water about 900 L this morning”, Medium confidence, Finish setup. Cards: Still advises · About 900 L, in litres only; Confidence · Medium.

**Say:**  
What if setup isn't finished? The maize block has no pump flow rate yet. AgroFlow still gives advice, in litres.

Estimated duration: 8.5 s · Estimated words: 20 · Approximate speaking rate: 141 wpm

## 04:04.0 – 04:10.9

*On screen:* Card: One next step · Add the pump's flow rate to get watering times in minutes. Amber chip “Add flow rate to see runtime”. The phone shows Finish setup → Flow rate, with the 500 mL bottle helper.

**Say:**  
And it names one next step: time the tap filling a half-litre bottle.

Estimated duration: 6.9 s · Estimated words: 13 · Approximate speaking rate: 113 wpm

## 04:10.9 – 04:15.6

*On screen:* “One console for every farm, zone and kit.” A browser frame shows the public AgroFlow website (slow push-in). Label: Public website · how it works · Admin login.

**Say:**  
Now the admin side. It starts from our public website.

Estimated duration: 4.7 s · Estimated words: 10 · Approximate speaking rate: 128 wpm

## 04:15.6 – 04:23.5

*On screen:* Admin Home (“what needs attention today”, highlighted), Requests from farmers, then Farm detail with each zone's Today advice highlighted.

**Say:**  
The admin home shows what needs attention. Farmer requests come in here. And each zone shows exactly what the farmer sees.

Estimated duration: 7.9 s · Estimated words: 21 · Approximate speaking rate: 159 wpm

## 04:23.5 – 04:32.7

*On screen:* Run advice now (engine drawer highlighted), Kits, Alerts, Maintenance, Reports, Activity – each for about a second; labels change with each page.

**Say:**  
Admins can run the engine on the spot, watch the kits, follow up alerts and maintenance, and make reports. Everything they do is logged.

Estimated duration: 9.2 s · Estimated words: 24 · Approximate speaking rate: 157 wpm

## 04:32.7 – 04:43.4

*On screen:* “From the field to a decision, and back.” Field sensing + Weather + Crop science + Farmer decisions + Irrigation history → “Actionable irrigation guidance” → SENSE → UNDERSTAND → ACT → MONITOR.

**Say:**  
So: sensors, weather, crop science, the farmer's choices and the history, all turned into clear advice. Sense. Understand. Act. Monitor.

Estimated duration: 10.7 s · Estimated words: 20 · Approximate speaking rate: 112 wpm

## 04:43.4 – 04:53.2

*On screen:* End card: AgroFlow icon, AGROFLOW, by MafiHub, “Practical irrigation decisions, grounded in field data.”, University of Cape Town · School of IT Showcase 2026, INF3003W · Team 2.

**Say:**  
That's AgroFlow, by MafiHub. Practical irrigation decisions, grounded in field data. Thank you.

Estimated duration: 9.8 s · Estimated words: 13 · Approximate speaking rate: 80 wpm
