-- Separates the two reasons an onboarding code gets issued, because they must
-- not do the same thing to a farmer's password.
--
-- THE PROBLEM THIS FIXES
-- 0024 gave every code one behaviour: on redemption the bot resets the
-- farmer's password, sends the new one, and sets must_change_password. That is
-- right for on-site onboarding - the admin issues the code and the password
-- has to reach the farmer somehow, and AgroFlow never stored the one shown on
-- the admin screen.
--
-- It is wrong for a farmer who already has an account and a password they use,
-- and who taps "Connect Telegram" in the app only because they want alerts.
-- That farmer was having a working password invalidated and being forced
-- through a password change they never asked for. Every existing farmer would
-- have hit it.
--
-- So a code now carries why it was issued:
--   'onboarding' - issued by an admin (farmer onboarding, or Regenerate code).
--                  Redemption resets the password and forces a change.
--   'link'       - issued by the farmer themselves from the mobile app.
--                  Redemption links the chat and touches nothing else.
--
-- Default 'onboarding' so any code already outstanding when this runs keeps
-- the behaviour it was issued under, and so a missing value can never silently
-- become the quieter option.
--
-- Idempotent - safe to re-run.

alter table telegram_onboarding_code
    add column if not exists purpose text not null default 'onboarding';

-- Added separately from the column so re-running against a database that
-- already has the column still ends up with the constraint.
do $$
begin
    if not exists (
        select 1 from pg_constraint
         where conname = 'telegram_onboarding_code_purpose_check'
    ) then
        alter table telegram_onboarding_code
            add constraint telegram_onboarding_code_purpose_check
            check (purpose in ('onboarding', 'link'));
    end if;
end $$;

-- RLS is unchanged from 0024: still enabled, still zero policies, still no
-- client access. The column is written and read only by AgroFlow.Api.
