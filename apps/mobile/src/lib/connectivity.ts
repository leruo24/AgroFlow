// Is the phone reaching AgroFlow right now? Worked out from what actually happens to our own
// requests, not from the phone's WiFi icon: a phone can show full bars on a farm WiFi with no
// internet behind it. No extra native module, so no new APK is needed for this.
//
// - A request that fails at the network level (no answer at all) marks the app offline.
// - Any answer from the server, even an error, marks it online again.
// - While offline it asks the API's open /api/public/ping every PROBE_MS, and on the web it
//   also listens to the browser's online/offline events.
// Screens read it with useConnectivity(); services call reportNetworkFailure/Success.

import { useSyncExternalStore } from 'react';

export type Connectivity = {
  online: boolean;
  // When the shown data was saved on this phone, if a screen fell back to it: the oldest
  // cached copy shown since going offline. Null when everything on screen is live.
  dataFrom: number | null;
};

const PROBE_MS = 10_000;

let state: Connectivity = { online: true, dataFrom: null };
const listeners = new Set<() => void>();
let probeTimer: ReturnType<typeof setInterval> | null = null;
let probe: (() => Promise<boolean>) | null = null;

function set(next: Connectivity) {
  if (next.online === state.online && next.dataFrom === state.dataFrom) return;
  const cameBack = next.online && !state.online;
  state = next;
  listeners.forEach(fn => fn());
  if (cameBack) reconnectListeners.forEach(fn => { try { fn(); } catch { /* one listener must not stop the rest */ } });
}

export function getConnectivity(): Connectivity {
  return state;
}

export function isOnline(): boolean {
  return state.online;
}

export function subscribeConnectivity(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

// Called once when the app comes back online: flush the offline queue, reload screens.
const reconnectListeners = new Set<() => void>();
export function onReconnect(fn: () => void): () => void {
  reconnectListeners.add(fn);
  return () => { reconnectListeners.delete(fn); };
}

export function reportNetworkFailure() {
  if (state.online) set({ online: false, dataFrom: state.dataFrom });
  startProbing();
}

export function reportNetworkSuccess() {
  stopProbing();
  if (!state.online || state.dataFrom !== null) set({ online: true, dataFrom: null });
}

// A screen is showing a copy saved at `savedAt`. The banner shows the oldest one.
export function noteCachedDataShown(savedAt: number) {
  const dataFrom = state.dataFrom === null ? savedAt : Math.min(state.dataFrom, savedAt);
  set({ online: state.online, dataFrom });
}

// Set by the API client: how to check whether the server answers (no login needed).
export function setConnectivityProbe(fn: () => Promise<boolean>) {
  probe = fn;
}

function startProbing() {
  if (probeTimer || !probe) return;
  probeTimer = setInterval(() => {
    void probe?.().then(ok => { if (ok) reportNetworkSuccess(); }).catch(() => undefined);
  }, PROBE_MS);
}

function stopProbing() {
  if (probeTimer) clearInterval(probeTimer);
  probeTimer = null;
}

// The browser knows when the network is gone; on a phone the failed request tells us.
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('offline', () => reportNetworkFailure());
  window.addEventListener('online', () => {
    if (!probe) { reportNetworkSuccess(); return; }
    void probe().then(ok => (ok ? reportNetworkSuccess() : reportNetworkFailure())).catch(() => reportNetworkFailure());
  });
}

export function useConnectivity(): Connectivity {
  return useSyncExternalStore(subscribeConnectivity, getConnectivity, getConnectivity);
}

// For tests only.
export function resetConnectivityForTests() {
  stopProbing();
  state = { online: true, dataFrom: null };
  listeners.clear();
  reconnectListeners.clear();
  probe = null;
}

// No answer from the server at all, as opposed to an answer that says no.
export class NetworkError extends Error {
  constructor(message = 'You’re offline. Check your connection and try again.') {
    super(message);
    this.name = 'NetworkError';
  }
}

export function isNetworkError(error: unknown): boolean {
  if (error instanceof NetworkError) return true;
  if (!(error instanceof Error)) return false;
  // fetch: React Native "Network request failed", browsers "Failed to fetch" / "NetworkError
  // when attempting to fetch resource", and our 20 s timeout's AbortError.
  return error.name === 'AbortError' || error.name === 'AuthRetryableFetchError' ||
    /network request failed|failed to fetch|networkerror|load failed|network error/i.test(error.message);
}
