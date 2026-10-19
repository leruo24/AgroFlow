// The last answer to each GET the app made, kept on the phone per signed-in farmer, so Home,
// zones, latest readings, today's advice and alerts still show when there is no connection.
// Read-only: a cached copy is only ever shown, never sent anywhere.

import AsyncStorage from '@react-native-async-storage/async-storage';

const PREFIX = 'agroflow_cache:v1:';
const USER_KEY = 'agroflow_cache_user';

export type Cached<T> = { savedAt: number; data: T };

// Whose cache to use. Set from the session by AuthContext, and remembered, so a phone that
// opens offline with an expired login still finds its own farmer's copy.
let cacheUser: string | null = null;

export function setCacheUser(userId: string | null) {
  cacheUser = userId;
  try {
    if (userId) void AsyncStorage.setItem(USER_KEY, userId).catch(() => undefined);
  } catch { /* storage unavailable: the in-memory value still works */ }
}

export async function getCacheUser(): Promise<string | null> {
  if (cacheUser) return cacheUser;
  try {
    cacheUser = await AsyncStorage.getItem(USER_KEY);
  } catch {
    cacheUser = null;
  }
  return cacheUser;
}

function key(userId: string, path: string) {
  return `${PREFIX}${userId}:${path}`;
}

export async function saveCached<T>(userId: string, path: string, data: T, now = Date.now()): Promise<void> {
  try {
    await AsyncStorage.setItem(key(userId, path), JSON.stringify({ savedAt: now, data } satisfies Cached<T>));
  } catch {
    // A full or unavailable storage must not break a screen that just loaded fine.
  }
}

export async function readCached<T>(userId: string, path: string): Promise<Cached<T> | null> {
  try {
    const raw = await AsyncStorage.getItem(key(userId, path));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Cached<T>;
    return typeof parsed?.savedAt === 'number' ? parsed : null;
  } catch {
    return null;
  }
}

// Signing out removes this farmer's copies, so the next person on a shared phone sees nothing.
export async function clearCacheFor(userId: string): Promise<void> {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const mine = keys.filter(k => k.startsWith(`${PREFIX}${userId}:`));
    if (mine.length) await AsyncStorage.multiRemove(mine);
    if (cacheUser === userId) cacheUser = null;
    await AsyncStorage.removeItem(USER_KEY);
  } catch { /* nothing to clear */ }
}

// "today 08:15", "yesterday 17:40" or "14 Oct 08:15", in the phone's own time.
export function savedAtLabel(savedAt: number, now = Date.now(), locale?: string): { day: 'today' | 'yesterday' | 'date'; text: string } {
  const at = new Date(savedAt);
  const time = `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  if (savedAt >= start.getTime()) return { day: 'today', text: time };
  if (savedAt >= start.getTime() - 86_400_000) return { day: 'yesterday', text: time };
  let date: string;
  try {
    date = at.toLocaleDateString(locale ?? 'en-ZA', { day: 'numeric', month: 'short' });
  } catch {
    date = at.toISOString().slice(0, 10);
  }
  return { day: 'date', text: `${date} ${time}` };
}
