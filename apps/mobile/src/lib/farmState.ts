// RET-01 (live web retest, 23 October 2026): Drip said "All your zones look good today" next to
// "no kit connected", "waiting for the first soil reading" and low-confidence advice. Drip and the
// Home summary now say what the real data says, from the kit status (GET .../kits, KitHealth on
// the server) and Today's confidence, in this order:
//
//   fault -> no kit -> no readings -> stale -> low confidence -> normal
//
// "Normal" (all good) needs every zone's kit connected with a fresh soil reading, no kit fault and
// no low-confidence advice. Anything not known (a failed load) is "unknown", never "all good".
import type { KitCard, TodayZone } from '@/services/agroFlowApi';
import type { TranslationKey } from '@/i18n';

export type FarmState = 'unknown' | 'fault' | 'no_kit' | 'no_readings' | 'stale' | 'low_confidence' | 'normal';
export type FarmSummary = { state: FarmState; zoneId?: number; zoneName?: string };

export const FARM_STATE_ORDER: FarmState[] = ['fault', 'no_kit', 'no_readings', 'stale', 'low_confidence', 'normal'];

const soil = (k: KitCard) => k.lines.find(l => l.key === 'soil')?.state;

/** kits / today: null while not loaded or when the load failed. */
export function summariseFarm(kits: KitCard[] | null, today: TodayZone[] | null): FarmSummary {
  if (!kits || kits.length === 0) return { state: 'unknown' };
  const first = (state: FarmState, test: (k: KitCard) => boolean): FarmSummary | null => {
    const k = kits.find(test);
    return k ? { state, zoneId: k.zoneId, zoneName: k.zoneName } : null;
  };
  const kitState =
    // A kit that is connected but has a problem line (probe out of range, sensor error, a command
    // it never confirmed).
    first('fault', k => k.hasKit && k.overall === 'needs_attention')
    ?? first('no_kit', k => !k.hasKit)
    ?? first('no_readings', k => soil(k) === 'none')
    // Not connected, or connected but its readings have stopped.
    ?? first('stale', k => k.overall === 'not_connected' || soil(k) === 'not_reading');
  if (kitState) return kitState;

  // Today's advice: without it the confidence is not known, so not "all good".
  if (!today) return { state: 'unknown' };
  const low = today.find(z => !z.confidence || z.confidence.level === 'low');
  if (low) return { state: 'low_confidence', zoneId: low.zoneId, zoneName: low.name };
  return { state: 'normal' };
}

/** The sentence for Drip and the Home summary, in the farmer's language. */
export function farmStateText(t: (key: TranslationKey, params?: Record<string, string | number>) => string, s: FarmSummary): string {
  return t(`farmState.${s.state}` as TranslationKey, { zone: s.zoneName ?? '' });
}
