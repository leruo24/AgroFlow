import { singleFlight, writeKey } from '@/lib/singleFlight';
import {
  supabase,
} from '@/lib/supabase';

import Constants from 'expo-constants';
import { Platform } from 'react-native';
import {
  NetworkError,
  isNetworkError,
  noteCachedDataShown,
  reportNetworkFailure,
  reportNetworkSuccess,
  setConnectivityProbe,
} from '@/lib/connectivity';
import { getCacheUser, readCached, saveCached } from '@/lib/offlineCache';
import { enqueue, setQueueSender, type QueueKind } from '@/lib/offlineQueue';
import { onLanguageChange, type Language } from '@/i18n';

/* The server answered and said no (as opposed to no answer at all: NetworkError). */
export class ApiHttpError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'ApiHttpError';
  }
}

/* Offline with nothing saved on this phone for that screen yet. */
export class OfflineNoDataError extends NetworkError {
  constructor() {
    super('You’re offline, and this hasn’t been loaded on this phone yet. It will show once you’re back online.');
    this.name = 'OfflineNoDataError';
  }
}

/* The sentence to show for a refused or failed call. The API sends it as `error` or
 * `message` in JSON, so we pull it out instead of showing raw JSON. */
export function errorMessage(text: string, fallback: string): string {
  try {
    const problem = JSON.parse(text) as Record<string, unknown>;
    for (const key of ['error', 'message', 'detail', 'title']) {
      const value = problem?.[key];
      if (typeof value === 'string' && value.trim()) return value;
    }
    return fallback;   // JSON with no sentence in it: never show it raw
  } catch {
    // Not JSON: the text itself, if there is any.
  }
  return text.trim() || fallback;
}

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

  // Expo web does not always set expoConfig.hostUri. The browser's own host is reliable when
  // Metro and the API run on the same PC.
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    return `http://${window.location.hostname}:${port}`;
  }

  // In Expo development, hostUri is the Metro address shown to the phone (e.g.
  // 192.168.1.20:8081). Reusing that host avoids hardcoding a LAN IP that changes with the network.
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

/* Every authorised call. Reads fall back to the copy saved on this phone when there is no
 * connection (lib/offlineCache.ts); an identical write already in flight is shared instead of
 * sent twice (see lib/singleFlight.ts). */
function authorizedRequest<T>(
  path: string,
  init?: RequestInit
): Promise<T> {
  const method = (init?.method ?? 'GET').toUpperCase();

  if (method === 'GET') return cachedGet<T>(path, init);

  return singleFlight(writeKey(method, path, init?.body), () =>
    sendAuthorizedRequest<T>(path, init)
  );
}

// A GET that saves its answer for offline use, and answers from that copy when the network
// is gone. The banner then says how old the copy is (lib/connectivity.ts).
async function cachedGet<T>(path: string, init?: RequestInit): Promise<T> {
  try {
    const fresh = await sendAuthorizedRequest<T>(path, init);
    const userId = await getCacheUser();
    if (userId) void saveCached(userId, path, fresh);
    return fresh;
  } catch (error) {
    if (!isNetworkError(error)) throw error;
    const userId = await getCacheUser();
    const cached = userId ? await readCached<T>(userId, path) : null;
    if (!cached) throw new OfflineNoDataError();
    noteCachedDataShown(cached.savedAt);
    return cached.data;
  }
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
    error: sessionError,
  } = await supabase.auth
    .getSession();

  const token =
    data.session?.access_token;

  if (
    !token
  ) {
    // An expired login that could not be refreshed for lack of a connection is "offline",
    // not "signed out": the screens show their saved copy.
    if (sessionError && isNetworkError(sessionError)) {
      reportNetworkFailure();
      throw new NetworkError();
    }
    throw new Error(
      'You must be signed in.'
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
  let response: Response;
  try {
  response =
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
  } catch (fetchError) {
    // No answer at all: the phone is offline (or the server is unreachable).
    reportNetworkFailure();
    throw new NetworkError(
      fetchError instanceof Error && fetchError.name === 'AbortError'
        ? 'AgroFlow took too long to answer. Check your connection and try again.'
        : undefined
    );
  }

  // Any answer, even a refusal, means the connection works.
  reportNetworkSuccess();

  if (
    !response.ok
  ) {
    throw new ApiHttpError(
      errorMessage(await response.text(), `AgroFlow API request failed (${response.status}).`),
      response.status
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

// "Not a farmer on AgroFlow yet? Ask for a call" (no login).

export type EnquiryInput = {
  fullName: string;
  phone: string;
  email: string | null;
  province: string;
  town: string;
  farmSizeHa: number | null;
  crops: string[];
  cropsOther: string | null;
  bestTime: 'morning' | 'afternoon' | 'evening';
  notes: string | null;
  consent: boolean;
};

// Single-flight like every write, so a double tap sends one enquiry.
export function submitEnquiry(input: EnquiryInput): Promise<{ message: string }> {
  const body = JSON.stringify({ ...input, website: '' });
  return singleFlight(writeKey('POST', '/api/public/enquiries', body), async () => {
    const apiBase = resolveApiBase();
    if (!apiBase) throw new Error('AgroFlow.Api could not be located. Set EXPO_PUBLIC_AGROFLOW_API_BASE.');
    const response = await fetch(`${apiBase}/api/public/enquiries`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body,
    });
    const reply = (await response.json().catch(() => ({}))) as { message?: string; error?: string };
    if (!response.ok) throw new Error(reply.error || `The enquiry could not be sent (${response.status}).`);
    return { message: reply.message ?? 'Thank you, a representative will call you within 2 working days.' };
  });
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
  return authorizedRequest<ManualCommandResult>(
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

// What Water now answers (AF-05): the command, and whether its length was capped at the zone's
// maximum ("Capped to 5 min (this zone's limit)"). duplicate: the same press again (a double tap
// or a retry) returned the first command, so only one run happens.
export type ManualCommandResult = {
  id: string;
  duplicate?: boolean;
  durationSeconds?: number | null;
  capped?: boolean;
  requestedSeconds?: number | null;
  maxRunMinutes?: number | null;
  capMessage?: string | null;
  message?: string;
};

// AF-04: an alert is shown as read only once this resolves true (farmer-scoped on the server,
// set once). False on any failure, so the screen can offer Try again instead of pretending.
export async function markAlertRead(alertId: string): Promise<boolean> {
  const numeric = Number(String(alertId).replace(/^(database-|alert-)/, ''));
  if (!Number.isFinite(numeric)) return false;
  try {
    await sendAuthorizedRequest<{ id: number; readAt: string }>(`/api/farmer/alerts/${numeric}/read`, { method: 'POST', body: '{}' });
    return true;
  } catch {
    return false;
  }
}

// What the kit did with a command (GET /api/farmer/commands/{id}). state is the server's word:
// sent, started (the kit acknowledged), finished (the kit reported the run), no_response, failed.
export type CommandStatus = {
  id: string;
  zoneId: number;
  command: string;
  source: string;
  state: string;
  label: string;
  durationSeconds: number | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  // The audit's words (docs/audit/ui-contracts.md); absent from an API older than 0057.
  phase?: CommandPhase;
  phaseLabel?: string;
  publishedAt?: string | null;
  requestedDurationSeconds?: number | null;
  capped?: boolean;
};

export type CommandPhase =
  | 'request_sent' | 'waiting_for_kit' | 'kit_confirmed_start' | 'finished'
  | 'stop_requested' | 'kit_confirmed_stop' | 'no_response' | 'failed';

export function fetchCommandStatus(commandId: string) {
  return authorizedRequest<CommandStatus>(`/api/farmer/commands/${encodeURIComponent(commandId)}`);
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

/* Creates this farmer's own single-use link code and returns the t.me link. They are
 * holding the phone, so the link opens the bot with the code filled in: no QR, no admin. */
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

/* Clears the forced-password-change flag after the farmer has set their own password.
 * Security: the flag is server-side and clients cannot write it (migration 0024), so this is
 * the only way off the forced-change screen. */
export function confirmPasswordChanged() {
  return authorizedRequest<void>(
    '/api/farmer/password-changed',
    {
      method: 'POST',
      body: JSON.stringify({}),
    }
  );
}

/* Password recovery over Telegram. Anonymous, because a farmer who forgot their password
 * cannot log in, so this is the one call that skips authorizedRequest.
 * Security: the response is the same whether the address exists, has no Telegram, or was
 * rate limited. The screen must not say more, or anyone could test which emails are real. */
export function requestPasswordReset(email: string): Promise<string> {
  // Keyed on the trimmed address: two taps of Send for the same email are one reset and one
  // Telegram message.
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

// The other two signed-out calls (docs/password-reset.md). A refusal carries the server's own
// plain sentence ("That code is not right, or it has expired."), shown as written.
async function postSignedOut<T>(path: string, body: unknown): Promise<T> {
  const apiBase = resolveApiBase();
  if (!apiBase) {
    throw new Error('AgroFlow.Api could not be located. Set EXPO_PUBLIC_AGROFLOW_API_BASE.');
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    let response: Response;
    try {
      response = await fetch(`${apiBase}${path}`, {
        method: 'POST',
        signal: controller.signal,
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    } catch {
      throw new Error('We could not reach AgroFlow. Please check your connection and try again.');
    }
    const parsed = await response.json().catch(() => ({})) as T & { error?: string };
    if (!response.ok) {
      throw new Error(parsed.error ?? 'We could not reach AgroFlow. Please check your connection and try again.');
    }
    return parsed;
  } finally {
    clearTimeout(timeout);
  }
}

/** The 6-digit code from Telegram and a new password. Other sessions are signed out. */
export function resetPasswordWithCode(email: string, code: string, newPassword: string): Promise<{ message: string }> {
  return singleFlight(
    writeKey('POST', '/api/auth/reset-password', `${email.trim().toLowerCase()}:${code}`),
    () => postSignedOut<{ message: string }>('/api/auth/reset-password', {
      email: email.trim().toLowerCase(), code, newPassword,
    })
  );
}

/** Swaps a one-tap link's token (works once, 24 hours) for a Supabase sign-in token hash. */
export function redeemOneTap(token: string): Promise<{ email: string; tokenHash: string }> {
  return singleFlight(
    writeKey('POST', '/api/auth/one-tap', token),
    () => postSignedOut<{ email: string; tokenHash: string }>('/api/auth/one-tap', { token })
  );
}

export type FarmerServiceRequestInput = {
  requestType: 'new_farm' | 'new_zone';
  farmId?: number;
  location?: string;
  roughSize?: number;
  // AF-19: the unit of roughSize, or 'unknown' ("I don't know - help me measure").
  roughSizeUnit?: 'm2' | 'ha' | 'unknown';
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

// FAO-56 insight engine endpoints (migration 0027). The soil type has its own endpoint.

export type ZoneSoilType = 'sandy' | 'loam' | 'clay';

// "Why am I seeing this?", built on the server by the same rule that produced the message.
// `technical` never reaches the farmer's app.
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
  // Optional: older rows have no explanation.
  explanation?: Explanation | null;
};

// How far through its season this zone's crop is. Null when the crop or planting date is
// unknown, the normal state for a zone not filled in yet. ZoneGrowthBar then shows nothing,
// because an empty bar would say the season has not started.
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
    // Optional: older APIs do not send them.
    confidence?: { level: 'high' | 'medium' | 'low'; reason: string } | null;
    nextStep?: { field: string; ask: string } | null;
    stageAssumed?: boolean | null;
    confidenceExplanation?: Explanation | null;
  }>(`/api/farmer/zones/${zoneId}/insights`);
}

// One card per zone, logging by hand, and finishing setup.

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
  // code + args (AF-02): the sentence is built in the farmer's language (lib/advice.ts); text is the English.
  action: { kind: TodayActionKind; text: string; code?: string; args?: Record<string, string> };
  // The engine's runtime for a "water" card, in whole minutes (null otherwise), and the
  // zone's maximum run time, so the card can say when the advice needs more than one run.
  recommendedMinutes?: number | null;
  maxRunMinutes?: number;
  why: Explanation | null;
  confidence: { level: 'high' | 'medium' | 'low'; reason: string } | null;
  confidenceExplanation: Explanation | null;
  nextStep: { field: string; ask: string } | null;
  setup?: ZoneSetupFacts | null;
  // AF-18: what the advice was worked out from (AdviceProvenance on the server).
  provenance?: AdviceProvenance | null;
};

export type AdviceProvenance = {
  cropType: string | null;          // the crop the zone is SET to, never read from its name
  cropModelKey: string | null;
  cropModelLabel: string | null;    // the engine's model, e.g. "leafy veg (lettuce)"
  cropModelIsDefault: boolean;      // the model is a stand-in for the saved crop
  plantingDate: string | null;
  stageAssumed: boolean;
  soilModel: string;
  soilDefaulted: boolean;
  weatherFrom: string | null;       // the observed weather used, first and last day
  weatherTo: string | null;
  forecastDays: number;
  missingWeatherDays: string[];     // recent days with no weather row
  calculatedAt: string;
};

export type FarmToday = {
  farmId: number;
  day: string;
  calculatedAt?: string;
  // AF-03: today's weather, available / missing / stale; unknown is never "dry".
  weather?: { availability: 'available' | 'missing' | 'stale'; rainExpected: boolean | null; precipitationMm: number | null; fetchedAt: string | null; reason: string } | null;
  zones: TodayZone[];
};

export function fetchFarmToday(farmId: string | number) {
  return authorizedRequest<FarmToday>(
    `/api/farmer/farms/${encodeURIComponent(String(farmId))}/today`
  );
}

export type TankStatus = {
  farmId: number;
  farmName: string;
  capacityLitres: number | null;
  lastRefillId: number | null;
  lastRefillLitres: number | null;
  lastRefilledAt: string | null;
  latestWaterPh: number | null;
  estimatedUsedLitres: number;
  estimatedRemainingLitres: number | null;
  isLow: boolean;
  waterPhWarning: string | null;
};

export type TankRefillResult = {
  status: TankStatus;
  estimatedUsedBeforeRefill: number | null;
  observedUsed: number | null;
  comparison: string | null;
};

export type SoilPhEntry = {
  id: number;
  zoneId: number;
  ph: number;
  measuredAt: string;
  note: string | null;
};

export function fetchTankStatus(farmId: string | number) {
  return authorizedRequest<TankStatus>(`/api/farmer/farms/${encodeURIComponent(String(farmId))}/tank`);
}

export function saveTankCapacity(farmId: string | number, litres: number) {
  return authorizedRequest<TankStatus>(`/api/farmer/farms/${encodeURIComponent(String(farmId))}/tank`, {
    method: 'PUT', body: JSON.stringify({ litres }),
  });
}

/* Sent now, or kept on this phone and sent when the connection is back (lib/offlineQueue.ts).
 * Only these three writes do this. */
export type SentOrQueued<T> = { queued: false; result: T } | { queued: true };

async function sendOrQueue<T>(kind: QueueKind, path: string, body: Record<string, unknown>): Promise<SentOrQueued<T>> {
  try {
    const result = await authorizedRequest<T>(path, { method: 'POST', body: JSON.stringify(body) });
    return { queued: false, result };
  } catch (error) {
    if (!isNetworkError(error)) throw error;
    await enqueue(kind, path, body);
    return { queued: true };
  }
}

export function logTankRefill(
  farmId: string | number,
  refill: { litresAdded: number; waterPh: number | null; refilledAt: string }
) {
  return sendOrQueue<TankRefillResult>(
    'tank_refill',
    `/api/farmer/farms/${encodeURIComponent(String(farmId))}/tank/refills`,
    refill
  );
}

export function fetchSoilPh(zoneId: string | number) {
  return authorizedRequest<{ zoneId: number; entries: SoilPhEntry[] }>(
    `/api/farmer/zones/${encodeURIComponent(String(zoneId))}/soil-ph`
  );
}

export function logSoilPh(
  zoneId: string | number,
  entry: { ph: number; measuredAt: string; note: string | null }
) {
  return sendOrQueue<SoilPhEntry>(
    'soil_ph',
    `/api/farmer/zones/${encodeURIComponent(String(zoneId))}/soil-ph`,
    entry
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

// `at` is when the farmer felt the soil, so a check sent later still counts for that moment.
export function logSoilFeel(zoneId: number, feel: SoilFeel, at = new Date()) {
  return sendOrQueue<{ id: number; message: string }>(
    'soil_check',
    `/api/farmer/zones/${zoneId}/soil-feel`,
    { feel, at: at.toISOString() }
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

// "Recommended for you", and changing the crop.

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

// Dismiss and history. Who and when come from the login.

export type Dismissal = {
  id: number;
  kind: 'alert' | 'insight';
  itemKey: string;
  farmId: number | null;
  title: string;
  raisedAt: string | null;
  critical: boolean;
  dismissedByName: string;
  dismissedAt: string;
  note: string | null;
  restoredByName: string | null;
  restoredAt: string | null;
};

export function fetchDismissals(farmId: string | number) {
  return authorizedRequest<Dismissal[]>(`/api/farmer/dismissals?farmId=${encodeURIComponent(String(farmId))}`);
}

export function dismissNotification(kind: 'alert' | 'insight', itemKey: string, note: string | null = null) {
  return authorizedRequest<{ id: number; message: string }>('/api/farmer/dismissals', {
    method: 'POST',
    body: JSON.stringify({ kind, itemKey, note }),
  });
}

export function restoreNotification(id: number) {
  return authorizedRequest<{ id: number; message: string }>(`/api/farmer/dismissals/${id}/restore`, { method: 'POST' });
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

/* The Kit (hardware) screen */

// Everything the Kit screen shows about one zone's board.
// The three sensors are reported separately because they fail separately: a dead DHT11
// with a working soil probe is normal, and the kit still waters correctly, so "your kit is
// broken" would be wrong and alarming.
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
  // What the farmer has to join after a WiFi change. The server works it out from the device
  // ID (the same way the firmware does), so a naming change only needs updating in one place.
  setupNetworkName: string | null;
  setupNetworkPassword: string | null;
  // Readings the kit still had waiting to upload at its latest reading (firmware 1.7.0+).
  // Absent from an older API; null when the kit has not reported it.
  offlineBacklog?: number | null;
};

// The Kit tab (GET /api/farmer/farms/{farmId}/kits): one card per zone, with a plain status and a
// checklist worked out by the server (KitHealth) from what the kit really reports. Each line is a
// key and a state; the app words it in the farmer's language (kitTab.line.<key>.<state>).
export type KitOverall = 'working' | 'needs_attention' | 'not_connected' | 'awaiting_installation';
export type KitLine = { key: string; state: string; tone: 'ok' | 'warn' | 'bad' | 'info'; at: string | null; value: string | null };
export type KitCard = {
  zoneId: number;
  zoneName: string;
  hasKit: boolean;
  deviceId: string | null;
  deviceName: string | null;
  setupNetworkName: string | null;
  setupNetworkPassword: string | null;
  overall: KitOverall;
  lines: KitLine[];
};

export function fetchFarmKits(farmId: string | number) {
  return authorizedRequest<KitCard[]>(`/api/farmer/farms/${encodeURIComponent(String(farmId))}/kits`);
}

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

// Thrown when the kit is offline (HTTP 409). Its own type because the screen shows the
// power-cycle instructions instead of the generic error banner.
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
// Not through authorizedRequest, which turns every non-2xx into a generic Error, while this
// 409 body carries what the offline screen needs. The auth header code is repeated here
// instead of changing the shared helper.
export function requestZoneWifiChange(zoneId: number): Promise<ChangeWifiResult> {
  // One command per intention; a second would try to put the kit into setup mode again.
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
    throw new Error(
      errorMessage(await response.text(), `Could not ask your kit to change WiFi (${response.status}).`)
    );
  }

  return (await response.json()) as ChangeWifiResult;
}

/* Forecast */

// One day of the 7-day outlook.
// `advice` is null when the engine cannot speak to that day (no zone asked for, or no crop
// or planting date). The screen then shows nothing instead of making up a sentence.
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
  // Set when there are no forecast rows, so the screen can say "nothing to show" instead of
  // looking broken.
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

/* Reports */

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
  // The API path that regenerates the PDF, not a file key (see migration 0034).
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

// Fetches a finished report and opens it.
// The PDF needs the sign-in token in a header, so it cannot be a plain link; we fetch it as
// a blob. On web that becomes an object URL; on a phone it opens in the system browser,
// which can show a PDF without another native module.
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
    // Revoked after a delay: revoking straight away races the new tab loading.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return;
  }

  // A data URL instead of a temporary file: a file would need expo-file-system, and a new
  // native module means a new APK.
  const base64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('The report could not be read.'));
    reader.onloadend = () => resolve(String(reader.result ?? ''));
    reader.readAsDataURL(blob);
  });

  const { openBrowserAsync } = await import('expo-web-browser');
  await openBrowserAsync(base64);
}

/* Automatic reports (the farmer's side) */

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

// The farmer's own off switch, limited on the server to their own farm. There is no way to
// turn it back on from here: an admin sets up what a farmer gets.
export function stopAutoReports() {
  return authorizedRequest<{ message: string }>('/api/farmer/auto-reports/stop', {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

/* The offline queue sends through the same authorised request (and single-flight) as the app;
 * "network" keeps an entry for later, anything else the server said drops it with its reason. */
setQueueSender(
  async entry => {
    await authorizedRequest<unknown>(entry.path, { method: 'POST', body: JSON.stringify(entry.body) });
  },
  error => (isNetworkError(error) || (error instanceof ApiHttpError && error.status >= 500) ? 'network' : 'refused')
);

/* While offline, lib/connectivity.ts asks the API's open ping route whether it answers. */
setConnectivityProbe(async () => {
  const apiBase = resolveApiBase();
  if (!apiBase) return false;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(`${apiBase}/api/public/ping`, { signal: controller.signal });
    return response.status < 500;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
});

/* The farmer's language, so Telegram messages use it too. Sent when they change it in Settings
 * and after sign-in; a failure is ignored (the app itself already changed). */
export function saveLanguagePreference(language: Language) {
  return authorizedRequest<void>('/api/farmer/language', {
    method: 'PUT',
    body: JSON.stringify({ language }),
  });
}

onLanguageChange(lang => { void saveLanguagePreference(lang).catch(() => undefined); });

// ---- Drought mode, community alerts and the wizard's farm settings (docs/drought-community.md)

export type FarmSetup = {
  farmId: number;
  farm: { name: string; location: string | null; latitude: number | null; longitude: number | null; province: string | null; town: string | null; waterSource: string | null } | null;
  zones: { zoneId: number; name: string; crop: string | null; plantingDate: string | null; soilType: string | null; areaM2: number | null; flowRateLpm: number | null; irrigationType: string | null; maxRunMinutes: number }[];
  tank: { capacityLitres: number | null; estimatedRemainingLitres: number | null } | null;
};

export function fetchFarmSetup(farmId: string | number) {
  return authorizedRequest<FarmSetup>(`/api/farmer/farms/${encodeURIComponent(String(farmId))}/setup`);
}

export function saveWaterSource(farmId: string | number, waterSource: string) {
  return authorizedRequest<{ message: string }>(`/api/farmer/farms/${encodeURIComponent(String(farmId))}/water-source`, {
    method: 'PUT', body: JSON.stringify({ waterSource }),
  });
}

export function saveIrrigationType(zoneId: number, irrigationType: string) {
  return authorizedRequest<{ message: string; explanation: string }>(`/api/farmer/zones/${zoneId}/irrigation-type`, {
    method: 'PUT', body: JSON.stringify({ irrigationType }),
  });
}

// "Something's wrong — tell my field officer": a notice for staff; farmers never edit the location.
export function reportLocationProblem(farmId: string | number, note?: string) {
  return authorizedRequest<{ message: string }>(`/api/farmer/farms/${encodeURIComponent(String(farmId))}/location-problem`, {
    method: 'POST', body: JSON.stringify({ note: note ?? null }),
  });
}

export type NotificationPreferences = {
  wateringTelegram: boolean;
  lowTankTelegram: boolean;
  droughtTelegram: boolean;
  communityTelegram: boolean;
  weatherTelegram: boolean;
  communityOptIn: boolean;
  quietStart: string | null;
  quietEnd: string | null;
};

export const DEFAULT_PREFERENCES: NotificationPreferences = {
  wateringTelegram: true, lowTankTelegram: true, droughtTelegram: true, communityTelegram: true, weatherTelegram: true,
  communityOptIn: true, quietStart: null, quietEnd: null,
};

export function fetchNotificationPreferences() {
  return authorizedRequest<NotificationPreferences>('/api/farmer/notification-preferences');
}

export function saveNotificationPreferences(prefs: NotificationPreferences) {
  return authorizedRequest<{ message: string }>('/api/farmer/notification-preferences', { method: 'PUT', body: JSON.stringify(prefs) });
}

export type DroughtZone = {
  zoneId: number; zoneName: string; crop: string | null; priority: 'full' | 'reduced' | 'skip' | 'nofactor';
  fraction: number; ky: number | null; normalLitres: number | null; droughtLitres: number | null; why: string;
  irrigationType: string | null; efficiencyNote: string;
};

export type DroughtView = {
  farmId: number; active: boolean; automatic: boolean; override: 'on' | 'off' | null; reason: string; since: string | null;
  budget: { litresLeft: number; normalDays: number; droughtDays: number; text: string } | null;
  summary: string | null; zones: DroughtZone[]; honesty: string; source: string;
  // AF-06: the one tank summary (TankSummary on the server); absent from an older API.
  tank?: TankSummaryView | null;
};

// What is known about the farm's tank, for every screen. missing names the one input lacking.
export type TankSummaryView = {
  state: 'not_a_tank_farm' | 'no_tank' | 'level_unknown' | 'use_unknown' | 'complete';
  hasTank: boolean;
  capacityLitres: number | null;
  remainingLitres: number | null;
  missing: 'capacity' | 'level' | 'daily_use' | null;
};

export function fetchDrought(farmId: string | number) {
  return authorizedRequest<DroughtView>(`/api/farmer/farms/${encodeURIComponent(String(farmId))}/drought`);
}

export function setDroughtMode(farmId: string | number, mode: 'on' | 'off' | 'auto') {
  return authorizedRequest<DroughtView>(`/api/farmer/farms/${encodeURIComponent(String(farmId))}/drought`, {
    method: 'PUT', body: JSON.stringify({ mode }),
  });
}

export type CommunityCategory = 'pest' | 'disease' | 'fire' | 'water' | 'weather';
export type CommunitySeverity = 'low' | 'moderate' | 'high';

export type NearbyReport = {
  reportId: number; category: CommunityCategory; subtype: string; label: string; severity: CommunitySeverity; message: string;
  distanceKm: number; downwind: boolean; similarFarms: number; confirmations: number; fireState: string | null;
  createdAt: string; expiresAt: string; mine: boolean; confirmed: boolean; canUpdate: boolean; updates: string[];
};

export type CommunityLimit = { allowed: boolean; nextAllowedAt: string | null; message: string };

export function fetchCommunity(farmId: string | number) {
  return authorizedRequest<{ reports: NearbyReport[]; limit: CommunityLimit; unverified: string; emergency?: string }>(
    `/api/farmer/farms/${encodeURIComponent(String(farmId))}/community`);
}

// The report's place is the farm's saved location (set by staff); the phone is never tracked.
export function createCommunityReport(report: { farmId: number; category: CommunityCategory; subtype: string; severity: CommunitySeverity; description?: string }) {
  return authorizedRequest<{ id: number; notifiedFarms: number; limit: string; nextAllowedAt: string | null }>(
    '/api/farmer/community/reports', { method: 'POST', body: JSON.stringify(report) });
}

export function confirmCommunityReport(reportId: number, farmId: number) {
  return authorizedRequest<{ confirmations: number; message: string }>(`/api/farmer/community/reports/${reportId}/confirm`, {
    method: 'POST', body: JSON.stringify({ farmId }),
  });
}

export function updateCommunityReport(reportId: number, kind: 'still_burning' | 'spreading' | 'under_control' | 'out', direction?: string) {
  return authorizedRequest<{ notifiedFarms: number; closed: boolean }>(`/api/farmer/community/reports/${reportId}/updates`, {
    method: 'POST', body: JSON.stringify({ kind, direction: direction ?? null }),
  });
}

// ---------------------------------------------------------------------------------------------
// The journey (Part B of the 22 October audit fixes; docs/audit/ui-contracts.md). Every state
// here is the server's: the app never works a stage or a percentage out by itself.
// ---------------------------------------------------------------------------------------------

export type FarmerTaskKey = 'preferences' | 'farm' | 'water' | 'crops';
export type JourneyStage =
  | 'enquiry' | 'details' | 'service_agreed' | 'account_active'
  | 'ready_for_installation' | 'visit_booked' | 'installing' | 'commissioned';

export type InstallerCheck = {
  item: 'kit_linked' | 'calibration' | 'flow_measured' | 'run_limit' | 'test_start_stop';
  label: string; done: boolean; required: boolean; whoCompletes: 'installer';
  doneBy: string | null; doneAt: string | null; provenance: string | null; value: string | null;
};

export type HelpTopic = 'location' | 'water_source' | 'tank_capacity' | 'tank_level' | 'crop'
  | 'planting_date' | 'irrigation_type' | 'soil_type' | 'area' | 'other';

export type LegalDocument = {
  key: 'terms' | 'privacy'; title: string; version: string; date: string; status: string; statusLabel: string; url: string;
};

export type Journey = {
  farmId: number;
  setupProgress: { done: number; total: number; label: string; tasks: { key: FarmerTaskKey; done: boolean; doneAt: string | null }[] };
  installation: { stage: JourneyStage; label: string; text: string; live: boolean };
  whereYouAreNow: {
    stage: JourneyStage; stageLabel: string; stageNumber: number; stageCount: number;
    steps: { key: string; label: string; done: boolean }[];
    done: string[]; stillToDo: string[];
    nextAction: string; whoActsNext: 'you' | 'agroflow_staff' | 'installer'; whoActsNextLabel: string;
    knownDate: string | null; dateLabel: string;
  };
  zones: {
    zoneId: number; name: string; commissionState: 'legacy' | 'pending' | 'commissioned'; commissionedAt: string | null;
    irrigationMode: string; offerAutomatic: boolean; autoOfferAnswer: 'automatic' | 'manual' | null; installerChecks: InstallerCheck[];
  }[];
  helpRequests: { id: number; topic: HelpTopic; zoneId: number | null; status: 'open' | 'resolved'; createdAt: string; ownerName: string | null }[];
  terms: { accepted: { all: boolean; termsAcceptedAt: string | null; privacyAcceptedAt: string | null }; documents: LegalDocument[] };
};

export function fetchJourney(farmId: string | number) {
  return authorizedRequest<Journey>(`/api/farmer/farms/${encodeURIComponent(String(farmId))}/journey`);
}

// Finishes one of the four tasks. The server checks the saved data first (400 with the reason).
export function finishFarmerTask(farmId: string | number, task: FarmerTaskKey) {
  return authorizedRequest<Journey>(`/api/farmer/farms/${encodeURIComponent(String(farmId))}/tasks/${task}`, { method: 'POST', body: '{}' });
}

// "I don't know – help me": a staff follow-up with an owner. Asking twice is the same request.
export function askForHelp(farmId: string | number, topic: HelpTopic, zoneId?: number | null, note?: string | null) {
  return authorizedRequest<{ id: number; topic: HelpTopic; status: 'open'; assigned: boolean; message: string }>(
    `/api/farmer/farms/${encodeURIComponent(String(farmId))}/help`,
    { method: 'POST', body: JSON.stringify({ topic, zoneId: zoneId ?? null, note: note ?? null }) });
}

export function acceptTerms(termsVersion: string, privacyVersion: string) {
  return authorizedRequest<{ accepted: true; termsVersion: string; privacyVersion: string; termsAcceptedAt: string; privacyAcceptedAt: string }>(
    '/api/farmer/terms/accept', { method: 'POST', body: JSON.stringify({ accepted: true, termsVersion, privacyVersion }) });
}

// "Turn on automatic watering?" after commissioning: Yes (automatic) or Keep manual.
export function answerAutomaticOffer(zoneId: number, answer: 'automatic' | 'manual') {
  return authorizedRequest<{ zoneId: number; answer: string; irrigationMode: string }>(
    `/api/farmer/zones/${zoneId}/automatic-offer`, { method: 'POST', body: JSON.stringify({ answer }) });
}

export type ServiceSupport = {
  farmId: number; status: string; statusLabel: string; serviceAgreedAt?: string | null;
  payer: string | null; planDescription: string | null; contactName?: string | null;
  example: { installationZar: number; monthlyZar: number; zones: number; label: string; text: string };
  help: { inApp: string; telegram: string; staff: string };
  billing?: string;
};

export function fetchServiceSupport(farmId?: string | number | null) {
  return authorizedRequest<ServiceSupport>(`/api/farmer/service${farmId ? `?farmId=${encodeURIComponent(String(farmId))}` : ''}`);
}

// The draft documents (no sign-in needed to read them).
export async function fetchLegalText(key: 'terms' | 'privacy'): Promise<string> {
  const apiBase = resolveApiBase();
  if (!apiBase) throw new Error('AgroFlow.Api could not be located. Set EXPO_PUBLIC_AGROFLOW_API_BASE.');
  let response: Response;
  try {
    response = await fetch(`${apiBase}/api/public/legal/${key}`);
  } catch {
    throw new NetworkError();
  }
  if (!response.ok) throw new ApiHttpError(`The document could not be loaded (${response.status}).`, response.status);
  return response.text();
}
