/// <reference types="jest" />
// See services/__tests__/doubleSubmit.test.ts for why this reference is per file.

/* The audit fixes of 22 October 2026, Part A, in the app (docs/audit/fix-report-2026-10-23.md):
 *   AF-04  an alert reads as read only after the save succeeded; a failed save stays unread with Try again
 *   AF-17  a forecast that fails to load offers Try again, and recovers in place
 *   AF-05  a saved schedule shows its state (Active / Inactive / Default) and its capped length */

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
jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('lucide-react-native', () =>
  new Proxy({}, { get: (_target, name) => (name === '__esModule' ? false : () => null) })
);
jest.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: null, profile: null, signOut: jest.fn(), isLoading: false }) }));
jest.mock('@/lib/router', () => ({ router: { push: jest.fn(), back: jest.fn(), canGoBack: () => false, navigate: jest.fn() } }));
jest.mock('expo-router', () => ({ useLocalSearchParams: () => ({}), useFocusEffect: () => undefined }));

let mockAgro: Record<string, unknown> = {};
jest.mock('@/context/AgroFlowContext', () => ({ useAgroFlow: () => mockAgro }));
jest.mock('@/services/insightsService', () => ({
  fetchAlertExplanations: jest.fn(() => Promise.resolve({})),
  todayInSast: () => '2026-10-23',
}));
jest.mock('@/services/agroFlowApi', () => ({
  fetchDismissals: jest.fn(() => Promise.resolve([])),
  dismissNotification: jest.fn(),
  restoreNotification: jest.fn(),
  fetchForecast: jest.fn(),
}));

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as api from '@/services/agroFlowApi';
import AlertsScreen from '@/app/(tabs)/alerts';
import ForecastScreen from '@/app/forecast';
import { effectiveRunMinutes, scheduleState } from '@/lib/schedule';

const unread = { id: 'database-42', title: 'Kit offline', message: 'm', type: 'warning', zone: 'Bed 1', zoneId: null, read: false, timestamp: '2026-10-23T06:00:00Z' };
const base = { farm: { id: '1', name: 'Alpha' }, isZonesLoading: false, zonesError: null, refreshZones: jest.fn(), isFarmLoading: false, farmError: null, refreshFarms: jest.fn() };

describe('AF-04: alert read state', () => {
  it('a failed save keeps the alert unread and offers Try again; a later success marks it', async () => {
    const markAlertAsRead = jest.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    mockAgro = { ...base, alerts: [unread], markAlertAsRead };
    await render(<AlertsScreen />);
    await act(async () => { fireEvent.press(screen.getByLabelText('Kit offline, unread, mark read')); });
    expect(await screen.findByTestId('alert-read-failed-database-42')).toBeTruthy();
    expect(screen.getByText('Could not save that you read this. It still shows as unread.')).toBeTruthy();
    await act(async () => { fireEvent.press(screen.getByTestId('alert-read-retry-database-42')); });
    expect(markAlertAsRead).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(screen.queryByTestId('alert-read-failed-database-42')).toBeNull());
  });
});

describe('AF-17: forecast Try again', () => {
  it('shows Try again on a failure and recovers on the same screen', async () => {
    mockAgro = { farm: { id: '1', name: 'Alpha' } };
    const fetchForecast = api.fetchForecast as jest.Mock;
    fetchForecast.mockRejectedValueOnce(new Error('The forecast could not be loaded.'))
      .mockResolvedValueOnce({ farmId: 1, days: [{ date: '2026-10-24', icon: 'sun', tminC: 10, tmaxC: 25, rainMm: 0, advice: null }] });
    await render(<ForecastScreen />);
    expect(await screen.findByTestId('forecast-retry')).toBeTruthy();
    await act(async () => { fireEvent.press(screen.getByTestId('forecast-retry')); });
    await waitFor(() => expect(screen.queryByTestId('forecast-error')).toBeNull());
    expect(fetchForecast).toHaveBeenCalledTimes(2);
  });
});

describe('AF-05: schedule state and capped length', () => {
  const saved = { enabled: true, days: ['Mon'], startTime: '05:30', durationMinutes: 20 };
  it('reads Active only in Scheduled mode, Inactive otherwise, Default when nothing is saved', () => {
    expect(scheduleState('scheduled', saved)).toBe('active');
    expect(scheduleState('automatic', saved)).toBe('inactive');
    expect(scheduleState('scheduled', { ...saved, enabled: false })).toBe('inactive');
    expect(scheduleState('scheduled', { ...saved, durationMinutes: 0 })).toBe('default');
  });
  it('a 20-minute schedule on a 5-minute zone runs 5 minutes', () => {
    expect(effectiveRunMinutes(20, 5)).toEqual({ minutes: 5, capped: true, max: 5 });
    expect(effectiveRunMinutes(4, 5)).toEqual({ minutes: 4, capped: false, max: 5 });
  });
});
