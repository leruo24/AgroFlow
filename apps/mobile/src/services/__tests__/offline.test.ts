/// <reference types="jest" />
// See doubleSubmit.test.ts for why this reference is per file.

/* Phone offline (Part B item 8), with the real API client, cache and queue, and only the
 * network faked: the last-loaded data is shown with its time; refills, pH readings and soil
 * checks wait on the phone and are sent once, in order; irrigation commands never wait. */

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);
jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: { access_token: 'test-token', user: { id: 'farmer-1' } } }, error: null }),
    },
  },
}));

process.env.EXPO_PUBLIC_AGROFLOW_API_BASE = 'https://api.agroflow.test';

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  fetchFarmerDashboard,
  fetchFarmToday,
  logSoilFeel,
  logSoilPh,
  logTankRefill,
  sendManualIrrigationCommand,
  OfflineNoDataError,
} from '../agroFlowApi';
import { getConnectivity, isNetworkError, reportNetworkSuccess } from '@/lib/connectivity';
import { setCacheUser } from '@/lib/offlineCache';
import { enqueue, flushQueue, pendingWrites, setQueueUser } from '@/lib/offlineQueue';

type Call = { url: string; method: string; body: unknown };

let calls: Call[] = [];
let online = true;
let refuse: ((url: string) => number | null) | null = null;

function installFetch() {
  globalThis.fetch = jest.fn(async (url: string, init?: RequestInit) => {
    if (!online) throw new TypeError('Network request failed');
    const method = (init?.method ?? 'GET').toUpperCase();
    calls.push({ url, method, body: init?.body ? JSON.parse(init.body as string) : undefined });
    await new Promise(r => setTimeout(r, 5));
    const status = refuse?.(url) ?? 200;
    if (status !== 200) {
      return new Response(JSON.stringify({ error: 'You can log up to 7 days back.' }), { status, headers: { 'Content-Type': 'application/json' } });
    }
    const body = url.includes('/dashboard')
      ? { profile: null, farms: [], farm: { farm_id: 1, name: 'Nkosi Farm' }, zones: [{ id: 7, name: 'Bed 1' }], readings: [], events: [], usage: [], weather: [], alerts: [] }
      : url.includes('/today')
        ? { farmId: 1, day: '2026-10-19', zones: [] }
        : url.includes('/tank/refills')
          ? { status: { farmId: 1 }, estimatedUsedBeforeRefill: null, observedUsed: null, comparison: null }
          : { id: 1, message: 'ok' };
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as unknown as typeof fetch;
}

const original = globalThis.fetch;

beforeEach(async () => {
  calls = [];
  online = true;
  refuse = null;
  await AsyncStorage.clear();
  installFetch();
  reportNetworkSuccess();
  setCacheUser('farmer-1');
  await setQueueUser(null);
  await setQueueUser('farmer-1');
});

afterAll(() => {
  globalThis.fetch = original;
});

describe('offline cache', () => {
  it('shows the last-loaded Home data, with the time it was saved, when offline', async () => {
    const before = Date.now();
    const live = await fetchFarmerDashboard('1');
    expect(live.zones).toHaveLength(1);
    expect(getConnectivity()).toEqual({ online: true, dataFrom: null });

    online = false;
    const offline = await fetchFarmerDashboard('1');

    expect(offline).toEqual(live);                  // the saved copy
    const state = getConnectivity();
    expect(state.online).toBe(false);
    expect(state.dataFrom).not.toBeNull();
    expect(state.dataFrom!).toBeGreaterThanOrEqual(before);   // when it was saved
    expect(state.dataFrom!).toBeLessThanOrEqual(Date.now());
  });

  it('says plainly when nothing has been saved on this phone yet', async () => {
    online = false;
    await expect(fetchFarmToday(1)).rejects.toBeInstanceOf(OfflineNoDataError);
    await expect(fetchFarmToday(1)).rejects.toThrow('hasn’t been loaded on this phone yet');
  });

  it('keeps one farmer’s saved copy away from another', async () => {
    await fetchFarmerDashboard('1');
    setCacheUser('farmer-2');
    online = false;
    await expect(fetchFarmerDashboard('1')).rejects.toBeInstanceOf(OfflineNoDataError);
  });

  it('back online, live data replaces the copy and the offline flag clears', async () => {
    await fetchFarmerDashboard('1');
    online = false;
    await fetchFarmerDashboard('1');
    expect(getConnectivity().online).toBe(false);
    online = true;
    await fetchFarmerDashboard('1');
    expect(getConnectivity()).toEqual({ online: true, dataFrom: null });
  });
});

describe('offline queue', () => {
  it('keeps a refill, a soil pH reading and a soil check offline, then sends each exactly once, in order', async () => {
    online = false;
    const refill = await logTankRefill(1, { litresAdded: 500, waterPh: 7.1, refilledAt: '2026-10-19T06:00:00.000Z' });
    const ph = await logSoilPh(7, { ph: 6.4, measuredAt: '2026-10-19T06:05:00.000Z', note: null });
    const feel = await logSoilFeel(7, 'dry', new Date('2026-10-19T06:10:00.000Z'));
    expect([refill.queued, ph.queued, feel.queued]).toEqual([true, true, true]);
    expect(pendingWrites()).toHaveLength(3);
    expect(calls).toHaveLength(0);

    online = true;
    // Two reconnect events at once (the probe and the app coming to the front) must not
    // send anything twice.
    const [a, b] = await Promise.all([flushQueue(), flushQueue()]);
    expect(a).toEqual({ sent: 3, refused: 0, waiting: 0 });
    expect(b).toEqual(a);
    await flushQueue();   // and nothing is left to resend

    const posts = calls.filter(c => c.method === 'POST');
    expect(posts.map(c => c.url.replace('https://api.agroflow.test', ''))).toEqual([
      '/api/farmer/farms/1/tank/refills',
      '/api/farmer/zones/7/soil-ph',
      '/api/farmer/zones/7/soil-feel',
    ]);
    // Each keeps the time it happened, not the time it was sent.
    expect(posts[0].body).toMatchObject({ litresAdded: 500, refilledAt: '2026-10-19T06:00:00.000Z' });
    expect(posts[1].body).toMatchObject({ ph: 6.4, measuredAt: '2026-10-19T06:05:00.000Z' });
    expect(posts[2].body).toEqual({ feel: 'dry', at: '2026-10-19T06:10:00.000Z' });
    expect(pendingWrites()).toHaveLength(0);
  });

  it('stays in order and keeps the rest when the connection drops halfway', async () => {
    online = false;
    await logSoilPh(7, { ph: 6.1, measuredAt: '2026-10-19T06:00:00.000Z', note: null });
    await logSoilPh(7, { ph: 6.2, measuredAt: '2026-10-19T06:01:00.000Z', note: null });
    // Still offline: nothing goes, nothing is lost.
    expect(await flushQueue()).toEqual({ sent: 0, refused: 0, waiting: 2 });
    online = true;
    expect(await flushQueue()).toEqual({ sent: 2, refused: 0, waiting: 0 });
    expect(calls.filter(c => c.method === 'POST').map(c => (c.body as { ph: number }).ph)).toEqual([6.1, 6.2]);
  });

  it('survives the app being closed: the queue is on the phone, not just in memory', async () => {
    online = false;
    await logTankRefill(1, { litresAdded: 250, waterPh: null, refilledAt: '2026-10-19T05:00:00.000Z' });
    await setQueueUser(null);          // app closed
    await setQueueUser('farmer-1');    // and opened again
    expect(pendingWrites()).toHaveLength(1);
    online = true;
    expect(await flushQueue()).toEqual({ sent: 1, refused: 0, waiting: 0 });
  });

  it('drops an entry the server refuses, with its reason, and carries on', async () => {
    online = false;
    await logSoilFeel(7, 'wet', new Date('2026-10-01T06:00:00.000Z'));
    await logSoilFeel(7, 'moist', new Date('2026-10-19T06:00:00.000Z'));
    online = true;
    refuse = url => (calls.filter(c => c.url === url).length === 1 ? 400 : null);
    const result = await flushQueue();
    expect(result).toEqual({ sent: 1, refused: 1, waiting: 0 });
  });
});

describe('irrigation commands are never queued', () => {
  it('a Start with no connection fails and leaves nothing waiting', async () => {
    online = false;
    let error: unknown;
    try {
      await sendManualIrrigationCommand('7', 'start', 300);
    } catch (e) {
      error = e;
    }
    expect(isNetworkError(error)).toBe(true);
    expect(pendingWrites()).toHaveLength(0);

    online = true;
    await flushQueue();
    expect(calls.filter(c => c.url.includes('/commands'))).toHaveLength(0);   // never sent later
  });

  it('the queue refuses a command even if asked directly', async () => {
    await expect(enqueue('soil_check', '/api/farmer/zones/7/commands', { command: 'start' })).rejects.toThrow(
      'Only tank refills, pH readings and soil checks can be saved for later.'
    );
    await expect(enqueue('tank_refill', '/api/farmer/zones/7/commands', {})).rejects.toThrow();
    expect(pendingWrites()).toHaveLength(0);
  });
});
