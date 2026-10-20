/// <reference types="jest" />
// See services/__tests__/doubleSubmit.test.ts for why this reference is per file.

/* The spacing and layout pass (docs/app-spacing.md): database values always reach the screen
 * as friendly, translated labels; one empty-state wording; the bottom padding clears the
 * floating tab bar; the shared Card / InfoGrid / StatsRow look the same everywhere
 * (snapshots); and the Irrigation and zone screens show none of "leafy_veg", "Unknown",
 * "No data" or "Unavailable". */

import type { ReactNode } from 'react';

jest.mock('@/context/ThemeContext', () => {
  const { lightColors } = jest.requireActual('@/constants/colors');
  return { useTheme: () => ({ colors: lightColors, isDark: false }) };
});
jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual('react-native');
  return {
    SafeAreaView: ({ children }: { children: ReactNode }) => <View>{children}</View>,
    useSafeAreaInsets: () => ({ top: 0, bottom: 34, left: 0, right: 0 }),
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
  return { useLocalSearchParams: () => mockParams, useFocusEffect: (fn: () => void) => React.useEffect(fn, [fn]) };
});
let mockAgro: Record<string, unknown> = {};
jest.mock('@/context/AgroFlowContext', () => ({ useAgroFlow: () => mockAgro }));
jest.mock('@/context/AuthContext', () => ({ useAuth: () => ({ user: { name: 'Thandi', email: 't@example.org' }, signOut: jest.fn() }) }));
jest.mock('@/services/insightsService', () => ({ fetchAlertExplanations: jest.fn(() => Promise.resolve({})), todayInSast: () => '2026-10-20' }));
jest.mock('@/components/AppAlert', () => ({ AppAlert: { alert: jest.fn() } }));
jest.mock('@/services/agroFlowApi', () => ({
  // The zone screen's Sensor Readings card asks for the farm's tank.
  fetchTankStatus: jest.fn(() => Promise.resolve({ farmId: 1, capacityLitres: null, estimatedRemainingLitres: null, isLow: false })),
  fetchZoneHardware: jest.fn(() => Promise.resolve({ hardwareId: null, deviceId: null, online: false })),
  ApiHttpError: class ApiHttpError extends Error { status = 0; },
  fetchZoneInsights: jest.fn(() => Promise.resolve({ insights: [], growth: null })),
  fetchSoilPh: jest.fn(() => Promise.resolve({ zoneId: 8, entries: [] })),
  logSoilPh: jest.fn(), resetZoneToRecommended: jest.fn(), saveZoneCalibration: jest.fn(),
  fetchRecommendedSettings: jest.fn(() => Promise.resolve({ available: false })),
  fetchDismissals: jest.fn(() => Promise.resolve([])), dismissNotification: jest.fn(), restoreNotification: jest.fn(),
  dismissZoneInsight: jest.fn(),
}));

import { render, screen } from '@testing-library/react-native';
import IrrigationScreen from '@/app/(tabs)/irrigation';
import ZoneControlScreen from '@/app/zone/[id]';
import { Card } from '@/components/ui/Card';
import { InfoGrid } from '@/components/ui/InfoGrid';
import { StatsRow } from '@/components/ui/StatsRow';
import { bottomPadding } from '@/hooks/useScreenPadding';
import { FLOATING_TAB_BAR_HEIGHT, FLOATING_TAB_BAR_MARGIN_BOTTOM } from '@/styles/tabsLayoutStyles';
import { Layout, Space, TypeScale } from '@/constants/colors';
import { resetLanguageForTests, translate, type Language, type TranslationKey } from '@/i18n';
import {
  CROP_VALUES, HEALTH_VALUES, MODE_VALUES, SENSOR_VALUES, SOIL_VALUES, TRIGGER_VALUES,
  cropLabel, healthLabel, modeLabel, sensorLabel, soilLabel, tidy, triggerLabel,
} from '@/lib/labels';

const LANGS: Language[] = ['en', 'af', 'tn'];
const tFor = (lang: Language) => (key: TranslationKey, params?: Record<string, string | number>) => translate(lang, key, params);

describe('labels for database values', () => {
  it.each(LANGS)('every known crop, soil, mode, health, sensor and trigger value has a %s label, never the raw value or a key', (lang) => {
    const t = tFor(lang);
    const cases: [readonly string[], (t: ReturnType<typeof tFor>, v: string) => string][] = [
      [CROP_VALUES, cropLabel], [SOIL_VALUES, soilLabel], [MODE_VALUES, modeLabel],
      [HEALTH_VALUES, healthLabel], [SENSOR_VALUES, sensorLabel], [TRIGGER_VALUES, triggerLabel],
    ];
    for (const [values, label] of cases) {
      for (const v of values) {
        const out = label(t, v);
        expect(out).toBeTruthy();
        expect(out).not.toMatch(/^label\.|^empty\./);   // a missing translation shows its key
        if (/_/.test(v)) expect(out).not.toContain('_');
      }
    }
  });

  it('maps the values the sponsor saw', () => {
    const t = tFor('en');
    expect(cropLabel(t, 'leafy_veg')).toBe('Leafy vegetables');
    expect(cropLabel(t, 'dry_beans')).toBe('Dry beans');
    expect(soilLabel(t, 'loam')).toBe('Loam');
    expect(modeLabel(t, 'scheduled')).toBe('On a schedule');
    expect(healthLabel(t, 'Unknown')).toBe('Not enough data yet');
    expect(sensorLabel(t, 'Low Battery')).toBe('Battery low');
    expect(triggerLabel(t, 'auto')).toBe('Automatic');
    expect(cropLabel(tFor('af'), 'leafy_veg')).toBe('Blaargroente');
  });

  it('an unknown value is tidied, never shown raw; an empty one says so', () => {
    const t = tFor('en');
    expect(cropLabel(t, 'cover_crop')).toBe('Cover crop');
    expect(tidy('SOME-value_here')).toBe('Some value here');
    expect(cropLabel(t, 'Not configured')).toBe('No crop yet');
    expect(cropLabel(t, null)).toBe('No crop yet');
  });

  it.each(LANGS)('the empty-state phrases exist in %s', (lang) => {
    for (const key of ['empty.noReading', 'empty.noWatering', 'empty.noWaterToday', 'empty.noKit', 'empty.notSet', 'empty.noCrop'] as TranslationKey[]) {
      expect(translate(lang, key)).not.toBe(key);
    }
  });
});

describe('layout tokens', () => {
  it('one spacing scale, and the card/heading gaps from it', () => {
    expect(Object.values(Space)).toEqual([4, 8, 12, 16, 24, 32]);
    expect(Layout.cardPadding).toBe(16);
    expect(Layout.headingToCard).toBe(12);
    expect(Layout.cardGap).toBe(12);
    expect(Object.keys(TypeScale)).toEqual(['title', 'section', 'body', 'label', 'small']);
  });

  it('the bottom padding clears the floating tab bar, the safe area and 16 more', () => {
    expect(bottomPadding(34, true)).toBe(FLOATING_TAB_BAR_HEIGHT + FLOATING_TAB_BAR_MARGIN_BOTTOM + 34 + 16);
    expect(bottomPadding(0, false)).toBe(16);
  });
});

describe('shared components (snapshots)', () => {
  it('Card, InfoGrid and StatsRow', async () => {
    const view = await render(<Card>
      <StatsRow stats={[{ label: 'Total zones', value: '2' }, { label: 'Watering now', value: '—', note: 'No kit connected' }, { label: 'On a schedule', value: '0' }]} />
      <InfoGrid items={[{ label: 'Soil moisture', value: '57%' }, { label: 'Temperature', value: '21.4°C' }, { label: 'Water today', value: 'None yet today', muted: true }, { label: 'Last watering', value: '20 Oct 2026' }]} />
    </Card>);
    expect(view.toJSON()).toMatchSnapshot();
  });

  it('a grid cell is exactly half the row, and a number never wraps', async () => {
    await render(<InfoGrid items={[{ label: 'Temperature', value: '21.4°C' }, { label: 'Water today', value: '1 400 L' }]} />);
    const value = screen.getByText('21.4°C');
    expect(value.props.numberOfLines).toBe(1);
    const cell = screen.getByLabelText('Temperature: 21.4°C');
    expect(cell.props.style).toEqual(expect.objectContaining({ width: '50%' }));
  });
});

function zone(overrides: Record<string, unknown> = {}) {
  return {
    id: '8', farmId: '1', name: 'Tomato tunnel', location: 'Not configured', crop: 'leafy_veg', plantingDate: null,
    healthStatus: 'Unknown', waterSavedLitres: null, size: { value: 0, unit: 'm²' },
    sensors: {
      soilMoisture: { value: 0, unit: '%', status: 'Offline', moistureStatus: 'Unknown', calibrated: false },
      temperatureHumidity: { temperature: 0, temperatureUnit: '°C', humidity: 0, humidityUnit: '%', status: 'Offline' },
    },
    irrigation: {
      status: 'Off', mode: 'automatic',
      lastIrrigation: { date: 'Never', time: '', durationMinutes: 0 },
      schedule: { enabled: false, days: [], startTime: '', durationMinutes: 0 },
      automation: { enabled: true, moistureThreshold: 30, desiredMoisture: 60, weatherAdjustment: true },
      override: { active: false, durationMinutes: null },
    },
    relay: { status: 'Unknown' }, pump: { status: 'Unknown' },
    water: { usedTodayLitres: null, latestCycleLitres: 0, flowRateLpm: 0 },
    weather: { rainExpected: false, message: '' },
    alerts: [],
    ...overrides,
  };
}
const agro = () => ({
  farm: { id: '1', name: 'Nkosi Farm' }, farms: [{ id: '1', name: 'Nkosi Farm' }], zones: [zone()], isZonesLoading: false, zonesError: null,
  isFarmLoading: false, farmError: null, refreshZones: jest.fn(), refreshFarms: jest.fn(), alerts: [], markAlertAsRead: jest.fn(),
  startManualIrrigation: jest.fn(), stopManualIrrigation: jest.fn(), updateIrrigationMode: jest.fn(), updateZoneSettings: jest.fn(), updateZoneSchedule: jest.fn(),
});
const NEVER = [/leafy_veg/, /\bUnknown\b/, /^No data$/, /^Unavailable$/, /^Never$/, /Not configured/];

beforeAll(async () => {
  mockAgro = agro();
  mockParams = { id: '8' };
  await render(<ZoneControlScreen />);   // warm the renderer outside the 5 s limit
}, 60000);
beforeEach(() => { resetLanguageForTests(); mockAgro = agro(); mockParams = { id: '8' }; });

describe('screens show friendly values', () => {
  it('Irrigation: crop label, "No kit connected" instead of Unknown, one empty-state wording', async () => {
    await render(<IrrigationScreen />);
    expect(screen.getByText('Leafy vegetables')).toBeTruthy();
    expect(screen.getAllByText('No kit connected').length).toBeGreaterThan(0);
    expect(screen.getByText('None yet today')).toBeTruthy();
    expect(screen.getByText('No watering yet')).toBeTruthy();
    for (const bad of NEVER) expect(screen.queryAllByText(bad)).toHaveLength(0);
  });

  it('Irrigation: with a kit, "Watering now" is a count, and readings show', async () => {
    mockAgro = { ...agro(), zones: [zone({ sensors: {
      soilMoisture: { value: 57, unit: '%', status: 'Online', moistureStatus: 'Optimal', calibrated: true },
      temperatureHumidity: { temperature: 21.4, temperatureUnit: '°C', humidity: 55, humidityUnit: '%', status: 'Online' },
    } })] };
    await render(<IrrigationScreen />);
    expect(screen.getByLabelText('Watering now: 0')).toBeTruthy();
    expect(screen.getByText('57%')).toBeTruthy();
    expect(screen.getByText('21.4°C')).toBeTruthy();
  });

  it('Zone: the live readings say "No kit connected", and no raw value shows', async () => {
    await render(<ZoneControlScreen />);
    expect(await screen.findByTestId('sensor-readings')).toBeTruthy();
    expect(screen.getAllByText('No kit connected').length).toBeGreaterThan(0);
    for (const bad of NEVER) expect(screen.queryAllByText(bad)).toHaveLength(0);
  });
});
