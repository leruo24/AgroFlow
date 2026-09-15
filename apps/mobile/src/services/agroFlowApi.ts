import {
  supabase,
} from '@/lib/supabase';

import Constants from 'expo-constants';

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
            1,
            expoHostUri.indexOf(']')
          )
        : expoHostUri.split(':')[0];

    const port =
      process.env.EXPO_PUBLIC_AGROFLOW_API_PORT ??
      '5080';

    return `http://${host}:${port}`;
  }

  return '';
}

const API_BASE =
  resolveApiBase();

export type FarmerDashboard = {
  profile: Record<string, unknown> | null;
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
  if (
    !API_BASE
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

  const response =
    await fetch(
      `${API_BASE}${path}`,
      {
        ...init,
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

  return response.json() as Promise<T>;
}

export function fetchFarmerDashboard() {
  return authorizedRequest<FarmerDashboard>(
    '/api/farmer/dashboard'
  );
}

export function fetchCurrentWeather() {
  return authorizedRequest<CurrentWeatherResponse>(
    '/api/farmer/weather/current'
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
