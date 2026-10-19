# Setup wizard (farmer app)

One step-by-step flow from first sign-in to "All set", replacing setup that was spread over
the forced password screen, Settings → Profile (Telegram), each zone's crop screen, the
"Finish setup" checklist and the soil calibration sheet. Code: `apps/mobile/src/app/setup.tsx`,
rules in `apps/mobile/src/lib/setupProgress.ts`, data in `apps/mobile/src/hooks/useSetup.ts`.

| Step | What the farmer does | Optional | Saved where |
|---|---|---|---|
| 1. Welcome | picks English, Afrikaans (beta) or Setswana (beta); the app changes at once | – | the app's one language setting (phone + profile, 0049) |
| 2. Your password | sets their own password (the first-login change, moved here); cannot be stepped past while the temporary one is in use | only once set | Supabase Auth, then `POST /api/farmer/password-changed` |
| 3. Telegram | connects the bot (the existing Connect button), or "I don't use Telegram" | yes | profile (link); phone (declined) |
| 4. Your zones | per zone: "Kit connected" / "Waiting for kit", the crop, about when it was planted (weeks + a day at a time) | yes | `PUT /api/farmer/zones/{id}/crop` |
| 5. Water flow | per zone: container size (litres or ml, no size assumed), big Start/Stop stopwatch, shows L/min | yes | `PUT /api/farmer/zones/{id}/setup` (flow rate) |
| 6. Teach AgroFlow your soil | per zone with a kit: dry reading now, wet reading later; meter Low → Medium → High | yes | `POST /api/farmer/zones/{id}/calibration` |
| 7. All set | done / still to do, and today's advice for each zone; "Go to my farm" | – | – |

- "Step X of 7" with a bar, **Back** on every step, **Do this later** on the optional ones, one
  sentence on why each step matters, and a short tip from Drip. Buttons are at least 48 px
  (most 52). The tab bar is hidden (the wizard is a stack screen). One column, at most 560 px
  wide, so 320–430 px phones and the web build both work.
- **Resume:** the farmer can leave at any step; `/setup` opens the first step not done. The
  server says what is done (crop, planting date, flow rate, kit, soil readings, Telegram,
  password); the phone keeps only the language confirmation, "I don't use Telegram", skipped
  steps, and entries made without a signal.
- **Errors:** no signal on the zones or flow step → "Saved on this phone. It will be sent when
  you're back online." (sent on reconnect); the soil readings need the kit to answer now, so
  offline they say "Needs a connection to reach your kit"; a kit that does not answer → the
  server's reason plus "You can carry on and do this later"; invalid input is said in words
  (container 0, timed for 2 s or less, passwords not matching).
- **Home:** "Setup 4/6 done — Continue" opens the wizard at the right step and is gone once
  setup is complete. After a dry reading it says "Soil: save the wet reading for Bed 1" — that
  is the wet-reading reminder.
- **Removed:** the Today card's "Finish setup" button, the `zone-setup` screen and the soil
  calibration sheet; the zone screen's "Finish setup" and "Teach the sensor your soil" rows
  open the wizard. **Settings → Redo setup** walks through every step again.

## Taps to finish setup (one zone with a kit, walkthrough)

| | Before | After |
|---|---|---|
| Password | 2 (Save, Continue) | 2 (Save, Continue) |
| Language | 2 (Settings tab, language) | 2 (language, Continue) |
| Telegram | 3 (Settings tab, Connect Telegram row, Connect on Profile) | 2 (Connect, Continue) |
| Crop and planting date | 7 (Irrigation tab, zone, Crop and planting date, crop, date, Save, Back) | 4 (crop, weeks, Confirm, Continue) |
| Flow rate | 5 (Home, Finish setup, flow item, Save, Back), with a marked 0.5 L bottle | 5 (size, Start, Stop, Save, Continue), any container |
| Soil (dry) | 5 (Irrigation tab, zone, Teach the sensor, Save dry, close) | 2 (Save dry, Continue) |
| Finish | – | 1 (Go to my farm) |
| **Total** | **24 taps, 5 different places** | **18 taps, one flow** |

The wet reading is one more tap either way, a day later (from Home's card now).

## Languages

The language in step 1 is the same setting as Settings → Language (Part B): one preference,
changed any time, applied at once, kept on the phone and on the profile (0049) so Telegram
messages follow it. All wizard text is in `apps/mobile/src/i18n/{en,af,tn}.json`; Afrikaans and
Setswana are drafts (`needs_review`), listed in `docs/translations-review.md`.

Screenshots: `docs/test-evidence/setup-wizard/` (every step and Home's card at 390×844 and
1366×768, Settings in the three languages).
