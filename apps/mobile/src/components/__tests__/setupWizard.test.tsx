/// <reference types="jest" />
// See services/__tests__/doubleSubmit.test.ts for why this reference is per file.

/* Part E: the setup wizard. The rules (step order, resume, skip, flow maths, validation, soil
 * meter), and the real screens with only context and network faked: language switching at
 * once and staying, a forced password that cannot be skipped, "Do this later", the
 * stopwatch, and Home's "Setup 4/6 done" card. */

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
  fetchFarmToday: jest.fn(),
  fetchTelegramLinkStatus: jest.fn(),
  changeZoneCrop: jest.fn(() => Promise.resolve({ message: 'Saved.' })),
  saveZoneSetup: jest.fn(() => Promise.resolve({ message: 'Saved.' })),
  saveZoneCalibration: jest.fn(() => Promise.resolve({ message: 'Dry reading saved.', reading: 3900 })),
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as api from '@/services/agroFlowApi';
import SetupScreen from '@/app/setup';
import { SetupCard } from '@/components/SetupCard';
import { resetLanguageForTests, getLanguage } from '@/i18n';
import {
  SETUP_STEPS,
  doneCount,
  flowRateFromContainer,
  nextStep,
  resumeStep,
  setupComplete,
  soilConfidence,
  stepNumber,
  type SetupFacts,
  type SetupZone,
} from '@/lib/setupProgress';

const zoneA: SetupZone = { zoneId: 7, name: 'Bed 1', crop: null, plantingDate: null, hasFlowRate: false, hasKit: true, wetSaved: false, drySaved: false };
const facts = (over: Partial<SetupFacts> = {}): SetupFacts => ({
  languageConfirmed: false, mustChangePassword: false, telegramLinked: false, telegramDeclined: false, zones: [zoneA], ...over,
});
const finished = facts({
  languageConfirmed: true, telegramLinked: true,
  zones: [{ ...zoneA, crop: 'spinach', plantingDate: '2026-09-01', hasFlowRate: true, wetSaved: true, drySaved: true }],
});

describe('setup rules', () => {
  it('has seven steps in this order, six of which count', () => {
    expect(SETUP_STEPS).toEqual(['welcome', 'password', 'telegram', 'zones', 'flow', 'soil', 'done']);
    expect(stepNumber('welcome')).toEqual({ n: 1, of: 7 });
    expect(stepNumber('done')).toEqual({ n: 7, of: 7 });
    expect(doneCount(facts())).toEqual({ done: 1, total: 6 });          // only the password
    expect(doneCount(finished)).toEqual({ done: 6, total: 6 });
    expect(setupComplete(finished)).toBe(true);
  });

  it('resumes at the first step not done', () => {
    expect(resumeStep(facts())).toBe('welcome');
    expect(resumeStep(facts({ languageConfirmed: true }))).toBe('telegram');
    expect(resumeStep(facts({ languageConfirmed: true, mustChangePassword: true }))).toBe('password');
    expect(resumeStep(facts({ languageConfirmed: true, telegramDeclined: true }))).toBe('zones');
    expect(resumeStep(finished)).toBe('done');
  });

  it('moves on past steps already done, but Redo visits every step', () => {
    const f = facts({ languageConfirmed: true, telegramLinked: true });
    expect(nextStep('welcome', f)).toBe('zones');                // password and Telegram already done
    expect(nextStep('welcome', f, true)).toBe('password');       // Redo setup
    expect(nextStep('soil', f)).toBe('done');
  });

  it('works out litres a minute: 5 L in 60 s is 5 L/min', () => {
    expect(flowRateFromContainer({ amount: 5, unit: 'L', seconds: 60 })).toEqual({ ok: true, litresPerMinute: 5 });
    expect(flowRateFromContainer({ amount: 500, unit: 'ml', seconds: 30 })).toEqual({ ok: true, litresPerMinute: 1 });
    expect(flowRateFromContainer({ amount: 10, unit: 'L', seconds: 45 })).toEqual({ ok: true, litresPerMinute: 13.33 });
  });

  it('refuses a container of 0 and a time of 2 seconds or less', () => {
    expect(flowRateFromContainer({ amount: 0, unit: 'L', seconds: 60 })).toEqual({ ok: false, problem: 'size' });
    expect(flowRateFromContainer({ amount: NaN, unit: 'L', seconds: 60 })).toEqual({ ok: false, problem: 'size' });
    expect(flowRateFromContainer({ amount: 5, unit: 'L', seconds: 2 })).toEqual({ ok: false, problem: 'time' });
    expect(flowRateFromContainer({ amount: 5, unit: 'L', seconds: 2.1 }).ok).toBe(true);
  });

  it('shows how sure the soil readings are: low, medium, high', () => {
    expect(soilConfidence({ wetSaved: false, drySaved: false })).toBe('low');
    expect(soilConfidence({ wetSaved: false, drySaved: true })).toBe('medium');
    expect(soilConfidence({ wetSaved: true, drySaved: true })).toBe('high');
  });
});

function agro(zoneRow = { crop: 'Not configured', plantingDate: null as string | null, wet: false, dry: false }) {
  return {
    farm: { id: '1', name: 'Nkosi Farm' },
    zones: [{ id: '7', name: 'Bed 1', crop: zoneRow.crop, plantingDate: zoneRow.plantingDate,
      sensors: { soilMoisture: { wetSaved: zoneRow.wet, drySaved: zoneRow.dry } } }],
    refreshZones: jest.fn(),
  };
}

const todayZone = (setup: Record<string, boolean>) => ({
  zoneId: 7, name: 'Bed 1', action: { kind: 'water', text: 'Water about 8 min this morning' }, why: null,
  confidence: null, confidenceExplanation: null, nextStep: null,
  setup: { crop: false, plantingDate: false, soil: true, area: true, flowRate: false, calibrated: false, hasKit: true, ...setup },
});

beforeAll(async () => {
  (api.fetchFarmToday as jest.Mock).mockResolvedValue({ farmId: 1, day: '2026-10-19', zones: [todayZone({})] });
  (api.fetchTelegramLinkStatus as jest.Mock).mockResolvedValue({ linked: false, alertsEnabled: true });
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
  (api.fetchFarmToday as jest.Mock).mockResolvedValue({ farmId: 1, day: '2026-10-19', zones: [todayZone({})] });
  (api.fetchTelegramLinkStatus as jest.Mock).mockResolvedValue({ linked: false, alertsEnabled: true });
});

describe('the wizard', () => {
  it('starts at Welcome; the language changes the words at once and is remembered', async () => {
    await render(<SetupScreen />);
    expect(await screen.findByText('Welcome to AgroFlow')).toBeTruthy();
    expect(screen.getByText('Step 1 of 7')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('setup-language-af'));
    expect(await screen.findByText('Welkom by AgroFlow')).toBeTruthy();
    expect(screen.getByText('Stap 1 van 7')).toBeTruthy();
    expect(getLanguage()).toBe('af');
    expect(await AsyncStorage.getItem('agroflow_language')).toBe('af');   // the same setting as Settings
    await fireEvent.press(screen.getByTestId('setup-language-tn'));
    expect(await screen.findByText('O amogetswe mo AgroFlow')).toBeTruthy();
  });

  it('Continue skips what is done (password already set) and Do this later moves on', async () => {
    await render(<SetupScreen />);
    await screen.findByText('Welcome to AgroFlow');
    await fireEvent.press(screen.getByTestId('setup-continue'));
    expect(await screen.findByText('Link Telegram')).toBeTruthy();       // step 3: password was done
    expect(screen.getByText('Step 3 of 7')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('setup-later'));
    expect(await screen.findByText('Your zones')).toBeTruthy();
    const saved = JSON.parse((await AsyncStorage.getItem('agroflow_setup:v1:farmer-1'))!);
    expect(saved.languageConfirmed).toBe(true);
    expect(saved.skipped).toEqual(['telegram']);
  });

  it('resumes where the farmer left off', async () => {
    await AsyncStorage.setItem('agroflow_setup:v1:farmer-1', JSON.stringify({ languageConfirmed: true, telegramDeclined: true, skipped: [], unsent: [] }));
    await render(<SetupScreen />);
    expect(await screen.findByText('Your zones')).toBeTruthy();
    expect(screen.getByText('Step 4 of 7')).toBeTruthy();
  });

  it('a forced password change cannot be stepped past until it is saved', async () => {
    mockAuth = { user: { id: 'farmer-1' }, mustChangePassword: true, clearMustChangePassword: jest.fn(async () => {}) };
    mockParams = { step: 'password' };
    await render(<SetupScreen />);
    expect(await screen.findByText('Set your own password')).toBeTruthy();
    expect(screen.getByTestId('setup-continue').props.accessibilityState).toMatchObject({ disabled: true });
    expect(screen.queryByTestId('setup-later')).toBeNull();
    await fireEvent.changeText(screen.getByTestId('setup-password-new'), 'short');
    await fireEvent.changeText(screen.getByTestId('setup-password-again'), 'short');
    await fireEvent.press(screen.getByTestId('setup-password-save'));
    expect(await screen.findByText('Use at least 8 characters.')).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('setup-password-new'), 'my-own-password');
    await fireEvent.changeText(screen.getByTestId('setup-password-again'), 'my-own-password');
    await fireEvent.press(screen.getByTestId('setup-password-save'));
    await waitFor(() => expect(mockAuth.clearMustChangePassword).toHaveBeenCalled());
    expect(await screen.findByText('Your password is saved.')).toBeTruthy();
  });

  it('confirms a zone’s crop and planting date', async () => {
    mockParams = { step: 'zones' };
    await render(<SetupScreen />);
    await screen.findByText('Your zones');
    expect(screen.getByText('Kit connected')).toBeTruthy();
    await fireEvent.press(screen.getByText('Confirm Bed 1'));
    expect(await screen.findByText('Choose the crop first.')).toBeTruthy();
    await fireEvent.press(screen.getByText('Spinach'));
    await fireEvent.press(screen.getByText('4 wk'));
    await fireEvent.press(screen.getByText('Confirm Bed 1'));
    await waitFor(() => expect(api.changeZoneCrop).toHaveBeenCalledWith(7, expect.objectContaining({ cropType: 'spinach' })));
  });

  it('measures the flow with the stopwatch: 5 L in 60 s is saved as 5 L/min', async () => {
    mockParams = { step: 'flow' };
    let now = 1_000_000;
    const spy = jest.spyOn(Date, 'now').mockImplementation(() => now);
    await render(<SetupScreen />);
    await screen.findByText('Measure your water flow');
    await fireEvent.changeText(screen.getByTestId('setup-flow-amount'), '5');
    await fireEvent.press(screen.getByTestId('setup-flow-stopwatch'));   // Start
    now += 60_000;
    await fireEvent.press(screen.getByTestId('setup-flow-stopwatch'));   // Stop
    expect(await screen.findByText('5 litres a minute')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('setup-flow-save'));
    await waitFor(() => expect(api.saveZoneSetup).toHaveBeenCalledWith(7, { flowRateLpm: 5 }));
    spy.mockRestore();
  });

  it('picks a zone for the flow even when the zones load after the step opens', async () => {
    mockParams = { step: 'flow' };
    mockAgro = { ...agro(), zones: [] };
    let now = 3_000_000;
    const spy = jest.spyOn(Date, 'now').mockImplementation(() => now);
    const view = await render(<SetupScreen />);
    await screen.findByText('Measure your water flow');
    mockAgro = agro();
    await view.rerender(<SetupScreen />);
    await fireEvent.changeText(screen.getByTestId('setup-flow-amount'), '10');
    await fireEvent.press(screen.getByTestId('setup-flow-stopwatch'));
    now += 30_000;
    await fireEvent.press(screen.getByTestId('setup-flow-stopwatch'));
    await fireEvent.press(await screen.findByTestId('setup-flow-save'));
    await waitFor(() => expect(api.saveZoneSetup).toHaveBeenCalledWith(7, { flowRateLpm: 20 }));
    spy.mockRestore();
  });

  it('refuses a flow timed for 2 seconds or less', async () => {
    mockParams = { step: 'flow' };
    let now = 2_000_000;
    const spy = jest.spyOn(Date, 'now').mockImplementation(() => now);
    await render(<SetupScreen />);
    await screen.findByText('Measure your water flow');
    await fireEvent.changeText(screen.getByTestId('setup-flow-amount'), '500');
    await fireEvent.press(screen.getByTestId('setup-flow-unit-ml'));
    await fireEvent.press(screen.getByTestId('setup-flow-stopwatch'));
    now += 1_500;
    await fireEvent.press(screen.getByTestId('setup-flow-stopwatch'));
    await fireEvent.press(screen.getByTestId('setup-flow-save'));
    expect(await screen.findByTestId('setup-flow-error')).toBeTruthy();
    expect(api.saveZoneSetup).not.toHaveBeenCalled();
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

  it('the summary lists what is done and goes to the farm', async () => {
    mockParams = { step: 'done' };
    await render(<SetupScreen />);
    expect(await screen.findByText('Nearly there')).toBeTruthy();
    expect(screen.getByText('Today for Bed 1')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('setup-go'));
    expect(mockReplace).toHaveBeenCalledWith('/');
  });
});

describe('Home card', () => {
  it('shows how much is done and continues at the right step', async () => {
    await AsyncStorage.setItem('agroflow_setup:v1:farmer-1', JSON.stringify({ languageConfirmed: true, telegramDeclined: true, skipped: [], unsent: [] }));
    await render(<SetupCard />);
    expect(await screen.findByText('Setup 3/6 done')).toBeTruthy();
    expect(screen.getByText('Next: Crops and planting dates')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('setup-card-continue'));
    expect(mockPush).toHaveBeenCalledWith('/setup?step=zones');
  });

  it('reminds about the wet reading after the dry one', async () => {
    await AsyncStorage.setItem('agroflow_setup:v1:farmer-1', JSON.stringify({ languageConfirmed: true, telegramDeclined: true, skipped: [], unsent: [] }));
    mockAgro = agro({ crop: 'spinach', plantingDate: '2026-09-01', wet: false, dry: true });
    (api.fetchFarmToday as jest.Mock).mockResolvedValue({ farmId: 1, day: '2026-10-19', zones: [todayZone({ crop: true, plantingDate: true, flowRate: true })] });
    await render(<SetupCard />);
    expect(await screen.findByText('Soil: save the wet reading for Bed 1')).toBeTruthy();
  });

  it('is gone once setup is complete', async () => {
    await AsyncStorage.setItem('agroflow_setup:v1:farmer-1', JSON.stringify({ languageConfirmed: true, telegramDeclined: false, skipped: [], unsent: [] }));
    (api.fetchTelegramLinkStatus as jest.Mock).mockResolvedValue({ linked: true, alertsEnabled: true });
    mockAgro = agro({ crop: 'spinach', plantingDate: '2026-09-01', wet: true, dry: true });
    (api.fetchFarmToday as jest.Mock).mockResolvedValue({ farmId: 1, day: '2026-10-19', zones: [todayZone({ crop: true, plantingDate: true, flowRate: true, calibrated: true })] });
    await render(<SetupCard />);
    await act(async () => { await new Promise(r => setTimeout(r, 50)); });
    expect(screen.queryByTestId('setup-card')).toBeNull();
  });
});
