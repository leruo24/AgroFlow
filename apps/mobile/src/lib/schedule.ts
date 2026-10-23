// A zone's saved schedule as the farmer should read it (AF-05):
//   active    the zone is in Scheduled mode and the schedule is complete and switched on
//   inactive  a schedule is saved, but the zone is not watering by it (another mode, or off)
//   default   nothing saved yet; the editor's values are only suggestions
// and how long each run of it really is: capped at the zone's maximum run time, the same cap the
// API and the database apply ("Capped to 5 min (this zone's limit)"). The server's twin is
// IrrigationRunRules.EffectiveScheduleMinutes.
import { zoneMaxRunMinutes } from '@/lib/runLimit';
import type { IrrigationMode } from '@/lib/irrigationMode';

export type ScheduleState = 'active' | 'inactive' | 'default';

export type SavedSchedule = { enabled: boolean; days: string[]; startTime: string; durationMinutes: number };

export function scheduleState(mode: IrrigationMode, s: SavedSchedule): ScheduleState {
  const saved = s.durationMinutes > 0 && !!s.startTime;
  if (!saved) return 'default';
  return mode === 'scheduled' && s.enabled && s.days.length > 0 ? 'active' : 'inactive';
}

export function effectiveRunMinutes(minutes: number, maxRunMinutes: unknown): { minutes: number; capped: boolean; max: number } {
  const max = zoneMaxRunMinutes(maxRunMinutes);
  return minutes > max ? { minutes: max, capped: true, max } : { minutes, capped: false, max };
}
