// Whether today's weather is known (AF-03), the same rule as the server's WeatherAvailability:
// available, missing or stale. Unknown is never "dry": rainExpected is null unless the forecast is
// there and fresh, and rain comes from the forecast's millimetres (1 mm or more), never from the
// word "rain" in a description. Cases: docs/audit/fixtures/weather-cases.json.

export type WeatherAvailability = 'available' | 'missing' | 'stale';

export type WeatherStatus = {
  availability: WeatherAvailability;
  rainExpected: boolean | null;
  precipitationMm: number | null;
  fetchedAt: string | null;
  reason: 'no_forecast' | 'forecast_old' | 'no_precipitation' | 'rain_forecast' | 'dry_forecast';
};

export const RAIN_MM_THRESHOLD = 1;
export const WEATHER_STALE_AFTER_MS = 12 * 60 * 60 * 1000;

export type WeatherTodayRow = {
  date?: string | null;
  precipitation_mm?: number | string | null;
  fetched_at?: string | null;
} | null | undefined;

export function weatherStatus(row: WeatherTodayRow, now: number = Date.now()): WeatherStatus {
  const fetchedAt = row?.fetched_at ?? null;
  const fetchedMs = fetchedAt ? new Date(fetchedAt).getTime() : NaN;
  if (!row || !fetchedAt || !Number.isFinite(fetchedMs)) {
    return { availability: 'missing', rainExpected: null, precipitationMm: null, fetchedAt: null, reason: 'no_forecast' };
  }
  const mmRaw = row.precipitation_mm;
  const mm = mmRaw == null || mmRaw === '' ? NaN : Number(mmRaw);
  if (now - fetchedMs > WEATHER_STALE_AFTER_MS) {
    return { availability: 'stale', rainExpected: null, precipitationMm: Number.isFinite(mm) ? mm : null, fetchedAt, reason: 'forecast_old' };
  }
  if (!Number.isFinite(mm) || mm < 0) {
    return { availability: 'missing', rainExpected: null, precipitationMm: null, fetchedAt, reason: 'no_precipitation' };
  }
  const rain = mm >= RAIN_MM_THRESHOLD;
  return { availability: 'available', rainExpected: rain, precipitationMm: mm, fetchedAt, reason: rain ? 'rain_forecast' : 'dry_forecast' };
}
