// Root of the app: sets up the stack navigation and the theme, auth and farm-data providers.
// Routes are protected based on whether the user is signed in.
import {//creates stack navigation
  router,
  Stack,
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
  useEffect(
    () => {
      if (
        !isLoading &&
        isAuthenticated &&
        mustChangePassword
      ) {
        router.replace(
          '/update-password?source=first-login'
        );
      }
    },
    [
      isLoading,
      isAuthenticated,
      mustChangePassword,
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
      </Stack.Protected>

{/* The recovery route stays registered while Supabase changes the temporary auth state. It comes after the protected routes so it is never the default screen. */}
      <Stack.Screen
        name="update-password"
      />
    </Stack>
  );
}

// Inside AuthProvider so it can read isLoading ("the app has finished starting" means the
// Supabase session has been restored). A separate component because hooks cannot be used
// above the provider that supplies them.
function RootShell() {
  const { isLoading } = useAuth();
  const { colors } = useTheme();
  const { width } = useWindowDimensions();

  return (
    <>
      {/* On a computer the app stays phone width in the middle of the window, on a neutral
          background, instead of stretching edge to edge. Phones are narrower than the column,
          so they see no difference; Android uses the plain frame. */}
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
