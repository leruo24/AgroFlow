/// <reference types="jest" />
// TypeScript 6 does not auto-include @types packages, and adding jest to tsconfig "types"
// would put describe/it/expect in scope for the whole app, so the reference is per test file.

/* The real service code with only the network faked.
 * "Water now" is the important case: startManualIrrigation's "pump already running" flag is
 * only set after the request returns, so two quick taps both passed the check. These run the
 * real API functions against a fake fetch and count what reaches the network. */

jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: { access_token: 'test-token' } } }),
    },
  },
}));

process.env.EXPO_PUBLIC_AGROFLOW_API_BASE = 'https://api.agroflow.test';

import {
  sendManualIrrigationCommand,
  saveZoneSoilType,
  createReportRequest,
  fetchZoneInsights,
} from '../agroFlowApi';

type Call = { url: string; method: string; body: string | undefined };

function fakeFetch(delayMs = 30) {
  const calls: Call[] = [];
  const fn = jest.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, method: (init?.method ?? 'GET').toUpperCase(), body: init?.body as string | undefined });
    await new Promise((r) => setTimeout(r, delayMs));
    return new Response(JSON.stringify({ id: 'cmd-1', ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  return { fn, calls };
}

describe('double submits reach the server once', () => {
  let original: typeof fetch;

  beforeEach(() => {
    original = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = original;
  });

  it('"Water now" tapped twice sends ONE pump command', async () => {
    const { fn, calls } = fakeFetch();
    globalThis.fetch = fn as unknown as typeof fetch;

    await Promise.all([
      sendManualIrrigationCommand('7', 'start', 120),
      sendManualIrrigationCommand('7', 'start', 120),
    ]);

    const commands = calls.filter((c) => c.method === 'POST' && c.url.endsWith('/zones/7/commands'));
    expect(commands).toHaveLength(1);
  });

  it('start and stop are different commands, and both are sent', async () => {
    const { fn, calls } = fakeFetch();
    globalThis.fetch = fn as unknown as typeof fetch;

    await Promise.all([
      sendManualIrrigationCommand('7', 'start', 120),
      sendManualIrrigationCommand('7', 'stop'),
    ]);

    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(2);
  });

  it('Save tapped twice saves once', async () => {
    const { fn, calls } = fakeFetch();
    globalThis.fetch = fn as unknown as typeof fetch;

    await Promise.all([saveZoneSoilType(7, 'loam'), saveZoneSoilType(7, 'loam')]);

    expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(1);
  });

  it('"Make me this report" tapped twice queues one report', async () => {
    const { fn, calls } = fakeFetch();
    globalThis.fetch = fn as unknown as typeof fetch;

    const input = {
      reportType: 'water_usage' as const,
      period: 'last_7_days' as const,
      farmId: 3,
      zoneId: null,
    };

    await Promise.all([createReportRequest(input), createReportRequest(input)]);

    expect(calls.filter((c) => c.method === 'POST' && c.url.endsWith('/report-requests'))).toHaveLength(1);
  });

  it('reads are never merged - two screens may each want fresh data', async () => {
    const { fn, calls } = fakeFetch();
    globalThis.fetch = fn as unknown as typeof fetch;

    await Promise.all([fetchZoneInsights(7), fetchZoneInsights(7)]);

    expect(calls.filter((c) => c.method === 'GET')).toHaveLength(2);
  });
});
