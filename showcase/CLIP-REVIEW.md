# Clip-by-clip review — AgroFlow Showcase demo (v2)

**Final video:** `renders/INF3003W_Team2_ShowcaseDemo_2026.mp4`. It runs 4:50: 4:20 of demo plus 30 s of editor end space.
**Per-clip files:** `renders/clips/01-title.mp4` … `renders/clips/10-endplate.mp4`, one file per row below. Each can be watched and changed on its own.
**Voiceover:** included. It is a generated voice (local Kokoro TTS, "Michael", US male) reading `narration.md`, with one file per paragraph in `assets/vo/`. To swap in a human narrator, replace those files and keep the names.

What the columns mean:
- **Matches your description?** compares the clip with the "How AgroFlow works" text you sent.
- **Changed in v2** is what this pass fixed.
- **You could change** lists open choices for the team.

Everything shown was checked against the code on branch `dev`. Where your description and the code disagree, the video follows the **code**; the full list of disagreements is at the bottom.

---

## 01 · Title — 0:00–0:10 (`01-title.mp4`)
| | |
|---|---|
| On screen | Network nodes draw, a water line flows, the AgroFlow icon. "AGROFLOW · Smart Irrigation Management System · UCT School of IT Showcase 2026 · INF3003W · Team 2". |
| Narration | "This is AgroFlow, a smart irrigation system, built by Team 2 for INF3003W." |
| Matches your description? | Yes. |
| Changed in v2 | Nothing. |
| You could change | Add the team name "2 Much Sauce" and the four member names from the essay, if the showcase allows names. |

## 02 · Persona & problem — 0:10–0:30 (`02-persona.mp4`)
| | |
|---|---|
| On screen | "MEET OUR FARMER — Smallholder Farmer". Three zones: Tomato 46%, Spinach 19%, Maize 41%. Zone 2 dries out and "ZONE 2 NEEDS ATTENTION" appears. The field folds into a phone showing the app's opening screen. *(Conceptual graphic.)* |
| Narration | Watering by habit; each crop dries at its own pace; Zone 2 needs attention. |
| Matches your description? | **Yes, now.** Your problem statement is "watering by habit". |
| Changed in v2 | The line is now "Watering by habit — the same amount on the same days — over-waters one zone and leaves another dry." The phone now hands off to the app's opening screen instead of the sign-in screen. |
| You could change | Give the farmer a name or a location if you have real persona research. Nothing was invented. |

## 03 · Farmer opens the app — 0:30–1:00 (`03-open-app.mp4`)
| | |
|---|---|
| On screen | **Real app.** The farmer, already signed in, opens AgroFlow. Home appears and **Drip**, the raindrop helper, says *"Water Zone 2 now: about 5 min (~8 L)."* (highlighted). Then the weather and farm status (1 unread alert), the "?" help in the header, Manage Irrigation → all zones, and Zone 2 "Health: Critical · 19%" → Manage Zone. |
| Narration | Drip points at the one thing that matters today; weather; one unread alert; every zone; Zone 2 is critical. |
| Matches your description? | **Mostly.** The Drip greeting is real and is the app's "one clear action". **Difference:** your text says Home shows *one action per zone*. The code shows **one** message: Drip picks the single most important item (`DripHelper.decideMessage`: act-now advice, then unread alerts, then water-soon, then unfinished setup). Home has no per-zone action list. |
| Changed in v2 | Re-recorded. The sign-in was replaced by opening the app with Drip, because that is how your description starts the day. |
| You could change | If the team wants the sign-in back (security), it can go here, but Drip then has to stay off: straight after a fresh sign-in, Drip can greet before the zones load and wrongly say "All your zones look good today". That bug is reproduced and listed below. |

## 04 · Understanding the zone — 1:00–1:35 (`04-zone.mp4`)
| | |
|---|---|
| On screen | **Real app**, zoomed in: Soil moisture 19% **Dry**, 30°C, 36%. Then a conceptual diagram: soil probe + DHT11 → ESP32 kit → MQTT/TLS (HiveMQ Cloud) → AgroFlow.Api **on Railway** → Supabase. Caption: "Each kit sends its readings about every 30 seconds. The service stores them and updates the zone's health." Back in the app: crop and growth stage. |
| Narration | Readings from the kit, about every 30 seconds, over secure MQTT; the service on Railway stores them in Supabase. |
| Matches your description? | **Yes.** Your data path is "every 30 s → HiveMQ → server on Railway → Supabase". |
| Changed in v2 | Added "on Railway" and "one kit per zone". The 30-second line now describes the kit, which matches the firmware's `SENSOR_REPORT_INTERVAL_MS = 30000`. |
| You could change | The essay says out-of-range readings are "stored but flagged and excluded". **That could not be found in the code**, so it was left out. If it exists under another name, tell me and it can be added. |

## 05 · How AgroFlow works out the advice — 1:35–2:13 (`05-advice.mp4`)
| | |
|---|---|
| On screen | Conceptual graphic of **FAO-56 in four steps**: ① Weather thirst (Penman-Monteith reference ET from temperature, humidity and wind; sunlight estimated), ② Crop stage (spinach, development), ③ Soil & roots (what the plant can reach), ④ Daily tally ("a water bank balance"). Two checks: **Reality check** (a calibrated soil sensor sets the starting balance) and **Rain check** (forecast rain that covers the day's need → skip). Result: "Water Zone 2 now: about 5 min (~8 L)", with the deficit turned into litres for the area and into minutes at 1.5 L/min. Tag: "FAO-56 · a deterministic calculation — not AI". Then the **real app**: the Advice card and the 7-day forecast ("No rain expected"). |
| Narration | The four steps, the safe limit, the sensor keeping the tally honest, rain-skip, not AI, about five minutes and about eight litres. |
| Matches your description? | **Yes, now.** It is your 4-step "brain" with the sensor reality check and rain-skip. Each step was checked in code: `PenmanMonteithEto.cs`, `SoilWaterBalance.cs` (Kc, TAW/RAW, root depth), `Fao56Engine.cs` (anchoring to the sensor, `RecommendedMinutes` from the flow rate), `ZoneInsightBuilder.cs` (`skip_rain`). |
| Changed in v2 | Rebuilt. v1 showed only "four inputs → FAO-56 → advice". |
| You could change | **Confidence levels and "Why am I seeing this?" are NOT shown, because they are not in the code** (see the bottom list). If they get built before the showcase, this is the clip to add them to. |

## 06 · Taking action — 2:13–3:06 (`06-act.mp4`)
| | |
|---|---|
| On screen | **Real app.** Zone 2 is switched from Scheduled to Manual. The farmer types **90** and taps Start, and the app dialog says "Invalid Duration — Enter a duration between 1 and 60 minutes." (INPUT VALIDATED). They correct it to **5**, confirm "Run irrigation for 5 minutes?", and see "Manual command sent". Conceptual command path: app → AgroFlow.Api (checks & saves `irrigation_commands`) → Supabase notifies → MQTT → ESP32 relay → pump on for 5 min. "IRRIGATION EVENT RECORDED · POST /api/irrigation-events · runtime 300 s". **Real app** History: "Irrigation ran for 5 minutes · Zone 2 · manual". |
| Narration | Scheduled → manual; 90 rejected; 5 accepted; the command travels back; the run is recorded; History. |
| Matches your description? | **Yes, for the manual path.** Your "day in the life" is about *automatic* watering, while this clip shows a manual run, because the brief needs a real input-validation moment. Automatic watering exists, but it is driven by the moisture thresholds (start below the start level, stop at the stop level, `SensorReadingProcessor`), **not "in bursts at 6 am"**. |
| Changed in v2 | Nothing; it was already accurate. Only its place in the video moved. |
| You could change | (a) Add one sentence that in Automatic mode the kit starts and stops by itself at the zone's levels. (b) Real app issue: the app allows 1–60 minutes, but the firmware stops every run at 5 minutes. The demo uses 5 so it stays true. |

## 07 · Platform administrator — 3:06–3:50 (`07-admin.mp4`)
| | |
|---|---|
| On screen | **Real admin console.** "One farmer's action ↓ One connected platform", then:<br>1. **Home**: needs attention, key numbers, system health.<br>2. **Requests**: farmers' requests for a new farm or zone, pending → scheduled → completed.<br>3. **Kits**: Zone 2's kit online, last seen, token, MQTT login, plus the **remote actions Change WiFi · Open setup page · Revoke**.<br>4. **Alerts**: the Zone 2 critical alert and its detail.<br>5. **Reports**: "Farm Reports (live data)", with PDF and Excel and water estimated from pump time × flow rate.<br>6. **Activity**: every administrator action recorded.<br>Then the console at phone width, and "Farmers manage their farms. Administrators oversee the platform." |
| Narration | Needs attention; requests; kit connection and remote Wi-Fi/setup/revoke; the alert; PDF/Excel reports; the audit trail; phone size. |
| Matches your description? | **Mostly, now.** Home "Needs attention", Kits remote actions, Reports PDF/Excel and Activity all match. **Differences** (not in the code, so not shown): the public "Get a call back" enquiry form, call outcomes with required reasons, "I'll handle this", and POPIA consent/erasure. The **Requests** page in the code holds farm/zone service requests, not sales enquiries. |
| Changed in v2 | Re-recorded. **Maintenance was removed**: its scheduling only lasts for the browser session and it is not in your description. **Requests, the kit remote actions and Reports were added.** The farm drawer was cut for time. |
| You could change | Show the farmer/farm/zone **wizards** (they exist, with a map step) if you want onboarding in the demo; that would cost about 8–10 s. On the Reports page, the top charts and the "Platform Availability" figure are empty or hard-coded in the code, so the clip scrolls past them to the live reports. |

## 08 · The complete system & kit safety — 3:50–4:12 (`08-system.mp4`)
| | |
|---|---|
| On screen | Conceptual diagram:<br>- **Field**: sensors, ESP32 kit, relay & pump, safety limits.<br>- **Platform**: MQTT/TLS; AgroFlow.Api on Railway; Supabase; FAO-56; Open-Meteo; **Telegram alerts & PDF reports**.<br>- **Farmer**: advice, action, history, reports.<br>- **Administrator**: requests, kits, alerts, reports.<br>Then **"The kit stays safe, even offline."**<br>- 5-minute cap on every run.<br>- A key per kit; a revoked kit wipes itself.<br>- After 10 min offline it waters itself (runs ≤ 60 s, 5 min rest), and control returns on reconnect.<br>Then SENSE · UNDERSTAND · ACT · MONITOR. |
| Narration | Kits, platform, Telegram, app and console; the kit is safe on its own; sense, understand, act, monitor. |
| Matches your description? | **Yes.** It is your "kit protections" paragraph, with the firmware's own values (`SAFETY_MAX_RUN_MS`, `OFFLINE_FALLBACK_AFTER_MS`, `FALLBACK_MAX_RUN_MS`, `FALLBACK_MIN_REST_MS`, `MAX_AUTH_FAILURES`). |
| Changed in v2 | Added Railway, Telegram, the safety limits, and the whole safety card. |
| You could change | Kit setup (enrollment code, the "AgroFlow-Setup-XXXX" Wi-Fi, 3 power-cycles to open setup, 5 to wipe) is real in the firmware but not shown. It would need its own ~10 s graphic, because there is no screen to record. |

## 09 · Close — 4:12–4:20 (`09-close.mp4`)
| | |
|---|---|
| On screen | The farmer's Home pulls back into the brand: "AGROFLOW — From field conditions to informed irrigation." |
| Narration | "AgroFlow: from field conditions to informed irrigation." |
| Matches your description? | Yes. |
| Changed in v2 | Nothing; it was retimed only. |
| You could change | The tagline wording. |

## 10 · Editor end plate — 4:20–4:50 (`10-endplate.mp4`)
| | |
|---|---|
| On screen | A small AgroFlow mark bottom-left on a clean background, for the showcase editor's own end card. No narration. |
| Matches your description? | n/a. |
| Changed in v2 | Nothing; it was retimed only. |

---

## Your description vs. the code on `dev` (searched across `apps/`, `backend/`, `hardware/`, `supabase/`)

**Not found in the code, so not in the video.** These are probably planned or in progress. If any exist on another branch, send it and I'll check.
1. **"Why am I seeing this?"** button: no match anywhere.
2. **Confidence levels (high / medium / low)** on advice: no "confidence" anywhere in the apps or backend.
3. **"I'll handle this"** / claim-based work: no match.
4. **Public "Get a call back" enquiry form**, **call outcomes** (wants AgroFlow / call back later / no answer / not interested) and **required reasons**: the landing page (`welcome.ts`) has no enquiry form, and Requests holds farm/zone service requests only.
5. **POPIA consent and erasure**: no "POPIA" anywhere.
6. **Logging by hand** ("I watered" / "the soil feels dry"): not found.
7. **Telegram "Why" button**: Telegram messages have no inline buttons.
8. **Automatic watering "in bursts at 6 am"** and the text **"Watered this morning, about 3 L. Next watering likely Thursday."**: automatic mode reacts to the moisture levels. Only Scheduled mode runs at a set time. A "Next watering" line exists only in the PDF reports and the advisor text.
9. **Home with one action per zone**: Home shows one Drip message for the whole farm (see clip 03).

**Exists but is not shown (time):**
- kit setup / enrollment / setup Wi-Fi / power-cycle gestures (firmware)
- Change Wi-Fi from the **mobile** app (`zone-hardware.tsx`; shown in admin instead)
- mobile PDF reports (`reports.tsx`)
- "Reset to recommended" levels (`ResetRecommendedButton.tsx`)
- the other insights, such as "pump ran but soil didn't get wetter" (`watering_failed`)
- admin wizards with map
- Telegram linking ("Connect Telegram")

**Found while recording (app issues, worth fixing before the showcase):**
- Straight after a fresh sign-in, Drip can greet before the zones load and say "All your zones look good today" even when a zone is Critical (`DripHelper`: `ready` is true while `zones` is still `[]`). Reproduced in this session.
- Admin Requests always prints the size in "ha", but the farmer's request form ("Rough size", placeholder "e.g. 2.5") states no unit, so the size of a zone request is ambiguous. The demo zone request uses 0.02 ha so it reads sensibly.
- Admin Reports: "Platform Availability" is hard-coded to 0, and the growth charts are empty. The "Generate" cards only show a toast; the real reports are in "Farm Reports (live data)".
- App manual limit 1–60 min vs. the 5-minute firmware cap (see clip 06).
- Earlier findings still stand: a stored `manual` mode is shown as "Automatic" after reload; admin alert/maintenance changes are session-only; raw timestamps and a mis-encoded ellipsis in the admin.
