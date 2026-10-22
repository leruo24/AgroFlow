# AgroFlow product site and staff console

This Vite + TypeScript application contains the public AgroFlow product site,
the `/staff/` sign-in entry point, and the staff console. It talks to Supabase
with the signed-in user's Row Level Security scope and calls `AgroFlow.Api` for
server-only operations.

## Run

```powershell
cd apps/web/admin
npm ci
Copy-Item .env.example .env
npm run dev
```

## Test and build

```powershell
npm run typecheck
npm run build
npx playwright test
```

`npm run build` regenerates `staff/index.html` and writes `dist/`. Vercel uses
this folder as the project root and publishes that output.

## Main files

| Path | Purpose |
|---|---|
| `index.html` | Product-site HTML entry point. |
| `staff/index.html` | Generated staff-console HTML entry point. |
| `src/main.ts` | Application bootstrap and public/staff entry selection. |
| `src/pages/` | Product and staff pages. |
| `src/app/` | Authentication, routing, shell, health, and interactions. |
| `src/data/api.ts` | Supabase-backed data access. |
| `src/experience/` | Interactive Experience AgroFlow demo. |
| `tests/` | Playwright browser coverage with mocked external services. |
| `vite.config.ts` | Multi-page production build. |
