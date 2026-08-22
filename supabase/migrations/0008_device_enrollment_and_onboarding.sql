-- Device enrollment/claim (hardware table), and farmer onboarding on top of
-- Supabase Auth's own invite/admin-create mechanisms rather than a
-- hand-rolled token table - see the profile-creation trigger below.

-- ---------------------------------------------------------------------------
-- hardware: enrollment lifecycle is a SEPARATE axis from the existing
-- `status` column, which tracks live connectivity (Offline/Online). A device
-- can be enrollment_status='active' while status='Offline' (it's just
-- powered down) - these aren't the same concern, so not merged into one
-- column. Nothing currently reads/writes `status` (no firmware code posts to
-- /hardware at all yet), so there was no existing behaviour to preserve
-- either way, but conflating "is this device commissioned" with "is it
-- online right now" would be wrong regardless.
-- ---------------------------------------------------------------------------
alter table hardware
    add column zone_id                    bigint references zone (id) on delete set null,
    add column mac_address                text unique,
    add column enrollment_status          text not null default 'unregistered'
                                           check (enrollment_status in ('unregistered', 'enrolled', 'active')),
    add column enrollment_code            text unique,
    add column enrollment_code_expires_at timestamptz;

create index idx_hardware_zone_id on hardware (zone_id);
create index idx_hardware_enrollment_code on hardware (enrollment_code);

-- ---------------------------------------------------------------------------
-- Farmer onboarding: a profile row is created automatically whenever a new
-- Supabase Auth user is created - this covers BOTH onboarding paths (admin
-- direct-create and invite-link), since AgroFlow.Api's FarmerOnboardingEndpoints
-- routes both through Supabase's own Admin Auth API rather than two separate
-- code paths. invitedFarmId travels as user metadata set at creation time and
-- is consumed here to link the new profile to a farm via farm_member.
-- ---------------------------------------------------------------------------
create or replace function handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_farm_id bigint;
begin
    insert into profile (id, email, name, role)
    values (
        new.id,
        new.email,
        coalesce(new.raw_user_meta_data ->> 'name', ''),
        'farm_user'
    )
    on conflict (id) do nothing;

    v_farm_id := (new.raw_user_meta_data ->> 'invitedFarmId')::bigint;

    if v_farm_id is not null then
        insert into farm_member (farm_id, profile_id)
        values (v_farm_id, new.id)
        on conflict do nothing;
    end if;

    return new;
end;
$$;

create trigger trg_handle_new_auth_user
    after insert on auth.users
    for each row execute function handle_new_auth_user();
