# UI contracts: the states the API returns (audit fixes, 23 October 2026)

For the visual redesign (`feat/visual-redesign`). These are the field names the API on
`fix/audit-oct22` returns. Build screens against these words; **do not compute these states in
the frontend** (no percentages, stages or "confirmed" from local timers). Every value below comes
from the server.

Migrations: **0057** (Part A) and **0058** (Part B). Before they are applied, the new routes answer
409 with `{ "error": "This needs database migration 0058…" }`; older fields still work.

All farmer routes need the farmer's Supabase JWT and only answer for their own farm (404
otherwise). Staff routes are under `/api/admin` (staff only, 403 for a farmer).

---

## 1. Setup progress, installation stage, "Where you are now"

`GET /api/farmer/farms/{farmId}/journey` (farmer Home and Settings)
and `GET /api/admin/farms/{farmId}/case` → `journey` (staff case; same shape).

```jsonc
{
  "farmId": 77,
  "setupProgress": {
    "done": 3, "total": 4,
    "label": "Your details: 3 of 4",          // show as is
    "tasks": [
      { "key": "preferences", "done": true,  "doneAt": "2026-10-23T08:12:00Z" },
      { "key": "farm",        "done": true,  "doneAt": "…" },
      { "key": "water",       "done": true,  "doneAt": "…" },
      { "key": "crops",       "done": false, "doneAt": null }
    ]
  },
  "installation": {
    "stage": "ready_for_installation",
    "label": "Ready for installation",
    "text": "Installation: waiting for booking",   // "Installation: <stage>" line
    "live": false
  },
  "whereYouAreNow": {
    "stage": "ready_for_installation",
    "stageLabel": "Ready for installation",
    "stageNumber": 5, "stageCount": 8,
    "steps": [ { "key": "enquiry", "label": "AgroFlow has your request", "done": true }, … ],
    "done": ["AgroFlow has your request", "…"],
    "stillToDo": ["The installation visit is booked", "…"],   // gaps BEHIND the stage are listed too
    "nextAction": "AgroFlow staff will book your installation visit.",
    "whoActsNext": "agroflow_staff",          // you | agroflow_staff | installer
    "whoActsNextLabel": "AgroFlow staff",
    "knownDate": null,                        // an ISO date only when a visit is really booked
    "dateLabel": "Waiting for booking"        // never invent a date: show this when knownDate is null
  },
  "zones": [
    {
      "zoneId": 25, "name": "Maize",
      "commissionState": "pending",           // legacy | pending | commissioned
      "commissionedAt": null,
      "irrigationMode": "manual",
      "offerAutomatic": false,                // true once: ask "Turn on automatic watering?" (Yes / Keep manual)
      "autoOfferAnswer": null,                // automatic | manual | null
      "installerChecks": [
        { "item": "kit_linked", "label": "Kit linked to this zone", "done": false, "required": true,
          "whoCompletes": "installer", "doneBy": null, "doneAt": null,
          "provenance": null,                 // measured | estimated | confirmed | from_kit | null
          "value": null, "notes": null }
        // calibration, flow_measured, run_limit (required: false), test_start_stop
      ]
    }
  ],
  "helpRequests": [
    { "id": 9, "topic": "water_source", "zoneId": null, "note": null, "status": "open",
      "createdAt": "…", "resolvedAt": null, "resolution": null, "ownerName": "Thandi (staff)" }
  ],
  "terms": {
    "accepted": { "all": true, "termsAcceptedAt": "…", "privacyAcceptedAt": "…" },
    "documents": [ /* see section 7 */ ]
  }
}
```

**Stages, in order** (`stage` → label):
`enquiry` Enquiry · `details` Details · `service_agreed` Service agreed · `account_active` Account
active · `ready_for_installation` Ready for installation · `visit_booked` Visit booked ·
`installing` Installing · `commissioned` Commissioned / Live.

**Farmer task screens** (the four tasks; each screen saves before moving on):

| Task key | Screens (in order) | Saved through (existing routes) |
|---|---|---|
| `preferences` | language · password (if `mustChangePassword`) · **Before you start** (terms) · Telegram (optional) · alerts (optional) · community (optional) · help icons | `PUT /api/farmer/language`, Supabase password, `POST /api/farmer/terms/accept`, notification preferences |
| `farm` | location (Looks right / Something's wrong) | `POST …/location-problem` or help `location` |
| `water` | water source · tank (if source is tank) | `PUT …/water-source`, tank capacity + refill |
| `crops` | per zone: crop + planting date · irrigation type · soil type · size · **installer checks** (read only: "Your installer will complete this") | zone crop / setup routes |

Finish a task: `POST /api/farmer/farms/{farmId}/tasks/{task}` → `200` with the whole journey (above),
or `400 { "error": "…", "task": "water" }` when its saved data is missing (the server checks; show
the sentence, stay on the task).

**"I don't know – help me"** on any farmer question:
`POST /api/farmer/farms/{farmId}/help` `{ "topic": "tank_capacity", "zoneId": null, "note": null }`
→ `{ "id", "topic", "status": "open", "assigned": true, "message": "Sent. AgroFlow staff will help you with this; you can carry on." }`.
Topics: `location, water_source, tank_capacity, tank_level, crop, planting_date, irrigation_type, soil_type, area, other`.
Asking twice returns the same request. A help request counts towards finishing its task.

**Automatic watering offer**: `POST /api/farmer/zones/{zoneId}/automatic-offer` `{ "answer": "automatic" | "manual" }`
(only when `offerAutomatic` is true). A farmer cannot set a `pending` zone to automatic:
`PUT /api/farmer/zones/{id}/settings` answers `409 { "reason": "not_commissioned", "error": "…" }`.

---

## 2. Weather availability

`GET /api/farmer/farms/{farmId}/today` → `weather`, and the dashboard's `weatherToday` row.

```jsonc
"weather": {
  "availability": "available",     // available | missing | stale
  "rainExpected": false,           // null unless available: unknown is NEVER "Dry / No"
  "precipitationMm": 0.4,
  "fetchedAt": "2026-10-23T06:00:00Z",
  "reason": "dry_forecast"         // no_forecast | forecast_old | no_precipitation | rain_forecast | dry_forecast
}
```

Show "Weather unavailable" (missing) or "Weather out of date" (stale) with Try again. Rain is
`precipitationMm >= 1`. Each Today zone card also has `provenance`:

```jsonc
"provenance": {
  "cropType": "leafy_veg",          // the crop the zone is SET to, never read from its name
  "cropModelKey": "lettuce", "cropModelLabel": "leafy veg (lettuce)", "cropModelIsDefault": true,
  "plantingDate": "2026-09-20", "stageAssumed": false,
  "soilModel": "loam", "soilDefaulted": false,
  "weatherFrom": "2026-09-20", "weatherTo": "2026-10-22",
  "forecastDays": 7,
  "missingWeatherDays": ["2026-09-22"],
  "calculatedAt": "2026-10-23T08:00:00Z"
}
```

## 3. The tank summary

`GET /api/farmer/farms/{farmId}/drought` → `tank` (one summary for every screen):

```jsonc
"tank": {
  "state": "level_unknown",   // not_a_tank_farm | no_tank | level_unknown | use_unknown | complete
  "hasTank": true,
  "capacityLitres": 2500, "remainingLitres": null,
  "missing": "level"          // capacity | level | daily_use | null: name THIS input, never "set up your tank" when hasTank
}
```

## 4. Command status (Water now / Stop)

`POST /api/farmer/zones/{zoneId}/commands` `{ "command": "start", "durationSeconds": 1200 }` →
`202 { "id", "duplicate": false, "durationSeconds": 300, "capped": true, "requestedSeconds": 1200, "maxRunMinutes": 5, "capMessage": "Capped to 5 min (this zone's limit)" }`.
A second start while the first is unanswered returns the first `id` with `"duplicate": true`
(a double tap is one run).

`GET /api/farmer/commands/{id}` (poll every 3 s) → existing `state`/`label`, plus:

```jsonc
"phase": "waiting_for_kit",
"phaseLabel": "Waiting for kit",
"publishedAt": "…", "requestedDurationSeconds": 1200, "capped": true
```

| `phase` | Show | Meaning |
|---|---|---|
| `request_sent` | Request sent | saved, not yet handed to the broker |
| `waiting_for_kit` | Waiting for kit | sent to the kit, no answer yet |
| `kit_confirmed_start` | Kit confirmed start | the kit acknowledged and started |
| `finished` | Finished | the kit reported the finished run |
| `stop_requested` | Stop requested | a stop was sent; NOT stopped yet |
| `kit_confirmed_stop` | Kit confirmed stop | the kit acknowledged the stop |
| `no_response` | No response | nothing from the kit within 60 s: say watering has not been confirmed |
| `failed` | Could not reach the kit | given up after 2 hours |

Never show "watering" or "stopped" from a local timer. Saved schedules: `PUT …/settings` with a
duration over the limit answers `200 { "scheduleDurationMinutes": 20, "effectiveMinutes": 5, "capped": true, "capMessage": "Capped to 5 min (this zone's limit)" }`;
show the capped length. Schedule state words: **Active** (Scheduled mode, switched on) /
**Inactive** (saved, another mode or off) / **Default** (nothing saved).

## 5. The area format

One format everywhere: `0.02 ha (200 m²)` under a hectare, `1.5 ha` from a hectare up, never
`0 ha`; no area is "Not set". Helpers: `formatArea` in `apps/web/admin/src/lib/format.ts` and
`apps/mobile/src/lib/area.ts`; server `AreaFormat.Describe`. Cases: `docs/audit/fixtures/area-cases.json`.
Farm list rows also return `member_count`, `member_ids` and `kit_count` (`kit_count: 0` → show
**Awaiting installation**, not Gateway Offline / Attention Required).

## 6. The onboarding operation status (staff)

`POST /api/farmers/onboard` takes `requestId` (a UUID made when the form opens; the SAME id on every
retry), `enquiryId`, and `farm.latitude`, `farm.longitude`, `farm.province`, `farm.town`.
Success and failure both carry `operation`; `GET /api/farmers/onboard/{requestId}` returns it alone.

```jsonc
"operation": {
  "requestId": "…", "status": "failed",   // started | farm_saved | account_created | completed | failed
  "lastStep": "account",                  // location | farm | account | handover
  "farmSaved": true, "accountCreated": false, "farmId": 77, "profileId": null,
  "offer": "retry",                       // retry | new_form | done
  "message": "The farm and its zones are saved, but not the farmer's account yet. Press Retry to finish; it continues the same farm."
}
```

Errors also carry `code` (`location_not_found`, `location_service_unavailable`, `email_taken`,
`account_not_created`, `in_progress`, …) and `field` (`location`, `email`, `phone`, …): put the
message beside that field and keep every entry. **Never offer an unconditional "Create again"**:
`offer: "retry"` → one button "Retry (continues the same farm)" that resends with the same `requestId`.
`temporaryPassword` is `null` when the request had already completed.

## 7. Terms acceptance

`GET /api/public/legal` (no login) →
`{ "documents": [ { "key": "terms", "title": "Terms of service", "version": "0.1-draft", "date": "2026-10-23", "status": "draft", "statusLabel": "Draft – needs approval", "url": ".../api/public/legal/terms" }, { "key": "privacy", … } ] }`.
`GET /api/public/legal/{key}` → the document as Markdown.

`POST /api/farmer/terms/accept` `{ "accepted": true, "termsVersion": "0.1-draft", "privacyVersion": "0.1-draft" }`
→ `200 { "accepted": true, "termsVersion", "privacyVersion", "termsAcceptedAt", "privacyAcceptedAt" }`.
`400` if the box was not ticked; `409` if the versions changed (show the current text again). Show
success only after this `200`. The acceptance box starts unticked. Telegram, community and
location permission stay separate optional choices.

## 8. Service & support (Settings)

`GET /api/farmer/service` →
`{ "status": "sponsored", "statusLabel": "Sponsored", "serviceAgreedAt", "payer": "…" | null, "planDescription": "…" | null, "contactName": "…" | null, "example": { "installationZar": 4000, "monthlyZar": 610, "zones": 2, "label": "example for a 2-zone farm; final quote after a site visit", "text": "R4 000 installation (hardware included) and R610 a month: example for a 2-zone farm; final quote after a site visit." }, "help": { "inApp", "telegram", "staff" }, "billing": "AgroFlow does not take payments in the app." }`.
Only show `payer` / `planDescription` when not null. No invoices, balances or dates are invented.

## 9. Staff case (console)

`GET /api/admin/farms/{farmId}/case` → `{ caseId, farmId, farmName, owner, nextAction, followUpAt, service, enquiry, farmer, visits[], journey }`.
`PUT …/case` `{ ownerProfileId, nextAction, followUpAt, serviceAgreed, serviceStatus, payer, planDescription, clearOwner, clearFollowUp }`.
`POST /api/admin/farms/{farmId}/visits` `{ scheduledFor, installerName, installerProfileId?, kind: "first_installation" | "follow_up" | "maintenance", notes? }` (no device needed).
`PUT /api/admin/visits/{id}` `{ status: "in_progress" | "done" | "cancelled" }`.
`POST /api/admin/zones/{zoneId}/checklist/{item}` `{ provenance, valueText?, notes?, flowRateLpm? (flow_measured), maxRunMinutes? (run_limit) }`
→ `409` with the reason when the real thing is missing (no active kit, no kit readings, no acknowledged start + stop).
`POST /api/admin/help-requests/{id}/resolve` `{ resolution }`. `POST /api/admin/enquiries/{id}/link` `{ farmerProfileId, farmId? }` (no call is logged).
`PUT /api/admin/zones/{zoneId}/mode` `{ answer: "automatic" | "scheduled" | "manual" }` (staff may switch any zone).

## 10. Alerts and loading

`POST /api/farmer/alerts/{id}/read` → `{ id, readAt }`; show read only after it, otherwise
"Could not save – Try again". Dashboard alerts carry `read_at` (read = `read_at != null`).
Every data component has loading / known / empty / stale / error states; a value is shown only
after its response arrived (no false `0`, no "not set up" while loading).
