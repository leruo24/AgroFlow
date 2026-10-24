/// <reference types="jest" />
// See services/__tests__/doubleSubmit.test.ts for why this reference is per file.

/* Part B on screen, with the real screens and only context and network faked: the offline
 * banner with the data's time, Irrigate off while offline, the language picker and Unlink
 * Telegram in Settings. */

import type { ReactNode } from 'react';

jest.mock('@/context/ThemeContext', () => {
  const { lightColors } = jest.requireActual('@/constants/colors');
  return { useTheme: () => ({ colors: lightColors, themePreference: 'system', resolvedTheme: 'light', setThemePreference: jest.fn() }) };
});
jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual('react-native');
  return {
    SafeAreaView: ({ children }: { children: ReactNode }) => <View>{children}</View>,
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  };
});
jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);
jest.mock('lucide-react-native', () =>
  new Proxy({}, { get: (_target, name) => (name === '__esModule' ? false : () => null) })
);
jest.mock('@/lib/router', () => ({
  router: { push: jest.fn(), back: jest.fn(), canGoBack: () => true, navigate: jest.fn(), replace: jest.fn() },
}));
let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => {
  const React = jest.requireActual('react');
  return {
    useLocalSearchParams: () => mockParams,
    useFocusEffect: (fn: () => void) => React.useEffect(fn, [fn]),
  };
});

let mockAgro: Record<string, unknown> = {};
jest.mock('@/context/AgroFlowContext', () => ({ useAgroFlow: () => mockAgro }));
jest.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: { name: 'Thandi', email: 't@example.org' }, signOut: jest.fn() }) }));
jest.mock('@/services/insightsService', () => ({
  fetchAlertExplanations: jest.fn(() => Promise.resolve({})),
  todayInSast: () => '2026-10-19',
}));

// The confirm dialogs answer "yes" at once, so the action behind them runs.
const mockAlerts: { title: string; message?: string }[] = [];
jest.mock('@/components/AppAlert', () => ({
  AppAlert: {
    alert: (title: string, message?: string, buttons?: { text?: string; style?: string; onPress?: () => void }[]) => {
      mockAlerts.push({ title, message });
      buttons?.find(b => b.style !== 'cancel')?.onPress?.();
    },
  },
}));

jest.mock('@/services/agroFlowApi', () => ({
  fetchServiceSupport: jest.fn(() => new Promise(() => undefined)),
  fetchJourney: jest.fn(() => new Promise(() => undefined)),
  // The zone screen's Sensor Readings card asks for the farm's tank.
  fetchTankStatus: jest.fn(() => Promise.resolve({ farmId: 1, capacityLitres: null, estimatedRemainingLitres: null, isLow: false })),
  fetchZoneHardware: jest.fn(() => Promise.resolve({ hardwareId: 1, deviceId: 'AF-1', online: true })),
  ApiHttpError: class ApiHttpError extends Error { status: number; constructor(m: string, s: number) { super(m); this.status = s; } },
  fetchZoneInsights: jest.fn(() => Promise.resolve({ insights: [], growth: null })),
  fetchSoilPh: jest.fn(() => Promise.resolve({ zoneId: 7, entries: [] })),
  logSoilPh: jest.fn(),
  resetZoneToRecommended: jest.fn(),
  saveZoneCalibration: jest.fn(),
  fetchRecommendedSettings: jest.fn(() => Promise.resolve({ available: false })),
  fetchDismissals: jest.fn(() => Promise.resolve([])),
  dismissNotification: jest.fn(),
  restoreNotification: jest.fn(),
  dismissZoneInsight: jest.fn(),
  fetchTelegramLinkStatus: jest.fn(() => Promise.resolve({ linked: true, alertsEnabled: true })),
  disconnectTelegram: jest.fn(() => Promise.resolve()),
}));

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as api from '@/services/agroFlowApi';
import { noteCachedDataShown, reportNetworkFailure, reportNetworkSuccess } from '@/lib/connectivity';
import { OfflineBanner } from '@/components/OfflineBanner';
import ZoneControlScreen from '@/app/zone/[id]';
import SettingsScreen from '@/app/(tabs)/settings';
import { getLanguage, resetLanguageForTests, setLanguage, t, translate, LANGUAGES } from '@/i18n';
import en from '@/i18n/en.json';
import af from '@/i18n/af.json';
import tn from '@/i18n/tn.json';

function zone(overrides: Record<string, unknown> = {}) {
  return {
    id: '7', farmId: '1', name: 'Bed 1', location: 'North', crop: 'Spinach', plantingDate: null,
    healthStatus: 'Healthy', waterSavedLitres: null, size: { value: 10, unit: 'm²' },
    sensors: {
      soilMoisture: { value: 40, unit: '%', status: 'Online', moistureStatus: 'Optimal', calibrated: true },
      temperatureHumidity: { temperature: 21, temperatureUnit: '°C', humidity: 50, humidityUnit: '%', status: 'Online' },
    },
    irrigation: {
      status: 'Off', mode: 'manual',
      lastIrrigation: { date: '', time: '', durationMinutes: 0 },
      schedule: { enabled: false, days: [], startTime: '05:30', durationMinutes: 20 },
      automation: { enabled: false, moistureThreshold: 30, desiredMoisture: 60, weatherAdjustment: true },
      override: { active: false, durationMinutes: null },
    },
    relay: { status: 'Off' }, pump: { status: 'Off' },
    water: { usedTodayLitres: null, latestCycleLitres: 0, flowRateLpm: 0 },
    weather: { rainExpected: false, message: '' },
    alerts: [],
    ...overrides,
  };
}

const startManualIrrigation = jest.fn(() => Promise.resolve());

beforeAll(async () => {
  // Warm the renderer once outside any test's 5 s (see todayCard.test.tsx).
  mockAgro = baseAgro();
  mockParams = { id: '7' };
  await render(<ZoneControlScreen />);
}, 60000);

function baseAgro() {
  return {
    farm: { id: '1', name: 'Nkosi Farm' }, zones: [zone()], isZonesLoading: false, zonesError: null,
    isFarmLoading: false, farmError: null, refreshZones: jest.fn(), refreshFarms: jest.fn(),
    startManualIrrigation, stopManualIrrigation: jest.fn(), updateIrrigationMode: jest.fn(() => Promise.resolve()),
    updateZoneSettings: jest.fn(), updateZoneSchedule: jest.fn(), alerts: [], markAlertAsRead: jest.fn(),
  };
}

beforeEach(async () => {
  jest.clearAllMocks();
  mockAlerts.length = 0;
  mockAgro = baseAgro();
  mockParams = { id: '7' };
  reportNetworkSuccess();
  resetLanguageForTests();
});

describe('offline banner', () => {
  it('says nothing while online', async () => {
    await render(<OfflineBanner />);
    expect(screen.queryByTestId('offline-banner')).toBeNull();
  });

  it('shows the time the data on screen was saved', async () => {
    const saved = new Date();
    saved.setHours(8, 15, 0, 0);
    await render(<OfflineBanner />);
    await act(async () => {
      reportNetworkFailure();
      noteCachedDataShown(saved.getTime());
    });
    expect(await screen.findByText('You\'re offline — showing data from today 08:15')).toBeTruthy();
  });

  it('says so when nothing has been saved on the phone yet', async () => {
    await render(<OfflineBanner />);
    await act(async () => { reportNetworkFailure(); });
    expect(await screen.findByText('You\'re offline. Nothing has been saved on this phone yet.')).toBeTruthy();
  });
});

describe('Irrigate needs a connection', () => {
  it('online: Water now starts the pump after the confirm', async () => {
    await render(<ZoneControlScreen />);
    const button = await screen.findByTestId('irrigate-button');
    expect(screen.getByText('Water now')).toBeTruthy();
    await fireEvent.press(button);
    await waitFor(() => expect(startManualIrrigation).toHaveBeenCalledWith('7', 5));   // the 5-minute default
    expect(mockAlerts[0].title).toBe('Water Bed 1 now?');
  });

  it('offline: the button is off, says why, and sends nothing', async () => {
    await render(<ZoneControlScreen />);
    await act(async () => { reportNetworkFailure(); });
    const button = await screen.findByTestId('irrigate-button');
    expect(button.props.accessibilityState).toMatchObject({ disabled: true });
    expect(screen.getAllByText('Needs a connection to reach your kit').length).toBeGreaterThan(0);
    await fireEvent.press(button);
    expect(startManualIrrigation).not.toHaveBeenCalled();
    expect(mockAlerts).toHaveLength(0);
  });

  it('comes back on with the connection', async () => {
    await render(<ZoneControlScreen />);
    await act(async () => { reportNetworkFailure(); });
    await act(async () => { reportNetworkSuccess(); });
    const button = await screen.findByTestId('irrigate-button');
    expect(button.props.accessibilityState).toMatchObject({ disabled: false });
    expect(screen.queryByText('Needs a connection to reach your kit')).toBeNull();
  });
});

describe('language', () => {
  it('Settings lists English, Afrikaans (beta) and Setswana (beta), and switching changes the words', async () => {
    await render(<SettingsScreen />);
    expect(await screen.findByText('English')).toBeTruthy();
    expect(screen.getByTestId('language-en').props.accessibilityState.checked).toBe(true);
    expect(screen.getByTestId('language-af').props.accessibilityState.checked).toBe(false);
    expect(screen.getByText('Afrikaans (beta)')).toBeTruthy();
    expect(screen.getByText('Setswana (beta)')).toBeTruthy();
    expect(screen.getByText('Appearance')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('language-af'));
    expect(getLanguage()).toBe('af');
    expect(await screen.findByText('Voorkoms')).toBeTruthy();       // Appearance
    expect(screen.getByText('Taal')).toBeTruthy();                  // Language

    await fireEvent.press(screen.getByTestId('language-tn'));
    expect(await screen.findByText('Ponalo')).toBeTruthy();
    expect(screen.getByText('Puo')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('language-en'));
    expect(await screen.findByText('Appearance')).toBeTruthy();
  });

  it('English is complete; the drafts are marked for review and keep every {placeholder}', () => {
    const keys = Object.keys(en.strings);
    expect(en.meta.needs_review).toBe(false);
    for (const draft of [af, tn]) {
      expect(draft.meta.needs_review).toBe(true);
      expect(Object.keys(draft.strings).sort()).toEqual([...keys].sort());
      for (const key of keys) {
        const want = (en.strings as Record<string, string>)[key].match(/\{\w+\}/g) ?? [];
        const got = (draft.strings as Record<string, string>)[key].match(/\{\w+\}/g) ?? [];
        expect([key, got.sort()]).toEqual([key, want.sort()]);
      }
    }
    expect(LANGUAGES.map(l => [l.value, l.beta])).toEqual([['en', false], ['af', true], ['tn', true]]);
  });

  it('fills placeholders and falls back to English, never a raw key', async () => {
    expect(translate('en', 'home.tankLeft', { litres: 120 })).toBe('About 120 L left — estimate');
    expect(translate('af', 'home.tankLeft', { litres: 120 })).toBe('Omtrent 120 L oor — skatting');
    await setLanguage('tn');
    expect(t('offline.needsConnection')).toBe('Go tlhokega kgolagano go fitlha sedirisiwa sa gago');
  });
});

describe('Unlink Telegram in Settings', () => {
  it('asks first, then unlinks and says how to connect again', async () => {
    await render(<SettingsScreen />);
    const row = await screen.findByTestId('unlink-telegram');
    await fireEvent.press(row);
    expect(mockAlerts[0]).toEqual({
      title: 'Unlink Telegram?',
      message: 'AgroFlow will stop sending messages to the Telegram chat you have now. You can connect again with a new code at any time.',
    });
    await waitFor(() => expect(api.disconnectTelegram).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('Telegram is unlinked. Connect again any time from Profile.')).toBeTruthy();
    expect(screen.queryByTestId('unlink-telegram')).toBeNull();     // nothing left to unlink
    expect(screen.getByText('Not connected')).toBeTruthy();
  });

  it('is not offered when Telegram is not connected', async () => {
    (api.fetchTelegramLinkStatus as jest.Mock).mockResolvedValueOnce({ linked: false, alertsEnabled: true });
    await render(<SettingsScreen />);
    expect(await screen.findByText('Not connected')).toBeTruthy();
    expect(screen.queryByTestId('unlink-telegram')).toBeNull();
  });
});

describe('soil note in plain, translated words', () => {
  it.each(['en', 'af', 'tn'] as const)('every moisture state has a %s word', (lang) => {
    for (const state of ['Dry', 'Optimal', 'Wet', 'Unknown']) {
      const key = `zone.moisture.${state}`;
      expect(translate(lang, key as Parameters<typeof translate>[1])).not.toBe(key);
    }
  });

  it('the soil tile on the zone screen says Good (from Optimal), never the stored word', async () => {
    mockAgro = baseAgro();
    mockParams = { id: '7' };
    await render(<ZoneControlScreen />);
    const tile = await screen.findByTestId('sensor-tile-soil');
    expect(tile.props.accessibilityLabel).toMatch(/Good/);
    expect(screen.queryByText('Optimal')).toBeNull();
  });
});
