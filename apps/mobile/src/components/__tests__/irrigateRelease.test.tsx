/// <reference types="jest" />
// See services/__tests__/doubleSubmit.test.ts for why this reference is per file.

/* Release fixes on Water now (docs/irrigate-path.md): Irrigate is off when the zone has no
 * kit that can hear it, the server's refusals read as plain words, and after Irrigate the
 * screen shows what the kit really did: Sending… -> Kit started watering -> Finished. */

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
const mockAlert = jest.fn();
jest.mock('@/components/AppAlert', () => ({ AppAlert: { alert: (...a: unknown[]) => mockAlert(...a) } }));
jest.mock('@/services/agroFlowApi', () => ({
  // The zone screen's Sensor Readings card asks for the farm's tank.
  fetchTankStatus: jest.fn(() => Promise.resolve({ farmId: 1, capacityLitres: null, estimatedRemainingLitres: null, isLow: false })),
  ApiHttpError: class ApiHttpError extends Error { status: number; constructor(m: string, s: number) { super(m); this.status = s; } },
  fetchZoneHardware: jest.fn(),
  fetchCommandStatus: jest.fn(),
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

import { act, render, screen, waitFor, fireEvent } from '@testing-library/react-native';
import * as api from '@/services/agroFlowApi';
import { mapZoneRow } from '@/context/AgroFlowContext';
import { kitStateFrom } from '@/hooks/useZoneKit';
import { adviceOverLimit, defaultRunMinutes, zoneMaxRunMinutes } from '@/lib/runLimit';
import { ACK_WAIT_MS, RUN_POLL_MS, runStateFrom } from '@/hooks/useRunStatus';
import ZoneControlScreen from '@/app/zone/[id]';

const hardware = api.fetchZoneHardware as jest.Mock;
const row = { id: 7, farm_id: 1, name: 'Bed 1', crop_type: 'spinach', irrigation_mode: 'automatic', moisture_threshold: 30, desired_moisture: 60, schedule_enabled: false, schedule_days: [], schedule_start_time: '05:30', schedule_duration_minutes: 10 };
const startManualIrrigation = jest.fn(() => Promise.resolve());
const agro = (maxRun?: number) => ({
  farm: { id: '1', name: 'Nkosi Farm' },
  zones: [mapZoneRow({ ...row, max_run_minutes: maxRun } as never, 0, undefined, undefined, null, null, [])],
  isZonesLoading: false, zonesError: null, isFarmLoading: false, farmError: null,
  refreshZones: jest.fn(), refreshFarms: jest.fn(),
  startManualIrrigation, stopManualIrrigation: jest.fn(), updateIrrigationMode: jest.fn(),
  updateZoneSettings: jest.fn(), updateZoneSchedule: jest.fn(),
});
const kit = (over: Record<string, unknown>) => ({ hardwareId: 1, deviceId: 'AF-1', online: true, ...over });

beforeAll(async () => {
  mockAgro = agro();
  hardware.mockResolvedValue(kit({}));
  await render(<ZoneControlScreen />);   // warm the renderer outside the 5 s test limit
}, 60000);
beforeEach(() => { jest.clearAllMocks(); mockAgro = agro(); });

describe('no kit connected', () => {
  it('reads the kit state from the Kit screen answer', () => {
    expect(kitStateFrom(null)).toBe('none');
    expect(kitStateFrom(kit({ hardwareId: null, deviceId: null, online: false }))).toBe('none');
    expect(kitStateFrom(kit({ online: false }))).toBe('offline');
    expect(kitStateFrom(kit({}))).toBe('online');
  });

  it('a zone with no kit: Irrigate is off and says why', async () => {
    hardware.mockResolvedValue(kit({ hardwareId: null, deviceId: null, online: false }));
    await render(<ZoneControlScreen />);
    expect((await screen.findByTestId('irrigate-no-kit')).props.children).toBe('No kit connected to this zone');
    expect(screen.getByTestId('irrigate-button').props.accessibilityState).toMatchObject({ disabled: true });
  });

  it('a kit not heard from in 5 minutes: Irrigate is off, with what to check', async () => {
    hardware.mockResolvedValue(kit({ online: false }));
    await render(<ZoneControlScreen />);
    expect((await screen.findByTestId('irrigate-no-kit')).props.children).toMatch(/power and WiFi/);
    expect(screen.getByTestId('irrigate-button').props.accessibilityState).toMatchObject({ disabled: true });
  });

  it('an online kit: Irrigate is on', async () => {
    hardware.mockResolvedValue(kit({}));
    await render(<ZoneControlScreen />);
    await waitFor(() => expect(hardware).toHaveBeenCalledWith(7));
    expect(screen.queryByTestId('irrigate-no-kit')).toBeNull();
    expect(screen.getByTestId('irrigate-button').props.accessibilityState).toMatchObject({ disabled: false });
  });

  it("the server's 409 reads as \"No kit connected to this zone\", not a generic failure", async () => {
    hardware.mockResolvedValue(kit({}));
    startManualIrrigation.mockRejectedValueOnce(new (api.ApiHttpError as unknown as new (m: string, s: number) => Error)('No kit connected to this zone.', 409) as never);
    await render(<ZoneControlScreen />);
    await waitFor(() => expect(hardware).toHaveBeenCalled());
    await fireEvent.press(screen.getByTestId('irrigate-button'));
    const confirm = mockAlert.mock.calls.at(-1)!;
    const startButton = (confirm[2] as { text: string; onPress?: () => Promise<void> }[]).find(b => b.onPress)!;
    await startButton.onPress!();
    await waitFor(() => expect(mockAlert).toHaveBeenLastCalledWith('Could not start watering', 'No kit connected to this zone'));
  });
});

describe('after Irrigate', () => {
  const status = api.fetchCommandStatus as jest.Mock;
  const answer = (state: string) => ({ id: 'cmd-1', zoneId: 7, command: 'start', source: 'manual', state, label: state, durationSeconds: 60, createdAt: '', startedAt: null, finishedAt: null });

  it('reads the server state, and no answer for 60 s as no response', () => {
    expect(runStateFrom(answer('started') as never, 0, 1000)).toBe('started');
    expect(runStateFrom(answer('finished') as never, 0, 1000)).toBe('finished');
    expect(runStateFrom(null, 0, ACK_WAIT_MS - 1)).toBe('sent');
    expect(runStateFrom(null, 0, ACK_WAIT_MS + 1)).toBe('no_response');
  });

  async function pressStart() {
    await render(<ZoneControlScreen />);
    await waitFor(() => expect(hardware).toHaveBeenCalled());
    await fireEvent.press(screen.getByTestId('irrigate-button'));
    const confirm = mockAlert.mock.calls.at(-1)!;
    const start = (confirm[2] as { onPress?: () => Promise<void> }[]).find(b => b.onPress)!;
    await act(async () => { await start.onPress!(); });
  }

  afterEach(() => { jest.useRealTimers(); });

  it('Sending… then Kit started watering on the ack, then Finished on the run report', async () => {
    hardware.mockResolvedValue(kit({}));
    startManualIrrigation.mockResolvedValueOnce('cmd-1' as never);
    status.mockResolvedValueOnce(answer('sent')).mockResolvedValueOnce(answer('started')).mockResolvedValue(answer('finished'));
    jest.useFakeTimers();
    await pressStart();
    expect(screen.getByTestId('run-status').props.children).toBe('Sending…');
    await act(async () => { jest.advanceTimersByTime(RUN_POLL_MS); });
    await act(async () => { jest.advanceTimersByTime(RUN_POLL_MS); });
    await waitFor(() => expect(screen.getByTestId('run-status').props.children).toBe('Kit started watering'));
    await act(async () => { jest.advanceTimersByTime(RUN_POLL_MS); });
    await waitFor(() => expect(screen.getByTestId('run-status').props.children).toBe('Finished'));
    expect(status).toHaveBeenCalledWith('cmd-1');
    const calls = status.mock.calls.length;
    await act(async () => { jest.advanceTimersByTime(RUN_POLL_MS * 5); });
    expect(status.mock.calls.length).toBe(calls);   // stops once finished
  });

  it("says \"Kit didn't respond — check it's online\" when the kit never acknowledges", async () => {
    hardware.mockResolvedValue(kit({}));
    startManualIrrigation.mockResolvedValueOnce('cmd-2' as never);
    status.mockResolvedValue(answer('no_response'));
    jest.useFakeTimers();
    await pressStart();
    await act(async () => { jest.advanceTimersByTime(RUN_POLL_MS); });
    await waitFor(() => expect(screen.getByTestId('run-status').props.children).toBe("Kit didn't respond — check it's online"));
  });

  it('with no answer from the server at all, says the same after 60 s', async () => {
    hardware.mockResolvedValue(kit({}));
    startManualIrrigation.mockResolvedValueOnce('cmd-3' as never);
    status.mockRejectedValue(new Error('offline'));
    jest.useFakeTimers();
    await pressStart();
    for (let i = 0; i < Math.ceil(ACK_WAIT_MS / RUN_POLL_MS) + 1; i++) {
      await act(async () => { jest.advanceTimersByTime(RUN_POLL_MS); });
    }
    await waitFor(() => expect(screen.getByTestId('run-status').props.children).toBe("Kit didn't respond — check it's online"));
  });
});

describe("the zone's maximum run time", () => {
  it('reads the stored maximum, and 5 when it is missing or out of range', () => {
    expect(zoneMaxRunMinutes(30)).toBe(30);
    expect(zoneMaxRunMinutes(null)).toBe(5);
    expect(zoneMaxRunMinutes(0)).toBe(5);
    expect(zoneMaxRunMinutes(500)).toBe(5);
    expect(defaultRunMinutes(3)).toBe(3);
    expect(defaultRunMinutes(60)).toBe(5);
    expect(adviceOverLimit(66, 5)).toBe(true);
    expect(adviceOverLimit(5, 5)).toBe(false);
    expect(adviceOverLimit(null, 5)).toBe(false);
  });

  it('the duration box starts at the maximum when it is under 5 minutes, and caps more at it (AF-05)', async () => {
    hardware.mockResolvedValue(kit({}));
    mockAgro = agro(3);
    await render(<ZoneControlScreen />);
    await waitFor(() => expect(screen.getByDisplayValue('3')).toBeTruthy());
    await fireEvent.changeText(screen.getByDisplayValue('3'), '4');
    await fireEvent.press(screen.getByTestId('irrigate-button'));
    // Capped, not refused, and said before the farmer confirms.
    const [title, body, buttons] = mockAlert.mock.calls[mockAlert.mock.calls.length - 1];
    expect(title).toBe('Water Bed 1 now?');
    expect(body).toContain("Capped to 3 min (this zone's limit)");
    await act(async () => { await (buttons as { text: string; onPress?: () => Promise<void> }[]).find(b => b.text === 'Start')!.onPress!(); });
    expect(startManualIrrigation).toHaveBeenCalledWith(expect.anything(), 3);
  });

  it('a zone allowed 60 minutes takes a 45-minute run', async () => {
    hardware.mockResolvedValue(kit({}));
    mockAgro = agro(60);
    await render(<ZoneControlScreen />);
    await waitFor(() => expect(hardware).toHaveBeenCalled());
    await fireEvent.changeText(screen.getByDisplayValue('5'), '45');
    await fireEvent.press(screen.getByTestId('irrigate-button'));
    const confirm = mockAlert.mock.calls.at(-1)!;
    const start = (confirm[2] as { onPress?: () => Promise<void> }[]).find(b => b.onPress)!;
    await act(async () => { await start.onPress!(); });
    expect(startManualIrrigation).toHaveBeenCalledWith('7', 45);
  });
});
