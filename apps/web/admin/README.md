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

## Connecting a backend

Everything goes through `src/data/api.ts`. Nothing else changes.

1. Create `.env`:

   ```
   VITE_API_BASE=https://your-server.com/api
   ```

   The api layer auto-switches off mock data once this is set.

2. Each method already has its real `request<T>()` call written beside the
   mock branch — adjust endpoint paths to match your routes.

3. Make your JSON match `src/types/models.ts`. Run `npm run typecheck` to
   surface mismatches at compile time.

4. Delete `src/data/mock.ts` once nothing imports it.

## Data note

All values in `src/data/mock.ts` are representative demo data, not real
customer or farm records. The dataset includes 120 days of irrigation history
and 90 days of platform activity so date-range filtering operates on
realistic volumes.
