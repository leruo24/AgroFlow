/// <reference types="jest" />
// See services/__tests__/doubleSubmit.test.ts for why this reference is per file.

/* The Kit tab (fix/kit-setup-info):
 *   each status line with fixtures (healthy, sensor out of range, offline, unconfirmed command, no kit);
 *   the setup Wi-Fi shown whether or not the kit is online. The bar and More: moreTab.test.tsx. */

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
const mockPush = jest.fn();
jest.mock('@/lib/router', () => ({ router: { push: (...a: unknown[]) => mockPush(...a), back: jest.fn(), canGoBack: () => false, navigate: jest.fn() } }));
jest.mock('expo-router', () => ({ useLocalSearchParams: () => ({}), useFocusEffect: () => undefined }));
let mockAgro: Record<string, unknown> = {};
jest.mock('@/context/AgroFlowContext', () => ({ useAgroFlow: () => mockAgro }));
jest.mock('@/services/agroFlowApi', () => ({ fetchFarmKits: jest.fn() }));

import { fireEvent, render, screen } from '@testing-library/react-native';
import * as api from '@/services/agroFlowApi';
import KitTabScreen from '@/app/(tabs)/kit';
import type { KitCard, KitLine } from '@/services/agroFlowApi';

const NOW = new Date('2026-10-23T08:00:00Z').getTime();
const ago = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();
const line = (key: string, state: string, tone: KitLine['tone'], extra: Partial<KitLine> = {}): KitLine =>
  ({ key, state, tone, at: null, value: null, ...extra });
const healthyLines = (): KitLine[] => [
  line('connection', 'online', 'ok', { at: ago(2) }),
  line('wifi', 'strong', 'ok', { value: '-55' }),
  line('soil', 'ok', 'ok', { at: ago(2) }),
  line('climate', 'ok', 'ok', { at: ago(2) }),
  line('pump', 'confirmed', 'ok', { at: '2026-10-23T06:15:00Z', value: 'start' }),
  line('backlog', 'none', 'info', { value: '0' }),
  line('firmware', 'current', 'info', { value: '1.7.1' }),
  line('safety', 'limits', 'info', { value: '5|3' }),
];
const card = (zoneId: number, overall: KitCard['overall'], lines: KitLine[], hasKit = true): KitCard => ({
  zoneId, zoneName: `Bed ${zoneId}`, hasKit, deviceId: hasKit ? '0123456789AB' : null, deviceName: null,
  setupNetworkName: hasKit ? 'AgroFlow-Setup-89AB' : null, setupNetworkPassword: hasKit ? 'AF-6789AB' : null, overall, lines,
});
const swap = (lines: KitLine[], replacement: KitLine) => lines.map(l => (l.key === replacement.key ? replacement : l));

const FIXTURES: KitCard[] = [
  card(1, 'working', healthyLines()),
  card(2, 'needs_attention', swap(healthyLines(), line('soil', 'out_of_range', 'warn', { at: ago(2) }))),
  card(3, 'not_connected', swap(swap(swap(healthyLines(), line('connection', 'offline', 'bad', { at: ago(180) })),
    line('soil', 'unknown', 'info')), line('climate', 'unknown', 'info'))),
  card(4, 'needs_attention', swap(healthyLines(), line('pump', 'unconfirmed', 'warn', { at: ago(10), value: 'start' }))),
  card(5, 'awaiting_installation', [], false),
];

const text = (testID: string) => {
  const el = screen.getByTestId(testID);
  const kids = el.props.children;
  return Array.isArray(kids) ? kids.join('') : String(kids);
};

beforeEach(() => {
  jest.spyOn(Date, 'now').mockReturnValue(NOW);
  mockAgro = { farm: { id: '1', name: 'Alpha' }, farms: [{ id: '1', name: 'Alpha' }], selectFarm: jest.fn() };
  (api.fetchFarmKits as jest.Mock).mockResolvedValue(FIXTURES);
});
afterEach(() => jest.restoreAllMocks());

// The first render loads the farm photos (premium visuals); under a parallel run it can pass 5 s.
jest.setTimeout(20000);

describe('the Kit tab', () => {
  it('a healthy kit is Working, and each line says what is really working', async () => {
    await render(<KitTabScreen />);
    expect(await screen.findByTestId('kit-overall-1')).toHaveTextContent('Working');
    expect(text('kit-line-text-1-connection')).toBe('Connected · last seen 2 min ago');
    expect(text('kit-line-text-1-wifi')).toBe('Wi-Fi signal: strong');
    expect(text('kit-line-text-1-soil')).toBe('Soil sensor: OK');
    expect(text('kit-line-text-1-climate')).toBe('Temperature and humidity sensor: OK');
    expect(text('kit-line-text-1-pump')).toBe('Pump switch: last command confirmed by the kit at 23 Oct 2026, 08:15');
    expect(text('kit-line-text-1-backlog')).toBe('Offline readings waiting to upload: none');
    expect(text('kit-line-text-1-firmware')).toBe('Firmware 1.7.1');
    expect(text('kit-line-text-1-safety')).toBe('Safety: each run stops after 5 min at most, and the kit stops by itself if it loses connection for 3 minutes');
    // The pump line says it confirms the switch, not water flow.
    expect(screen.getAllByText('This confirms the switch, not water flow: the kit has no flow meter.').length).toBeGreaterThan(0);
  });

  it('a soil probe out of range needs attention and says to check the probe', async () => {
    await render(<KitTabScreen />);
    expect(await screen.findByTestId('kit-overall-2')).toHaveTextContent('Needs attention');
    expect(text('kit-line-text-2-soil')).toBe('Soil sensor: reading out of range – check the probe');
  });

  it('an offline kit is Not connected, its sensors unknown, and still shows its setup Wi-Fi', async () => {
    await render(<KitTabScreen />);
    expect(await screen.findByTestId('kit-overall-3')).toHaveTextContent('Not connected');
    expect(text('kit-line-text-3-connection')).toBe('Not connected · last seen 3 h ago');
    expect(text('kit-line-text-3-soil')).toBe('Soil sensor: not known while the kit is not connected');
    expect(text('kit-setup-wifi-text-3')).toBe("Your kit's setup Wi-Fi: AgroFlow-Setup-89AB, password AF-6789AB");
    await fireEvent.press(screen.getByTestId('kit-when-3'));
    expect(screen.getByText(/Only if you change your Wi-Fi/)).toBeTruthy();
    await fireEvent.press(screen.getByTestId('kit-change-wifi-3'));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/zone-hardware', params: { zoneId: '3', zoneName: 'Bed 3' } });
  });

  it('a command the kit never confirmed needs attention', async () => {
    await render(<KitTabScreen />);
    expect(await screen.findByTestId('kit-overall-4')).toHaveTextContent('Needs attention');
    expect(text('kit-line-text-4-pump')).toBe('Pump switch: last command not confirmed by the kit');
  });

  it('a zone with no kit is Awaiting installation, with the next step and no fault lines', async () => {
    await render(<KitTabScreen />);
    expect(await screen.findByTestId('kit-overall-5')).toHaveTextContent('Awaiting installation');
    expect(screen.getByTestId('kit-awaiting-5')).toHaveTextContent(/your installer connects the kit/);
    expect(screen.queryByTestId('kit-line-5-connection')).toBeNull();
    expect(screen.queryByTestId('kit-setup-wifi-5')).toBeNull();
  });

  it('never shows what the kit cannot measure', async () => {
    await render(<KitTabScreen />);
    await screen.findByTestId('kit-overall-1');
    expect(screen.queryByText(/battery/i)).toBeNull();
    expect(screen.queryByText(/valve/i)).toBeNull();
  });

  it('while loading says so', async () => {
    (api.fetchFarmKits as jest.Mock).mockReset().mockReturnValueOnce(new Promise(() => {}));
    await render(<KitTabScreen />);
    expect(screen.getByText('Checking your kit…')).toBeTruthy();
  });

  it('a failed load is an error with Try again, not a kit fault', async () => {
    (api.fetchFarmKits as jest.Mock).mockReset().mockRejectedValueOnce(new Error('offline'));
    await render(<KitTabScreen />);
    expect(await screen.findByText("Your kit's status could not be loaded.")).toBeTruthy();
    expect(screen.getByText(/it keeps watering by its own rules/)).toBeTruthy();
  });
});
