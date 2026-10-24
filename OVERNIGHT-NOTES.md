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
