//root of the app that sets up the main navigation structure and provides context providers for theme, authentication, and farm state. It uses Expo Router's Stack navigator to define protected routes based on the user's authentication status. The RootLayout component wraps the RootNavigator with ThemeProvider, AuthProvider, and AgroFlowProvider to make the respective contexts available throughout the application.
import {//creates stack navigation
  Stack,
} from 'expo-router';

import {
  ActivityIndicator,
  Platform,
  StyleSheet,
  View,
} from 'react-native';

import {
  AgroFlowProvider,
} from '@/context/AgroFlowContext';//provides shared information

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
  } = useAuth();

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
      </Stack.Protected>

      <Stack.Protected
        guard={
          isAuthenticated
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

export default function RootLayout() {/*wraps the application with ThemeProvider, AuthProvider, and AgroFlowProvider to provide theme, authentication, and farm state contexts throughout the app. It renders the RootNavigator component, which defines the main navigation structure of the app using Expo Router's Stack navigator.*/
  return (
    <ThemeProvider>
      {/* Authentication provider - checks if user has a saved session*/}
      <AuthProvider>
        {/* Farm data provider */}
        <AgroFlowProvider>
          <View style={Platform.OS === 'web' ? styles.webFrame : styles.nativeFrame}>
            <RootNavigator />
          </View>
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
