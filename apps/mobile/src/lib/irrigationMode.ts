// A zone's watering mode, read and written the same way everywhere in the app. The database
// column zone.irrigation_mode holds 'automatic', 'scheduled' or 'manual' (0010/0047); the API
// reads it the same way (AgroFlow.Business.IrrigationMode.Canonical).
//   automatic  AgroFlow waters when the soil is dry enough
//   scheduled  AgroFlow waters on the zone's regular schedule
//   manual     AgroFlow never waters by itself; only "Water now"
// Anything unrecognised reads as manual, so the app never shows "Automatic" for a zone the
// server would not water automatically.

export type IrrigationMode = 'automatic' | 'scheduled' | 'manual';

export const IRRIGATION_MODES: readonly IrrigationMode[] = ['automatic', 'scheduled', 'manual'];

export function irrigationModeFromDb(value: unknown): IrrigationMode {
  const v = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return v === 'automatic' || v === 'scheduled' ? v : 'manual';
}

// What the API's zone settings route stores for each mode. automation_enabled and
// schedule_enabled follow the mode, so the old flags never disagree with it.
export function irrigationModeToDb(mode: IrrigationMode): {
  irrigationMode: IrrigationMode;
  automationEnabled: boolean;
  scheduleEnabled: boolean;
} {
  return { irrigationMode: mode, automationEnabled: mode === 'automatic', scheduleEnabled: mode === 'scheduled' };
}

export function irrigationModeLabel(mode: IrrigationMode): string {
  return mode === 'automatic' ? 'Automatic' : mode === 'scheduled' ? 'Scheduled' : 'Manual';
}
