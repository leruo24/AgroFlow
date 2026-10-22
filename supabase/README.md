# Supabase database

This folder contains AgroFlow's Postgres schema history, live-schema diagnostics,
and a helper for preparing migrations for the Supabase SQL editor.

## Apply changes

Files in `migrations/` have been applied live. Never edit, rename, or renumber an
existing migration. Add a new, sequential migration for any future schema change.

The helper reads a selected range and copies it to the clipboard; it does not
connect to Supabase or apply anything:

```powershell
./supabase/scripts/apply-migrations.ps1 -From <migration-number>
```

Review the generated SQL, apply it in the Supabase SQL editor, and then run the
verification SQL in `docs/ops/verify-migrations.sql`.

## Test

```powershell
cd hardware/sim
npm ci
node run-e2e.mjs
```

The simulation creates a temporary Postgres database and replays the full
migration history before running API and kit scenarios.

## Main files

| Path | Purpose |
|---|---|
| `migrations/` | Immutable, ordered production schema history. |
| `diagnostics/live_schema_audit.sql` | Read-only checks for the live schema. |
| `scripts/apply-migrations.ps1` | Prepares a reviewed migration range for manual application. |
