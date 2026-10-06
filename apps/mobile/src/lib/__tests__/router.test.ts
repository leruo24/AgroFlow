/// <reference types="jest" />
// TypeScript 6 no longer auto-includes @types packages, and adding jest
// to tsconfig "types" would put describe/it/expect in scope for the whole
// app. This scopes them to the test file that uses them.

/* Item 0b: a double tap must not push a screen twice, or pop two. */

const mockPush = jest.fn();
const mockNavigate = jest.fn();
const mockBack = jest.fn();
const mockReplace = jest.fn();

jest.mock('expo-router', () => ({
  router: {
    push: (...a: unknown[]) => mockPush(...a),
    navigate: (...a: unknown[]) => mockNavigate(...a),
    back: (...a: unknown[]) => mockBack(...a),
    replace: (...a: unknown[]) => mockReplace(...a),
    canGoBack: () => true,
  },
}));

import { router, resetNavigationLock, NAVIGATION_LOCK_MS } from '../router';

describe('guarded router', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-10-06T09:00:00Z'));
    resetNavigationLock();
    mockPush.mockClear();
    mockNavigate.mockClear();
    mockBack.mockClear();
    mockReplace.mockClear();
  });

  afterEach(() => jest.useRealTimers());

  it('a double tap pushes one screen, not two', () => {
    router.push('/reports');
    router.push('/reports');

    expect(mockPush).toHaveBeenCalledTimes(1);
  });

  it('first tap wins when two different buttons are tapped together', () => {
    // The second tap almost always lands on the screen already sliding away.
    router.push('/reports');
    router.push('/request');

    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith('/reports');
  });

  it('a double tap on back pops one screen, not two', () => {
    router.back();
    router.back();

    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it('a deliberate second tap after the transition still works', () => {
    router.push('/reports');
    jest.setSystemTime(Date.now() + NAVIGATION_LOCK_MS + 1);
    router.push('/request');

    expect(mockPush).toHaveBeenCalledTimes(2);
  });

  it('push, navigate and back share one lock', () => {
    router.push('/reports');
    router.navigate('/');
    router.back();

    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(mockBack).not.toHaveBeenCalled();
  });

  it('replace is never held back - it is how sign-in and sign-out redirect', () => {
    router.push('/reports');
    router.replace('/login');

    expect(mockReplace).toHaveBeenCalledTimes(1);
  });

  it('canGoBack is passed straight through', () => {
    expect(router.canGoBack()).toBe(true);
  });
});
