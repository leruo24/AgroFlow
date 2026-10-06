/// <reference types="jest" />
// See services/__tests__/doubleSubmit.test.ts for why this reference is per file.

/* Item 2c: "Why am I seeing this?" in the app.
 *
 * The sheet shows the server's own explanation - summary, what we used, the
 * rule, how sure, what would change it - and never the technical line. No
 * explanation means no link at all, rather than a generic one.
 */

jest.mock('@/context/ThemeContext', () => {
  const { lightColors } = jest.requireActual('@/constants/colors');
  return { useTheme: () => ({ colors: lightColors }) };
});

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('@/lib/supabase', () => ({ supabase: {} }));

// DripHelper reads its on/off preference from AsyncStorage; the package ships
// its own jest stand-in.
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

// Icons are not under test, and lucide ships ESM jest does not transform.
jest.mock('lucide-react-native', () =>
  new Proxy({}, { get: (_target, name) => (name === '__esModule' ? false : () => null) })
);

jest.mock('@/services/agroFlowApi', () => ({
  fetchZoneInsights: jest.fn(),
  dismissZoneInsight: jest.fn(() => Promise.resolve({ message: 'ok' })),
}));

import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { WhyLink, WHY_LINK_TEXT } from '../WhySheet';
import { ZoneInsightsCard } from '../ZoneInsightsCard';
import { decideMessage } from '../DripHelper';
import { explanationFrom } from '@/services/insightsService';
import * as api from '@/services/agroFlowApi';
import type { Explanation } from '@/services/agroFlowApi';

const explanation: Explanation = {
  summary: 'Your soil has dried to the point where tomato starts to struggle.',
  facts: [{ label: 'Rain expected today', value: '0 mm', source: 'weather app' }],
  rule: 'We suggest watering once your crop has used about 40% of the water your soil can hold for it.',
  confidence: 'Medium: based on the weather; the planting date is missing.',
  whatWouldChangeIt: 'If 5 mm of rain or more falls today, you can skip this.',
  technical: 'Dr 21.5 mm, RAW 21.5 mm. FAO-56 Eq. 85',
};

describe('WhyLink and WhySheet', () => {
  it('opens a sheet with summary, facts, rule, confidence and what would change it', async () => {
    await render(<WhyLink explanation={explanation} />);

    await fireEvent.press(screen.getByRole('button', { name: WHY_LINK_TEXT }));

    expect(screen.getByText(explanation.summary)).toBeTruthy();
    expect(screen.getByText('Rain expected today')).toBeTruthy();
    expect(screen.getByText('0 mm')).toBeTruthy();
    expect(screen.getByText('weather app')).toBeTruthy();
    expect(screen.getByText(explanation.rule)).toBeTruthy();
    expect(screen.getByText(explanation.confidence)).toBeTruthy();
    expect(screen.getByText(explanation.whatWouldChangeIt!)).toBeTruthy();
  });

  it('never shows the technical line to a farmer', async () => {
    await render(<WhyLink explanation={explanation} />);
    await fireEvent.press(screen.getByRole('button', { name: WHY_LINK_TEXT }));

    expect(screen.queryByText(/FAO-56 Eq/)).toBeNull();
    expect(screen.queryByText(/RAW/)).toBeNull();
  });

  it('renders nothing when there is no explanation - no generic text', async () => {
    const { toJSON } = await render(<WhyLink explanation={null} />);
    expect(toJSON()).toBeNull();
  });

  it('tells a self-hiding host (Drip) that the sheet opened', async () => {
    const onOpen = jest.fn();
    await render(<WhyLink explanation={explanation} onOpen={onOpen} />);
    await fireEvent.press(screen.getByRole('button', { name: WHY_LINK_TEXT }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});

describe('explanations read from Supabase', () => {
  it('keeps the plain parts and drops technical', () => {
    const parsed = explanationFrom({ explanation });
    expect(parsed?.summary).toBe(explanation.summary);
    expect(parsed?.facts).toHaveLength(1);
    expect(parsed).not.toHaveProperty('technical');
  });

  it('treats anything malformed as no explanation', () => {
    expect(explanationFrom(null)).toBeNull();
    expect(explanationFrom({})).toBeNull();
    expect(explanationFrom({ explanation: { summary: '' } })).toBeNull();
    expect(explanationFrom({ explanation: 'text' })).toBeNull();
  });
});

describe('Drip', () => {
  it("carries the explanation of the insight it chose", () => {
    const decision = decideMessage(
      [{ zoneId: '7', insightType: 'water_now', severity: 'act_now', message: 'Water Tub 1 now.', explanation }],
      0,
      [{ id: '7', name: 'Tub 1' } as never]
    );
    expect(decision.explanation).toBe(explanation);
  });

  it('has no explanation for "all good" - there is nothing to explain', () => {
    expect(decideMessage([], 0, []).explanation ?? null).toBeNull();
  });
});

describe('ZoneInsightsCard', () => {
  it('puts a Why link under every insight that has an explanation, and on the confidence badge', async () => {
    (api.fetchZoneInsights as jest.Mock).mockResolvedValue({
      zoneId: 7,
      day: '2026-10-06',
      growth: null,
      insights: [
        { insightType: 'water_now', severity: 'act_now', message: 'Water Tub 1 now.', explanation },
        { insightType: 'hot_days', severity: 'heads_up', message: 'Hot days ahead.', explanation },
        { insightType: 'old_row', severity: 'info', message: 'Written before explanations.' },
      ],
      confidence: { level: 'medium', reason: 'Medium: based on the weather.' },
      nextStep: { field: 'planting_date', ask: "Add the planting date for advice that follows your crop's growth." },
      confidenceExplanation: explanation,
    });

    await render(<ZoneInsightsCard zoneId={7} />);

    await waitFor(() => expect(screen.getByText('Water Tub 1 now.')).toBeTruthy());

    // Two insights with explanations + the confidence badge = three links;
    // the old row without one gets none.
    expect(screen.getAllByRole('button', { name: WHY_LINK_TEXT })).toHaveLength(3);
    expect(screen.getByText('Medium confidence')).toBeTruthy();
    expect(screen.getByText('Improve your advice')).toBeTruthy();
    expect(screen.getByText("Add the planting date for advice that follows your crop's growth.")).toBeTruthy();
  });
});
