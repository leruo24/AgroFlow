import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Pressable,
  Text,
  View,
} from 'react-native';
import { X } from 'lucide-react-native';
import { router } from '@/lib/router';

import Drip, { MASCOT_NAME, type DripMood } from '@/components/mascot/Drip';
import { useTheme } from '@/context/ThemeContext';
import { createDripHelperStyles } from '@/styles/dripHelperStyles';
import { useAppPreferences } from '@/hooks/useAppPreferences';
import {
  fetchTodayZoneInsights,
  type ZoneInsightRow,
} from '@/services/insightsService';

type HelperZone = { id: string; name: string };

type Props = {
  zones: HelperZone[];
  unreadAlertCount: number;
  // Home passes true once its own data has loaded. The helper waits for it, so
  // the drop never greets the farmer over a half-drawn screen.
  ready: boolean;
};

// How long the greeting wave is held before the mood switches to match the
// message, and how long the whole thing stays up.
const WAVE_MS = 2000;
const AUTO_HIDE_MS = 8000;

// Shown once per app open or login. Module-level rather than component state
// because Home remounts on tab changes and the farmer should not be greeted
// again each time they come back to it.
let shownThisSession = false;

/** Called on sign-out so the next farmer to log in gets their own greeting. */
export function resetDripHelperSession(): void {
  shownThisSession = false;
}

// Whether the opening loading animation has finished.
//
// Drip waits for it. Without this, the greeting fires while the full-screen
// animation is still up, its one-per-session flag is spent on a bubble nobody
// saw, and the farmer never gets greeted at all.
//
// Module-level and NOT reset on sign-out: the animation plays once per app
// launch, not once per login, so a farmer who signs out and back in should not
// have Drip wait for an animation that is not going to play again.
let loadingAnimationFinished = false;

// Lets a listener wake up when the flag flips. A plain module variable cannot
// trigger a re-render on its own, and Drip may well have mounted and bailed
// out before the animation ended.
const loadingAnimationListeners = new Set<() => void>();

/** Called by LoadingAnimation once the overlay is really gone. */
export function setLoadingAnimationFinished(): void {
  if (loadingAnimationFinished) return;
  loadingAnimationFinished = true;
  for (const listener of loadingAnimationListeners) listener();
}

export function isLoadingAnimationFinished(): boolean {
  return loadingAnimationFinished;
}

type Decision = {
  message: string;
  mood: DripMood;
  // Where tapping the bubble goes. null means there is nothing to open.
  target: { kind: 'alerts' } | { kind: 'zone'; zoneId: string } | null;
};

// The priority order from the spec. The first rule that matches wins, so the
// farmer is shown the single most important thing rather than a digest.
//
// Note setup_missing is itself an act_now insight, so it is excluded from rule 1
// and handled by rule 4 - that is what gives it its own, gentler wording
// instead of the raw "add the area and the flow rate" list.
export function decideMessage(
  insights: ZoneInsightRow[],
  unreadAlertCount: number,
  zones: HelperZone[]
): Decision {
  const nameFor = (zoneId: string) =>
    zones.find((z) => z.id === zoneId)?.name ?? 'your zone';

  // 1. Anything that needs doing today, other than finishing setup.
  const actNow = insights.find(
    (i) => i.severity === 'act_now' && i.insightType !== 'setup_missing'
  );
  if (actNow) {
    return {
      message: actNow.message,
      mood:
        actNow.insightType === 'water_now' || actNow.insightType === 'skip_rain'
          ? 'thirsty'
          : 'alert',
      target: { kind: 'zone', zoneId: actNow.zoneId },
    };
  }

  // 2. Unread alerts.
  if (unreadAlertCount > 0) {
    return {
      message: `You have ${unreadAlertCount} new alert${
        unreadAlertCount === 1 ? '' : 's'
      }. Tap to check.`,
      mood: 'alert',
      target: { kind: 'alerts' },
    };
  }

  // 3. Water needed soon.
  const waterSoon = insights.find((i) => i.insightType === 'water_soon');
  if (waterSoon) {
    return {
      message: waterSoon.message,
      mood: 'thirsty',
      target: { kind: 'zone', zoneId: waterSoon.zoneId },
    };
  }

  // 4. Setup still unfinished. Item 2: advice comes either way, so this is
  // the server's ONE next step ("Add the planting date for ..."), not a
  // claim that advice is waiting on it.
  const setupMissing = insights.find((i) => i.insightType === 'setup_missing');
  if (setupMissing) {
    return {
      message: `${nameFor(setupMissing.zoneId)}: ${setupMissing.message}`,
      mood: 'alert',
      target: { kind: 'zone', zoneId: setupMissing.zoneId },
    };
  }

  // 5. Nothing to report.
  return {
    message: 'All your zones look good today.',
    mood: 'happy',
    target: null,
  };
}

// Drip: a small raindrop in the bottom-right corner that greets the farmer once
// per app open and points at the one thing that needs them most.
//
// It is decoration over real data. Every data path falls back rather than
// failing: no insights means alerts only, no alerts means "all good".
export function DripHelper({ zones, unreadAlertCount, ready }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => createDripHelperStyles(colors), [colors]);
  const { preferences, ready: preferencesReady } = useAppPreferences();

  const [visible, setVisible] = useState(false);
  const [mood, setMood] = useState<DripMood>('wave');
  const [decision, setDecision] = useState<Decision | null>(null);

  const opacity = useRef(new Animated.Value(0)).current;
  const shake = useRef(new Animated.Value(0)).current;

  // Cancels the mood-switch and auto-hide timers. Declared before the effect
  // that fills it so the ordering is obvious rather than relying on the async
  // body running after render.
  const cleanupTimers = useRef<(() => void) | null>(null);

  // Stable primitive so the effect does not re-run when Home rebuilds an
  // equivalent zones array on every render.
  const zoneKey = zones.map((z) => z.id).join(',');

  // Re-runs the effect below when the opening animation finishes. Drip
  // usually mounts while it is still playing, so without this the greeting
  // would be decided against a flag that was false and never reconsidered.
  const [animationDone, setAnimationDone] = useState(isLoadingAnimationFinished());

  useEffect(() => {
    if (animationDone) return;

    const listener = () => setAnimationDone(true);
    loadingAnimationListeners.add(listener);

    return () => {
      loadingAnimationListeners.delete(listener);
    };
  }, [animationDone]);

  useEffect(() => {
    if (!ready || !preferencesReady) return;
    // Wait for the opening animation. Greeting the farmer underneath it would
    // spend the one-per-session flag on a bubble nobody saw.
    if (!animationDone) return;
    if (!preferences.showRaindropHelper) return;
    if (shownThisSession) return;

    shownThisSession = true;
    let active = true;

    (async () => {
      // Insight reads never throw - fetchTodayZoneInsights swallows its own
      // failures and returns [] - so alerts alone still produce a message.
      const insights = await fetchTodayZoneInsights(zones.map((z) => z.id));
      if (!active) return;

      const next = decideMessage(insights, unreadAlertCount, zones);
      setDecision(next);
      setMood('wave');
      setVisible(true);

      let reduceMotion = false;
      try {
        reduceMotion = await AccessibilityInfo.isReduceMotionEnabled();
      } catch {
        // If the platform cannot tell us, assume the farmer wants less motion.
        reduceMotion = true;
      }
      if (!active) return;

      if (reduceMotion) {
        // No shake at all: fade in only.
        Animated.timing(opacity, {
          toValue: 1,
          duration: 260,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }).start();
      } else {
        Animated.timing(opacity, {
          toValue: 1,
          duration: 200,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }).start();

        // Three small wiggles over about a second, then idle. Deliberately
        // gentle - this is a greeting, not an alarm.
        Animated.sequence([
          wiggle(shake, 1),
          wiggle(shake, -1),
          wiggle(shake, 1),
          Animated.timing(shake, {
            toValue: 0,
            duration: 160,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }),
        ]).start();
      }

      // Hold the wave, then show the mood that matches the message.
      const moodTimer = setTimeout(() => {
        if (active) setMood(next.mood);
      }, WAVE_MS);

      const hideTimer = setTimeout(() => {
        if (!active) return;
        Animated.timing(opacity, {
          toValue: 0,
          duration: 240,
          easing: Easing.in(Easing.quad),
          useNativeDriver: true,
        }).start(() => {
          if (active) setVisible(false);
        });
      }, AUTO_HIDE_MS);

      cleanupTimers.current = () => {
        clearTimeout(moodTimer);
        clearTimeout(hideTimer);
      };
    })();

    return () => {
      active = false;
      cleanupTimers.current?.();
    };
    // zoneKey rather than zones: see the note above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, preferencesReady, animationDone, preferences.showRaindropHelper, zoneKey, unreadAlertCount]);

  const hide = useCallback(() => {
    cleanupTimers.current?.();
    setVisible(false);
  }, []);

  const open = useCallback(() => {
    const target = decision?.target;
    hide();
    if (!target) return;

    if (target.kind === 'alerts') {
      router.push('/alerts');
      return;
    }

    router.push({
      pathname: '/zone/[id]',
      params: { id: target.zoneId },
    });
  }, [decision, hide]);

  // The toggle being switched off mid-session hides it immediately.
  if (!visible || !decision || !preferences.showRaindropHelper) return null;

  const label = `${MASCOT_NAME} says: ${decision.message}`;

  return (
    <View style={styles.container} pointerEvents="box-none">
      <Animated.View
        style={{
          opacity,
          transform: [
            {
              translateX: shake.interpolate({
                inputRange: [-1, 1],
                outputRange: [-5, 5],
              }),
            },
          ],
        }}
      >
        <View style={styles.bubbleRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={label}
            accessibilityHint={
              decision.target
                ? 'Opens the screen this is about'
                : undefined
            }
            onPress={open}
            style={styles.bubble}
          >
            <Text style={styles.bubbleText}>{decision.message}</Text>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Hide ${MASCOT_NAME}`}
            onPress={hide}
            hitSlop={8}
            style={styles.close}
          >
            <X size={15} color={colors.textSecondary} strokeWidth={2} />
          </Pressable>
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={label}
          onPress={open}
          style={styles.drop}
        >
          <Drip mood={mood} size={56} />
        </Pressable>
      </Animated.View>
    </View>
  );
}

// One wiggle: out and back. Kept tiny (the interpolation above maps 1 to 5 px)
// so it reads as a friendly nudge rather than a shudder.
function wiggle(value: Animated.Value, direction: 1 | -1) {
  return Animated.sequence([
    Animated.timing(value, {
      toValue: direction,
      duration: 90,
      easing: Easing.inOut(Easing.quad),
      useNativeDriver: true,
    }),
    Animated.timing(value, {
      toValue: 0,
      duration: 90,
      easing: Easing.inOut(Easing.quad),
      useNativeDriver: true,
    }),
  ]);
}
