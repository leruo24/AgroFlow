# Presentation runbook

Written for: whoever is driving the demo on the day.

One page of checks before, an eight-minute script, and what to do when
something does not work.

---

## Before you start

Thirty minutes ahead, not five.

### Hardware

- [ ] Both phones charged, and a cable in the bag.
- [ ] **APK v2 installed on the demo phone.** Not an over-the-air update — v1
      phones cannot receive v2 updates, so it has to be the APK.
- [ ] Signed in on the demo phone, and past the "change your password" prompt.
- [ ] Board 2 to hand, powered, and reachable — you will factory-reset it live.
- [ ] Laptop charged, on **your own hotspot**, not the venue WiFi. Decide this
      now; swapping networks mid-demo costs three minutes you do not have.

### The platform

- [ ] Admin console open, signed in.
- [ ] **Platform status green.** Click the status in the sidebar foot. If
      "Database schema" is amber or red, a migration is missing — stop and
      apply it, because reports and the activity log will fail live.
- [ ] **Deployment check says the branch you expect.** Same panel. If it is
      not `dev`, the features below may not be deployed at all.
- [ ] **Profile A still online.** Check it on the Kits page before you rely on
      it; it is your fallback for step 4.
- [ ] Telegram linked on the demo phone, and send yourself one test message so
      you know the bot is awake.
- [ ] Have `docs/ops/demo-account.md` done already if the sponsor account is part
      of the story.

### Open and ready

- [ ] Admin console on the landing page, signed out, ready for step 1.
- [ ] The farmer app open on the demo phone, on the Home screen.
- [ ] Screenshots or the walkthrough video open in a background tab, in case
      of step 4 (see Fallbacks).

---

## The demo — about 8 minutes

Numbered clicks. The **say** line is roughly what to say; the **expect** line
is how you know it worked.

### 1. The front door (45 seconds)

1. **Landing page** → **Sign in**.
2. Enter the admin email and password → **Sign in**.
3. You land on **Home**.

> **Say:** "This is the administrator console. The first thing it shows is not
> a dashboard of numbers — it's what needs doing."
>
> **Expect:** The "Needs attention" queue at the top, with clickable cards.
> Click one to show it goes somewhere.

### 2. Register a farm (2 minutes)

4. **Farms & zones** → **Register a new farm**.
5. **Step 1:** search for Profile B's farmer and select them.
6. **Next** → **Step 2:** name the farm, type the nearest town, then **click
   the map** to place the pin.
7. **Next** → **Step 3:** one zone, name it, pick **Tomato** from the crop
   dropdown.
8. **Next** → **Step 4:** review, then **Register the farm**.

> **Say:** "The position is a map click, not a typed coordinate. A dropped
> minus sign used to put a Western Cape farm in Kazakhstan, and nothing
> complained — the farmer just got somebody else's weather."
>
> **Say, on the crop dropdown:** "This list is only the crops the irrigation
> engine can actually advise on. It used to offer Grapes, and a zone created
> with it silently received no advice at all."
>
> **Expect:** The review step shows the coordinates you clicked. The farm
> appears in the list afterwards.

> **If you have time:** on the review step, go **Back**, clear the farm name,
> and press **Register**. It jumps you to the step that is wrong rather than
> erroring on the review screen. It is a small thing that lands well.

### 3. Register a kit (1 minute)

9. **Kits** → **+ Register a kit**.
10. Pick the farmer → their farms appear → pick the farm → its zones appear →
    pick the zone.
11. **Next** → kit type (one option, the ESP32 node) → **Next** → review →
    **Create the enrollment code**.
12. **The code appears in a modal.** Leave it on screen.

> **Say:** "Each step narrows the next. And there's one kit type because
> there's one kit — offering a weather station we can't actually enrol would
> create a row that shows as installed forever."
>
> **Expect:** An 8-character code in a modal, with its expiry. Write it down —
> it is shown once and you need it in the next step.

### 4. Enrol the board, live (2 minutes)

13. **Factory-reset board 2:** five quick power cycles.
14. On the phone, join the WiFi network **`AgroFlow-Setup-XXXX`**.
15. The setup page opens. Enter the **venue/hotspot WiFi name and password**,
    then the **enrollment code** from step 12.
16. Submit. The board reboots and joins.

> **Say:** "The board has no credentials at all until this point. The code is
> single-use and expires in 24 hours."
>
> **Expect:** The phone drops the setup network and rejoins your hotspot. Give
> it 30–60 seconds.

### 5. It comes online (45 seconds)

17. Back in the console: **Kits**. The kit shows **Online**.
18. Open the zone → **Run advice now**.

> **Say:** "That's the full loop — board to broker to API to database — and the
> engine has just worked out what this zone needs from the weather and the
> crop's growth stage."
>
> **Expect:** Status changes to Online; the advice panel populates.

### 6. The farmer's side (2 minutes)

19. On the phone: the farmer app **Home** — Drip's greeting, then the
    **forecast**.
20. **Reports** → **Water usage** → pick **one zone** → **Make me this
    report**.
21. Wait for it, then **open the PDF**.
22. Show the **Telegram message** arriving.

> **Say:** "Picking one zone gets the full report — charts of what the crop
> needed against what it got, the soil moisture trace, and the advice behind
> it. 'All zones' gets the whole farm with a summary in front."
>
> **Expect:** A three-page PDF with the green header, charts and a daily table.
> The Telegram message arrives within a minute.

> **If the zone is brand new,** its pump sections will be zero and it will say
> so plainly — that is the right behaviour to point at, not something to hide.
> Use a farm with history if you want full charts.

### 7. Everything you just did, recorded (30 seconds)

23. Console → **Activity**.

> **Say:** "Every one of those actions is here, with the name of who did it.
> Four people share the admin role, so without this 'who revoked that kit?'
> had no answer at all. The log can't be edited or deleted — by permission,
> not by policy."
>
> **Expect:** Your registration, the enrollment code and the advice run, newest
> first, with your name against each.

---

## Fallbacks

Rehearse the first one at least once.

### The venue WiFi fails, or the hotspot drops

- **This is why the laptop is on your own hotspot from the start.** If the
  hotspot itself drops: the console needs the network, but **the already-open
  page does not re-fetch until you navigate**. Finish describing the screen
  you are on, reconnect, then carry on.
- The farmer app shows cached data on Home, so step 6 survives a brief drop.
  Submitting a report does not — do that step when the connection is steady.
- If you cannot get back: skip to **step 7** and narrate steps 4–6 over the
  screenshots.

### The board will not enrol

Most likely causes, in the order worth trying: the code has expired (make
another, 20 seconds), the phone silently fell back to mobile data instead of
`AgroFlow-Setup-XXXX`, or the reset did not take (do the five power cycles
again, more deliberately).

**Give it two attempts and no more.** Then:

- Switch to **Profile A**, which is already online, and carry on at step 5 —
  "here's one that's already been through it".
- Or play the **walkthrough video** / show the screenshots for steps 4–5.

Either way, say what happened plainly and move on. A field-provisioning step
failing on a venue network is not a product flaw and nobody expects it to be
flawless; losing four minutes to it is the real risk.

### Telegram is slow

Messages can take up to a minute, and longer on a congested network. Do not
stand and wait for it.

- Carry on to **step 7** and let it arrive in the background, then come back
  to it.
- If it has not arrived by the end, show a **previous** message in the chat —
  the thread is the evidence, not the timing.
- If Telegram is not connected at all on that phone, say so and show the
  connect flow in **Settings → My account** instead; it is a thirty-second
  detour and it demonstrates the same plumbing.

### A report fails

It should not, but if it does: it will say "This report couldn't be made. Try
again later." rather than showing an error code. Point at that — it is
deliberate — then show a previously generated report from the Reports list.

If several fail, the cause is almost certainly a missing migration. Check
**Platform status → Database schema**, which names the migration, and do not
spend demo time on it.

---

## After the demo

- [ ] Archive any farm you created live: `select archive_farm(<farm_id>);`
      Nothing is deleted and it is reversible.
- [ ] Leave board 2 enrolled if the sponsor wants to see it reporting later,
      or revoke it from the Kits page.
