/* One request for one intention (item 0b).
 *
 * WHY THIS IS IN THE DATA LAYER AND NOT ON EACH BUTTON
 * The screens that guard their buttons do it with React state: tap → set
 * `saving` → re-render → button disabled. But a second tap that lands before
 * that re-render sees `saving` still false and goes straight through. On a
 * phone that is not hypothetical - a double tap is two events inside one
 * frame.
 *
 * The case that mattered most: "Water now". startManualIrrigation checks
 * whether the pump is already running, but that flag is only set AFTER the
 * command's request returns. Two quick taps both passed the check and sent
 * two pump-start commands.
 *
 * So writes are deduplicated where they are made. If an IDENTICAL write -
 * same method, same path, same body - is already in flight, the second caller
 * gets the first one's promise instead of a second request. Different writes
 * are untouched, and a write repeated after the first has finished goes
 * through normally: this is about two taps, not about refusing to do the same
 * thing twice on purpose.
 */

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
