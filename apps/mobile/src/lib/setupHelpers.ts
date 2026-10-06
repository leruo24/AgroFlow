/* Item 6: the arithmetic behind "Finish setup" and "I watered". */

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
export const AREA_PRESETS: { key: 'tub' | 'bed'; label: string; m2: number }[] = [
  { key: 'tub', label: 'Small tub (about 0.2 m²)', m2: 0.2 },
  { key: 'bed', label: 'Bed, 1 × 2 m (2 m²)', m2: 2 },
];

/** Quick choices for "I watered". */
export const WATERED_MINUTES = [5, 10, 15, 20, 30];
