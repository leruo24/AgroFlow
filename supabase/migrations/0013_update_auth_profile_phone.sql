-- Keep the Auth -> profile trigger aligned with the farmer onboarding flow.
--
-- The onboarding API stores the farmer's phone number in
-- auth.users.raw_user_meta_data. This trigger copies that value into
-- profile.phone when the Auth user is created.

create or replace function handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    v_farm_id bigint;
begin
    insert into profile (
        id,
        email,
        name,
        phone,
        role
    )
    values (
        new.id,
        new.email,
        coalesce(new.raw_user_meta_data ->> 'name', ''),
        nullif(new.raw_user_meta_data ->> 'phone', ''),
        'farm_user'
    )
    on conflict (id) do nothing;

    v_farm_id :=
        (new.raw_user_meta_data ->> 'invitedFarmId')::bigint;

    if v_farm_id is not null then
        insert into farm_member (
            farm_id,
            profile_id
        )
        values (
            v_farm_id,
            new.id
        )
        on conflict do nothing;
    end if;

    return new;
end;
$$;