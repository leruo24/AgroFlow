# Progress — `feat/actionable`

**Resuming? Read this file first.** The last row says where work stopped and
what is next.

| Item | Status | Commit | What's left | Next |
|---|---|---|---|---|
| pre-flight | done | 116f773 | — | 0b |
| 0b | done | (this commit) | — | 2 |

---

## Pre-flight

- Working tree clean, on `dev`, `git pull` already up to date.
- Branch `feat/actionable` cut from `dev` at `bb1c0a1`.
- Baseline recorded in `baseline.md`: 650 tests, 73 routes, firmware v1.4.0
  and mobile contracts.
- Plan in `plan.md`.
- **Repaired `docs/Fao56.pdf`.** The committed copy was corrupt (text-encoded:
  every non-ASCII byte replaced with `EF BF BD`, 6.4 MB → 11.3 MB, unreadable
  by any PDF tool). Restored from the intact `Downloads\Fao56.pdf` (6,432,919
  bytes, matching its own linearization header; `pypdf` reads all 326 pages).
  Added `.gitattributes` so binaries are never text-converted again.

---

## 0b — Fast clicks

### Root cause (proven by a failing test before the fix)

**Eight sidebar clicks produced seventy-five hash changes.** Three causes
compounded:

1. **Every click navigated twice.** The nav click called `go()`, and `go()`
   wrote `location.hash`, which fired `hashchange`, which called `go()` again.
2. **No navigation token.** `go()` awaited the page and then `swapContent`'s
   own 140 ms pause. An older page that answered later painted over the newer
   one.
3. **The stale page wrote its hash back** when it finished, firing another
   `hashchange` for a page nobody wanted - which started another navigation.
   That loop is the "vibration": the console kept cycling after the clicks
   stopped.

Plus a fourth, independent: **every Supabase auth event rebuilt the whole
shell** (`TOKEN_REFRESHED` on a timer, `SIGNED_IN` re-emitted on tab focus),
re-running the router mid-navigation. And on Windows, the scrollbar appearing
and disappearing between skeleton and page slid the layout sideways.

### Fix

- Only `hashchange` calls `go()`; clicks call `navigate()`, which only sets the
  hash. Clicking the current page does nothing.
- A navigation token: every await in `go()` is followed by a check; a
  superseded navigation stops. An `AbortController` per navigation cancels its
  **reads** (never writes); a cancelled read never settles, so it produces no
  error, modal or console noise. Background polling is exempt.
- Rendering never writes the hash; redirects use `history.replaceState`.
- The shell is rebuilt only when the view state actually changes.
- One delegated click listener for every `[data-act]`, `[data-go]` and tab,
  with a per-element busy guard: a double-click sends one request.
- Detail panels carry an intent; the last one asked for opens.
- Drawer confirm fires once (disabled on first click).
- `scrollbar-gutter: stable`; the skeleton holds the page height.

Mobile: a guarded `router` (push/navigate/back locked for one transition;
`replace` deliberately not, as it is the auth redirect), and every write is
single-flight in the data layer. **A double tap on "Water now" was sending two
pump-start commands** - `startManualIrrigation` checks whether the pump is
running, but that flag is only set after the request returns.

### Tests, and proof they test something

Admin (Playwright, mocked backend with random 50-600 ms delays): 11 tests.
Mobile (jest): 17 tests.

Each guard was removed and the suite re-run, to make sure the test fails
without it. Three tests initially passed **vacuously** and were rewritten:

- Playwright's `toHaveText` retries until it sees a match, then stops - so it
  passed the instant the right panel appeared, even though the wrong one
  replaced it a second later. Final-state checks are now one-shot reads after
  the slowest response is guaranteed to have landed.
- `visibilitychange` never actually triggered a Supabase auth event; the test
  now sends a real one on supabase-js's own BroadcastChannel.
- A same-frame double-click on a drawer's confirm didn't reach the button the
  second time - because `button.disabled = true` was still in place (my
  mutation had removed only the check). Removing both proved the guard.

Dev dependencies added: `@playwright/test` (admin); `jest`, `jest-expo` (the
Expo preset for jest, pinned to SDK 57's `~57.0.5`), `@testing-library/
react-native`, `@types/jest` (mobile). TypeScript 6 no longer auto-includes
`@types`, so test files carry `/// <reference types="jest" />` rather than
putting jest's globals in scope for the whole app.
