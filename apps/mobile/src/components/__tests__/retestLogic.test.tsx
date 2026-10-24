/// <reference types="jest" />
// See services/__tests__/doubleSubmit.test.ts for why this reference is per file.

/* The live web retest of 23 October 2026 (fix/retest-logic):
 *   RET-01  Drip and the Home summary follow the real state: fault -> no kit -> no readings ->
 *           stale -> low confidence -> normal; "All your zones look good" only when it is normal.
 *   RET-06  the confidence reason, "Why am I seeing this?", the weather words, the map controls
 *           and the drought disclaimer come from the string catalogue (af/tn too).
 *   RET-10  Account, Your details and Installation are three separate lines.
 *   and the water-use wording: estimated from run time x measured flow rate, never "metered". */

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
jest.mock('react-native-webview', () => ({ WebView: () => null }));
jest.mock('@/lib/router', () => ({ router: { push: jest.fn(), back: jest.fn(), canGoBack: () => false, navigate: jest.fn() } }));

import { render, screen } from '@testing-library/react-native';
import { decideMessage } from '@/components/DripHelper';
import { WhereYouAreNow } from '@/components/WhereYouAreNow';
import { conditionKey } from '@/components/WeatherSummary';
import { budgetText } from '@/components/DroughtCard';
import { summariseFarm, farmStateText, type FarmSummary } from '@/lib/farmState';
import { confidenceText } from '@/lib/confidenceText';
import { translate, type Language, type TranslationKey } from '@/i18n';
import type { Journey, KitCard, KitLine, TodayZone } from '@/services/agroFlowApi';

declare const require: (name: string) => any;
declare const __dirname: string;
const fs = require('fs') as { readFileSync(p: string, e: string): string };
const path = require('path') as { resolve(...p: string[]): string };
const repo = path.resolve(__dirname, '../../../../..');

const say = (lang: Language) => (key: TranslationKey, params?: Record<string, string | number>) => translate(lang, key, params);
const en = say('en');
const ALL_GOOD = 'All your zones look good today.';

const line = (key: string, state: string, tone: KitLine['tone'] = 'ok'): KitLine => ({ key, state, tone, at: null, value: null });
const kit = (zoneId: number, overall: KitCard['overall'], soil = 'ok', hasKit = true): KitCard => ({
  zoneId, zoneName: `Bed ${zoneId}`, hasKit, deviceId: hasKit ? '0123456789AB' : null, deviceName: null,
  setupNetworkName: null, setupNetworkPassword: null, overall,
  lines: hasKit ? [line('connection', overall === 'not_connected' ? 'offline' : 'online'), line('soil', soil)] : [],
});
const today = (zoneId: number, level: 'high' | 'medium' | 'low' | null): TodayZone => ({
  zoneId, name: `Bed ${zoneId}`, action: { kind: 'none' as TodayZone['action']['kind'], text: '' }, why: null,
  confidence: level ? { level, reason: `${level}` } : null, confidenceExplanation: null, nextStep: null,
});

describe('RET-01: the farm state, in priority order', () => {
  it('a healthy farm with fresh readings and confident advice is normal: the only "all good"', () => {
    const s = summariseFarm([kit(1, 'working'), kit(2, 'working')], [today(1, 'high'), today(2, 'medium')]);
    expect(s.state).toBe('normal');
    expect(farmStateText(en, s)).toBe(ALL_GOOD);
  });

  it('the retest case: no kit, waiting for a first reading and low confidence is never "all good"', () => {
    const s = summariseFarm([kit(1, 'awaiting_installation', 'ok', false)], [today(1, 'low')]);
    expect(s).toEqual({ state: 'no_kit', zoneId: 1, zoneName: 'Bed 1' });
    expect(farmStateText(en, s)).toBe('Bed 1 has no kit yet. Your installer connects it at the installation visit.');
  });

  it.each([
    ['fault first', [kit(1, 'awaiting_installation', 'ok', false), kit(2, 'needs_attention', 'out_of_range')], 'fault', 2],
    ['then no kit', [kit(1, 'working', 'none'), kit(2, 'awaiting_installation', 'ok', false)], 'no_kit', 2],
    ['then no readings', [kit(1, 'not_connected', 'unknown'), kit(2, 'working', 'none')], 'no_readings', 2],
    ['then stale (offline)', [kit(1, 'working'), kit(2, 'not_connected', 'unknown')], 'stale', 2],
    ['then stale (connected, readings stopped)', [kit(1, 'working', 'not_reading')], 'stale', 1],
  ] as const)('%s', (_name, kits, state, zoneId) => {
    const s = summariseFarm([...kits], [today(1, 'high'), today(2, 'high')]);
    expect(s.state).toBe(state);
    expect(s.zoneId).toBe(zoneId);
    expect(farmStateText(en, s)).not.toBe(ALL_GOOD);
  });

  it('then low confidence (or no confidence) before normal', () => {
    expect(summariseFarm([kit(1, 'working')], [today(1, 'low')]).state).toBe('low_confidence');
    expect(summariseFarm([kit(1, 'working')], [today(1, null)]).state).toBe('low_confidence');
  });

  it('anything not known is "unknown", never "all good"', () => {
    expect(summariseFarm(null, [today(1, 'high')]).state).toBe('unknown');
    expect(summariseFarm([], [today(1, 'high')]).state).toBe('unknown');
    expect(summariseFarm([kit(1, 'working')], null).state).toBe('unknown');
    expect(farmStateText(en, { state: 'unknown' })).not.toBe(ALL_GOOD);
  });

  it('Drip: no insights and no alerts says "all good" only for a normal farm, and points at the kit otherwise', () => {
    const zones = [{ id: '1', name: 'Bed 1' }];
    expect(decideMessage([], 0, zones, { state: 'normal' }).message).toBe(ALL_GOOD);
    expect(decideMessage([], 0, zones).message).not.toBe(ALL_GOOD);   // no summary: unknown
    const noKit = decideMessage([], 0, zones, { state: 'no_kit', zoneId: 1, zoneName: 'Bed 1' });
    expect(noKit.message).toMatch(/has no kit yet/);
    expect(noKit.target).toEqual({ kind: 'kit', zoneId: 1 });
    expect(noKit.mood).toBe('happy');   // the next step, not a fault
    const fault = decideMessage([], 0, zones, { state: 'fault', zoneId: 1, zoneName: 'Bed 1' });
    expect(fault.mood).toBe('alert');
    expect(decideMessage([], 0, zones, { state: 'low_confidence', zoneId: 1, zoneName: 'Bed 1' }).message).toMatch(/rough estimate/);
    // Unread alerts still come before the kit, and are said in the farmer's language.
    expect(decideMessage([], 2, zones, { state: 'no_kit', zoneId: 1, zoneName: 'Bed 1' }, say('af')).message).toBe('Jy het 2 nuwe waarskuwings. Tik om te kyk.');
  });
});

describe('RET-06: message codes in the farmer\'s language', () => {
  it('the confidence reason is built from its code, with the English as the fallback', () => {
    const af = say('af');
    expect(confidenceText(en, { level: 'low', reason: 'x', code: 'no_weather' })).toBe('Low: there is no weather for this farm yet.');
    expect(confidenceText(af, { level: 'low', reason: 'x', code: 'no_weather' })).toBe('Laag: daar is nog geen weer vir hierdie plaas nie.');
    expect(confidenceText(en, { level: 'medium', reason: 'x', code: 'partial', args: { basis: 'weather', because: 'kit_quiet', date: '17 Sep' } }))
      .toBe("Medium: based on the weather; your kit hasn't sent data since 17 Sep.");
    expect(confidenceText(say('tn'), { level: 'medium', reason: 'x', code: 'partial', args: { basis: 'own_check', because: 'own_check' } }))
      .toBe('Magareng: go ikaegile ka maemo a loapi le tlhatlhobo ya gago ya mmu.');
    expect(confidenceText(af, { level: 'high', reason: 'The English', code: 'something_new' })).toBe('The English');
    expect(confidenceText(af, { level: 'high', reason: 'The English' })).toBe('The English');
  });

  it('"Why am I seeing this?", the weather words, the map controls and the drought disclaimer are translated', () => {
    for (const lang of ['af', 'tn'] as const) {
      for (const key of ['why.link', 'weatherWord.partlyCloudy', 'weatherWord.updated', 'map.zoomIn', 'drought.honesty'] as TranslationKey[])
        expect(translate(lang, key, { time: '08:00' })).not.toBe(translate('en', key, { time: '08:00' }));
    }
    expect(conditionKey(2)).toBe('weatherWord.partlyCloudy');
    expect(conditionKey(undefined)).toBeNull();
    expect(translate('af', 'weatherWord.humidity', { pct: 40 })).toBe('Humiditeit 40%');
  });

  it('the drought budget is built from its numbers', () => {
    expect(budgetText(en, { litresLeft: 2500, normalDays: 5, droughtDays: 1 }))
      .toBe('You have about 2 500 L. At normal watering that lasts 5 days; in drought mode it lasts 1 day.');
    expect(budgetText(say('af'), { litresLeft: 900, normalDays: 2147483647, droughtDays: 2147483647 }))
      .toBe("Jy het omtrent 900 L. Met gewone natlei hou dit 'n lang tyd; in droogtemodus hou dit 'n lang tyd.");
  });
});

describe('RET-10: Account, Your details and Installation apart', () => {
  const journey = (over: Partial<Journey> = {}): Journey => ({
    farmId: 1,
    setupProgress: { done: 0, total: 4, label: 'Your details: 0 of 4', tasks: [] },
    account: { status: 'active', label: 'Account: active' },
    installation: { stage: 'account_active', label: 'Account active', text: 'Installation: not booked yet', live: false, status: 'not_booked' },
    whereYouAreNow: { stage: 'account_active', stageLabel: 'Account active', stageNumber: 4, stageCount: 8, steps: [], done: [], stillToDo: [],
      nextAction: 'Finish your details', whoActsNext: 'you', whoActsNextLabel: 'You', knownDate: null, dateLabel: 'Whenever you are ready' },
    zones: [], helpRequests: [], terms: { acceptanceEnabled: false, accepted: { all: false, termsAcceptedAt: null, privacyAcceptedAt: null }, documents: [] },
    ...over,
  });

  it('an active account with nothing booked: three separate lines, and the installation never says "account active"', async () => {
    await render(<WhereYouAreNow state={{ status: 'ready', journey: journey(), reload: jest.fn() } as never} />);
    expect(screen.getByTestId('where-account')).toHaveTextContent('Account: active');
    expect(screen.getByTestId('where-details')).toHaveTextContent(/Your details: 0 of 4/);
    expect(screen.getByTestId('where-installation')).toHaveTextContent(/Installation: not booked yet/);
    expect(screen.queryByText(/Installation: account active/)).toBeNull();
  });

  it('an older server with no installation status still never shows an account stage as the installation', async () => {
    const old = journey({ account: undefined });
    delete (old.installation as { status?: string }).status;
    await render(<WhereYouAreNow state={{ status: 'ready', journey: old, reload: jest.fn() } as never} />);
    expect(screen.getByTestId('where-installation')).toHaveTextContent(/Installation: not booked yet/);
    expect(screen.queryByTestId('where-account')).toBeNull();
  });
});

describe('water use is estimated, never metered', () => {
  it('says run time x measured flow rate, and no kit type claims flow metering', () => {
    expect(translate('en', 'usage.estimate')).toBe("Estimated from run time × the zone's measured flow rate; there is no water meter.");
    const admin = fs.readFileSync(path.resolve(repo, 'apps', 'web', 'admin', 'src', 'services', 'agroFlowApi.ts'), 'utf8');
    expect(admin).not.toMatch(/flow metering/i);
  });
});

// Satisfies the type import of FarmSummary for readers of this file.
export type { FarmSummary };
