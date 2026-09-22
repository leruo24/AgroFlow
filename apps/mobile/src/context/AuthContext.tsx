//Centralises the current Supabase authentication state
//and makes it available throughout the AgroFlow app.
//Supabase manages session persistence and token refreshing.
//The context listens for authentication changes and updates
//the app whenever a farmer signs in, signs out or updates
//their account.

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

import {
  confirmPasswordChanged,
} from '@/services/agroFlowApi';

import {
  AuthUser,
  loginUser,
  logoutUser,
  mapSupabaseUser,
  UpdateProfileInput,
  updateAuthenticatedUser,
} from '@/services/authService';

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

  //True while the farmer is still on the temporary password they were given
  //at onboarding. That password is read off an admin screen or sits in their
  //Telegram chat history, so the app forces a change before letting them in.
  mustChangePassword: boolean;

  //Called once the farmer has actually set a new password.
  clearMustChangePassword:
    () => Promise<void>;
};

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

  //Reads the flag straight from the farmer's own profile row. Failing to
  //read it is treated as "no forced change": a network blip must lock nobody
  //out of their own farm, and the admin can always reset the password again.
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

        if (
          isMounted
        ) {
          setSession(
            null
          );

          setUser(
            null
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
    await logoutUser();

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