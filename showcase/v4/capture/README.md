# v4 captures

Everything the v4 video shows comes from here. The apps are the **real, unmodified** AgroFlow
apps run locally with demo-only hosts (`https://api.demo.local`, `https://demo.supabase.co`);
the scripts answer every network call with demo data for the personas **Thabo (demo)** (farmer)
and **Naledi Demo** (field officer). No real people. Every phone number (`000 000 000x`),
email (`*@demo.invalid`), password (`DEMO-ONLY-0000`), code (`DEMO0000`, `DEMO-0000`) and link
(`t.me/AgroFlowDemoBot`, `demo.invalid`) is an obvious fake.

Advice text and numbers come from AgroFlow's own engine (`Fao56Engine`, `ZoneInsightBuilder`,
`TodayRules`, `Explanations`), run on the demo inputs by `engine/Program.cs.txt`.

## Demo story inputs (engine/Program.cs.txt)

Thabo's Farm (demo), near Mafikeng (lat −25.85, 1,270 m). One field, two irrigation zones, tomato on
loam, 20 m² each, tap flow 15 L/min (500 mL bottle in 2 s), sensor wet/dry 1200/3000.
Zone 1 planted 62 days ago, last watered 30 mm 4 days ago; Zone 2 planted 34 days ago, 25 mm 1 day ago.
The 14 days before were hot and dry (15–31 °C). Today is Sat 10 Oct 2026.

| File | Scenario | Result used in the video |
|---|---|---|
| `engine/scenario-S-setup-incomplete.json` | no flow rate, no wet/dry setup | Medium confidence, “Water about 996 L this morning” |
| `engine/scenario-S2-flow-set.json` | flow rate saved, no wet/dry setup | Medium: “the soil sensor has not been set up” |
| `engine/scenario-A-dry.json` | fully set up, dry week | Zone 1 “Water about 66.4 min (about 996 L) this morning”, High; Zone 2 “next on Monday” (Mon: about 38.9 mm) |
| `engine/scenario-B-rain-sunday.json` | 24 mm tomorrow, 6 mm the day after | Zone 2: no irrigation expected all week |
| `engine/scenario-C-rain-4mm-today.json` | 4 mm today | Zone 1 “Rain helps, but water about 60.2 min (about 904 L) this morning” |
| `engine/scenario-C-rain-12mm-today.json` | 12 mm today | Zone 1 “No watering today: rain is expected to cover it.” |

Check: 49.8 mm × 20 m² = 996 L; 996 L ÷ 15 L/min = 66.4 min.

## Files in raw/

| File(s) | Source |
|---|---|
| `web-hero.png`, `web-enquiry-top.png`, `web-enquiry-error.png`, `web-enquiry-filled.png`, `web-enquiry-thanks.png` | Public website (`apps/web/admin`, landing page) by `scripts/web.mjs`; enquiry POST mocked, bad phone “082 12”, fixed to a fake number |
| `web-hw-open.png`, `web-hw-closed.png` | Website 3D controller model (`[data-hardware-showcase]`) by `scripts/web.mjs` |
| `web-experience.mp4` (+ `.events.json`) | Website “Experience AgroFlow” demo, real-time CDP screencast by `scripts/web.mjs`. Contains that demo's own figures (8 mm, 1,600 L); **never shown uncropped** |
| `web-experience-field.mp4`, `web-experience-field-slow.mp4` | Crop of the above to the field and controller only (no card, phone or figures); the slow one is 1.5× slower. ffmpeg commands below |
| `a-*.png` | Admin console (`apps/web/admin`) signed in as Naledi Demo, by `scripts/admin.mjs` (`enquiry`, `kit`, `pages` modes) |
| `m-*.png` | Farmer app (`apps/mobile`, Expo web, 390×844 phone viewport) signed in as Thabo, by `scripts/mobile.mjs` (`login`, `setup`, `daily`, `rain`, `run`, `reports` modes) |
| `thabo-water-usage.pdf`, `thabo-report-p1-1.png` | AgroFlow's own report renderer (`ActionReportPdf.Render`) on the same engine inputs, by `engine/ReportHarness.cs.txt`; page 1 rendered with `pdftoppm -r 110` |

Not used in the video: `a-kit-wizard-4.png` (the real kit-type card says “flow metering”, hardware this
prototype does not have), `a-kit-wizard-2.png`, `a-page-farms.png`, `a-page-alerts.png`, `a-page-hardware.png`,
`a-dashboard-before.png`, `m-zone.png` (its “Flow Rate” tile could be read as a flow meter), `m-card-*.png`, `*-full.png`.

The docs/sample-reports PDFs were **not** used: they say “Tub 1”.

## Mocked or illustrated (labelled on screen)

- **Telegram chats**: no screenshot of the real bot was available without private data, so the video
  builds the chat in HTML with the exact text the code sends: `EnquiryRules.AdminMessage`,
  `TelegramNotificationService` welcome and heavy-rain messages, `AlertExplanations.Weather`,
  `TelegramClient.WhyButtonText`. The temporary password is blurred as well as fake. The app-link line
  uses a fake URL (`https://demo.invalid/agroflow.apk`).
- **Kit setup page**: it runs on the ESP32, so it is an illustration. Network name `AgroFlow-Setup-XXXX`
  and the field “Enrollment Code (from admin)” come from `hardware/esp32/AgroFlowIrrigationNode`.
- **App dialogs** (“Invalid Duration”, “Start Manual Irrigation?”): the app's own `Alert` text from
  `apps/mobile/src/app/zone/[id].tsx`, drawn over the screenshot (browser alerts are not captured).

## Re-capturing

Start the apps as in `showcase/EDITING.md` (Expo web on :8098, Vite on :5173, demo hosts), then from
`showcase/v4/capture/scripts/`:

```
node web.mjs ; node admin.mjs enquiry ; node admin.mjs kit ; node admin.mjs pages ; node mobile.mjs login ; node mobile.mjs setup ; node mobile.mjs daily ; node mobile.mjs rain ; node mobile.mjs run ; node mobile.mjs reports
ffmpeg -ss 4 -i ../raw/web-experience.mp4 -t 7 -vf "crop=1000:960:600:115,fps=25,format=yuv420p" -an -c:v libx264 -crf 16 ../raw/web-experience-field.mp4
ffmpeg -i ../raw/web-experience-field.mp4 -vf "setpts=1.5*PTS,fps=25,format=yuv420p" -an -c:v libx264 -crf 16 ../raw/web-experience-field-slow.mp4
```

The engine and report harnesses are throwaway .NET 8 console projects: copy `*.csproj.txt` to a `.csproj`
and the `.cs.txt` to `Program.cs`. The report harness takes the assembly name `AgroFlow.Domain.Tests` only
to reach the API project's internal report classes.
