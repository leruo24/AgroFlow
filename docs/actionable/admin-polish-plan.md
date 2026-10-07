# Plan - admin polish (`fix/admin-polish`)

Same protocol as MASTER-PROMPT: per item, the smallest complete version,
tests in the same commit, all checks, a commit `admin-polish <n>: …`, a
progress note. Nothing touches the live database; migrations are additive
and not applied.

## Findings from the survey (before any change)

- **The app's existing "dismiss insight" deletes the row.** `POST
  /api/farmer/insights/{type}/dismiss` calls `ClearInsight`, a `delete from
  ai_recommendation`. Against "never deletes anything" - it will mark
  `dismissed_at` instead. (The engine's own `ClearInsight` call, which removes
  a DHT-offline insight once the sensor is back, is housekeeping and stays.)
- Insights already have `ai_recommendation.dismissed_at` (farmers may update
  it under RLS since 0027). Alerts have only `read_at`. Nothing records who
  dismissed, a note, or a restore. The admin's attention cards and health
  checks are computed, not rows.
- The admin has no separate bell menu: its notifications are Home's "Needs
  attention" cards, the Alerts list and the health warnings on Home.
- `Program.cs` registers CORS three times and applies it twice.
- No anonymous "is the server there?" route exists, which the
  extension-block message needs.

## Item 1 - dismiss and history

**Model - migration 0045 (additive, re-runnable, probed):** one `dismissal`
table for every kind of item and both audiences:
`audience` (admin / farmer), `item_kind` (alert, insight, attention, health),
`item_key`, `farm_id`, `title` and `raised_at` (so history reads on its own),
`critical`, `condition_key`, who/when dismissed (from the login, name kept
flat like the audit log), optional `note`, and who/when restored. Rows are
never deleted; Restore stamps the row. `ai_recommendation.dismissed_at` is
reused and kept in step (set on dismiss, cleared on restore) so every
existing reader still works; `ai_recommendation.dismissed_by_profile_id` is
added. RLS on: admins read all; a farmer reads farmer-audience rows of farms
they can access; no write policies - writes go through the API, which takes
the actor from the login.

- Admin dismissals are shared by the admin team (one queue); farmer
  dismissals are per farm. A farmer's dismissal never hides anything from the
  admin, and the reverse.
- **Critical items** (alerts Critical/High; attention cards for critical
  alerts, kits offline, call-backs due; health checks that are down; insights
  that say act now) ask for an optional note, and come back if the condition
  happens again: an alert or insight that recurs is a new row (new key), and
  a computed item carries a `condition_key` (the ids behind it, or the check's
  status) - a dismissal only hides the item while the key is unchanged.
- Undo is a one-tap toast for 5 s that restores (both steps are recorded).
- Admin dismiss and restore are written to `admin_audit_log`.
- Farmers can only dismiss or restore their own farms' items: the API checks
  ownership (403 otherwise), RLS limits reads.

Routes: `GET/POST /api/admin/dismissals`, `POST
/api/admin/dismissals/{id}/restore`; `GET/POST /api/farmer/dismissals`,
`POST /api/farmer/dismissals/{id}/restore`. The old farmer dismiss route stays
(baseline) and becomes non-destructive.

UI: a × on each item; "Active / Dismissed / All" on Home's Needs attention,
the Alerts list, the health panel, and the app's Alerts and insight cards;
Dismissed rows show what, raised when, dismissed when and by whom, the note,
and Restore.

## Items 2-8

2. Requests: Open first then Completed; filter Open / Completed / All; name →
   email → phone; with none, "Request #id" and a flag.
3. Sidebar logo and "AgroFlow Administration" link to Home.
4. Log out in the sidebar footer and the avatar menu: Supabase sign-out,
   session cleared, landing page.
5. Landing: "Who made this" removed; Admin login kept.
6. Settings: only "My account" (profile, password, Telegram).
7. Plain errors: one network-failure sentence everywhere; an
   extension-block sentence when the request failed but `GET
   /api/public/ping` (new, anonymous, harmless) answers; detail to the console
   only. The enquiry form keeps what was typed and offers Retry.
8. CORS: one named policy from `Cors:AllowedOrigins` plus the localhost dev
   origins, applied once, any header; README documents
   `Cors__AllowedOrigins__0..N`; tests for allowed / unlisted origins and for
   401 and 500 responses still carrying the header.

## Migration

| # | File | Adds |
|---|---|---|
| 0045 | `0045_dismissal.sql` | `dismissal`; `ai_recommendation.dismissed_by_profile_id` |

## Progress and limits (as built)

- Item 1 committed separately (`admin-polish 1`); items 2-8 in one commit
  after it. Backend, admin Playwright and mobile jest were run on each.
- Critical computed items (Home cards, health checks) come back when their
  condition changes because the admin page closes a dismissal whose
  `condition_key` no longer matches (`/condition-cleared`, recorded as
  "AgroFlow (the condition cleared)"). Limit: this needs an admin to have the
  page open while the condition is clear. If a kit goes offline, recovers and
  goes offline again with the same signature while nobody looks, the second
  time stays hidden until Restore. Alerts and insights are rows/dates, so a
  recurrence is a new item and always shows.
- Item 6: the `GET /api/admin/platform-config` endpoint stays (baseline
  route); only the Settings tab that showed it is gone. The rapid-click
  Settings test now races the single tab instead of three.
- Item 7 covers the admin console (every request goes through
  `navigationAwareFetch`; error cards, toasts, modals, the login, map and
  enquiry forms pass text through `plainError`). The mobile app's error
  wording was not part of this item and is unchanged.
- Item 8: CORS was applied as "AdminFrontend" (the second registration,
  without :5174) and then the default policy; now one policy `AgroFlowWeb`.
  Error answers keep the header (CorsTests: 401, 500, 503).
