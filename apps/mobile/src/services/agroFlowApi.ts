import { singleFlight, writeKey } from '@/lib/singleFlight';
import {
  supabase,
} from '@/lib/supabase';

import Constants from 'expo-constants';
import { Platform } from 'react-native';

function resolveApiBase() {
  const configuredBase =
    process.env.EXPO_PUBLIC_AGROFLOW_API_BASE
      ?.trim()
      .replace(/\/$/, '');

  if (
    configuredBase
  ) {
    return configuredBase;
  }

  const port = process.env.EXPO_PUBLIC_AGROFLOW_API_PORT ?? '5080';

  // Expo web does not always populate expoConfig.hostUri. The browser's own
  // host is the reliable address when Metro and the API run on the same PC.
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    return `http://${window.location.hostname}:${port}`;
  }

  // In Expo development, hostUri is the Metro server address advertised to
  // the phone (for example 192.168.1.20:8081). Reusing that host avoids
  // hardcoding a LAN IP that changes when the developer changes network.
  const expoHostUri =
    Constants.expoConfig?.hostUri;

  if (
    expoHostUri
  ) {
    const host =
      expoHostUri.startsWith('[')
        ? expoHostUri.slice(
            0,
            expoHostUri.indexOf(']') + 1
          )
        : expoHostUri.split(':')[0];

    return `http://${host}:${port}`;
  }

  return '';
}

export type FarmerDashboard = {
  profile: Record<string, unknown> | null;
  farms: Record<string, unknown>[];
  farm: Record<string, unknown> | null;
  zones: Record<string, unknown>[];
  readings: Record<string, unknown>[];
  events: Record<string, unknown>[];
  usage: Record<string, unknown>[];
  weather: Record<string, unknown>[];
  alerts: Record<string, unknown>[];
};

export type CurrentWeatherResponse = {
  current?: {
    time?: string;
    temperature_2m?: number;
    apparent_temperature?: number;
    relative_humidity_2m?: number;
    weather_code?: number;
    wind_speed_10m?: number;
  };
  daily?: {
    precipitation_probability_max?: number[];
  };
};

/* Every authorised call. READS go straight through; an identical WRITE that
   is already in flight is shared rather than sent twice - see
   lib/singleFlight.ts, and "Water now" for why it matters. */
function authorizedRequest<T>(
  path: string,
  init?: RequestInit
): Promise<T> {
  const method = (init?.method ?? 'GET').toUpperCase();

  if (method === 'GET') return sendAuthorizedRequest<T>(path, init);

  return singleFlight(writeKey(method, path, init?.body), () =>
    sendAuthorizedRequest<T>(path, init)
  );
}

async function sendAuthorizedRequest<T>(
  path: string,
  init?: RequestInit
): Promise<T> {
  const apiBase =
    resolveApiBase();

  if (
    !apiBase
  ) {
    throw new Error(
      'AgroFlow.Api could not be located. Set EXPO_PUBLIC_AGROFLOW_API_BASE.'
    );
  }

  const {
    data,
  } = await supabase.auth
    .getSession();

  const token =
    data.session?.access_token;

  if (
    !token
  ) {
    throw new Error(
      'You must be signed in.'
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
  const response =
    await fetch(
      `${apiBase}${path}`,
      {
        ...init,
        signal: controller.signal,
        headers: {
          Accept:
            'application/json',
          'Content-Type':
            'application/json',
          Authorization:
            `Bearer ${token}`,
          ...init?.headers,
        },
      }
    );

  if (
    !response.ok
  ) {
    const message =
      await response.text();

    throw new Error(
      message ||
        `AgroFlow API request failed (${response.status}).`
    );
  }

  if (
    response.status === 204
  ) {
    return undefined as T;
  }

  return await response.json() as T;
  } finally {
    clearTimeout(timeout);
  }
}

export function fetchFarmerDashboard(farmId?: string) {
  return authorizedRequest<FarmerDashboard>(
    `/api/farmer/dashboard${farmId ? `?farmId=${encodeURIComponent(farmId)}` : ''}`
  );
}

export function fetchCurrentWeather(farmId: string) {
  return authorizedRequest<CurrentWeatherResponse>(
    `/api/farmer/weather/current?farmId=${encodeURIComponent(farmId)}`
  );
}

export function sendManualIrrigationCommand(
  zoneId: string,
  command: 'start' | 'stop',
  durationSeconds?: number
) {
  return authorizedRequest<{
    id: string;
  }>(
    `/api/farmer/zones/${encodeURIComponent(zoneId)}/commands`,
    {
      method: 'POST',
      body: JSON.stringify({
        command,
        durationSeconds,
      }),
    }
  );
}

export function updateZoneThroughApi(
  zoneId: string,
  settings: Record<string, unknown>
) {
  return authorizedRequest<void>(
    `/api/farmer/zones/${encodeURIComponent(zoneId)}/settings`,
    {
      method: 'PUT',
      body: JSON.stringify(settings),
    }
  );
}

export function updateProfileThroughApi(
  name: string,
  phone: string
) {
  return authorizedRequest<void>(
    '/api/farmer/profile',
    {
      method: 'PUT',
      body: JSON.stringify({
        name,
        phone,
      }),
    }
  );
}

export type TelegramLinkStatus = {
  linked: boolean;
  alertsEnabled: boolean;
};

export type TelegramCode = {
  code: string;
  deepLink: string | null;
  expiresAt: string;
};

export function fetchTelegramLinkStatus() {
  return authorizedRequest<TelegramLinkStatus>(
    '/api/telegram/me'
  );
}

/* Generates this farmer's own single-use link code and returns the t.me deep
   link for it. This is how farmers who were onboarded before Telegram existed
   connect themselves: they are already holding the phone, so tapping the link
   opens the bot with the code filled in - no QR code and no admin needed. */
export function requestTelegramLinkCode() {
  return authorizedRequest<TelegramCode>(
    '/api/telegram/me/code',
    {
      method: 'POST',
      body: JSON.stringify({}),
    }
  );
}

export function setTelegramAlerts(
  enabled: boolean
) {
  return authorizedRequest<void>(
    '/api/telegram/me/alerts',
    {
      method: 'POST',
      body: JSON.stringify({
        enabled,
      }),
    }
  );
}

export function disconnectTelegram() {
  return authorizedRequest<void>(
    '/api/telegram/me',
    {
      method: 'DELETE',
    }
  );
}

/* Clears the forced-password-change flag after the farmer has actually set
   their own password. The flag lives server-side and is not client-writable
   (migration 0024 withholds the column grant on purpose), so this is the only
   way off the forced-change screen. */
export function confirmPasswordChanged() {
  return authorizedRequest<void>(
    '/api/farmer/password-changed',
    {
      method: 'POST',
      body: JSON.stringify({}),
    }
  );
}

/* Self-service password recovery, delivered over Telegram.

   This endpoint is anonymous - a farmer who has forgotten their password
   cannot authenticate to ask for a new one - so it is the one call here that
   does not go through authorizedRequest.

   The response is deliberately identical whether the address exists, has no
   Telegram connected, or was rate limited. The screen must not try to be more
   helpful than that: telling the farmer "no such account" would tell anyone
   else the same thing about any address they cared to try. */
export function requestPasswordReset(email: string): Promise<string> {
  // Keyed on the address as typed-and-trimmed: two taps of Send for the same
  // email are one reset, and one Telegram message, not two.
  return singleFlight(
    writeKey('POST', '/api/auth/forgot-password', email.trim().toLowerCase()),
    () => sendPasswordReset(email)
  );
}

async function sendPasswordReset(
  email: string
): Promise<string> {
  const apiBase =
    resolveApiBase();

  if (
    !apiBase
  ) {
    throw new Error(
      'AgroFlow.Api could not be located. Set EXPO_PUBLIC_AGROFLOW_API_BASE.'
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);

  try {
    const response =
      await fetch(
        `${apiBase}/api/auth/forgot-password`,
        {
          method: 'POST',
          signal: controller.signal,
          headers: {
            Accept:
              'application/json',
            'Content-Type':
              'application/json',
          },
          body: JSON.stringify({
            email,
          }),
        }
      );

    if (
      !response.ok
    ) {
      throw new Error(
        'We could not reach AgroFlow. Please check your connection and try again.'
      );
    }

    const body =
      await response.json() as {
        message?: string;
      };

    return body.message ?? '';
  } finally {
    clearTimeout(timeout);
  }
}

export type FarmerServiceRequestInput = {
  requestType: 'new_farm' | 'new_zone';
  farmId?: number;
  location?: string;
  roughSize?: number;
  cropType:
    | 'potato'
    | 'tomato'
    | 'citrus'
    | 'leafy_veg'
    | 'maize'
    | 'dry_beans';
  notes?: string;
};

export function createFarmerServiceRequest(
  request: FarmerServiceRequestInput
) {
  return authorizedRequest<{ id: number }>(
    '/api/farmer/requests',
    {
      method: 'POST',
      body: JSON.stringify(request),
    }
  );
}

// ---------------------------------------------------------------------------
// FAO-56 insight engine (migration 0027).
//
// These are NEW endpoints in a NEW backend file. Luba's
// PUT /api/farmer/zones/{id}/settings is in flight and is deliberately not
// extended - the soil type has its own endpoint.
// ---------------------------------------------------------------------------

export type ZoneSoilType = 'sandy' | 'loam' | 'clay';

// Item 2c: "Why am I seeing this?", built on the server by the same rule that
// produced the message. `technical` never reaches a farmer's app.
export type ExplanationFact = { label: string; value: string; source: string };
export type Explanation = {
  summary: string;
  facts: ExplanationFact[];
  rule: string;
  confidence: string;
  whatWouldChangeIt?: string | null;
  technical?: string;
};

export type ZoneInsight = {
  insightType: string;
  severity: 'act_now' | 'heads_up' | 'info';
  message: string;
  // Optional: rows written before explanations existed have none.
  explanation?: Explanation | null;
};

// How far through its season this zone's crop is.
//
// Null whenever the crop or the planting date is unknown, which is the
// ordinary state for a zone the farmer has not filled in yet. ZoneGrowthBar
// renders nothing at all for null rather than an empty bar, because an empty
// bar reads as "the season has not started".
export type ZoneGrowth = {
  stage: string;
  dayOfSeason: number;
  totalDays: number;
  cropLabel: string;
};

export function fetchZoneInsights(zoneId: number) {
  return authorizedRequest<{
    zoneId: number;
    day: string;
    insights: ZoneInsight[];
    growth: ZoneGrowth | null;
    // Item 2, optional: older APIs do not send them.
    confidence?: { level: 'high' | 'medium' | 'low'; reason: string } | null;
    nextStep?: { field: string; ask: string } | null;
    stageAssumed?: boolean | null;
    confidenceExplanation?: Explanation | null;
  }>(`/api/farmer/zones/${zoneId}/insights`);
}

// ---------------------------------------------------------------------------
// Item 6: one card per zone, logging by hand, and finishing setup.
// ---------------------------------------------------------------------------

export type TodayActionKind = 'water' | 'skip' | 'kit' | 'setup' | 'soon' | 'none';

export type ZoneSetupFacts = {
  crop: boolean;
  plantingDate: boolean;
  soil: boolean;
  area: boolean;
  flowRate: boolean;
  calibrated: boolean;
  hasKit: boolean;
};

export type TodayZone = {
  zoneId: number;
  name: string;
  action: { kind: TodayActionKind; text: string };
  why: Explanation | null;
  confidence: { level: 'high' | 'medium' | 'low'; reason: string } | null;
  confidenceExplanation: Explanation | null;
  nextStep: { field: string; ask: string } | null;
  setup?: ZoneSetupFacts | null;
};

export function fetchFarmToday(farmId: string | number) {
  return authorizedRequest<{ farmId: number; day: string; zones: TodayZone[] }>(
    `/api/farmer/farms/${encodeURIComponent(String(farmId))}/today`
  );
}

// Writes go through authorizedRequest, so a double tap sends one entry.
export function logManualWatering(zoneId: number, entry: { minutes?: number; litres?: number }) {
  return authorizedRequest<{ id: number; message: string }>(
    `/api/farmer/zones/${zoneId}/manual-watering`,
    { method: 'POST', body: JSON.stringify(entry) }
  );
}

export type SoilFeel = 'dry' | 'moist' | 'wet';

export function logSoilFeel(zoneId: number, feel: SoilFeel) {
  return authorizedRequest<{ id: number; message: string }>(
    `/api/farmer/zones/${zoneId}/soil-feel`,
    { method: 'POST', body: JSON.stringify({ feel }) }
  );
}

export function saveZoneSetup(
  zoneId: number,
  setup: { plantingDate?: string; areaM2?: number; flowRateLpm?: number }
) {
  return authorizedRequest<{ message: string }>(
    `/api/farmer/zones/${zoneId}/setup`,
    { method: 'PUT', body: JSON.stringify(setup) }
  );
}

// ---------------------------------------------------------------------------
// Item 6b: "Recommended for you", and changing the crop.
// ---------------------------------------------------------------------------

export type RecommendedSettings = {
  available: boolean;
  text: string;
  crop?: string;
  cropLabel?: string;
  thresholdPercent?: number;
  stopPercent?: number;
  intervalDaysLow?: number | null;
  intervalDaysHigh?: number | null;
  minutes?: number | null;
  confidence?: { level: 'high' | 'medium' | 'low'; reason: string };
  // "Use these settings" needs the wet/dry setup; applyNote says so.
  canApply?: boolean;
  applyNote?: string | null;
};

export function fetchRecommendedSettings(zoneId: number) {
  return authorizedRequest<RecommendedSettings>(`/api/farmer/zones/${zoneId}/recommended-settings`);
}

export function changeZoneCrop(zoneId: number, change: { cropType: string; plantingDate: string | null }) {
  return authorizedRequest<{ message: string; recommendation: RecommendedSettings }>(
    `/api/farmer/zones/${zoneId}/crop`,
    { method: 'PUT', body: JSON.stringify(change) }
  );
}

export function dismissZoneInsight(
  zoneId: number,
  insightType: string
) {
  return authorizedRequest<{ message: string }>(
    `/api/farmer/insights/${encodeURIComponent(insightType)}/dismiss?zoneId=${zoneId}`,
    { method: 'POST' }
  );
}

// Saves the zone's soil type and recalculates today's advice for it. The
// farmer's own saved thresholds are not changed.
export function saveZoneSoilType(
  zoneId: number,
  soilType: ZoneSoilType
) {
  return authorizedRequest<{ message: string; soilType: ZoneSoilType }>(
    `/api/farmer/zones/${zoneId}/soil`,
    {
      method: 'PUT',
      body: JSON.stringify({ soil_type: soilType }),
    }
  );
}

// Saves the latest valid soil reading as this zone's wet or dry point.
// Rejected when the two points would end up too close together.
export function saveZoneCalibration(
  zoneId: number,
  point: 'wet' | 'dry'
) {
  return authorizedRequest<{ message: string; reading: number }>(
    `/api/farmer/zones/${zoneId}/calibration`,
    {
      method: 'POST',
      body: JSON.stringify({ point }),
    }
  );
}

// Resets this zone's watering levels to the FAO-56 recommendation for its crop
// and soil. Returns a plain message explaining what is missing if it cannot.
export function resetZoneToRecommended(zoneId: number) {
  return authorizedRequest<{
    message: string;
    threshold: number;
    desired: number;
  }>(`/api/farmer/zones/${zoneId}/reset-recommended`, { method: 'POST' });
}

/* ------------------------------------------------------------------------
   THE KIT (hardware) SCREEN - firmware v1.3.0
   ------------------------------------------------------------------------ */

// Everything the Kit screen shows about one zone's board.
//
// The three sensors report separately because they fail separately: a dead
// DHT11 alongside a working soil probe is a real and ordinary state. The kit
// keeps watering correctly and the app falls back to weather-app temperature,
// so reporting it as "your kit is broken" would be both wrong and alarming.
export type ZoneHardware = {
  hardwareId: number | null;
  deviceId: string | null;
  deviceName: string | null;
  online: boolean;
  lastSeen: string | null;
  firmwareVersion: string | null;
  soilSensorWorking: boolean;
  soilLastReadingAt: string | null;
  temperatureSensorWorking: boolean;
  temperatureLastReadingAt: string | null;
  humiditySensorWorking: boolean;
  humidityLastReadingAt: string | null;
  // active / revoked / legacy key / no device.
  tokenStatus: string;
  // What the farmer has to join after a WiFi change. Supplied by the server
  // (derived from the device ID the same way the firmware derives it) rather
  // than worked out here, so one change to the firmware's naming does not
  // need finding in two codebases.
  setupNetworkName: string | null;
  setupNetworkPassword: string | null;
};

export function fetchZoneHardware(zoneId: number) {
  return authorizedRequest<ZoneHardware>(
    `/api/farmer/zones/${zoneId}/hardware`
  );
}

export type ChangeWifiResult = {
  commandId: string;
  setupNetworkName: string;
  setupNetworkPassword: string;
};

// Thrown when the kit is offline (HTTP 409). A distinct type because the
// screen has to show a completely different thing for it - the power-cycle
// instructions - rather than the generic error banner.
export class KitOfflineError extends Error {
  readonly hint: string;
  readonly setupNetworkName: string | null;
  readonly setupNetworkPassword: string | null;

  constructor(
    message: string,
    hint: string,
    setupNetworkName: string | null,
    setupNetworkPassword: string | null
  ) {
    super(message);
    this.name = 'KitOfflineError';
    this.hint = hint;
    this.setupNetworkName = setupNetworkName;
    this.setupNetworkPassword = setupNetworkPassword;
  }
}

// Tells the kit to forget its WiFi and open its own setup network.
//
// Not routed through authorizedRequest, because that helper turns every
// non-2xx into a generic Error and the 409 body here carries the three
// things the offline screen needs. The auth header work is duplicated
// deliberately rather than widening the shared helper, which every other
// call in this file depends on.
export function requestZoneWifiChange(zoneId: number): Promise<ChangeWifiResult> {
  // One command to the kit per intention. Two would put it into setup mode
  // and then, a moment later, try to put it there again.
  return singleFlight(
    writeKey('POST', `/api/farmer/zones/${zoneId}/hardware/change-wifi`),
    () => sendZoneWifiChange(zoneId)
  );
}

async function sendZoneWifiChange(
  zoneId: number
): Promise<ChangeWifiResult> {
  const apiBase = resolveApiBase();

  if (!apiBase) {
    throw new Error(
      'AgroFlow.Api could not be located. Set EXPO_PUBLIC_AGROFLOW_API_BASE.'
    );
  }

  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;

  if (!token) {
    throw new Error('You must be signed in.');
  }

  const response = await fetch(
    `${apiBase}/api/farmer/zones/${zoneId}/hardware/change-wifi`,
    {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({}),
    }
  );

  if (response.status === 409) {
    const body = await response.json().catch(() => ({}));

    throw new KitOfflineError(
      body.error ??
        'Your kit is offline. Unplug and replug it 3 times quickly to open its setup network.',
      body.hint ??
        'If your router changed, your kit opens its setup network by itself after 15 minutes.',
      body.setupNetworkName ?? null,
      body.setupNetworkPassword ?? null
    );
  }

  if (!response.ok) {
    const text = await response.text();

    throw new Error(
      text || `Could not ask your kit to change WiFi (${response.status}).`
    );
  }

  return (await response.json()) as ChangeWifiResult;
}

/* ------------------------------------------------------------------------
   FORECAST
   ------------------------------------------------------------------------ */

// One day of the 7-day outlook.
//
// `advice` is null whenever the engine cannot speak to that day - no zone was
// asked for, or the zone has no crop or planting date. The screen renders
// nothing in that case rather than inventing a sentence: advice the app made
// up is worse than no advice, because the farmer cannot tell the two apart.
export type ForecastDay = {
  date: string;
  weekday: string;
  minC: number | null;
  maxC: number | null;
  rainMm: number | null;
  humidityPercent: number | null;
  icon: 'sun' | 'cloud' | 'rain';
  advice: string | null;
};

export type ForecastResponse = {
  farmId: number;
  zoneId: number | null;
  zoneName: string | null;
  days: ForecastDay[];
  source: string;
  // Set when there are no forecast rows at all, so the screen can say which
  // of "nothing to show" and "something is broken" it is.
  message: string | null;
};

export function fetchForecast(params?: {
  farmId?: string | number;
  zoneId?: string | number;
}) {
  const search = new URLSearchParams();
  if (params?.farmId != null) search.set('farmId', String(params.farmId));
  if (params?.zoneId != null) search.set('zoneId', String(params.zoneId));
  const qs = search.toString();

  return authorizedRequest<ForecastResponse>(
    `/api/farmer/forecast${qs ? `?${qs}` : ''}`
  );
}

/* ------------------------------------------------------------------------
   REPORTS
   ------------------------------------------------------------------------ */

export type ReportKind = 'water_usage' | 'moisture' | 'schedule';
export type ReportPeriodChoice = 'last_7_days' | 'last_30_days' | 'custom';

export type ReportRequestRow = {
  id: number;
  reportType: ReportKind;
  reportTypeLabel: string;
  zoneId: number | null;
  zoneName: string | null;
  periodStart: string;
  periodEnd: string;
  periodLabel: string;
  status: 'preparing' | 'ready' | 'failed';
  statusLabel: string;
  // The API path that regenerates the PDF. Not an object key - see migration
  // 0034 for why this deployment stores no files.
  filePath: string | null;
  requestedVia: 'app' | 'auto';
  createdAt: string;
  completedAt: string | null;
  // Plain words for the farmer, never the underlying reason.
  error: string | null;
};

export function fetchReportRequests() {
  return authorizedRequest<ReportRequestRow[]>('/api/farmer/report-requests');
}

export function createReportRequest(input: {
  reportType: ReportKind;
  period: ReportPeriodChoice;
  periodStart?: string;
  periodEnd?: string;
  zoneId?: number | null;
  farmId?: number | string | null;
}) {
  return authorizedRequest<{ id: number; status: string; message: string }>(
    '/api/farmer/report-requests',
    { method: 'POST', body: JSON.stringify(input) }
  );
}

// Fetches a finished report and hands it to the phone to open.
//
// The PDF needs the sign-in token in a header, so it cannot be a plain link -
// it is fetched as a blob and opened from there. On web that is an object
// URL; on a phone there is no filesystem to write to without another native
// module, so it opens in the system browser, which already knows how to
// display a PDF.
export async function openReportPdf(filePath: string): Promise<void> {
  const apiBase = resolveApiBase();

  if (!apiBase) {
    throw new Error('AgroFlow.Api could not be located.');
  }

  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;

  if (!token) throw new Error('You must be signed in.');

  const response = await fetch(`${apiBase}${filePath}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/pdf' },
  });

  if (!response.ok) {
    throw new Error(`This report could not be opened (${response.status}).`);
  }

  const blob = await response.blob();

  if (Platform.OS === 'web') {
    const url = URL.createObjectURL(blob);
    if (typeof window !== 'undefined') window.open(url, '_blank');
    // Revoked on a delay: revoking immediately races the new tab's load.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return;
  }

  // Data URL rather than a temporary file: writing one would need
  // expo-file-system, and a new native module means a new APK for a feature
  // that works without one.
  const base64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('The report could not be read.'));
    reader.onloadend = () => resolve(String(reader.result ?? ''));
    reader.readAsDataURL(blob);
  });

  const { openBrowserAsync } = await import('expo-web-browser');
  await openBrowserAsync(base64);
}

/* ---- Automatic reports (the farmer's half of step 4) ---- */

export type AutoReportSummary = {
  enabled: boolean;
  frequency: 'daily' | 'weekly' | 'monthly' | null;
  reportTypes: ReportKind[];
  reportTypeLabels: string[];
  description: string;
};

export function fetchAutoReportSummary() {
  return authorizedRequest<AutoReportSummary>('/api/farmer/auto-reports');
}

// The farmer's own off switch. Scoped server-side to their own farm; there
// is deliberately no way to turn it back ON from here - an admin sets up
// what a farmer gets, and a farmer can always stop it.
export function stopAutoReports() {
  return authorizedRequest<{ message: string }>('/api/farmer/auto-reports/stop', {
    method: 'POST',
    body: JSON.stringify({}),
  });
}
