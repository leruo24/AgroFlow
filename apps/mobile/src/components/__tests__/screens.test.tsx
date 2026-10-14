/// <reference types="jest" />
// See services/__tests__/doubleSubmit.test.ts for why this reference is per file.

/* The app's screens rendered with their real code, with only the network and context faked:
 * Finish setup (with the marked flow-rate test bottle helper), the login screen's "Ask for a call",
 * Reports, the forecast, alerts history and help. */

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

const mockPush = jest.fn();
jest.mock('@/lib/router', () => ({
  router: { push: (...a: unknown[]) => mockPush(...a), back: jest.fn(), canGoBack: () => true, navigate: jest.fn(), replace: jest.fn() },
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
jest.mock('@/context/AuthContext', () => ({ useAuth: () => ({ signIn: jest.fn(), isLoading: false }) }));

jest.mock('@/services/insightsService', () => ({ fetchAlertExplanations: jest.fn(() => Promise.resolve({})) }));

jest.mock('@/services/agroFlowApi', () => ({
  fetchFarmToday: jest.fn(),
  saveZoneSetup: jest.fn(() => Promise.resolve({ message: "Saved. Today's advice now uses it." })),
  fetchRecommendedSettings: jest.fn(() => Promise.resolve({ available: false, text: '' })),
  resetZoneToRecommended: jest.fn(),
  saveZoneCalibration: jest.fn(),
  fetchReportRequests: jest.fn(),
  fetchAutoReportSummary: jest.fn(() => Promise.resolve(null)),
  createReportRequest: jest.fn(() => Promise.resolve({ message: 'Your report is being made.' })),
  openReportPdf: jest.fn(() => Promise.resolve()),
  stopAutoReports: jest.fn(),
  fetchForecast: jest.fn(),
  // The Alerts screen reads this farm's dismissals.
  fetchDismissals: jest.fn(() => Promise.resolve([])),
  dismissNotification: jest.fn(),
  restoreNotification: jest.fn(),
}));

import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as api from '@/services/agroFlowApi';
import ZoneSetupScreen from '@/app/zone-setup';
import LoginScreen from '@/app/login';
import ReportsScreen from '@/app/reports';
import ForecastScreen from '@/app/forecast';
import AlertsScreen from '@/app/(tabs)/alerts';
import { HelpButton } from '@/components/HelpButton';
import { formatSast } from '@/lib/sastTime';

const today = {
  zoneId: 7, name: 'Bed 1',
  action: { kind: 'setup', text: 'Finish setup: add the planting date' },
  why: null,
  confidence: { level: 'medium', reason: 'Medium: based on the weather; the planting date is missing.' },
  confidenceExplanation: null,
  nextStep: { field: 'planting_date', ask: 'Add the planting date.' },
  setup: { crop: true, plantingDate: false, soil: true, area: true, flowRate: false, calibrated: false, hasKit: false },
};

beforeAll(async () => {
  // Warm the renderer once outside any test's 5 s (see todayCard.test.tsx).
  (api.fetchFarmToday as jest.Mock).mockResolvedValue({ farmId: 1, day: '2026-10-06', zones: [today] });
  mockAgro = { farm: { id: '1', name: 'Alpha' } };
  mockParams = { zoneId: '7' };
  await render(<ZoneSetupScreen />);
}, 60000);

beforeEach(() => {
  jest.clearAllMocks();
  (api.fetchFarmToday as jest.Mock).mockResolvedValue({ farmId: 1, day: '2026-10-06', zones: [today] });
});

describe('Finish setup', () => {
  beforeEach(() => {
    mockAgro = { farm: { id: '1', name: 'Alpha' } };
    mockParams = { zoneId: '7' };
  });

  it('shows what is done and what is not, with the confidence', async () => {
    await render(<ZoneSetupScreen />);
    expect(await screen.findByText('Medium confidence')).toBeTruthy();
    expect(screen.getAllByText('To do').length).toBe(2);   // planting date, flow rate
    expect(screen.getAllByText('Done').length).toBe(2);    // soil, size
    expect(screen.queryByText('Soil sensor wet/dry setup')).toBeNull();   // no kit, no calibration step
  });

  it('works out litres a minute from the marked flow-rate test bottle and saves it', async () => {
    await render(<ZoneSetupScreen />);
    await screen.findByText('Medium confidence');
    await fireEvent.changeText(screen.getByLabelText('Seconds to fill the bottle'), '15');
    expect(screen.getByText('That is about 2 litres a minute.')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Save flow rate' }));
    await waitFor(() => expect(api.saveZoneSetup).toHaveBeenCalledWith(7, { flowRateLpm: 2 }));
    expect(await screen.findByText("Saved. Today's advice now uses it.")).toBeTruthy();
    // The confidence is read again after a save.
    expect((api.fetchFarmToday as jest.Mock).mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('saves the planting date from "about how many weeks ago"', async () => {
    await render(<ZoneSetupScreen />);
    await screen.findByText('Medium confidence');
    await fireEvent.changeText(screen.getByLabelText('Weeks since planting'), '3');
    await fireEvent.press(screen.getByRole('button', { name: 'Save planting date' }));
    await waitFor(() => expect(api.saveZoneSetup).toHaveBeenCalledWith(7, { plantingDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) }));
  });
});

describe('Login', () => {
  it('offers "Ask for a call" to someone not on AgroFlow yet', async () => {
    await render(<LoginScreen />);
    await fireEvent.press(screen.getByText('Not a farmer on AgroFlow yet? Ask for a call'));
    expect(mockPush).toHaveBeenCalledWith('/enquiry');
  });
});

describe('Reports', () => {
  const row = (id: number, status: 'ready' | 'failed' | 'preparing', label: string) => ({
    id, reportType: 'water_usage', reportTypeLabel: `Water usage ${id}`, zoneId: null, zoneName: null,
    periodStart: '2026-09-29', periodEnd: '2026-10-05', periodLabel: '29 Sep - 5 Oct', status, statusLabel: label,
    filePath: status === 'ready' ? `/api/farmer/reports/water-usage/pdf?x=${id}` : null, requestedVia: 'app',
    createdAt: '2026-10-06T06:00:00Z', completedAt: null, error: status === 'failed' ? 'There was no data to put in this report.' : null,
  });

  beforeEach(() => {
    mockAgro = { farm: { id: '1', name: 'Alpha' }, zones: [{ id: '7', name: 'Bed 1' }] };
    (api.fetchReportRequests as jest.Mock).mockResolvedValue([row(1, 'ready', 'Ready'), row(2, 'failed', 'Could not be made'), row(3, 'preparing', 'Being made')]);
  });

  it('lists each report with its status, and opens a ready one', async () => {
    await render(<ReportsScreen />);
    expect(await screen.findByText('Ready')).toBeTruthy();
    expect(screen.getByText('Could not be made')).toBeTruthy();
    expect(screen.getByText('Being made')).toBeTruthy();
    expect(screen.getByText('There was no data to put in this report.')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Open the Water usage 1 report' }));
    expect(api.openReportPdf).toHaveBeenCalledWith('/api/farmer/reports/water-usage/pdf?x=1');
    expect(screen.queryByRole('button', { name: 'Open the Water usage 2 report' })).toBeNull();
  });

  it('asks for a report for the farm', async () => {
    await render(<ReportsScreen />);
    await screen.findByText('Ready');
    await fireEvent.press(screen.getByRole('button', { name: 'Request this report' }));
    await waitFor(() => expect(api.createReportRequest).toHaveBeenCalledWith(
      expect.objectContaining({ reportType: 'water_usage', period: 'last_7_days', farmId: '1', zoneId: null })));
    expect(await screen.findByText('Your report is being made.')).toBeTruthy();
  });
});

describe('Forecast', () => {
  it('shows each day with its advice, and the source', async () => {
    mockAgro = { farm: { id: '1', name: 'Alpha' }, zones: [] };
    mockParams = {};
    (api.fetchForecast as jest.Mock).mockResolvedValue({
      farmId: 1, zoneId: null, zoneName: null, message: null, source: 'Open-Meteo forecast',
      days: [
        { date: '2026-10-07', weekday: 'Wednesday', minC: 12, maxC: 27, rainMm: 0, humidityPercent: 40, icon: 'sun', advice: 'Water as usual.' },
        { date: '2026-10-08', weekday: 'Thursday', minC: 10, maxC: 18, rainMm: 14, humidityPercent: 90, icon: 'rain', advice: 'Rain will water for you.' },
      ],
    });
    await render(<ForecastScreen />);
    expect(await screen.findByText('Rain will water for you.')).toBeTruthy();
    expect(screen.getByText('Water as usual.')).toBeTruthy();
    expect(screen.getByText('Open-Meteo forecast')).toBeTruthy();
  });
});

describe('Alerts history', () => {
  const base = { farm: { id: '1', name: 'Alpha' }, markAlertAsRead: jest.fn(), isZonesLoading: false, zonesError: null,
    refreshZones: jest.fn(), isFarmLoading: false, farmError: null, refreshFarms: jest.fn() };

  it('lists alerts newest first, in SAST, and marks one read when opened', async () => {
    const markAlertAsRead = jest.fn();
    mockAgro = { ...base, markAlertAsRead, alerts: [
      { id: 'a1', title: 'Older', message: 'm1', type: 'warning', zone: 'Bed 1', zoneId: null, read: false, timestamp: '2026-10-05T06:00:00Z' },
      { id: 'a2', title: 'Newer', message: 'm2', type: 'critical', zone: 'Bed 1', zoneId: null, read: true, timestamp: '2026-10-05T22:30:00Z' },
    ] };
    await render(<AlertsScreen />);
    const titles = screen.getAllByText(/^(Older|Newer)$/).map((t) => t.props.children);
    expect(titles).toEqual(['Newer', 'Older']);
    expect(screen.getByText('Bed 1 · 6 Oct 2026, 00:30')).toBeTruthy();   // 22:30 UTC is 00:30 the next day in SAST
    await fireEvent.press(screen.getByRole('button', { name: 'Older, unread, mark read' }));
    expect(markAlertAsRead).toHaveBeenCalledWith('a1');
  });

  it('says so when there are none', async () => {
    mockAgro = { ...base, alerts: [] };
    await render(<AlertsScreen />);
    expect(screen.getByText('No alerts right now')).toBeTruthy();
  });
});

describe('Help', () => {
  it('opens the help for the page', async () => {
    await render(<HelpButton screen="alerts" />);
    await fireEvent.press(screen.getByRole('button', { name: 'Help for this page' }));
    expect(screen.getAllByText(/./).length).toBeGreaterThan(2);
  });
});

describe('SAST times', () => {
  it('is South African time whatever the phone says', () => {
    expect(formatSast('2026-10-05T22:30:00Z')).toBe('6 Oct 2026, 00:30');
    expect(formatSast('2026-12-31T21:59:00Z')).toBe('31 Dec 2026, 23:59');
    expect(formatSast('2026-12-31T22:01:00Z')).toBe('1 Jan 2027, 00:01');
    expect(formatSast('not a date')).toBeNull();
    expect(formatSast(null)).toBeNull();
  });
});
