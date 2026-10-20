// Friendly, translated labels for values stored in the database: never show "leafy_veg",
// "loam", "automatic" or "Healthy" as they are stored. Unknown values fall back to a tidy
// version of the value itself ("cover_crop" -> "Cover crop"), never the raw form.
// Also the one set of empty-state phrases, used instead of "No reading" / "No data" / "Never".
import type { TranslationKey } from '@/i18n';

type T = (key: TranslationKey, params?: Record<string, string | number>) => string;

export const CROP_VALUES = ['maize', 'potato', 'tomato', 'dry_beans', 'citrus', 'leafy_veg', 'cucumber', 'spinach'] as const;
export const SOIL_VALUES = ['sandy', 'loam', 'clay'] as const;
export const MODE_VALUES = ['automatic', 'scheduled', 'manual'] as const;
export const HEALTH_VALUES = ['Healthy', 'Warning', 'Critical', 'Unknown'] as const;
export const SENSOR_VALUES = ['Online', 'Offline', 'Low Battery', 'Fault'] as const;
export const TRIGGER_VALUES = ['manual', 'auto', 'automatic', 'scheduled', 'schedule', 'offline'] as const;

// "cover_crop" -> "Cover crop": for a value we have no label for yet.
export function tidy(value: string): string {
  const words = value.replace(/[_-]+/g, ' ').trim().toLowerCase();
  return words ? words[0].toUpperCase() + words.slice(1) : '';
}

const pick = (t: T, prefix: string, known: readonly string[], value: string | null | undefined, empty: string): string => {
  if (!value || value === 'Not configured') return empty;
  const v = known.find(k => k.toLowerCase() === value.toLowerCase());
  return v ? t(`${prefix}.${v.replace(/\s+/g, '_')}` as TranslationKey) : tidy(value);
};

export const cropLabel = (t: T, crop: string | null | undefined) => pick(t, 'label.crop', CROP_VALUES, crop, t('empty.noCrop'));
export const soilLabel = (t: T, soil: string | null | undefined) => pick(t, 'label.soil', SOIL_VALUES, soil, t('empty.notSet'));
export const modeLabel = (t: T, mode: string | null | undefined) => pick(t, 'label.mode', MODE_VALUES, mode, t('empty.notSet'));
export const healthLabel = (t: T, health: string | null | undefined) => pick(t, 'label.health', HEALTH_VALUES, health, t('label.health.Unknown'));
export const sensorLabel = (t: T, status: string | null | undefined) => pick(t, 'label.sensor', SENSOR_VALUES, status, t('empty.noKit'));
export const triggerLabel = (t: T, source: string | null | undefined) => {
  const v = source === 'automatic' ? 'auto' : source === 'schedule' ? 'scheduled' : source;
  return pick(t, 'label.trigger', TRIGGER_VALUES, v, t('label.trigger.manual'));
};
// A zone's place: "North beds", or nothing when it was never set.
export const placeLabel = (location: string | null | undefined) => (!location || location === 'Not configured' ? '' : location);
