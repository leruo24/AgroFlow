// The AgroFlow loading animation, played over everything while the app
// starts.
//
// HOW IT FITS WITH THE NATIVE SPLASH
// ----------------------------------
// There are two things on screen before the app is: the NATIVE splash
// (expo-splash-screen, drawn by the OS before any JavaScript runs) and this
// overlay. They hand over to each other:
//
//   1. _layout keeps the native splash up with preventAutoHideAsync().
//   2. This component mounts, creates the player and waits for it to be
//      ready to play.
//   3. Only then does the native splash hide - so there is never a frame of
//      bare app between the two.
//   4. This plays, the app finishes starting, and this fades out.
//
// Getting (3) wrong is the difference between a seamless handover and a
// visible flash of a half-built screen.
//
// THE BACKGROUND IS WHITE, NOT THE SPLASH'S GREEN. The video was authored on
// a transparent background and exported to MP4, which cannot carry an alpha
// channel, so its background is flattened to solid #FFFFFF. Matching it is
// what stops a white rectangle appearing inside a green screen. The native
// splash is still #184D35, so there IS one colour change at the handover -
// see the report; making them match means changing the splash colour in
// app.json, which is a branding decision.
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

// The video's own background, measured from the file. See the note above.
export const LOADING_BACKGROUND = '#FFFFFF';

// HARD CEILING. Whatever happens - a video that never reports finishing, a
// session check that hangs, a player that fails silently - the overlay is
// gone by now and the farmer is in the app.
//
// NOTE: the supplied video is 9.0 s long, so this 8 s cap fires BEFORE it
// ends and the last ~1 s is cut. That is the brief's number, kept
// deliberately as the safety limit. Change this one constant (and the
// matching MAX_MS in apps/web/admin/index.html) to 10000 to let it play out.
const MAX_VISIBLE_MS = 8000;

const FADE_MS = 300;

// Long enough to recognise the logo, short enough not to be a delay in its
// own right. Only used when the animation is skipped for reduced motion.
const REDUCED_MOTION_HOLD_MS = 600;

type Props = {
  // True once the app has finished starting: fonts loaded and the Supabase
  // session restored, i.e. AuthContext knows whether to show login or the
  // app. The overlay waits for this AND the video.
  appReady: boolean;
  // Fired once the overlay is really gone. Drip uses it to hold its greeting
  // until the animation has finished.
  onFinished?: () => void;
};

export function LoadingAnimation({ appReady, onFinished }: Props) {
  const [visible, setVisible] = useState(true);
  const [reduceMotion, setReduceMotion] = useState<boolean | null>(null);
  const [videoDone, setVideoDone] = useState(false);

  const opacity = useRef(new Animated.Value(1)).current;
  const dismissed = useRef(false);
  const splashHidden = useRef(false);

  // Asked once. A phone that cannot answer (the API is unavailable on web)
  // is treated as "motion is fine", which is the common case.
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
    // Not created at all under reduced motion - nothing is decoded and
    // nothing animates. null until the preference is known, so the first
    // frames cannot play before we know whether they should.
    reduceMotion === false ? require('../../assets/media/agroflow-loading.mp4') : null,
    (p) => {
      p.loop = false;
      p.muted = true;
    }
  );

  // The native splash comes down only once there is something to replace it
  // with, so the handover has no gap.
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

    if (!player) {
      // No player means nothing to wait for.
      hideNativeSplash();
      setVideoDone(true);
      return;
    }

    // `statusChange` covers the failure case too: a video that cannot load
    // reports an error rather than ever ending, and must not hold the app.
    const statusSub = player.addListener('statusChange', ({ status, error }) => {
      if (status === 'readyToPlay') {
        hideNativeSplash();
        // play() is explicit rather than autoplay so it cannot start before
        // the native splash is out of the way.
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

    // Belt and braces: if the player never reports ready at all - a corrupt
    // asset, a decoder that fails silently - this still gets the native
    // splash out of the way so the app is reachable.
    const failsafe = setTimeout(hideNativeSplash, 1500);

    return () => {
      statusSub.remove();
      endSub.remove();
      clearTimeout(failsafe);
    };
  }, [player, reduceMotion, hideNativeSplash]);

  const dismiss = useCallback(() => {
    if (dismissed.current) return;
    dismissed.current = true;

    Animated.timing(opacity, {
      toValue: 0,
      duration: FADE_MS,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start(() => {
      // Unmounted, not just transparent: a full-screen transparent layer
      // would swallow every tap underneath it.
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
        // Web only: `fixed` keeps the overlay over the viewport rather than
        // the document, so it cannot be scrolled away mid-animation. Not in
        // React Native's ViewStyle union, which is why it is cast here rather
        // than declared in the StyleSheet.
        Platform.OS === 'web' ? ({ position: 'fixed' } as object) : null,
      ]}
      pointerEvents="auto"
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
        {reduceMotion === false && player ? (
          <VideoView
            style={StyleSheet.absoluteFill}
            player={player}
            // contain: the video is 1080x1920 portrait with the logo in the
            // middle. cover would crop the logo on a short screen.
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
              // The poster is the fallback; a fade on the fallback is one
              // animation too many for someone who asked for less motion.
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
    // Above every screen, including login. On web this also has to beat
    // anything the router renders.
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
