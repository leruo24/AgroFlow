# AgroFlow showcase v4: voice-over script

Video length 4:43.37 (283.37 s), 1920×1080, 25 fps. The picture is fixed: every line has a start time and a time slot.
Each line's slot is long enough to read it at about **140 words a minute**. The guide voice in
`AgroFlow_v4_GUIDE.mp4` is a computer voice for timing only; record your own and replace it
(see `VOICEOVER_README.md`).

Times are `minutes:seconds` from the start of the video. **In** is when your first word should start;
**Out** is when you should be finished by (the next line starts there, or the scene changes).

| Speaker | Lines |
|---|---|
| Leruo | 1 problem, 6 field kit, 9 execution, 10 weather change, 13 testing, close line b |
| Olwethu | 2 enquiry, 3 call-back, 11 reports, 12 admin view, close line d |
| Philisile | 4 onboarding, 5 Telegram and first sign-in, close line c |
| Lubaelihle | 7 zone setup in the app, 8 daily use, close line a |

## 1. The problem · Leruo

- File: `vo-team/s01_leruo.wav`
- Scene: 0:00.00 – 0:15.83
- In: **0:02.60** · Out by: **0:15.83** (slot 13.2 s)
- Words: 29 · target at 140 wpm: 12.4 s · guide voice: 12.29 s

> On many small farms, watering is guesswork. Too much wastes water and electricity; too little stresses the crop. AgroFlow helps a farmer decide when to irrigate, and how much.

## 2. The enquiry · Olwethu

- File: `vo-team/s02_olwethu.wav`
- Scene: 0:15.83 – 0:34.70
- In: **0:16.33** · Out by: **0:34.70** (slot 18.4 s)
- Words: 41 · target at 140 wpm: 17.6 s · guide voice: 15.9 s

> Meet Thabo, one of our personas: a tomato farmer near Mafikeng, with one field split into two irrigation zones. He asks for a call back on the AgroFlow website. If he mistypes his phone number, the form tells him straight away.

## 3. The call-back · Olwethu

- File: `vo-team/s03_olwethu.wav`
- Scene: 0:34.70 – 0:53.14
- In: **0:35.20** · Out by: **0:53.14** (slot 17.9 s)
- Words: 40 · target at 140 wpm: 17.1 s · guide voice: 16.24 s

> Naledi, our second persona, is a field officer. Telegram tells her a new enquiry has arrived. In the Enquiries tab she taps "I'll handle this", so nobody else calls him too. After the call, she logs it: Thabo wants AgroFlow.

## 4. Onboarding · Philisile

- File: `vo-team/s04_philisile.wav`
- Scene: 0:53.14 – 1:12.44
- In: **0:53.64** · Out by: **1:12.44** (slot 18.8 s)
- Words: 42 · target at 140 wpm: 18.0 s · guide voice: 15.83 s

> She starts onboarding straight from the enquiry, so Thabo's details are already filled in. She adds his farm and both zones, with crop, soil and size. The enquiry then shows he became a farmer, and the activity log records who did it.

## 5. Telegram and first sign-in · Philisile

- File: `vo-team/s05_philisile.wav`
- Scene: 1:12.44 – 1:32.60
- In: **1:12.94** · Out by: **1:32.60** (slot 19.7 s)
- Words: 44 · target at 140 wpm: 18.9 s · guide voice: 16.79 s

> To hand over, Naledi shows a QR code. Thabo scans it and presses Start in the AgroFlow Telegram bot, which sends his sign-in email, a temporary password and the app link. When he first signs in, the app makes him choose his own password.

## 6. The field kit · Leruo

- File: `vo-team/s06_leruo.wav`
- Scene: 1:32.60 – 1:58.76
- In: **1:33.10** · Out by: **1:58.76** (slot 25.7 s)
- Words: 58 · target at 140 wpm: 24.9 s · guide voice: 23.13 s

> Next, the field kit: an ESP32 board, a Soil Moisture Sensor, a temperature and humidity sensor, and a relay for the pump. Naledi registers the kit to Zone 1 and gets a one-time code. On site, the installer joins the kit's setup Wi-Fi, enters the farm Wi-Fi and the code, and the kit links itself to the zone.

## 7. Zone setup in the app · Lubaelihle

- File: `vo-team/s07_luba.wav`
- Scene: 1:58.76 – 2:23.20
- In: **1:59.26** · Out by: **2:23.20** (slot 23.9 s)
- Words: 54 · target at 140 wpm: 23.1 s · guide voice: 19.21 s

> In the app, Thabo finishes each zone's setup. For the flow rate, he times how long his tap takes to fill a 500 millilitre bottle. Then he teaches the sensor his soil, with a wet and a dry reading on different days. With each step, the advice gets surer: from medium to high confidence.

## 8. Daily use · Lubaelihle

- File: `vo-team/s08_luba.wav`
- Scene: 2:23.20 – 2:45.50
- In: **2:23.70** · Out by: **2:45.50** (slot 21.8 s)
- Words: 49 · target at 140 wpm: 21.0 s · guide voice: 19.57 s

> Every day, Home shows one action per zone. Today, Zone 1 needs about 66 minutes of water, or 996 litres, with high confidence. "Why am I seeing this?" shows the reasons: the weather, the crop's stage and the water left in the soil. The week ahead plans each day.

## 9. Execution · Leruo

- File: `vo-team/s09_leruo.wav`
- Scene: 2:45.50 – 3:10.37
- In: **2:46.00** · Out by: **3:10.37** (slot 24.4 s)
- Words: 55 · target at 140 wpm: 23.6 s · guide voice: 21.32 s

> AgroFlow recommends; Thabo decides. He starts a run from the app. The command reaches the kit over MQTT, the relay switches the pump on, and the kit reports the run back. For safety, the kit never runs the pump for more than five minutes at a time. Our website demo shows this as a visualisation.

## 10. The weather changes · Leruo

- File: `vo-team/s10_leruo.wav`
- Scene: 3:10.37 – 3:31.81
- In: **3:10.87** · Out by: **3:31.81** (slot 20.9 s)
- Words: 47 · target at 140 wpm: 20.1 s · guide voice: 18.53 s

> Then the forecast changes: 24 millimetres of rain tomorrow. AgroFlow works the plan out again, and Zone 2 no longer needs water on Monday. If rain covers the crop's need, it says wait; if it only helps, it says water less. Thabo also gets a Telegram alert.

## 11. Reports · Olwethu

- File: `vo-team/s11_olwethu.wav`
- Scene: 3:31.81 – 3:49.82
- In: **3:32.31** · Out by: **3:49.82** (slot 17.5 s)
- Words: 39 · target at 140 wpm: 16.7 s · guide voice: 16.52 s

> Reports start with what to do next. Thabo makes his as a PDF in the app, and automatic ones arrive on Telegram. Naledi can preview a farm's report, download PDF or Excel, and schedule daily, weekly or monthly reports.

## 12. Naledi's admin view · Olwethu

- File: `vo-team/s12_olwethu.wav`
- Scene: 3:49.82 – 4:05.69
- In: **3:50.32** · Out by: **4:05.69** (slot 15.4 s)
- Words: 34 · target at 140 wpm: 14.6 s · guide voice: 14.4 s

> For Naledi, Home shows what needs attention across every farm: new requests, quiet kits and farmers without Telegram. Every action is logged, so a small team can look after many farms without losing track.

## 13. Testing and validation · Leruo

- File: `vo-team/s13_leruo.wav`
- Scene: 4:05.69 – 4:27.13
- In: **4:06.19** · Out by: **4:27.13** (slot 20.9 s)
- Words: 44 · target at 140 wpm: 18.9 s · guide voice: 20.04 s

> We tested as we built. Forms reject bad input, like a wrong phone number or a run over 60 minutes. In our local test runs on 9 and 10 October, all 1,301 backend tests, all 112 admin tests and all 64 mobile tests passed.

## 14. Close · Lubaelihle (a)

- File: `vo-team/s14a_luba.wav`
- Scene: 4:27.13 – 4:43.37
- In: **4:27.73** · Out by: **4:31.04** (slot 3.3 s)
- Words: 5 · target at 140 wpm: 2.1 s · guide voice: 2.86 s

> AgroFlow recommends. The farmer decides.

## 14. Close · Leruo (b)

- File: `vo-team/s14b_leruo.wav`
- Scene: 4:27.13 – 4:43.37
- In: **4:31.04** · Out by: **4:34.49** (slot 3.4 s)
- Words: 7 · target at 140 wpm: 3.0 s · guide voice: 2.1 s

> Every number traces back to its source.

## 14. Close · Philisile (c)

- File: `vo-team/s14c_philisile.wav`
- Scene: 4:27.13 – 4:43.37
- In: **4:34.49** · Out by: **4:39.01** (slot 4.5 s)
- Words: 6 · target at 140 wpm: 2.6 s · guide voice: 4.07 s

> Built by Team 2 for INF3003W.

## 14. Close · Olwethu (d)

- File: `vo-team/s14d_olwethu.wav`
- Scene: 4:27.13 – 4:43.37
- In: **4:39.01** · Out by: **4:43.37** (slot 4.4 s)
- Words: 4 · target at 140 wpm: 1.7 s · guide voice: 1.16 s

> Thank you for watching.

## Close (scene 14) as sub-cues

The close has four speakers, one line each, so it is four files with their own start times:
`s14a_luba.wav`, `s14b_leruo.wav`, `s14c_philisile.wav`, `s14d_olwethu.wav` (times above).
