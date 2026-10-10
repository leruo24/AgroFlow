# AgroFlow — Administration Console

Enterprise administration platform for the AgroFlow smart irrigation system.
TypeScript + Vite (vanilla, no framework).

This console is **100% administrator-focused**: managing farms, users, hardware,
maintenance, reporting and platform operations. It deliberately does *not*
surface live agronomy (soil moisture readings, weather, crop advice) or allow
manual irrigation triggering.

## Run

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # type-check + production build
npm run typecheck  # types only
```

## Pages

| Page | Purpose |
|---|---|
| Dashboard | Platform KPIs, growth charts, system health, priority queues |
| Users | Accounts, status, farm assignment, full user profiles |
| Farms | Farm directory with health status and drill-down detail |
| Farm Hardware | All registered controllers, pumps, sensors, gateways |
| Alerts | Operations centre — administrative alerts with workflow |
| Maintenance | Technician assignment, scheduling, completion reports |
| Reports & Analytics | 10 report types, comparison reports, exports |
| Irrigation Data | Historical irrigation analytics (read/analyse only) |
| Platform Activity | Administrator action history |
| Settings | Configuration, security, backup |

## Date range filtering

Every data page has a filter toolbar with a date range control offering
presets (last 7/30/90 days, this month, quarter, year, all time) plus a
**custom range** with From/To date pickers. Filter state is kept per page,
so navigating away and back preserves context.

Filters combine: search + date range + farm + province + region + status +
priority + device type + event type + administrator + crop. Exports respect
whatever filters are active.

## Alert workflow

`New → Assigned → In Progress → Escalated → Waiting for User → Resolved → Closed`

Administrator actions: view, assign, add notes, escalate, change priority,
resolve, close, reopen.

## Farm health status

Derived from device connectivity, open maintenance, outstanding alerts,
gateway state and sensor availability.

🟢 Healthy · 🟡 Attention Required · 🔴 Critical

## Project structure

```
src/
  types/models.ts        Domain interfaces — the backend contract
  data/
    mock.ts              Mock dataset (delete once backend is live)
    api.ts               Async API layer  ← ONLY file to edit for the backend
  lib/
    filters.ts           Date presets, filter state, row filtering
    format.ts            Escaping + number formatting
    animate.ts           Count-ups, chart draw-in, staggered reveals
    toast.ts / drawer.ts / csv.ts
  ui/components.ts       Cards, panels, tables, charts, filter toolbar
  pages/
    dashboard.ts  users.ts  farms.ts
    operations.ts        Hardware, Alerts, Maintenance
    analytics.ts         Irrigation Data, Reports, Activity, Settings
  app/
    router.ts            Hash router + page transitions
    interactions.ts      Filters, admin actions, drawers, exports
  styles/main.css
```

## Configuration

Copy `.env.example` to `.env`. Every variable is built into the public
JavaScript, so none of them may hold a secret.

| Variable | What it is for |
|---|---|
| `VITE_SUPABASE_URL` | The Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | The Supabase anon (publishable) key. Public by design: Row Level Security protects the data |
| `VITE_AGROFLOW_API_BASE` | The AgroFlow.Api base URL, no trailing slash |
| `VITE_DOWNLOADS_ANDROID_APK_URL` | Optional: the landing page's Android download link (hidden when empty) |
| `VITE_DOWNLOADS_WEB_APP_URL` | Optional: the landing page's link to the mobile web app (hidden when empty) |

## Deploying on Vercel

Root directory `apps/web/admin`, framework preset Vite, build `npm run build`,
output `dist`, and the variables above set in the project settings. The site
routes on the URL hash, so no rewrites are needed. Add the Vercel origin to the
API's `Cors__AllowedOrigins` (see `backend/AgroFlow.Api/README.md`).

4. Delete `src/data/mock.ts` once nothing imports it.

## Data note

All values in `src/data/mock.ts` are representative demo data, not real
customer or farm records. The dataset includes 120 days of irrigation history
and 90 days of platform activity so date-range filtering operates on
realistic volumes.
