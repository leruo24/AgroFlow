// Root of the app: sets up the stack navigation and the theme, auth and farm-data providers.
// Routes are protected based on whether the user is signed in.
import {//creates stack navigation
  router,
  Stack,
  useSegments,
} from 'expo-router';

import {
  useEffect,
} from 'react';

import {
  ActivityIndicator,
  Platform,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';

import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { loadLanguage } from '@/i18n';
import { onReconnect } from '@/lib/connectivity';
import { flushQueue } from '@/lib/offlineQueue';

import {
  AgroFlowProvider,
} from '@/context/AgroFlowContext';//provides shared information

import {
  LoadingAnimation,
} from '@/components/LoadingAnimation';

import {
  setLoadingAnimationFinished,
} from '@/components/DripHelper';

// Keep the native splash up until the loading animation is ready to take over. Called at
// module scope because the splash hides itself as soon as the first frame is drawn.
// A failure here (already hidden, or no splash on this platform) must not stop the app.
void SplashScreen.preventAutoHideAsync().catch(() => undefined);

import {
  AuthProvider,//stores and provides authentication
  useAuth,//allows component to read authentication information
} from '@/context/AuthContext';

import {
  ThemeProvider,
  useTheme,//allow components to access current theme
} from '@/context/ThemeContext';

function RootNavigator() {//decides which screens the user is permitted to access
  const {//reading authentication states
    isAuthenticated,
    isLoading,
    mustChangePassword,
  } = useAuth();

  // Security: a farmer still on their onboarding password goes straight to the password
  // screen. That password was read off an admin's screen or sent over Telegram, so it must
  // not keep guarding the account. The guard on the tab routes below enforces this; this
  // effect only does the navigation.
  // Already in the wizard (any step, e.g. a link to /setup?step=password): stay there.
  // (A string compare: Expo's generated route types only learn of /setup when the dev server runs.)
  const inSetup = (useSegments()[0] as string | undefined) === 'setup';

  useEffect(
    () => {
      if (
        !isLoading &&
        isAuthenticated &&
        mustChangePassword &&
        !inSetup
      ) {
        // The forced change is step 2 of the setup wizard (app/setup.tsx), which cannot be
        // stepped past until the farmer has set their own password.
        router.replace(
          '/setup' as never
        );
      }
    },
    [
      isLoading,
      isAuthenticated,
      mustChangePassword,
      inSetup,
    ]
  );

  const {//use current theme colors
    colors,
  } = useTheme();

  if (
    isLoading
  ) {
    return (
      <View
        style={[
          styles.loadingContainer,
          {
            backgroundColor:
              colors.background,
          },
        ]}
      >
        <ActivityIndicator
          size="large"
          color={
            colors.primaryDark
          }
        />
      </View>
    );
  }

  return (
    <Stack
      screenOptions={{
        headerShown:
          false,
        contentStyle: {
          backgroundColor:
            colors.background,
        },
      }}
    >
{/* Keeps signed-in users away from the login screens */}
      <Stack.Protected
        guard={
          !isAuthenticated
        }
      >
        <Stack.Screen
          name="login"
        />

        <Stack.Screen
          name="forgot-password"
        />

        {/* "Ask for a call", for people not on AgroFlow yet. */}
        <Stack.Screen
          name="enquiry"
        />
      </Stack.Protected>

      <Stack.Protected
        guard={
          isAuthenticated &&
          !mustChangePassword
        }
      >
        <Stack.Screen
          name="(tabs)"
        />

        <Stack.Screen
          name="zone/[id]"
        />

        <Stack.Screen
          name="tank"
        />
      </Stack.Protected>

      {/* The setup wizard. Open to any signed-in farmer, including one who must still change
          the temporary password: that is the wizard's second step. */}
      <Stack.Protected
        guard={
          isAuthenticated
        }
      >
        <Stack.Screen
          name="setup"
        />
      </Stack.Protected>

{/* The recovery route stays registered while Supabase changes the temporary auth state. It comes after the protected routes so it is never the default screen. */}
      <Stack.Screen
        name="update-password"
      />

      {/* One-tap sign-in from the Telegram welcome (/signin?token=...). Outside the guards like
          update-password: it is signed out when it opens and signed in a moment later. */}
      <Stack.Screen
        name="signin"
      />
    </Stack>
  );
}

// Inside AuthProvider so it can read isLoading ("the app has finished starting" means the
// Supabase session has been restored). A separate component because hooks cannot be used
// above the provider that supplies them.
function RootShell() {
  const { isLoading } = useAuth();
  const { colors, isDark } = useTheme();
  const { width } = useWindowDimensions();

  // The area behind the status bar matches the screen. On web, index.html paints the body in
  // the loading video's colour for the first frame; once the app is up, the body and the
  // browser's theme colour (Android Chrome's bar, an installed iPhone app's status bar) take
  // the screen background, so no grey band shows above the page.
  useEffect(() => {
    if (Platform.OS !== 'web' || isLoading || typeof document === 'undefined') return;
    document.body.style.backgroundColor = colors.background;
    let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]:not([media])');
    if (!meta) {
      meta = document.createElement('meta');
      meta.name = 'theme-color';
      document.head.appendChild(meta);
    }
    meta.content = colors.background;
  }, [isLoading, colors.background]);

  return (
    <>
      {/* On a computer the app stays phone width in the middle of the window, on a neutral
          background, instead of stretching edge to edge. Phones are narrower than the column,
          so they see no difference; Android uses the plain frame. */}
      {/* Dark icons on the light theme, light on the dark. The app is edge to edge, so the
          screen's own background shows behind the bar (no grey haze on Android). */}
      <StatusBar style={isDark ? 'light' : 'dark'} />
      {Platform.OS === 'web' ? (
        <View style={[styles.webOuter, { backgroundColor: colors.surfaceSecondary }]}>
          <View style={[styles.webFrame, { backgroundColor: colors.background }, width > 480 && { borderColor: colors.border, borderLeftWidth: StyleSheet.hairlineWidth, borderRightWidth: StyleSheet.hairlineWidth }]}>
            <RootNavigator />
          </View>
        </View>
      ) : (
        <View style={styles.nativeFrame}>
          <RootNavigator />
        </View>
      )}

      {/* Above everything, including the login screen, and deliberately
          independent of the "Raindrop helper" and "Show page help" settings -
          this is the app starting, not a helper the farmer can switch off.

          Drip is told when it finishes so its greeting never lands on top of
          the animation. */}
      <LoadingAnimation
        appReady={!isLoading}
        onFinished={setLoadingAnimationFinished}
      />
    </>
  );
}

// Once per app start: the saved language, and when the connection comes back, send the
// refills, pH readings and soil checks saved on the phone (lib/offlineQueue.ts).
void loadLanguage();
onReconnect(() => { void flushQueue(); });

export default function RootLayout() {/*wraps the application with ThemeProvider, AuthProvider, and AgroFlowProvider to provide theme, authentication, and farm state contexts throughout the app. It renders the RootNavigator component, which defines the main navigation structure of the app using Expo Router's Stack navigator.*/
  return (
    <ThemeProvider>
      {/* Auth provider: checks for a saved session */}
      <AuthProvider>
        {/* Farm data provider */}
        <AgroFlowProvider>
          <RootShell />
          {/* Reads the auth state */}
        </AgroFlowProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}

const styles =
  StyleSheet.create({
    loadingContainer: {
      flex:
        1,  
      alignItems:
        'center',  
      justifyContent:
        'center',
    },
    nativeFrame: { flex: 1 },
    webOuter: { flex: 1 },
    webFrame: {
      flex: 1,
      width: '100%',
      maxWidth: 480,
      alignSelf: 'center',
    },
  });
