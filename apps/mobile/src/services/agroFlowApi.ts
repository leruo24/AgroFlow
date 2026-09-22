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

async function authorizedRequest<T>(
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
