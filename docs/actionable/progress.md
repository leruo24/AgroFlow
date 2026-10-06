# Progress — `feat/actionable`

**Resuming? Read this file first.** The last row says where work stopped and
what is next.

| Item | Status | Commit | What's left | Next |
|---|---|---|---|---|
| pre-flight | done | (this commit) | — | 0b |

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
