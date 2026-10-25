# Overnight notes (24 Oct 2026, night)

## Where this work happens, and why not on main

The overnight brief said "You are on main" and "git add -A && git commit". I checked before
doing anything:

- No checkout is on `main`. The main folder (OneDrive `.../Project/agroflow`) is on
  `feat/agroflow-ui-redesign`, with about 20 uncommitted UI and CSS files. They look like
  the other agent's work in progress.
- There is no `ui-pass` branch.

`git add -A` in that folder would have committed the other agent's unfinished work, so I
did not run it. I worked in my own worktree instead:
`C:\Users\leruo\AppData\Local\Temp\agroflow-release`, branch `fix/onboarding-kit-flow`
(pushed to origin, never merged).
- Every fix is its own commit, staged by explicit path. To roll back one step:
  `git revert <sha>`.
- Nothing was merged, rebased or force-pushed, and nothing touched your folder or another
  branch.

## State of the branch before the overnight items

These commits were already on `fix/onboarding-kit-flow` from the previous job:
- `6362ff0`: the public site no longer shows any simulation.
- `fc5d855`: kit linking in the API, migration 0063.
  - 0063 is written but **not applied**. It needs your "migration applied" before any
    merge.
- `131a6ff`: firmware 1.7.2.

The admin "Add kit" panel UI, onboarding QR UI, farmer Kit-tab changes and the merges from
that job were paused for this overnight brief.

## Log

### Item 1: changed, then reverted (`bca6046`, reverted by `37de2d6`)

- I made the admin's "Status" follow the live "Connection" value and removed the duplicate
  column.
- The installation probe below then showed that the live value itself is wrong for a kit that
  has never connected: it says `online: true` right after a code is created.
- So my change would have shown one confident, wrong "Online". I reverted my own commit; the
  screen is as it was before tonight.

The real cause, found by running the flow:
- A new hardware row gets `last_seen = now()` from the column default when the code is created.
- `DeviceLiveness.IsOnline` (newest contact within 5 minutes) therefore counts creating the
  code as contact.
- A code row with no kit reads "Connection: Online" for 5 minutes, while the stored
  `status = 'Offline'`: that is your contradiction.
- The same row shows token "legacy key", because there is no token yet.
- Fix needed, not done:
  - `online` must be false unless `enrollment_status = 'active'`
    (`backend/AgroFlow.Api/Endpoints/ZoneHardwareEndpoints.cs`, `ListAllHardwareAsync` and
    the per-zone GET).
  - Only then make it the single badge.

### Installation flow on a clean database (run, not inspected)

How it was run:
- Local Postgres with all migrations, through the real API in-process.
- Run twice: on `dev` at `bd54ab3`, which is what is live, and on this branch.
- A temporary probe test drove it; it is not committed.
- Stand-ins:
  - Supabase account creation is the onboarding tests' fake.
  - "The kit" is an HTTP call shaped like the firmware's claim.
- No browser was used, so every "on screen" statement below comes from the API answer plus
  reading the page code.

1. **Create a farmer: works.**
   - Onboarding gives a farm (status Active), a zone (commission_state `pending`), a temporary
     password and `must_change_password = true`.
   - The Telegram QR link is null locally because no bot username is set here; it is set on
     Railway.
2. **Kit registration wizard: works (API side).**
   - Both lists the wizard loads (`/api/users/farmers` and `/api/farms`) include the new
     farmer and farm.
   - The wizard's own page was not opened in a browser.
3. **Create an enrollment code: works.**
   - On `dev`: an 8-character code, valid 24 h.
   - On this branch: 6 digits, valid 30 min.
4. **State after the code:**
   - **Database:** a hardware row with `device_id null`, `enrollment_status 'enrolled'`,
     `status 'Offline'` and `last_seen` set to the creation time.
   - **Staff case:** "Details / Installation: not booked yet". It does not claim
     installation.
   - **Admin Kits table: misleading.** Connection "Online", Status "Offline", Token "legacy
     key", for a kit that does not exist yet (see Item 1).
   - **Farmer Kit tab:** "awaiting_installation", which is correct.
5. **Can a kit enroll?**
   - **Simulator: works.** With the simulator the claim succeeds. The row becomes active,
     Online, with the device ID.
     - The staff case moves to "Installing (1 of 5 checks done)".
     - The farmer Kit tab says "working", even though no reading has arrived yet. That is a
       second over-claim.
   - **Your physical kit: not run by me.** Earlier today you flashed 1.7.1, but I have no
     board here.
     - On `dev` (live), a kit that has been linked before cannot be linked again. The probe
       reproduced the 503 "cannot reach its database".
       - The cause is the unique `device_id`; the admin's "Remove" button only changes the
         browser's list.
       - So on live, your kit enrolls only if it has never been linked, or if its old hardware
         row is deleted by hand in Supabase.
     - On this branch it answers 409 "still linked to Probe Farm. Unlink it there first".
       After Unlink it links (verified in `run-e2e.mjs`). But this branch needs migration
       0063 applied first and is not deployed.
6. **Setup card network name: a formula until the kit is known.**
   - Before the kit connects, the card shows "AgroFlow-Setup- and the last 4 characters of
     the device ID" (`apps/web/admin/src/ui/kitSetupCard.ts:63`). The exception is when the
     admin typed the device ID in the wizard.
   - After the claim, the API returns the real name (`AgroFlow-Setup-A1B2` in the probe), and
     the card is coded to poll every 5 s and fill it in.
   - The polling was not watched in a browser.
   - The card still shows the old `AF-…` hotspot password, which firmware 1.7.2 no longer
     uses. The card was not updated.
7. **Farmer app "Farm unavailable": the API side works; the app was not run.**
   - The farmer's `/api/farmer/dashboard` answers with their one farm on a clean database.
   - The app shows "Farm unavailable" only when that request fails
     (`apps/mobile/src/context/AgroFlowContext.tsx` ~line 1003).
   - If you still see it on the deployed web app, the cause is outside this flow: API
     address, CORS, an expired sign-in, or the live API erroring. I could not check that
     without a browser and the live site.

### What I did NOT do, and why

- **Item 2 (enrollment reads as finished):** not changed; you said stop fixing.
  - Findings: the only "finished" signals I found are the Kits table's "Online" for a code
    with no kit, and the farmer Kit tab's "working" before any reading.
  - No text says "installation complete" in the paths I ran.
- **Main and your folder:** not touched. Nothing was merged or pushed to `dev`, `main` or
  another agent's branch.
- **Migration 0063:** not applied by me.
