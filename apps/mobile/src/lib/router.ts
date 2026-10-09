import { router as baseRouter } from 'expo-router';

/* expo-router's `router` with double taps filtered out.
 * `router.push` adds a new screen every call, so a quick double tap put two screens on the
 * stack, and a double tap on back went back two screens. A transition takes ~300 ms, long
 * enough for a second tap to land on a button still on screen.
 * The first push, navigate or back starts a short lock and anything else in that window is
 * dropped. First tap wins, because the second usually lands on the screen sliding away.
 * `replace` is not locked: the app uses it to redirect after sign-in and sign-out
 * (_layout.tsx, update-password.tsx), which come from auth state, not a finger, and must
 * never be dropped. `canGoBack`, `setParams` and the rest are not navigations.
 * Every screen imports `router` from here instead of 'expo-router'. */

/** Longer than a screen transition, shorter than a deliberate second tap. */
export const NAVIGATION_LOCK_MS = 600;

let lockedUntil = 0;

/** Exposed for tests. Returns true if a navigation may happen now. */
export function claimNavigation(now: number = Date.now()): boolean {
  if (now < lockedUntil) return false;
  lockedUntil = now + NAVIGATION_LOCK_MS;
  return true;
}

/** Tests only: forget the lock between cases. */
export function resetNavigationLock(): void {
  lockedUntil = 0;
}

type BaseRouter = typeof baseRouter;

export const router: BaseRouter = {
  ...baseRouter,

  push: ((...args: Parameters<BaseRouter['push']>) => {
    if (claimNavigation()) baseRouter.push(...args);
  }) as BaseRouter['push'],

  navigate: ((...args: Parameters<BaseRouter['navigate']>) => {
    if (claimNavigation()) baseRouter.navigate(...args);
  }) as BaseRouter['navigate'],

  back: (() => {
    if (claimNavigation()) baseRouter.back();
  }) as BaseRouter['back'],
};
