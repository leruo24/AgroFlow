-- The language a farmer chose in the app (Settings -> Language), so the Telegram messages
-- AgroFlow sends them use it too: 'en' English, 'af' Afrikaans, 'tn' Setswana.
-- Afrikaans and Setswana are first drafts still being checked (docs/translations-review.md).
--
-- Written by the API only (PUT /api/farmer/language, as the signed-in farmer, on their own
-- row), so no client grant is added: the column is covered by profile's existing row level
-- security (0011), and `authenticated` may still update only `name` on its own row.
--
-- Safe to run more than once.

alter table profile
    add column if not exists language text not null default 'en';

do $$
begin
    if not exists (
        select 1 from pg_constraint
         where conname = 'profile_language_check'
           and conrelid = 'public.profile'::regclass
    ) then
        alter table profile
            add constraint profile_language_check check (language in ('en', 'af', 'tn'));
    end if;
end
$$;

comment on column profile.language is
    'App and Telegram language chosen by the farmer: en, af or tn. Default en.';

-- Unchanged, restated so this file says where profile stands: RLS on, no new client grant.
alter table profile enable row level security;
