/// <reference types="jest" />
// See services/__tests__/doubleSubmit.test.ts for why this reference is per file.

/* The bottom bar (fix/kit-setup-info): Home / Irrigation / Kit / Alerts / More, and More holds
 * the screens that moved off the bar. Their routes are unchanged. */

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

import { fireEvent, render, screen } from '@testing-library/react-native';
import MoreScreen, { MORE_ITEMS } from '@/app/(tabs)/more';

declare const require: (name: string) => any;
declare const __dirname: string;
const fs = require('fs') as { readFileSync(p: string, e: string): string };
const path = require('path') as { resolve(...p: string[]): string };

describe('the bottom bar', () => {
  it('is Home / Irrigation / Kit / Alerts / More; History and Settings are still routes', () => {
    const layout = fs.readFileSync(path.resolve(__dirname, '../../app/(tabs)/_layout.tsx'), 'utf8');
    const screens = [...layout.matchAll(/<Tabs\.Screen\s+name="([^"]+)"[^>]*?options=\{\{([\s\S]*?)\}\}/g)];
    const visible = screens.filter(m => !/href:\s*null/.test(m[2])).map(m => m[1]);
    const hidden = screens.filter(m => /href:\s*null/.test(m[2])).map(m => m[1]);
    expect(visible).toEqual(['index', 'irrigation', 'kit', 'alerts', 'more']);
    expect(hidden).toEqual(expect.arrayContaining(['history', 'settings', 'profile']));
  });

  it('More lists History, Reports, Tank, Forecast, Settings and Help, and opens the same routes', async () => {
    await render(<MoreScreen />);
    for (const name of ['History', 'Reports', 'Tank', 'Forecast', 'Settings', 'Help']) expect(screen.getByText(name)).toBeTruthy();
    expect(MORE_ITEMS.map(i => i.href)).toEqual(['/history', '/reports', '/tank', '/forecast', '/settings']);
    await fireEvent.press(screen.getByTestId('more-open-history'));
    expect(mockPush).toHaveBeenLastCalledWith('/history');
  });
});
