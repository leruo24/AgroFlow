# Signing in and resetting a password

AgroFlow has no email server for farmers, so passwords are handed over and reset through
Telegram, or in person by a field officer. This page covers every path, the rules behind
each one, and the settings they need.

Code: `backend/AgroFlow.Domain/SignInRules.cs` (the rules),
`backend/AgroFlow.Api/Services/PasswordResetFlow.cs` (the flows),
`backend/AgroFlow.Api/Endpoints/PasswordResetEndpoints.cs` (the routes),
`supabase/migrations/0050_password_reset_and_sign_in.sql` (the tables).
Tests: `backend/AgroFlow.Domain.Tests/PasswordResetFlowTests.cs`,
`apps/mobile/src/components/__tests__/passwordReset.test.tsx`,
`apps/web/admin/tests/sponsor-admin.spec.ts` (sections 5 and 5b).

## 1. Temporary passwords

Every password AgroFlow makes (at onboarding, from the bot, or from an admin reset) is:

| Rule | Value |
|---|---|
| Length | 8 characters |
| Characters | `ABCDEFGHJKMNPQRSTUVWXYZ23456789`: capitals and digits, never `0 O 1 I L` |
| Mix | always at least one letter and one digit |
| Shown as | two groups of four: `KX7P 4MRT` |
| Typed as | with or without the space, in any case: `kx7p4mrt` works |
| Lifetime | 72 hours, then it stops working |
| After sign-in | must be changed (step 2 of the setup wizard) |

The space is only for reading. Supabase stores `KX7P4MRT`. The app first tries what was typed,
then the tidied form (`lib/signInHelp.ts`), so a password the farmer chose themselves is never
changed. When a sign-in that looks like a temporary password is refused, the login screen
explains how to type it and that it expires after 72 hours.

**Expiry.** `profile.temp_password_expires_at` is set when the password is issued and cleared
when the farmer sets their own. `TemporaryPasswordExpiryService` runs every 15 minutes and
replaces any expired temporary password with a random 43-character one nobody knows. The
farmer then needs a reset (section 3 or 4).

**Supabase settings** (Authentication → Sign In / Providers → Email, or Auth → Policies,
depending on the dashboard version):
- *Minimum password length* must be **8 or less**. The default is 6, which is fine.
- *Password requirements* must be **No required characters** or **Letters and digits**. Do not
  choose a setting that needs lowercase letters or symbols: temporary passwords have neither,
  and Supabase would refuse every one.

## 2. One-tap sign-in from the Telegram welcome

When a farmer scans the onboarding QR code, the bot's welcome message holds their email, the
temporary password, and a **Sign in to AgroFlow** button.

- The button opens `{SignIn:LinkBaseUrl}/signin?token=…`. The token is 256 random bits. Only
  its SHA-256 hash is stored (`sign_in_link`). It works **once**, for **24 hours**.
- `app/signin.tsx` sends the token to `POST /api/auth/one-tap`. The API marks it used and asks
  Supabase for a magic-link token hash (`/auth/v1/admin/generate_link`, nothing is emailed).
  The app calls `supabase.auth.verifyOtp({ token_hash, type: 'magiclink' })` and opens the
  setup wizard, which starts with choosing an own password.
- A used, expired or made-up link shows "This sign-in link has expired or was already used.
  Sign in with your temporary password instead." The typed password from the same message
  still works.
- With no `SignIn:LinkBaseUrl` set, the welcome has the typed password only, with no button.

**Web: works now.** Set `SignIn__LinkBaseUrl` on Railway to the farmer web app's address.

**Android: (b), not built yet.** Telegram buttons can only open `http(s)` links, not
`agroflow://`. For the button to open the installed app instead of the browser, Android
needs App Links:
1. `app.json` → `android.intentFilters` for `https://<web host>/signin` with `autoVerify: true`.
2. `https://<web host>/.well-known/assetlinks.json` with the app's package name and the
   SHA-256 fingerprint of the signing key.
3. A new APK built with that filter.

Until then the button opens the web app in the phone's browser, where one-tap works, and the
farmer signs in to the Android app with the typed password.

## 3. Forgot password: a code by Telegram

1. **Ask.** The farmer enters their email on *Forgot password* (app or admin site).
   `POST /api/auth/forgot-password` always gives the same reply: "If this account has Telegram
   linked, we've sent a code. No Telegram? Ask your AgroFlow field officer to reset it." So it
   cannot be used to find out which emails have accounts.
2. **The code.** If the account has a linked chat, the bot sends a 6-digit code, in the
   farmer's saved language: "Your AgroFlow code is 482913. It works for 10 minutes. If this
   wasn't you, ignore this and tell AgroFlow."
3. **Change.** The farmer types the code (a space is fine) and a new password of at least 8
   characters. `POST /api/auth/reset-password` sets the password, marks the code used,
   cancels any other open codes, clears the temporary-password flag, **signs the account out
   everywhere** (`delete from auth.sessions`), writes an audit entry
   (`user.password_reset_self`), and the bot confirms: "Your password was changed. If this
   wasn't you, tell AgroFlow straight away."

| Limit | Value |
|---|---|
| Code | 6 digits, salted SHA-256 hash only (`password_reset_code`) |
| Lifetime | 10 minutes |
| Use | once |
| Wrong tries | 5, then the code is dead even if the right one is typed |
| Requests | 3 an hour per account; more get the same reply and no message |

Answers: 200 changed; 400 "That code is not right, or it has expired."; 400 "Use at least 8
characters…"; 429 "Too many tries. Ask for a new code."

**No Telegram.** Farmers get nothing sent, and the reply tells them to ask their field officer.
**Staff with no Telegram** get Supabase's email reset instead: a link back to the admin
site's `?reset=1` page. That URL must be in Supabase's Redirect URLs list.

## 4. Admin "Reset password"

On *Users* (the row's **Reset** link, or **Reset password** in a farmer's profile drawer) and on
the onboarding handover screen. The admin is asked first, because the old password stops
working at once.

`POST /api/admin/farmers/{id}/reset-password` (staff only) makes a new temporary password
(section 1, 72 hours, must be changed):
- **Telegram linked:** sent to the farmer's chat in their language. The admin never sees it.
- **No Telegram:** shown to the admin **once**, large, in groups of four, to read out. It is
  not stored anywhere.

Every reset is audited (`user.password_reset`). The two older routes
`/api/telegram/admin/password/{id}` and `/{id}/send` do the same thing, so old links still work.

## 5. Alerts and reports: where they arrive

| What | In the app | Telegram |
|---|---|---|
| Sensor and watering alerts | always (Alerts) | if linked and alerts are on |
| Reports | always (Reports) | if linked |
| Weather warnings | the forecast is in the app, but the warning message is not saved | if linked and alerts are on |
| Password codes and resets | — | if linked |

Unlinking Telegram (Profile, or Users → profile → Unlink Telegram) stops Telegram messages
only. Everything in the first column keeps working. Weather warnings are the one gap: today
they only go by Telegram.

## 6. Settings and order

1. Run migration `0050_password_reset_and_sign_in.sql` (after 0049). Re-running it is safe.
   `docs/ops/verify-migrations.sql` has a row for it.
2. Supabase: password length and requirements (section 1); the admin `?reset=1` address in
   Redirect URLs (section 3).
3. Railway: `SignIn__LinkBaseUrl` = the farmer web app's address, for example
   `https://app.example.org`. Leave it unset for no button.
4. The API must reach `auth.sessions` to sign other devices out. With the Supabase `postgres`
   connection it can. If it cannot, the password still changes, and the problem is logged.
