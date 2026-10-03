// Copy to secrets.h (gitignored). v1.2.0+ keeps NO secrets in the firmware image:
// the device token and MQTT login are issued per board by /api/devices/claim and
// stored only in the board's flash. The API address below is not a secret.
#pragma once
const char *API_BASE_URL = "https://agroflow-production-998d.up.railway.app";
