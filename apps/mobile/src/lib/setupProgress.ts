// The setup wizard's rules, kept pure so they are tested without screens: which steps there
// are, which are done, where to resume, the flow-rate maths and the soil confidence meter.
// What it stores on the phone (per farmer) is only what the server cannot tell it: that the
// language was confirmed, that the farmer does not use Telegram, which steps they put off, and
// entries made without a signal that still need sending.

import AsyncStorage from '@react-native-async-storage/async-storage';

export const SETUP_STEPS = ['welcome', 'password', 'telegram', 'zones', 'flow', 'soil', 'done'] as const;
export type SetupStep = (typeof SETUP_STEPS)[number];

// The six that count towards "Setup 4/6 done". 'done' is the summary.
export const SETUP_TASKS: readonly SetupStep[] = ['welcome', 'password', 'telegram', 'zones', 'flow', 'soil'];

// Steps the farmer may put off ("Do this later"). Welcome is one tap, and a forced password
// change cannot be put off.
export const OPTIONAL_STEPS: readonly SetupStep[] = ['telegram', 'zones', 'flow', 'soil'];

export type SetupZone = {
  zoneId: number;
  name: string;
  crop: string | null;
  plantingDate: string | null;
  hasFlowRate: boolean;
  hasKit: boolean;
  wetSaved: boolean;
  drySaved: boolean;
};

export type SetupFacts = {
  languageConfirmed: boolean;
  mustChangePassword: boolean;
  telegramLinked: boolean | null;   // null: not known (offline)
  telegramDeclined: boolean;        // "I don't use Telegram"
  zones: SetupZone[];
};

export function zoneConfirmed(z: SetupZone): boolean {
  return !!z.crop && !!z.plantingDate;
}

export function soilTaught(z: SetupZone): boolean {
  return z.wetSaved && z.drySaved;
}

export function stepDone(step: SetupStep, f: SetupFacts): boolean {
  switch (step) {
    case 'welcome': return f.languageConfirmed;
    case 'password': return !f.mustChangePassword;
    case 'telegram': return f.telegramLinked === true || f.telegramDeclined;
    case 'zones': return f.zones.length > 0 && f.zones.every(zoneConfirmed);
    case 'flow': return f.zones.length > 0 && f.zones.every(z => z.hasFlowRate);
    // Only zones with a kit can be taught; with none yet there is nothing to do here.
    case 'soil': return f.zones.filter(z => z.hasKit).every(soilTaught);
    case 'done': return SETUP_TASKS.every(s => stepDone(s, f));
  }
}

export function doneCount(f: SetupFacts): { done: number; total: number } {
  return { done: SETUP_TASKS.filter(s => stepDone(s, f)).length, total: SETUP_TASKS.length };
}

export function setupComplete(f: SetupFacts): boolean {
  return SETUP_TASKS.every(s => stepDone(s, f));
}

// Where "Continue" opens: the first step not done; the summary when everything is.
export function resumeStep(f: SetupFacts): SetupStep {
  return SETUP_TASKS.find(s => !stepDone(s, f)) ?? 'done';
}

// The step after this one. On a first run, steps already done are passed over (a linked
// Telegram is not asked about again); "Redo setup" (all = true) visits every step. The
// summary always ends it.
export function nextStep(current: SetupStep, f: SetupFacts, all = false): SetupStep {
  const i = SETUP_STEPS.indexOf(current);
  for (const s of SETUP_STEPS.slice(i + 1)) {
    if (s === 'done' || all || !stepDone(s, f)) return s;
  }
  return 'done';
}

export function previousStep(current: SetupStep): SetupStep | null {
  const i = SETUP_STEPS.indexOf(current);
  return i > 0 ? SETUP_STEPS[i - 1] : null;
}

// "Step X of Y" counts the six tasks; the summary is shown as the last step.
export function stepNumber(step: SetupStep): { n: number; of: number } {
  return { n: SETUP_STEPS.indexOf(step) + 1, of: SETUP_STEPS.length };
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
};

export const EMPTY_LOCAL: SetupLocal = { languageConfirmed: false, telegramDeclined: false, skipped: [], unsent: [] };

const key = (userId: string) => `agroflow_setup:v1:${userId}`;

export async function loadSetupLocal(userId: string | null | undefined): Promise<SetupLocal> {
  if (!userId) return { ...EMPTY_LOCAL };
  try {
    const raw = await AsyncStorage.getItem(key(userId));
    return raw ? { ...EMPTY_LOCAL, ...(JSON.parse(raw) as Partial<SetupLocal>) } : { ...EMPTY_LOCAL };
  } catch {
    return { ...EMPTY_LOCAL };
  }
}

export async function saveSetupLocal(userId: string | null | undefined, local: SetupLocal): Promise<void> {
  if (!userId) return;
  try {
    await AsyncStorage.setItem(key(userId), JSON.stringify(local));
  } catch { /* kept in memory for this visit */ }
}

// The same entry twice (say, measured again) keeps only the newest.
export function addUnsent(list: UnsentSetup[], entry: UnsentSetup): UnsentSetup[] {
  return [...list.filter(e => !(e.kind === entry.kind && e.zoneId === entry.zoneId)), entry];
}
