// The AgroFlow loading animation, shown over everything while the app starts.
// It hands over from the native splash (expo-splash-screen, drawn before any JavaScript):
//   1. _layout keeps the native splash up with preventAutoHideAsync().
//   2. This component mounts, creates the player and waits until it is ready.
//   3. Only then does the native splash hide, so there is never a frame of bare app.
//   4. This plays, the app finishes starting, and this fades out.
// The background is white: the MP4 cannot carry transparency, so the video's background
// is solid #FFFFFF, and the native splash in app.json is #FFFFFF too. If the splash colour
// changes, change this with it.
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import * as SplashScreen from 'expo-splash-screen';
import { useVideoPlayer, VideoView } from 'expo-video';
import { WebLoadingVideo } from '@/components/WebLoadingVideo';

// The video's own background colour (see the note above).
export const LOADING_BACKGROUND = '#FFFFFF';

// Safety cap: whatever happens (the video never finishes, the session check hangs, the
// player fails silently), the overlay is gone by now and the farmer is in the app.
// The video is 9.0 s, so 10 s leaves a second of headroom; normally `playToEnd` has
// already fired and this timer never runs.
// Keep in step with MAX_MS in apps/web/admin/index.html.
const MAX_VISIBLE_MS = 10000;

const FADE_MS = 300;

// Long enough to recognise the logo. Only used when the animation is skipped for
// reduced motion.
const REDUCED_MOTION_HOLD_MS = 600;

type Props = {
  // True once the app has finished starting (fonts loaded and the Supabase session
  // restored). The overlay waits for this and for the video.
  appReady: boolean;
  // Fired once the overlay is really gone; Drip uses it to time its greeting.
  onFinished?: () => void;
};

export function LoadingAnimation({ appReady, onFinished }: Props) {
  const [visible, setVisible] = useState(true);
  const [reduceMotion, setReduceMotion] = useState<boolean | null>(null);
  const [videoDone, setVideoDone] = useState(false);

  const opacity = useRef(new Animated.Value(1)).current;
  const dismissed = useRef(false);
  const splashHidden = useRef(false);

  // Asked once. If the phone cannot answer (unavailable on web) we assume motion is fine.
  useEffect(() => {
    let active = true;

    AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        if (active) setReduceMotion(enabled);
      })
      .catch(() => {
        if (active) setReduceMotion(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const player = useVideoPlayer(
    // Not created at all under reduced motion. null until the preference is known, so nothing
    // plays before we know whether it should. Not used on web, which plays the video through
    // WebLoadingVideo instead (see that file for why).
    reduceMotion === false && Platform.OS !== 'web' ? require('../../assets/media/agroflow-loading.mp4') : null,
    (p) => {
      p.loop = false;
      p.muted = true;
    }
  );

  // The native splash only comes down once there is something to replace it.
  const hideNativeSplash = useCallback(() => {
    if (splashHidden.current) return;
    splashHidden.current = true;
    // Already-hidden and unsupported-platform both reject; neither matters.
    void SplashScreen.hideAsync().catch(() => undefined);
  }, []);

  useEffect(() => {
    if (reduceMotion === null) return;

    if (reduceMotion) {
      // Static splash: the still frame, briefly, instead of the animation.
      hideNativeSplash();
      const timer = setTimeout(() => setVideoDone(true), REDUCED_MOTION_HOLD_MS);
      return () => clearTimeout(timer);
    }

    if (Platform.OS === 'web') {
      // WebLoadingVideo says when the video has ended or will not play.
      hideNativeSplash();
      return;
    }

    if (!player) {
      // No player means nothing to wait for.
      hideNativeSplash();
      setVideoDone(true);
      return;
    }

    // `statusChange` also covers failure: a video that cannot load reports an error instead
    // of ending, and must not hold up the app.
    const statusSub = player.addListener('statusChange', ({ status, error }) => {
      if (status === 'readyToPlay') {
        hideNativeSplash();
        // play() is called explicitly (no autoplay) so it cannot start before the native splash
        // is out of the way.
        try {
          player.play();
        } catch {
          setVideoDone(true);
        }
      }

      if (status === 'error' || error) {
        hideNativeSplash();
        setVideoDone(true);
      }
    });

    const endSub = player.addListener('playToEnd', () => setVideoDone(true));

    // Safety net: if the player never reports ready (corrupt file, silent decoder failure),
    // the native splash still comes down so the app can be used.
    const failsafe = setTimeout(hideNativeSplash, 1500);

    return () => {
      statusSub.remove();
      endSub.remove();
      clearTimeout(failsafe);
    };
  }, [player, reduceMotion, hideNativeSplash]);

  const markVideoDone = useCallback(() => setVideoDone(true), []);

  const dismiss = useCallback(() => {
    if (dismissed.current) return;
    dismissed.current = true;

    Animated.timing(opacity, {
      toValue: 0,
      duration: FADE_MS,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start(() => {
      // Unmounted, not just transparent: a full-screen transparent layer would block every tap.
      setVisible(false);
      onFinished?.();
    });
  }, [opacity, onFinished]);

  // The normal path: both conditions met.
  useEffect(() => {
    if (appReady && videoDone) dismiss();
  }, [appReady, videoDone, dismiss]);

  // The ceiling. Runs from mount, independent of everything above.
  useEffect(() => {
    const timer = setTimeout(() => {
      hideNativeSplash();
      dismiss();
    }, MAX_VISIBLE_MS);

    return () => clearTimeout(timer);
  }, [dismiss, hideNativeSplash]);

  if (!visible) return null;

  return (
    <Animated.View
      style={[
        styles.overlay,
        { opacity },
        // Web only: `fixed` keeps the overlay over the viewport so it cannot scroll away. It is not
        // in React Native's ViewStyle type, which is why it is cast here.
        Platform.OS === 'web' ? ({ position: 'fixed' } as object) : null,
        { pointerEvents: 'auto' },
      ]}
      accessibilityRole="progressbar"
      accessibilityLabel="AgroFlow is starting"
    >
      {/* Tap to skip, but only once there is something to skip to - skipping
          into a half-loaded app shows a flash of empty screen. */}
      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={() => {
          if (appReady) dismiss();
        }}
        accessibilityLabel="Skip the opening animation"
      >
        {Platform.OS === 'web' ? (
          <WebLoadingVideo
            mode={reduceMotion === null ? 'pending' : reduceMotion ? 'still' : 'video'}
            onDone={markVideoDone}
          />
        ) : reduceMotion === false && player ? (
          <VideoView
            style={StyleSheet.absoluteFill}
            player={player}
            // contain: the video is 1080x1920 portrait with the logo in the middle; cover would crop
            // the logo on a short screen.
            contentFit="contain"
            nativeControls={false}
            allowsPictureInPicture={false}
          />
        ) : (
          // Reduced motion, or no player: the still frame.
          <View style={styles.posterWrap}>
            <Image
              source={require('../../assets/media/agroflow-loading-poster.jpg')}
              style={StyleSheet.absoluteFill}
              contentFit="contain"
              // No fade on the still frame for someone who asked for less motion.
              transition={0}
              accessibilityLabel="AgroFlow"
            />
          </View>
        )}
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: LOADING_BACKGROUND,
    // Above every screen, including login, and above anything the router renders on web.
    zIndex: 9999,
  },
  posterWrap: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: LOADING_BACKGROUND,
  },
});
