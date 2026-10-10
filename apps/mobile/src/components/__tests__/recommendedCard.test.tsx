/// <reference types="jest" />
// See services/__tests__/doubleSubmit.test.ts for why this reference is per file.

/* "Recommended for you" shows the server's sentence; Use these settings saves through
 * Reset to recommended; Keep my own hides it. */

jest.mock('@/context/ThemeContext', () => {
  const { lightColors } = jest.requireActual('@/constants/colors');
  return { useTheme: () => ({ colors: lightColors }) };
});
jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('lucide-react-native', () =>
  new Proxy({}, { get: (_target, name) => (name === '__esModule' ? false : () => null) })
);
jest.mock('@/services/agroFlowApi', () => ({
  fetchRecommendedSettings: jest.fn(),
  resetZoneToRecommended: jest.fn(() => Promise.resolve({ message: 'Reset for potato: waters at 2160, stops at 1200.' })),
}));

import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { RecommendedCard } from '../RecommendedCard';
import * as api from '@/services/agroFlowApi';
import type { RecommendedSettings } from '@/services/agroFlowApi';
import { dayLabel, shiftDate } from '@/lib/setupHelpers';

const rec: RecommendedSettings = {
  available: true,
  text: 'Based on your climate in Mafikeng and since you want to grow potato on loam soil, we recommend: water when the soil reaches about 65% (relative), stop at 100%.',
  thresholdPercent: 65,
  confidence: { level: 'medium', reason: 'Medium: the planting date is missing.' },
  canApply: true,
};

beforeAll(async () => {
  await render(<RecommendedCard zoneId={1} recommendation={rec} />);
}, 60000);
beforeEach(() => jest.clearAllMocks());

describe('RecommendedCard', () => {
  it('shows the sentence and saves through Reset to recommended', async () => {
    await render(<RecommendedCard zoneId={7} recommendation={rec} />);
    expect(screen.getByText(rec.text)).toBeTruthy();
    expect(screen.getByText('Medium confidence')).toBeTruthy();

    await fireEvent.press(screen.getByRole('button', { name: 'Use these settings' }));
    await waitFor(() => expect(api.resetZoneToRecommended).toHaveBeenCalledWith(7));
    expect(await screen.findByText('Reset for potato: waters at 2160, stops at 1200.')).toBeTruthy();
  });

  it('explains instead of saving when the sensor is not set up', async () => {
    await render(<RecommendedCard zoneId={7} recommendation={{ ...rec, canApply: false, applyNote: 'Do the wet and dry soil setup first.' }} />);
    expect(screen.getByText('Do the wet and dry soil setup first.')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Use these settings' }));
    expect(api.resetZoneToRecommended).not.toHaveBeenCalled();
  });

  it('Keep my own hides the card', async () => {
    await render(<RecommendedCard zoneId={7} recommendation={rec} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Keep my own' }));
    expect(screen.queryByText(rec.text)).toBeNull();
  });

  it('fetches when not given one, and shows nothing without a crop', async () => {
    (api.fetchRecommendedSettings as jest.Mock).mockResolvedValueOnce({ available: false, text: 'Choose a crop.' });
    await render(<RecommendedCard zoneId={9} />);
    await waitFor(() => expect(api.fetchRecommendedSettings).toHaveBeenCalledWith(9));
    expect(screen.queryByText('Choose a crop.')).toBeNull();
  });
});

describe('planting date stepper', () => {
  it('moves by days and never past today', () => {
    expect(shiftDate('2026-10-01', -7, '2026-10-06')).toBe('2026-09-24');
    expect(shiftDate('2026-10-05', 7, '2026-10-06')).toBe('2026-10-06');
    expect(dayLabel('2026-10-06')).toBe('6 Oct 2026');
  });
});
