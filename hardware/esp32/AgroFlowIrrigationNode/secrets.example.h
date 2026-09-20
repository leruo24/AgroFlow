// secrets.example.h - template for the gitignored secrets.h.
//
// Before flashing: copy this file to secrets.h (same folder) and replace the
// placeholder values with the real ones.
//
//     cp secrets.example.h secrets.h      then edit secrets.h
//
// secrets.h is gitignored and must never be committed.
//
// IF YOU ALREADY HAVE A secrets.h, IT WILL NOT BE UPDATED BY A GIT PULL -
// it is gitignored, so git never touches it. API_BASE_URL moved into this
// file, so an older secrets.h will now fail to compile with
// "API_BASE_URL was not declared in this scope". Copy the API_BASE_URL line
// below into your secrets.h and you are done; your API_KEY and MQTT_PASSWORD
// are unaffected.

#pragma once

// Base URL of the AgroFlow.Api host, no trailing slash. Device claiming, the
// firmware version check, irrigation events and command acknowledgements all
// go here over HTTP. Sensor readings and command DELIVERY go over MQTT
// instead - see MQTT_HOST in the sketch.
//
// This lives here rather than in the sketch because it changes per
// deployment: it used to be a hardcoded LAN address, which made every network
// change a reflash. The deployed API is the default below and needs no
// editing.
//
// NOTE: THIS IS AN https:// URL and the firmware speaks TLS to it via
// WiFiClientSecure (see beginApiRequest() in the sketch). Pointing this at a
// plain http:// address - a local `dotnet run` on your laptop, say - will NOT
// work as-is, because beginApiRequest always negotiates TLS. For local
// backend work, either put the API behind an HTTPS tunnel or temporarily swap
// that one helper back to a plain WiFiClient.
const char *API_BASE_URL = "https://agroflow-production-998d.up.railway.app";

// Shared device API key. Sent as the X-Api-Key header on every AgroFlow.Api
// call. Must exactly match the "ApiKey" value in AgroFlow.Api's user-secrets
// (in backend/AgroFlow.Api: `dotnet user-secrets list`) - and, for the
// deployed API, the ApiKey environment variable in Railway. Same key on every
// board - it proves "this is a genuine AgroFlow device", not a per-device
// identity (that is what enrollment/claim establishes).
const char *API_KEY = "YOUR_SHARED_API_KEY";

// HiveMQ Cloud password for the MQTT_USERNAME account (HiveMQ Cloud console
// -> your cluster -> Access Management). Must match "Mqtt:Password" in
// AgroFlow.Api's user-secrets / the Mqtt__Password Railway variable.
const char *MQTT_PASSWORD = "YOUR_MQTT_PASSWORD";

// No Supabase URL or anon key here, deliberately. The board used to hold them
// to mark irrigation commands 'executed' via a direct Supabase REST PATCH;
// that path was removed because it could never have worked (migration 0011
// grants anon SELECT only on irrigation_commands). Acknowledgements now go to
// AgroFlow.Api instead. This board needs no Supabase credential - do not add
// one back.
