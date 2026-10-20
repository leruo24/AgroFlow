// The setup wizard's rules, kept pure so they are tested without screens: which steps there
// are (17, in four sections), which are done, where to resume, the flow-rate maths and the soil
// confidence meter. What the wizard stores on the phone (per farmer) is only what the server
// cannot tell it: that the language was confirmed, that the farmer does not use Telegram, which
// pre-filled answers they confirmed with "Looks right", which steps they put off, and entries
// made without a signal that still need sending. Everything else is the server's own record.

import AsyncStorage from '@react-native-async-storage/async-storage';

export const SETUP_SECTIONS = ['you', 'farm', 'zones', 'alerts'] as const;
export type SetupSection = (typeof SETUP_SECTIONS)[number];

export const SETUP_STEPS = [
  // You
  'welcome', 'password', 'telegram',
  // Your farm
  'location', 'water', 'tank',
  // Each zone
  'crop', 'irrigation', 'soilType', 'size', 'flow', 'soil', 'maxRun',
  // Alerts & help
  'alerts', 'community', 'help', 'done',
] as const;
export type SetupStep = (typeof SETUP_STEPS)[number];

export const STEP_SECTION: Record<SetupStep, SetupSection> = {
  welcome: 'you', password: 'you', telegram: 'you',
  location: 'farm', water: 'farm', tank: 'farm',
  crop: 'zones', irrigation: 'zones', soilType: 'zones', size: 'zones', flow: 'zones', soil: 'zones', maxRun: 'zones',
  alerts: 'alerts', community: 'alerts', help: 'alerts', done: 'alerts',
};

// All 17 count towards "Setup X/17 done"; the last ("All set") is done when the rest are.
export const SETUP_TASKS: readonly SetupStep[] = SETUP_STEPS;

// Every step can be put off ("Do this later") except the language, a forced password change
// and the summary.
export const OPTIONAL_STEPS: readonly SetupStep[] = SETUP_STEPS.filter(s => s !== 'welcome' && s !== 'password' && s !== 'done');

// Steps asked once per zone (one zone per screen, with "Same as Zone 1").
export const ZONE_STEPS: readonly SetupStep[] = ['crop', 'irrigation', 'soilType', 'size', 'flow', 'soil'];

export type WaterSource = 'tank' | 'borehole' | 'municipal' | 'river_dam' | 'other';
export type IrrigationType = 'drip' | 'sprinkler' | 'micro_sprinkler' | 'centre_pivot' | 'surface' | 'hand';
export const IRRIGATION_TYPES: readonly IrrigationType[] = ['drip', 'sprinkler', 'micro_sprinkler', 'centre_pivot', 'surface', 'hand'];
export const WATER_SOURCES: readonly WaterSource[] = ['tank', 'borehole', 'municipal', 'river_dam', 'other'];
export const SOIL_TYPES = ['sandy', 'loam', 'clay'] as const;
export type SoilType = (typeof SOIL_TYPES)[number];
export const TANK_SIZES = [1000, 2500, 5000, 10000] as const;
// "How full is it now?" -> the share logged as the tank's starting level (a 0046 refill).
export const TANK_LEVELS = [
  { key: 'full', fraction: 1 },
  { key: 'threeQuarters', fraction: 0.75 },
  { key: 'half', fraction: 0.5 },
  { key: 'quarter', fraction: 0.25 },
  { key: 'nearlyEmpty', fraction: 0.05 },
] as const;

export type SetupZone = {
  zoneId: number;
  name: string;
  crop: string | null;
  plantingDate: string | null;
  hasFlowRate: boolean;
  hasKit: boolean;
  wetSaved: boolean;
  drySaved: boolean;
  irrigationType?: IrrigationType | null;
  soilType?: string | null;
  areaM2?: number | null;
  maxRunMinutes?: number;
};

export type SetupFarm = {
  latitude: number | null;
  longitude: number | null;
  province: string | null;
  town: string | null;
  location: string | null;
  waterSource: WaterSource | null;
  tankCapacityLitres: number | null;
  tankRemainingLitres: number | null;
};

export const NO_FARM: SetupFarm = {
  latitude: null, longitude: null, province: null, town: null, location: null,
  waterSource: null, tankCapacityLitres: null, tankRemainingLitres: null,
};

export type SetupFacts = {
  languageConfirmed: boolean;
  mustChangePassword: boolean;
  telegramLinked: boolean | null;   // null: not known (offline)
  telegramDeclined: boolean;        // "I don't use Telegram"
  zones: SetupZone[];
  farm?: SetupFarm;
  confirmed?: readonly string[];    // steps (or "soilType:<zoneId>") confirmed with "Looks right"
  locationFlagged?: boolean;        // "Something's wrong — tell my field officer"
};

export function zoneConfirmed(z: SetupZone): boolean {
  return !!z.crop && !!z.plantingDate;
}

export function soilTaught(z: SetupZone): boolean {
  return z.wetSaved && z.drySaved;
}

const confirmedOf = (f: SetupFacts) => f.confirmed ?? [];
export const soilTypeKey = (zoneId: number) => `soilType:${zoneId}`;

export function stepDone(step: SetupStep, f: SetupFacts): boolean {
  const farm = f.farm ?? NO_FARM;
  const ok = (key: string) => confirmedOf(f).includes(key);
  const zones = f.zones;
  switch (step) {
    case 'welcome': return f.languageConfirmed;
    case 'password': return !f.mustChangePassword;
    case 'telegram': return f.telegramLinked === true || f.telegramDeclined;
    case 'location': return ok('location') || f.locationFlagged === true;
    case 'water': return farm.waterSource !== null;
    // No tank: nothing to set here (tank features use the soil and forecast instead).
    case 'tank': return farm.waterSource !== null && farm.waterSource !== 'tank'
      ? true
      : (farm.tankCapacityLitres ?? 0) > 0 && farm.tankRemainingLitres !== null;
    case 'crop': return zones.length > 0 && zones.every(zoneConfirmed);
    case 'irrigation': return zones.length > 0 && zones.every(z => !!z.irrigationType);
    // Soil always has a default (loam), so it counts once the farmer confirmed or changed it.
    case 'soilType': return zones.length > 0 && zones.every(z => ok(soilTypeKey(z.zoneId)));
    case 'size': return zones.length > 0 && zones.every(z => (z.areaM2 ?? 0) > 0);
    case 'flow': return zones.length > 0 && zones.every(z => z.hasFlowRate);
    // Only zones with a kit can be taught; with none yet there is nothing to do here.
    case 'soil': return zones.filter(z => z.hasKit).every(soilTaught);
    case 'maxRun': return ok('maxRun');
    case 'alerts': return ok('alerts');
    case 'community': return ok('community');
    case 'help': return ok('help');
    case 'done': return SETUP_STEPS.filter(s => s !== 'done').every(s => stepDone(s, f));
  }
}

export function doneCount(f: SetupFacts): { done: number; total: number } {
  return { done: SETUP_TASKS.filter(s => stepDone(s, f)).length, total: SETUP_TASKS.length };
}

export function sectionProgress(section: SetupSection, f: SetupFacts): { done: number; total: number } {
  const steps = SETUP_STEPS.filter(s => STEP_SECTION[s] === section);
  return { done: steps.filter(s => stepDone(s, f)).length, total: steps.length };
}

export function setupComplete(f: SetupFacts): boolean {
  return stepDone('done', f);
}

// Where "Continue" opens: the first step not done; the summary when everything is.
export function resumeStep(f: SetupFacts): SetupStep {
  return SETUP_STEPS.find(s => s !== 'done' && !stepDone(s, f)) ?? 'done';
}

// The step after this one. On a first run, steps already done are passed over (a linked
// Telegram is not asked about again, and a farm with no tank skips the tank step); "Redo
// setup" (all = true) visits every step except the tank one on a farm without a tank. The
// summary always ends it.
export function nextStep(current: SetupStep, f: SetupFacts, all = false): SetupStep {
  const i = SETUP_STEPS.indexOf(current);
  const noTank = (f.farm?.waterSource ?? null) !== null && f.farm?.waterSource !== 'tank';
  for (const s of SETUP_STEPS.slice(i + 1)) {
    if (s === 'tank' && noTank) continue;
    if (s === 'done' || all || !stepDone(s, f)) return s;
  }
  return 'done';
}

export function previousStep(current: SetupStep): SetupStep | null {
  const i = SETUP_STEPS.indexOf(current);
  return i > 0 ? SETUP_STEPS[i - 1] : null;
}

// "Step X of 17", and which section it is in.
export function stepNumber(step: SetupStep): { n: number; of: number; section: SetupSection } {
  return { n: SETUP_STEPS.indexOf(step) + 1, of: SETUP_STEPS.length, section: STEP_SECTION[step] };
}

// "Same as Zone 1": the first zone's answer, for the zones after it.
export function sameAsFirst<K extends keyof SetupZone>(zones: SetupZone[], key: K): SetupZone[K] | null {
  const first = zones[0];
  return first && first[key] != null ? first[key] : null;
}

// Tank level from "How full is it now?".
export function tankLitres(capacity: number, fraction: number): number {
  return Math.round(capacity * fraction);
}

// Zone size: square metres, or hectares (1 ha = 10 000 m²).
export function areaToM2(value: number, unit: 'm2' | 'ha'): number | null {
  if (!Number.isFinite(value) || value <= 0) return null;
  return unit === 'ha' ? Math.round(value * 10000) : Math.round(value);
}

// Flow rate from filling a container: litres (or millilitres) in so many seconds.
export type FlowInput = { amount: number; unit: 'L' | 'ml'; seconds: number };
export type FlowResult = { ok: true; litresPerMinute: number } | { ok: false; problem: 'size' | 'time' };

export const MIN_FLOW_SECONDS = 2;

export function flowRateFromContainer({ amount, unit, seconds }: FlowInput): FlowResult {
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, problem: 'size' };
  if (!Number.isFinite(seconds) || seconds <= MIN_FLOW_SECONDS) return { ok: false, problem: 'time' };
  const litres = unit === 'ml' ? amount / 1000 : amount;
  return { ok: true, litresPerMinute: Math.round((litres / seconds) * 60 * 100) / 100 };
}

// How sure the soil readings are: none, one of the two, or both.
export type SoilConfidence = 'low' | 'medium' | 'high';
export function soilConfidence(z: Pick<SetupZone, 'wetSaved' | 'drySaved'>): SoilConfidence {
  const n = (z.wetSaved ? 1 : 0) + (z.drySaved ? 1 : 0);
  return n === 2 ? 'high' : n === 1 ? 'medium' : 'low';
}

// What is kept on the phone.
export type UnsentSetup =
  | { kind: 'flow'; zoneId: number; flowRateLpm: number }
  | { kind: 'crop'; zoneId: number; cropType: string; plantingDate: string | null };

export type SetupLocal = {
  languageConfirmed: boolean;
  telegramDeclined: boolean;
  skipped: SetupStep[];
  unsent: UnsentSetup[];
  confirmed: string[];
  locationFlagged: boolean;
};

export const EMPTY_LOCAL: SetupLocal = {
  languageConfirmed: false, telegramDeclined: false, skipped: [], unsent: [], confirmed: [], locationFlagged: false,
};

export function confirm(local: SetupLocal, key: string): SetupLocal {
  return local.confirmed.includes(key) ? local : { ...local, confirmed: [...local.confirmed, key] };
}

// v2: the 17-step wizard. A v1 record (the 7-step wizard) is read once and carried over.
const key = (userId: string) => `agroflow_setup:v2:${userId}`;
const oldKey = (userId: string) => `agroflow_setup:v1:${userId}`;

export async function loadSetupLocal(userId: string | null | undefined): Promise<SetupLocal> {
  if (!userId) return { ...EMPTY_LOCAL };
  try {
    const raw = (await AsyncStorage.getItem(key(userId))) ?? (await AsyncStorage.getItem(oldKey(userId)));
    return raw ? { ...EMPTY_LOCAL, ...(JSON.parse(raw) as Partial<SetupLocal>) } : { ...EMPTY_LOCAL };
  } catch {
    return { ...EMPTY_LOCAL };
  }
}

export async function saveSetupLocal(userId: string | null | undefined, local: SetupLocal): Promise<void> {
  if (!userId) return;
  try {
    await AsyncStorage.setItem(key(userId), JSON.stringify(local));
  } catch {
    // Kept in memory for this session; the server's facts still drive most steps.
  }
}

// Adds an entry made without a signal, replacing an older one of the same kind and zone.
export function addUnsent(list: UnsentSetup[], entry: UnsentSetup): UnsentSetup[] {
  return [...list.filter(u => !(u.kind === entry.kind && u.zoneId === entry.zoneId)), entry];
}
