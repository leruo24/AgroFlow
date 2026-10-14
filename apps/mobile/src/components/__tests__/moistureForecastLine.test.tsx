/// <reference types="jest" />
// See services/__tests__/doubleSubmit.test.ts for why this reference is per file.

/* The zone screen's "Forecast (machine learning model)" line: shown only when the
 * server says the zone has enough data, and labelled when the data is simulated. */

jest.mock('@/context/ThemeContext', () => {
  const { lightColors } = jest.requireActual('@/constants/colors');
  return { useTheme: () => ({ colors: lightColors }) };
});

jest.mock('@/lib/supabase', () => ({ supabase: {} }));

jest.mock('@/services/agroFlowApi', () => ({
  fetchMoistureForecast: jest.fn(),
}));

import { render, screen, waitFor } from '@testing-library/react-native';
import { MoistureForecastLine } from '../MoistureForecastLine';
import * as api from '@/services/agroFlowApi';
import type { MoistureForecast } from '@/services/agroFlowApi';

const fetchMock = api.fetchMoistureForecast as jest.Mock;

const available: MoistureForecast = {
  available: true,
  label: 'Forecast (machine learning model)',
  text: 'Likely to need water in about 14 hours',
  hoursUntilWater: 14,
  currentMoisturePct: 61.2,
  predictedMoisturePct24h: 44.8,
  simulatedData: true,
  trainedOnSimulatedOnly: true,
};

beforeEach(() => fetchMock.mockReset());

test('shows the labelled forecast and says the data is simulated', async () => {
  fetchMock.mockResolvedValue(available);
  await render(<MoistureForecastLine zoneId={3} />);

  expect(await screen.findByText('Likely to need water in about 14 hours')).toBeTruthy();
  expect(screen.getByText('Forecast (machine learning model)')).toBeTruthy();
  expect(screen.getByText('Simulated readings · Model trained on Simulated farm data')).toBeTruthy();
  expect(fetchMock).toHaveBeenCalledWith(3);
});

test('shows nothing when the zone has too little data', async () => {
  fetchMock.mockResolvedValue({ ...available, available: false, text: null });
  const { toJSON } = await render(<MoistureForecastLine zoneId={3} />);

  await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  expect(toJSON()).toBeNull();
  expect(screen.queryByText('Forecast (machine learning model)')).toBeNull();
});

test('shows nothing when the forecast cannot be loaded', async () => {
  fetchMock.mockRejectedValue(new Error('offline'));
  const { toJSON } = await render(<MoistureForecastLine zoneId={3} />);

  await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  expect(toJSON()).toBeNull();
});
