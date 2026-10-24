/// <reference types="jest" />
// See services/__tests__/doubleSubmit.test.ts for why this reference is per file.

/* "Reconnect or reset your kit" (docs/kit-help): the guide opens from the Kit tab and from the
 * pocket field guide; it says what firmware 1.7.1 really does; the printable page is the same file
 * on both sites and never holds a kit's own password or an enrollment code. */

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
jest.mock('@/services/agroFlowApi', () => ({ fetchFarmKits: jest.fn() }));

import { fireEvent, render, screen } from '@testing-library/react-native';
import * as api from '@/services/agroFlowApi';
import KitTabScreen from '@/app/(tabs)/kit';
import { FieldGuide } from '@/components/visual/FieldGuide';
import { KIT_GUIDE_PATH } from '@/components/KitHelpGuide';
import type { KitCard } from '@/services/agroFlowApi';

declare const require: (name: string) => any;
declare const __dirname: string;
const fs = require('fs') as { readFileSync(p: string, e: string): string };
const path = require('path') as { resolve(...p: string[]): string };
const repo = path.resolve(__dirname, '../../../../..');
const read = (...p: string[]) => fs.readFileSync(path.resolve(repo, ...p), 'utf8').replace(/\r\n/g, '\n');

const KIT: KitCard = {
  zoneId: 7, zoneName: 'Bed 7', hasKit: true, deviceId: '0123456789AB', deviceName: null,
  setupNetworkName: 'AgroFlow-Setup-89AB', setupNetworkPassword: 'AF-6789AB', overall: 'working',
  lines: [{ key: 'connection', state: 'online', tone: 'ok', at: new Date().toISOString(), value: null }],
};

beforeEach(() => {
  mockAgro = { farm: { id: '1', name: 'Alpha' }, farms: [{ id: '1', name: 'Alpha' }], selectFarm: jest.fn() };
  (api.fetchFarmKits as jest.Mock).mockResolvedValue([KIT]);
});

describe('the kit help guide', () => {
  it('opens from the Kit tab with the three parts, this kit\'s own setup Wi-Fi, and the reset warning', async () => {
    await render(<KitTabScreen />);
    await fireEvent.press(await screen.findByTestId('kit-help-7-open'));
    expect(screen.getByTestId('kit-help-7-guide')).toBeTruthy();
    expect(screen.getByTestId('kit-help-7-wifi')).toHaveTextContent(/Kit, then Change Wi-Fi/);
    expect(screen.getByTestId('kit-help-7-wifi')).toHaveTextContent(/off and on 3 times quickly/);
    expect(screen.getByTestId('kit-help-7-wifi')).toHaveTextContent(/after 15 minutes without its Wi-Fi/);
    expect(screen.getByTestId('kit-help-7-step-join')).toHaveTextContent(/join the Wi-Fi AgroFlow-Setup-89AB, password AF-6789AB/);
    expect(screen.getByTestId('kit-help-7-step-page')).toHaveTextContent(/192\.168\.4\.1/);
    expect(screen.getByTestId('kit-help-7-wifi')).toHaveTextContent(/You do not need a new code/);
    expect(screen.getByTestId('kit-help-7-move')).toHaveTextContent(/Only AgroFlow staff can do this/);
    expect(screen.getByTestId('kit-help-7-reset')).toHaveTextContent(/off and on 5 times quickly/);
    expect(screen.getByTestId('kit-help-7-reset-warning')).toHaveTextContent(/does not water until AgroFlow staff make a new enrollment code/);
  });

  it('opens from the pocket field guide, without a kit\'s details', async () => {
    await render(<FieldGuide />);
    await fireEvent.press(screen.getByRole('button', { name: 'Pocket field guide' }));
    await fireEvent.press(screen.getByTestId('field-guide-kit-help-open'));
    expect(screen.getByTestId('field-guide-kit-help-step-join')).toHaveTextContent(/AgroFlow-Setup-XXXX/);
    expect(screen.getByTestId('field-guide-kit-help-reset-warning')).toBeTruthy();
  });

  it('says what the firmware really does: 3 cycles to reconnect, 5 to reset, 15 minutes, 10 seconds, 5 minutes open', () => {
    const ino = read('hardware', 'esp32', 'AgroFlowIrrigationNode', 'AgroFlowIrrigationNode.ino');
    expect(ino).toContain('const int BOOTS_FOR_PORTAL = 3;');
    expect(ino).toContain('const int BOOTS_FOR_FACTORY_RESET = 5;');
    expect(ino).toMatch(/WIFI_DOWN_PORTAL_AFTER_MS = 15UL \* 60UL \* 1000UL/);
    expect(ino).toMatch(/BOOT_COUNTER_WINDOW_MS = 10000;/);
    expect(ino).toMatch(/CONFIG_PORTAL_TIMEOUT_SECONDS = 300;/);
  });

  it('the printable page is the same file on both sites, has no script, and no kit\'s own password or code', () => {
    const staff = read('apps', 'web', 'admin', 'public', ...KIT_GUIDE_PATH.split('/').filter(Boolean));
    const farmer = read('apps', 'mobile', 'public', ...KIT_GUIDE_PATH.split('/').filter(Boolean));
    expect(farmer).toBe(staff);
    expect(staff).not.toMatch(/<script/i);
    expect(staff).toMatch(/off and on 3 times quickly/);
    expect(staff).toMatch(/off and on 5 times quickly/);
    expect(staff).toMatch(/192\.168\.4\.1/);
    expect(staff).toMatch(/AgroFlow-Setup-XXXX/);
    // Placeholders only: never a real setup password (AF- and 6 characters) or an 8-character code.
    expect(staff).not.toMatch(/AF-[0-9A-F]{6}/);
    expect(staff).not.toMatch(/enrollment code is [A-Z0-9]{8}/i);
  });
});
