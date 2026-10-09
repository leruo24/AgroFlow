/* One request for one intention.
 * Screens guard their buttons with React state (tap -> set `saving` -> re-render -> disabled),
 * but a second tap before that re-render still goes through; on a phone a double tap is two
 * events in one frame. This mattered most for "Water now": two quick taps both passed the
 * "pump already running" check and sent two start commands.
 * So writes are deduplicated where they are made: if an identical write (same method, path
 * and body) is already in flight, the second caller gets the first one's promise. Different
 * writes are untouched, and repeating a write after the first one finishes works normally. */

const inFlight = new Map<string, Promise<unknown>>();

export function singleFlight<T>(key: string, run: () => Promise<T>): Promise<T> {
  const existing = inFlight.get(key);
  if (existing) return existing as Promise<T>;

  const promise = run().finally(() => {
    // Only remove our own entry - if a later call has replaced it, leave that.
    if (inFlight.get(key) === promise) inFlight.delete(key);
  });

  inFlight.set(key, promise);
  return promise;
}

/** The identity of a write: method, path and body. */
export function writeKey(method: string, path: string, body?: BodyInit | null): string {
  return `${method.toUpperCase()} ${path} ${typeof body === 'string' ? body : ''}`;
}

/** Tests only. */
export function pendingWrites(): number {
  return inFlight.size;
}
