// Item 2: a soil reading is a percentage only after the wet/dry setup.
//
// The probe is resistive: its number means "how wet" only once the zone's
// wet and dry points are known. Before that it is a sensor number, and
// showing it with a % would claim a measurement the app does not have.

export const NOT_SET_UP = 'not yet set up';

// The same formula as the backend's SoilWaterBalance.RelativeMoisturePercent,
// so the app and the reports always show the same figure.
export function relativeMoisturePercent(
  reading: number | null | undefined,
  calibrationWet: number | null | undefined,
  calibrationDry: number | null | undefined
): number | null {
  if (reading == null || calibrationWet == null || calibrationDry == null) return null;
  const span = calibrationWet - calibrationDry;
  if (Math.abs(span) < 1e-9) return null;
  const percent = ((reading - calibrationDry) / span) * 100;
  return Math.min(100, Math.max(0, percent));
}

export type SoilReadingForDisplay = {
  value: number;
  calibrated: boolean;
  status: string;
};

// "42%" once set up; "Sensor reading 612 (not yet set up)" before.
export function soilReadingText(soil: SoilReadingForDisplay, offlineText: string): string {
  if (soil.status !== 'Online') return offlineText;
  if (soil.calibrated) return `${Math.round(soil.value)}%`;
  return `Sensor reading ${Math.round(soil.value)} (${NOT_SET_UP})`;
}

// The farm average, from set-up zones only: a raw number and a percentage
// cannot be averaged together.
export function averageSoilText(soils: SoilReadingForDisplay[]): string {
  const online = soils.filter((s) => s.status === 'Online');
  if (online.length === 0) return 'No reading';
  const set = online.filter((s) => s.calibrated);
  if (set.length === 0) return 'Sensor not set up';
  return `${Math.round(set.reduce((sum, s) => sum + s.value, 0) / set.length)}%`;
}
