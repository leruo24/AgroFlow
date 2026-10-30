# Telegram is for farmers only

AgroFlow staff (admins and field officers) never link Telegram and are never messaged there.
Everything staff need is in the admin site: Home's **Needs attention** list and the
**notification bell** at the top of every page. Farmers keep Telegram for onboarding, alerts,
reports and Forgot password.

## What moved off Telegram

| Notice | Was sent by | Now |
|---|---|---|
| A new farm or zone request | `NotifyAdminsOfFarmRequestAsync`: every admin with a linked chat | Requests page, Home "New requests waiting", bell |
| A new enquiry (someone asked for a call) | `NotifyAdminsAsync` from `EnquiryEndpoints`: every admin with a chat | Enquiries page, Home "Enquiries waiting for a call", bell |
| A call-back that is due | the enquiry follow-up | Home "Call-backs due", bell |
| A kit offline or faulty, a critical zone alert | `BroadcastToFarmAsync` reached any staff member on the farm (a field officer as a farm member) | Kits / Alerts pages, Home "Kits offline or faulty" and "Open critical alerts", bell. Farmers still get it on Telegram. |
| Weather, sensor and equipment alerts for a farm | the same `BroadcastToFarmAsync` | Staff left out; farmers unchanged |
| An automatic report | `ReportGenerationService`: also the staff member who set up the schedule and the admin group chat | Reports page in the admin site; the farmer still gets it on Telegram |

`NotifyAdminsAsync` and `NotifyAdminsOfFarmRequestAsync` now only log (callers unchanged);
the old Telegram code is kept beside them, unused. Every farm-wide Telegram query adds
`StaffTelegram.NotStaffSql` (`p.role not in ('admin', 'field_officer')`).

## Linking is blocked for staff

- **API:** `POST /api/telegram/admin/codes/{id}`, `POST /api/telegram/admin/codes/{id}/link` and
  `POST /api/telegram/me/code` answer 409 "Telegram is for farmers only. ..." for a staff
  account.
- **Bot:** a code for a staff account links nothing (the code is not used up) and the bot
  replies with the same sentence (`StaffTelegramRefusedException`).
- **Admin site:** Users lists farmers only (field officers were listed before), the Telegram
  column says "Staff do not use Telegram" for staff, there is no Connect for them, and
  Settings → My account has no Telegram panel.

## Staff who were already linked

`StaffTelegramCleanupService` runs when the API starts: every staff account that still has a
`telegram_chat_id` is unlinked, and each one is written to the audit log as
`telegram.staff_unlinked` with the name and email (Platform Activity in the admin site). It
also logs one warning line listing them. The second start finds nobody. To see who it was:

```sql
select created_at, details->>'name' as name, details->>'email' as email
  from admin_audit_log where action = 'telegram.staff_unlinked' order by created_at;
```

Before the new API is deployed, this lists who will be unlinked:

```sql
select id, name, email, role from profile
 where role in ('admin', 'field_officer') and telegram_chat_id is not null;
```

## Staff passwords

- **Forgot password** on the admin site is always Supabase's email: a link back to the admin
  site's `?reset=1` page. The page says "Check your inbox and your spam folder." Staff never
  get a Telegram code, even with an old chat still on the account.
- An admin cannot give a staff account a temporary password (409: staff reset by email).
- **Change password** is in the account menu (top right): it opens Settings → My account at the
  new-password box.

Tests: `backend/AgroFlow.Domain.Tests/StaffTelegramTests.cs`, the staff cases in
`PasswordResetFlowTests.cs`, `apps/web/admin/tests/staff-telegram.spec.ts`, and the Forgot
password test in `sponsor-admin.spec.ts`.
