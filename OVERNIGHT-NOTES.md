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

### Item 1: "Connection: Online" next to "Status: Offline". Starting the fix.

Diagnosis (from reading the code):
- "Connection" (Kits table, `apps/web/admin/src/pages/operations.ts` ~line 92) is `h.online`.
  - The API computes it on every request in `ZoneHardwareEndpoints.ListAllHardwareAsync`:
    `DeviceLiveness.IsOnline(newest contact, now)`.
  - Newest contact is `last_seen` or the zone's newest reading, within 5 minutes
    (`backend/AgroFlow.Domain/SensorMonitoring/DeviceSetupCommands.cs:71`).
- "Status" (same table, the "Status" column, and the device drawer at
  `apps/web/admin/src/app/interactions.ts` ~line 1660) is the stored `hardware.status` column.
  - It is read straight from Supabase in `apps/web/admin/src/data/api.ts` ~line 550.
  - Writers: the claim, and `DeviceStatusMonitorService`'s periodic sweep, which uses its own
    longer `OfflineAfterMinutes` threshold and exists to send "kit offline" alerts.
- Both are connectivity: the same concept with two thresholds and two update times. So right
  after a kit goes quiet, or comes back, they disagree.
- Neither is equipment health. The table's "Maintenance" field is the separate health concept,
  and it has no real source today (always "OK"; see the comment in `api.ts`).

Plan:
- In the admin data layer, `Hardware.status` comes from the API's live `online` whenever the
  API answered. It falls back to the stored column only when that call failed.
- The duplicate "Status" column in the Kits table goes, and the drawer says "Connection".
- `hardware.status` stays in the database as the monitor's alerting state (it decides when to
  send "kit offline"); it is no longer shown as a second connectivity badge.

Item 1: changed (commit after this note).
- `apps/web/admin/src/data/api.ts` (`getHardware`): `status` now comes from the API's live
  `online`, falling back to the stored column only if that call fails.
- `apps/web/admin/src/pages/operations.ts`: the duplicate "Status" column is removed from the
  Kits table.
- `apps/web/admin/src/app/interactions.ts`: the device drawer and the CSV header say
  "Connection".

Verification: `tsc` only. Not run in a browser, and no Playwright test added yet, because you
asked me to stop fixing and report on the installation flow first.

Item 2 (enrollment reads as finished): NOT started.
