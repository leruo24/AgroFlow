// Things a farmer can write down offline and have sent later: ONLY a tank refill, a soil pH
// reading and a soil check. Each carries the time it happened, so it means the same thing when
// it arrives an hour later.
//
// Never queued: irrigation commands (Start/Stop), or anything else. A pump command sent hours
// late could water a zone nobody wants watered, so those need a connection (the button says
// "Needs a connection to reach your kit"). QUEUEABLE below is the whole list, and enqueue()
// refuses any other path.
//
// No duplicates: one flush at a time; an entry is removed from storage as soon as the server
// accepts it, before the next is sent; and the server treats the same entry twice (same zone or
// farm, same time, same values) as one, which covers an answer lost on the way back.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';

export type QueueKind = 'tank_refill' | 'soil_ph' | 'soil_check';

// The only writes that may wait for a connection, by path.
const QUEUEABLE: Record<QueueKind, RegExp> = {
  tank_refill: /^\/api\/farmer\/farms\/\d+\/tank\/refills$/,
  soil_ph: /^\/api\/farmer\/zones\/\d+\/soil-ph$/,
  soil_check: /^\/api\/farmer\/zones\/\d+\/soil-feel$/,
};

export type QueuedWrite = {
  id: string;
  kind: QueueKind;
  path: string;
  body: Record<string, unknown>;
  createdAt: number;
};

// What the server said about one entry when it could not be kept (e.g. older than 7 days).
export type QueueProblem = { kind: QueueKind; createdAt: number; message: string };

// Sends one entry. Resolves when the server accepted it; rejects with a NetworkError when there
// was no answer (keep it, try later) or with a plain Error when the server refused it (drop it,
// tell the farmer). Set by services/agroFlowApi.ts.
type Sender = (entry: QueuedWrite) => Promise<void>;
type ErrorClassifier = (error: unknown) => 'network' | 'refused';

const STORAGE_PREFIX = 'agroflow_queue:v1:';
let sender: Sender | null = null;
let classify: ErrorClassifier = () => 'network';
let userId: string | null = null;
let entries: QueuedWrite[] = [];
let problems: QueueProblem[] = [];
let loaded: Promise<void> | null = null;
let flushing: Promise<FlushResult> | null = null;
const listeners = new Set<() => void>();
let snapshot = { pending: 0, problems: [] as QueueProblem[] };

export type FlushResult = { sent: number; refused: number; waiting: number };

function notify() {
  snapshot = { pending: entries.length, problems };
  listeners.forEach(fn => fn());
}

export function setQueueSender(fn: Sender, classifier: ErrorClassifier) {
  sender = fn;
  classify = classifier;
}

export function isQueueable(kind: QueueKind, path: string): boolean {
  return Object.prototype.hasOwnProperty.call(QUEUEABLE, kind) && QUEUEABLE[kind].test(path);
}

async function persist() {
  if (!userId) return;
  try {
    await AsyncStorage.setItem(STORAGE_PREFIX + userId, JSON.stringify(entries));
  } catch { /* kept in memory until the next try */ }
}

// Called by AuthContext when the farmer changes (or signs out with null).
export function setQueueUser(next: string | null): Promise<void> {
  if (next === userId && loaded) return loaded;
  userId = next;
  entries = [];
  problems = [];
  notify();
  loaded = (async () => {
    if (!next) return;
    try {
      const raw = await AsyncStorage.getItem(STORAGE_PREFIX + next);
      const parsed = raw ? (JSON.parse(raw) as QueuedWrite[]) : [];
      // Anything that is not one of the three kinds is dropped on load as well.
      entries = Array.isArray(parsed) ? parsed.filter(e => e && isQueueable(e.kind, e.path)) : [];
    } catch {
      entries = [];
    }
    notify();
  })();
  return loaded;
}

function newId(): string {
  const random = Math.random().toString(36).slice(2, 10);
  return `${Date.now().toString(36)}-${random}`;
}

// Keeps one entry to send later. Throws for anything that is not one of the three kinds.
export async function enqueue(kind: QueueKind, path: string, body: Record<string, unknown>, now = Date.now()): Promise<QueuedWrite> {
  if (!isQueueable(kind, path)) {
    throw new Error('Only tank refills, pH readings and soil checks can be saved for later.');
  }
  await (loaded ?? Promise.resolve());
  const entry: QueuedWrite = { id: newId(), kind, path, body, createdAt: now };
  entries = [...entries, entry];
  notify();
  await persist();
  return entry;
}

// Sends what is waiting, oldest first. Only one flush runs at a time; a second call while one
// is running gets the same result instead of sending anything twice.
export function flushQueue(): Promise<FlushResult> {
  if (flushing) return flushing;
  flushing = (async () => {
    await (loaded ?? Promise.resolve());
    let sent = 0;
    let refused = 0;
    while (entries.length > 0 && sender) {
      const entry = entries[0];
      try {
        await sender(entry);
        sent++;
      } catch (error) {
        if (classify(error) === 'network') break;   // still offline: keep it, keep the order
        refused++;
        problems = [...problems, {
          kind: entry.kind,
          createdAt: entry.createdAt,
          message: error instanceof Error ? error.message : 'The server did not accept it.',
        }];
      }
      // Accepted or refused, it is done: remove it before sending the next one.
      entries = entries.filter(e => e.id !== entry.id);
      notify();
      await persist();
    }
    return { sent, refused, waiting: entries.length };
  })().finally(() => { flushing = null; });
  return flushing;
}

export function pendingWrites(): readonly QueuedWrite[] {
  return entries;
}

export function clearQueueProblems() {
  problems = [];
  notify();
}

export function subscribeQueue(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function useOfflineQueue(): { pending: number; problems: QueueProblem[] } {
  return useSyncExternalStore(subscribeQueue, () => snapshot, () => snapshot);
}

// For tests only.
export function resetQueueForTests() {
  sender = null;
  classify = () => 'network';
  userId = null;
  entries = [];
  problems = [];
  loaded = null;
  flushing = null;
  listeners.clear();
  snapshot = { pending: 0, problems: [] };
}
