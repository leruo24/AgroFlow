//centralises current user authentication state and provides functions to manage that state. It uses React's context API to make the authentication data and functions available throughout the application. The context includes information about the authenticated user, access token, and authentication status, as well as functions to sign in, sign out, and update the user's profile. The authentication state is persisted using AsyncStorage or SecureStore, depending on the platform, allowing the app to retain user session data across sessions.
//storage is mobile dependant. On mobile platforms (iOS and Android), it uses SecureStore to securely store sensitive information like access tokens and user data. On web platforms, it falls back to using AsyncStorage for storing the same information. This ensures that the authentication state is preserved across app restarts and sessions, providing a seamless user experience.
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import {
  createContext,
  ReactNode,
  useContext,
  useEffect,
  useState,
} from 'react';

import {
  Platform,
} from 'react-native';

import {
  AuthUser,
  loginUser,
} from '@/services/authService';

const TOKEN_KEY =
  'agroflow_access_token';

const USER_KEY =
  'agroflow_auth_user';

type UpdateProfileInput = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
};

type AuthContextType = {
  user: AuthUser | null;
  accessToken: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;

  signIn: (
    email: string,
    password: string
  ) => Promise<void>;

  signOut:
    () => Promise<void>;

  updateProfile: (
    profile: UpdateProfileInput
  ) => Promise<void>;
};

const AuthContext =
  createContext<
    AuthContextType | undefined
  >(undefined);

async function getStoredValue(
  key: string
) {
  if (
    Platform.OS === 'web'
  ) {
    return AsyncStorage.getItem(
      key
    );
  }

  return SecureStore.getItemAsync(
    key
  );
}

async function setStoredValue(
  key: string,
  value: string
) {
  if (
    Platform.OS === 'web'
  ) {
    await AsyncStorage.setItem(
      key,
      value
    );

    return;
  }

  await SecureStore.setItemAsync(
    key,
    value
  );
}

async function deleteStoredValue(
  key: string
) {
  if (
    Platform.OS === 'web'
  ) {
    await AsyncStorage.removeItem(
      key
    );

    return;
  }

  await SecureStore.deleteItemAsync(
    key
  );
}

function createInitials(
  firstName: string,
  lastName: string
) {
  const firstInitial =
    firstName
      .trim()
      .charAt(0)
      .toUpperCase();

  const lastInitial =
    lastName
      .trim()
      .charAt(0)
      .toUpperCase();

  return `${firstInitial}${lastInitial}`;
}

export function AuthProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [
    user,
    setUser,
  ] =
    useState<
      AuthUser | null
    >(null);

  const [
    accessToken,
    setAccessToken,
  ] =
    useState<
      string | null
    >(null);

  const [
    isLoading,
    setIsLoading,
  ] =
    useState(true);

  useEffect(() => {
    restoreSession();
  }, []);

  async function restoreSession() {//attempts to restore the user's session by retrieving the stored access token and user data from secure storage or AsyncStorage. If both values are found, it sets the authentication state accordingly. If either value is missing or an error occurs during retrieval, it clears the session to ensure a clean state.
    try {
      const [
        storedToken,
        storedUser,
      ] =
        await Promise.all([
          getStoredValue(
            TOKEN_KEY
          ),

          getStoredValue(
            USER_KEY
          ),
        ]);

      if (
        !storedToken ||
        !storedUser
      ) {
        await clearSession();

        return;
      }

      const parsedUser =
        JSON.parse(
          storedUser
        ) as Partial<AuthUser>;

      const restoredUser: AuthUser =
        {
          id:
            parsedUser.id ??
            'USR001',

          firstName:
            parsedUser.firstName ??
            '',

          lastName:
            parsedUser.lastName ??
            '',

          email:
            parsedUser.email ??
            '',

          phone:
            parsedUser.phone ??
            '',

          role:
            parsedUser.role ??
            'Farmer',

          initials:
            parsedUser.initials ??
            createInitials(
              parsedUser.firstName ??
                '',
              parsedUser.lastName ??
                ''
            ),
        };

      setAccessToken(
        storedToken
      );

      setUser(
        restoredUser
      );
    } catch (
      error: unknown
    ) {
      console.log(
        'Session restore error:',
        error
      );

      await clearSession();
    } finally {
      setIsLoading(
        false
      );
    }
  }

  async function signIn(
    email: string,
    password: string
  ) {
    const response =
      await loginUser(
        email,
        password
      );

    await Promise.all([
      setStoredValue(
        TOKEN_KEY,
        response.accessToken
      ),

      setStoredValue(
        USER_KEY,
        JSON.stringify(
          response.user
        )
      ),
    ]);

    setAccessToken(
      response.accessToken
    );

    setUser(
      response.user
    );
  }

  async function updateProfile(
    profile: UpdateProfileInput
  ) {
    if (
      !user
    ) {
      return;
    }

    const updatedUser: AuthUser =
      {
        ...user,

        firstName:
          profile.firstName.trim(),

        lastName:
          profile.lastName.trim(),

        email:
          profile.email
            .trim()
            .toLowerCase(),

        phone:
          profile.phone.trim(),

        initials:
          createInitials(
            profile.firstName,
            profile.lastName
          ),
      };

    await setStoredValue(
      USER_KEY,
      JSON.stringify(
        updatedUser
      )
    );

    setUser(
      updatedUser
    );
  }

  async function signOut() {
    await clearSession();
  }

  async function clearSession() {
    try {
      await Promise.all([
        deleteStoredValue(
          TOKEN_KEY
        ),

        deleteStoredValue(
          USER_KEY
        ),
      ]);
    } catch (
      error: unknown
    ) {
      console.log(
        'Session clear error:',
        error
      );
    } finally {
      setAccessToken(
        null
      );

      setUser(
        null
      );
    }
  }

  const isAuthenticated =
    Boolean(
      user &&
      accessToken
    );

  return (
    <AuthContext.Provider
      value={{
        user,
        accessToken,
        isAuthenticated,
        isLoading,
        signIn,
        signOut,
        updateProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context =
    useContext(
      AuthContext
    );

  if (
    !context
  ) {
    throw new Error(
      'useAuth must be used inside AuthProvider'
    );
  }

  return context;
}