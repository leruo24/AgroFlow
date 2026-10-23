-- Audit fixes, Part B: the enquiry-to-installation journey (docs/audit/fix-report-2026-10-23.md,
-- docs/audit/ui-contracts.md). Everything here is read and written by AgroFlow.Api only; RLS is
-- on for every new table and clients get no grants (the API connects as the table owner).
--
--   service_case             one case per farm, linking the enquiry, farmer, farm, its visits, its
--                            kits and the service status. Its stage is WORKED OUT by the API from
--                            the facts (JourneyStage), not typed in, so it cannot drift:
--                            Enquiry -> Details -> Service agreed -> Account active ->
--                            Ready for installation -> Visit booked -> Installing -> Commissioned/Live.
--   installation_visit       a booked visit: farm, date, named installer. A first installation
--                            needs no device (AF-09).
--   installer_check          the installer checklist per zone: kit linked, wet/dry calibration,
--                            flow measured, run limit, test start/stop. Who, when, and whether the
--                            value was measured or estimated.
--   zone.commission_state    'legacy' for every zone that existed before 0058 (nothing about them
--                            changes, their mode included), 'pending' for new zones, 'commissioned'
--                            once the four checks are done. Only then does the app ask the farmer
--                            "Turn on automatic watering?" (zone.auto_offer_answer).
--   farmer_task              the farmer's four tasks (preferences, farm, water, crops) and when
--                            each was finished, so "Your details: X of 4" is the server's count.
--   help_request             "I don't know - help me": a staff follow-up with an owner.
--   terms_acceptance         who accepted which version of the draft terms / privacy notice, when.
--   app_setting service.*    the example price (R4 000 installation, R610 a month for a 2-zone farm),
--                            staff-editable; no billing exists.
-- Existing zones keep their mode. Safe to run more than once.

-- 1. The case -------------------------------------------------------------------------------

create table if not exists service_case (
    id                 bigint generated always as identity primary key,
    farm_id            bigint references farm (farm_id) on delete cascade,
    enquiry_id         bigint references enquiry (id) on delete set null,
    farmer_profile_id  uuid references profile (id) on delete set null,
    owner_profile_id   uuid references profile (id) on delete set null,
    next_action        text check (next_action is null or char_length(next_action) <= 300),
    follow_up_at       timestamptz,
    -- Recorded by staff when the farmer agreed the service (quote, sponsorship); no billing.
    service_agreed_at  timestamptz,
    service_status     text not null default 'not_agreed'
                       check (service_status in ('not_agreed', 'sponsored', 'paying', 'trial', 'paused', 'ended')),
    payer              text check (payer is null or char_length(payer) <= 120),
    plan_description   text check (plan_description is null or char_length(plan_description) <= 500),
    created_at         timestamptz not null default now(),
    updated_at         timestamptz not null default now()
);

create unique index if not exists ux_service_case_farm on service_case (farm_id) where farm_id is not null;
create unique index if not exists ux_service_case_enquiry on service_case (enquiry_id) where enquiry_id is not null;

alter table service_case enable row level security;
revoke all on service_case from anon, authenticated;

comment on table service_case is
    'One case per farm: enquiry, farmer, farm, visits, kits and service status (Part B). The stage is worked out by the API from these facts. API only.';

-- 2. Visits -----------------------------------------------------------------------------------

create table if not exists installation_visit (
    id                    bigint generated always as identity primary key,
    farm_id               bigint not null references farm (farm_id) on delete cascade,
    kind                  text not null default 'first_installation'
                          check (kind in ('first_installation', 'follow_up', 'maintenance')),
    scheduled_for         timestamptz not null,
    installer_profile_id  uuid references profile (id) on delete set null,
    installer_name        text not null check (char_length(installer_name) between 2 and 120),
    status                text not null default 'booked'
                          check (status in ('booked', 'in_progress', 'done', 'cancelled')),
    notes                 text check (notes is null or char_length(notes) <= 1000),
    created_by            uuid references profile (id) on delete set null,
    created_at            timestamptz not null default now(),
    started_at            timestamptz,
    completed_at          timestamptz,
    cancelled_at          timestamptz
);

create index if not exists idx_installation_visit_farm on installation_visit (farm_id, scheduled_for desc);

alter table installation_visit enable row level security;
revoke all on installation_visit from anon, authenticated;

comment on table installation_visit is
    'A booked installation or follow-up visit: farm, date, named installer. Needs no device (AF-09). API only.';

-- 3. The installer checklist ------------------------------------------------------------------

create table if not exists installer_check (
    id              bigint generated always as identity primary key,
    zone_id         bigint not null references zone (id) on delete cascade,
    item            text not null check (item in ('kit_linked', 'calibration', 'flow_measured', 'run_limit', 'test_start_stop')),
    -- measured: on site with an instrument or a timed container; estimated: a guess or default;
    -- confirmed: checked by eye (for example the kit linked to the right zone).
    provenance      text not null check (provenance in ('measured', 'estimated', 'confirmed')),
    value_text      text check (value_text is null or char_length(value_text) <= 200),
    notes           text check (notes is null or char_length(notes) <= 500),
    done_by         uuid references profile (id) on delete set null,
    done_by_name    text not null,
    done_at         timestamptz not null default now(),
    -- The acknowledged start and stop of the test run, for test_start_stop.
    command_ids     uuid[]
);

create unique index if not exists ux_installer_check_zone_item on installer_check (zone_id, item);

alter table installer_check enable row level security;
revoke all on installer_check from anon, authenticated;

comment on table installer_check is
    'The installer checklist per zone (Part B): who did each item, when, and whether it was measured or estimated. API only.';

-- 4. Commissioning on the zone ----------------------------------------------------------------

alter table zone
    add column if not exists commission_state text,
    add column if not exists commissioned_at timestamptz,
    add column if not exists auto_offer_answer text,
    add column if not exists auto_offer_answered_at timestamptz;

-- Zones that existed before this migration are 'legacy': their mode and behaviour are unchanged.
-- Only the very first run marks them; later runs leave every row alone.
do $guard$
begin
    if not exists (select 1 from pg_constraint where conrelid = 'public.zone'::regclass and conname = 'zone_commission_state_check') then
        update zone set commission_state = 'legacy' where commission_state is null;
        alter table zone add constraint zone_commission_state_check
            check (commission_state in ('legacy', 'pending', 'commissioned'));
    end if;
    if not exists (select 1 from pg_constraint where conrelid = 'public.zone'::regclass and conname = 'zone_auto_offer_answer_check') then
        alter table zone add constraint zone_auto_offer_answer_check
            check (auto_offer_answer is null or auto_offer_answer in ('automatic', 'manual'));
    end if;
end $guard$;

alter table zone alter column commission_state set default 'pending';
alter table zone alter column commission_state set not null;

comment on column zone.commission_state is
    'legacy (existed before 0058, unchanged), pending (new, not commissioned yet), commissioned (kit linked, wet/dry calibration, measured flow and an acknowledged test start/stop). A pending zone cannot be switched to automatic by the farmer.';
comment on column zone.auto_offer_answer is
    'The farmer''s answer to "Turn on automatic watering?", asked once the zone is commissioned: automatic or manual (Keep manual).';

-- 5. The farmer's four tasks ------------------------------------------------------------------

create table if not exists farmer_task (
    profile_id   uuid not null references profile (id) on delete cascade,
    farm_id      bigint not null references farm (farm_id) on delete cascade,
    task         text not null check (task in ('preferences', 'farm', 'water', 'crops')),
    done_at      timestamptz not null default now(),
    primary key (profile_id, farm_id, task)
);

alter table farmer_task enable row level security;
revoke all on farmer_task from anon, authenticated;

comment on table farmer_task is
    'The four farmer tasks (Your preferences / Your farm / Your water / Your crops) and when each was finished. API only.';

-- 6. "I don't know - help me" -----------------------------------------------------------------

create table if not exists help_request (
    id                bigint generated always as identity primary key,
    farm_id           bigint not null references farm (farm_id) on delete cascade,
    zone_id           bigint references zone (id) on delete cascade,
    profile_id        uuid references profile (id) on delete set null,
    topic             text not null check (topic in (
                          'location', 'water_source', 'tank_capacity', 'tank_level', 'crop', 'planting_date',
                          'irrigation_type', 'soil_type', 'area', 'other')),
    note              text check (note is null or char_length(note) <= 500),
    status            text not null default 'open' check (status in ('open', 'resolved')),
    owner_profile_id  uuid references profile (id) on delete set null,
    created_at        timestamptz not null default now(),
    resolved_at       timestamptz,
    resolved_by       uuid references profile (id) on delete set null,
    resolution        text check (resolution is null or char_length(resolution) <= 500)
);

create index if not exists idx_help_request_open on help_request (farm_id, created_at desc) where status = 'open';
-- One open request per farm, zone and topic: asking twice is the same request.
create unique index if not exists ux_help_request_open_topic
    on help_request (farm_id, coalesce(zone_id, 0), topic) where status = 'open';

alter table help_request enable row level security;
revoke all on help_request from anon, authenticated;

comment on table help_request is
    '"I don''t know - help me" from a farmer task: a staff follow-up with an owner (the case owner, else whoever onboarded the farm). API only.';

-- 7. Terms and privacy acceptance -------------------------------------------------------------

create table if not exists terms_acceptance (
    id            bigint generated always as identity primary key,
    profile_id    uuid not null references profile (id) on delete cascade,
    document      text not null check (document in ('terms', 'privacy')),
    version       text not null check (char_length(version) between 1 and 40),
    accepted_at   timestamptz not null default now(),
    method        text not null default 'app_checkbox' check (method in ('app_checkbox')),
    unique (profile_id, document, version)
);

alter table terms_acceptance enable row level security;
revoke all on terms_acceptance from anon, authenticated;

comment on table terms_acceptance is
    'Who accepted which version of the (draft) terms of service and privacy notice, when, and how. Recorded only from the farmer''s own sign-in. API only.';

-- 8. Example service price (no billing) -------------------------------------------------------

insert into app_setting (key, value, description, source) values
  ('service.installation_price_zar', '4000', 'Example installation price shown to farmers, in rand, for the example farm (hardware included).', 'AgroFlow pricing model (audit decision)'),
  ('service.monthly_price_zar', '610', 'Example monthly service price shown to farmers, in rand, for the example farm.', 'AgroFlow pricing model (audit decision)'),
  ('service.example_zones', '2', 'How many zones the example price is for.', 'AgroFlow pricing model (audit decision)'),
  ('service.price_label', '"example for a 2-zone farm; final quote after a site visit"', 'The words shown with the example price.', 'AgroFlow pricing model (audit decision)')
on conflict (key) do nothing;
