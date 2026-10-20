// A zone's maximum run time (zone.max_run_minutes, migration 0052): the longest single pump
// run, 1 to 120 minutes, set by AgroFlow staff, 5 by default. The server refuses a longer
// Water now and the kit stops every run there (docs/irrigate-path.md). The server's twin is
// IrrigationRunRules (backend/AgroFlow.Domain/IrrigationRunRules.cs).

export const DEFAULT_MAX_RUN_MINUTES = 5;
export const LOWEST_MAX_RUN_MINUTES = 1;
export const HIGHEST_MAX_RUN_MINUTES = 120;

/** The zone's maximum, or 5 when it is missing or out of range (never "no limit"). */
export function zoneMaxRunMinutes(value: unknown): number {
  const n = Number(value);
  return Number.isInteger(n) && n >= LOWEST_MAX_RUN_MINUTES && n <= HIGHEST_MAX_RUN_MINUTES
    ? n
    : DEFAULT_MAX_RUN_MINUTES;
}

/** Where the duration box starts: 5 minutes, or less when the zone's maximum is lower. */
export function defaultRunMinutes(maxRunMinutes: number): number {
  return Math.min(DEFAULT_MAX_RUN_MINUTES, maxRunMinutes);
}

/** True when today's advice is longer than one run can be, so the card says so. */
export function adviceOverLimit(recommendedMinutes: number | null | undefined, maxRunMinutes: number | null | undefined): boolean {
  return typeof recommendedMinutes === 'number' && recommendedMinutes > zoneMaxRunMinutes(maxRunMinutes);
}
