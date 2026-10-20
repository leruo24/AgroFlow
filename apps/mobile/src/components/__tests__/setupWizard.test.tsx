/// <reference types="jest" />
// See services/__tests__/doubleSubmit.test.ts for why this reference is per file.

/* The setup wizard (17 steps in four sections). The rules (step order, sections, resume,
 * skip, the no-tank path, "Same as Zone 1", sizes, flow maths, soil meter), and the real
 * screens with only context and network faked: each step saves to the right field, pre-filled
 * answers are confirmed with "Looks right", the farm's location is read-only, the maximum run
 * time cannot be changed by the farmer, the alert choices are saved, the tap count for a
 * pre-filled 2-zone farm, and Home's "Setup X/17 done" card. */

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
jest.mock('@/lib/router', () => ({
  router: { push: (...a: unknown[]) => mockPush(...a), replace: (...a: unknown[]) => mockReplace(...a), back: jest.fn(), canGoBack: () => false, navigate: jest.fn() },
}));
let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({ useLocalSearchParams: () => mockParams }));

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

describe('the wizard: You', () => {
  it('starts at Welcome with four sections; the language changes the words at once and is remembered', async () => {
    await render(<SetupScreen />);
    expect(await screen.findByText('Welcome to AgroFlow')).toBeTruthy();
    expect(screen.getByTestId('setup-progress').props.children.join('')).toContain('Step 1 of 17');
    for (const s of ['you', 'farm', 'zones', 'alerts']) expect(screen.getByTestId(`setup-section-${s}`)).toBeTruthy();
    await fireEvent.press(screen.getByTestId('setup-language-af'));
    expect(await screen.findByText('Welkom by AgroFlow')).toBeTruthy();
    expect(getLanguage()).toBe('af');
    expect(await AsyncStorage.getItem('agroflow_language')).toBe('af');
  });

  it('Continue skips what is done (password already set) and Do this later moves on', async () => {
    await render(<SetupScreen />);
    await screen.findByText('Welcome to AgroFlow');
    await fireEvent.press(screen.getByTestId('setup-continue'));
    expect(await screen.findByText('Link Telegram')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('setup-later'));
    expect(await screen.findByText('Is this your farm?')).toBeTruthy();
    const saved = await readLocal();
    expect(saved.languageConfirmed).toBe(true);
    expect(saved.skipped).toEqual(['telegram']);
  });

  it('carries over progress from the old 7-step wizard and resumes there', async () => {
    await AsyncStorage.setItem('agroflow_setup:v1:farmer-1', JSON.stringify({ languageConfirmed: true, telegramDeclined: true, skipped: [], unsent: [] }));
    await render(<SetupScreen />);
    expect(await screen.findByText('Is this your farm?')).toBeTruthy();
  });

  it('a forced password change cannot be stepped past until it is saved', async () => {
    mockAuth = { user: { id: 'farmer-1' }, mustChangePassword: true, clearMustChangePassword: jest.fn(async () => {}) };
    mockParams = { step: 'password' };
    await render(<SetupScreen />);
    expect(await screen.findByText('Set your own password')).toBeTruthy();
    expect(screen.getByTestId('setup-continue').props.accessibilityState).toMatchObject({ disabled: true });
    expect(screen.queryByTestId('setup-later')).toBeNull();
  });
});

describe('the wizard: Your farm', () => {
  it('shows the farm on a read-only map; "Looks right" confirms it', async () => {
    mockParams = { step: 'location' };
    await render(<SetupScreen />);
    expect(await screen.findByText('Is this your farm?')).toBeTruthy();
    expect(await screen.findByText('Mahikeng, North West')).toBeTruthy();
    expect(screen.getByTestId('farm-map')).toBeTruthy();
    expect(inputCount()).toBe(0);     // nothing to edit
    await fireEvent.press(screen.getByTestId('setup-location-right'));
    await waitFor(async () => expect((await readLocal()).confirmed).toContain('location'));
    expect(await screen.findByText('Where does your water come from?')).toBeTruthy();
  });

  it('"Something\'s wrong" tells the field officer and counts the step as done', async () => {
    mockParams = { step: 'location' };
    await render(<SetupScreen />);
    await screen.findByText('Mahikeng, North West');
    await fireEvent.press(screen.getByTestId('setup-location-wrong'));
    await waitFor(() => expect(api.reportLocationProblem).toHaveBeenCalledWith('1'));
    expect(await screen.findByText('Your field officer has been told.')).toBeTruthy();
    await waitFor(async () => expect((await readLocal()).locationFlagged).toBe(true));
  });

  it('a borehole is saved and the tank step is passed over', async () => {
    mockParams = { step: 'water' };
    await render(<SetupScreen />);
    await screen.findByText('Where does your water come from?');
    serve(farmSetup({ waterSource: 'borehole' }));
    await fireEvent.press(screen.getByTestId('setup-water-borehole'));
    await waitFor(() => expect(api.saveWaterSource).toHaveBeenCalledWith('1', 'borehole'));
    expect(await screen.findByText('Your zones')).toBeTruthy();
    expect(screen.queryByText('Your tank')).toBeNull();
  });

  it('the tank: 5 000 L, half full, is saved as the size and a 2 500 L starting level', async () => {
    mockParams = { step: 'tank' };
    serve(farmSetup({ waterSource: 'tank' }));
    await render(<SetupScreen />);
    await screen.findByText('Your tank');
    expect(inputCount()).toBe(2);                     // the check above can see text boxes
    await fireEvent.press(screen.getByTestId('setup-tank-size-5000'));
    await fireEvent.press(screen.getByTestId('setup-tank-save'));
    expect(await screen.findByText('Choose how full it is now.')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('setup-tank-level-half'));
    await fireEvent.changeText(screen.getByTestId('setup-tank-ph'), '6,8');
    await fireEvent.press(screen.getByTestId('setup-tank-save'));
    await waitFor(() => expect(api.saveTankCapacity).toHaveBeenCalledWith('1', 5000));
    expect(api.logTankRefill).toHaveBeenCalledWith('1', expect.objectContaining({ litresAdded: 2500, waterPh: 6.8 }));
  });

  it('refuses a pH outside 0 to 14', async () => {
    mockParams = { step: 'tank' };
    await render(<SetupScreen />);
    await screen.findByText('Your tank');
    await fireEvent.changeText(screen.getByTestId('setup-tank-custom'), '3000');
    await fireEvent.press(screen.getByTestId('setup-tank-level-quarter'));
    await fireEvent.changeText(screen.getByTestId('setup-tank-ph'), '15');
    await fireEvent.press(screen.getByTestId('setup-tank-save'));
    expect(await screen.findByText('pH is a number from 0 to 14.')).toBeTruthy();
    expect(api.saveTankCapacity).not.toHaveBeenCalled();
  });
});

describe('the wizard: Each zone', () => {
  const twoZones = () => {
    mockAgro = agro([bed(), bed({ id: '8', name: 'Bed 2' })]);
  };

  it('one zone per screen: confirming Bed 1 opens Bed 2, which can copy Bed 1', async () => {
    twoZones();
    mockParams = { step: 'crop' };
    await render(<SetupScreen />);
    await screen.findByText('Your zones');
    expect(screen.queryByText('Confirm Bed 2')).toBeNull();
    await fireEvent.press(screen.getByText('Tomato'));
    await fireEvent.press(screen.getByText('Confirm Bed 1'));
    await waitFor(() => expect(api.changeZoneCrop).toHaveBeenCalledWith(7, expect.objectContaining({ cropType: 'tomato' })));
    expect(await screen.findByText('Confirm Bed 2')).toBeTruthy();
  });

  it('Same as Zone 1 copies the crop and planting date', async () => {
    mockAgro = agro([bed({ crop: 'tomato', plantingDate: '2026-09-01' }), bed({ id: '8', name: 'Bed 2' })]);
    mockParams = { step: 'crop' };
    await render(<SetupScreen />);
    await screen.findByText('Your zones');
    await fireEvent.press(screen.getByTestId('setup-zone-tab-1'));
    await fireEvent.press(await screen.findByTestId('setup-crop-same'));
    await waitFor(() => expect(api.changeZoneCrop).toHaveBeenCalledWith(8, { cropType: 'tomato', plantingDate: '2026-09-01' }));
  });

  it('the irrigation type is saved per zone, explains the efficiency, and Bed 2 can copy Bed 1', async () => {
    twoZones();
    serve(farmSetup({ zones: [serverZone({ irrigationType: 'drip' }), serverZone({ zoneId: 8, name: 'Bed 2' })] }));
    mockParams = { step: 'irrigation' };
    await render(<SetupScreen />);
    expect(await screen.findByText('How is Bed 1 watered?')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('setup-irrigation-drip'));
    await waitFor(() => expect(api.saveIrrigationType).toHaveBeenCalledWith(7, 'drip'));
    expect(await screen.findByText('How is Bed 2 watered?')).toBeTruthy();
    expect(await screen.findByText(/90% of the water reaches the roots/)).toBeTruthy();
    await fireEvent.press(screen.getByTestId('setup-irrigation-same'));
    await waitFor(() => expect(api.saveIrrigationType).toHaveBeenCalledWith(8, 'drip'));
  });

  it('confirming the pre-filled soil type saves nothing new but counts; a change is saved', async () => {
    twoZones();
    serve(farmSetup({ zones: [serverZone(), serverZone({ zoneId: 8, name: 'Bed 2' })] }));
    mockParams = { step: 'soilType' };
    await render(<SetupScreen />);
    await screen.findByText('What is the soil like in Bed 1?');
    await fireEvent.press(await screen.findByTestId('setup-soiltype-loam'));
    await waitFor(async () => expect((await readLocal()).confirmed).toContain('soilType:7'));
    expect(api.saveZoneSoilType).not.toHaveBeenCalled();
    await screen.findByText('What is the soil like in Bed 2?');
    await fireEvent.press(screen.getByTestId('setup-soiltype-sandy'));
    await waitFor(() => expect(api.saveZoneSoilType).toHaveBeenCalledWith(8, 'sandy'));
    await waitFor(async () => expect((await readLocal()).confirmed).toContain('soilType:8'));
  });

  it('the zone size in hectares is saved in square metres', async () => {
    mockParams = { step: 'size' };
    await render(<SetupScreen />);
    await screen.findByText('How big is Bed 1?');
    await fireEvent.press(screen.getByTestId('setup-size-save'));
    expect(await screen.findByText('Enter a size bigger than 0.')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('setup-size-value'), '0,1');
    await fireEvent.press(screen.getByTestId('setup-size-unit-ha'));
    await fireEvent.press(screen.getByTestId('setup-size-save'));
    await waitFor(() => expect(api.saveZoneSetup).toHaveBeenCalledWith(7, { areaM2: 1000 }));
  });

  it('measures the flow with the stopwatch: 5 L in 60 s is saved as 5 L/min', async () => {
    mockParams = { step: 'flow' };
    let now = 1_000_000;
    const spy = jest.spyOn(Date, 'now').mockImplementation(() => now);
    await render(<SetupScreen />);
    await screen.findByText('Measure your water flow');
    await fireEvent.changeText(screen.getByTestId('setup-flow-amount'), '5');
    await fireEvent.press(screen.getByTestId('setup-flow-stopwatch'));
    now += 60_000;
    await fireEvent.press(screen.getByTestId('setup-flow-stopwatch'));
    expect(await screen.findByText('5 litres a minute')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('setup-flow-save'));
    await waitFor(() => expect(api.saveZoneSetup).toHaveBeenCalledWith(7, { flowRateLpm: 5 }));
    spy.mockRestore();
  });

  it('the soil step saves a dry reading and shows the meter', async () => {
    mockParams = { step: 'soil' };
    await render(<SetupScreen />);
    expect(await screen.findByText('Teach AgroFlow your soil')).toBeTruthy();
    expect(screen.getByText('How sure AgroFlow is: Low')).toBeTruthy();
    await fireEvent.press(screen.getByText('Save dry reading now'));
    await waitFor(() => expect(api.saveZoneCalibration).toHaveBeenCalledWith(7, 'dry'));
  });

  it('the maximum run time is shown but cannot be changed by the farmer', async () => {
    mockParams = { step: 'maxRun' };
    await render(<SetupScreen />);
    expect(await screen.findByText('Longest watering at a time')).toBeTruthy();
    expect(await screen.findByText('8 min')).toBeTruthy();
    expect(screen.getByText('Ask your field officer to change this.')).toBeTruthy();
    expect(inputCount()).toBe(0);
    await fireEvent.press(screen.getByTestId('setup-maxrun-right'));
    await waitFor(async () => expect((await readLocal()).confirmed).toContain('maxRun'));
  });
});

describe('the wizard: Alerts & help', () => {
  it('without Telegram, alerts are in the app only (no switches)', async () => {
    mockParams = { step: 'alerts' };
    await render(<SetupScreen />);
    await screen.findByText('Which alerts do you want?');
    expect(screen.queryByTestId('setup-alerts-lowTankTelegram')).toBeNull();
    expect(screen.getByText('Link Telegram to get these on your phone too.')).toBeTruthy();
  });

  it('with Telegram, each alert type has its own switch and quiet hours can be set', async () => {
    serve(farmSetup(), [todayZone(7, 'Bed 1')], true);
    mockParams = { step: 'alerts' };
    await render(<SetupScreen />);
    await fireEvent(await screen.findByTestId('setup-alerts-lowTankTelegram'), 'valueChange', false);
    await fireEvent(screen.getByTestId('setup-alerts-quiet'), 'valueChange', true);
    await fireEvent.press(screen.getByTestId('setup-alerts-save'));
    await waitFor(() => expect(api.saveNotificationPreferences).toHaveBeenCalledWith(expect.objectContaining({
      lowTankTelegram: false, wateringTelegram: true, quietStart: '21:00', quietEnd: '06:00',
    })));
    await waitFor(async () => expect((await readLocal()).confirmed).toContain('alerts'));
  });

  it('community alerts: explains the 2-in-36-hours rule; "No thanks" opts out', async () => {
    mockParams = { step: 'community' };
    await render(<SetupScreen />);
    await screen.findByText('Alerts from farmers nearby');
    expect(screen.getByText(/up to 2 reports every 36 hours/)).toBeTruthy();
    await fireEvent.press(screen.getByTestId('setup-community-off'));
    await waitFor(() => expect(api.saveNotificationPreferences).toHaveBeenCalledWith(expect.objectContaining({ communityOptIn: false })));
  });

  it('switches Drip off from the help step', async () => {
    mockParams = { step: 'help' };
    await render(<SetupScreen />);
    await fireEvent(await screen.findByTestId('setup-help-drip'), 'valueChange', false);
    await waitFor(async () => expect(JSON.parse((await AsyncStorage.getItem('agroflow_app_preferences'))!).showRaindropHelper).toBe(false));
  });

  it('the summary lists the farm, each zone, what is left and each zone’s first advice', async () => {
    mockAgro = agro([bed({ crop: 'tomato', plantingDate: '2026-09-01' })]);
    serve(farmSetup({ waterSource: 'tank', tank: { capacityLitres: 5000, estimatedRemainingLitres: 2500 },
      zones: [serverZone({ crop: 'tomato', irrigationType: 'drip' })] }));
    mockParams = { step: 'done' };
    await render(<SetupScreen />);
    expect(await screen.findByText('Nearly there')).toBeTruthy();
    expect(await screen.findByText('Tank 5 000 L, about half full')).toBeTruthy();
    expect(await screen.findByText('Bed 1 · Tomato · drip · loam (ordinary garden soil)')).toBeTruthy();
    expect(screen.getByText('Today for Bed 1')).toBeTruthy();
    expect(screen.getByTestId('setup-summary-flow')).toBeTruthy();       // still to do
    await fireEvent.press(screen.getByTestId('setup-go'));
    expect(mockReplace).toHaveBeenCalledWith('/');
  });
});

describe('tap count', () => {
  it('a pre-filled 2-zone farm goes through every step (Redo setup) in under 30 taps', async () => {
    mockAgro = agro([bed({ crop: 'tomato', plantingDate: '2026-09-01', wet: true, dry: true }),
      bed({ id: '8', name: 'Bed 2', crop: 'maize', plantingDate: '2026-09-10', wet: true, dry: true })]);
    serve(farmSetup({
      waterSource: 'tank', tank: { capacityLitres: 5000, estimatedRemainingLitres: 2500 },
      zones: [serverZone({ crop: 'tomato', irrigationType: 'drip', areaM2: 50, flowRateLpm: 6 }),
        serverZone({ zoneId: 8, name: 'Bed 2', crop: 'maize', irrigationType: 'drip', areaM2: 80, flowRateLpm: 6 })],
    }), [todayZone(7, 'Bed 1', { crop: true, plantingDate: true, flowRate: true, calibrated: true }),
      todayZone(8, 'Bed 2', { crop: true, plantingDate: true, flowRate: true, calibrated: true })], true);
    mockParams = { redo: '1' };
    await render(<SetupScreen />);
    await screen.findByText('Welcome to AgroFlow');
    let taps = 0;
    const tap = async (id: string) => { taps += 1; await fireEvent.press(await screen.findByTestId(id)); };
    const steps: string[] = [];
    for (let guard = 0; guard < 40; guard++) {
      const view = screen.queryByTestId(/^setup-step-/)!;
      const step = String(view.props.testID).replace('setup-step-', '');
      steps.push(step);
      if (step === 'done') { await tap('setup-go'); break; }
      if (step === 'location') await tap('setup-location-right');
      else if (step === 'soilType') {
        await tap('setup-soiltype-loam');                      // Bed 1: looks right
        await screen.findByText('What is the soil like in Bed 2?');
        await tap('setup-soiltype-loam');                      // Bed 2
        await waitFor(() => expect(screen.getByTestId('setup-continue')).toBeTruthy());
        await tap('setup-continue');
      }
      else if (step === 'maxRun') await tap('setup-maxrun-right');
      else if (step === 'alerts') await tap('setup-alerts-save');
      else if (step === 'community') await tap('setup-community-on');
      else if (step === 'help') await tap('setup-help-right');
      else await tap('setup-continue');
      await waitFor(() => expect(String(screen.queryByTestId(/^setup-step-/)!.props.testID)).not.toBe(`setup-step-${step}`));
    }
    expect(steps).toEqual([...SETUP_STEPS]);
    expect(mockReplace).toHaveBeenCalledWith('/');
    // eslint-disable-next-line no-console
    console.log(`Tap count, pre-filled 2-zone farm, every step: ${taps}`);
    expect(taps).toBeLessThan(30);
  });
});

describe('Home card', () => {
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
});
