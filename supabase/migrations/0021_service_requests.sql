-- Farmer service requests for new farms and new zones.
-- Farmers submit requests; admins manage the request status.

create table service_request (
    id              bigint generated always as identity primary key,
    farmer_id       uuid not null references profile (id) on delete cascade,
    farm_id         bigint references farm (farm_id) on delete set null,
    request_type    text not null
                    check (request_type in ('new_farm', 'new_zone')),
    location        text,
    rough_size      real,
    crop_type       text not null check (crop_type in ('potato', 'tomato', 'citrus', 'leafy_veg', 'maize', 'dry_beans')),
    notes           text,
    status          text not null default 'pending'
                    check (status in ('pending', 'scheduled', 'completed')),
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now(),

    constraint service_request_new_farm_location_check
        check (
            request_type <> 'new_farm'
            or nullif(trim(location), '') is not null
        ),

    constraint service_request_new_zone_farm_check
        check (
            request_type <> 'new_zone'
            or farm_id is not null
        ),

    constraint service_request_size_check
        check (
            rough_size is null
            or rough_size > 0
        )
);

create index idx_service_request_farmer_id
    on service_request (farmer_id);

create index idx_service_request_farm_id
    on service_request (farm_id);

create index idx_service_request_status
    on service_request (status);

create index idx_service_request_created_at
    on service_request (created_at desc);

create trigger trg_service_request_updated_at
    before update on service_request
    for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------

alter table service_request enable row level security;

grant select, insert, update on service_request to authenticated;
grant usage, select on sequence service_request_id_seq to authenticated;

-- Farmers can see their own submitted requests.
create policy service_request_select_own
    on service_request
    for select
    to authenticated
    using (farmer_id = auth.uid());

-- Farmers can submit requests only under their own profile.
-- Farm ownership is additionally enforced by FarmerEndpoints.cs.
create policy service_request_insert_own
    on service_request
    for insert
    to authenticated
    with check (farmer_id = auth.uid());

-- Admins can view and manage all requests.
create policy service_request_all_admin
    on service_request
    for all
    to authenticated
    using (app_is_admin())
    with check (app_is_admin());