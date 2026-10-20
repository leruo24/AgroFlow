/// <reference types="jest" />
// See services/__tests__/doubleSubmit.test.ts for why this reference is per file.

/* Drought mode on Home and community alerts (docs/drought-community.md). The real screens with
 * only context and network faked: the water budget and zone priorities, switching drought mode
 * by hand, the report form (no location picker, the 2-in-36-hours limit shown), "I'm seeing this
 * too", a downwind fire at the top with its estimate wording, and fire updates. */

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
jest.mock('lucide-react-native', () =>
  new Proxy({}, { get: (_target, name) => (name === '__esModule' ? false : () => null) })
);
jest.mock('react-native-svg', () => {
  const { View } = jest.requireActual('react-native');
  return new Proxy({}, { get: (_t, name) => (name === '__esModule' ? true : View) });
});
jest.mock('expo-router', () => ({ useFocusEffect: () => undefined, useLocalSearchParams: () => ({}) }));
jest.mock('@/lib/router', () => ({ router: { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => true } }));
jest.mock('@/components/ScreenHeader', () => {
  const { Text } = jest.requireActual('react-native');
  return { ScreenHeader: ({ title }: { title: string }) => <Text>{title}</Text> };
});
const mockFarm = { id: '1', name: 'Mahikeng (Simulated)' };
jest.mock('@/context/AgroFlowContext', () => ({ useAgroFlow: () => ({ farm: mockFarm }) }));
jest.mock('@/services/agroFlowApi', () => ({
  fetchDrought: jest.fn(),
  setDroughtMode: jest.fn(),
  fetchCommunity: jest.fn(),
  createCommunityReport: jest.fn(),
  confirmCommunityReport: jest.fn(),
  updateCommunityReport: jest.fn(),
}));

import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as api from '@/services/agroFlowApi';
import { DroughtCard } from '@/components/DroughtCard';
import CommunityScreen, { COMMUNITY_CATEGORIES } from '@/app/community';
import { resetLanguageForTests } from '@/i18n';

const honesty = "Worked out from your farm's own tank estimate, soil readings and weather forecast. It is not a drought prediction or an official drought declaration.";
const droughtOn: api.DroughtView = {
  farmId: 1, active: true, automatic: true, override: null,
  reason: 'Drought mode on: tank about 20% full (drought line 25%); 2 mm of rain forecast over 7 days (less than 5 mm counts as dry); crop water use 6 mm a day forecast against 5 mm usual for this farm.',
  since: '2026-10-20T06:00:00Z',
  budget: { litresLeft: 1000, normalDays: 5, droughtDays: 8, text: 'You have about 1 000 L. At normal watering that lasts 5 days; in drought mode it lasts 8 days.' },
  summary: 'Drought mode on: water Maize fully, Beans at half, skip Potato today.',
  zones: [
    { zoneId: 1, zoneName: 'Maize', crop: 'maize', priority: 'full', fraction: 1, ky: 1.5, normalLitres: 40, droughtLitres: 40, why: 'Maize in crop development is very sensitive to water stress (FAO Ky 1.50), so it keeps full water.', irrigationType: 'drip', efficiencyNote: '' },
    { zoneId: 2, zoneName: 'Beans', crop: 'dry_beans', priority: 'reduced', fraction: 0.5, ky: 0.75, normalLitres: 30, droughtLitres: 15, why: 'Beans at mid-season: FAO Ky 0.75.', irrigationType: 'sprinkler', efficiencyNote: '' },
    { zoneId: 3, zoneName: 'Potato', crop: 'potato', priority: 'skip', fraction: 0, ky: 0.2, normalLitres: 25, droughtLitres: 0, why: 'Potato late-season (ripening): FAO Ky 0.20.', irrigationType: 'surface', efficiencyNote: '' },
  ],
  honesty, source: 'FAO Irrigation and Drainage Paper 66 (Steduto et al. 2012)',
};

const report = (over: Partial<api.NearbyReport> = {}): api.NearbyReport => ({
  reportId: 11, category: 'pest', subtype: 'fall_armyworm', label: 'Fall armyworm', severity: 'moderate',
  message: 'Fall armyworm reported about 18 km from your farm. This is a community report and has not been independently verified.',
  distanceKm: 18, downwind: false, similarFarms: 0, confirmations: 0, fireState: null,
  createdAt: '2026-10-20T08:00:00Z', expiresAt: '2026-10-27T08:00:00Z', mine: false, confirmed: false, canUpdate: false, updates: [], ...over,
});
const allowed: api.CommunityLimit = { allowed: true, nextAllowedAt: null, message: 'You can add up to 2 reports every 36 hours. You have 2 left.' };
const unverified = 'This is a community report and has not been independently verified.';
const serve = (reports: api.NearbyReport[], limit = allowed) =>
  (api.fetchCommunity as jest.Mock).mockResolvedValue({ reports, limit, unverified, emergency: 'your local emergency number (112 from a mobile phone)' });

beforeEach(() => {
  jest.clearAllMocks();
  resetLanguageForTests();
});

describe('drought card', () => {
  it('shows the budget, why drought mode is on, and each zone: full, half, skip', async () => {
    (api.fetchDrought as jest.Mock).mockResolvedValue(droughtOn);
    await render(<DroughtCard />);
    expect(await screen.findByText('Drought mode is on')).toBeTruthy();
    expect(screen.getByText(droughtOn.budget!.text)).toBeTruthy();
    expect(screen.getByTestId('drought-reason').props.children).toContain('tank about 20% full');
    expect(screen.getByText('Drought mode on: water Maize fully, Beans at half, skip Potato today.')).toBeTruthy();
    expect(screen.getByText('Water fully')).toBeTruthy();
    expect(screen.getByText('Water at 50%')).toBeTruthy();
    expect(screen.getByText('Skip today')).toBeTruthy();
    expect(screen.getByTestId('drought-honesty').props.children).toBe(honesty);
  });

  it('when off, only the budget and the mode switch show', async () => {
    (api.fetchDrought as jest.Mock).mockResolvedValue({ ...droughtOn, active: false, summary: null, zones: [] });
    await render(<DroughtCard />);
    expect(await screen.findByText('Your water budget')).toBeTruthy();
    expect(screen.queryByText('Water fully')).toBeNull();
    expect(screen.getByTestId('drought-mode-auto').props.accessibilityState).toMatchObject({ checked: true });
  });

  it('the farmer can switch drought mode on by hand', async () => {
    (api.fetchDrought as jest.Mock).mockResolvedValue({ ...droughtOn, active: false, summary: null, zones: [] });
    (api.setDroughtMode as jest.Mock).mockResolvedValue({ ...droughtOn, override: 'on', automatic: false });
    await render(<DroughtCard />);
    await fireEvent.press(await screen.findByTestId('drought-mode-on'));
    await waitFor(() => expect(api.setDroughtMode).toHaveBeenCalledWith('1', 'on'));
    expect(await screen.findByText('Drought mode is on')).toBeTruthy();
  });

  it('shows nothing when drought mode is not set up on the server yet', async () => {
    (api.fetchDrought as jest.Mock).mockRejectedValue(new Error('Drought mode is not set up yet (migration 0054).'));
    await render(<DroughtCard />);
    await waitFor(() => expect(api.fetchDrought).toHaveBeenCalled());
    expect(screen.queryByTestId('drought-card')).toBeNull();
  });
});

describe('community screen', () => {
  it('lists nearby reports by distance only, without the reporter', async () => {
    serve([report()]);
    await render(<CommunityScreen />);
    expect(await screen.findByText(/about 18 km from your farm/)).toBeTruthy();
    expect(screen.getAllByText(unverified).length).toBeGreaterThan(0);
    expect(screen.getByTestId('community-limit').props.children).toBe(allowed.message);
  });

  it('a downwind fire is marked as an estimate, and its reporter can post updates', async () => {
    serve([report({ reportId: 21, category: 'fire', subtype: 'veld_fire', label: 'Veld fire', severity: 'high', downwind: true, canUpdate: true,
      message: 'Veld fire about 12 km from your farm. If you\'re in danger, leave and call 112.' })]);
    (api.updateCommunityReport as jest.Mock).mockResolvedValue({ notifiedFarms: 3, closed: false });
    await render(<CommunityScreen />);
    expect(await screen.findByTestId('community-downwind-21')).toBeTruthy();
    expect(screen.getByText(/an estimate from the wind, not a prediction/)).toBeTruthy();
    await fireEvent.press(screen.getByTestId('community-fire-spreading-21'));
    expect(await screen.findByText('Choose which way it is spreading.')).toBeTruthy();
    expect(api.updateCommunityReport).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('community-fire-dir-NE-21'));
    await fireEvent.press(screen.getByTestId('community-fire-spreading-21'));
    await waitFor(() => expect(api.updateCommunityReport).toHaveBeenCalledWith(21, 'spreading', 'NE'));
    expect(await screen.findByText('Update sent to 3 farms nearby.')).toBeTruthy();
  });

  it('"Out" closes the fire report', async () => {
    serve([report({ reportId: 22, category: 'fire', subtype: 'veld_fire', label: 'Veld fire', mine: true, canUpdate: true })]);
    (api.updateCommunityReport as jest.Mock).mockResolvedValue({ notifiedFarms: 2, closed: true });
    await render(<CommunityScreen />);
    await fireEvent.press(await screen.findByTestId('community-fire-out-22'));
    await waitFor(() => expect(api.updateCommunityReport).toHaveBeenCalledWith(22, 'out', undefined));
    expect(await screen.findByText(/the report is closed/)).toBeTruthy();
  });

  it('"I\'m seeing this too" confirms once', async () => {
    serve([report()]);
    (api.confirmCommunityReport as jest.Mock).mockResolvedValue({ confirmations: 1, message: `2 nearby farms have reported similar activity. ${unverified}` });
    await render(<CommunityScreen />);
    await fireEvent.press(await screen.findByTestId('community-confirm-11'));
    await waitFor(() => expect(api.confirmCommunityReport).toHaveBeenCalledWith(11, 1));
    expect(await screen.findByText(/2 nearby farms have reported similar activity/)).toBeTruthy();
  });

  it('the report form: category, kind, severity, note; the farm\'s saved place; no location picker', async () => {
    serve([]);
    (api.createCommunityReport as jest.Mock).mockResolvedValue({ id: 31, notifiedFarms: 4, limit: '', nextAllowedAt: null });
    await render(<CommunityScreen />);
    await fireEvent.press(await screen.findByTestId('community-add'));
    expect(screen.getByTestId('community-form-limit').props.children).toBe(allowed.message);
    expect(screen.getByText(/Your phone's location is never used/)).toBeTruthy();
    expect(screen.queryByTestId(/lat|lon|map|gps|location-pick/i)).toBeNull();
    await fireEvent.press(screen.getByTestId('community-send'));
    expect(await screen.findByText('Choose what you are seeing.')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('community-cat-fire'));
    expect(screen.getByTestId('community-fire-danger').props.children).toBe('If you\'re in danger, leave and call your local emergency number (112 from a mobile phone).');
    await fireEvent.press(screen.getByTestId('community-sub-veld_fire'));
    await fireEvent.press(screen.getByTestId('community-sev-high'));
    await fireEvent.changeText(screen.getByTestId('community-note'), 'Smoke over the hill to the west');
    await fireEvent.press(screen.getByTestId('community-send'));
    await waitFor(() => expect(api.createCommunityReport).toHaveBeenCalledWith({
      farmId: 1, category: 'fire', subtype: 'veld_fire', severity: 'high', description: 'Smoke over the hill to the west',
    }));
    expect(await screen.findByText('Thank you. Your report went to 4 farms nearby.')).toBeTruthy();
  });

  it('a one-kind category (disease) needs no second choice', async () => {
    serve([]);
    (api.createCommunityReport as jest.Mock).mockResolvedValue({ id: 32, notifiedFarms: 0, limit: '', nextAllowedAt: null });
    await render(<CommunityScreen />);
    await fireEvent.press(await screen.findByTestId('community-add'));
    await fireEvent.press(screen.getByTestId('community-cat-disease'));
    await fireEvent.press(screen.getByTestId('community-sev-low'));
    await fireEvent.press(screen.getByTestId('community-send'));
    await waitFor(() => expect(api.createCommunityReport).toHaveBeenCalledWith(expect.objectContaining({ subtype: 'suspected_crop_disease' })));
  });

  it('offers "I\'m seeing this too" before a new report of the same kind', async () => {
    serve([report()]);
    (api.confirmCommunityReport as jest.Mock).mockResolvedValue({ confirmations: 1, message: 'Thanks.' });
    await render(<CommunityScreen />);
    await fireEvent.press(await screen.findByTestId('community-add'));
    await fireEvent.press(screen.getByTestId('community-cat-pest'));
    expect(screen.getByTestId('community-similar')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('community-similar-11'));
    await waitFor(() => expect(api.confirmCommunityReport).toHaveBeenCalledWith(11, 1));
    expect(api.createCommunityReport).not.toHaveBeenCalled();
  });

  it('at the limit, the form says when the next report can be added and cannot be sent', async () => {
    serve([], { allowed: false, nextAllowedAt: '2026-10-21T10:00:00Z', message: 'You can add up to 2 reports every 36 hours. You can add another after Wednesday 21 October, 12:00.' });
    await render(<CommunityScreen />);
    await fireEvent.press(await screen.findByTestId('community-add'));
    expect(screen.getByTestId('community-form-limit').props.children).toMatch(/You can add another after Wednesday 21 October, 12:00/);
    expect(screen.queryByTestId('community-send')).toBeNull();
  });

  it('uses the same categories and kinds as the API', () => {
    expect(COMMUNITY_CATEGORIES.map(c => c.category)).toEqual(['pest', 'disease', 'fire', 'water', 'weather']);
    expect(COMMUNITY_CATEGORIES.flatMap(c => c.subtypes)).toHaveLength(17);
  });
});
