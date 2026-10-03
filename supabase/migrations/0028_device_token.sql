-- Per-device API tokens for firmware v1.3.0.
--
-- WHY
-- ---
-- Every board used to present the same compiled-in X-Api-Key. One stolen or
-- dismantled kit therefore handed over the credential for the entire fleet,
-- and the only remedy was to rotate the key and reflash every board by hand.
-- There was also no way to answer "which board sent this?" from the
-- credential itself - the ACK endpoint had to take the device's word for it
-- via a deviceId in the request body.
--
-- v1.3.0 gives each board its own token, minted by POST /api/devices/claim
-- (the one-time enrollment code is that call's authorisation) and returned
-- exactly once. The board keeps it in flash; the server keeps ONLY its
-- SHA-256 hash. Revoking one board cuts off that board alone, immediately,
-- with nothing to reflash.
--
-- WHY A HASH AND NOT THE TOKEN
-- ----------------------------
-- The token is a bearer credential: anything holding it can post readings
-- and acknowledge commands as that board. Storing it in plaintext would mean
-- a single leaked database backup impersonates the whole fleet. A SHA-256
-- hash is enough here - unlike a password, this is 32 bytes of
-- cryptographically random data, so there is nothing to brute-force and no
-- need for a slow KDF.
--
-- Idempotent: re-running this file is a no-op, not an error.

-- ---------------------------------------------------------------------------
-- 1. Columns
-- ---------------------------------------------------------------------------
alter table hardware
    add column if not exists device_token_hash  text,
    add column if not exists token_issued_at    timestamptz,
    add column if not exists token_revoked_at   timestamptz,
    -- Reported by the board on claim and on every firmware-check. Needed by
    -- the farmer's Kit screen and the admin hardware page, and it is what
    -- tells you when Devices:LegacyApiKeyEnabled can finally be turned off.
    add column if not exists firmware_version   text;

-- Unique so two boards can never end up sharing a token, which would break
-- the "resolve the device FROM the credential" guarantee the device
-- endpoints now depend on. Partial, because the overwhelming majority of
-- rows have no token: legacy boards, and hardware rows that are enrolled but
-- not yet claimed.
create unique index if not exists idx_hardware_device_token_hash
    on hardware (device_token_hash)
    where device_token_hash is not null;

-- Every device request looks a token up by hash and checks it is not
-- revoked. The partial unique index above already serves the lookup; this
-- one keeps the "is it live" half off the table.
create index if not exists idx_hardware_token_active
    on hardware (device_token_hash)
    where device_token_hash is not null and token_revoked_at is null;

comment on column hardware.device_token_hash is
    'SHA-256 (hex) of this board''s device token. The token itself is returned once by /api/devices/claim and exists nowhere on the server. Never readable by a client - see the column grants below.';
comment on column hardware.token_revoked_at is
    'Set by the admin Revoke action. A revoked token gets 401; three consecutive 401s make the board wipe its own credentials and reopen its setup page.';
comment on column hardware.firmware_version is
    'Last version the board reported. Devices:LegacyApiKeyEnabled can be retired once every row here reads 1.3.0 or later.';

-- ---------------------------------------------------------------------------
-- 2. Keep the token columns away from clients
--
-- 0011_row_level_security.sql granted `select on hardware to authenticated`,
-- which is a WHOLE-TABLE grant - it would cover these three new columns
-- automatically, and the farmer's own app holds an `authenticated` JWT. RLS
-- restricts which ROWS that role sees, never which COLUMNS, so the
-- hardware_select_member policy does not help here: a farmer can legitimately
-- see their own kit's row, and would therefore see its token hash and
-- revocation state.
--
-- A hash is not the token, so this is not a direct impersonation route. It is
-- still an offline-verifiable fingerprint of a live credential, and it has no
-- business leaving the server at all. Nothing in the mobile app or the admin
-- dashboard reads these columns - both go through AgroFlow.Api, which
-- connects as `postgres` and so is unaffected by any of this.
--
-- Postgres has no "grant select on all columns except" form, so the
-- whole-table grant is replaced by an explicit column list. Revoking first
-- is what actually removes the old broad grant; the column grant then adds
-- back exactly the columns that existed before this migration.
-- ---------------------------------------------------------------------------
revoke select on hardware from authenticated;

grant select (
    hardware_id,
    device_name,
    device_type,
    status,
    last_seen,
    created_at,
    updated_at,
    zone_id,
    device_id,
    enrollment_status,
    firmware_version
) on hardware to authenticated;

-- enrollment_code / enrollment_code_expires_at are deliberately absent as
-- well. A live enrollment code is a single-use credential that claims a
-- board onto a zone; it was reachable by any authenticated user before this
-- purely because the 0011 grant was table-wide. The admin dashboard receives
-- codes in the /api/devices/enroll response, not by selecting them.

-- ---------------------------------------------------------------------------
-- 3. Nothing to backfill
--
-- Existing rows keep device_token_hash = null, which is exactly right: those
-- boards run v1.1.0 or earlier, have no token, and continue on the shared
-- X-Api-Key while Devices:LegacyApiKeyEnabled stays true. They get a token
-- the next time they are re-enrolled with a fresh code.
-- ---------------------------------------------------------------------------
