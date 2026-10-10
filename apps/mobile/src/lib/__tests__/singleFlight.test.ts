/// <reference types="jest" />
// TypeScript 6 does not auto-include @types packages, and adding jest to tsconfig "types"
// would put describe/it/expect in scope for the whole app, so the reference is per test file.

/* One request per intention, however fast the taps. */

import { singleFlight, writeKey, pendingWrites } from '../singleFlight';

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('singleFlight', () => {
  it('an identical write already in flight is shared, not repeated', async () => {
    const d = deferred<string>();
    const run = jest.fn(() => d.promise);

    const a = singleFlight('POST /x {"a":1}', run);
    const b = singleFlight('POST /x {"a":1}', run);

    expect(run).toHaveBeenCalledTimes(1);

    d.resolve('done');
    await expect(a).resolves.toBe('done');
    await expect(b).resolves.toBe('done');
  });

  it('different writes both go', async () => {
    const run = jest.fn(() => Promise.resolve());

    await Promise.all([
      singleFlight(writeKey('POST', '/x', '{"a":1}'), run),
      singleFlight(writeKey('POST', '/x', '{"a":2}'), run),
    ]);

    expect(run).toHaveBeenCalledTimes(2);
  });

  it('the same write repeated AFTER the first finished goes through again', async () => {
    // This is about two taps, not about refusing to do the same thing twice on purpose.
    const run = jest.fn(() => Promise.resolve('ok'));

    await singleFlight('POST /y', run);
    await singleFlight('POST /y', run);

    expect(run).toHaveBeenCalledTimes(2);
  });

  it('a failed write is forgotten, so a retry is a real retry', async () => {
    const run = jest
      .fn<Promise<string>, []>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce('ok');

    const before = pendingWrites();
    await expect(singleFlight('POST /z', run)).rejects.toThrow('offline');
    // Nothing left behind for this key.
    expect(pendingWrites()).toBe(before);
    await expect(singleFlight('POST /z', run)).resolves.toBe('ok');
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('writeKey tells methods, paths and bodies apart', () => {
    expect(writeKey('post', '/a', 'b')).toBe(writeKey('POST', '/a', 'b'));
    expect(writeKey('POST', '/a', 'b')).not.toBe(writeKey('PUT', '/a', 'b'));
    expect(writeKey('POST', '/a', 'b')).not.toBe(writeKey('POST', '/a', 'c'));
  });
});
