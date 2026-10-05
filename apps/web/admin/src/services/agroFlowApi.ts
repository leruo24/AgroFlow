/*
 * Calls AgroFlow.Api's admin-only farmer onboarding endpoints.
 * Both endpoints require a real Supabase Auth session (JWT bearer + a
 * profile.role='admin' check server-side) - see
 * backend/AgroFlow.Api/Auth/AdminOnlyFilter.cs. app/auth.ts's sign-in gate
 * (main.ts) means this only ever runs while such a session exists, but the
 * check below stays as a defensive fallback rather than assuming that.
 */

import { supabase } from "@/lib/supabase";

const API_BASE = import.meta.env["VITE_AGROFLOW_API_BASE"] ?? "";

async function postAuthorized<T = void>(path: string, body: unknown): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;

  if (!token) {
    throw new Error("Not signed in.");
  }

  const response = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();

    try {
      const problem = JSON.parse(text);

      throw new Error(
        problem.detail ||
        problem.title ||
        `Request failed (${response.status}).`,
      );
    } catch (error) {
      if (error instanceof Error) {
        throw error;
      }

      throw new Error(
        text || `Request failed (${response.status}).`,
      );
    }
  }

  // 204s and empty bodies are normal here (several of these endpoints only
  // acknowledge), so parsing is attempted rather than assumed.
  const text = await response.text();

  return (text ? JSON.parse(text) : undefined) as T;
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

/* What /onboard hands back now that there is no welcome email.

   temporaryPassword is shown ONCE and is never stored server-side. There is
   no endpoint that can fetch it again - "show it again" is a reset that mints
   a new one (resetTemporaryPassword below).

   telegramDeepLink is what the handover screen renders as a QR code. It can
   be null while Telegram:BotUsername is unset on the server; onboarding still
   succeeded, and the password is then the whole handover. */
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

/* "Regenerate code" - for a QR that expired or a farmer who lost it.
   Issuing a new code invalidates the farmer's previous unused one, so an old
   printout stops working immediately. */
export async function regenerateTelegramCode(
  profileId: string,
): Promise<TelegramCodeResult> {
  return postAuthorized<TelegramCodeResult>(
    `/api/telegram/admin/codes/${profileId}`,
    {},
  );
}

/* Chasing up a farmer who never connected Telegram, from the users list.

   A LINK code, not an onboarding one: this farmer already has an account and
   a password they use, and redeeming it must attach their chat and touch
   nothing else. Issuing an onboarding code here would reset their working
   password - see migration 0025. */
export async function issueLinkCodeForFarmer(
  profileId: string,
): Promise<TelegramCodeResult> {
  return postAuthorized<TelegramCodeResult>(
    `/api/telegram/admin/codes/${profileId}/link`,
    {},
  );
}

/* Sends a NEW temporary password to the farmer's own Telegram chat - the same
   thing they would get from "Forgot password?" in the app, triggered by an
   administrator for a farmer who phones in instead.

   Different from resetTemporaryPassword below: this one never shows the
   password to the admin, so the credential only ever reaches the account's
   owner. It fails if the farmer has no Telegram connected, which is when the
   read-it-out version below is the right tool. */
export async function sendTemporaryPasswordViaTelegram(
  profileId: string,
): Promise<{ message: string }> {
  return postAuthorized<{ message: string }>(
    `/api/telegram/admin/password/${profileId}/send`,
    {},
  );
}

/* The fallback for a farmer with no Telegram at all, and the only possible
   answer to "what was their password again?" - AgroFlow never stored it, so
   this mints a new one and returns it once. */
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
    /* farm.latitude/longitude (migration 0010). Optional, and null when the
       admin skipped the map: the weather lookup then falls back to the
       district, which is worse than a pin but better than a wrong pin. */
    latitude?: number | null;
    longitude?: number | null;
    zones: {
      name: string;
      sizeHectares: number;
      cropType: string;
    }[];
  };
}): Promise<void> {
  await postAuthorized("/api/farms/register", input);
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

  const response = await fetch(
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

    try {
      const problem = JSON.parse(text);

      throw new Error(
        problem.detail ||
        problem.title ||
        problem.message ||
        `Request failed (${response.status}).`,
      );
    } catch (error) {
      if (error instanceof Error) {
        throw error;
      }

      throw new Error(
        text || `Request failed (${response.status}).`,
      );
    }
  }

  return await response.json() as FarmerOption[];
}
export async function deleteFarmerUser(id: string): Promise<void> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;

  if (!token) {
    throw new Error("Not signed in.");
  }

  const response = await fetch(
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

    try {
      const problem = JSON.parse(text);

      throw new Error(
        problem.detail ||
        problem.title ||
        problem.message ||
        `Request failed (${response.status}).`,
      );
    } catch (error) {
      if (error instanceof Error) {
        throw error;
      }

      throw new Error(
        text || `Request failed (${response.status}).`,
      );
    }
  }
}

export async function deleteFarm(id: number): Promise<void> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;

  if (!token) {
    throw new Error("Not signed in.");
  }

  const response = await fetch(
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

    try {
      const problem = JSON.parse(text);

      throw new Error(
        problem.detail ||
        problem.title ||
        problem.message ||
        `Request failed (${response.status}).`,
      );
    } catch (error) {
      if (error instanceof Error) {
        throw error;
      }

      throw new Error(
        text || `Request failed (${response.status}).`,
      );
    }
  }
}

/* ---------------- Reports (live data) ---------------- */

async function reportError(response: Response): Promise<Error> {
  const text = await response.text();
  try {
    const problem = JSON.parse(text);
    return new Error(
      problem.error || problem.detail || problem.title || problem.message ||
      `Request failed (${response.status}).`,
    );
  } catch {
    return new Error(text || `Request failed (${response.status}).`);
  }
}

async function reportFetch(path: string): Promise<Response> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Not signed in.");

  const response = await fetch(`${API_BASE}${path}`, {
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

export async function getReportZones(farmId: number): Promise<ReportZone[]> {
  return (await reportFetch(`/api/farmer/reports/zones?farmId=${farmId}`)).json() as Promise<ReportZone[]>;
}

/* Fetches a report as JSON (for on-screen viewing). */
export async function getReportJson<T = unknown>(path: string): Promise<T> {
  return (await reportFetch(`/api/farmer/reports/${path}`)).json() as Promise<T>;
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
/* The platform summary as a PDF (item 7).
 *
 * Built server-side rather than in the browser, unlike the .xlsx: a PDF gets
 * printed, filed and emailed, so it has to carry its own figures, timestamp
 * and the name of whoever produced it, independent of the session that asked
 * for it. See backend/.../AdminSummaryEndpoints.cs. */
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

/* ---------------- Hardware (firmware v1.3.0) ----------------

   WHY THESE GO THROUGH THE API AND NOT SUPABASE

   The dashboard reads most tables straight from Supabase under RLS. These
   cannot be:

   - tokenStatus needs hardware.device_token_hash and token_revoked_at.
     Migration 0028 revoked the whole-table select 0011 had granted and
     replaced it with an explicit column list that excludes both, because RLS
     restricts ROWS and never COLUMNS - a farmer's own JWT would otherwise
     have read its own kit's token hash.
   - mqttUsername needs mqtt_credential_pool, which 0029 gives no client role
     any grant on at all.
   - Revoking a device has to burn a pool entry in the same action, and
     nothing in the browser can touch that table.
   - change-wifi / open-setup write to irrigation_commands, which 0011
     deliberately grants SELECT only: an anon or authenticated INSERT there
     drives a physical valve.
*/

async function authorizedJson<T>(
  path: string,
  method: "GET" | "POST" | "PUT",
  body?: unknown,
): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;

  if (!token) {
    throw new Error("Not signed in.");
  }

  const response = await fetch(`${API_BASE}${path}`, {
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

/* Makes the kit forget its WiFi and open its setup network. 409 when the kit
   has not been heard from in the last 5 minutes - the command would publish
   into the void and nobody would ever see the setup network appear. */
export function deviceChangeWifi(zoneId: number): Promise<SetupCommandResult> {
  return authorizedJson<SetupCommandResult>(
    `/api/admin/zones/${zoneId}/hardware/change-wifi`,
    "POST",
    {},
  );
}

/* Opens the setup page but KEEPS the WiFi. No online requirement: the command
   sits pending and the replay sweep delivers it when the board comes back,
   which is a reasonable thing for an admin to queue deliberately. */
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

/* Cuts one board off: revokes its device token (every device endpoint then
   401s it, and three of those make the board wipe its own credentials) and
   burns its pooled MQTT login. The notice carries the HiveMQ half, which this
   system cannot do on the free tier. */
export function deviceRevoke(zoneId: number): Promise<RevokeDeviceResult> {
  return authorizedJson<RevokeDeviceResult>(
    `/api/admin/zones/${zoneId}/hardware/revoke`,
    "POST",
    {},
  );
}

/* ---------------- MQTT login pool ---------------- */

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

/* Pasted in bulk because that is how they are made - HiveMQ's credential API
   needs the paid Starter plan, so an admin creates a batch by hand in the
   console and brings them over together. */
export function addMqttLogins(pasted: string): Promise<AddMqttLoginsResult> {
  return authorizedJson<AddMqttLoginsResult>("/api/admin/mqtt-logins", "POST", { pasted });
}

/* ---------------- Service requests ---------------- */

/* Routed through the API rather than written straight to Supabase, so that
   moving a request along also MESSAGES the farmer. The direct write still
   works (service_request_all_admin, 0021) but nothing server-side learned the
   status changed, so there was no point at which a Telegram message could be
   sent - and putting the bot token in the browser is not an option. */
export function updateServiceRequestStatusThroughApi(
  id: number,
  status: "pending" | "scheduled" | "completed",
): Promise<{ id: number; status: string; message: string | null }> {
  return authorizedJson<{ id: number; status: string; message: string | null }>(
    `/api/admin/requests/${id}/status`,
    "PUT",
    { status },
  );
}

/* ---------------- Enrollment codes ---------------- */

export type EnrollmentCodeResult = {
  hardwareId: number;
  enrollmentCode: string;
  expiresAt: string;
};

/* The code the installer types into the kit's setup page. Single-use, 24-hour,
   and the ONLY authorisation /api/devices/claim needs - which is why there is
   no "show it again": the response below is the one time it exists. */
/* The kit types the claim flow can actually finish.
 *
 * ONE ENTRY, DELIBERATELY
 * Enrolling a kit writes a hardware row that a board then claims with the
 * code, and only the ESP32 irrigation node's firmware does that. A picker
 * offering "Weather Station" or "Gateway" would create rows nothing can ever
 * claim - a kit that shows as enrolled forever and never comes online. When
 * a second kind of board ships, it belongs here and the wizard picks it up
 * without further change. */
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

/* ---------------- Automatic reports (step 4) ---------------- */

export type ReportScheduleDto = {
  farmId: number;
  enabled: boolean;
  frequency: "weekly" | "monthly";
  reportTypes: string[];
  zoneIds: number[] | null;
  lastRunAt: string | null;
  description: string;
};

export function getReportSchedule(farmId: number): Promise<ReportScheduleDto> {
  return authorizedJson<ReportScheduleDto>(
    `/api/admin/farms/${farmId}/report-schedule`,
    "GET",
  );
}

/* Off by default and only an admin can turn it on - a farmer who did not ask
   for a weekly PDF and gets one anyway learns to mute the bot, and the bot
   also carries the frost warnings. The farmer's own "stop" switch is a
   separate farmer-scoped endpoint. */
export function saveReportSchedule(
  farmId: number,
  input: {
    enabled: boolean;
    frequency: "weekly" | "monthly";
    reportTypes: string[];
    zoneIds: number[] | null;
  },
): Promise<ReportScheduleDto> {
  return authorizedJson<ReportScheduleDto>(
    `/api/admin/farms/${farmId}/report-schedule`,
    "PUT",
    input,
  );
}

/* ---------------- Archive (step 6) ----------------

   Archive is NOT delete and the two sit side by side in the UI on purpose.
   Delete removes the farm and cascades to every zone, sensor reading,
   irrigation event and alert it owns - that history is the evidence the
   system worked. Archive hides it and keeps all of it, and is reversible. */

export function archiveFarm(id: number): Promise<{ message: string }> {
  return authorizedJson<{ message: string }>(`/api/farms/${id}/archive`, "POST", {});
}

export function restoreFarm(id: number): Promise<{ message: string }> {
  return authorizedJson<{ message: string }>(`/api/farms/${id}/restore`, "POST", {});
}

/* ---------------- Run advice now (step 6c) ----------------

   Runs the FAO-56 engine for one zone, today, and returns what it worked
   out. Exists so the engine can be PROVEN to work live during setup and the
   presentation, instead of waiting for the nightly pass and hoping.

   Advisory only: it writes the normal zone_water_balance and
   ai_recommendation rows and never touches the pump. */

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
  /** Named missing fields - the half that makes this useful during setup. */
  setupMissing: string[];
  limitations: string[];
  insights: { insightType: string; severity: string; message: string }[];
};

export function runAdviceNow(zoneId: number): Promise<RunAdviceResult> {
  return authorizedJson<RunAdviceResult>(
    `/api/admin/zones/${zoneId}/run-advice`,
    "POST",
    {},
  );
}

/* ---------------- Platform health (item 4) ----------------

   Replaces the three "Monitoring not yet implemented" strings. One endpoint
   feeds the sidebar light, the header chip and Home's card, so they cannot
   disagree about whether the platform is well. */

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

/* ---------------- Activity / audit log (item 5) ----------------

   The append-only record of what administrators do (migration 0037). The
   page this feeds used to say there was nowhere to read this from, which
   was true. */

export type AuditRow = {
  id: number;
  createdAt: string;
  actorName: string;
  action: string;
  /** One readable sentence, built server-side so the page and the exports
      cannot describe the same action three different ways. */
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

/** Everything that ever happened to one thing, oldest first - the timeline
    on a request, an alert or a kit. */
export function getEntityTimeline(entityType: string, entityId: string): Promise<AuditRow[]> {
  return authorizedJson<AuditRow[]>(
    `/api/admin/activity/${encodeURIComponent(entityType)}/${encodeURIComponent(entityId)}`,
    "GET",
  );
}

/** Who is dealing with a request. Independent of status: somebody picks a
    request up before it is scheduled. */
export function assignRequest(
  requestId: number,
  assignedToProfileId: string | null,
): Promise<{ requestId: number; assignedTo: string | null; message: string }> {
  return authorizedJson(`/api/admin/requests/${requestId}/assign`, "PUT", {
    assignedToProfileId,
  });
}
