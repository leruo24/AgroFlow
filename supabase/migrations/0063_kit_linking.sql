-- Kit linking that just works (October 2026).
--
-- 1. A kit can be linked again: to another zone, another farmer's zone, or as a replacement.
--    hardware.device_id was UNIQUE across every row (0008, renamed in 0009), so a kit that had
--    been linked once could never be claimed onto a new hardware row: the claim's update hit the
--    constraint and the API answered 503. Now only one ACTIVE row may hold a device id; older
--    rows keep their device id and their readings as history.
-- 2. 'replaced': the status of a link that ended (the kit was moved, replaced or unlinked).
-- 3. hardware.status_reported_at: when the kit last published its own online/offline status
--    (agroflow/<deviceId>/status, firmware 1.7.2). An "offline" last will is kept until the kit
--    says it is back, instead of the quiet-device sweep guessing from old activity.
-- 4. telegram_onboarding_code.web_opened_at: the farmer opened the welcome web page (no
--    Telegram). The temporary password is shown on that first open only.
--
-- Safe to run twice.

alter table hardware drop constraint if exists hardware_device_id_key;

create unique index if not exists uq_hardware_device_id_active
    on hardware (device_id)
    where enrollment_status = 'active' and device_id is not null;

create index if not exists idx_hardware_device_id on hardware (device_id);

alter table hardware drop constraint if exists hardware_enrollment_status_check;
alter table hardware
    add constraint hardware_enrollment_status_check
    check (enrollment_status in ('unregistered', 'enrolled', 'active', 'replaced'));

alter table hardware
    add column if not exists status_reported_at timestamptz;

alter table telegram_onboarding_code
    add column if not exists web_opened_at timestamptz;
