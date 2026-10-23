-- The kit's own status, from firmware 1.7.1 (fix/kit-setup-info). Each reading the kit publishes
-- now also carries:
--   "rssi"        its Wi-Fi signal in dBm (WiFi.RSSI()), for the farmer's Kit tab line
--                 "Wi-Fi signal: strong / ok / weak";
--   "soilProbeOk" whether its last soil sample was inside the firmware's valid range
--                 (raw 200..4095, SOIL_MIN_VALID). An out-of-range sample is never sent as a
--                 reading, so without this the app could not say "reading out of range - check
--                 the probe" from real data.
-- The API keeps the latest of each on the kit's record, with the time it was reported. A kit on
-- older firmware never sends them: the columns stay null and the app leaves those lines out.
--
-- The API reads and writes these as the table owner; RLS and grants on hardware are unchanged and
-- cover the new columns. Safe to run more than once.

alter table hardware
    add column if not exists wifi_rssi smallint check (wifi_rssi between -127 and 0),
    add column if not exists soil_probe_ok boolean,
    add column if not exists kit_report_at timestamptz;

comment on column hardware.wifi_rssi is
    'The kit''s Wi-Fi signal in dBm at its latest reading (firmware 1.7.1+). Null: not reported.';
comment on column hardware.soil_probe_ok is
    'Whether the kit''s latest soil sample was inside the firmware''s valid range (firmware 1.7.1+). False: out of range, check the probe. Null: not reported.';
comment on column hardware.kit_report_at is
    'When wifi_rssi / soil_probe_ok were last reported.';
