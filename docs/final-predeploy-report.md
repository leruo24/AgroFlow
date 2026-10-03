# Final pre-deploy report

Branch `feature/final-predeploy`, nine commits off `dev`. 66 files, +7703 / −669.

**Nothing in this report has been applied to the live database.** Five migrations are
written and committed; the order to apply them is in §2.

---

## 1. What changed, by step

### Step 1 — Firmware replaced

| | |
|---|---|
| **Replaced** | `hardware/esp32/AgroFlowIrrigationNode/AgroFlowIrrigationNode.ino` — the supplied v1.3.0 sketch, **byte-for-byte**, verified with `diff` after copying. No local edits. |
| **Replaced** | `hardware/esp32/AgroFlowIrrigationNode/secrets.example.h` — now `API_BASE_URL` only. |
| **Removed** | **Nothing.** `git ls-files "*.ino"` returns exactly one path, the file replaced above, and there is no other firmware folder in the repo. There were no obsolete sketches to delete. |
| **Untouched** | `hardware/shared/` (updated, not removed — see below), and the gitignored local `secrets.h`. |

Also in step 1:

- `Firmware:LatestVersion` 1.0.0 → **1.3.0** in `appsettings.json`, and the `DownloadUrl`
  filename with it. Without this, firmware-check would keep advertising an "update" to
  boards already running 1.3.0 and they would re-flash themselves in a loop every 4 hours.
- `hardware/shared/MQTT_TOPICS.md`: new **Device authentication** section (per-board
  `X-Device-Token`, hash-only storage, 401 handling, the legacy flag), the
  `Temperature`/`Humidity` sensor payloads, and the `open_setup` / `change_wifi` commands.
  Its stale "the firmware needs the same MQTT credentials" note is corrected — the firmware
  no longer holds any MQTT credential at all.
- `hardware/esp32/build/` added to `.gitignore` for the OTA `.bin`.

**`arduino-cli` is not installed on this machine**, so no `.bin` was compiled. See §7.

### Step 2 — Temperature and Humidity readings

The MQTT subscriber **was not filtering to `SoilMoisture`** — it passed whatever
`sensorType` arrived straight into the insert — so storing the two new DHT11 readings
needed no widening at all. What it had instead was *no list whatsoever*: an unrecognised
`sensorType` reached Postgres, violated `sensor_reading`'s CHECK constraint
(`0002_relationships.sql`) and surfaced as a logged exception **once per message**.

- New `SensorReadingTypes` in `AgroFlow.Domain` — one allow-list both transports share,
  plus `DrivesIrrigation()`.
- `MqttConnectionService` now drops an unrecognised type with one warning, the same way it
  already handles an unparseable topic.
- `SensorReadingEndpoints` uses the shared list instead of its own private copy.
- All three types are stored; **only `SoilMoisture` may start a pump**. A hot afternoon is
  not a reason to open a valve, and that is now stated where the decision is made rather
  than implied by a string compare.

**No migration needed** — the CHECK has allowed these exact three values since 0002.

### Step 3 — Per-device token

- `DeviceToken` (Domain): 32 CSPRNG bytes, base64url, returned **once**, stored only as
  SHA-256 hex. SHA-256 and not bcrypt/argon2 deliberately: there is nothing to guess in 256
  bits of random, and this hash is computed on every device request from boards that report
  every 30 seconds.
- `DeviceAuthService` resolves `X-Device-Token` to a specific board, returning its
  hardware/zone/farm — because every caller needs the *resolved device*, not a yes/no.
- `POST /api/devices/claim` **no longer requires `X-Api-Key`**. That compiled-in fleet
  secret is precisely what this release removes from the firmware image, so a freshly
  flashed board has no credential of any kind until the claim answers. Every existing code
  check is unchanged (single-use, 24-hour expiry, device-ID match, row lock).
- `ClaimRateLimiter` takes over the shared key's brute-force role: per-IP **failed**-claim
  counters, successes never limited (an install day is a burst of them from one office IP).
- Device endpoints — `/api/irrigation-events`, `/api/devices/commands/{id}/executed`,
  `/api/devices/firmware-check`, `/api/devices/mqtt-credentials` — authenticate with
  `X-Device-Token` and resolve the device from it. Unknown or revoked → **401**.
- The ACK's ownership check now has **both sides server-derived**: the expected device from
  the command's zone, the caller from the credential. It used to read a `deviceId` out of
  the request body, which was only as strong as the shared key behind it.
- Legacy boards: `X-Api-Key` still accepted behind `Devices:LegacyApiKeyEnabled`
  (default `true`), with a warning logged on **every** use, not once.

### Step 4 — Pooled per-device MQTT login

- `mqtt_credential_pool` (0029), RLS on with **no client grants at all** — deliberately
  unlike every other table here, because this is an API-internal credential store, not farm
  data.
- `MqttPoolSecretBox` (Domain): AES-GCM under `Mqtt:PoolEncryptionKey`. **Encrypted, not
  hashed**, because the board authenticates to *HiveMQ* with this password, so it has to
  come back in plaintext — a hash cannot do that. GCM's tag makes a tampered row fail loudly
  instead of handing a board bytes that cannot work.
- Assignment happens **inside the claim transaction**, oldest free entry first, with
  `for update skip locked` — two boards powered up in the same second on an install day
  must not be handed the same login, or their broker sessions evict each other forever.
- A re-enrolled or factory-reset board **reuses** its existing entry rather than taking
  another, so a reset does not eat another login out of a pool that is refilled by hand.
- **Empty pool:** the claim still completes, falls back to the shared credential, and logs
  `MQTT login pool empty.` as an admin alert. A claim that failed outright would leave an
  engineer standing in a field with a kit that will not enrol.
- `GET /api/devices/mqtt-credentials` — token-only, no legacy route in. Handing out "some
  device's" broker password would defeat the entire per-device split.
- **Revoke** burns the entry and unassigns it, and tells the admin to rotate it in the
  HiveMQ console. A burned login is never reassigned: the board that held it was usually
  lost or stolen, so the password must be treated as known to whoever has the board.
- Admin **MQTT logins** page: paste a batch, see username / status / dates, warning under
  three free. **No endpoint returns a password** — the list query does not even `SELECT` the
  encrypted column.

### Step 5 — `open_setup` and `change_wifi`

Both ride `irrigation_commands` rather than a table of their own, because that table
already *is* the device command pipeline: insert → trigger → `pg_notify` →
`IrrigationCommandNotifyService` → the device's existing `.../commands` topic, with a uuid
the firmware ACKs and a replay sweep that redelivers anything a board missed. A parallel
table for two commands would need a second trigger, channel, publisher and ACK route to
carry an identical envelope to an identical topic.

- `GET /api/farmer/zones/{id}/hardware` — online/offline, last seen, firmware version,
  token status, and a **per-sensor** working flag with each sensor's last reading time.
- `POST /api/farmer/zones/{id}/hardware/change-wifi` — farm access check, **409** with the
  power-cycle instruction when the kit is offline.
- Admin: change-wifi, open-setup, revoke. `open_setup` does **not** require the board to be
  online — it keeps the WiFi, so queueing it for an absent board is a reasonable admin
  action. The farmer has no equivalent, because "maybe later" is not an answer to give
  someone standing in a field.

`DeviceLiveness` uses a **5-minute** window, deliberately *not*
`DeviceMonitor:OfflineAfterMinutes` (30). Those answer different questions: 30 minutes is
"quiet long enough to message the farmer about"; 5 minutes is "will a command I publish
right now actually arrive?". Using 30 here would accept a change-wifi for a kit unplugged
twenty minutes ago, publish into the void, and leave the farmer waiting for a setup network
that never appears.

### Step 6 — Mobile

**New: `src/app/zone-hardware.tsx`** — "Your kit". *Kit* everywhere the farmer can see it,
never "hardware", "device" or "node": the thing in the field is a small box they were handed
on installation day, and that is the only name they have for it.

- Status in one line of plain words, not a coloured dot. Every state carries its words as
  well as its colour, so the screen reads in sunlight, in greyscale, and to a colour-blind
  farmer.
- Sensors reported **individually**, because they fail individually. A dead DHT11 alongside
  a working soil probe is ordinary — watering carries on, because the soil probe is what
  decides it — and the screen says exactly that. Reporting it as "kit broken" would send a
  farmer driving to a field for nothing.
- Change WiFi: confirm dialog, then a three-step instructions **sheet**. The network name
  and password stay readable on screen, because the farmer has to leave the app at step 1
  and come back.
- Offline (409): the power-cycle instruction renders **in the page**, not an alert — it is
  the only route back into a board that cannot be reached over the network, and the farmer
  is standing at the kit while they read it.

**Zone screen:** `HelpButton`, `ZoneInsightsCard`, `ZoneGrowthBar`, `ResetRecommendedButton`,
`CalibrateSoilSheet` and a Soil type link were all **built and merged but mounted nowhere** —
the FAO-56 engine had no farmer-visible surface at all. All six are now mounted, plus the
Kit row, straight after the live readings: the readings say what is happening, these say
what to do about it. Each renders nothing when its data is missing, so a zone with no crop,
planting date or calibration looks exactly as it did.

`ZoneGrowthBar` needed a season **length**, which nothing served — `zone_water_balance` has
`stage` and `day_of_season` but not the total, and "day 62" with no total is not a progress
bar. `GET /zones/{id}/insights` now also returns a `growth` block, computed from the crop's
Table 11 stage lengths. Additive; the existing `insights` array is untouched.

**Settings:** a "Connect Telegram" row showing Connected / Not connected. Read-only — the
linking itself stays in `TelegramSection` on Profile, and duplicating it would give two
places that could disagree about one account. An unknown status shows **nothing** rather
than telling a connected farmer they are not connected.

`helpContent.zoneHardware` added, so the Kit screen gets its "?" button.

### Step 7 — Telegram

**Linking already existed** and works end to end (code → deep link → `/start` → polling).
So the webhook is a second **delivery route for inbound updates**, not a second linking
mechanism: it hands the update to the same `TelegramPollingService.HandleUpdateAsync` the
poller calls.

Why add it: polling's documented hazard is that Telegram gives each update to exactly **one**
`getUpdates` consumer, so a developer running the API locally with
`Telegram__EnablePolling=true` silently steals the `/start` of a farmer standing in a field.
A webhook has no such mode. Both can be live at once — nothing in the handler touches the
poller's offset, and code redemption is a single atomic statement, so an update delivered
twice links once.

- `POST /api/telegram/webhook` — anonymous by necessity, gated solely on
  `X-Telegram-Bot-Api-Secret-Token`, compared in fixed time and **failing closed** when the
  secret is unset. Always returns 200 after that check, because Telegram retries a non-2xx
  for a while and an unprocessable update would otherwise be redelivered forever.
- `POST /api/farmer/telegram/link-code` — a **15-minute** `Link` code (never `Onboarding`,
  which would reset a working password; that is what migration 0025 exists to prevent).
  `IssueCodeAsync` gained an *optional* lifetime, so every existing caller is untouched.
- The three farmer messages and the admin notice, with the copy in `FarmRequestMessages`
  (reviewable in one file, like the in-app help). On submit, on Scheduled, on Completed.
- **No date is ever named** in the Scheduled message: `service_request` (0021) has no date
  column. The parameter is carried through so adding one later is a one-line change.
- Send-once via a ledger keyed `(request, stage, audience)` — migration 0032.
- `PUT /api/admin/requests/{id}/status`: the dashboard wrote `service_request.status`
  straight to Supabase, so **nothing server-side ever learned a status had changed** and
  there was no moment at which a message could be sent. The write moves to the API; the RLS
  policy and the direct route both remain, so an older dashboard build keeps working
  silently.

**Two deliberate deviations from the brief, both flagged:**

1. The brief's bot reply is `✅ AgroFlow alerts are on for {name}.` The existing `/start`
   reply is longer and says more (what the bot will message about, that sign-in details are
   unchanged, how to turn alerts off). Replacing a working, more informative message with a
   terser one is a downgrade, so the existing copy was **kept**. Change it in
   `TelegramPollingService.HandleStartAsync` if you want the brief's wording.
2. The brief implies the webhook replaces polling. Polling is **still registered** and still
   defaults to off. If you register the webhook (§6), leave `Telegram__EnablePolling=false`
   everywhere — running both against one bot token is harmless but pointless.

### Step 8 — Admin dashboard

- Hardware page: **Change WiFi**, **Open setup page**, **Revoke**, each behind a confirm
  drawer that says what will actually happen. Revoke's spells out that it cannot be undone,
  that the board will need a *new* enrollment code, and that the HiveMQ password change is a
  manual job — then shows that instruction in a **modal**, not a toast, because it is a job
  the admin has to go and do.
- All three are addressed by **zone**, not hardware id: the commands go into
  `irrigation_commands`, which is keyed on zone. A board with no zone has the links omitted
  rather than rendered and then failing on click.
- New columns: Connection, Last seen, Token (`active` / `revoked` / `legacy key`), MQTT
  login username. **Connection is separate from the existing Status column** — 5-minute
  liveness vs. the 30-minute alerting judgement. They legitimately disagree.
- A "legacy key" KPI pair appears **only while such boards exist**, naming the exact
  variable to set once it reaches zero.
- `GET /api/admin/hardware` supplies token status and MQTT username, because **neither can
  be reached from the browser by design** (see 0028's column grants and 0029's absence of
  them). `getHardware()` calls it but **tolerates failure** — the table then renders exactly
  as it did before v1.3.0, since an admin who cannot see their fleet is worse off than one
  who cannot see its token column.
- Farm Requests: **Create enrollment code** on a Scheduled request, using the existing
  `POST /api/devices/enroll` generator unchanged, with a zone picker. A `new_farm` request
  (no farm) or a farm with no zones links to the existing zone setup flow instead of
  offering an action that cannot work. The code is shown in a modal that says plainly it
  cannot be shown again.

### Step 9 — Small fixes

- **9a** `GetScheduleAsync` was the only one of the four report endpoints without the admin
  clause (the other three have it at lines 54, 179, 1024). An administrator could open every
  other report for a farm they are not a member of, and got a bare "Farm not found." on the
  schedule — which reads as a data problem rather than the permission check it was. Fixed.
- **9b** Migration 0031 narrows `zone_water_balance_all_admin` from `FOR ALL` to
  `FOR SELECT`.
- **9c** **Already done on `dev`** for the card label (`analytics.ts:158`), as
  `docs/merge-report.md` records — verified and left alone. **Three further instances of the
  same unqualified claim were still in that file** and are now qualified: the regional
  comparison, the per-farm panel and the monthly trend. Same reason as the original fix:
  there is no flow meter anywhere in AgroFlow, so every litre figure is pump runtime ×
  `zone.flow_rate_lpm`.

---

## 2. Migrations — **not applied**, in this order

| # | File | What it does |
|---|---|---|
| 1 | `0028_device_token.sql` | `device_token_hash`, `token_issued_at`, `token_revoked_at`, `firmware_version` on `hardware`. Replaces 0011's whole-table `grant select on hardware` with an explicit **column list**. |
| 2 | `0029_mqtt_credential_pool.sql` | The pool table. RLS on, **no client grants**. |
| 3 | `0030_device_setup_commands.sql` | Extends `irrigation_commands`' command CHECK with `open_setup` / `change_wifi`, additively. |
| 4 | `0031_zone_water_balance_admin_select_only.sql` | Admin policy → SELECT-only. |
| 5 | `0032_service_request_notification.sql` | Send-once ledger for request messages. |

All five are written to be **safe to re-run** (`add column if not exists`,
`create ... if not exists`, `drop policy if exists` before create, `drop constraint if
exists` before add) and contain **no `$$`** — no dollar-quoted blocks anywhere, so they
paste into the Supabase SQL editor without the quoting hazard the existing `do $$ ... $$`
migrations have.

### Two things to check before you apply

**0028 revokes a grant.** `revoke select on hardware from authenticated` followed by a
column-list grant. RLS restricts *rows* and never *columns*, so 0011's table-wide grant
would have exposed the new token columns to any farmer's own JWT on their own kit's row. A
hash is not the token, but it is an offline-verifiable fingerprint of a live credential and
has no business leaving the server. `enrollment_code` is excluded for the same reason — a
live single-use code was reachable by any authenticated user purely because that grant was
table-wide.

→ **If anything other than AgroFlow.Api reads `hardware` directly, check it only uses the
granted columns.** The admin dashboard does (verified). Nothing in the mobile app reads
`hardware` at all.

**0030 drops a constraint by its derived name.** The CHECK in 0004 is anonymous, so Postgres
named it `irrigation_commands_command_check`. Verify before applying:

```sql
select conname, pg_get_constraintdef(oid) from pg_constraint
 where conrelid = 'irrigation_commands'::regclass and contype = 'c';
```

If the live name differs, edit the `DROP` line. A wrong name fails *safely* — the drop is
silent, then the `ADD` fails on the old constraint still being there, so nothing is applied
and the old rule still holds.

---

## 3. Every config key the API reads

Railway spelling: `:` becomes `__`. **New in this change is marked 🆕.**

### Secrets — never in `appsettings.json`

| Key | Railway | Notes |
|---|---|---|
| `ConnectionStrings:Supabase` | `ConnectionStrings__Supabase` | |
| `ApiKey` | `ApiKey` | Still required at startup. Only used by the legacy path now — see §5. |
| `Supabase:ServiceRoleKey` | `Supabase__ServiceRoleKey` | |
| `Mqtt:Password` | `Mqtt__Password` | The shared fallback credential. |
| 🆕 `Mqtt:PoolEncryptionKey` | `Mqtt__PoolEncryptionKey` | **AES-256.** `openssl rand -base64 32`. Base64 or hex; a passphrase is refused rather than stretched. Without it the pool cannot be written or read and every board falls back to the shared login. |
| `Telegram:BotToken` | `Telegram__BotToken` | Absent ⇒ `NullNotificationService`, not a crash. |
| 🆕 `Telegram:WebhookSecret` | `Telegram__WebhookSecret` | **Fails closed** — unset means the webhook refuses everything. |

### Non-secret

| Key | Railway | Default |
|---|---|---|
| `Supabase:Url` / `Supabase:JwksUrl` | `Supabase__Url` / `Supabase__JwksUrl` | in appsettings |
| `Cors:AllowedOrigins` | `Cors__AllowedOrigins__0`, `__1`, … | array |
| `Firmware:LatestVersion` | `Firmware__LatestVersion` | **now 1.3.0** |
| `Firmware:DownloadUrl` | `Firmware__DownloadUrl` | **placeholder — see §7** |
| 🆕 `Devices:LegacyApiKeyEnabled` | `Devices__LegacyApiKeyEnabled` | `true` |
| `Mqtt:Host` / `Mqtt:Port` / `Mqtt:Username` | `Mqtt__Host` / `Mqtt__Port` / `Mqtt__Username` | in appsettings |
| `Telegram:BotUsername` | `Telegram__BotUsername` | `""` |
| `Telegram:EnablePolling` | `Telegram__EnablePolling` | `false` |
| `Telegram:OnboardingCodeTtlDays` | `Telegram__OnboardingCodeTtlDays` | `7` |
| 🆕 `Telegram:LinkCodeTtlMinutes` | `Telegram__LinkCodeTtlMinutes` | `15` |
| `Telegram:LongPollSeconds` | `Telegram__LongPollSeconds` | `30` |
| `Apk:DownloadUrl` | `Apk__DownloadUrl` | `""` |
| `DeviceMonitor:*` (`Enabled`, `OfflineAfterMinutes`, `CheckIntervalMinutes`, `PumpUnresponsiveAfterMinutes`, `SensorSilentAfterMinutes`) | `DeviceMonitor__…` | in appsettings |
| `WeatherAlerts:*` (`Enabled`, `HeavyRainMm`, `FrostMinC`, `HeatMaxC`, `ForecastDays`, `CheckIntervalHours`) | `WeatherAlerts__…` | in appsettings |
| `PasswordReset:*` (`Enabled`, `MinimumIntervalMinutes`, `MaxPerDay`) | `PasswordReset__…` | in appsettings |
| `Weather:FetchIntervalHours` | `Weather__FetchIntervalHours` | `6` |
| `Weather:BackfillDays` | `Weather__BackfillDays` | unset — **remove after use**, or every redeploy repeats the backfill |
| `Fao56Engine:Enabled` | `Fao56Engine__Enabled` | `true` |
| `Irrigation:ReplaySweepIntervalSeconds` | `Irrigation__ReplaySweepIntervalSeconds` | `120` |

**Minimum to set before deploying this build:** `Mqtt__PoolEncryptionKey`. Everything else
either already exists or has a working default. `Telegram__WebhookSecret` is only needed if
you register the webhook.

Clients (unchanged): admin `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`,
`VITE_AGROFLOW_API_BASE`; mobile `EXPO_PUBLIC_SUPABASE_URL`,
`EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `EXPO_PUBLIC_AGROFLOW_API_BASE`,
`EXPO_PUBLIC_AGROFLOW_API_PORT`.

---

## 4. Deploy order

1. Set `Mqtt__PoolEncryptionKey` on Railway (and `Telegram__WebhookSecret` if using §6).
2. Apply migrations 0028 → 0032, in that order, after the two checks in §2.
3. Deploy the API.
4. Create a batch of logins in the HiveMQ console → paste them into **Farm Hardware → MQTT
   logins**. Do this *before* enrolling any kit, or the first ones fall back to the shared
   credential and have to be re-enrolled to pick up their own.
5. Deploy the admin dashboard.
6. Flash the two boards with v1.3.0 and re-enrol each with a fresh enrollment code.
7. Once both report firmware `1.3.0` on the hardware page, set
   `Devices__LegacyApiKeyEnabled=false` (§5).

Steps 2–3 are **not** backwards-compatible with the *previous* API build in one respect: the
API deployed at step 3 expects the 0028 columns. Apply the migrations first.

---

## 5. Retiring `Devices:LegacyApiKeyEnabled`

It defaults to `true` and must stay true until both field boards are on v1.3.0. Flipping it
early takes them offline — including their ability to report the readings that are the only
evidence they need re-enrolling.

1. **Farm Hardware** → the **Token** column. Every row must read `active`. Any row reading
   `legacy key` is a board with no per-device token, still on the shared key. The "On the
   legacy shared key" KPI is the same count.
2. For each such board: flash v1.3.0, generate a fresh enrollment code (Farm Requests →
   Create enrollment code, or `POST /api/devices/enroll`), and enrol it. Boards claimed on
   v1.1.0 or earlier have no token, so they **must** be re-enrolled — there is no upgrade
   path that keeps the old claim.
3. When the count is zero, set `Devices__LegacyApiKeyEnabled=false` and redeploy.
4. Confirm: the log should contain **no** further
   `authenticated with the LEGACY shared X-Api-Key` warnings. Until then, every single use
   logs one — deliberately, so this is grep-able rather than a once-per-start notice you miss.
5. `ApiKey` itself is still required at startup and is still the gate on any device route
   not listed as self-authenticating in `Program.cs`. Keep it set.

---

## 6. Registering the Telegram webhook

**Not called from code.** Nothing in startup calls `setWebhook`, deliberately: a redeploy
would then silently re-point a live bot, and two environments sharing a token would fight
over it. Run this once, by hand.

```bash
curl -X POST "https://api.telegram.org/bot<Telegram__BotToken>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{
        "url": "https://agroflow-production-998d.up.railway.app/api/telegram/webhook",
        "secret_token": "<Telegram__WebhookSecret>",
        "allowed_updates": ["message"],
        "drop_pending_updates": false
      }'
```

- `secret_token` must be **exactly** `Telegram__WebhookSecret`. Telegram echoes it in the
  `X-Telegram-Bot-Api-Secret-Token` header, and a mismatch is a 401 on every call.
- Telegram requires **HTTPS** and a publicly reachable URL. It will not accept localhost, so
  this cannot be tested from a dev machine without a tunnel.
- Verify: `curl "https://api.telegram.org/bot<token>/getWebhookInfo"` →
  `"url"` set, `"pending_update_count": 0`, no `last_error_message`.
- Set `Telegram__EnablePolling=false` everywhere (its default). A webhook and a poller on
  one token do not share the stream.
- To undo: `curl -X POST ".../deleteWebhook"`, then re-enable polling on exactly one
  instance.

---

## 7. OTA firmware image

**No `.bin` was built** — `arduino-cli` is not installed on this machine.

To produce one:

```bash
arduino-cli core install esp32:esp32
arduino-cli lib install "ArduinoJson" "WiFiManager" "PubSubClient" "DHT sensor library for ESPx"
arduino-cli compile --fqbn esp32:esp32:esp32 \
  --output-dir hardware/esp32/build \
  hardware/esp32/AgroFlowIrrigationNode
```

`hardware/esp32/build/` is gitignored. Upload the `.bin` to wherever
`Firmware:DownloadUrl` points and set that variable — it is still the
`https://YOUR_FIRMWARE_HOST/...` placeholder, so **OTA does not work yet**. Until it is set,
boards simply log a failed update check every 4 hours; nothing breaks, and the two boards
have to be flashed over USB regardless (they are on v1.1.0, which predates the token and
cannot OTA to a build that needs one).

---

## 8. Is a new APK needed?

**No.**

- **No new native modules.** The Kit screen uses `react-native`, `lucide-react-native` and
  `expo-router`, all already in the project and already in the existing binary.
- `npx expo-doctor` → 21/21, with no new dependency warnings.
- Everything added is JavaScript and routing, so it ships through the existing OTA update
  channel.
- One caveat: the new `/zone-hardware` route only resolves in a binary whose router bundle
  includes it, which an OTA JS update does provide. If your distribution is a bare APK with
  no update channel configured, you need a rebuild — not because of a native change, but
  because that is the only way any JS reaches the device.

`.expo/types/router.d.ts` was regenerated (it predated `zone-soil.tsx` as well as the new
screen, so typed-route navigation to *either* was a type error). It is gitignored and
regenerates on `expo start`.

---

## 9. Checks

| Check | Result |
|---|---|
| `dotnet build` — Domain, Api, Tests | **clean**, 0 warnings, 0 errors |
| `dotnet test` | **504 passed**, 0 failed, 0 skipped (330 before this branch) |
| mobile `npx tsc --noEmit` | **clean** |
| mobile `npx expo-doctor` | **21/21** |
| admin `npx tsc --noEmit` | **clean** |
| admin `npm run build` | **clean**, 183 modules |
| conflict markers | **none** |

### What the tests actually cover, and what they do not

Honest accounting against the step 10 list. The test project is a **unit** project with no
database, and the live database is read-only on this branch, so the relational invariants
cannot be *executed* here.

| Asked for | Status |
|---|---|
| Claim stores only a hash | ✅ `DeviceTokenTests` — hash ≠ token, deterministic, SHA-256 pinned against a known value |
| Revoked token → 401 | ✅ `DeviceAuthPolicyTests` |
| Empty pool falls back to shared | ✅ `MqttCredentialResolutionTests` |
| Pool passwords stored encrypted | ✅ `MqttPoolSecretBoxTests` — incl. wrong key, tampered row, truncated row |
| ACK rejects another zone's device | ✅ `DeviceCommandOwnershipTests` — incl. the exact old hole (null expected + null caller) |
| change-wifi → 409 when offline | ✅ `DeviceLivenessTests` — boundary inclusive at 5 min |
| Bad webhook secret → 401 | ✅ `TelegramWebhookAuthTests` — incl. fail-closed on unset |
| Each message sends once per request per status | ✅ `FarmRequestMessagesTests` — the ledger **keys**; the uniqueness itself is the index in 0032 |
| A Telegram failure doesn't fail the request | ✅ `FarmRequestNotifierResilienceTests` — the real notifier against an unreachable DB **and** a service that throws on every method |
| Rate-limited failed claims | ✅ `ClaimRateLimiterTests` |
| **Claim returns the fields** (response shape) | ⚠️ **Not executed.** Needs a live claim against a database. The hash-only storage half is covered. |
| **mqtt-credentials returns the device's pool login** | ⚠️ **Partially.** The resolution *rule* is tested; the token-gated round trip is not. |
| **Pool assignment unique under concurrent claims** | ❌ **Not executed.** Enforced by `assigned_device_id text unique` + the partial unique index in 0029 + `for update skip locked`. Verify by hand: enrol two kits within a second of each other and confirm two different usernames. |
| **Revoke burns the pool entry** | ❌ **Not executed.** One `UPDATE ... returning username`. Verify by hand: revoke a kit, check its row reads `burned`. |

The three unexecuted items are all single SQL statements whose correctness rests on database
constraints rather than on branching logic. They are the right things to check by hand at
step 4 of the deploy order. A proper integration suite against a scratch Postgres is the
follow-up that would close them.

---

## 10. Follow-ups

1. **ESP32 flash encryption + secure boot.** The device token sits in NVS in plaintext, so
   anyone with the physical board and a USB cable can read it. Flash encryption closes that.
   It is **permanent and irreversible per chip** and will brick a development board you
   later want to reflash freely — production units only, and only once the firmware is
   settled.
2. **Pin the TLS certificate on the board.** `beginApiRequest` calls
   `client.setInsecure()`, with a `TODO` in the sketch. The board therefore trusts any
   certificate, so anyone who can intercept its traffic can read its token as it is sent.
   Replace with `setCACert()` and ISRG Root X1. Note the trade-off: a pinned root expires,
   and a board that cannot reach the API also cannot be told about the new one — so pair it
   with working OTA (§7) first.
3. **Switch the pool to HiveMQ's credential API** if the plan is upgraded to Starter. The
   table becomes a cache in front of their API rather than a manual queue; `assigned_at` /
   `burned_at` keep their meaning and nothing else has to change. The manual paste page can
   stay as the fallback.
4. **Integration tests against a scratch Postgres**, for the four unexecuted items in §9.
5. **`Firmware:DownloadUrl`** is still a placeholder (§7) — OTA is inert until it is set.
6. **The admin hardware page still shows `maintenanceState: "OK"` for everything**, because
   no column backs it. Pre-existing, documented in `api.ts`, untouched here.

---

## 11. Commits

```
87a526a  feat(firmware): replace sketch with v1.3.0, document the new device contract
91709da  feat(api): accept Temperature and Humidity readings over MQTT
3952f7a  feat(api): per-device tokens and a pooled per-device MQTT login
3322346  feat(api): open_setup and change_wifi commands, Kit status endpoints
9ae3ea7  feat(api): Telegram webhook, link code, and farm-request messages
7aba85e  fix: admin access on GetScheduleAsync, SELECT-only admin water balance, estimate labels
5e09035  feat(mobile): Kit screen, and mount the engine components on the zone screen
001a47a  feat(admin): device actions, MQTT logins page, enrollment codes on requests
7833b1d  test: close the remaining gaps in the step 10 list
```
