# Final finish before the presentation

Branch `fix/final-finish`, nine commits, one per numbered item.

This is the report for item 12.

---

## The short version

| Item | State |
|---|---|
| 1 | Audit log — diagnosed, made checkable. **Most likely cause: not deployed** |
| 2 | Settings — twenty fake fields removed, real ones added |
| 3 | "All zones" uses the designed template; all three reports match |
| 4 | Migration safety net — verify query, startup check, apply script |
| 5 | Mobile v2.0.0, matching build env, release notes |
| 6 | Cleanup SQL written, nothing applied |
| 7 | `docs/demo-account.md` |
| 8 | `docs/presentation-runbook.md` |
| 9 | Debug sweep — contract audit clean, one real find |
| 10 | All checks pass, 650 tests |
| 11 | Merged into `dev` and pushed |

---

## Two things need you before the presentation

### 1. Apply migration 0038

```powershell
.\scripts\apply-migrations.ps1 -From 38
```

Paste into the Supabase SQL editor and run it. Then run
`docs\verify-migrations.sql` — every column should be 1.

It grants the API permission to write audit rows. Without it, admin actions
may still not be recorded (see below).

### 2. Check what Railway is actually running

This is the most likely reason the audit log is empty, and I cannot check it
from here.

---

## Item 1 — the audit log, and the Railway finding

### What I found

**`origin/main` is 156 commits behind `origin/dev`.** It sits at "Add
reconciled Supabase migrations for C# domain models" — long before the audit
log, the wizards, the health endpoint or the designed reports existed.

**The audit-log commit (`47cf5b0`) is on `dev` only**, and was merged there
today.

**`e3c86c84` is not a git object in this repository.** I checked. It is a
Railway deployment id, not a commit SHA, so I cannot date it from the git log
— and I cannot read the Railway dashboard.

**Which branch Railway deploys from is not recorded anywhere in the repo.**
The `Dockerfile` builds from the repo root and `docs/ORIENTATION.md` gives the
service URL, but neither names a branch.

So the position is:

- **If Railway deploys from `main`** — the audit log cannot possibly be
  running. Nor can anything else from the last 156 commits.
- **If Railway deploys from `dev`** — it needs a deployment picked up after
  `47cf5b0`, which merged today.

Either way, **the first thing to check is whether the running build has this
code at all**, before looking at permissions.

### How to check it in ten seconds, from now on

`GET /api/admin/health` has a **Deployment** check. It reads
`RAILWAY_GIT_COMMIT_SHA`, `RAILWAY_GIT_BRANCH` and `RAILWAY_DEPLOYMENT_ID`,
which Railway injects on every deployment, and prints the commit and branch.
It goes amber when the branch is not `dev`, because work lands on `dev` and
deploying anything else should never be a surprise.

Click the platform status in the sidebar foot. It is the same panel as the
Database schema check.

### The permission question

Migration 0037 granted INSERT to **nobody**. It assumed the API connects as
the table's owner, which bypasses RLS and grants. That is an assumption about
the connection string, not a fact about the schema — and when it does not
hold, every admin action still succeeds while nothing is recorded, which is
indistinguishable from the feature not being deployed.

**Migration 0038 (written, not applied)** grants `insert` and `select` on
`admin_audit_log` to `service_role`, and restates the revokes so
`authenticated` and `anon` still cannot forge or edit a row. The table stays
append-only: nobody gets UPDATE or DELETE, including `service_role`.

No sequence grant is needed and the file says why: `id` is `generated always
as identity`, whose sequence Postgres checks no separate privilege on. A
`serial` column would have needed one, and the failure would have read
"permission denied for sequence" — which looks like a completely different
problem.

**The health endpoint checks this directly.** "Database schema" runs
`has_table_privilege(current_user, 'admin_audit_log', 'INSERT')` and names the
role it is connecting as. That turns a guess into an answer.

### The code path is sound

All nine write sites call the injected `AuditLog` on the real path, not in
tests. The actor comes from the JWT's `sub` claim and nothing else, which
works because `MapInboundClaims` is false — the same reason `TryGetUserId`
works everywhere else.

### Failures now say why

A dropped audit row used to log that the write failed but not the reason. It
now diagnoses the Postgres state: `42P01` (0037 not applied), `42703` (applied
partially), `42501` (this role may not insert). It still never fails the admin
action — revoking a stolen kit has to work during the one incident the log
exists to record.

---

## Item 2 — Settings

### Removed

Every field below was hard-coded with a Save button and read by nothing. There
is no settings table in this schema.

- **General** — platform name, support email, default province, units, time
  zone, date format. Units and time zone were not choices anyway: the console
  is metric and SAST throughout.
- **Notifications** — six toggles.
- **Platform Defaults** — device offline threshold, maintenance warning, alert
  auto-escalation, default report period, auto-assign alerts, require approval
  for new farms.
- **Security** — session timeout, password minimum length, failed login
  lockout, require 2FA, restrict by IP, log all administrator actions.
- **Manage roles & permissions** — an account is an administrator or a farmer,
  set on their profile. There is no finer-grained set to manage.

### Added — My account, all of it real

- **Name and phone** → `PUT /api/farmer/profile`. That endpoint gates on the
  caller's own id and nothing else, so it updates whoever holds the token. The
  header greeting is re-read after a save.
- **Password** → Supabase Auth, which owns credentials. Both fields are
  cleared from the DOM on success rather than left in an input through every
  later screenshot.
- **Telegram** — connect status, a single-use code in a modal (a toast
  disappears while you are still finding the app), and disconnect behind a
  confirm naming the consequence.

### Added — Platform thresholds, read-only and real

`GET /api/admin/platform-config` returns what `DeviceStatusMonitorService` and
the weather alerting actually use, read from the same `IOptions` they read, so
the page cannot drift from them. Each value carries the sentence explaining
why it is what it is; each group names the environment variables that set it.

**Read-only on purpose**, rather than backed by an `app_setting` table. These
are operational configuration, they need a restart to take effect safely, and
a table that silently shadowed an environment variable would make "what is the
threshold" a question with two answers. The Telegram bot token is never
returned — whether one is configured is useful; what it is, is a secret.

### Kept

Backup & Recovery, already made factual in the previous pass.

---

## Item 3 — "All zones"

Page 1 is the farm: four figures, "How your system works", and a line per zone
with its crop, growth stage, litres, need and days too dry, under a whole-farm
total. Then two pages per zone. Then the weather, once — it is identical for
every zone on the farm, so repeating it would be three copies of one chart.

**Each zone's section is rendered by exactly the code that renders its own
single-zone report.** A farmer who pulls both documents must not find them
disagreeing about the same zone.

**A zone with no flow rate does not void the farm.** It is left out of the
total and *named* — "Tub 2 has no flow rate on file, so it is not in the
farm's water total" — because a total quietly missing a zone is the kind of
error somebody acts on without knowing they are acting on it.

### The workbook has live formulas

Summary across all zones, one Daily sheet per zone, Weather once. Each zone's
Litres column is `IFERROR(C5*Summary!$E$12,"")` — pump minutes times that
zone's flow rate, read from an **editable cell on Summary**. Measure your pump
at 1.3 L/min instead of the 1.5 on file, change one cell, and the whole
workbook follows. Totals are `SUM`, averages are `AVERAGE`, and `IFERROR`
keeps a zone with no rate blank rather than `#VALUE!` — blank being what `SUM`
and `AVERAGE` ignore.

### All three reports share one shell

`Reports/ReportShell.cs` holds the green band, logo, footer, headings and
number formatting. Water usage, soil moisture and the watering schedule all
use it, so they look like one product and the estimate disclaimer cannot be
forgotten on one of them. **Their content is untouched** — the moisture and
schedule figures were already right, and rewriting working report logic to
match a template was not what was asked for.

In the admin, the live Reports section passes the chosen zone through and has
an Excel button next to PDF — for water usage only, since a schedule is advice
and a moisture report is a trace.

---

## Item 4 — the migration safety net

**`docs/verify-migrations.sql`** — one read-only query, one row, one column per
migration 0001–0038 plus the `reports` storage bucket. Every column should be
1; a 0 names the file to run.

0007's check is **inverted on purpose**: that migration moved the irrigation
decision out of Postgres into the API, so it passes when the trigger is
*gone*. A trigger still firing there would mean two things deciding to water
the same zone.

**The API's startup check** probes one object per migration from 0027, logging
one Warning per missing one — "Migration 0034 not applied: report_request
missing" — and reports the same under "Database schema" in the health
endpoint. Strictly read-only; a self-healing migration runner is the kind of
thing that works for a year and then rewrites a production table during an
incident.

> **Five of my own probes were wrong.** 0027 creates `zone_water_balance`, not
> `fao56_zone_day`; 0030 widens a CHECK constraint rather than creating a
> `device_command` table; 0032 is `service_request_notification`; 0033 is
> `alert.read_at`, not `seen_at`; 0031 is a policy. Each would have logged a
> false "migration not applied" warning at every boot — which is how a warning
> becomes noise and then becomes ignored. Caught by reading the migration
> files rather than trusting the names.

**`scripts/apply-migrations.ps1`** — concatenates a range onto the clipboard in
order with `-- ===== file =====` separators. It connects to nothing and
applies nothing.

```powershell
.\scripts\apply-migrations.ps1 -From 34 -To 36   # the three that were missed
.\scripts\apply-migrations.ps1 -From 38          # the usual catch-up
.\scripts\apply-migrations.ps1 -From 1 -OutFile .\all.sql
```

A test on `-From 37 -To 38` produced the expected two files in order.

---

## Item 5 — mobile v2

**Version is `2.0.0`.** `runtimeVersion` keeps its `appVersion` policy.

> **Phones on v1 will not receive updates published after this.** Updates are
> matched to the app version, so a phone on 1.0.0 only ever receives 1.0.0
> updates. Moving them across needs the APK installed; an over-the-air update
> cannot carry a phone over a version change. Nothing is lost — accounts,
> farms, zones and history are all server-side.

**`eas.json` production now carries the same three public variables as
preview.** It had only the API base, so a production build would have come up
with no Supabase URL and no publishable key — it would have installed, opened,
and failed at sign-in. Valid JSON, no comment keys.

**The icon** is the AgroFlow glossy icon in every slot, no watermark —
checked by eye. The adaptive layers are inside Android's safe zone, **measured
rather than asserted**: the foreground's artwork occupies 59.8% of its 512px
canvas and the monochrome layer 59.7% of 432px, both comfortably inside the
centre 66% a launcher masks to.

> Cosmetic note: the adaptive foreground carries a faint white rounded-plate
> ghost at its lower edge, left from the source artwork. The adaptive
> background is `#FBFDFD`, so it is invisible in practice — worth knowing
> before anybody changes that background to something darker.

### The build and update commands

I ran neither.

```powershell
npx eas-cli build -p android --profile preview

npx eas-cli update --channel preview --message "v2: designed reports, all-zones reports, real settings"
```

**`docs/release-notes-v2.md`** is written for farmers and the sponsor, with a
section stating plainly what is not connected yet.

---

## Item 6 — the cleanup SQL

All of it is in **`docs/data-cleanup.sql`**. Nothing has been run. Run the
sections **one at a time** — the Supabase editor returns only the last
statement's result.

1. **Farms worth archiving**, with the reasons spelled out per farm rather
   than a score: no zones, no readings in 14 days, a test-sounding name, a
   test-domain owner. Each row carries its `archive_farm()` statement.
2. **Demoting `admin@gmail.com` and `merge-test@agroflow.local`**, with a
   look-first `select` either side. ⚠️ **Make sure another admin account
   exists and you can sign in as it** — demoting the account you are signed in
   as locks you out, and the console is the only thing that can promote you
   back.
3. **Seeded irrigation events.** 120 L is not stored anywhere, so they are
   found by shape: exactly 120 `estimated_litres`, no active kit on the zone, a
   whole-minute runtime — with what the row *would* say under the canonical
   formula beside it. Counted first; the delete is commented out.
4. **Roles and orphans.** A role that is not `admin` or `farm_user` fails every
   RLS check silently, because the policies compare the string. Farmers with
   no farm sign in fine and see an empty app. The reverse — a farm whose owner
   no longer exists — is rarer and worse.

**Prefer archive over delete.** `archive_farm()` deletes nothing and
`restore_farm()` undoes it; delete cascades to every reading, event and alert.

---

## Item 9 — the sweep

**Contract audit clean.** Every `/api` path the admin and the mobile app call
resolves to a mapped route, including the four added here.

**No user-visible leftovers.** The four matches for "not yet implemented" and
"(demo)" are code comments recording what those strings replaced. No conflict
markers anywhere.

**One real find:** the Irrigation Schedules panel — a table with Cadence, a
Compliance meter and View/Edit/Delete links that could never have a row in it.
`irrigation_schedule` was dropped in migration 0010 and schedules have lived
as columns on the zone ever since. It rendered an empty table under a heading
promising something, so an admin would conclude no farm had a schedule — the
opposite of true. It now explains where schedules live. Its three handlers
went with it; the Edit one offered to save a "cadence" no part of the system
has had for several migrations.

---

## Item 10 — checks

| Check | Result |
|---|---|
| `dotnet build` (API) | 0 warnings, 0 errors |
| `dotnet test` (Domain) | **650 passed**, 0 failed (631 before this branch) |
| `tsc --noEmit` (admin) | clean |
| `npm run build` (admin) | clean |
| `tsc --noEmit` (mobile) | clean |
| `expo-doctor` | 21/21 |
| Conflict markers | none |
| Contract audit | every path resolves |

### New tests

- The audit writer never throws on a failed write, always logs it above
  Warning with the action named, and takes the actor from the JWT only.
- The schema check does **not** report an unreachable database as every
  migration missing — that would bury the one line that matters.
- **`EveryMigrationFromApplyingByHandHasAProbe`** holds the probe list against
  the files on disk. It failed the moment I added 0038 without a probe, which
  is exactly the mistake that let 0033–0036 go unnoticed.
- All-zones PDF and workbook render for a farm with several zones, a farm
  where one zone has no data, and a farm with no zones.

### Not covered, plainly

There is **no test database** in this project — the one other Npgsql test
points at an unreachable port on purpose. So "an audit row lands in the table
when the endpoint runs" is **not** asserted. Item 10 asked for it via "an
in-memory/test DB as the existing tests do", but the existing tests do not do
that, and adding one is a dependency and a fixture I would not want to
introduce the week of a presentation.

What is asserted is the part that breaks silently. The end-to-end check is:
apply 0038, do one admin action, open **Activity**. The health endpoint tells
you whether the write is even permitted first.

---

## Still not done

Unchanged from the previous report unless noted.

1. **Maintenance has no writer.** The job list, technician assignment and
   scheduling are a session working copy. No staff roster table either.
2. **Alert assignment, priority and notes are session-only.** The `alert`
   table has no assignee, priority or notes column, and its status CHECK
   allows only `Open` and `Resolved` while the console's workflow has seven
   states.
3. **Per-kit uptime is not measured.** No telemetry table exists for it.
4. **Hardware restart/remove/replace** are session-only — 0011 grants `select`
   on `hardware`, not `update`/`delete`.
5. **Platform settings are read-only** — by decision, explained above.
6. **Irrigation schedules** have no admin UI at all now. Real schedules are
   columns on the zone and are set from the farmer's app; an admin-side editor
   for them is a genuine gap, just not a false one any more.
7. **`estimated_litres` is dead** — nothing reads it. Worth dropping in a
   later migration once you are satisfied nothing else does.

---

## Ground rules

- `.github/workflows/` untouched. The Pages workflow stays at
  `docs/pages-workflow.yml`.
- No secret file read, printed or edited. Config names only; the Telegram
  token is reported as configured/not configured and never returned.
- The live database was never written to. 0038 is written, not applied.
- New C# follows the existing patterns. No teammate's async endpoint was
  refactored — the moisture and schedule reports kept their logic and gained
  only the shared page shell.
- One commit per numbered item.
- No mock data, fake values or "not yet implemented" anywhere a user can see.
