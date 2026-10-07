# Admin coherence review (Part 2)

Every page was gone through as a first-time admin. Each inconsistency found,
and what was done.

| # | Where | What was inconsistent | Fix |
|---|---|---|---|
| 1 | Requests, MQTT logins | Their load errors said "refresh the page" with no button; every other page shows the shared error panel with **Retry**. | Both use the shared `errorState` panel with Retry and the server's sentence. Guarded by `robustness.spec.ts` (every page, every call failing). |
| 2 | Home → "New requests waiting" and the "Requests waiting" tile | Their explanations said "Scheduling, completing or closing" clears a request; scheduling left the console in item 6c. | Now "Completing the request (Mark complete, or saving the wizard it opens)". |
| 3 | Crop lists | The console offered eight crops; the app's Crop screen and the enquiry forms offered six. | One list everywhere (bug 7). |
| 4 | Error wording | Some pages showed the server's raw body ("boom", JSON). | One error reader (bug 8). |

Checked and consistent (no change needed): Home's tiles equal the list pages'
counts and each tile opens its list (`coherence.spec.ts`); dates are SAST
everywhere (`fmtDateTimeSast`); a farmer's login is refused by the console
(`robustness.spec.ts`).
