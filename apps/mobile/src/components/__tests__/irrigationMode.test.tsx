/// <reference types="jest" />
// See services/__tests__/doubleSubmit.test.ts for why this reference is per file.

/* Part 0: a zone saved as Manual used to read as Automatic in the app. Here: the mapping both
 * ways, the zone row mapper, and the zone screen saving and showing all three modes. */

import type { ReactNode } from 'react';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);
jest.mock('@/lib/supabase', () => ({ supabase: { auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) } } }));
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
jest.mock('lucide-react-native', () =>
  new Proxy({}, { get: (_target, name) => (name === '__esModule' ? false : () => null) })
);
jest.mock('@/lib/router', () => ({
  router: { push: jest.fn(), back: jest.fn(), canGoBack: () => true, navigate: jest.fn(), replace: jest.fn() },
}));
jest.mock('expo-router', () => {
  const React = jest.requireActual('react');
  return { useLocalSearchParams: () => ({ id: '7' }), useFocusEffect: (fn: () => void) => React.useEffect(fn, [fn]) };
});
jest.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: { name: 'Thandi' } }) }));
jest.mock('@/services/insightsService', () => ({ fetchAlertExplanations: jest.fn(() => Promise.resolve({})), todayInSast: () => '2026-10-19' }));
jest.mock('@/services/agroFlowApi', () => ({
  fetchFarmerDashboard: jest.fn(),
  sendManualIrrigationCommand: jest.fn(),
  updateZoneThroughApi: jest.fn(() => Promise.resolve()),
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
}));

let mockAgro: Record<string, unknown> = {};
jest.mock('@/context/AgroFlowContext', () => {
  const actual = jest.requireActual('@/context/AgroFlowContext');
  return { ...actual, useAgroFlow: () => mockAgro };
});

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { irrigationModeFromDb, irrigationModeLabel, irrigationModeToDb, IRRIGATION_MODES } from '@/lib/irrigationMode';
import { mapZoneRow } from '@/context/AgroFlowContext';
import ZoneControlScreen from '@/app/zone/[id]';

function row(irrigation_mode: string | null) {
  return { id: 7, farm_id: 1, name: 'Bed 1', crop_type: 'spinach', irrigation_mode, moisture_threshold: 30, desired_moisture: 60, schedule_enabled: irrigation_mode === 'scheduled', schedule_days: [], schedule_start_time: '05:30', schedule_duration_minutes: 10 };
}

describe('mode mapping', () => {
  it('reads each stored mode as itself, and anything unknown as manual', () => {
    expect(irrigationModeFromDb('automatic')).toBe('automatic');
    expect(irrigationModeFromDb('scheduled')).toBe('scheduled');
    expect(irrigationModeFromDb('manual')).toBe('manual');
    expect(irrigationModeFromDb('Manual')).toBe('manual');
    expect(irrigationModeFromDb(null)).toBe('manual');
    expect(irrigationModeFromDb('eco')).toBe('manual');
  });

  it('writes each mode with flags that agree with it, and round-trips', () => {
    expect(irrigationModeToDb('manual')).toEqual({ irrigationMode: 'manual', automationEnabled: false, scheduleEnabled: false });
    expect(irrigationModeToDb('automatic')).toEqual({ irrigationMode: 'automatic', automationEnabled: true, scheduleEnabled: false });
    expect(irrigationModeToDb('scheduled')).toEqual({ irrigationMode: 'scheduled', automationEnabled: false, scheduleEnabled: true });
    for (const mode of IRRIGATION_MODES) expect(irrigationModeFromDb(irrigationModeToDb(mode).irrigationMode)).toBe(mode);
    expect(IRRIGATION_MODES.map(irrigationModeLabel)).toEqual(['Automatic', 'Scheduled', 'Manual']);
  });

  it('a zone saved as manual reads as manual (the bug), with automation off', () => {
    const zone = mapZoneRow(row('manual') as never, 0, undefined, undefined, null, null, []);
    expect(zone.irrigation.mode).toBe('manual');
    expect(zone.irrigation.automation.enabled).toBe(false);
    expect(mapZoneRow(row('automatic') as never, 0, undefined, undefined, null, null, []).irrigation.mode).toBe('automatic');
    expect(mapZoneRow(row('scheduled') as never, 0, undefined, undefined, null, null, []).irrigation.mode).toBe('scheduled');
    expect(mapZoneRow(row('scheduled') as never, 0, undefined, undefined, null, null, []).irrigation.automation.enabled).toBe(false);
  });
});

describe('zone screen', () => {
  const updateIrrigationMode = jest.fn(() => Promise.resolve());
  const startManualIrrigation = jest.fn(() => Promise.resolve());

  function agro(mode: string) {
    return {
      farm: { id: '1', name: 'Nkosi Farm' },
      zones: [mapZoneRow(row(mode) as never, 0, undefined, undefined, null, null, [])],
      isZonesLoading: false, zonesError: null, isFarmLoading: false, farmError: null,
      refreshZones: jest.fn(), refreshFarms: jest.fn(),
      startManualIrrigation, stopManualIrrigation: jest.fn(), updateIrrigationMode,
      updateZoneSettings: jest.fn(), updateZoneSchedule: jest.fn(),
    };
  }

  beforeAll(async () => {
    mockAgro = agro('manual');
    await render(<ZoneControlScreen />);   // warm the renderer outside the 5 s test limit
  }, 60000);
  beforeEach(() => jest.clearAllMocks());

  it('shows a saved Manual zone as Manual, and says AgroFlow will not water it', async () => {
    mockAgro = agro('manual');
    await render(<ZoneControlScreen />);
    const manual = await screen.findByRole('button', { name: 'Manual' });
    expect(manual.props.accessibilityState).toMatchObject({ selected: true });
    expect(screen.getByRole('button', { name: 'Automatic' }).props.accessibilityState).toMatchObject({ selected: false });
    expect(screen.getByText(/AgroFlow will not water this zone by itself/)).toBeTruthy();
  });

  it('saves Manual when chosen on an Automatic zone (not just a preview)', async () => {
    mockAgro = agro('automatic');
    await render(<ZoneControlScreen />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Manual' }));
    await waitFor(() => expect(updateIrrigationMode).toHaveBeenCalledWith('7', 'manual'));
  });

  it('saves Automatic and Scheduled too', async () => {
    mockAgro = agro('manual');
    await render(<ZoneControlScreen />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Automatic' }));
    await waitFor(() => expect(updateIrrigationMode).toHaveBeenCalledWith('7', 'automatic'));
    await act(async () => { await Promise.resolve(); });
    await fireEvent.press(screen.getByRole('button', { name: 'Scheduled' }));
    await waitFor(() => expect(updateIrrigationMode).toHaveBeenCalledWith('7', 'scheduled'));
  });

  it('a one-off run is offered in every mode, capped at the kit’s 5 minutes', async () => {
    mockAgro = agro('automatic');
    await render(<ZoneControlScreen />);
    expect(await screen.findByText('Start Manual Run')).toBeTruthy();
    expect(screen.getByDisplayValue('5')).toBeTruthy();
    expect(updateIrrigationMode).not.toHaveBeenCalled();   // seeing it changes nothing
  });
});
