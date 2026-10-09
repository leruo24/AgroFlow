# Setting up the sponsor demo account

Written for: whoever is setting this up in the admin console before the
presentation.

Everything below is done through the console, using the wizards. **No SQL, and
no fake readings.** The point of this account is that it is a real account
with real structure — what the sponsor sees is what a new farmer genuinely
sees on day one, which is more convincing than invented data and cannot be
caught out.

Allow about ten minutes.

---

## What you are creating

| | |
|---|---|
| Farmer | `sponsor.demo@agroflow.test` |
| Farm | AgroFlow Demo Farm, in the Mafikeng area |
| Zone | One tub: tomato, planted 60 days ago, loam, 0.2 m², 0.3 m deep, 1.5 L/min |

The `.test` domain is deliberate. It is reserved by RFC 2606 and can never be
a real address, so this account cannot accidentally email anybody — and
`docs/ops/data-cleanup.sql` lists `.test` owners as candidates for archiving, so
it is easy to find and retire afterwards.

---

## 1. Create the farmer

1. Sign in to the admin console.
2. **Farmers** → **Onboard a farmer** (or the Farmers page's create button).
3. Fill in:
   - **Full name:** `Sponsor Demo`
   - **Email:** `sponsor.demo@agroflow.test`
   - **Phone:** leave blank, or your own number if you want to show the
     Telegram flow.
4. Create the account, and **write down the temporary password on the handover
   screen.** It is shown once.

> If you intend to sign in as this farmer on a phone during the demo, do that
> once now and get past the "change your password" prompt. Doing it live costs
> two minutes and a bit of composure.

---

## 2. Register the farm

1. **Farms & zones** → **Register a new farm**. This is the four-step wizard.
2. **Step 1 — Farmer.** Search for `Sponsor Demo` and select them. The list is
   real accounts; you cannot type a name that does not exist.
3. **Step 2 — Farm details.**
   - **Farm name:** `AgroFlow Demo Farm`
   - **Nearest town or district:** `Mafikeng, North West`
   - **Farm size:** `0.5` hectares
   - **On the map:** click just outside Mafikeng. Around
     **-25.8650, 25.6440** is the right area — the fields fill in as you click,
     and you can drag the pin to fine-tune.

   > The pin matters more than it looks. `farm.latitude/longitude` is what the
   > weather lookup and the FAO-56 engine read. Without it the farm falls back
   > to its district, and the forecast the sponsor sees is less specific.

4. **Step 3 — Zones.** Set the count to **1**:
   - **Zone 1 name:** `Tub 1`
   - **Size:** `0.00002` hectares (0.2 m² — the wizard asks in hectares)
   - **Crop:** `Tomato` from the dropdown
5. **Step 4 — Review.** Check the farmer, the coordinates and the zone, then
   **Register the farm**.

---

## 3. Finish the zone's setup

The wizard creates the zone; these four values make the engine able to advise
on it. Open the zone from **Farms & zones** and set:

| Field | Value | Why it matters |
|---|---|---|
| Planting date | **60 days before the demo date** | Puts the tomato in mid-season, which is when the advice is most interesting |
| Soil type | **Loam** | The documented default for the demo tubs |
| Area | **0.2 m²** | Turns the engine's millimetres into litres |
| Root depth | **0.3 m** | Sets how much water the soil can hold |
| Flow rate | **1.5 L/min** | Without it, every litre figure reads "no estimate" |

All five are needed for the zone to produce advice. Miss the flow rate and the
reports say "no estimate" everywhere — correctly, but it is not the
demonstration you want.

---

## 4. What the sponsor will see — and what they won't

There is **no kit on this farm**, and we are not pretending there is. Be
straightforward about that; the app is designed to be honest about it, which
is itself worth showing.

**Working, with no hardware at all:**

- **The weather forecast** for the farm's actual coordinates, from Open-Meteo.
  Real data, updated daily.
- **Irrigation advice** — how much water the tomato needs at day 60 of its
  season, worked out from that forecast and the FAO-56 method. This is the
  substance of the product and it needs no sensor.
- **The growth stage** — "Peak growth, day 60 of 145" — and what it means for
  watering.
- **Reports.** Ask for a water usage report and you get the full designed
  document. The pump sections will be zero, and the crop-need chart will be
  populated, which honestly shows the gap between what the crop wanted and
  what it got.
- **Telegram**, if you connect it: the welcome message, and weather warnings
  if the forecast turns.

**Not there, and visibly so:**

- **"Finish setting up"** against the kit, because no kit has been enrolled.
  This is the correct state, not an error.
- **An empty soil moisture chart**, with a line saying no readings have
  arrived. Also correct — nothing is measuring that soil.
- **No irrigation history**, because the pump has never run.

> **Do not insert sensor readings or irrigation events to fill these in.** A
> moisture trace with no sensor behind it is a fabricated measurement, and
> anyone who asks a second question about it will find that out. The empty
> chart with its honest explanation is a better answer, and it sets up the
> live-hardware part of the demo rather than competing with it.

---

## 5. If you want the demo farm to show live data

Enrol a real kit onto `Tub 1` using the **Register a kit** wizard, and the
moisture chart, irrigation history and water figures fill in by themselves
within a few minutes of the board reporting. That is the honest route, and it
is the one the presentation runbook uses.

---

## Afterwards

Archive it rather than deleting it:

```sql
select archive_farm(<farm_id>);
```

Archiving hides the farm from every list, report and the automatic report
scheduler, and deletes nothing — so if the sponsor asks to see it again next
month, `select restore_farm(<farm_id>);` brings it back exactly as it was.
`docs/ops/data-cleanup.sql` section 1 will list it as a candidate, with the
statement ready to copy.
