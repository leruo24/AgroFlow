-- Public enquiries: people interested in AgroFlow ask for a call back
-- (item 6c).
--
-- ENQUIRY
-- One row per "Get a call back" form. Inserted only by AgroFlow.Api's public
-- endpoint (validated, rate-limited, honeypot-checked); admins read it and
-- move it on through the API, which takes the admin from the login.
--
-- ENQUIRY_CALL
-- Every call an admin logs - who, when, how it went, why not, and the note.
-- APPEND-ONLY: no update or delete policy for anyone, so the history shows
-- every attempt. The one change the API ever makes to a call row is
-- blanking its note when the person's details are deleted (below).
--
-- PRIVACY (POPIA)
-- consent_at records that the person agreed to be contacted and to these
-- details being kept for that purpose. "Delete personal details" blanks
-- full_name, phone and email and sets anonymised_at; province, town, crops,
-- outcome and reason stay, for the statistics.
--
-- RLS on, admins read, nobody writes through RLS: the API connects as the
-- table owner. Additive and idempotent: safe to re-run.

create table if not exists enquiry (
    id                      bigint generated always as identity primary key,
    full_name               text,
    phone                   text,
    email                   text,
    province                text not null,
    town                    text,
    farm_size_ha            numeric,
    crops                   text[] not null default '{}',
    crops_other             text,
    best_time               text not null check (best_time in ('morning', 'afternoon', 'evening')),
    notes                   text,
    consent_at              timestamptz not null,

    -- Where it has got to: new -> open (someone has it) -> won / lost / closed.
    status                  text not null default 'new'
                            check (status in ('new', 'open', 'won', 'lost', 'closed')),
    handled_by_profile_id   uuid references profile (id) on delete set null,
    claimed_at              timestamptz,
    callback_at             timestamptz,
    no_answer_count         integer not null default 0,
    first_called_at         timestamptz,
    outcome                 text,
    reason                  text,
    reason_other            text,
    farmer_profile_id       uuid references profile (id) on delete set null,
    closed_at               timestamptz,
    anonymised_at           timestamptz,
    created_at              timestamptz not null default now()
);

create index if not exists idx_enquiry_created on enquiry (created_at desc);
create index if not exists idx_enquiry_status on enquiry (status, callback_at);

create table if not exists enquiry_call (
    id                 bigint generated always as identity primary key,
    enquiry_id         bigint not null references enquiry (id) on delete cascade,
    caller_profile_id  uuid references profile (id) on delete set null,
    caller_name        text not null default 'Unknown',
    called_at          timestamptz not null default now(),
    outcome            text not null check (outcome in ('wants', 'callback', 'no_answer', 'not_interested')),
    reason             text,
    reason_other       text,
    note               text,
    callback_at        timestamptz
);

create index if not exists idx_enquiry_call_enquiry on enquiry_call (enquiry_id, called_at);

alter table enquiry enable row level security;
alter table enquiry_call enable row level security;

grant select on enquiry to authenticated;
grant select on enquiry_call to authenticated;

drop policy if exists enquiry_select_admin on enquiry;
create policy enquiry_select_admin
    on enquiry
    for select
    to authenticated
    using (exists (select 1 from profile p where p.id = auth.uid() and p.role = 'admin'));

drop policy if exists enquiry_call_select_admin on enquiry_call;
create policy enquiry_call_select_admin
    on enquiry_call
    for select
    to authenticated
    using (exists (select 1 from profile p where p.id = auth.uid() and p.role = 'admin'));

comment on table enquiry is
    'Public "Get a call back" enquiries (item 6c). Inserted only by AgroFlow.Api; admins read. Personal details can be anonymised (POPIA).';
comment on table enquiry_call is
    'Append-only log of every call made about an enquiry: who, when, outcome, reason, note.';
