import { router as baseRouter } from 'expo-router';

/* expo-router's `router`, with double taps taken out (item 0b).
 *
 * WHY
 * `router.push` pushes a NEW screen every time it is called. A quick double
 * tap on "Reports" put two Reports screens on the stack, and a double tap on a
 * back arrow popped two screens instead of one - landing the farmer somewhere
 * they never asked to go. The screen transition itself takes ~300 ms, which is
 * exactly long enough for a second tap to land on a button that is still
 * visible.
 *
 * WHAT IT DOES
 * The first push, navigate or back starts a short lock; anything else in the
 * same window is dropped. First tap wins, not last: on a phone the second tap
 * almost always lands on the screen that is already sliding away.
 *
 * WHAT IT DELIBERATELY LEAVES ALONE
 * `replace` is how the app redirects after sign-in and sign-out (_layout.tsx,
 * update-password.tsx). Those come from auth state, not from a finger, and a
 * redirect dropped because a tap happened a moment earlier would strand the
 * farmer on the wrong screen. `canGoBack`, `setParams` and the rest are not
 * navigations at all.
 *
 * It is a drop-in: every screen imports `router` from here instead of from
 * 'expo-router', and no call site changed.
 */

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
