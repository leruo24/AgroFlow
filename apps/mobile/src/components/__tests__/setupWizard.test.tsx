/// <reference types="jest" />
// See services/__tests__/doubleSubmit.test.ts for why this reference is per file.

/* Setup. The four farmer tasks (Your preferences / Your farm / Your water / Your crops) that
 * replaced the 17-step wizard (B3-02): Save and continue saves first and moves on once, a failed
 * save keeps the input and stays, a double press saves once, Back keeps values, the URL follows
 * the screen, Settings links return to Settings (AF-08), "I don't know – help me", the draft
 * terms, and Home's "Where you are now". The older rules in lib/setupProgress.ts (still behind
 * the pre-0058 Home card) keep their own tests. */

import type { ReactNode } from 'react';

jest.mock('@/context/ThemeContext', () => {
  const { lightColors } = jest.requireActual('@/constants/colors');
  return { useTheme: () => ({ colors: lightColors }) };
});
jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual('react-native');
  return {
    SafeAreaView: ({ children }: { children: ReactNode }) => <View>{children}</View>,
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  };
});
jest.mock('@/lib/supabase', () => ({ supabase: { auth: { updateUser: jest.fn(async () => ({ error: null })) } } }));
jest.mock('lucide-react-native', () =>
  new Proxy({}, { get: (_target, name) => (name === '__esModule' ? false : () => null) })
);
jest.mock('react-native-svg', () => {
  const { View } = jest.requireActual('react-native');
  return new Proxy({}, { get: (_t, name) => (name === '__esModule' ? true : View) });
});
jest.mock('@/components/FarmMapSurface', () => {
  const { View } = jest.requireActual('react-native');
  return { __esModule: true, default: () => <View testID="farm-map" /> };
});
const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockSetParams = jest.fn();
jest.mock('@/lib/router', () => ({
  router: { push: (...a: unknown[]) => mockPush(...a), replace: (...a: unknown[]) => mockReplace(...a), back: jest.fn(), canGoBack: () => false, navigate: jest.fn(),
    setParams: (...a: unknown[]) => mockSetParams(...a) },
}));
let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({ useLocalSearchParams: () => mockParams, useFocusEffect: () => undefined }));

let mockAuth: Record<string, unknown> = {};
jest.mock('@/context/AuthContext', () => ({ useAuth: () => mockAuth }));
let mockAgro: Record<string, unknown> = {};
jest.mock('@/context/AgroFlowContext', () => ({ useAgroFlow: () => mockAgro }));
jest.mock('@/components/TelegramSection', () => ({ TelegramSection: () => null }));
jest.mock('@/services/agroFlowApi', () => ({
  DEFAULT_PREFERENCES: {
    wateringTelegram: true, lowTankTelegram: true, droughtTelegram: true, communityTelegram: true, weatherTelegram: true,
    communityOptIn: true, quietStart: null, quietEnd: null,
  },
  fetchFarmToday: jest.fn(),
  fetchFarmSetup: jest.fn(),
  fetchTelegramLinkStatus: jest.fn(),
  fetchNotificationPreferences: jest.fn(),
  saveNotificationPreferences: jest.fn(() => Promise.resolve({ message: 'Saved.' })),
  changeZoneCrop: jest.fn(() => Promise.resolve({ message: 'Saved.' })),
  saveZoneSetup: jest.fn(() => Promise.resolve({ message: 'Saved.' })),
  saveZoneSoilType: jest.fn(() => Promise.resolve({ message: 'Saved.' })),
  saveZoneCalibration: jest.fn(() => Promise.resolve({ message: 'Dry reading saved.', reading: 3900 })),
  saveWaterSource: jest.fn(() => Promise.resolve({ message: 'Saved.' })),
  saveIrrigationType: jest.fn(() => Promise.resolve({ message: 'Saved.', explanation: 'With drip about 90% of the water reaches the roots.' })),
  saveTankCapacity: jest.fn(() => Promise.resolve({})),
  logTankRefill: jest.fn(() => Promise.resolve({})),
  reportLocationProblem: jest.fn(() => Promise.resolve({ message: 'Your field officer has been told.' })),
  fetchJourney: jest.fn(),
  finishFarmerTask: jest.fn(),
  askForHelp: jest.fn(),
  acceptTerms: jest.fn(() => Promise.resolve({ accepted: true })),
  ApiHttpError: class MockApiHttpError extends Error { mockStatus = 0; },
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as api from '@/services/agroFlowApi';
import SetupScreen from '@/app/setup';
import { SetupCard } from '@/components/SetupCard';
import { resetLanguageForTests, getLanguage } from '@/i18n';
import {
  NO_FARM,
  SETUP_SECTIONS,
  SETUP_STEPS,
  areaToM2,
  doneCount,
  flowRateFromContainer,
  nextStep,
  resumeStep,
  sameAsFirst,
  sectionProgress,
  setupComplete,
  soilConfidence,
  soilTypeKey,
  stepDone,
  stepNumber,
  tankLitres,
  type SetupFacts,
  type SetupFarm,
  type SetupZone,
} from '@/lib/setupProgress';

const zoneA: SetupZone = { zoneId: 7, name: 'Bed 1', crop: null, plantingDate: null, hasFlowRate: false, hasKit: true, wetSaved: false, drySaved: false };
const tankFarm: SetupFarm = { ...NO_FARM, latitude: -25.86522, longitude: 25.64421, province: 'North West', town: 'Mahikeng', waterSource: 'tank', tankCapacityLitres: 5000, tankRemainingLitres: 2500 };
const facts = (over: Partial<SetupFacts> = {}): SetupFacts => ({
  languageConfirmed: false, mustChangePassword: false, telegramLinked: false, telegramDeclined: false, zones: [zoneA], farm: NO_FARM, confirmed: [], ...over,
});
const fullZone = (z: SetupZone): SetupZone => ({ ...z, crop: 'tomato', plantingDate: '2026-09-01', hasFlowRate: true, wetSaved: true, drySaved: true, irrigationType: 'drip', soilType: 'loam', areaM2: 50, maxRunMinutes: 5 });
const finished = facts({
  languageConfirmed: true, telegramLinked: true, farm: tankFarm,
  zones: [fullZone(zoneA)],
  confirmed: ['location', soilTypeKey(7), 'maxRun', 'alerts', 'community', 'help'],
});

describe('setup rules', () => {
  it('has 17 steps in four sections, in this order', () => {
    expect(SETUP_STEPS).toEqual(['welcome', 'password', 'telegram', 'location', 'water', 'tank', 'crop', 'irrigation',
      'soilType', 'size', 'flow', 'soil', 'maxRun', 'alerts', 'community', 'help', 'done']);
    expect(SETUP_SECTIONS).toEqual(['you', 'farm', 'zones', 'alerts']);
    expect(stepNumber('welcome')).toEqual({ n: 1, of: 17, section: 'you' });
    expect(stepNumber('location')).toEqual({ n: 4, of: 17, section: 'farm' });
    expect(stepNumber('maxRun')).toEqual({ n: 13, of: 17, section: 'zones' });
    expect(stepNumber('done')).toEqual({ n: 17, of: 17, section: 'alerts' });
    expect(doneCount(facts())).toEqual({ done: 1, total: 17 });       // only the password
    expect(doneCount(finished)).toEqual({ done: 17, total: 17 });
    expect(setupComplete(finished)).toBe(true);
    expect(sectionProgress('farm', finished)).toEqual({ done: 3, total: 3 });
    expect(sectionProgress('zones', facts())).toEqual({ done: 0, total: 7 });
  });

  it('resumes at the first step not done', () => {
    expect(resumeStep(facts())).toBe('welcome');
    expect(resumeStep(facts({ languageConfirmed: true }))).toBe('telegram');
    expect(resumeStep(facts({ languageConfirmed: true, mustChangePassword: true }))).toBe('password');
    expect(resumeStep(facts({ languageConfirmed: true, telegramDeclined: true }))).toBe('location');
    expect(resumeStep(facts({ languageConfirmed: true, telegramDeclined: true, locationFlagged: true }))).toBe('water');
    expect(resumeStep(finished)).toBe('done');
  });

  it('moves on past steps already done, but Redo visits every step', () => {
    const f = facts({ languageConfirmed: true, telegramLinked: true });
    expect(nextStep('welcome', f)).toBe('location');           // password and Telegram already done
    expect(nextStep('welcome', f, true)).toBe('password');     // Redo setup
    expect(nextStep('help', f)).toBe('done');
  });

  it('a farm without a tank never sees the tank step', () => {
    const borehole = facts({ farm: { ...NO_FARM, waterSource: 'borehole' } });
    expect(stepDone('tank', borehole)).toBe(true);
    expect(nextStep('water', borehole)).toBe('crop');
    expect(nextStep('water', borehole, true)).toBe('crop');    // not even on Redo
    expect(nextStep('water', facts({ farm: { ...NO_FARM, waterSource: 'tank' } }))).toBe('tank');
    // A tank needs its size and a level to count.
    expect(stepDone('tank', facts({ farm: { ...NO_FARM, waterSource: 'tank', tankCapacityLitres: 5000 } }))).toBe(false);
  });

  it('the location counts when confirmed or reported as wrong; soil type when confirmed per zone', () => {
    expect(stepDone('location', facts())).toBe(false);
    expect(stepDone('location', facts({ confirmed: ['location'] }))).toBe(true);
    expect(stepDone('location', facts({ locationFlagged: true }))).toBe(true);
    const two = [{ ...zoneA, soilType: 'loam' }, { ...zoneA, zoneId: 8, name: 'Bed 2', soilType: 'loam' }];
    expect(stepDone('soilType', facts({ zones: two, confirmed: [soilTypeKey(7)] }))).toBe(false);
    expect(stepDone('soilType', facts({ zones: two, confirmed: [soilTypeKey(7), soilTypeKey(8)] }))).toBe(true);
  });

  it('"Same as Zone 1", tank litres and zone sizes', () => {
    expect(sameAsFirst([{ ...zoneA, irrigationType: 'drip' }, zoneA], 'irrigationType')).toBe('drip');
    expect(sameAsFirst([zoneA], 'irrigationType')).toBeNull();
    expect(tankLitres(5000, 0.5)).toBe(2500);
    expect(tankLitres(2500, 0.05)).toBe(125);
    expect(areaToM2(0.25, 'ha')).toBe(2500);
    expect(areaToM2(40, 'm2')).toBe(40);
    expect(areaToM2(0, 'm2')).toBeNull();
    expect(areaToM2(NaN, 'ha')).toBeNull();
  });

  it('works out litres a minute: 5 L in 60 s is 5 L/min', () => {
    expect(flowRateFromContainer({ amount: 5, unit: 'L', seconds: 60 })).toEqual({ ok: true, litresPerMinute: 5 });
    expect(flowRateFromContainer({ amount: 500, unit: 'ml', seconds: 30 })).toEqual({ ok: true, litresPerMinute: 1 });
    expect(flowRateFromContainer({ amount: 0, unit: 'L', seconds: 60 })).toEqual({ ok: false, problem: 'size' });
    expect(flowRateFromContainer({ amount: 5, unit: 'L', seconds: 2 })).toEqual({ ok: false, problem: 'time' });
  });

  it('shows how sure the soil readings are: low, medium, high', () => {
    expect(soilConfidence({ wetSaved: false, drySaved: false })).toBe('low');
    expect(soilConfidence({ wetSaved: false, drySaved: true })).toBe('medium');
    expect(soilConfidence({ wetSaved: true, drySaved: true })).toBe('high');
  });
});

type Row = { id: string; name: string; crop: string; plantingDate: string | null; wet: boolean; dry: boolean };
const bed = (over: Partial<Row> = {}): Row => ({ id: '7', name: 'Bed 1', crop: 'Not configured', plantingDate: null, wet: false, dry: false, ...over });

function agro(rows: Row[] = [bed()]) {
  return {
    farm: { id: '1', name: 'Nkosi Farm' },
    zones: rows.map(r => ({ id: r.id, name: r.name, crop: r.crop, plantingDate: r.plantingDate, maxRunMinutes: 8,
      sensors: { soilMoisture: { wetSaved: r.wet, drySaved: r.dry } } })),
    refreshZones: jest.fn(),
  };
}

type ServerZone = api.FarmSetup['zones'][number];
const serverZone = (over: Partial<ServerZone> = {}): ServerZone => ({
  zoneId: 7, name: 'Bed 1', crop: null, plantingDate: null, soilType: 'loam', areaM2: null, flowRateLpm: null, irrigationType: null, maxRunMinutes: 8, ...over,
});
function farmSetup(over: { waterSource?: string | null; zones?: ServerZone[]; tank?: api.FarmSetup['tank'] } = {}): api.FarmSetup {
  return {
    farmId: 1,
    farm: { name: 'Nkosi Farm', location: 'Mahikeng', latitude: -25.86522, longitude: 25.64421, province: 'North West', town: 'Mahikeng', waterSource: over.waterSource === undefined ? null : over.waterSource },
    zones: over.zones ?? [serverZone()],
    tank: over.tank ?? null,
  };
}

const todayZone = (zoneId: number, name: string, setup: Record<string, boolean> = {}) => ({
  zoneId, name, action: { kind: 'water', text: `Water ${name} about 8 min this morning` }, why: null,
  confidence: null, confidenceExplanation: null, nextStep: null,
  setup: { crop: false, plantingDate: false, soil: true, area: true, flowRate: false, calibrated: false, hasKit: true, ...setup },
});

function serve(setup: api.FarmSetup, today = [todayZone(7, 'Bed 1')], linked = false) {
  (api.fetchFarmSetup as jest.Mock).mockResolvedValue(setup);
  (api.fetchFarmToday as jest.Mock).mockResolvedValue({ farmId: 1, day: '2026-10-20', zones: today });
  (api.fetchTelegramLinkStatus as jest.Mock).mockResolvedValue({ linked, alertsEnabled: true });
  (api.fetchJourney as jest.Mock).mockResolvedValue(journey());
}

// How many text boxes are on screen (the location and maximum run time steps have none).
function inputCount(): number {
  const walk = (n: unknown): number => {
    if (!n || typeof n !== 'object') return 0;
    if (Array.isArray(n)) return n.reduce((s: number, c) => s + walk(c), 0);
    const node = n as { type?: string; children?: unknown };
    return (node.type === 'TextInput' ? 1 : 0) + walk(node.children);
  };
  return walk(screen.toJSON());
}

const KEY = 'agroflow_setup:v2:farmer-1';
const readLocal = async () => JSON.parse((await AsyncStorage.getItem(KEY)) ?? '{}');

beforeAll(async () => {
  serve(farmSetup());
  (api.fetchNotificationPreferences as jest.Mock).mockResolvedValue({ ...api.DEFAULT_PREFERENCES });
  mockAuth = { user: { id: 'farmer-1' }, mustChangePassword: false, clearMustChangePassword: jest.fn() };
  mockAgro = agro();
  await render(<SetupScreen />);   // warm the renderer outside the 5 s limit
}, 60000);

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  resetLanguageForTests();
  mockParams = {};
  mockAuth = { user: { id: 'farmer-1' }, mustChangePassword: false, clearMustChangePassword: jest.fn(async () => {}) };
  mockAgro = agro();
  serve(farmSetup());
  (api.fetchNotificationPreferences as jest.Mock).mockResolvedValue({ ...api.DEFAULT_PREFERENCES });
});


// ---------------------------------------------------------------------------------------------
// The four tasks (B3-02, AF-08). The server's journey is faked; every save is a mock.
// ---------------------------------------------------------------------------------------------

function journey(over: { done?: string[]; stage?: string; accepted?: boolean; termsOpen?: boolean } = {}): api.Journey {
  const done = over.done ?? ['preferences'];
  return {
    farmId: 1,
    setupProgress: { done: done.length, total: 4, label: `Your details: ${done.length} of 4`,
      tasks: (['preferences', 'farm', 'water', 'crops'] as const).map(key => ({ key, done: done.includes(key), doneAt: done.includes(key) ? '2026-10-23T08:00:00Z' : null })) },
    installation: { stage: (over.stage ?? 'account_active') as api.JourneyStage, label: 'Account active', text: 'Installation: not booked yet', live: false },
    whereYouAreNow: { stage: (over.stage ?? 'account_active') as api.JourneyStage, stageLabel: 'Account active', stageNumber: 4, stageCount: 8, steps: [], done: [], stillToDo: [],
      nextAction: 'Finish your details', whoActsNext: 'you', whoActsNextLabel: 'You', knownDate: null, dateLabel: 'Whenever you are ready' },
    zones: [{ zoneId: 7, name: 'Bed 1', commissionState: 'pending', commissionedAt: null, irrigationMode: 'manual', offerAutomatic: false, autoOfferAnswer: null,
      installerChecks: [
        { item: 'kit_linked', label: 'Kit linked', done: true, required: true, whoCompletes: 'installer', doneBy: 'Thabo', doneAt: '2026-10-22T08:00:00Z', provenance: 'confirmed', value: null },
        { item: 'flow_measured', label: 'Flow measured', done: false, required: true, whoCompletes: 'installer', doneBy: null, doneAt: null, provenance: null, value: null },
      ] }],
    helpRequests: [],
    terms: {
      acceptanceEnabled: over.termsOpen ?? false,
      accepted: { all: over.accepted ?? false, termsAcceptedAt: null, privacyAcceptedAt: null },
      // Approved versions only exist once acceptance is open (a draft is never accepted, RET-02).
      documents: over.termsOpen ? [
        { key: 'terms', title: 'Terms of service', version: '1.0', date: '2026-11-01', status: 'approved', statusLabel: 'Approved', url: 'x' },
        { key: 'privacy', title: 'Privacy notice', version: '1.0', date: '2026-11-01', status: 'approved', statusLabel: 'Approved', url: 'x' },
      ] : [
        { key: 'terms', title: 'Terms of service', version: '0.1-draft', date: '2026-10-23', status: 'draft', statusLabel: 'Draft – needs approval', url: 'x' },
        { key: 'privacy', title: 'Privacy notice', version: '0.1-draft', date: '2026-10-23', status: 'draft', statusLabel: 'Draft – needs approval', url: 'x' },
      ],
    },
  };
}

const save = () => screen.getByTestId('setup-save');
const deferred = <V,>() => { let resolve!: (v: V) => void, reject!: (e: unknown) => void; const promise = new Promise<V>((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };

describe('the four tasks', () => {
  beforeEach(() => {
    (api.fetchJourney as jest.Mock).mockResolvedValue(journey());
    (api.finishFarmerTask as jest.Mock).mockImplementation(async (_f: string, task: string) => journey({ done: ['preferences', task] }));
  });

  it('the hub shows "Your details: X of 4" and "Installation: <stage>" separately, and continues with the next task', async () => {
    await render(<SetupScreen />);
    expect(await screen.findByText('Your details: 1 of 4')).toBeTruthy();
    expect(screen.getByTestId('setup-installation')).toHaveTextContent('Installation: account active');
    await fireEvent.press(screen.getByTestId('setup-next-task'));
    expect(await screen.findByTestId('setup-screen-location')).toBeTruthy();
    // The URL says which screen is shown.
    expect(mockSetParams).toHaveBeenLastCalledWith({ task: 'farm', screen: 'location', step: undefined });
  });

  it('Save and continue saves first and moves on once; a borehole skips the tank and finishes the task on the server', async () => {
    mockParams = { task: 'water', screen: 'water' };
    await render(<SetupScreen />);
    await screen.findByTestId('setup-screen-water');
    // Nothing chosen: stays, and says why.
    await act(async () => { fireEvent.press(save()); });
    expect(await screen.findByTestId('setup-error')).toBeTruthy();
    expect(api.saveWaterSource).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('setup-water-borehole'));
    await act(async () => { fireEvent.press(save()); });
    await waitFor(() => expect(api.finishFarmerTask).toHaveBeenCalledWith('1', 'water'));
    expect(api.saveWaterSource).toHaveBeenCalledTimes(1);
    expect(api.saveWaterSource).toHaveBeenCalledWith('1', 'borehole');
    expect(await screen.findByTestId('setup-hub')).toBeTruthy();
  });

  it('a failed save keeps the choice and stays; a second press while saving does nothing', async () => {
    mockParams = { task: 'water', screen: 'water' };
    const pending = deferred<{ message: string }>();
    (api.saveWaterSource as jest.Mock).mockReturnValueOnce(pending.promise);
    await render(<SetupScreen />);
    await fireEvent.press(await screen.findByTestId('setup-water-tank'));
    await act(async () => { fireEvent.press(save()); fireEvent.press(save()); });
    expect(api.saveWaterSource).toHaveBeenCalledTimes(1);
    await act(async () => { pending.reject(new Error('The server is busy.')); });
    expect(await screen.findByText('The server is busy.')).toBeTruthy();
    expect(screen.getByTestId('setup-screen-water')).toBeTruthy();
    expect(screen.getByTestId('setup-water-tank').props.accessibilityState).toMatchObject({ checked: true });
    expect(api.finishFarmerTask).not.toHaveBeenCalled();
  });

  it('Back keeps what was chosen', async () => {
    mockParams = { task: 'crops', screen: 'crop' };
    await render(<SetupScreen />);
    await fireEvent.press(await screen.findByTestId('setup-crop-7-maize'));
    await fireEvent.press(screen.getByTestId('setup-planted-7-2'));
    await act(async () => { fireEvent.press(save()); });
    expect(await screen.findByTestId('setup-screen-irrigation')).toBeTruthy();
    expect(api.changeZoneCrop).toHaveBeenCalledWith(7, expect.objectContaining({ cropType: 'maize' }));
    await fireEvent.press(screen.getByTestId('setup-back'));
    expect(await screen.findByTestId('setup-screen-crop')).toBeTruthy();
    expect(screen.getByTestId('setup-crop-7-maize').props.accessibilityState).toMatchObject({ checked: true });
  });

  it('"I don\'t know – help me" sends a follow-up and lets the farmer carry on without the answer', async () => {
    mockParams = { task: 'water', screen: 'tank' };
    (api.askForHelp as jest.Mock).mockResolvedValue({ id: 3, topic: 'tank_capacity', status: 'open', assigned: true, message: 'Sent. AgroFlow staff will help you with this; you can carry on.' });
    await render(<SetupScreen />);
    await fireEvent.press(await screen.findByTestId('setup-help-tank'));
    expect(await screen.findByText('Sent. AgroFlow staff will help you with this; you can carry on.')).toBeTruthy();
    expect(api.askForHelp).toHaveBeenCalledWith('1', 'tank_capacity', undefined);
    await act(async () => { fireEvent.press(save()); });
    await waitFor(() => expect(api.finishFarmerTask).toHaveBeenCalledWith('1', 'water'));
    expect(api.saveTankCapacity).not.toHaveBeenCalled();
  });

  it('RET-02: while acceptance is off, Before you start shows a preview with no box, and nothing is recorded', async () => {
    mockParams = { task: 'preferences', screen: 'terms' };
    await render(<SetupScreen />);
    expect(await screen.findByText('Before you start')).toBeTruthy();
    expect(screen.getByTestId('terms-status-terms')).toHaveTextContent(/Preview – not yet in effect/);
    expect(screen.getByTestId('terms-status-privacy')).toHaveTextContent(/Preview – not yet in effect/);
    expect(screen.getByTestId('terms-open-terms')).toBeTruthy();   // the documents can still be read
    expect(screen.queryByTestId('terms-checkbox')).toBeNull();
    expect(screen.getByTestId('terms-preview')).toHaveTextContent(/You do not need to accept anything now/);
    await act(async () => { fireEvent.press(save()); });
    expect(await screen.findByTestId('setup-screen-telegram')).toBeTruthy();
    expect(api.acceptTerms).not.toHaveBeenCalled();
  });

  it('an older server that does not say acceptance is open is treated as a preview, never an acceptance of a draft', async () => {
    const old = journey();
    delete (old.terms as { acceptanceEnabled?: boolean }).acceptanceEnabled;
    (api.fetchJourney as jest.Mock).mockResolvedValue(old);
    mockParams = { task: 'preferences', screen: 'terms' };
    await render(<SetupScreen />);
    expect(await screen.findByTestId('terms-preview')).toBeTruthy();
    expect(screen.queryByTestId('terms-checkbox')).toBeNull();
  });

  it('Before you start, once approved and switched on: the box starts unticked; acceptance is recorded only by the server', async () => {
    (api.fetchJourney as jest.Mock).mockResolvedValue(journey({ termsOpen: true }));
    mockParams = { task: 'preferences', screen: 'terms' };
    const pending = deferred<unknown>();
    (api.acceptTerms as jest.Mock).mockReturnValueOnce(pending.promise);
    await render(<SetupScreen />);
    expect(await screen.findByText('Before you start')).toBeTruthy();
    expect(screen.queryByText(/Preview – not yet in effect/)).toBeNull();
    expect(screen.getByTestId('terms-checkbox').props.accessibilityState).toMatchObject({ checked: false });
    await act(async () => { fireEvent.press(save()); });
    expect(await screen.findByText('Tick the box to accept the terms and the privacy notice.')).toBeTruthy();
    expect(api.acceptTerms).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('terms-checkbox'));
    await act(async () => { fireEvent.press(save()); });
    expect(api.acceptTerms).toHaveBeenCalledWith('1.0', '1.0');
    // Still on the screen until the server answers.
    expect(screen.getByTestId('setup-screen-terms')).toBeTruthy();
    await act(async () => { pending.resolve({ accepted: true }); });
    expect(await screen.findByTestId('setup-screen-telegram')).toBeTruthy();
  });

  it('opened from Settings, Save and Back both return to Settings, never to earlier steps (AF-08)', async () => {
    mockParams = { task: 'preferences', screen: 'alerts', from: 'settings' };
    await render(<SetupScreen />);
    await screen.findByTestId('setup-screen-alerts');
    await fireEvent.press(screen.getByTestId('setup-back'));
    expect(mockReplace).toHaveBeenCalledWith('/settings');
    mockReplace.mockClear();
    await act(async () => { fireEvent.press(save()); });
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/settings'));
    expect(api.saveNotificationPreferences).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('setup-screen-community')).toBeNull();
  });

  it('old links still work: the flow step opens "Your installer will complete this"', async () => {
    mockParams = { step: 'flow' };
    await render(<SetupScreen />);
    expect(await screen.findByTestId('setup-screen-installer')).toBeTruthy();
    expect(screen.getByText('Your installer will complete this')).toBeTruthy();
  });

  it('still on the temporary password, the wizard opens on the password screen', async () => {
    mockAuth = { ...mockAuth, mustChangePassword: true };
    await render(<SetupScreen />);
    expect(await screen.findByTestId('setup-screen-password')).toBeTruthy();
  });
});

describe('Home: Where you are now', () => {
  it('shows the stage, who acts next and "Waiting for booking" instead of a date', async () => {
    const { WhereYouAreNow } = jest.requireActual('@/components/WhereYouAreNow');
    const j = journey({ done: ['preferences', 'farm', 'water', 'crops'], stage: 'ready_for_installation' });
    j.whereYouAreNow = { ...j.whereYouAreNow, whoActsNext: 'agroflow_staff', dateLabel: 'Waiting for booking' };
    await render(<WhereYouAreNow state={{ status: 'ready', journey: j }} />);
    expect(screen.getByTestId('where-details')).toHaveTextContent('Your details: 4 of 4');
    expect(screen.getByTestId('where-installation')).toHaveTextContent('Installation: waiting for booking');
    expect(screen.getByText('Who acts next: AgroFlow staff')).toBeTruthy();
    expect(screen.getByTestId('where-date')).toHaveTextContent('When: Waiting for booking');
  });

  it('says Loading until the journey arrives, never a false "0 of 4"', async () => {
    const { WhereYouAreNow } = jest.requireActual('@/components/WhereYouAreNow');
    await render(<WhereYouAreNow state={{ status: 'loading', journey: null }} />);
    expect(screen.getByTestId('where-loading')).toBeTruthy();
    expect(screen.queryByText(/0 of 4/)).toBeNull();
  });
});

// Before migration 0058 Home still shows the older setup card (components/SetupCard.tsx).
describe('Home card before migration 0058', () => {
  it('shows how much is done out of 17 and continues at the right step', async () => {
    await AsyncStorage.setItem(KEY, JSON.stringify({ languageConfirmed: true, telegramDeclined: true, skipped: [], unsent: [], confirmed: [], locationFlagged: false }));
    await render(<SetupCard />);
    expect(await screen.findByText('Setup 3/17 done')).toBeTruthy();
    expect(screen.getByText('Next: Your farm\'s place')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('setup-card-continue'));
    expect(mockPush).toHaveBeenCalledWith('/setup?step=location');
  });

  it('is gone once setup is complete', async () => {
    await AsyncStorage.setItem(KEY, JSON.stringify({
      languageConfirmed: true, telegramDeclined: false, skipped: [], unsent: [], locationFlagged: false,
      confirmed: ['location', 'soilType:7', 'maxRun', 'alerts', 'community', 'help'],
    }));
    mockAgro = agro([bed({ crop: 'tomato', plantingDate: '2026-09-01', wet: true, dry: true })]);
    serve(farmSetup({ waterSource: 'borehole', zones: [serverZone({ crop: 'tomato', irrigationType: 'drip', areaM2: 50, flowRateLpm: 6 })] }),
      [todayZone(7, 'Bed 1', { crop: true, plantingDate: true, flowRate: true, calibrated: true })], true);
    await render(<SetupCard />);
    await act(async () => { await new Promise(r => setTimeout(r, 50)); });
    expect(screen.queryByTestId('setup-card')).toBeNull();
  });

  it("Home's card reminds about the wet reading after the dry one", async () => {
    // Everything before the soil step done: the next thing to do is the wet reading.
    await AsyncStorage.setItem(KEY, JSON.stringify({
      languageConfirmed: true, telegramDeclined: true, skipped: [], unsent: [], locationFlagged: false,
      confirmed: ['location', soilTypeKey(7)],
    }));
    mockAgro = agro([bed({ crop: 'tomato', plantingDate: '2026-09-01', wet: false, dry: true })]);
    serve(farmSetup({ waterSource: 'borehole', zones: [serverZone({ crop: 'tomato', irrigationType: 'drip', areaM2: 50, flowRateLpm: 6 })] }),
      [todayZone(7, 'Bed 1', { crop: true, plantingDate: true, flowRate: true })]);
    await render(<SetupCard />);
    expect(await screen.findByText('Soil: save the wet reading for Bed 1')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('setup-card-continue'));
    expect(mockPush).toHaveBeenCalledWith('/setup?step=soil');
  });
});
