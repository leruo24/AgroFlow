// Holds the current Supabase auth state and shares it with the whole app. Supabase handles
// session storage and token refresh; this context listens for auth changes and updates the
// app when a farmer signs in, signs out or updates their account.

import type {
  Session,
} from '@supabase/supabase-js';

import {
  createContext,
  ReactNode,
  useContext,
  useEffect,
  useState,
} from 'react';

import {
  supabase,
} from '@/lib/supabase';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { isNetworkError } from '@/lib/connectivity';
import { clearCacheFor, setCacheUser } from '@/lib/offlineCache';
import { flushQueue, setQueueUser } from '@/lib/offlineQueue';

import {
  confirmPasswordChanged,
  saveLanguagePreference,
} from '@/services/agroFlowApi';
import { getLanguage } from '@/i18n';

import {
  AuthUser,
  loginUser,
  logoutUser,
  mapSupabaseUser,
  UpdateProfileInput,
  updateAuthenticatedUser,
} from '@/services/authService';

import {
  resetDripHelperSession,
} from '@/components/DripHelper';

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

  // Security: true while the farmer is still on their onboarding password. It was read off an
  // admin screen or sits in their Telegram chat, so the app forces a change first.
  mustChangePassword: boolean;

  // Called once the farmer has set a new password.
  clearMustChangePassword:
    () => Promise<void>;
};

/* The session supabase-js saved on this phone, read directly. Used only when the login could not
 * be refreshed for lack of a connection: supabase-js keeps the session in storage then but
 * getSession() answers null, which would send an offline farmer to the sign-in screen. With it,
 * they stay signed in and see the copies saved on the phone (read-only until they are back). */
async function readStoredSession(): Promise<Session | null> {
  try {
    const key = (supabase.auth as unknown as { storageKey?: string }).storageKey;
    if (!key) return null;
    const raw = Platform.OS === 'web'
      ? (typeof window !== 'undefined' ? window.localStorage.getItem(key) : null)
      : await AsyncStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Session;
    return parsed?.user?.id ? parsed : null;
  } catch {
    return null;
  }
}

const AuthContext =
  createContext<
    AuthContextType | undefined
  >(undefined);

export function AuthProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [
    session,
    setSession,
  ] =
    useState<
      Session | null
    >(null);

  const [
    user,
    setUser,
  ] =
    useState<
      AuthUser | null
    >(null);

  const [
    isLoading,
    setIsLoading,
  ] =
    useState(true);

  const [
    mustChangePassword,
    setMustChangePassword,
  ] =
    useState(false);

  // Reads the flag from the farmer's own profile row. A failed read counts as "no forced
  // change": a network blip must not lock anyone out, and the admin can reset the password again.
  async function loadMustChangePassword(
    userId: string | undefined
  ) {
    if (
      !userId
    ) {
      setMustChangePassword(
        false
      );

      return;
    }

    try {
      const {
        data,
        error,
      } =
        await supabase
          .from('profile')
          .select('must_change_password')
          .eq('id', userId)
          .maybeSingle();

      if (
        error
      ) {
        throw error;
      }

      setMustChangePassword(
        data?.must_change_password === true
      );
    } catch (
      error: unknown
    ) {
      console.log(
        'Could not read must_change_password:',
        error
      );

      setMustChangePassword(
        false
      );
    }
  }

  useEffect(() => {
    let isMounted =
      true;

    //Restores the Supabase session when the application starts.
    async function restoreSession() {
      try {
        const {
          data,
          error,
        } =
          await supabase.auth
            .getSession();

        if (
          error
        ) {
          throw error;
        }

        if (
          !isMounted
        ) {
          return;
        }

        setSession(
          data.session
        );

        setUser(
          data.session
            ? mapSupabaseUser(
                data.session.user
              )
            : null
        );

        await loadMustChangePassword(
          data.session?.user.id
        );
      } catch (
        error: unknown
      ) {
        console.log(
          'Supabase session restore error:',
          error
        );

        // No connection is not the same as signed out: keep the farmer on the stored session.
        const stored =
          isNetworkError(error) ? await readStoredSession() : null;

        if (
          isMounted
        ) {
          setSession(
            stored
          );

          setUser(
            stored
              ? mapSupabaseUser(stored.user)
              : null
          );
        }
      } finally {
        if (
          isMounted
        ) {
          setIsLoading(
            false
          );
        }
      }
    }

    restoreSession();

    //Listens for sign-in, sign-out and token refresh events.
    const {
      data: {
        subscription,
      },
    } =
      supabase.auth
        .onAuthStateChange(
          (
            _event,
            newSession
          ) => {
            if (
              !isMounted
            ) {
              return;
            }

            setSession(
              newSession
            );

            setUser(
              newSession
                ? mapSupabaseUser(
                    newSession.user
                  )
                : null
            );

            void loadMustChangePassword(
              newSession?.user.id
            );

            setIsLoading(
              false
            );
          }
        );

    return () => {
      isMounted =
        false;

      subscription.unsubscribe();
    };
  }, []);

  async function signIn(
    email: string,
    password: string
  ) {
    const response =
      await loginUser(
        email,
        password
      );

    setSession(
      response.session
    );

    setUser(
      response.user
    );

    await loadMustChangePassword(
      response.session?.user.id
    );
  }

  async function clearMustChangePassword() {
    await confirmPasswordChanged();

    setMustChangePassword(
      false
    );
  }

  async function updateProfile(
    profile: UpdateProfileInput
  ) {
    if (
      !session
    ) {
      throw new Error(
        'You must be signed in to update your profile.'
      );
    }

    const updatedUser =
      await updateAuthenticatedUser(
        profile
      );

    setUser(
      updatedUser
    );
  }

  async function signOut() {
    // This farmer's saved copies leave the phone with them. Their unsent refills and soil
    // checks stay, under their own name, for their next sign-in.
    if (user?.id) await clearCacheFor(user.id);
    await setQueueUser(null);

    await logoutUser();

    // The raindrop helper greets once per login; clearing the flag here means the next farmer
    // to sign in on this device gets their own greeting.
    resetDripHelperSession();

    setSession(
      null
    );

    setUser(
      null
    );

    setMustChangePassword(
      false
    );
  }

  // Whose offline copies and queue to use. Sends anything waiting once the farmer is known.
  const userId = user?.id ?? null;
  useEffect(() => {
    setCacheUser(userId);
    if (!userId) return;
    void setQueueUser(userId).then(() => flushQueue()).catch(() => undefined);
    // The language chosen on this phone, for this farmer's Telegram messages.
    void saveLanguagePreference(getLanguage()).catch(() => undefined);
  }, [userId]);

  const accessToken =
    session
      ?.access_token ??
    null;

  const isAuthenticated =
    Boolean(
      session &&
      user
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
        mustChangePassword,
        clearMustChangePassword,
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