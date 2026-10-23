/// <reference types="jest" />
// Codex's presentation components on the real contracts (release 2026-10-23):
// Terms & privacy from the journey, the hosepipe from the server's count.
import { fireEvent, render } from '@testing-library/react-native';
import { ThemeProvider } from '@/context/ThemeContext';
import { LegalNotice } from '@/components/visual/LegalNotice';
import { HosepipeProgress } from '@/components/visual/SetupPresentation';
import type { JourneyState } from '@/hooks/useJourney';

jest.mock('lucide-react-native', () => new Proxy({}, { get: (_t, name) => (name === '__esModule' ? false : () => null) }));
jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual('react-native');
  return { SafeAreaView: View, useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }) };
});
jest.mock('@/lib/router', () => ({ router: { push: jest.fn(), back: jest.fn(), canGoBack: () => true, navigate: jest.fn() } }));

const wrap = (children: React.ReactNode) => <ThemeProvider>{children}</ThemeProvider>;
const docs = [
  { key: 'terms', title: 'Terms of service', version: '0.1-draft', date: '2026-10-23', status: 'draft', statusLabel: 'Draft – needs approval', url: '' },
  { key: 'privacy', title: 'Privacy notice', version: '0.1-draft', date: '2026-10-23', status: 'draft', statusLabel: 'Draft – needs approval', url: '' },
];
const ready = (accepted: boolean): JourneyState => ({
  status: 'ready',
  journey: { terms: { accepted: { all: accepted, termsAcceptedAt: accepted ? '2026-10-23T08:30:00Z' : null, privacyAcceptedAt: accepted ? '2026-10-23T08:30:00Z' : null }, documents: docs } } as never,
});

test("Terms & privacy shows each document's real version and draft status, and the recorded acceptance", async () => {
  const view = await render(wrap(<LegalNotice journey={ready(true)} />));
  await fireEvent.press(view.getByTestId('legal-notice'));
  expect(view.getByTestId('legal-notice-terms')).toHaveTextContent(/Version 0\.1-draft, 2026-10-23/);
  expect(view.getByTestId('legal-notice-privacy')).toHaveTextContent(/Draft – needs approval/);
  expect(view.getByTestId('legal-notice-acceptance')).toHaveTextContent(/You accepted these on/);
});

test('it never says accepted before the server recorded it, and says where to accept', async () => {
  const view = await render(wrap(<LegalNotice journey={ready(false)} />));
  await fireEvent.press(view.getByTestId('legal-notice'));
  expect(view.getByTestId('legal-notice-acceptance')).toHaveTextContent(/Not accepted yet/);
});

test('while loading it says so; with no journey it says the documents could not be loaded', async () => {
  const loading = await render(wrap(<LegalNotice journey={{ status: 'loading', journey: null }} />));
  await fireEvent.press(loading.getByTestId('legal-notice'));
  expect(loading.getByText('Loading the documents…')).toBeTruthy();
  const failed = await render(wrap(<LegalNotice journey={{ status: 'error', journey: null }} />));
  await fireEvent.press(failed.getByTestId('legal-notice'));
  expect(failed.getByTestId('legal-notice-failed')).toBeTruthy();
});

test("the hosepipe fills one section per task the server counts as done, with the server's words", async () => {
  const view = await render(wrap(<HosepipeProgress completed={3} installationStage="visit_booked"
    label="Your details: 3 of 4" installationText="Installation: visit booked"
    detailsTestID="d" installationTestID="i" />));
  expect(view.getByTestId('d')).toHaveTextContent('Your details: 3 of 4');
  expect(view.getByTestId('i')).toHaveTextContent('Installation: visit booked');
  expect(view.getAllByTestId('hose-filled', { includeHiddenElements: true })).toHaveLength(3);
  expect(view.getAllByTestId('hose-unfilled', { includeHiddenElements: true })).toHaveLength(1);
});
