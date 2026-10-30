/// <reference types="jest" />
// See services/__tests__/doubleSubmit.test.ts for why this reference is per file.

/* Dismiss in the app: x dismisses (recorded on the server, never deleted), Undo restores
 * within 5 s, an important item asks for an optional note, and Dismissed lists what was
 * dismissed with Restore. */

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
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);
jest.mock('lucide-react-native', () =>
  new Proxy({}, { get: (_target, name) => (name === '__esModule' ? false : () => null) })
);
jest.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: null, profile: null, signOut: jest.fn(), isLoading: false }) }));
jest.mock('@/lib/router', () => ({ router: { push: jest.fn(), back: jest.fn() } }));
jest.mock('expo-router', () => {
  const React = jest.requireActual('react');
  return { useFocusEffect: (effect: () => void | (() => void)) => React.useEffect(effect, [effect]) };
});

let mockAgro: Record<string, unknown> = {};
jest.mock('@/context/AgroFlowContext', () => ({ useAgroFlow: () => mockAgro }));
jest.mock('@/services/insightsService', () => ({
  fetchAlertExplanations: jest.fn(() => Promise.resolve({})),
  todayInSast: () => '2026-10-06',
}));
jest.mock('@/services/agroFlowApi', () => ({
  fetchDismissals: jest.fn(() => Promise.resolve([])),
  dismissNotification: jest.fn(() => Promise.resolve({ id: 77, message: 'Dismissed.' })),
  restoreNotification: jest.fn(() => Promise.resolve({ id: 77, message: 'Restored.' })),
  fetchZoneInsights: jest.fn(),
}));

import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as api from '@/services/agroFlowApi';
import AlertsScreen from '@/app/(tabs)/alerts';
import { ZoneInsightsCard } from '../ZoneInsightsCard';
import { activeDismissal, alertKey, insightKey } from '@/lib/dismissals';

const base = {
  farm: { id: '1', name: 'Alpha' }, markAlertAsRead: jest.fn(), isZonesLoading: false, zonesError: null,
  refreshZones: jest.fn(), isFarmLoading: false, farmError: null, refreshFarms: jest.fn(),
};
const alerts = [
  { id: 'database-42', title: 'Telegram not linked', message: 'm', type: 'info', zone: 'Bed 1', zoneId: null, read: true, timestamp: '2026-10-06T06:00:00Z' },
  { id: 'database-43', title: 'Kit offline', message: 'm', type: 'critical', zone: 'Bed 1', zoneId: null, read: true, timestamp: '2026-10-06T07:00:00Z' },
  { id: 'local-1', title: 'Watering started', message: 'm', type: 'info', zone: 'Bed 1', zoneId: null, read: true, timestamp: '2026-10-06T05:00:00Z' },
];

beforeAll(async () => {
  mockAgro = { ...base, alerts };
  await render(<AlertsScreen />);
}, 60000);
beforeEach(() => {
  jest.clearAllMocks();
  mockAgro = { ...base, alerts };
  (api.fetchDismissals as jest.Mock).mockResolvedValue([]);
});

describe('dismissal keys', () => {
  it('names server alerts and insights; local notices have no key', () => {
    expect(alertKey('database-42')).toBe('42');
    expect(alertKey('local-1')).toBeNull();
    expect(insightKey(7, 'water_now', '2026-10-06')).toBe('7:water_now:2026-10-06');
    const rows = [{ id: 1, kind: 'alert', itemKey: '42', restoredAt: null }, { id: 2, kind: 'alert', itemKey: '43', restoredAt: '2026-10-06T08:00:00Z' }] as never[];
    expect(activeDismissal(rows, 'alert', '42')).toBeTruthy();
    expect(activeDismissal(rows, 'alert', '43')).toBeUndefined();   // restored: showing again
  });
});

describe('Alerts', () => {
  it('refreshes backend alerts whenever the tab receives focus', async () => {
    mockAgro = { ...base, alerts: [] };
    await render(<AlertsScreen />);
    await waitFor(() => expect(base.refreshZones).toHaveBeenCalled());
  });

  it('dismisses with ×, and Undo restores', async () => {
    await render(<AlertsScreen />);
    expect(screen.queryByRole('button', { name: 'Dismiss: Watering started' })).toBeNull();   // local notice
    await fireEvent.press(screen.getByRole('button', { name: 'Dismiss: Telegram not linked' }));
    await waitFor(() => expect(api.dismissNotification).toHaveBeenCalledWith('alert', '42', null));
    await fireEvent.press(await screen.findByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(api.restoreNotification).toHaveBeenCalledWith(77));
  });

  it('an important alert asks for an optional note first', async () => {
    await render(<AlertsScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Dismiss: Kit offline' }));
    await fireEvent.changeText(screen.getByLabelText('Note (optional)'), 'Plug was out');
    await fireEvent.press(screen.getByRole('button', { name: 'Confirm dismiss' }));
    await waitFor(() => expect(api.dismissNotification).toHaveBeenCalledWith('alert', '43', 'Plug was out'));
  });

  it('a dismissed alert leaves the list and is under Dismissed with who and Restore', async () => {
    (api.fetchDismissals as jest.Mock).mockResolvedValue([{
      id: 5, kind: 'alert', itemKey: '42', farmId: 1, title: 'Telegram not linked', raisedAt: '2026-10-06T06:00:00Z',
      critical: false, dismissedByName: 'Thandi', dismissedAt: '2026-10-06T08:00:00Z', note: null, restoredByName: null, restoredAt: null,
    }]);
    await render(<AlertsScreen />);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Dismiss: Telegram not linked' })).toBeNull());
    await fireEvent.press(screen.getByRole('radio', { name: 'Dismissed' }));
    expect(screen.getByText('Dismissed 6 Oct 2026, 10:00 by Thandi')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Restore Telegram not linked' }));
    await waitFor(() => expect(api.restoreNotification).toHaveBeenCalledWith(5));
  });
});

describe('Advice card', () => {
  const insights = [
    { insightType: 'water_now', severity: 'act_now', message: 'Water Bed 1 now.' },
    { insightType: 'hot_days', severity: 'info', message: 'Hot days ahead.' },
  ];

  it('dismisses one insight by zone, type and day; act-now advice asks for a note', async () => {
    await render(<ZoneInsightsCard zoneId={7} insights={insights as never} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Dismiss: Hot days ahead.' }));
    await waitFor(() => expect(api.dismissNotification).toHaveBeenCalledWith('insight', '7:hot_days:2026-10-06', null));
    expect(screen.queryByText('Hot days ahead.')).toBeNull();

    await fireEvent.press(screen.getByRole('button', { name: 'Dismiss: Water Bed 1 now.' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Confirm dismiss' }));
    await waitFor(() => expect(api.dismissNotification).toHaveBeenCalledWith('insight', '7:water_now:2026-10-06', null));
  });
});
