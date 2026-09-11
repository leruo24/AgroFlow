// secrets.example.h - template for the gitignored secrets.h.
//
// Before flashing: copy this file to secrets.h (same folder) and replace the
// placeholder values with the real ones.
//
//     cp secrets.example.h secrets.h      then edit secrets.h
//
// secrets.h is gitignored and must never be committed. Only the two actual
// credentials live here - everything else that varies per deployment (broker
// host, MQTT username, API base URL, Supabase URL/anon key) stays as plain
// constants in AgroFlowIrrigationNode.ino.

#pragma once

// Shared device API key. Sent as the X-Api-Key header on every AgroFlow.Api
// call. Must exactly match the "ApiKey" value in AgroFlow.Api's user-secrets
// (in backend/AgroFlow.Api: `dotnet user-secrets list`). Same key on every
// board - it proves "this is a genuine AgroFlow device", not a per-device
// identity (that is what enrollment/claim establishes).
const char *API_KEY = "YOUR_SHARED_API_KEY";

// HiveMQ Cloud password for the MQTT_USERNAME account (HiveMQ Cloud console
// -> your cluster -> Access Management). Must match "Mqtt:Password" in
// AgroFlow.Api's user-secrets.
const char *MQTT_PASSWORD = "YOUR_MQTT_PASSWORD";
