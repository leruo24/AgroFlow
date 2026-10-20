/// <reference types="jest" />
// See services/__tests__/doubleSubmit.test.ts for why this reference is per file.

/* One card per zone on Home: the server's action, a confidence badge, and "I watered" /
 * "How does the soil feel?" for logging by hand. */

jest.mock('@/context/ThemeContext', () => {
  const { lightColors } = jest.requireActual('@/constants/colors');
  return { useTheme: () => ({ colors: lightColors }) };
});

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('@/lib/supabase', () => ({ supabase: {} }));

jest.mock('lucide-react-native', () =>
  new Proxy({}, { get: (_target, name) => (name === '__esModule' ? false : () => null) })
);

const mockPush = jest.fn();
jest.mock('@/lib/router', () => ({ router: { push: (...a: unknown[]) => mockPush(...a), back: jest.fn() } }));

jest.mock('@/services/agroFlowApi', () => ({
  logManualWatering: jest.fn(() => Promise.resolve({ id: 1, message: 'Watering logged. Today\'s advice now counts it.' })),
  logSoilFeel: jest.fn(() => Promise.resolve({ id: 2, message: 'Thanks - today\'s advice now uses your soil check.' })),
}));

import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { TodayCard } from '../TodayCard';
import * as api from '@/services/agroFlowApi';
import type { TodayZone } from '@/services/agroFlowApi';

const zone: TodayZone = {
  zoneId: 7,
  name: 'Bed 1',
  action: { kind: 'water', text: 'Water about 12 min this morning (about 24 L)' },
  why: { summary: 'Your soil has dried to the watering point.', facts: [], rule: 'r', confidence: 'Medium' },
  confidence: { level: 'medium', reason: 'Medium: based on the weather; the planting date is missing.' },
  confidenceExplanation: null,
  nextStep: { field: 'planting_date', ask: 'Add the planting date.' },
};

// The first render loads react-native's Modal and friends, which can take longer than
// one test's 5 s on a cold jest cache, so we warm up once outside the tests.
beforeAll(async () => {
  await render(<TodayCard zone={zone} onLogged={jest.fn()} />);
}, 60000);

beforeEach(() => jest.clearAllMocks());

describe('TodayCard', () => {
  it('shows the one action and the confidence badge', async () => {
    await render(<TodayCard zone={zone} onLogged={jest.fn()} />);
    expect(screen.getByText('Water about 12 min this morning (about 24 L)')).toBeTruthy();
    expect(screen.getByText('Medium confidence')).toBeTruthy();
  });

  it('no longer has its own Finish setup: Home has one setup card instead', async () => {
    await render(<TodayCard zone={zone} onLogged={jest.fn()} />);
    expect(screen.queryByRole('button', { name: 'Finish setup for Bed 1' })).toBeNull();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('logs a watering by hand and refreshes the card', async () => {
    const onLogged = jest.fn();
    await render(<TodayCard zone={zone} onLogged={onLogged} />);

    await fireEvent.press(screen.getByRole('button', { name: 'I watered' }));
    await fireEvent.press(screen.getByRole('button', { name: 'I watered for 10 minutes' }));

    await waitFor(() => expect(onLogged).toHaveBeenCalledTimes(1));
    expect(api.logManualWatering).toHaveBeenCalledTimes(1);
    expect(api.logManualWatering).toHaveBeenCalledWith(7, { minutes: 10 });
    expect(await screen.findByText("Watering logged. Today's advice now counts it.")).toBeTruthy();
  });

  it('logs how the soil feels', async () => {
    await render(<TodayCard zone={zone} onLogged={jest.fn()} />);
    await fireEvent.press(screen.getByRole('button', { name: 'How does the soil feel?' }));
    await fireEvent.press(screen.getByRole('button', { name: 'The soil feels dry' }));
    await waitFor(() => expect(api.logSoilFeel).toHaveBeenCalledWith(7, 'dry'));
  });

  it('says when the advice is longer than one run of this pump, instead of cutting it short', async () => {
    await render(<TodayCard zone={{ ...zone, action: { kind: 'water', text: 'Water about 66 min this morning (about 99 L)' }, recommendedMinutes: 66, maxRunMinutes: 5 }} onLogged={jest.fn()} />);
    expect(screen.getByTestId('today-over-limit-7').props.children)
      .toBe('Recommended 66 min — your pump is limited to 5 min per run; run it again after it finishes');
  });

  it('says nothing extra when one run is enough', async () => {
    await render(<TodayCard zone={{ ...zone, recommendedMinutes: 12, maxRunMinutes: 30 }} onLogged={jest.fn()} />);
    expect(screen.queryByTestId('today-over-limit-7')).toBeNull();
  });
});
