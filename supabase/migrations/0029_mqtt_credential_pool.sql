-- A pool of per-device MQTT logins, handed out automatically at claim.
--
-- WHY A POOL AND NOT AN API CALL
-- ------------------------------
-- Every board currently connects to HiveMQ as the same `agroflow-device`
-- user, so the broker cannot tell two kits apart and one leaked password
-- lets anyone publish readings for any farm or subscribe to any zone's
-- commands.
--
-- The obvious fix is to create a broker credential per board at claim time.
-- HiveMQ Cloud's credential management API needs the paid Starter plan, and
-- this project is on the free tier. So the logins are created BY HAND in the
-- HiveMQ console in batches, pasted into the admin "MQTT logins" page, and
-- this table hands them out one per board, automatically, inside the claim
-- transaction. The board never knows the difference: it asks
-- GET /api/devices/mqtt-credentials on every boot and gets whatever is
-- assigned to it.
--
-- If the plan is ever upgraded, this table becomes the cache in front of
-- HiveMQ's API rather than a manual queue, and nothing else has to change.
--
-- WHY THE PASSWORD IS ENCRYPTED AND NOT HASHED
-- --------------------------------------------
-- Unlike the device token in 0028, this password must be given BACK to the
-- board in plaintext on every boot - the board authenticates to HiveMQ with
-- it, not to us. A hash is therefore useless. It is encrypted at rest with
-- AES-GCM under Mqtt:PoolEncryptionKey (a Railway variable, never in the
-- repo), so a leaked database dump alone yields nothing.
--
-- Idempotent: re-running this file is a no-op, not an error.

create table if not exists mqtt_credential_pool (
    id                  bigint generated always as identity primary key,

    -- As typed into the HiveMQ console. Unique so the same login cannot be
    -- pasted into the pool twice and then assigned to two different boards.
    username            text not null unique,

    -- AES-GCM ciphertext, base64. Never a plaintext password, and never
    -- logged. See MqttPoolSecretBox in AgroFlow.Domain for the format.
    password_encrypted  text not null,

    -- hardware.device_id (the ESP32 efuse ID), not hardware_id: the claim
    -- flow knows the board by the ID it presents, and a hardware row can be
    -- deleted and re-created around the same physical board. Unique so one
    -- login can never be assigned to two boards; the matching "one board
    -- holds at most one login" half is the partial unique index below.
    --
    -- Deliberately NOT a foreign key to hardware.device_id. An `on delete set
    -- null` there would null this column while leaving assigned_at set, which
    -- violates the consistency CHECK below and would make deleting a hardware
    -- row fail outright. The relationship it would model is also not quite
    -- true: an assignment outlives the hardware row, because the point of
    -- burning a login is that it stays accounted for after the kit it was
    -- issued to is gone. Unassignment is explicit, in the revoke path.
    assigned_device_id  text unique,

    assigned_at         timestamptz,

    -- Set when a device is revoked. The password is now considered loose in
    -- the world: it must be changed in the HiveMQ console before the login
    -- is ever handed out again, so a burned row is never reassigned by this
    -- system. The admin re-adds it as a new row once rotated.
    burned_at           timestamptz,

    created_at          timestamptz not null default now(),

    -- An assignment is a device plus a timestamp, or neither. A row with one
    -- and not the other means an interrupted assignment, which would make
    -- "oldest free login" ambiguous.
    constraint mqtt_credential_pool_assignment_consistent
        check ((assigned_device_id is null) = (assigned_at is null))
);

-- The claim-time query: oldest free, non-burned entry first. Partial, so it
-- holds only the rows actually eligible for assignment - which on a healthy
-- pool is a handful of rows, and on an exhausted one is none.
create index if not exists idx_mqtt_credential_pool_free
    on mqtt_credential_pool (created_at)
    where assigned_device_id is null and burned_at is null;

-- "A device holds at most one assigned login." Enforced here rather than in
-- C# because a re-enrolled board hits the claim path again and the two claims
-- can overlap. assigned_device_id's own unique constraint already covers
-- this, but it also counts nulls as distinct, so this partial index states
-- the intent for the non-null case explicitly and survives any later change
-- to that column.
create unique index if not exists idx_mqtt_credential_pool_one_per_device
    on mqtt_credential_pool (assigned_device_id)
    where assigned_device_id is not null;

comment on table mqtt_credential_pool is
    'Hand-created HiveMQ logins, handed out one per board inside the claim transaction. API-only: no client role has any grant on this table.';
comment on column mqtt_credential_pool.password_encrypted is
    'AES-GCM ciphertext (base64) under Mqtt:PoolEncryptionKey. Decrypted only to answer GET /api/devices/mqtt-credentials for the owning device. Never logged, never shown in the admin UI.';
comment on column mqtt_credential_pool.burned_at is
    'Set when the owning device is revoked. The admin must change this password in the HiveMQ console, then re-add it as a new pool row. A burned row is never reassigned.';

-- ---------------------------------------------------------------------------
-- Row-level security
--
-- Deliberately different from every other table in this schema. The others
-- enable RLS and then grant `authenticated` a scoped SELECT. This one grants
-- NOTHING to any client role: the pool is an API-internal credential store,
-- not farm data, and no screen in either app has a legitimate reason to read
-- even the usernames directly. The admin "MQTT logins" page goes through
-- AgroFlow.Api like the rest of the admin device actions.
--
-- RLS is enabled anyway, as defence in depth: if a future migration or a
-- Supabase default ever hands `authenticated` a blanket grant on this
-- schema, RLS-with-no-policies still denies every row rather than exposing
-- the table. AgroFlow.Api connects as `postgres`, which owns the table and
-- so bypasses RLS - the same arrangement 0011 explains for
-- irrigation_commands.
-- ---------------------------------------------------------------------------
alter table mqtt_credential_pool enable row level security;

-- Belt and braces: revoke anything a default privilege might have granted
-- when the table was created.
revoke all on mqtt_credential_pool from authenticated;
revoke all on mqtt_credential_pool from anon;
revoke all on sequence mqtt_credential_pool_id_seq from authenticated;
revoke all on sequence mqtt_credential_pool_id_seq from anon;
