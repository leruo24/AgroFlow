-- Schema support required by the authenticated profile API and mobile
-- Profile screen. The live database already exposed profile.phone during
-- development, but the migration history never created it, so a fresh
-- database failed when 0011 attempted to grant access to that column.

alter table profile
    add column if not exists phone text;

-- Remove any broad table-level UPDATE inherited from older/default grants,
-- then retain only the two farmer-editable profile fields. AgroFlow.Api uses
-- the table-owner connection and is unaffected by authenticated-role grants.
revoke update on profile from authenticated;
grant update (name, phone) on profile to authenticated;
