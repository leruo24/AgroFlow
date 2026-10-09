/* The arithmetic behind "Finish setup" and "I watered". */

/** The bottle used for the flow-rate test: a 500 mL cooldrink bottle. */
export const BOTTLE_LITRES = 0.5;

/** Litres per minute from how many seconds the tap took to fill the bottle. */
export function flowRateFromBottle(seconds: number): number | null {
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return Math.round((BOTTLE_LITRES / seconds) * 60 * 100) / 100;
}

/** "About N weeks ago" as a date, YYYY-MM-DD. Null for anything not a whole number of weeks 0-104. */
export function plantedWeeksAgo(weeks: number, today: Date = new Date()): string | null {
  if (!Number.isInteger(weeks) || weeks < 0 || weeks > 104) return null;
  const d = new Date(today.getTime() - weeks * 7 * 86400000);
  return d.toISOString().slice(0, 10);
}

/** The size presets the farm registration wizard also offers. */
export const AREA_PRESETS: { key: 'small' | 'plot'; label: string; m2: number }[] = [
  { key: 'small', label: 'Small growing area (about 0.2 m²)', m2: 0.2 },
  { key: 'plot', label: 'Field / plot (about 200 m²)', m2: 200 },
];

/** Quick choices for "I watered". */
export const WATERED_MINUTES = [5, 10, 15, 20, 30];

/**
 * The crops the engine has figures for, in the same order as the admin console's ZONE_CROPS
 * (apps/web/admin/src/data/referenceData.ts). A test keeps the two equal.
 */
export const ZONE_CROPS: { value: string; label: string }[] = [
  { value: 'maize', label: 'Maize' },
  { value: 'potato', label: 'Potato' },
  { value: 'tomato', label: 'Tomato' },
  { value: 'dry_beans', label: 'Dry beans' },
  { value: 'citrus', label: 'Citrus' },
  { value: 'leafy_veg', label: 'Leafy vegetables' },
  { value: 'cucumber', label: 'Cucumber' },
  { value: 'spinach', label: 'Spinach' },
];

/** YYYY-MM-DD moved by whole days; never past `latest` (today). */
export function shiftDate(iso: string, days: number, latest: string): string {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  const out = d.toISOString().slice(0, 10);
  return out > latest ? latest : out;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "6 Oct 2026" - never ISO in front of a farmer. */
export function dayLabel(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}
