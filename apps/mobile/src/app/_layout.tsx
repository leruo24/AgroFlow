//root of the app that sets up the main navigation structure and provides context providers for theme, authentication, and farm state. It uses Expo Router's Stack navigator to define protected routes based on the user's authentication status. The RootLayout component wraps the RootNavigator with ThemeProvider, AuthProvider, and AgroFlowProvider to make the respective contexts available throughout the application.
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

// Hold the native splash until the loading animation is ready to take over.
// Called at module scope, before any component renders, because the splash
// auto-hides as soon as the first frame is drawn otherwise - and then there
// IS no splash left to hand over from.
//
// It never rejects in a way that matters (already-hidden, or a platform
// without a splash), and a failure here must not stop the app booting.
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

  //A farmer still on their onboarding password goes straight to the
  //password screen and nowhere else. That password was read off an admin's
  //screen or sent over Telegram, where it stays in the chat history, so it
  //must not remain the thing guarding the account.
  //
  //The guard on the tab routes below is what actually enforces this - this
  //effect only performs the navigation. Both are needed: the guard stops the
  //farmer navigating back into the app, the redirect gets them somewhere
  //useful rather than a blank stack.
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
{/* Protects login screens from authenticated users */}
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

        {/* Item 6c: "Ask for a call" - for people not on AgroFlow yet. */}
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

{/* The recovery route remains registered while Supabase changes the temporary authentication state. It is placed after the normal protected routes so it does not become the default screen. */}
      <Stack.Screen
        name="update-password"
      />
    </Stack>
  );
}

// Sits INSIDE AuthProvider so it can read isLoading - "the app has finished
// starting" means the Supabase session has been restored and the app knows
// whether to show login or the tabs. A separate component because hooks
// cannot be called above the provider that supplies them.
function RootShell() {
  const { isLoading } = useAuth();

  return (
    <>
      <View style={Platform.OS === 'web' ? styles.webFrame : styles.nativeFrame}>
        <RootNavigator />
      </View>

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
      {/* Authentication provider - checks if user has a saved session*/}
      <AuthProvider>
        {/* Farm data provider */}
        <AgroFlowProvider>
          <RootShell />
          {/*reads authentication state */}
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
    webFrame: {
      flex: 1,
      width: '100%',
      maxWidth: 480,
      alignSelf: 'center',
    },
  });
