// The farmer's four tasks (B3-02): Your preferences / Your farm / Your water / Your crops, each a
// few short screens. Installer work (flow, wet/dry calibration, kit linking, run limit, the test
// start/stop) is not here: it is on the installer's checklist, and the farmer only sees it as
// "Your installer will complete this". Pure, so the order and the URL mapping are tested directly.
import type { FarmerTaskKey } from '@/services/agroFlowApi';

export const FARMER_TASKS: readonly FarmerTaskKey[] = ['preferences', 'farm', 'water', 'crops'];

export type ScreenKey =
  | 'language' | 'password' | 'terms' | 'telegram' | 'alerts' | 'community' | 'help'
  | 'location'
  | 'water' | 'tank'
  | 'crop' | 'irrigation' | 'soilType' | 'size' | 'installer';

export const TASK_SCREENS: Record<FarmerTaskKey, readonly ScreenKey[]> = {
  preferences: ['language', 'password', 'terms', 'telegram', 'alerts', 'community', 'help'],
  farm: ['location'],
  water: ['water', 'tank'],
  crops: ['crop', 'irrigation', 'soilType', 'size', 'installer'],
};

export function isTask(value: unknown): value is FarmerTaskKey {
  return typeof value === 'string' && (FARMER_TASKS as readonly string[]).includes(value);
}

export function taskOf(screen: ScreenKey): FarmerTaskKey {
  return FARMER_TASKS.find(t => TASK_SCREENS[t].includes(screen))!;
}

// What decides which screens a farmer sees: the password screen only while the temporary one is
// in use; the tank only when the water comes from a tank (or the source is not chosen yet).
export type ScreenFacts = { mustChangePassword: boolean; waterSource: string | null };

export function screensFor(task: FarmerTaskKey, f: ScreenFacts): ScreenKey[] {
  return TASK_SCREENS[task].filter(s =>
    s === 'password' ? f.mustChangePassword
    : s === 'tank' ? f.waterSource === null || f.waterSource === 'tank'
    : true);
}

// The 17-step wizard's links (/setup?step=alerts from Settings, ?step=soil from a zone) keep
// working: each old step opens the screen that now holds it. Installer steps open the installer
// screen of Your crops, which says who completes them.
const OLD_STEPS: Record<string, ScreenKey> = {
  welcome: 'language', password: 'password', telegram: 'telegram',
  location: 'location', water: 'water', tank: 'tank',
  crop: 'crop', irrigation: 'irrigation', soilType: 'soilType', size: 'size',
  flow: 'installer', soil: 'installer', maxRun: 'installer',
  alerts: 'alerts', community: 'community', help: 'help',
};

export function screenFromParam(value: unknown): ScreenKey | null {
  if (typeof value !== 'string') return null;
  if ((Object.values(TASK_SCREENS).flat() as string[]).includes(value)) return value as ScreenKey;
  return OLD_STEPS[value] ?? null;
}

// The first task not done, in order; null when all four are done.
export function nextTask(done: readonly FarmerTaskKey[]): FarmerTaskKey | null {
  return FARMER_TASKS.find(t => !done.includes(t)) ?? null;
}

export function nextScreen(task: FarmerTaskKey, screen: ScreenKey, f: ScreenFacts): ScreenKey | null {
  const list = screensFor(task, f);
  const i = list.indexOf(screen);
  return i >= 0 && i < list.length - 1 ? list[i + 1] : null;
}

export function previousScreen(task: FarmerTaskKey, screen: ScreenKey, f: ScreenFacts): ScreenKey | null {
  const list = screensFor(task, f);
  const i = list.indexOf(screen);
  return i > 0 ? list[i - 1] : null;
}

// Where Back goes from a screen. Opened from Settings (AF-08), Back from the screen it opened on
// returns to Settings, never to unrelated earlier steps.
export function backTarget(task: FarmerTaskKey, screen: ScreenKey, f: ScreenFacts, from: string | null, openedAt: ScreenKey | null):
  { kind: 'screen'; screen: ScreenKey } | { kind: 'settings' } | { kind: 'hub' } {
  if (from === 'settings' && screen === openedAt) return { kind: 'settings' };
  const prev = previousScreen(task, screen, f);
  return prev ? { kind: 'screen', screen: prev } : from === 'settings' ? { kind: 'settings' } : { kind: 'hub' };
}
