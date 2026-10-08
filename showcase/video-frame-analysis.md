# AgroFlow Showcase Walkthrough — rendered video analysis

**Source of truth:** `showcase/renders/AgroFlow_Showcase_Walkthrough_Final.mp4` (the rendered MP4, not the storyboard).

| Property | Value |
|---|---|
| File | `showcase/renders/AgroFlow_Showcase_Walkthrough_Final.mp4` (54.95 MB, rendered 2026-10-08 14:59 UTC, commit `6ccd555`) |
| Same content, 4K | `showcase/renders/AgroFlow_Showcase_Walkthrough_Final_4K.mp4` (3840×2160, re-encoded from the 4K render, 7,331 frames) |
| Duration | 4:53.240 (293.240 s) |
| Resolution | 1920 × 1080 |
| Frame rate | 25 fps (constant) |
| Frames | 7,331 (counted with ffprobe `-count_frames`) |
| Video / audio | H.264 / AAC 48 kHz stereo, −14.9 LUFS integrated |
| Black frames | none (ffmpeg `blackdetect`, d ≥ 0.2 s) |

**How this was reviewed.** One frame per second was extracted for the whole video (293 frames) and inspected as contact
sheets; ffmpeg scene detection marked hard cuts (10.88, 34.36, 92.08, 120.48, 123.20, 138.96 … 272.68 s); key moments
were re-extracted at full resolution and zoomed (e.g. History at 2:54, the field at 2:55, admin at 4:21); speech
on/off times were measured from the audio with `silencedetect`. Animation start times inside a shot were read from
the frames and cross-checked against the composition timings; they are accurate to about ±0.1 s.

**Speech actually in the render** (current voice-over, `narration.md`, Kokoro TTS): starts at 3.40, 11.31, 34.74, 58.69,
74.87, 96.37, 120.88, 139.36, 156.34, 176.75, 195.90, 218.30, 235.91, 251.26, 273.11, 284.63 s; silence between
lines is 1.4–1.7 s; final silence from 290.03 s. Its rate is ≈171 wpm (755 words over 264 s of speech) — faster than
the 130–160 wpm target. `narration-final.md` is the slower replacement written for this picture.

**Conventions.** “Tag” = the small pill at bottom-left that labels a shot as real UI, conceptual or illustration.
“Highlight” = the teal-outlined spotlight that dims the rest of the phone or page. Every scene change is a short
dip to the off-white background (≈0.5 s fade-out, then the next scene fades in).

---

## 00:00.000 – 00:01.100

*Segment 1*

### What is visible
Off-white background with a faint dot grid. A curved brown field with four rows of green crop dots rises from the bottom. Nothing else yet.

### What changes
The field slides up and fades in (≈1.4 s ease-out). The AgroFlow icon starts fading/scaling in at the top at ~0.6 s.

### On-screen text
None.

### What the viewer should understand
We are on a farm: the product starts in the field.

### Narration needed
(silence / music bed; first words at ~0.4 s in the final narration)

### Issues / observations
First 0.6 s is an almost empty field; acceptable as a lead-in.

## 00:01.100 – 00:04.900

*Segment 2*

### What is visible
AgroFlow icon (top centre), wordmark AGROFLOW, “by MafiHub” in teal. Field with crop rows; a teal drip line draws across the field; on the right a small grey field-kit enclosure stands on a post with a cable to a two-pin probe in the soil.

### What changes
Wordmark rises in (1.1–1.9 s), “by MafiHub” at 1.8 s. Drip line draws left→right (0.6–2.4 s) and a pale dashed ‘water’ pattern then flows along it continuously. Kit fades up at 1.0 s.

### On-screen text
AGROFLOW · BY MAFIHUB

### What the viewer should understand
Brand: AgroFlow, made by MafiHub; a sensor kit and drip irrigation in a field.

### Narration needed
“This is AgroFlow, by MafiHub.”

### Issues / observations
The kit is drawn small (≈80×100 px) in the far right; a viewer may not notice it is ‘the controller’. The drip line and crop rows read as dotted lines rather than plants.

## 00:04.900 – 00:10.350

*Segment 3*

### What is visible
Same as above plus the tagline under the wordmark and, from 6.2 s, a grey line “UCT School of IT Showcase 2026 · INF3003W · Team 2”.

### What changes
Tagline fades/rises in at 4.9 s; showcase line fades in at 6.2 s. Water dashes keep moving along the drip line.

### On-screen text
Smarter irrigation decisions from field data, weather and crop science. · UCT School of IT Showcase 2026 · INF3003W · Team 2

### What the viewer should understand
What AgroFlow does in one sentence, and the event context.

### Narration needed
“It helps farmers make better irrigation decisions from field data, weather and crop science.”

### Issues / observations
Static for ~4 s after the tagline; fine for a title.

## 00:10.350 – 00:10.910

*Segment 4*

### What is visible
Whole title layer fading to the plain background.

### What changes
0.5 s fade-out to background (dip-to-white style transition).

### On-screen text
—

### What the viewer should understand
Scene break.

### Narration needed
—

### Issues / observations
Brief blank background between scenes; this ‘dip’ recurs at every scene change (~0.5–1 s).

## 00:10.910 – 00:13.510

*Segment 5*

### What is visible
Caption top-left “THE DECISION, EVERY DAY / Four questions a farmer has to answer.” First white question card: “WHEN — When should I irrigate?”. Bottom-left tag “● CONCEPTUAL VISUALISATION”.

### What changes
Caption slides in from the left (11.1 s); card 1 rises in at 11.4 s.

### On-screen text
THE DECISION, EVERY DAY · Four questions a farmer has to answer. · When should I irrigate?

### What the viewer should understand
Irrigation is a daily decision.

### Narration needed
“A farmer must decide when to irrigate,”

### Issues / observations
None.

## 00:13.510 – 00:17.410

*Segment 6*

### What is visible
Four question cards in a row: When / How much water should go on? / How long should the pump run? / Does the weather change the plan?

### What changes
Cards 2–4 rise in at 13.5 s, 14.2 s and 15.0 s.

### On-screen text
How much water should go on? · How long should the pump run? · Does the weather change the plan?

### What the viewer should understand
The four sub-decisions AgroFlow answers: timing, amount, runtime, weather.

### Narration needed
“how much, for how long, and whether the weather changes that.”

### Issues / observations
Cards 2–4 arrive within 1.5 s; fine visually, but narration has to be brisk to keep up.

## 00:17.410 – 00:20.910

*Segment 7*

### What is visible
Below the cards, three small amber chips appear in turn.

### What changes
Chips pop up at 17.4, 18.5 and 19.3 s.

### On-screen text
POOR CONNECTIVITY · SCARCE WATER · UNEVEN FIELDS

### What the viewer should understand
Why the decision is hard in South African smallholder conditions.

### Narration needed
“Poor signal, scarce water and uneven fields make it harder.”

### Issues / observations
Chips are small (≈17 px caps) relative to the empty lower half of the frame.

## 00:20.910 – 00:24.410

*Segment 8*

### What is visible
Problem cards fade out; new caption “AGROFLOW / Rules-based irrigation decision support.” on an otherwise empty frame.

### What changes
0.5 s fade of the cards (20.9–21.4 s); new caption slides in at 21.4 s.

### On-screen text
AGROFLOW · Rules-based irrigation decision support.

### What the viewer should understand
Introduces AgroFlow as decision support.

### Narration needed
“AgroFlow combines sensor readings,”

### Issues / observations
≈3 s of a heading over an empty frame before anything else appears — feels like a pause.

## 00:24.410 – 00:28.110

*Segment 9*

### What is visible
Five input cards stack down the left: Field sensor readings · Weather forecast · Crop & growth stage · Soil & root zone · Irrigation history (each with a coloured dot).

### What changes
Cards slide in from the left at 24.4, 25.9, 26.5, 26.9, 27.5 s.

### On-screen text
Field sensor readings · Weather forecast · Crop & growth stage · Soil & root zone · Irrigation history

### What the viewer should understand
The five inputs the engine uses.

### Narration needed
“the forecast, the crop, the soil and the irrigation history,”

### Issues / observations
None.

## 00:28.110 – 00:31.210

*Segment 10*

### What is visible
Curved connector lines from the five inputs into a dark-green box “CROP WATER METHOD / FAO-56 water balance / A published, peer-reviewed calculation”; a line on to a white card “OUTPUT / An irrigation decision a farmer can act on”.

### What changes
Lines draw in sequence (28.1 s), engine box scales up (28.5 s), output card slides in (29.7 s).

### On-screen text
FAO-56 water balance · A published, peer-reviewed calculation · An irrigation decision a farmer can act on

### What the viewer should understand
Inputs → FAO-56 → actionable decision.

### Narration needed
“using the FAO-56 crop-water method.”

### Issues / observations
“peer-reviewed” is a stretch: FAO-56 is an FAO guideline (Irrigation and Drainage Paper 56), widely used and cited, not a peer-reviewed article. Suggest “an internationally used FAO method”.

## 00:31.210 – 00:34.340

*Segment 11*

### What is visible
Text under the diagram: “Deterministic: the same inputs always give the same answer. Not AI.” Then everything fades.

### What changes
Text rises in at 31.2 s; scene fades 33.8–34.3 s.

### On-screen text
Deterministic: the same inputs always give the same answer. Not AI.

### What the viewer should understand
No AI overclaim: it is a repeatable calculation.

### Narration needed
“Same inputs, same answer: it's a calculation, not AI.”

### Issues / observations
None.

## 00:34.340 – 00:36.540

*Segment 12*

### What is visible
Caption “SENSING · THE FIELD KIT / One kit per irrigation zone.” and grey note “Illustration of the kit's real components, drawn from the firmware's wiring. Not a photograph.” A brown ground strip with grass edge, a grey post, and a closed light-grey enclosure with the AgroFlow logo and four corner screws on the post. Tag “● ILLUSTRATION · NOT A PHOTOGRAPH”.

### What changes
Enclosure rises/fades in (34.6–35.4 s); caption and note fade in.

### On-screen text
SENSING · THE FIELD KIT · One kit per irrigation zone. · Illustration … Not a photograph.

### What the viewer should understand
This is the physical controller that lives in each irrigation zone.

### Narration needed
“Each irrigation zone has a field kit.”

### Issues / observations
This is a flat 2D vector drawing, not a realistic 3D controller (none exists in the repo). The enclosure is mid-left and fairly small; the right 40% of the frame is empty until labels arrive.

## 00:36.540 – 00:38.940

*Segment 13*

### What is visible
The lid lifts away revealing internals: a dark-blue ESP32 dev board with a silver shield labelled ESP32, a blue relay module labelled RELAY with a green terminal, and a grey “5 V POWER · USB / supply” block, with coloured wires to three cable glands on the underside. A label card on the right: “CONTROLLER / ESP32 / Wi-Fi · reports every 30 s”.

### What changes
Lid slides up and fades (36.5–37.7 s) — closed → open. ESP32 label card slides in from the right at 37.1 s.

### On-screen text
CONTROLLER · ESP32 · Wi-Fi · reports every 30 s

### What the viewer should understand
What is inside the controller.

### Narration needed
“Inside the enclosure, an ESP32 controller”

### Issues / observations
The lid travels upward off the top of the box rather than hinging; reads as ‘removed’, which is fine.

## 00:38.940 – 00:41.940

*Segment 14*

### What is visible
A black cable drops from a gland to a two-pronged probe in the soil. Label: “SOIL MOISTURE SENSOR / YL-69 resistive probe / analogue input · GPIO 32”.

### What changes
Cable draws (38.9–39.7 s); probe fades in; label slides in at 39.1 s.

### On-screen text
SOIL MOISTURE SENSOR · YL-69 resistive probe · analogue input · GPIO 32

### What the viewer should understand
The Soil Moisture Sensor is a YL-69 resistive probe.

### Narration needed
“reads a YL-69 resistive Soil Moisture Sensor”

### Issues / observations
Correct terminology (resistive, not capacitive).

## 00:41.940 – 00:44.940

*Segment 15*

### What is visible
A purple cable runs left to a small blue vented DHT11 sensor on a mount. Label: “AIR / DHT11 temperature & humidity / GPIO 27”.

### What changes
Cable draws and DHT11 fades in (41.9–42.8 s); label at 42.1 s.

### On-screen text
AIR · DHT11 temperature & humidity · GPIO 27

### What the viewer should understand
The kit also measures air temperature and humidity.

### Narration needed
“and a DHT11 temperature and humidity sensor.”

### Issues / observations
None.

## 00:44.940 – 00:47.340

*Segment 16*

### What is visible
A teal cable runs right to a white box labelled PUMP with an outlet pipe. Label: “IRRIGATION OUTPUT / Relay module → pump / GPIO 25”. The relay's small LED turns red.

### What changes
Cable draws, pump fades in (44.9–45.8 s); LED changes colour at 45.9 s.

### On-screen text
IRRIGATION OUTPUT · Relay module → pump · GPIO 25

### What the viewer should understand
The relay is how the kit switches irrigation on and off.

### Narration needed
“A relay switches the pump.”

### Issues / observations
The red LED is a nice detail but tiny; most viewers won't see it.

## 00:47.340 – 00:57.740

*Segment 17*

### What is visible
Full kit illustration with all four labels. Three green chips appear under the ground strip in turn.

### What changes
Chips fade up at 47.3, 49.4 and 52.6 s; then a 5 s hold.

### On-screen text
REPORTS EVERY 30 S · ANY PUMP RUN STOPS AT 5 MIN · OFFLINE > 10 MIN: WATERS DRY SOIL IN ≤ 60 S BURSTS, 5 MIN REST

### What the viewer should understand
Firmware behaviour: reporting cadence and safety rules.

### Narration needed
“The kit reports every thirty seconds, stops any single run after five minutes, and if its connection drops, it waters dry soil in short, rested bursts.”

### Issues / observations
Third chip is long and small (~17 px); hard to read in one pass. ~5 s static hold at the end of the scene.

## 00:57.740 – 00:58.290

*Segment 18*

### What is visible
Scene fades out.

### What changes
0.5 s fade.

### On-screen text
—

### What the viewer should understand
Scene break.

### Narration needed
—

### Issues / observations
None.

## 00:58.290 – 01:02.690

*Segment 19*

### What is visible
Caption “HOW IT CONNECTS / From the field to the farmer and the administrator.” Cards appear left→right mid-frame: “FIELD KIT / ESP32 + sensors / one per irrigation zone” → “CONNECTION / MQTT over TLS / HiveMQ Cloud broker” → “SERVICE / AgroFlow API / .NET · hosted on Railway”, joined by short lines. Tag “● CONCEPTUAL VISUALISATION”.

### What changes
Each card rises in (58.7, 59.6, 60.9 s); connector lines draw between them.

### On-screen text
ESP32 + sensors · MQTT over TLS · HiveMQ Cloud broker · AgroFlow API · .NET · hosted on Railway

### What the viewer should understand
Readings leave the field over a secure connection to AgroFlow's service.

### Narration needed
“Readings travel over secure MQTT to the AgroFlow API”

### Issues / observations
None.

## 01:02.690 – 01:05.290

*Segment 20*

### What is visible
Fourth card “DATABASE / Supabase Postgres / per-farm access rules”. Small green dots (readings) travel along the line from the kit to the database.

### What changes
Card at 62.7 s; three packets slide left→right 63.5–68.9 s.

### On-screen text
Supabase Postgres · per-farm access rules

### What the viewer should understand
Data is stored per farm.

### Narration needed
“and into a Supabase Postgres database.”

### Issues / observations
Packets are small (9 px radius) and easy to miss.

## 01:05.290 – 01:07.590

*Segment 21*

### What is visible
Card above the API: “WEATHER / Open-Meteo / forecast for each farm”, connected by a vertical line.

### What changes
Card rises in at 65.3 s.

### On-screen text
Open-Meteo · forecast for each farm

### What the viewer should understand
Weather comes from Open-Meteo.

### Narration needed
“Open-Meteo provides the forecast.”

### Issues / observations
None.

## 01:07.590 – 01:11.390

*Segment 22*

### What is visible
Curved lines branch from the database to two cards on the right: “FARMER / AgroFlow app / Android & web” and “ADMINISTRATOR / Web console / every farm and kit”.

### What changes
Lines draw and cards rise at 67.6 s and 69.0 s.

### On-screen text
AgroFlow app · Android & web · Web console · every farm and kit

### What the viewer should understand
Two user surfaces.

### Narration needed
“Farmers use the mobile app, administrators use a web console,”

### Issues / observations
None.

## 01:11.390 – 01:14.470

*Segment 23*

### What is visible
Card below the API: “NOTIFICATIONS / Telegram / alerts and reports”. Full diagram, then fade.

### What changes
Card at 71.4 s; fade 73.9–74.4 s.

### On-screen text
Telegram · alerts and reports

### What the viewer should understand
Alerts go where farmers already are.

### Narration needed
“and alerts go out on Telegram.”

### Issues / observations
Diagram occupies the middle band only; generous empty space above/below. Text in cards is ~16–26 px — readable at 1080p but dense on a projector.

## 01:14.470 – 01:16.070

*Segment 24*

### What is visible
A generic dark phone frame slides up on the right showing the real AgroFlow Home screen (AgroFlow · Your farm at a glance · Green Valley (demo) · Stellenbosch, Western Cape · “Map unavailable. Farm location is shown above.” · 26 °C Partly cloudy · Today). No caption yet. Tag “● REAL AGROFLOW APP · ILLUSTRATIVE DEMO DATA”.

### What changes
Phone rises in (0.8 s).

### On-screen text
(app UI)

### What the viewer should understand
We are now in the farmer's real app.

### Narration needed
“On the farmer's phone,”

### Issues / observations
“Map unavailable” is visible on the Home screen (web build); looks unfinished to a careful viewer.

## 01:16.070 – 01:18.270

*Segment 25*

### What is visible
Caption appears: “THE FARMER'S APP · HOME / One clear action per irrigation zone.”

### What changes
Caption slides in at 76.1 s.

### On-screen text
One clear action per irrigation zone.

### What the viewer should understand
Home gives one action per zone.

### Narration needed
“Home gives one clear action for each irrigation zone.”

### Issues / observations
None.

## 01:18.270 – 01:21.670

*Segment 26*

### What is visible
The phone dims except a teal-outlined highlight on the Tomato field card (“TOMATO FIELD / Water about 70 min this morning (about 1750 L) / Why am I seeing this? / High confidence / I watered / How does the soil feel?”). Left: white panel “WATER TODAY / Tomato field · 50 m² · pump 25 L/min” with cells “APPLY 35 mm” and “RUN TIME ≈ 70 min”.

### What changes
Spotlight fades on (78.3 s); panel rises (78.6 s); cells appear 79.1 s (Apply) and 79.7 s (Run time).

### On-screen text
WATER TODAY · Tomato field · 50 m² · pump 25 L/min · APPLY 35 mm · RUN TIME ≈ 70 min

### What the viewer should understand
The recommendation is a concrete action: an amount and a runtime.

### Narration needed
“For the tomato field: water about seventy minutes this morning,”

### Issues / observations
Cells reveal in the order Apply → Run time → About (1,750 L), i.e. left, right, then middle — slightly odd.

## 01:21.670 – 01:24.070

*Segment 27*

### What is visible
Middle cell appears: “ABOUT 1,750 L”.

### What changes
Cell rises in at 81.7 s.

### On-screen text
ABOUT 1,750 L

### What the viewer should understand
The amount in litres.

### Narration needed
“roughly seventeen hundred and fifty litres,”

### Issues / observations
None.

## 01:24.070 – 01:29.670

*Segment 28*

### What is visible
Two mono lines under the cells: “35 mm × 50 m² = 1,750 L (1 mm on 1 m² is 1 litre)”, then “1,750 L ÷ 25 L/min = 70 min”.

### What changes
Lines slide in at 84.1 s and 87.3 s.

### On-screen text
35 mm × 50 m² = 1,750 L · 1,750 L ÷ 25 L/min = 70 min

### What the viewer should understand
How the depth becomes litres and minutes — transparent arithmetic.

### Narration needed
“or thirty-five millimetres of water.”

### Issues / observations
Good: the arithmetic makes the conversion verifiable. 50 m² is a small plot; ‘field’ is slightly generous but acceptable.

## 01:29.670 – 01:32.070

*Segment 29*

### What is visible
Dark-green chip under the panel: “HIGH CONFIDENCE · SENSOR, SETUP AND WEATHER AGREE”.

### What changes
Chip rises in at 89.7 s.

### On-screen text
High confidence · sensor, setup and weather agree

### What the viewer should understand
Each recommendation carries a confidence level.

### Narration needed
“Confidence is high: sensor, setup and weather agree.”

### Issues / observations
None.

## 01:32.070 – 01:35.420

*Segment 30*

### What is visible
Phone image switches to a scrolled Home: Spinach beds card highlighted (“No watering today; next on Saturday”), Maize block card below. Confidence chip replaced by “SPINACH BEDS · NEXT WATERING SATURDAY”.

### What changes
Hard switch of the phone screenshot at 92.1 s; highlight moves; chip swaps.

### On-screen text
Spinach beds · next watering Saturday

### What the viewer should understand
Not every zone needs water today; AgroFlow says when.

### Narration needed
“The spinach beds can wait until Saturday.”

### Issues / observations
The phone screenshot cuts rather than scrolls; acceptable.

## 01:35.420 – 01:35.970

*Segment 31*

### What is visible
Scene fades out.

### What changes
0.5 s fade.

### On-screen text
—

### What the viewer should understand
Scene break.

### Narration needed
—

### Issues / observations
None.

## 01:35.970 – 01:39.470

*Segment 32*

### What is visible
Caption “THE SCIENCE, SIMPLY · FAO-56 / How the decision is worked out.” Rest of frame empty. Tag “● CONCEPTUAL VISUALISATION · DEMO SCENARIO NUMBERS”.

### What changes
Caption slides in at 96.3 s.

### On-screen text
How the decision is worked out.

### What the viewer should understand
Transition to the method.

### Narration needed
“Behind that recommendation,”

### Issues / observations
3.5 s of a near-empty frame. Consider bringing the first row in earlier.

## 01:39.470 – 01:44.170

*Segment 33*

### What is visible
First row card: “Weather (temperature, humidity, sun, wind) → REFERENCE EVAPOTRANSPIRATION / ETo 5.8 mm/day”.

### What changes
Row slides in from the left at 99.5 s.

### On-screen text
Weather → ETo 5.8 mm/day

### What the viewer should understand
Weather sets how much water the atmosphere demands.

### Narration needed
“AgroFlow estimates how much water the weather is drawing, five point eight millimetres today.”

### Issues / observations
None.

## 01:44.170 – 01:46.970

*Segment 34*

### What is visible
Second row: “Crop + growth stage (tomato · growing, day 66 of ~145) → CROP COEFFICIENT / Kc 1.09”.

### What changes
Row slides in at 104.2 s.

### On-screen text
Crop + growth stage → Kc 1.09

### What the viewer should understand
The crop and its stage scale that demand.

### Narration needed
“It adjusts that for the crop and its growth stage,”

### Issues / observations
None.

## 01:46.970 – 01:49.670

*Segment 35*

### What is visible
Third row: “ETo × Kc → CROP WATER USE TODAY / ETc 6.4 mm/day”.

### What changes
Row slides in at 107.0 s.

### On-screen text
ETo × Kc → ETc 6.4 mm/day

### What the viewer should understand
Crop water use today.

### Narration needed
“so these tomatoes use about six point four.”

### Issues / observations
None.

## 01:49.670 – 01:53.070

*Segment 36*

### What is visible
Fourth row: “Soil + root zone (loam · roots to 0.7 m) → HOLDS · WATERING POINT / TAW 91 mm · RAW 31.5 mm”. On the right a card “ROOT ZONE · TOMATO FIELD / How dry is the soil?” with an empty pale-blue tube and caption “Root zone holds 91 mm when full”.

### What changes
Row slides in (109.7 s); gauge card slides in from the right (109.9 s); caption fades in (110.6 s).

### On-screen text
TAW 91 mm · RAW 31.5 mm · How dry is the soil? · Root zone holds 91 mm when full

### What the viewer should understand
Soil and roots define the reservoir and the trigger point.

### Narration needed
“Soil and root depth set when the crop starts to struggle.”

### Issues / observations
None.

## 01:53.070 – 01:55.270

*Segment 37*

### What is visible
A dashed red line across the tube with label “Watering point: 31.5 mm · 35% of what the soil holds”.

### What changes
Line and label fade in at 113.1 s.

### On-screen text
Watering point: 31.5 mm · 35% of what the soil holds

### What the viewer should understand
The irrigation threshold (RAW).

### Narration needed
(continues)

### Issues / observations
None.

## 01:55.270 – 01:57.670

*Segment 38*

### What is visible
Fifth row: “Rain + irrigation − crop use (tallied every day) → ROOT-ZONE DEPLETION / Dr 35 mm”. A brown fill drops from the top of the tube past the red line; label “Used up: 35 mm”.

### What changes
Row slides in (115.3 s); fill animates 115.6–117.6 s; label fades in (116.6 s).

### On-screen text
Dr 35 mm · Used up: 35 mm

### What the viewer should understand
The daily balance says the root zone is drier than the trigger.

### Narration needed
“A daily tally of rain, irrigation and use puts this field past that point.”

### Issues / observations
Fill grows downward from the top (depleted space), which is correct but may be read as ‘soil level rising’. Consider a legend ‘used up’ vs ‘available’.

## 01:57.670 – 01:59.920

*Segment 39*

### What is visible
Chip bottom-left: “DR 35 MM ≥ RAW 31.5 MM → IRRIGATION NEEDED”. Hold.

### What changes
Chip rises in at 117.7 s.

### On-screen text
Dr 35 mm ≥ RAW 31.5 mm → irrigation needed

### What the viewer should understand
The decision rule.

### Narration needed
(pause)

### Issues / observations
None.

## 01:59.920 – 02:00.480

*Segment 40*

### What is visible
Fade out.

### What changes
0.5 s fade.

### On-screen text
—

### What the viewer should understand
Scene break.

### Narration needed
—

### Issues / observations
None.

## 02:00.480 – 02:02.650

*Segment 41*

### What is visible
Phone (right) shows the real Home screen with the Tomato field card. Caption “TRACEABLE ADVICE / “Why am I seeing this?””. Tag “● REAL AGROFLOW APP & ADMIN CONSOLE · ILLUSTRATIVE DEMO DATA”.

### What changes
Screen recording starts; caption slides in at 120.8 s.

### On-screen text
“Why am I seeing this?”

### What the viewer should understand
Advice is explainable.

### Narration needed
“Each recommendation has a ‘Why am I seeing this?’ link:”

### Issues / observations
None.

## 02:02.650 – 02:05.180

*Segment 42*

### What is visible
A touch ring on the ‘Why am I seeing this?’ link; the real bottom sheet opens: “Why am I seeing this? — Your soil has dried to the point where tomato starts to struggle, and the 2 mm of rain expected today won't cover it. WHAT WE USED: Crop Tomato · Crop stage growing, day 66 of about 145 · Soil Loam / garden soil · …”. Left list starts: “• What was used”.

### What changes
Tap ripple at 122.65 s; sheet slides up (recorded). Bullet 1 at 123.9 s.

### On-screen text
What was used

### What the viewer should understand
The explanation is generated from the same rule as the advice.

### Narration needed
“the inputs, their sources,”

### Issues / observations
None.

## 02:05.180 – 02:08.280

*Segment 43*

### What is visible
Left bullets add “Where each number came from”, “The rule”, “What would change it”. The sheet scrolls through facts (How dry the soil is … about 35 mm short of full; Watering point about 31.5 mm; Soil moisture 41%; Watering level 35; Rain expected today 2 mm; Water your crop will use today 6.4 mm; How much about 70 min (about 1750 L)).

### What changes
Bullets at 125.2, 126.7, 127.3 s; sheet scrolls (recorded).

### On-screen text
Where each number came from · The rule · What would change it

### What the viewer should understand
Every fact has a source label.

### Narration needed
“the rule, and what would change it.”

### Issues / observations
The sheet's text is small inside the phone (≈11 px effective); viewers see that it is detailed rather than read it.

## 02:08.280 – 02:11.280

*Segment 44*

### What is visible
Left side changes to “THE REASONING, IN NUMBERS / Tomato field, today.” with six number cards (ETo 5.8 mm/day · Kc 1.09 · ETc 6.4 mm/day · Dr 35 mm · RAW 31.5 mm · Rain today 2 mm) and the admin console's real technical line in a card: “TECHNICAL (ADMINS ONLY) Dr 35 mm, RAW 31.5 mm, TAW 91 mm, p 0.35, Kc 1.09, ETo 5.8 mm, ETc 6.4 mm. FAO-56 Eq. 58 (p. 103), 82-85 (pp. 162-170). WaterRules.ShouldWaterToday (FAO-56 p. 171): Dr >= RAW.” Phone switches to the sheet's rule section (THE RULE / HOW SURE WE ARE / WHAT WOULD CHANGE IT).

### What changes
Bullets fade (127.8 s); numbers stagger in (128.9–129.8 s); tech card at 130.1 s; phone image swap at 130.9 s.

### On-screen text
ETo 5.8 · Kc 1.09 · ETc 6.4 · Dr 35 mm · RAW 31.5 mm · Rain 2 mm · TECHNICAL (ADMINS ONLY) …

### What the viewer should understand
The numbers are traceable down to FAO-56 equations.

### Narration needed
“Here, thirty-five millimetres have been used, past the thirty-one and a half millimetre threshold,”

### Issues / observations
The technical line includes a code identifier (WaterRules.ShouldWaterToday). It is the real admin UI, but it edges towards ‘code on screen’.

## 02:11.280 – 02:17.080

*Segment 45*

### What is visible
Tick 1: “✓ Dr 35 mm ≥ RAW 31.5 mm”; tick 2 (134.1 s): “✓ Rain 2 mm < crop use 6.4 mm: it won't cover today”.

### What changes
Ticks slide in at 131.3 and 134.1 s.

### On-screen text
Dr 35 mm ≥ RAW 31.5 mm · Rain 2 mm < crop use 6.4 mm: it won't cover today

### What the viewer should understand
Two conditions → irrigate.

### Narration needed
“and two millimetres of rain won't cover the day's use.”

### Issues / observations
None.

## 02:17.080 – 02:18.960

*Segment 46*

### What is visible
Dark chip “WATER TODAY”. Then fade.

### What changes
Chip scales in (137.1 s); scene fades 138.4–138.9 s.

### On-screen text
Water today

### What the viewer should understand
Conclusion.

### Narration needed
“So: water today.”

### Issues / observations
Only ~1.3 s on the WATER TODAY conclusion before the fade.

## 02:18.960 – 02:21.760

*Segment 47*

### What is visible
Large two-line heading top-left: “AgroFlow recommends.” (dark green) / “The farmer decides.” (teal). Phone shows the Home screen. Tag “● REAL AGROFLOW APP · ILLUSTRATIVE DEMO DATA”.

### What changes
Line 1 rises in at 139.3 s, line 2 at 140.5 s. Phone recording starts at 141.0 s.

### On-screen text
AgroFlow recommends. The farmer decides.

### What the viewer should understand
Key product message: farmer autonomy.

### Narration needed
“AgroFlow recommends. The farmer decides.”

### Issues / observations
None.

## 02:21.760 – 02:24.430

*Segment 48*

### What is visible
Two cards: “AGROFLOW SUGGESTED 1,750 L · 35 mm · about 70 min” and teal-outlined “THE FARMER APPLIED 1,500 L · 30 mm on 50 m² · recorded with “I watered””. On the phone a tap on ‘I watered’ opens the real sheet “I watered Tomato field — About how long did you water? 5 min 10 min 15 min 20 min 30 min · Or roughly how many litres?”.

### What changes
Cards rise in at 141.8 and 142.6 s; tap ring at 142.0 s; sheet slides up.

### On-screen text
AgroFlow suggested 1,750 L · The farmer applied 1,500 L

### What the viewer should understand
The farmer can do something different from the advice.

### Narration needed
“Here, the farmer applies fifteen hundred litres instead,”

### Issues / observations
None.

## 02:24.430 – 02:26.860

*Segment 49*

### What is visible
Tap on the litres field; “1500” is typed; tap on ‘Save litres’.

### What changes
Tap rings at 144.4 and 146.4 s; typing (recorded).

### On-screen text
—

### What the viewer should understand
Logging is quick and flexible (minutes or litres).

### Narration needed
“and records it with ‘I watered’.”

### Issues / observations
The typed number is small in the phone; the left-hand card carries the message.

## 02:26.860 – 02:29.110

*Segment 50*

### What is visible
Card: “WHAT ACTUALLY HAPPENED IS WHAT COUNTS / Depletion 35 mm − 30 mm applied = 5 mm / Today's advice now: No watering needed today”. Phone shows the confirmation “Watering logged. Today's advice now counts it.”

### What changes
Card rises in at 146.9 s.

### On-screen text
What actually happened is what counts · Depletion 35 mm − 30 mm applied = 5 mm

### What the viewer should understand
The balance uses the real amount applied.

### Narration needed
“AgroFlow logs what actually happened and counts it:”

### Issues / observations
None.

## 02:29.110 – 02:31.760

*Segment 51*

### What is visible
Phone switches to Home: Tomato field card now reads “No watering needed today”.

### What changes
Screenshot swap at 149.1 s.

### On-screen text
No watering needed today

### What the viewer should understand
Advice updates immediately.

### Narration needed
“no watering needed today.”

### Issues / observations
None.

## 02:31.760 – 02:35.410

*Segment 52*

### What is visible
Phone shows the real “How does the soil feel? Tomato field” sheet (Dry / Moist / Wet with hints). Left text: “A hand check (“How does the soil feel?” · dry / moist / wet) corrects the estimate too.” Four small chips: I watered · minutes or litres / How does the soil feel? / Start a run (kit zones) / Dismiss, with a note. Fade at 155.4 s.

### What changes
Image swap at 151.8 s; text at 151.8 s; chips stagger in 153.0–153.5 s.

### On-screen text
How does the soil feel? · Start a run (kit zones) · Dismiss, with a note

### What the viewer should understand
The real farmer controls.

### Narration needed
“A soil check by hand can correct the estimate too.”

### Issues / observations
The brief's IRRIGATE / ADJUST / POSTPONE / SKIP buttons do not exist; the chips name the real equivalents. Chips are small (15 px).

## 02:35.940 – 02:38.230

*Segment 53*

### What is visible
Caption “WHERE A KIT CONTROLS THE PUMP / Start a run from the app.” Phone shows the real Irrigation Control panel (Mode Manual, Relay Unknown, Health Warning; Automatic / Scheduled / Manual; Duration (minutes); Start Manual Run).

### What changes
Caption slides in; screenshot then screen recording from 157.2 s.

### On-screen text
Start a run from the app.

### What the viewer should understand
Real pump control exists where a kit is installed.

### Narration needed
“Where a kit controls the pump, a run can start from the app.”

### Issues / observations
“Relay Unknown” is visible (no live relay state in the product) — honest, but slightly odd on screen.

## 02:38.230 – 02:40.260

*Segment 54*

### What is visible
Tap on Duration; “90” typed; tap on Start Manual Run.

### What changes
Touch rings at 158.2 and 159.8 s.

### On-screen text
—

### What the viewer should understand
Input validation will be demonstrated.

### Narration needed
“Ninety minutes is rejected:”

### Issues / observations
None.

## 02:40.260 – 02:43.240

*Segment 55*

### What is visible
A neutral dialog over the dimmed phone: “Invalid Duration / Enter a duration between 1 and 60 minutes. / OK”. Above the phone: “App dialog · text captured from the running app”. Left card with amber bar: “INPUT VALIDATED / 90 minutes is rejected: a manual run must be between 1 and 60 minutes.”

### What changes
Dialog appears 160.3–162.9 s; card slides in at 160.3 s.

### On-screen text
INPUT VALIDATED · Invalid Duration · Enter a duration between 1 and 60 minutes.

### What the viewer should understand
Robust input validation.

### Narration needed
“the limit is one to sixty.”

### Issues / observations
None.

## 02:43.240 – 02:45.840

*Segment 56*

### What is visible
Second clip: duration corrected to 5; tap Start. Left card: “CONFIRMED / 5 minutes · “Run irrigation for 5 minutes?” → Start”.

### What changes
Cut in the recording at 163.2 s; taps at 163.8 and 165.2 s; card at 164.1 s.

### On-screen text
CONFIRMED · 5 minutes

### What the viewer should understand
The farmer explicitly confirms the run.

### Narration needed
“Five minutes is confirmed and sent,”

### Issues / observations
None.

## 02:45.840 – 02:49.740

*Segment 57*

### What is visible
Left switches to “FROM THE APP TO THE PUMP / The command reaches the field.”: five small node cards (Farmer app Start · 5 min → AgroFlow API Checks & saves → MQTT Publishes → ESP32 Relay ON → Pump Water flows); below, a field strip with tomato plants and a pipe; chip “PUMP OFF”; a teal dot travels along the nodes. The phone still shows “Start Manual Irrigation? Run irrigation for 5 minutes? CANCEL / START”. Tag changes to “● VISUALISATION · SPED UP · HISTORY FROM THE REAL APP”; chip “Visualisation, sped up · the showcase kit ends any run at 5 min”.

### What changes
Left content cross-fades (165.8–166.3 s); nodes stagger in; packet travels 166.8–169.8 s; confirm dialog stays until 168.3 s.

### On-screen text
From the app to the pump · The command reaches the field. · Pump off

### What the viewer should understand
The command path to the field.

### Narration needed
“via the API and MQTT, to the ESP32,”

### Issues / observations
VISUAL CONTRADICTION: the command animation starts ~1.4 s before the phone's confirm dialog is dismissed — it looks as if the command went before the farmer pressed Start.

## 02:49.740 – 02:52.140

*Segment 58*

### What is visible
“PUMP OFF” becomes “PUMP ON · 5 MIN”; light-blue dashes flow along the pipe; the whole soil strip darkens to slate as it wets. Phone shows “Manual command sent” with a red “Send Stop Command” button.

### What changes
Chip swap at 169.7 s; flow animation; soil colour 170.1–172.1 s; phone image at 170.2 s.

### On-screen text
Pump on · 5 min

### What the viewer should understand
Physical irrigation: relay → pump → water → soil.

### Narration needed
“which starts the pump.”

### Issues / observations
No pump or emitter graphic near the plants and no sprinklers; ‘water flowing’ is thin dashes on the pipe. The wet soil turns a flat dark slate across the whole strip, which reads as a colour change rather than wetting.

## 02:52.140 – 02:55.790

*Segment 59*

### What is visible
Card “RUN REPORTED BY THE KIT / 5 min · about 125 L, estimated from the flow rate (there is no flow meter)” over the field. Phone shows the real History tab, highlight on “Start Command Sent — A 5-minute manual irrigation command was accepted. Tomato field · Farmer · irrigation”. Dimmed below: “Irrigation recorded — Irrigation ran for 5 minutes”, then “Irrigation recorded — Irrigation ran for 0 minutes”.

### What changes
Card at 172.1 s; History image at 172.1 s; highlight at 173.5 s; fade 175.8 s.

### On-screen text
Run reported by the kit · 5 min · about 125 L … (there is no flow meter)

### What the viewer should understand
The run is recorded and visible in History.

### Narration needed
“The kit reports the run, and it appears in the history.”

### Issues / observations
History visibly shows “Irrigation ran for 0 minutes” (the litres-only ‘I watered’ entry) — reads as a fault. The highlight is on ‘Start Command Sent’, not on ‘Irrigation recorded 5 min’ which the narration refers to. ‘Irrigation recorded’ is timestamped 16:23, before the 16:25 command. The run-report card overlaps the crop row. Narration never explains why the run is 5 min when the advice was 70 min (only the small chip does).

## 02:56.350 – 02:58.550

*Segment 60*

### What is visible
Caption “NEXT 7 DAYS / What is likely this week, not only today.” Phone shows the real “The week ahead / Tomato field” screen (Today 13°–27°, 2 mm rain, Water likely needed; Fri … Check the soil that morning …). Tag “● REAL APP · PROJECTION CHART IS A VISUALISATION”.

### What changes
Phone rises in; caption slides in.

### On-screen text
NEXT 7 DAYS · What is likely this week, not only today.

### What the viewer should understand
AgroFlow looks ahead.

### Narration needed
“AgroFlow also looks ahead:”

### Issues / observations
None.

## 02:58.550 – 03:01.750

*Segment 61*

### What is visible
Phone dims except Fri→Tue rows (each: temperatures, ‘No rain expected’, ‘Check the soil that morning’).

### What changes
Highlight on at 178.6 s, off at 181.6 s.

### On-screen text
The week ahead

### What the viewer should understand
Per-day guidance in the real app.

### Narration needed
“the week-ahead screen says what each day means for watering.”

### Issues / observations
The real screen's Today row says “Water likely needed”, while the chart that follows labels Today “Watered · 1,500 L logged” — mismatched moments in the story.

## 03:01.750 – 03:04.950

*Segment 62*

### What is visible
White chart card: “ROLLING PROJECTION · TOMATO FIELD · AFTER TODAY'S 1,500 L / Root-zone depletion, day by day (mm)”. Seven tan bars grow left→right: TODAY 5, FRI 11.5, SAT 18.4, SUN 24.8, MON 30.7, TUE 37.1, WED 43.7 (values printed in/above bars).

### What changes
Card rises (181.8 s); bars grow one by one every 0.55 s (182.5–185.8 s).

### On-screen text
Root-zone depletion, day by day (mm)

### What the viewer should understand
Depletion accumulates day after day.

### Narration needed
“Underneath, the water balance carries on day by day:”

### Issues / observations
None.

## 03:04.950 – 03:07.350

*Segment 63*

### What is visible
Red dashed watering-point segments per day and legend “- - - red dashes: watering point (RAW) for each day”; under each day: Watered 1,500 L logged / No irrigation / No irrigation / No irrigation / Monitor near the point / Irrigation likely / (after Tue).

### What changes
Dashes fade in (185.0 s); labels stagger in (186.0–186.7 s).

### On-screen text
Watered · No irrigation · Monitor · Irrigation likely

### What the viewer should understand
A day-by-day plan derived from the projection.

### Narration needed
“each day's ending state is the next day's starting point.”

### Issues / observations
None.

## 03:07.350 – 03:10.050

*Segment 64*

### What is visible
The TUE bar turns red; ‘Irrigation likely’ pulses.

### What changes
Fill change at 187.4 s; label pulse.

### On-screen text
Irrigation likely (Tue)

### What the viewer should understand
Next irrigation projected for Tuesday.

### Narration needed
“So the tomatoes next need water on Tuesday.”

### Issues / observations
None.

## 03:10.050 – 03:12.350

*Segment 65*

### What is visible
Text under the chart: “The balance carries over: each morning the window moves on one day.”

### What changes
Text rises in at 190.1 s.

### On-screen text
The balance carries over: each morning the window moves on one day.

### What the viewer should understand
Rolling, not reset.

### Narration needed
“The window rolls forward;”

### Issues / observations
None.

## 03:12.350 – 03:14.950

*Segment 66*

### What is visible
Chip: “CONTINUOUS DAILY WATER BALANCE · NO WEEKLY RESET”.

### What changes
Chip at 192.4 s.

### On-screen text
Continuous daily water balance · no weekly reset

### What the viewer should understand
Explicitly no weekly reset.

### Narration needed
“nothing resets weekly.”

### Issues / observations
The ‘rolling’ idea is stated in text only; the window never visibly shifts.

## 03:14.950 – 03:15.500

*Segment 67*

### What is visible
Fade.

### What changes
0.5 s fade.

### On-screen text
—

### What the viewer should understand
Scene break.

### Narration needed
—

### Issues / observations
None.

## 03:15.500 – 03:17.400

*Segment 68*

### What is visible
Caption “WEATHER UPDATE / The forecast changes. The plan recalculates.” The same depletion chart (Tue/Wed red, ‘Irrigation likely’) in a card, phone with the old week screen.

### What changes
Caption and chart fade in; visual continuity with the previous chart.

### On-screen text
The forecast changes. The plan recalculates.

### What the viewer should understand
We continue from the same plan.

### Narration needed
“Then the forecast changes:”

### Issues / observations
None.

## 03:17.400 – 03:19.900

*Segment 69*

### What is visible
Blue banner with a rain-cloud icon: “HEAVY RAIN EXPECTED / Saturday · 22 mm forecast”. Phone switches to the updated week: Saturday 18°–21° 22 mm rain ‘Rain should cover it’, Sunday 4 mm ‘Rain should cover it’ (highlighted). Blue rain tags “22 mm” and “4 mm” appear above SAT and SUN in the chart.

### What changes
Banner drops in (197.4 s); phone image swap (197.7 s); highlight (198.1 s); rain tags (198.5 s).

### On-screen text
HEAVY RAIN EXPECTED · Saturday · 22 mm forecast

### What the viewer should understand
New forecast arrives.

### Narration needed
“twenty-two millimetres of rain is now expected on Saturday,”

### Issues / observations
None.

## 03:19.900 – 03:22.900

*Segment 70*

### What is visible
Amber “RECALCULATING…” blinks in the chart; ‘Irrigation likely’ fades; bars animate down to the new projection (Sat and Sun ~0, Mon 5.8, Tue 12.2, Wed 18.8) and turn tan.

### What changes
Blink 199.9–201.0 s; bars morph 201.2–202.9 s.

### On-screen text
RECALCULATING…

### What the viewer should understand
The plan is recomputed, not reset.

### Narration needed
“so AgroFlow recalculates the balance.”

### Issues / observations
Strong moment; reads clearly.

## 03:22.900 – 03:26.700

*Segment 71*

### What is visible
Labels: “Rain covers it” under SAT, “Postponed” under TUE; dark chip “PLAN UPDATED · NO IRRIGATION NOW EXPECTED THIS WEEK”.

### What changes
Labels fade in (203.6 s); chip at 204.7 s; highlight off at 206.5 s.

### On-screen text
Rain covers it · Postponed · Plan updated · no irrigation now expected this week

### What the viewer should understand
Outcome of the recalculation.

### Narration needed
“The rain refills the root zone: no irrigation expected this week.”

### Issues / observations
None.

## 03:26.700 – 03:29.100

*Segment 72*

### What is visible
Banner and chart fade; heading alone mid-left: Not “rain = skip”: is the rain enough to change the deficit? Phone remains (updated week).

### What changes
Fade 206.7–207.1 s; heading rises at 207.2 s.

### On-screen text
Not “rain = skip”: is the rain enough to change the deficit?

### What the viewer should understand
Rain logic is quantitative.

### Narration needed
“It isn't ‘rain means skip’.”

### Issues / observations
≈2 s with a lone heading and large empty space above it.

## 03:29.100 – 03:32.700

*Segment 73*

### What is visible
Four rule cards appear in a 2×2 grid above the heading: RAIN BELOW THE CROP'S USE — Still water (Today: 2 mm < 6.4 mm, so watering went ahead); RAIN AT LEAST THE CROP'S USE — Watering can wait (Saturday: 22 mm refills the root zone); RAIN THAT PARTLY HELPS — Smaller next amount (Rain is credited in the balance); FORECAST RAIN FADES — Watering moves earlier (The next forecast update recalculates).

### What changes
Cards rise in at 209.1, 210.3, 211.4, 212.7 s.

### On-screen text
Still water · Watering can wait · Smaller next amount · Watering moves earlier

### What the viewer should understand
Four possible outcomes.

### Narration needed
“Too little rain: still water. Enough rain: it waits. Some rain: a smaller amount. And if the rain fades, watering moves back.”

### Issues / observations
Cards appear above the heading that introduces them (reading order bottom-then-top).

## 03:32.700 – 03:37.900

*Segment 74*

### What is visible
Hold on the four cards and heading; then fade.

### What changes
Static ≈4.6 s; fade 217.35–217.9 s.

### On-screen text
—

### What the viewer should understand
Time to read.

### Narration needed
(pause)

### Issues / observations
Slightly long static hold.

## 03:37.900 – 03:41.100

*Segment 75*

### What is visible
Caption “ALERTS / Decision-relevant warnings, where farmers already are.” A card styled as a Telegram message: blue avatar, “AgroFlow / Telegram alert · message text from AgroFlow”, body: “Heavy rain expected / Farm: Green Valley (demo) / When: Saturday (10 Oct) / Expected rainfall: 22 mm / AgroFlow does not pause automatic watering for rain yet, so zones on automatic will still water on their own soil moisture readings.” Button “Why am I seeing this?”. Footnote: “Telegram message laid out from the text AgroFlow sends (TelegramNotificationService, AlertExplanations).” Tag “● AGROFLOW MESSAGE TEXT · REAL APP SCREENS”.

### What changes
Caption, card rise in (218.1–218.9 s).

### On-screen text
Heavy rain expected · Expected rainfall: 22 mm · AgroFlow does not pause automatic watering for rain yet …

### What the viewer should understand
Weather alerts reach farmers on Telegram.

### Narration needed
“Heavy-rain warnings arrive on Telegram,”

### Issues / observations
The visible sentence ‘AgroFlow does not pause automatic watering for rain yet’ seems to contradict the previous scene's ‘plan recalculates’ unless explained (advice recalculates; automatic mode does not). Footnote shows code class names.

## 03:41.100 – 03:42.300

*Segment 76*

### What is visible
‘Why am I seeing this?’ button pulses; a card on the right: “WHY AM I SEEING THIS? / The weather forecast for Green Valley (demo) shows heavy rain on Saturday 10 Oct. / We warn when the forecast shows 20 mm of rain or more in a day. We look 5 days ahead and tell you once per day of weather. / How sure: Medium: weather forecasts can change, especially more than two days ahead.”

### What changes
Button pulse at 221.1 s; card slides in at 221.3 s.

### On-screen text
Why am I seeing this? …

### What the viewer should understand
Alerts are explainable too.

### Narration needed
“with the same ‘Why’ button.”

### Issues / observations
On screen ≈1 s before the scene changes — far too short to read.

## 03:42.300 – 03:46.300

*Segment 77*

### What is visible
Scene part B: caption “CHECK THE FIELD / The sensor is a check, not the whole truth.” A flat brown rectangle with five rows of green dots (a field from above).

### What changes
Part A fades (222.3 s); caption (222.7 s); field drawing rises (223.3 s).

### On-screen text
CHECK THE FIELD · The sensor is a check, not the whole truth.

### What the viewer should understand
The probe has limits.

### Narration needed
“The soil sensor gives a local signal from one spot,”

### Issues / observations
None.

## 03:46.300 – 03:48.200

*Segment 78*

### What is visible
A teal ring appears around one point: “one probe = one spot”.

### What changes
Ring grows at 226.3 s.

### On-screen text
one probe = one spot

### What the viewer should understand
A single probe samples one spot.

### Narration needed
“so AgroFlow treats it as a check, not the whole truth.”

### Issues / observations
None.

## 03:48.200 – 03:50.800

*Segment 79*

### What is visible
The real Home card (Spinach beds): “Check the kit: it has stopped sending readings”, Medium confidence, labelled “REAL HOME CARD · KIT STATUS”. Four check cards: Kit offline: no reading for 3 hours · Sensor stuck: same number for 6 hours · Sensor drifting: redo the wet/dry setup · Pump ran, but the soil didn't get wetter.

### What changes
Card rises (228.2 s); checks stagger in (228.5–229.3 s).

### On-screen text
Check the kit: it has stopped sending readings · Kit offline … · Sensor stuck … · Sensor drifting … · Pump ran, but the soil didn't get wetter

### What the viewer should understand
AgroFlow detects faulty or silent sensors.

### Narration needed
“Faulty sensors raise warnings;”

### Issues / observations
The brief's ‘CHECK THE FIELD — sensor wetter than estimate’ alert is not shown (it does not exist); this scene shows the real kit/sensor checks instead.

## 03:50.800 – 03:54.950

*Segment 80*

### What is visible
Phone rises in on the right with the real “How does the soil feel? Tomato field” sheet highlighted (Dry / Moist / Wet).

### What changes
Phone rises (230.8 s); highlight (231.5 s); fade 235.0 s.

### On-screen text
How does the soil feel?

### What the viewer should understand
Farmer judgement feeds the estimate.

### Narration needed
“a farmer's own soil check can correct the estimate.”

### Issues / observations
Same soil-feel sheet as at 2:32 — repeated visual.

## 03:54.950 – 03:55.510

*Segment 81*

### What is visible
Fade.

### What changes
0.5 s fade.

### On-screen text
—

### What the viewer should understand
Scene break.

### Narration needed
—

### Issues / observations
None.

## 03:55.510 – 04:00.110

*Segment 82*

### What is visible
Caption “VALIDATION · INCOMPLETE SETUP / Advice is never blocked. What's missing is named.” Phone shows a scrolled Home screen (Spinach beds and Maize block cards, Farm status 47% Avg soil moisture, ‘No data’ recorded water today). Tag “● REAL AGROFLOW APP · ILLUSTRATIVE DEMO DATA”.

### What changes
Phone and caption rise in.

### On-screen text
Advice is never blocked. What's missing is named.

### What the viewer should understand
Robustness when setup is incomplete.

### Narration needed
“When setup is incomplete, AgroFlow still advises.”

### Issues / observations
4.6 s with only the caption and a phone, nothing highlighted.

## 04:00.110 – 04:02.510

*Segment 83*

### What is visible
Maize block card highlighted on the phone; an enlarged real card on the left: “MAIZE BLOCK / Water about 900 L this morning / Why am I seeing this? / Medium confidence / I watered · How does the soil feel? · Finish setup”.

### What changes
Highlight on (240.1 s); card rises (240.3 s).

### On-screen text
MAIZE BLOCK · Water about 900 L this morning · Medium confidence · Finish setup

### What the viewer should understand
Advice in litres only.

### Narration needed
“The maize block has no flow rate,”

### Issues / observations
None.

## 04:02.510 – 04:05.510

*Segment 84*

### What is visible
Cards: “STILL ADVISES / About 900 L, in litres only”; “CONFIDENCE / Medium: the pump's flow rate is missing”.

### What changes
Cards slide in at 242.5 and 244.2 s.

### On-screen text
Still advises · About 900 L, in litres only · Confidence · Medium: the pump's flow rate is missing

### What the viewer should understand
Lower confidence is stated honestly.

### Narration needed
“so its advice is in litres only,”

### Issues / observations
None.

## 04:05.510 – 04:10.310

*Segment 85*

### What is visible
Card “ONE NEXT STEP / Add the pump's flow rate to get watering times in minutes.”; amber chip “ADD FLOW RATE TO SEE RUNTIME”; text “Finish setup measures it simply: time how many seconds the tap or pump takes to fill a 500 mL bottle.” Phone switches to the real Finish setup screen with the Flow rate section highlighted (Seconds, e.g. 15 / Save flow rate). Fade at 250.3 s.

### What changes
Card (245.5 s); phone swap (245.7 s); chip (245.9 s); highlight (246.0 s); text (246.6 s).

### On-screen text
One next step · Add flow rate to see runtime · 500 mL bottle

### What the viewer should understand
AgroFlow tells the farmer exactly how to improve the advice.

### Narration needed
“at medium confidence, with one next step: time the tap filling a half-litre bottle.”

### Issues / observations
The real Finish setup screen shows a ‘Small tub (about 0.2 m²)’ size preset just above the highlight — the only ‘tub’ wording in the video.

## 04:10.860 – 04:15.560

*Segment 86*

### What is visible
Caption “ADMINISTRATOR OVERSIGHT / One console for every farm, zone and kit.” Top-right label “PUBLIC WEBSITE · HOW IT WORKS · ADMIN LOGIN”. A browser frame shows the real public landing page (dark green): “AgroFlow: smart irrigation for South African farmers”, How it works (three steps), What it does (Live soil moisture, 7-day forecast advice, Automatic watering, Alerts on Telegram). Tag “● REAL AGROFLOW WEBSITE & ADMIN CONSOLE · ILLUSTRATIVE DEMO DATA”.

### What changes
Browser rises in; slow 8% push-in over 4.4 s.

### On-screen text
AgroFlow: smart irrigation for South African farmers

### What the viewer should understand
The public face of the product.

### Narration needed
“Administrators start from the public website and sign in to the console.”

### Issues / observations
The landing page advertises ‘Automatic watering’ and ‘the pump can run on its own when the soil says so’ — real (automatic mode exists) but not mentioned elsewhere; could seem to contradict ‘the farmer decides’. No 3D controller exists on the landing page.

## 04:15.560 – 04:18.660

*Segment 87*

### What is visible
Admin Home (sidebar: Home, Requests, Farmers, Farms & zones, Kits, Alerts, Maintenance, Reports, Activity, Settings): “Needs attention” cards (New requests waiting 2, Kits offline or faulty 1, Zones missing setup 1) highlighted; At a glance (Farms 3, Farmers 3, Kits online 4/5, …). Label “HOME · WHAT NEEDS ATTENTION TODAY”.

### What changes
Hard cut at 255.6 s; highlight 256.3–258.5 s.

### On-screen text
Home · what needs attention today

### What the viewer should understand
The admin's work queue.

### Narration needed
“Home lists what needs attention.”

### Issues / observations
None.

## 04:18.660 – 04:20.460

*Segment 88*

### What is visible
Requests page: Farm and zone requests table (Demo Farmer B — New zone · Spinach; Smallholder Farmer (demo) — New zone · Cucumber). Label “REQUESTS FROM FARMERS”.

### What changes
Cut at 258.7 s.

### On-screen text
Requests from farmers

### What the viewer should understand
Inbound work from farmers.

### Narration needed
“Farmers' requests come in here,”

### Issues / observations
1.8 s — too short to read the table.

## 04:20.460 – 04:23.460

*Segment 89*

### What is visible
Farm detail drawer for Green Valley (demo): alerts & advice seen by the farmer, and the Zones (3) table with each zone's Today text (Water about 70 min this morning (about 1750 L); No watering today; next on Saturday; Water about 900 L this morning) highlighted. Label “FARM DETAIL · EACH ZONE'S ADVICE, AS THE FARMER SEES IT”.

### What changes
Cut at 260.5 s; highlight 261.1–263.3 s.

### On-screen text
Farm detail · each zone's advice, as the farmer sees it

### What the viewer should understand
Admin and farmer see the same advice — one product.

### Narration needed
“and each zone shows the same advice the farmer sees.”

### Issues / observations
Good continuity moment.

## 04:23.460 – 04:25.060

*Segment 90*

### What is visible
Run-advice drawer “Advice for Tomato field / Engine run for 2026-10-08”: Crop Tomato, Stage Growing, Day of season 66, Soil Loam / garden soil; WATER NEED TODAY: ETc 6.4 mm, ET0 5.8 mm, Soil water used up 35 mm, Can be used before stress 31.5 mm, Soil can hold 91 mm, Suggested water 1750 L, Suggested run time 70 min, Soil moisture 41 % (highlighted). Label “RUN ADVICE NOW · THE FAO-56 ENGINE ON DEMAND”.

### What changes
Cut at 263.5 s; highlight 263.8–265.0 s.

### On-screen text
Run advice now · the FAO-56 engine on demand

### What the viewer should understand
Same numbers from the engine on demand.

### Narration needed
“They can run the engine on demand,”

### Issues / observations
1.6 s — the consistent numbers (strong evidence) flash by too quickly.

## 04:25.060 – 04:26.160

*Segment 91*

### What is visible
Kits page (Farm Hardware: Total 5, Online 4/5, Offline/Fault 1; inventory table). Label “KITS · CONNECTION AND LAST CHECK-IN”.

### What changes
Cut at 265.1 s.

### On-screen text
Kits · connection and last check-in

### What the viewer should understand
Fleet health.

### Narration needed
“monitor kits,”

### Issues / observations
1.1 s on screen.

## 04:26.160 – 04:27.110

*Segment 92*

### What is visible
Alerts (Operations Centre): Open Alerts 1; alert queue row ‘Kit has not reported for 26 hours’ (Hilltop). Label “ALERTS AND MAINTENANCE”.

### What changes
Cut at 266.2 s.

### On-screen text
Alerts and maintenance

### What the viewer should understand
Alert follow-up.

### Narration needed
“follow up alerts”

### Issues / observations
0.95 s on screen.

## 04:27.110 – 04:28.160

*Segment 93*

### What is visible
Maintenance page (Scheduled 1; job ‘Kit offline – check power and WiFi on site’). Same label.

### What changes
Cut at 267.1 s.

### On-screen text
Alerts and maintenance

### What the viewer should understand
Maintenance planning.

### Narration needed
“and maintenance,”

### Issues / observations
1.05 s on screen.

## 04:28.160 – 04:29.360

*Segment 94*

### What is visible
Reports page (Farm reports with Preview / PDF / Excel; Farms needing attention this week; Automatic reports; Water use comparison). Label “REPORTS · PDF AND EXCEL”.

### What changes
Cut at 268.2 s.

### On-screen text
Reports · PDF and Excel

### What the viewer should understand
Reporting.

### Narration needed
“produce reports,”

### Issues / observations
1.2 s on screen.

## 04:29.360 – 04:32.710

*Segment 95*

### What is visible
Activity page (Administrator actions table: scheduled maintenance, resolved alert 290, created an enrollment code, registered the farm). Label “ACTIVITY · EVERY ADMINISTRATOR ACTION RECORDED”. Fade at 272.2 s.

### What changes
Cut at 269.4 s; fade 272.2–272.7 s.

### On-screen text
Activity · every administrator action recorded

### What the viewer should understand
Accountability.

### Narration needed
“and every administrator action is recorded.”

### Issues / observations
None.

## 04:32.710 – 04:37.510

*Segment 96*

### What is visible
Caption “ONE INTEGRATED SYSTEM / From the field to a decision, and back.” Five white cards in a row joined by “+”: Field sensing + Weather + Crop science + Farmer decisions + Irrigation history. Tag “● CONCEPTUAL VISUALISATION”.

### What changes
Cards rise in at 273.1, 274.0, 274.6, 275.4, 276.6 s; plus signs fade in.

### On-screen text
Field sensing + Weather + Crop science + Farmer decisions + Irrigation history

### What the viewer should understand
Everything that feeds the decision.

### Narration needed
“Field sensing, weather, crop science, farmer decisions and irrigation history,”

### Issues / observations
None.

## 04:37.510 – 04:40.510

*Segment 97*

### What is visible
A teal arrow down to a dark-green box “Actionable irrigation guidance”.

### What changes
Arrow (277.5 s), box scales in (277.9 s).

### On-screen text
Actionable irrigation guidance

### What the viewer should understand
The output.

### Narration needed
“turned into practical irrigation guidance.”

### Issues / observations
None.

## 04:40.510 – 04:42.960

*Segment 98*

### What is visible
Large words appear: SENSE → UNDERSTAND → ACT → MONITOR.

### What changes
Words rise in at 280.5, 280.9, 281.6, 281.9 s; arrows fade in; scene fades 283.0 s.

### On-screen text
SENSE → UNDERSTAND → ACT → MONITOR

### What the viewer should understand
The loop.

### Narration needed
“Sense. Understand. Act. Monitor.”

### Issues / observations
The complete four-word line is on screen for only ≈1 s before the fade — the key closing message is too fast.

## 04:42.960 – 04:43.430

*Segment 99*

### What is visible
Fade.

### What changes
0.5 s fade.

### On-screen text
—

### What the viewer should understand
Scene break.

### Narration needed
—

### Issues / observations
None.

## 04:43.430 – 04:48.130

*Segment 100*

### What is visible
End card on off-white: AgroFlow icon, AGROFLOW, BY MAFIHUB, “Practical irrigation decisions, grounded in field data.” No tag.

### What changes
Icon (283.7 s), wordmark (284.6 s), by (285.4 s), tagline (286.3 s) rise in.

### On-screen text
AGROFLOW · BY MAFIHUB · Practical irrigation decisions, grounded in field data.

### What the viewer should understand
Brand close and promise.

### Narration needed
“AgroFlow, by MafiHub. Practical irrigation decisions, grounded in field data.”

### Issues / observations
None.

## 04:48.130 – 04:53.240

*Segment 101*

### What is visible
Teal rule, “University of Cape Town · School of IT Showcase 2026”, “INF3003W · Team 2”. Static hold to the end; audio silent from 290.0 s.

### What changes
Rule draws (287.8 s); lines fade in (288.1, 288.4 s); hold.

### On-screen text
University of Cape Town · School of IT Showcase 2026 · INF3003W · Team 2

### What the viewer should understand
Event and team.

### Narration needed
(silence)

### Issues / observations
≈3 s of silent hold at the end; fine for a presenter to speak over or to cut on.

---

# Feature coverage — what this render actually shows

| Feature | Visible? | Where |
|---|---|---|
| Field-based concept (field, irrigation zones, root zone) | Yes | 0:00 field; “One kit per irrigation zone” 0:34; root-zone gauge 1:50; “Tomato field · root zone” 2:46 |
| Realistic 3D controller | **No** | No 3D model exists in the repo; a flat 2D illustration labelled “Illustration · not a photograph” (0:34–0:58) |
| Controller internals (closed → open) | Yes (illustration) | 0:35 closed, 0:36.5 opens |
| ESP32 · relay · Soil Moisture Sensor (YL-69 resistive) · DHT11 · pump · 5 V power · cable glands | Yes (illustration) | 0:37–0:47 |
| Farmer mobile app (real UI) | Yes | 1:14–4:11 |
| Actionable recommendation with amount, litres, runtime | Yes | 1:18–1:30 (35 mm · 1,750 L · ≈70 min, with arithmetic) |
| “Why am I seeing this?” | Yes | 2:02 (mobile sheet), 2:10 (admin technical line), 3:41 (Telegram) |
| FAO-56 explanation | Yes | 1:36–2:00 |
| Farmer autonomy / manual logging | Yes | 2:19–2:35 (“I watered” 1,500 L, soil feel) |
| Irrigate / Adjust / Postpone / Skip buttons | **No** | Not in the product; real controls named on chips at 2:33 |
| Phone initiating irrigation | Yes | 2:36–2:46 (manual run, validation, confirm) |
| Water pump · water flow · soil wetting | Partly | 2:46–2:56 (pump node and “Pump on” chip; dashes on the pipe; soil strip darkens). No pump drawing at the field, **no sprinklers** |
| Rolling 7-day outlook | Yes | 2:56–3:15 (real week-ahead screen + projection chart) |
| Weather change / rain changing the plan | Yes | 3:15–3:38 |
| Weather alerts | Yes | 3:38–3:42 (Telegram text + Why) |
| Sensor disagreement (“check the field: wetter than estimate”) | **No** | Not in the product; 3:42–3:55 shows the real sensor/kit checks and the soil-feel check instead |
| Admin console | Yes | 4:15–4:32 (Home, Requests, Farm detail, Run advice, Kits, Alerts, Maintenance, Reports, Activity) |
| Public website | Yes | 4:11–4:15 |
| Experience AgroFlow interactive demo | **No** | Does not exist on any branch |
| Sense → Understand → Act → Monitor | Yes | 4:40–4:43 (on screen ≈1 s in full) |

# Story check

FIELD (0:00) → SENSING (0:34) → [architecture 0:58] → WEATHER + CROP CONTEXT (1:36–1:47) → FAO-56 (1:36–2:00) →
ACTIONABLE RECOMMENDATION (1:14, before the science) → FARMER DECIDES (2:19) → IRRIGATION (2:36) → MONITORING (2:52
History) → WEATHER CHANGES (3:15) → PLAN UPDATES (3:20) → [alerts/sensor 3:38, setup 3:55] → ADMIN (4:11) → summary.

- The recommendation is shown **before** the science (1:14 → 1:36). This works (answer first, then “how”), but the
  narration should bridge it explicitly (“Behind that recommendation…”).
- **Abrupt jumps:** 2:35 → 2:36 (from “I watered 1,500 L — no watering needed” straight to starting a 5-minute run on
  the same field; the viewer may ask why the farmer runs the pump again). 3:55 → 3:56 (from sensor checks to the maize
  block, a different zone, with no bridge). 4:11 (farmer → admin is introduced only by the caption).
- **Monitoring** is thin: only the History screen (2:52) and the sensor checks (3:42). There is no shot of readings
  changing after irrigation (the app has no live relay state).
- **Weather change** is the clearest part of the story: same chart, banner, recalculation, updated plan.

# Overall review

## What works well
- One consistent scenario and set of numbers across the farmer app, the science diagram, the Why sheet and the
  admin Run-advice drawer (Dr 35 mm, RAW 31.5 mm, ETo 5.8, Kc 1.09, ETc 6.4, 1,750 L, 70 min).
- Real, current UI throughout the app and admin sections, consistently tagged (real / conceptual / illustration).
- The recommendation is concrete (amount, litres, runtime) and the conversion arithmetic is on screen.
- Farmer autonomy is explicit (“AgroFlow recommends. The farmer decides.”) and backed by a real logging action.
- The weather-update sequence (3:15–3:38) shows recalculation, not a reset, and the four-outcome rain logic.
- Honest labelling of what is simulated (sped-up visualisation; illustration, not a photograph; no flow meter).

## What is unclear
- Why the pump run is 5 minutes when the advice was 70 minutes (only a small chip explains the showcase-kit cap).
- Why the farmer starts a pump run right after logging that they watered (2:35 → 2:36).
- The Telegram text “AgroFlow does not pause automatic watering for rain yet” (3:38) next to “the plan recalculates”.
- The root-zone gauge fills from the top (“used up”), which can be read as soil level rising.
- The landing page's “Automatic watering … the pump can run on its own” (4:11) vs “the farmer decides”.

## Scenes that are too fast
- Admin tour 4:23–4:30: Run advice 1.6 s, Kits 1.1 s, Alerts 0.95 s, Maintenance 1.05 s, Reports 1.2 s; Requests 1.8 s.
- Telegram “Why” explanation 3:41.1–3:42.3 (≈1 s).
- Final SENSE → UNDERSTAND → ACT → MONITOR, complete for ≈1 s (4:41.9–4:43.0).
- “Water today” conclusion chip 2:17.1–2:18.4 (≈1.3 s).
- The problem questions 0:11–0:15 (four cards in 3.6 s) — fine visually, tight for narration.

## Scenes that are too slow
- 0:20.9–0:24.4 and 1:36.0–1:39.5: a heading over an empty frame for ~3.5 s.
- 0:47–0:58: kit illustration held ~5 s after the last chip.
- 3:32.7–3:37.9: rule cards held ~4.6 s.
- 3:55.5–4:00.1: phone with no highlight for ~4.6 s.

## Missing explanations
- The 5-minute firmware cap vs the 70-minute advice; field-scale watering is applied by the farmer and logged.
- What “depletion” means in plain words (the visuals use “Used up”, the narration should too).
- That the 7-day lines in the real app are rain-based for future days (“Check the soil that morning”), while the chart
  is the engine's projection — the chart is labelled a visualisation, but the narration could say “the engine projects”.
- That a mode (automatic / scheduled / manual) is the farmer's choice.

## Visuals that do not match narration
- 2:46–2:48: command animation starts while the phone still shows the confirm dialog.
- 2:53: narration (current) says “it appears in the history”; the highlight is on “Start Command Sent”, not the
  irrigation record, and “Irrigation ran for 0 minutes” is visible below it.
- 2:58: the week screen's Today row says “Water likely needed” while the chart's Today says “Watered · 1,500 L logged”.
- 1:14 (current narration “Our farmer opens the app”): the phone is already on Home; no opening is shown.
- 0:34–0:58 (brief: “realistic 3D controller”): the video shows a flat illustration — correctly labelled.

## Claims that need softer wording
- “A published, peer-reviewed calculation” (0:28) → “an internationally used FAO method”.
- “Advice is never blocked” (3:56) → “AgroFlow still advises when setup is incomplete” (true per the code, but absolute).
- “Decision-relevant warnings, where farmers already are” (3:38) → fine, but only for farmers who linked Telegram.
- Current narration “The firmware stops any pump run after five minutes” is accurate; avoid implying the kit
  waters a whole field in one run.
- No AI, yield or savings claims appear — good.

## Strongest showcase moments
1. 1:18–1:30 — WATER TODAY: 35 mm · 1,750 L · ≈70 min with the arithmetic.
2. 3:15–3:27 — HEAVY RAIN EXPECTED → RECALCULATING → PLAN UPDATED on the same chart.
3. 2:19–2:33 — AgroFlow recommends, the farmer decides: 1,500 L logged, advice updates.
4. 2:08–2:19 — the reasoning in numbers with the admin's real technical line.
5. 4:20–4:24 — the admin sees exactly the farmer's advice, and the engine's numbers on demand.

## Recommended final edits before submission
1. Replace the voice-over with `narration-final.md` (≈140–155 wpm; current is ≈171 wpm) or present live from
   `presenter-script.md` with the video muted.
2. Fix the pump-run sequence: start the command animation after the confirm dialog closes (≈168.3 s), and add one
   line explaining the 5-minute showcase-kit cap; consider bridging from “I watered” (e.g. “On a zone where the kit
   controls the pump…”).
3. Re-capture History so the litres-only entry does not read “Irrigation ran for 0 minutes” (or crop/highlight the
   5-minute record), and highlight the irrigation record the narration refers to.
4. Slow the admin tour (≥2 s per page, or drop Maintenance/Reports) and hold SENSE → UNDERSTAND → ACT → MONITOR
   and the Telegram “Why” card for at least 2–3 s each.
5. Change “A published, peer-reviewed calculation” to “An internationally used FAO method”, and fill the two empty
   3.5 s heading-only frames (0:21, 1:36) by bringing the first element in sooner.

*Meaningful visual segments identified: 101.*
