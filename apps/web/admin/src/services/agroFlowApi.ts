/* Calls AgroFlow.Api's admin-only farmer onboarding endpoints.
 * Security: both need a real Supabase Auth session (JWT bearer and a profile.role='admin'
 * check on the server; see backend/AgroFlow.Api/Auth/AdminOnlyFilter.cs). The sign-in gate in
 * main.ts means this only runs with such a session, but the check below stays as a backup. */

import { navigationAwareFetch } from "@/lib/navigation";
import { supabase } from "@/lib/supabase";

const API_BASE = import.meta.env["VITE_AGROFLOW_API_BASE"] ?? "";

/* The sentence to show for a refused or failed call. This API sends it as `error` or
 * `message`; ASP.NET problem details use `detail` / `title`. We read all four, and a body
 * that is not JSON shows its text, so a refusal like "Farm size must be greater than 0."
 * reaches the admin as written. */
export function errorMessage(text: string, status: number): string {
  try {
    const problem = JSON.parse(text) as Record<string, unknown>;
    for (const key of ["error", "message", "detail", "title"]) {
      const value = problem?.[key];
      if (typeof value === "string" && value.trim()) return value;
    }
    return `Request failed (${status}).`;   // JSON with no sentence in it: never show it raw
  } catch {
    // Not JSON: the text itself, if there is any.
  }
  return text.trim() || `Request failed (${status}).`;
}

async function postAuthorized<T = void>(path: string, body: unknown): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;

  if (!token) {
    throw new Error("Not signed in.");
  }

  const response = await navigationAwareFetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();

    throw new Error(errorMessage(text, response.status));
  }

  // 204s and empty bodies are normal here (several endpoints only acknowledge), so we try to
  // parse instead of assuming JSON.
  const text = await response.text();

  return (text ? JSON.parse(text) : undefined) as T;
}

async function getAuthorized<T>(path: string): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Not signed in.");
  const response = await navigationAwareFetch(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error(errorMessage(await response.text(), response.status));
  return await response.json() as T;
}

export type LocationSearchResult = {
  name: string;
  detail: string;
  latitude: number;
  longitude: number;
};

export type ReverseLocationResult = {
  locality: string | null;
  district: string | null;
  province: string | null;
  country: string | null;
  displayName: string | null;
};

export function searchLocations(query: string): Promise<LocationSearchResult[]> {
  return getAuthorized(`/api/admin/locations/search?q=${encodeURIComponent(query)}`);
}

export function reverseLocation(latitude: number, longitude: number): Promise<ReverseLocationResult> {
  return getAuthorized(`/api/admin/locations/reverse?latitude=${encodeURIComponent(latitude)}&longitude=${encodeURIComponent(longitude)}`);
}

export async function createFarmer(input: {
  email: string;
  temporaryPassword: string;
  farmId: number;
  name?: string;
}): Promise<void> {
  await postAuthorized("/api/farmers/create", input);
}

export async function inviteFarmer(input: {
  email: string;
  farmId: number;
  name?: string;
}): Promise<void> {
  await postAuthorized("/api/farmers/invite", input);
}

/* What /onboard returns.
 * temporaryPassword is shown once and never stored on the server. No endpoint can fetch it
 * again; "show it again" is a reset that makes a new one (resetTemporaryPassword below).
 * telegramDeepLink is what the handover screen shows as a QR code. It can be null while
 * Telegram:BotUsername is unset; onboarding still worked and the password is the handover. */
export type FarmerOnboardedResult = {
  message: string;
  profileId: string;
  email: string;
  temporaryPassword: string;
  telegramDeepLink: string | null;
  telegramCode: string | null;
  telegramCodeExpiresAt: string | null;
  warning: string | null;
};

export async function onboardFarmer(input: {
  farmer: {
    fullName: string;
    email: string;
    phone: string;
  };
  farm: {
    farmName: string;
    location: string;
    sizeHectares: number;
    zones: {
      name: string;
      sizeHectares: number;
      cropType: string;
      /* Optional so the API still accepts older payloads. */
      soilType?: string;
      areaM2?: number | null;
      plantingDate?: string | null;
      flowRateLpm?: number | null;
      rootDepthLimitM?: number | null;
    }[];
  };
}): Promise<FarmerOnboardedResult> {
  return postAuthorized<FarmerOnboardedResult>("/api/farmers/onboard", input);
}

export type TelegramCodeResult = {
  code: string;
  deepLink: string | null;
  expiresAt: string;
};

/* "Regenerate code", for a QR that expired or a farmer who lost it. A new code cancels the
 * farmer's previous unused one, so an old printout stops working straight away. */
export async function regenerateTelegramCode(
  profileId: string,
): Promise<TelegramCodeResult> {
  return postAuthorized<TelegramCodeResult>(
    `/api/telegram/admin/codes/${profileId}`,
    {},
  );
}

/* Following up a farmer who never connected Telegram, from the users list.
 * A link code, not an onboarding one: this farmer already has an account and password, and
 * redeeming it must only attach their chat. An onboarding code would reset their password
 * (see migration 0025). */
export async function issueLinkCodeForFarmer(
  profileId: string,
): Promise<TelegramCodeResult> {
  return postAuthorized<TelegramCodeResult>(
    `/api/telegram/admin/codes/${profileId}/link`,
    {},
  );
}

/* Sends a new temporary password to the farmer's own Telegram chat, like "Forgot password?"
 * in the app, started by an admin for a farmer who phones in. Unlike resetTemporaryPassword
 * below, the admin never sees the password. It fails if the farmer has no Telegram; then the
 * read-it-out version below is the right one. */
export async function sendTemporaryPasswordViaTelegram(
  profileId: string,
): Promise<{ message: string }> {
  return postAuthorized<{ message: string }>(
    `/api/telegram/admin/password/${profileId}/send`,
    {},
  );
}

/* The fallback for a farmer with no Telegram, and the only answer to "what was their
 * password again?": AgroFlow never stored it, so this makes a new one and returns it once. */
export async function resetTemporaryPassword(
  profileId: string,
): Promise<{ temporaryPassword: string; notice: string }> {
  return postAuthorized<{ temporaryPassword: string; notice: string }>(
    `/api/telegram/admin/password/${profileId}`,
    {},
  );
}
export async function registerFarm(input: {
  ownerId: string;
  farm: {
    farmName: string;
    location: string;
    sizeHectares: number;
    /* farm.latitude/longitude (migration 0010). Null when the admin skipped the map; the weather
     * lookup then uses the district, which is worse than a pin but better than a wrong pin. */
    latitude?: number | null;
    longitude?: number | null;
    zones: {
      name: string;
      sizeHectares: number;
      cropType: string;
      /* Optional so the API still accepts older payloads. */
      soilType?: string;
      areaM2?: number | null;
      plantingDate?: string | null;
      flowRateLpm?: number | null;
      rootDepthLimitM?: number | null;
    }[];
  };
}): Promise<void> {
  await postAuthorized("/api/farms/register", input);
}

export async function updateFarmLocation(
  farmId: number,
  input: { location: string; latitude: number; longitude: number },
): Promise<void> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Not signed in.");
  const response = await navigationAwareFetch(`${API_BASE}/api/farms/${farmId}/location`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error(errorMessage(await response.text(), response.status));
}
export type FarmerOption = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
};

export async function getFarmers(): Promise<FarmerOption[]> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;

  if (!token) {
    throw new Error("Not signed in.");
  }

  const response = await navigationAwareFetch(
    `${API_BASE}/api/users/farmers`,
    {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  );

  if (!response.ok) {
    const text = await response.text();

    throw new Error(errorMessage(text, response.status));
  }

  return await response.json() as FarmerOption[];
}
export async function deleteFarmerUser(id: string): Promise<void> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;

  if (!token) {
    throw new Error("Not signed in.");
  }

  const response = await navigationAwareFetch(
    `${API_BASE}/api/users/${id}`,
    {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  );

  if (!response.ok) {
    const text = await response.text();

    throw new Error(errorMessage(text, response.status));
  }
}

export async function deleteFarm(id: number): Promise<void> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;

  if (!token) {
    throw new Error("Not signed in.");
  }

  const response = await navigationAwareFetch(
    `${API_BASE}/api/farms/${id}`,
    {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  );

  if (!response.ok) {
    const text = await response.text();

    throw new Error(errorMessage(text, response.status));
  }
}

/* Reports (live data) */

async function reportError(response: Response): Promise<Error> {
  return new Error(errorMessage(await response.text(), response.status));
}

async function reportFetch(path: string): Promise<Response> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Not signed in.");

  const response = await navigationAwareFetch(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw await reportError(response);
  return response;
}

export type ReportFarm = { farm_id: number; name: string; owner_name: string | null };
export type ReportZone = { zoneId: number; name: string; cropType: string | null };

export async function getReportFarms(): Promise<ReportFarm[]> {
  return (await reportFetch("/api/farms")).json() as Promise<ReportFarm[]>;
}

/* The report PDF as a blob, for the on-screen Preview. It is the same file
   the PDF button downloads, so the two cannot differ. */
export async function fetchReportPdfBlob(path: string): Promise<Blob> {
  return (await reportFetch(`/api/farmer/reports/${path}`)).blob();
}

export async function getReportZones(farmId: number): Promise<ReportZone[]> {
  return (await reportFetch(`/api/farmer/reports/zones?farmId=${farmId}`)).json() as Promise<ReportZone[]>;
}

/* Downloads a report PDF. A plain link cannot be used because the endpoint
   needs the login token in a header, so the file is fetched as a blob and
   saved through a temporary link. */
export async function downloadReportPdf(path: string, fileName: string): Promise<void> {
  const response = await reportFetch(`/api/farmer/reports/${path}`);
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
/* The platform summary as a PDF. Built on the server, unlike the .xlsx, because a PDF gets
 * printed, filed and emailed, so it carries its own figures, timestamp and author. See
 * backend/.../AdminSummaryEndpoints.cs. */
/* Any authorised file, by full API path. downloadReportPdf takes a path under
 * /api/farmer/reports and always names the file .pdf, which does not fit the workbook route. */
export async function downloadReportFile(path: string, fileName: string): Promise<void> {
  const response = await reportFetch(path);
  const blob = await response.blob();

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();

  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export async function downloadSummaryPdf(): Promise<void> {
  const response = await reportFetch("/api/admin/summary.pdf");
  const blob = await response.blob();

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `agroflow-summary-${new Date().toISOString().slice(0, 10)}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();

  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/* Settings
 * There is no settings table, so the Settings page only shows what is real. */

export type PlatformConfigValue = { label: string; value: string; explains: string };
export type PlatformConfigGroup = { title: string; setIn: string; values: PlatformConfigValue[] };

/**
 * The thresholds the running services use, read from the same configuration. Read-only:
 * they are environment variables on the deployment.
 */

/**
 * The signed-in admin's own name and phone. The endpoint is under /api/farmer, but it only
 * checks the caller's own id, so it updates whoever holds the token, here the admin.
 */
export function updateMyProfile(input: { name: string; phone: string | null }): Promise<void> {
  return authorizedJson<void>("/api/farmer/profile", "PUT", input);
}

export type TelegramLinkStatus = { linked: boolean; alertsEnabled: boolean };

export function getMyTelegramStatus(): Promise<TelegramLinkStatus> {
  return authorizedJson<TelegramLinkStatus>("/api/telegram/me", "GET");
}

export function requestMyTelegramCode(): Promise<EnrollmentCodeLikeTelegram> {
  return authorizedJson<EnrollmentCodeLikeTelegram>("/api/telegram/me/code", "POST", {});
}

export type EnrollmentCodeLikeTelegram = {
  code: string;
  deepLink: string | null;
  expiresAt: string;
};

export function disconnectMyTelegram(): Promise<void> {
  return authorizedJson<void>("/api/telegram/me", "DELETE");
}

/** Disconnects a farmer's Telegram (lost or changed phone) so they can link again with a new
 *  code. The API also cancels their unused codes and records it in the activity log. */
export function unlinkFarmerTelegram(profileId: string): Promise<{ message: string; wasLinked: boolean }> {
  return authorizedJson(`/api/telegram/admin/link/${encodeURIComponent(profileId)}`, "DELETE");
}

/* Hardware
 * The dashboard reads most tables straight from Supabase under RLS, but these cannot:
 * - tokenStatus needs hardware.device_token_hash and token_revoked_at. Migration 0028
 * replaced 0011's whole-table select with a column list that leaves both out, because RLS
 * limits rows, not columns, and a farmer's JWT could otherwise read its kit's token hash.
 * - mqttUsername needs mqtt_credential_pool, which 0029 grants no client role at all.
 * - Revoking a device must burn a pool entry in the same action, which the browser cannot do.
 * - change-wifi / open-setup write to irrigation_commands, which 0011 grants SELECT only on
 * purpose: an INSERT there drives a physical valve. */

async function authorizedJson<T>(
  path: string,
  method: "GET" | "POST" | "PUT" | "DELETE",
  body?: unknown,
): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;

  if (!token) {
    throw new Error("Not signed in.");
  }

  const response = await navigationAwareFetch(`${API_BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

  if (!response.ok) {
    throw await reportError(response);
  }

  const text = await response.text();

  return (text ? JSON.parse(text) : undefined) as T;
}

export type AdminHardwareRow = {
  hardwareId: number;
  deviceId: string | null;
  deviceName: string;
  zoneId: number | null;
  zoneName: string | null;
  farmName: string | null;
  online: boolean;
  lastSeen: string | null;
  firmwareVersion: string | null;
  enrollmentStatus: string;
  /** active / revoked / legacy key / no device */
  tokenStatus: string;
  mqttUsername: string | null;
};

export function getAdminHardware(): Promise<AdminHardwareRow[]> {
  return authorizedJson<AdminHardwareRow[]>("/api/admin/hardware", "GET");
}

export type SetupCommandResult = {
  commandId: string;
  setupNetworkName: string;
  setupNetworkPassword: string;
};

/* Makes the kit forget its WiFi and open its setup network. 409 when the kit has not been
 * heard from in 5 minutes, since nobody would ever see the setup network appear. */
export function deviceChangeWifi(zoneId: number): Promise<SetupCommandResult> {
  return authorizedJson<SetupCommandResult>(
    `/api/admin/zones/${zoneId}/hardware/change-wifi`,
    "POST",
    {},
  );
}

/* Opens the setup page but keeps the WiFi. No online check: the command waits and the
 * replay sweep delivers it when the board comes back, which an admin may want to queue. */
export function deviceOpenSetup(zoneId: number): Promise<SetupCommandResult> {
  return authorizedJson<SetupCommandResult>(
    `/api/admin/zones/${zoneId}/hardware/open-setup`,
    "POST",
    {},
  );
}

export type RevokeDeviceResult = {
  hardwareId: number;
  deviceId: string | null;
  burnedMqttUsername: string | null;
  notice: string;
};

/* Cuts one board off: revokes its device token (every device endpoint then returns 401, and
 * three of those make the board wipe its credentials) and burns its MQTT login. The notice
 * carries the HiveMQ part, which we cannot do on the free tier. */
export function deviceRevoke(zoneId: number): Promise<RevokeDeviceResult> {
  return authorizedJson<RevokeDeviceResult>(
    `/api/admin/zones/${zoneId}/hardware/revoke`,
    "POST",
    {},
  );
}

/* MQTT login pool */

export type MqttPoolEntry = {
  id: number;
  username: string;
  /** free | assigned to <kit> | burned */
  status: string;
  assignedDeviceId: string | null;
  assignedAt: string | null;
  burnedAt: string | null;
  createdAt: string;
};

export type MqttPoolSummary = {
  entries: MqttPoolEntry[];
  freeCount: number;
  assignedCount: number;
  burnedCount: number;
  runningLow: boolean;
  warning: string | null;
};

export function getMqttLogins(): Promise<MqttPoolSummary> {
  return authorizedJson<MqttPoolSummary>("/api/admin/mqtt-logins", "GET");
}

export type AddMqttLoginsResult = {
  added: number;
  duplicates: number;
  skipped: number;
  freeCount: number;
  runningLow: boolean;
  message: string;
};

/* Pasted in bulk because that is how they are made: HiveMQ's credential API needs the paid
 * plan, so an admin creates a batch by hand in the console. */
export function addMqttLogins(pasted: string): Promise<AddMqttLoginsResult> {
  return authorizedJson<AddMqttLoginsResult>("/api/admin/mqtt-logins", "POST", { pasted });
}

/* Service requests */

/* Through the API, not straight to Supabase, so moving a request along also messages the
 * farmer. The direct write still works (service_request_all_admin, 0021), but the server
 * would not know to send a Telegram message, and the bot token cannot be in the browser. */
export function updateServiceRequestStatusThroughApi(
  id: number,
  status: "pending" | "scheduled" | "completed",
  note?: string,
): Promise<{ id: number; status: string; message: string | null }> {
  return authorizedJson<{ id: number; status: string; message: string | null }>(
    `/api/admin/requests/${id}/status`,
    "PUT",
    note ? { status, note } : { status },
  );
}

/* Zones added to an existing farm (a "new zone" request). */
export function addZonesToFarm(
  farmId: number,
  zones: { name: string; sizeHectares: number; cropType: string; soilType?: string; areaM2?: number | null;
           plantingDate?: string | null; flowRateLpm?: number | null; rootDepthLimitM?: number | null }[],
): Promise<{ message: string }> {
  return authorizedJson(`/api/farms/${farmId}/zones`, "POST", { zones });
}

/* Enrollment codes */

export type EnrollmentCodeResult = {
  hardwareId: number;
  enrollmentCode: string;
  expiresAt: string;
};

/* The code the installer types into the kit's setup page. Single-use, 24 hours, and the
 * only authorisation /api/devices/claim needs, so there is no "show it again": this response
 * is the only time it exists. */
/* The kit types the claim flow can finish. One entry on purpose: only the ESP32 irrigation
 * node's firmware claims a hardware row, so other types would stay enrolled forever and
 * never come online. A new kind of board goes here and the wizard picks it up. */
export const KIT_TYPES = [
  {
    value: "ESP32",
    label: "ESP32 irrigation node",
    secondary: "Soil moisture, valve control and flow metering on one board",
  },
] as const;

export function createEnrollmentCode(input: {
  zoneId: number;
  deviceName?: string;
  deviceType?: string;
}): Promise<EnrollmentCodeResult> {
  return authorizedJson<EnrollmentCodeResult>("/api/devices/enroll", "POST", input);
}

/* Automatic reports */

export type ReportFrequency = "daily" | "weekly" | "monthly";

export type ReportScheduleDto = {
  farmId: number;
  enabled: boolean;
  frequency: ReportFrequency;
  reportTypes: string[];
  zoneIds: number[] | null;
  lastRunAt: string | null;
  description: string;
  // Optional, so an older API still type-checks.
  dayOfWeek?: number;
  perZonePdf?: boolean;
  sendToHandler?: boolean;
  adminChatEnabled?: boolean;
  lastSentAt?: string | null;
  nextSendAt?: string | null;
  turnedOffBy?: string | null;
  turnedOffAt?: string | null;
  optionsAvailable?: boolean;
};

export function getReportSchedule(farmId: number): Promise<ReportScheduleDto> {
  return authorizedJson<ReportScheduleDto>(
    `/api/admin/farms/${farmId}/report-schedule`,
    "GET",
  );
}

/* Off by default and only an admin can turn it on: a farmer who gets a PDF they did not
 * ask for learns to mute the bot, and the bot also carries the frost warnings. The farmer's
 * own "stop" switch is a separate farmer-scoped endpoint. */
export function saveReportSchedule(
  farmId: number,
  input: {
    enabled: boolean;
    frequency: ReportFrequency;
    reportTypes: string[];
    zoneIds: number[] | null;
    dayOfWeek?: number;
    perZonePdf?: boolean;
    sendToHandler?: boolean;
    adminChatEnabled?: boolean;
  },
): Promise<ReportScheduleDto> {
  return authorizedJson<ReportScheduleDto>(
    `/api/admin/farms/${farmId}/report-schedule`,
    "PUT",
    input,
  );
}

/* Handling
 * Who is handling an item is always the caller: these send what was done, never who did
 * it. The API takes the actor from the login. */

export type HandlingKind = "requests" | "alerts" | "maintenance";

export type HandlingState = {
  id: string;
  handledBy: string | null;
  handledByName: string | null;
  claimedAt: string | null;
  resolvedBy: string | null;
  resolvedByName: string | null;
  resolvedAt: string | null;
  escalatedAt: string | null;
};

/* The same per-zone "today" the farmer's Home screen shows. */
export type FarmTodayZone = {
  zoneId: number;
  name: string;
  action: { kind: string; text: string };
  why: unknown;
  confidence: { level: "high" | "medium" | "low"; reason: string } | null;
  confidenceExplanation: unknown;
  nextStep: { field: string; ask: string } | null;
};

export function getFarmToday(farmId: number): Promise<{ farmId: number; day: string; zones: FarmTodayZone[] }> {
  return authorizedJson(`/api/farmer/farms/${farmId}/today`, "GET");
}

export type AdminTankPh = {
  tank: {
    farmId: number;
    farmName: string;
    capacityLitres: number | null;
    lastRefillLitres: number | null;
    lastRefilledAt: string | null;
    latestWaterPh: number | null;
    estimatedUsedLitres: number;
    estimatedRemainingLitres: number | null;
    isLow: boolean;
    waterPhWarning: string | null;
  };
  zones: Array<{
    zoneId: number;
    zoneName: string;
    latest: { ph: number; measuredAt: string; note: string | null } | null;
  }>;
};

export function getAdminTankPh(farmId: number): Promise<AdminTankPh> {
  return authorizedJson(`/api/admin/farms/${farmId}/tank-ph`, "GET");
}

export function setFarmTankCapacity(farmId: number, litres: number): Promise<AdminTankPh["tank"]> {
  return authorizedJson(`/api/farmer/farms/${farmId}/tank`, "PUT", { litres });
}

/* "Recommended for you". */
export type RecommendedSettings = {
  available: boolean;
  text: string;
  cropLabel?: string;
  thresholdPercent?: number;
  confidence?: { level: "high" | "medium" | "low"; reason: string };
  canApply?: boolean;
  applyNote?: string | null;
};

export function getRecommendedSettings(zoneId: number): Promise<RecommendedSettings> {
  return authorizedJson(`/api/farmer/zones/${zoneId}/recommended-settings`, "GET");
}

export function previewRecommendedSettings(input: {
  cropType: string; soilType: string; areaM2: number | null; flowRateLpm: number | null;
  rootDepthLimitM: number | null; plantingDate: string | null; location: string;
}): Promise<RecommendedSettings> {
  return authorizedJson("/api/admin/recommended-settings/preview", "POST", input);
}

/* "Use these settings": the existing Reset to recommended, which saves the same level. */
export function useRecommendedSettings(zoneId: number): Promise<{ message: string }> {
  return authorizedJson(`/api/farmer/zones/${zoneId}/reset-recommended`, "POST", {});
}

/* Public enquiries */

export type Enquiry = {
  id: number;
  fullName: string | null;
  phone: string | null;
  email: string | null;
  province: string;
  town: string | null;
  farmSizeHa: number | null;
  crops: string[];
  cropsOther: string | null;
  bestTime: "morning" | "afternoon" | "evening";
  notes: string | null;
  createdAt: string;
  status: "new" | "open" | "won" | "lost" | "closed";
  handledBy: string | null;
  handledByName: string | null;
  claimedAt: string | null;
  callbackAt: string | null;
  noAnswerCount: number;
  outcome: string | null;
  reason: string | null;
  reasonOther: string | null;
  farmerProfileId: string | null;
  anonymisedAt: string | null;
  firstCalledAt: string | null;
  closedAt: string | null;
  callCount: number;
};

export type EnquiryCall = {
  calledAt: string; callerName: string; outcome: string; reason: string | null;
  reasonOther: string | null; note: string | null; callbackAt: string | null;
};

export function getEnquiries(): Promise<Enquiry[]> {
  return authorizedJson("/api/admin/enquiries", "GET");
}

export function getEnquirySummary(): Promise<{ waiting: number; callbacksDue: number }> {
  return authorizedJson("/api/admin/enquiries/summary", "GET");
}

export function getEnquiryCalls(id: number): Promise<EnquiryCall[]> {
  return authorizedJson(`/api/admin/enquiries/${id}/calls`, "GET");
}

export function claimEnquiry(id: number): Promise<{ message: string }> {
  return authorizedJson(`/api/admin/enquiries/${id}/claim`, "POST", {});
}

export function takeOverEnquiry(id: number, reason: string): Promise<{ message: string }> {
  return authorizedJson(`/api/admin/enquiries/${id}/take-over`, "POST", { reason });
}

export function logEnquiryCall(id: number, call: {
  outcome: string; reason?: string | null; reasonOther?: string | null; note?: string | null; callbackAt?: string | null;
}): Promise<{ message: string; suggestClosing: boolean }> {
  return authorizedJson(`/api/admin/enquiries/${id}/calls`, "POST", call);
}

export function closeEnquiry(id: number, note?: string): Promise<{ message: string }> {
  return authorizedJson(`/api/admin/enquiries/${id}/close`, "POST", { note: note ?? null });
}

export function markEnquiryOnboarded(id: number, farmerProfileId: string): Promise<{ message: string }> {
  return authorizedJson(`/api/admin/enquiries/${id}/onboarded`, "POST", { farmerProfileId });
}

export function anonymiseEnquiry(id: number): Promise<{ message: string }> {
  return authorizedJson(`/api/admin/enquiries/${id}/anonymise`, "POST", {});
}

/* Dismiss and history */

export function getAdminDismissals(): Promise<import("@/lib/dismiss").Dismissal[]> {
  return authorizedJson("/api/admin/dismissals", "GET");
}

export function dismissNotification(input: {
  kind: string; itemKey: string; title: string; raisedAt: string | null; critical: boolean;
  conditionKey: string | null; note: string | null;
}): Promise<{ id: number; message: string }> {
  return authorizedJson("/api/admin/dismissals", "POST", input);
}

/* A critical item's condition has gone: close its dismissal so a recurrence shows. */
export function clearDismissalCondition(id: number): Promise<{ id: number; message: string }> {
  return authorizedJson(`/api/admin/dismissals/${id}/condition-cleared`, "POST", {});
}

export function restoreDismissal(id: number): Promise<{ id: number; message: string }> {
  return authorizedJson(`/api/admin/dismissals/${id}/restore`, "POST", {});
}

export function getHandling(kind: HandlingKind): Promise<HandlingState[]> {
  return authorizedJson<HandlingState[]>(`/api/admin/handling/${kind}`, "GET");
}

export function claimItem(kind: HandlingKind, id: string | number): Promise<{ message: string }> {
  return authorizedJson(`/api/admin/handling/${kind}/${id}/claim`, "POST", {});
}

export function takeOverItem(kind: HandlingKind, id: string | number, reason: string): Promise<{ message: string }> {
  return authorizedJson(`/api/admin/handling/${kind}/${id}/take-over`, "POST", { reason });
}

export function releaseItem(kind: HandlingKind, id: string | number): Promise<{ message: string }> {
  return authorizedJson(`/api/admin/handling/${kind}/${id}/release`, "POST", {});
}

export function itemAction(
  kind: HandlingKind, id: string | number, action: string, note?: string, date?: string,
): Promise<{ message: string }> {
  return authorizedJson(`/api/admin/handling/${kind}/${id}/action`, "POST", { action, note, date });
}

/* A new maintenance job, booked and handled by the caller. */
export function createMaintenance(input: {
  hardwareId?: number | null; farmId?: number | null; description: string; date: string;
}): Promise<{ id: number; message: string }> {
  return authorizedJson("/api/admin/handling/maintenance", "POST", input);
}

/* "Send test now": to the calling admin's own Telegram only. */
export function sendReportScheduleTest(
  farmId: number,
): Promise<{ sent: number; failed: number; skipped: number; message: string }> {
  return authorizedJson(`/api/admin/farms/${farmId}/report-schedule/test`, "POST", {});
}

/* Archive
 * Archive is not delete, and the two sit side by side on purpose. Delete removes the farm
 * and cascades to every zone, reading, irrigation event and alert, which is the evidence the
 * system worked. Archive hides it, keeps everything and can be undone. */

export function archiveFarm(id: number): Promise<{ message: string }> {
  return authorizedJson<{ message: string }>(`/api/farms/${id}/archive`, "POST", {});
}

export function restoreFarm(id: number): Promise<{ message: string }> {
  return authorizedJson<{ message: string }>(`/api/farms/${id}/restore`, "POST", {});
}

/* Run advice now
 * Runs the FAO-56 engine for one zone, today, and returns what it worked out, so we can
 * show the engine working live during setup and the presentation.
 * Advisory only: it writes the normal zone_water_balance and ai_recommendation rows and
 * never touches the pump. */

export type RunAdviceResult = {
  zoneId: number;
  zoneName: string;
  ranFor: string;
  stage: string | null;
  dayOfSeason: number | null;
  crop: string | null;
  soil: string;
  soilWasDefaulted: boolean;
  etcTodayMm: number | null;
  etoTodayMm: number | null;
  depletionMm: number | null;
  readilyAvailableMm: number | null;
  totalAvailableMm: number | null;
  recommendedLitres: number | null;
  recommendedMinutes: number | null;
  daysToNextWatering: number | null;
  nextWateringDate: string | null;
  moisturePercent: number | null;
  balanceRan: boolean;
  /** Missing fields by name, which is what makes this useful during setup. */
  setupMissing: string[];
  limitations: string[];
  insights: { insightType: string; severity: string; message: string; explanation?: unknown }[];
};

export function runAdviceNow(zoneId: number): Promise<RunAdviceResult> {
  return authorizedJson<RunAdviceResult>(
    `/api/admin/zones/${zoneId}/run-advice`,
    "POST",
    {},
  );
}

/* Platform health
 * One endpoint feeds the sidebar light, the header chip and Home's card, so they always agree. */

export type HealthCheck = {
  key: string;
  name: string;
  /** ok | warning | down */
  status: string;
  /** A sentence an admin can act on, not a code. */
  detail: string;
  responseMs: number | null;
};

export type HealthResponse = {
  overall: string;
  checkedAt: string;
  checks: HealthCheck[];
};

export function getPlatformHealth(): Promise<HealthResponse> {
  return authorizedJson<HealthResponse>("/api/admin/health", "GET");
}

/* Activity / audit log
 * The append-only record of what administrators do (migration 0037). */

export type AuditRow = {
  id: number;
  createdAt: string;
  actorName: string;
  action: string;
  /**
   * One readable sentence, built on the server so the page and the exports describe an
   * action the same way.
   */
  summary: string;
  entityType: string;
  entityId: string | null;
  farmId: number | null;
  farmName: string | null;
  /** JSON string - before/after for whatever changed. */
  details: string;
};

export type AuditFilterOption = { value: string; label: string };

export type AuditLogResponse = {
  rows: AuditRow[];
  total: number;
  actions: AuditFilterOption[];
  actors: AuditFilterOption[];
};

export function getActivityLog(params: {
  action?: string;
  actor?: string;
  farmId?: number;
  from?: string;
  to?: string;
} = {}): Promise<AuditLogResponse> {
  const q = new URLSearchParams();
  if (params.action) q.set("action", params.action);
  if (params.actor) q.set("actor", params.actor);
  if (params.farmId) q.set("farmId", String(params.farmId));
  if (params.from) q.set("from", params.from);
  if (params.to) q.set("to", params.to);

  const qs = q.toString();
  return authorizedJson<AuditLogResponse>(
    `/api/admin/activity${qs ? `?${qs}` : ""}`,
    "GET",
  );
}

/**
 * Everything that happened to one thing, oldest first: the timeline on a request, an alert
 * or a kit.
 */
export function getEntityTimeline(entityType: string, entityId: string): Promise<AuditRow[]> {
  return authorizedJson<AuditRow[]>(
    `/api/admin/activity/${encodeURIComponent(entityType)}/${encodeURIComponent(entityId)}`,
    "GET",
  );
}

/** Who is dealing with a request. Independent of status: somebody picks a
    request up before it is scheduled. */
