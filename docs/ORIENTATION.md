# Repo orientation (post-restructure)

For Phili and Olwethu, coming off your own branches. The repo was
restructured, RLS went on across the database, and the admin dashboard got
a real login. This is "where is everything now and how do I run it" —
not a feature changelog. Read section 6 before you trust anything in
`supabase/migrations/` about the live database's actual shape.

## 1. Directory map

Flat top level: `apps/`, `backend/`, `hardware/`, `supabase/`. No root
`AgroFlow/` folder — never existed in this repo, don't go looking for one.

| Path today | What it is | Old path (if it moved) |
|---|---|---|
| `apps/mobile` | Expo/React Native farmer app | `apps/agroflow-app` |
| `apps/web/admin` | Vite admin dashboard | `apps/web-dashboard/admin` |
| `apps/web/admin/src/data/referenceData.ts` | Static lookup lists (provinces, hardware types, crops) | new file, split out of `apps/packages/database/admin/mock.ts` |
| `apps/web/admin/src/types/models.ts` | Domain types for the dashboard | `apps/packages/database/admin/types.ts` |
| `backend/AgroFlow.Api` | ASP.NET Core Web API | `api/AgroFlow.Api` |
| `backend/AgroFlow.Domain` | C# domain model (`Zone`, `Farm`, etc.) + console demo `Program.cs` | `data/` (was `AgroFlow.csproj`) |
| `hardware/` | ESP32 firmware | unchanged |
| `supabase/migrations/` | Schema history | unchanged |

**Deleted, don't go looking for it:**

- **`controllers/`** — a shared `@agroflow/controllers` package (mixed
  TS + one C# file). It was moved-not-rewritten code: `AuthController`/
  `NotificationController` copied from the old mobile app's services,
  `WeatherController`/`IrrigationEngineController` pulled out of the old
  web dashboard's `Dashboard.jsx`, plus a workshop-style `ZoneController.cs`
  tied to the old `data/` project. Nothing in either app ever actually
  imported from it — deleted as dead weight during the restructure. The
  real equivalents now live directly in each app: business logic in
  `AgroFlow.Domain` (`Zone.cs`, etc.) and `AgroFlow.Api`'s own endpoints,
  auth in each app's own `context/AuthContext.tsx` / `app/auth.ts`.
- **`data/obj/`, `api/AgroFlow.Api/obj/`, `bin/`** — committed build
  artifacts. Never should have been tracked; deleted, and `bin/`/`obj/`
  are gitignored now. If your branch still has these tracked, that's
  what the restructure commit removed.
- **`apps/web-dashboard/admin/src/data/mock.ts`** and
  **`apps/mobile/src/data/mock*.ts`** — deleted since (see section 7).
  Both apps read real Supabase data now.

## 2. How to run each piece

**PowerShell gotcha:** `&&` is not a valid separator in PowerShell (it is
in bash). Use `;` to chain commands, or run them as separate lines.

```powershell
# wrong in PowerShell:
cd apps/mobile && npm install

# right:
cd apps/mobile; npm install
```

### Mobile app (Expo)

```powershell
cd apps/mobile
npm install
npm start
```

Expo DevTools opens in your terminal/browser. Press `w` for web, or scan
the QR code with Expo Go. You should land on the **login screen** (real
Supabase Auth — see section 8), not a home screen — there's no
guest/skip path.

Run this from `apps/mobile`, not the repo root. There is no root
`package.json` — this is not an npm-workspaces monorepo, each app owns its
own dependencies — so `npx expo start` from the root fails with
`ConfigError: The expected package.json path ... does not exist`.

**No `expo-blur` — do not add it back.** The tab bar and the modal sheets
used to be frosted glass via `expo-blur`. On Expo Go SDK 57 that crashed
the app natively on startup on both iPhone and Android: the bundle built
fine, then Expo Go dropped straight back to its home screen with no red
error screen to catch. The frosted look is now a solid `tabBarSurface`
token plus a hairline border and shadow on the bar, and a `scrim` token
behind the sheets. Both tokens live in
`apps/mobile/src/constants/colors.ts`. If the sheets or the tab bar look
flat to you, that is deliberate — it is not a missing dependency.

### Admin dashboard (Vite)

```powershell
cd apps/web/admin
npm install
npm run dev
```

Opens at `http://localhost:5173` (Vite's default). You should see the
**login card** ("AgroFlow — Administration console"), not the dashboard
— the whole app is gated behind sign-in now (section 8).

### Backend API (dotnet)

**You usually do not need to run this at all.** `AgroFlow.Api` is deployed
on Railway at:

```
https://agroflow-production-998d.up.railway.app
```

Both the mobile app and the admin dashboard point at it by default, so a
normal day's work on either client needs no local backend, no `dotnet run`,
and no LAN IP. Run it locally only when you are changing backend code
itself — and if you do, point the client's `.env` back at
`http://localhost:5080` while you work.

To confirm the deployed API is alive, open the URL in a browser. You should
see:

```
Missing or invalid X-Api-Key header.
```

That is the device auth middleware rejecting an unauthenticated request —
it means the service is up and reachable. A Railway error page or a timeout
means it is not.

**Running it locally (backend work only):**

```powershell
cd backend/AgroFlow.Api
dotnet run
```

Watch the console. If a required secret is missing you'll get a clear
startup exception naming exactly which one (`"Missing ConnectionStrings:
Supabase in configuration"`, etc.) — see section 3 before running this
for the first time. On success you'll see:

```
Now listening on: http://localhost:5080
```

No root/health endpoint exists to hit in a browser. To confirm it's
actually alive and JWT-checking correctly:

```powershell
curl.exe -X POST http://localhost:5080/api/farmers/create
```

A `401 Unauthorized` response means it's up and rejecting an
unauthenticated request correctly (this is what you want to see with no
token). Connection refused means it isn't running at all.

## 3. Config and secrets

**Nothing secret goes in a tracked file — ever.** Not `appsettings.json`,
not a committed `.env`, not a hardcoded string "just for now."
`backend/AgroFlow.Api/appsettings.json` **is** committed but only holds
non-secret config (Supabase project URL, JWKS URL, MQTT host/port) —
never add a password or key to it.

**Backend — .NET user-secrets** (from `backend/AgroFlow.Api`):

```powershell
cd backend/AgroFlow.Api
dotnet user-secrets set "ConnectionStrings:Supabase" "<value>"
dotnet user-secrets set "Supabase:ServiceRoleKey" "<value>"
dotnet user-secrets set "ApiKey" "<value>"
dotnet user-secrets set "Mqtt:Password" "<value>"
```

Ask whoever has them (Supabase dashboard → Project Settings → Database /
API for the first two; `ApiKey` and `Mqtt:Password` are project-chosen
secrets, ask in the group chat). `dotnet user-secrets list` shows what's
currently set without printing them into a file anyone could commit.
`ASPNETCORE_ENVIRONMENT=Development` has to be set for user-secrets to
load at all — `Properties/launchSettings.json` already sets this for
`dotnet run`, so you don't need to set it yourself unless you're running
the built DLL directly.

**Web apps — `.env` from `.env.example`:**

```powershell
cd apps/mobile
Copy-Item .env.example .env
# edit .env: EXPO_PUBLIC_SUPABASE_URL, EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY

cd apps/web/admin
Copy-Item .env.example .env
# edit .env: VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, VITE_AGROFLOW_API_BASE
```

Both `.env` files are gitignored. `.env.example` in each app already
carries the deployed Railway API URL as the default
`EXPO_PUBLIC_AGROFLOW_API_BASE` / `VITE_AGROFLOW_API_BASE`, so copying it
across is enough — there is no per-machine or per-network value to fill in
for the API any more.

**Deployed backend config lives in Railway, not user-secrets.** The
user-secrets above are for running the API locally. The deployed instance
reads the same keys from Railway environment variables, using a double
underscore for nested sections (`ConnectionStrings__Supabase`, `ApiKey`,
`Supabase__ServiceRoleKey`, `Mqtt__Password`, and
`Cors__AllowedOrigins__0` for each allowed browser origin). Changing a
secret means changing it in both places.

Use the Supabase **anon/publishable**
key here, never the service role key — the service role key only ever
belongs in the backend's user-secrets (`Supabase:ServiceRoleKey`), because
it bypasses RLS entirely.

**Firmware:**

```powershell
cd hardware/esp32/AgroFlowIrrigationNode
Copy-Item secrets.example.h secrets.h
# edit secrets.h: API_KEY (matches backend's ApiKey user-secret),
#                 MQTT_PASSWORD (matches backend's Mqtt:Password user-secret)
```

`secrets.h` is gitignored.

> A real `appsettings.json` and the firmware's HiveMQ password were
> committed before this hardening and are still in git history —
> already flagged for rotation, not your problem to fix, just don't
> assume old commits are clean if you ever go digging through history.

## 4. Architecture split: when to call Supabase directly vs. go through AgroFlow.Api

**The rule:** query Supabase directly (client-side, anon key) for reads
and ordinary writes — Row Level Security is what actually enforces who
can see/touch what, so the client doesn't need permission from anyone
else to do this. Go through `AgroFlow.Api` **only** for the things a
client genuinely cannot do itself:

- device ingestion (sensor readings, irrigation events posted by the
  ESP32 over HTTP with the shared `ApiKey`)
- MQTT (the API is the only thing with an MQTT connection)
- `irrigation_commands` delivery via Postgres `LISTEN`/`NOTIFY` → MQTT
  publish
- anything needing the `service_role` key (farmer onboarding's
  `/api/farmers/create` and `/api/farmers/invite` — see section 9)
- device enrollment/claim

**Explicitly: do not add a REST endpoint that just wraps a Supabase read
the client can already do directly.** If you find yourself writing a new
`AgroFlow.Api` endpoint that does `select * from X where farm_id = ...`
and returns JSON, stop — that's a query the client should run against
Supabase directly with RLS scoping it, not a new API surface to
maintain, secure, and keep in sync with the schema.

Look at `apps/web/admin/src/data/api.ts` or
`apps/mobile/src/context/AgroFlowContext.tsx` for the direct-query
pattern already in use, and `apps/web/admin/src/services/agroFlowApi.ts`
for the "goes through the API because it has to" pattern.

## 5. RLS — what it means for your code

Row Level Security is on for effectively every table now
(`supabase/migrations/0011_row_level_security.sql`, plus `farm`/`zone`/
`farm_member`/`profile` from before — see section 6 on why that "before"
part isn't in any migration file). Practically, this changes how you
should read a query result:

- **A blocked query does not error — it returns empty (or a partial
  set).** If your `select` returns `[]` and you expected rows, your
  first instinct should be "does a policy block this?", not "is the
  data missing?" A silent empty result and an actually-empty table look
  identical from the client.
- **Access flows through `farm_member`.** A farmer can see a row if
  there's a `farm_member` row linking their `auth.uid()` to that row's
  `farm_id` (via the zone → farm chain for most tables), or if they own
  the farm outright. This is what `app_can_access_farm(farm_id)` (a
  helper function, see 0011) checks. If a farmer can't see something
  that looks like it should be theirs, check `farm_member` first.
- **Admins bypass per-table checks via a blanket `app_is_admin()`
  policy**, not by being exempt from RLS — same mechanism, just a
  policy that's always true for `profile.role = 'admin'`.
- **`AgroFlow.Api` bypasses RLS entirely, differently.** It connects to
  Postgres as the `postgres` role (via `ConnectionStrings:Supabase`),
  and table owners bypass RLS automatically under `ENABLE ROW LEVEL
  SECURITY` (as opposed to `FORCE`, which isn't used here on purpose —
  see 0011's header comment). This is why the API can do things like
  insert sensor readings for any zone without needing a policy for it —
  it isn't subject to the policies at all, not even the admin one.

**To check what policies actually exist on a table** (run in the
Supabase SQL editor — this is the live source of truth, not the
migration files):

```sql
select policyname, cmd, roles, qual, with_check
from pg_policies
where schemaname = 'public' and tablename = 'zone';
```

Drop the `tablename` filter to see every policy on every table at once.

## 6. Where the schema truth actually lives

**`supabase/migrations/` is not ground truth.** It has diverged from the
live database more than once, confirmed:

- **`profile.phone`** — migration 0011 does `grant update (name, phone)
  on profile to authenticated`, but no migration file anywhere ever adds
  a `phone` column to `profile` (0001 defines `profile` without it). It
  exists live; it was added by hand outside any migration.
- **Zone columns from the mobile app's schedule UI** — 0010 documents
  reconciling `zone.irrigation_mode`, `schedule_enabled`,
  `schedule_days`, `schedule_start_time`, `schedule_duration_minutes`,
  `automation_enabled`, `weather_adjustment`, `name`, `location`,
  `size_value`, `size_unit`, plus `farm.latitude`/`farm.longitude` — all
  added because the app's zone-settings/weather UI already read and
  wrote them, before any migration existed for them. 0010 catches the
  migration files up; it doesn't mean the live DB matched before that.
- **`farm`/`zone`/`farm_member`/`profile` RLS predates every migration
  file.** Grep confirms it — `grep -n "enable row level security"
  supabase/migrations/*.sql` only matches inside 0011, but 0011's own
  header says it's *extending* "the farm_member ownership pattern
  already live on farm/zone/farm_member/profile." Those tables' RLS and
  policies were set up by hand, directly on the live database, and never
  captured in a migration file at all.
- **A stray `profiles` (plural) table** — 1 live row, not created by any
  migration, purpose unknown. 0011 deliberately left it untouched
  pending investigation. Don't assume it's the same thing as `profile`
  (singular, the real one everything actually uses).
- **`irrigation_schedule`** — 0010 contains a `drop table if exists
  irrigation_schedule;` statement, but 0011 (written after) still lists
  it as "possibly dead... pending confirmation" — meaning it's not
  confirmed whether that drop statement was ever actually run against
  the live database. Check before assuming either way.

**Verify against the live database before trusting any of this
secondhand — including this document.** Queries to run in the Supabase
SQL editor:

```sql
-- every table in the public schema
select table_name from information_schema.tables
where table_schema = 'public' order by table_name;

-- every policy on every table
select tablename, policyname, cmd, roles, qual, with_check
from pg_policies where schemaname = 'public' order by tablename, policyname;

-- every column on one table, in order
select column_name, data_type, is_nullable, column_default
from information_schema.columns
where table_schema = 'public' and table_name = 'zone'
order by ordinal_position;

-- does irrigation_schedule still exist, and does it have rows?
select count(*) from irrigation_schedule;
```

## 7. Current state, honestly

**Deployed:** `AgroFlow.Api` runs on Railway at
`https://agroflow-production-998d.up.railway.app` (Docker build from
the repo-root `Dockerfile`; Railway's auto-builder has no .NET provider).
MQTT subscribe and the Postgres `LISTEN irrigation_commands_channel`
listener both come up cleanly there. Mobile and admin both point at it, so
the old "find your LAN IP and update `.env` every time you change network"
step is gone. The firmware is the one client still on a hardcoded LAN
address — it needs a reflash to move (see section 9 / firmware TODOs).

**Works end to end:** ESP32 → MQTT → `AgroFlow.Api` → Postgres sensor
ingestion and auto-irrigation decisioning. Mobile sign-in/out (real,
predates this restructure). Admin sign-in/out gated on
`profile.role = 'admin'` (new — section 8). Both apps' core reads
(mobile: zones/readings/alerts for the signed-in farmer's farm; admin:
users/farms/hardware/alerts/maintenance/irrigation-events across every
farm) are real, RLS-scoped Postgres queries — no mock data left in
either app.

**Wired but returns empty pending data:** alerts, maintenance, weather,
hardware status — real tables, real queries, honest empty states, just
few/no rows right now because nothing populates them automatically yet.

**Doesn't exist at all:** Platform Activity log and System Health
monitoring (admin) — no backing tables, both show a labelled "not yet
implemented" state instead of fake data. Admin Irrigation Schedules —
UI still points at an in-memory working copy, not real data. Report
generation and AI-recommendation logic — tables exist, nothing writes to
or reads meaningfully from them yet. Admin dashboard mutations (disable
user, assign alert, complete maintenance, etc.) update an in-memory copy
for the current browser session only — refresh and they're gone; not
wired to real Postgres writes. Farmer onboarding — see section 9, it's
half-built and someone needs to finish it.

## 8. Signing in

### Admin dashboard

`apps/web/admin/src/app/auth.ts`'s `signIn(email, password)`:

1. Calls `supabase.auth.signInWithPassword`.
2. On success, looks up that user's `profile` row.
3. **If `profile.role !== 'admin'`, it immediately calls
   `supabase.auth.signOut()` again and throws** `"This account is not an
   administrator."` — so a valid farmer login still gets bounced right
   back to the login screen with that message. It never reaches the
   dashboard, even for the instant before sign-out completes (session
   state isn't set until after the role check passes).

### Mobile app

Existing Supabase Auth flow (predates this restructure, unchanged):
`context/AuthContext.tsx` wraps `supabase.auth`, session persists across
app restarts, sign-in is plain email/password. No role gating — any
authenticated user can use the mobile app as a farmer.

### Creating a test user

Supabase Dashboard → **Authentication → Users → Add user**, toggle
**"Auto Confirm User" ON** (otherwise it sits unconfirmed and can't sign
in until it verifies an email you probably can't receive).

**You do not need to manually insert a `profile` row.** The
`handle_new_auth_user()` trigger (migration 0008, `AFTER INSERT ON
auth.users`) fires automatically and creates the matching `profile` row
itself, with `role` defaulting to `'farm_user'`. To make someone an
admin, **update their existing `profile.role`** — don't insert a second
row:

```sql
update profile set role = 'admin' where email = 'someone@example.com';
```

**Check who exists and what role they have:**

```sql
select id, email, name, role, created_at from profile order by created_at;
```

### Known gaps — real, worth knowing before you hit them

- **There is no forgot-password screen on either app.** Not "not
  wired up" — it does not exist in the UI at all. If someone forgets a
  password, the only fix today is resetting it from the Supabase
  dashboard (Authentication → Users → select user → "Send password
  recovery" or set a new password directly). This is a real gap worth
  someone building.
- **There are currently three admin accounts, one with a typo'd domain:
  `admin@aggroflow.test`** (extra "g" — `aggroflow`, not `agroflow`).
  That domain can never receive real email, so Supabase's password
  recovery email will never arrive for that account. Combined with the
  point above, that account's password can only ever be reset by
  someone going directly into the Supabase dashboard — there is no
  self-service path for it at all.

## 9. Farmer onboarding — not finished, needs completing

This is a handover, not a feature description. **Two disconnected UI
paths exist, and neither one alone can onboard a real farmer end to
end.**

### Path A — Users page → "Create Farmer" / "Invite Farmer"

`apps/web/admin/src/pages/users.ts` has two buttons that open a small
drawer (`app/interactions.ts`, cases `create-farmer-direct` and
`invite-farmer`) asking only for name/email/(password)/**Farm ID**. On
submit, these call `createFarmer()` / `inviteFarmer()` in
`services/agroFlowApi.ts`, which are **real** — they POST to
`AgroFlow.Api`'s `/api/farmers/create` / `/api/farmers/invite`
(`FarmerOnboardingEndpoints.cs`), gated by `RequireAuthorization()` +
`AdminOnlyFilter` (checks `profile.role = 'admin'` server-side, not just
client-side).

Server-side, both endpoints read `Supabase:ServiceRoleKey` and
`Supabase:Url` from config and call **Supabase's own Admin Auth API**
directly (`POST {supabaseUrl}/auth/v1/admin/users` for create,
`/auth/v1/invite` for invite) — this is why they need the service role
key: creating an `auth.users` row directly, or sending a real invite
email, both require admin-level Supabase Auth access that the anon key
doesn't have. `FarmId` travels as `user_metadata.invitedFarmId` on that
call.

**What actually happens to `farm`/`farm_member`/`zone` here:** once
Supabase creates the `auth.users` row, the `handle_new_auth_user()`
trigger (section 8) fires and creates the `profile` row automatically.
If `invitedFarmId` was set, the trigger also inserts one `farm_member`
row linking the new profile to that farm. **That's it — no `farm` row
and no `zone` rows are created by this path at all.** It only works if
the Farm ID the admin types in already exists. There is no farm-picker,
no validation that the ID is real, and if it isn't:
`farm_member.farm_id` presumably has a foreign key to `farm` (verify
this — see section 6), so a bad ID would fail that insert inside the
trigger, which runs in the same transaction as the `auth.users` insert
— meaning the whole account creation would fail with whatever raw error
Supabase's Admin API surfaces, not a friendly "farm not found" message.
**Not confirmed against the live database — check the FK and test this
before relying on it.**

Also note: the comment at the top of `agroFlowApi.ts` still says "no
login flow exists in this dashboard yet" — that's stale, left over from
before Phase 4 added real admin login. Ignore it; the endpoints
themselves are unaffected.

### Path B — "+ Onboard Farmer" wizard

`apps/web/admin/src/pages/onboarding.ts` is a two-step wizard: step 1
collects farmer details (name/email/phone/password/role), step 2
collects **farm name, location, size, and a dynamic list of zones**
(name + hectares each). This looks like the complete flow — it's the
one that actually asks for farm and zone details.

**It doesn't call the real backend at all.** Its submit handler
(`onboarding-submit` in `interactions.ts`) calls `api.onboardFarmer()`
in `data/api.ts`, which is **entirely in-memory**: it fabricates a
`newFarmId` (`max(existing farm ids) + 1`), fabricates zone IDs the same
way, and creates a `User` object with `id: "pending-${newFarmId}"` — not
a real Supabase Auth UUID, not a real account. Nothing is written to
Postgres. Refresh the page and it's gone. The function's own comment
claims `createFarmer`/`inviteFarmer` are "the real write path" and this
is just "the local working-copy side... for immediate UI feedback," but
the wizard never actually calls either of those — so in practice, going
through this path creates nothing real at all, silently.

### What's missing before a real farmer can be onboarded end to end

1. **A way to create a `farm` row for real.** Nothing in the codebase
   does this today — even the admin "Register Farm" drawer
   (`add-farm` case) just shows a success toast with no write behind
   it. Confirm whether `farm`'s live RLS policies even permit an admin
   client-side insert (section 5/6) before deciding whether this should
   be a direct Supabase insert or needs `service_role` via the API.
2. **A way to create the `zone` rows** the wizard already collects UI
   input for, tied to whichever farm was just created.
3. **`FarmerOnboardingEndpoints.cs` needs to accept farm/zone details**,
   not just an existing `FarmId` — or a second endpoint needs to exist
   that creates the farm+zones first and hands back an ID for the
   existing create/invite call to use.
4. **The wizard's submit handler needs to call the real endpoint(s)**
   instead of (or in addition to) the in-memory `api.onboardFarmer()`.
5. **Path A's bad-Farm-ID failure mode needs a real check** — validate
   the farm exists before calling Supabase's Admin API, with a proper
   error message instead of whatever raw 500 falls out of a failed
   trigger.
6. If you want farmer emails to actually arrive: `inviteFarmer`'s
   underlying `/auth/v1/invite` call only delivers if the Supabase
   project has real SMTP configured (Settings → Auth → SMTP Settings) —
   the shared default is low-volume/rate-limited, fine for testing,
   not for real farmers.

Pick a design (do path A and B merge into one wizard that does
everything server-side? does farm+zone creation become its own admin
page ahead of onboarding?) before writing code — this is a design
decision, not just a wiring gap.
