// Lets a user who opened a valid Supabase recovery link choose a new password. The link
// creates a temporary session before Supabase allows the change.
import {
  useLocalSearchParams,
} from 'expo-router';
import { router } from '@/lib/router';

import * as Linking from 'expo-linking';

import {
  useEffect,
  useMemo,
  useState,
} from 'react';

import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import {
  SafeAreaView,
} from 'react-native-safe-area-context';

import {
  useAuth,
} from '@/context/AuthContext';

import {
  useTheme,
} from '@/context/ThemeContext';

import {
  supabase,
} from '@/lib/supabase';

import {
  createUpdatePasswordStyles,
} from '@/styles/updatePasswordStyles';
import { useBottomPadding } from '@/hooks/useScreenPadding';

function getRecoveryParameters(
  url: string
) {
  const query =
    url.includes('?')
      ? url
          .split('?')[1]
          .split('#')[0]
      : '';

  const hash =
    url.includes('#')
      ? url.split('#')[1]
      : '';

  return new URLSearchParams(
    [
      query,
      hash,
    ]
      .filter(Boolean)
      .join('&')
  );
}

export default function UpdatePasswordScreen() {
  // The floating tab bar (if any), the bottom safe area and 16 below the last control.
  const bottomPad = useBottomPadding(false);
  const {
    source,
  } = useLocalSearchParams<{
    source?: string;
  }>();

  const openedFromProfile =
    source === 'profile';

  // The forced first-login change: the farmer comes here straight after signing in with
  // their onboarding password and cannot use the rest of the app until it is done (see
  // _layout.tsx).
  const openedAsFirstLogin =
    source === 'first-login';

  const {
    clearMustChangePassword,
  } = useAuth();

  const {
    colors,
  } = useTheme();

  const styles =
    useMemo(
      () =>
        createUpdatePasswordStyles(
          colors
        ),
      [
        colors,
      ]
    );

  const recoveryUrl =
    Linking.useLinkingURL();

  const [
    newPassword,
    setNewPassword,
  ] =
    useState('');

  const [
    confirmPassword,
    setConfirmPassword,
  ] =
    useState('');

  const [
    checkingLink,
    setCheckingLink,
  ] =
    useState(true);

  const [
    recoveryReady,
    setRecoveryReady,
  ] =
    useState(false);

  const [
    saving,
    setSaving,
  ] =
    useState(false);

  const [
    success,
    setSuccess,
  ] =
    useState(false);

  const [
    error,
    setError,
  ] =
    useState('');

// Reads the implicit-flow tokens or a PKCE code from the recovery link and gives them to
// Supabase to create the recovery session.
  useEffect(
    () => {
      let isMounted =
        true;

      async function prepareRecoverySession() {
        try {
          setCheckingLink(
            true
          );

          setError('');

          const {
            data: sessionData,
            error: sessionError,
          } =
            await supabase.auth
              .getSession();

          if (
            sessionError
          ) {
            throw sessionError;
          }

          if (
            sessionData.session
          ) {
            if (
              isMounted
            ) {
              setRecoveryReady(
                true
              );
            }

            return;
          }

          if (
            !recoveryUrl
          ) {
            throw new Error(
              'Open the password recovery link from your email.'
            );
          }

          const parameters =
            getRecoveryParameters(
              recoveryUrl
            );

          const linkError =
            parameters.get(
              'error_description'
            );

          if (
            linkError
          ) {
            throw new Error(
              linkError
            );
          }

          const code =
            parameters.get(
              'code'
            );

          if (
            code
          ) {
            const {
              error: exchangeError,
            } =
              await supabase.auth
                .exchangeCodeForSession(
                  code
                );

            if (
              exchangeError
            ) {
              throw exchangeError;
            }
          } else {
            const accessToken =
              parameters.get(
                'access_token'
              );

            const refreshToken =
              parameters.get(
                'refresh_token'
              );

            if (
              !accessToken ||
              !refreshToken
            ) {
              throw new Error(
                'This recovery link is invalid or has expired.'
              );
            }

            const {
              error: setSessionError,
            } =
              await supabase.auth
                .setSession({
                  access_token:
                    accessToken,
                  refresh_token:
                    refreshToken,
                });

            if (
              setSessionError
            ) {
              throw setSessionError;
            }
          }

          if (
            isMounted
          ) {
            setRecoveryReady(
              true
            );
          }
        } catch (
          caughtError: unknown
        ) {
          console.log(
            'Password recovery link error:',
            caughtError
          );

          if (
            isMounted
          ) {
            setRecoveryReady(
              false
            );

            setError(
              caughtError instanceof Error
                ? caughtError.message
                : 'The password recovery link could not be verified.'
            );
          }
        } finally {
          if (
            isMounted
          ) {
            setCheckingLink(
              false
            );
          }
        }
      }

      void prepareRecoverySession();

      return () => {
        isMounted =
          false;
      };
    },
    [
      recoveryUrl,
    ]
  );

  async function handleUpdatePassword() {
    setError('');

    if (
      !recoveryReady
    ) {
      setError(
        'Open a valid password recovery link first.'
      );

      return;
    }

    if (
      newPassword.length < 8
    ) {
      setError(
        'Your new password must contain at least 8 characters.'
      );

      return;
    }

    if (
      newPassword !==
      confirmPassword
    ) {
      setError(
        'The passwords do not match.'
      );

      return;
    }

    try {
      setSaving(
        true
      );

      const {
        error: updateError,
      } =
        await supabase.auth
          .updateUser({
            password:
              newPassword,
          });

      if (
        updateError
      ) {
        throw updateError;
      }

      setSuccess(
        true
      );
    } catch (
      caughtError: unknown
    ) {
      console.log(
        'Password update error:',
        caughtError
      );

      setError(
        caughtError instanceof Error
          ? caughtError.message
          : 'Your password could not be updated.'
      );
    } finally {
      setSaving(
        false
      );
    }
  }

  async function handleSuccessNavigation() {
    if (
      openedAsFirstLogin
    ) {
      // Clearing the flag unlocks the rest of the app. If it fails the farmer keeps the new
      // password but stays here and can try again, which is the safe way round.
      try {
        await clearMustChangePassword();
      } catch (
        caughtError: unknown
      ) {
        console.log(
          'Could not clear the forced password change:',
          caughtError
        );

        setError(
          'Your password was changed, but the app could not confirm it. Please try again.'
        );

        setSuccess(
          false
        );

        return;
      }

      router.replace(
        '/'
      );

      return;
    }

    if (
      openedFromProfile
    ) {
      router.replace(
        '/profile'
      );

      return;
    }

    await supabase.auth
      .signOut();

    router.replace(
      '/login'
    );
  }

  return (
    <SafeAreaView
      style={
        styles.safeArea
      }
      edges={[
        'top',
        'bottom',
      ]}
    >
      <KeyboardAvoidingView
        style={
          styles.keyboardView
        }
        behavior={
          Platform.OS === 'ios'
            ? 'padding'
            : undefined
        }
      >
        <ScrollView
          contentContainerStyle={[styles.scrollContent, { paddingBottom: bottomPad }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={
            false
          }
        >
          <View
            style={
              styles.container
            }
          >
            <View
              style={
                styles.brand
              }
            >
              <View
                style={
                  styles.brandMark
                }
              />

              <View>
                <Text
                  style={
                    styles.brandName
                  }
                >
                  AgroFlow
                </Text>

                <Text
                  style={
                    styles.brandSubtitle
                  }
                >
                  Smart Irrigation
                </Text>
              </View>
            </View>

            <Text
              style={
                styles.title
              }
            >
              {success
                ? 'Password Updated'
                : openedAsFirstLogin
                  ? 'Set Your Own Password'
                  : 'Choose New Password'}
            </Text>

            <Text
              style={
                styles.description
              }
            >
              {success
                ? 'Your AgroFlow password has been changed successfully.'
                : openedAsFirstLogin
                  ? 'The password you signed in with was a temporary one. Anyone who saw it - or who can scroll back through your Telegram chat - could use it, so please choose your own now.'
                  : 'Enter and confirm the new password for your account.'}
            </Text>

            {error ? (
              <View
                style={
                  styles.errorBox
                }
              >
                <Text
                  style={
                    styles.errorText
                  }
                >
                  {
                    error
                  }
                </Text>
              </View>
            ) : null}

            {success ? (
              <TouchableOpacity
                style={
                  styles.primaryButton
                }
                onPress={
                  handleSuccessNavigation
                }
                activeOpacity={
                  0.75
                }
              >
                <Text
                  style={
                    styles.primaryButtonText
                  }
                >
                  {openedFromProfile
                    ? 'Return to Profile'
                    : 'Return to Login'}
                </Text>
              </TouchableOpacity>
            ) : (
              <View
                style={
                  styles.form
                }
              >
                <Text
                  style={
                    styles.inputLabel
                  }
                >
                  New Password
                </Text>

                <TextInput
                  value={
                    newPassword
                  }
                  onChangeText={
                    setNewPassword
                  }
                  style={
                    styles.input
                  }
                  placeholder="At least 8 characters"
                  placeholderTextColor={
                    colors.textMuted
                  }
                  secureTextEntry
                  autoCapitalize="none"
                  autoComplete="new-password"
                  textContentType="newPassword"
                />

                <Text
                  style={
                    styles.confirmLabel
                  }
                >
                  Confirm New Password
                </Text>

                <TextInput
                  value={
                    confirmPassword
                  }
                  onChangeText={
                    setConfirmPassword
                  }
                  style={
                    styles.input
                  }
                  placeholder="Enter the password again"
                  placeholderTextColor={
                    colors.textMuted
                  }
                  secureTextEntry
                  autoCapitalize="none"
                  autoComplete="new-password"
                  textContentType="newPassword"
                  returnKeyType="done"
                  onSubmitEditing={
                    handleUpdatePassword
                  }
                />

                <TouchableOpacity
                  style={[
                    styles.primaryButton,

                    (checkingLink ||
                      saving ||
                      !recoveryReady) &&
                      styles.disabledButton,
                  ]}
                  onPress={
                    handleUpdatePassword
                  }
                  disabled={
                    checkingLink ||
                    saving ||
                    !recoveryReady
                  }
                  activeOpacity={
                    0.75
                  }
                >
                  <Text
                    style={
                      styles.primaryButtonText
                    }
                  >
                    {checkingLink
                      ? 'Checking Link...'
                      : saving
                        ? 'Updating...'
                        : 'Update Password'}
                  </Text>
                </TouchableOpacity>
              </View>
            )}

            <Text
              style={
                styles.footer
              }
            >
              AgroFlow Smart Irrigation System
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

