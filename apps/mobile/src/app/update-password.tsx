//allows a user who opened a valid Supabase password-recovery link to choose a new password. The recovery link creates a temporary authenticated session before Supabase permits the password change.
import {
  router,
} from 'expo-router';

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
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import {
  SafeAreaView,
} from 'react-native-safe-area-context';

import type {
  AppColors,
} from '@/constants/colors';

import {
  useTheme,
} from '@/context/ThemeContext';

import {
  supabase,
} from '@/lib/supabase';

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
  const {
    colors,
  } = useTheme();

  const styles =
    useMemo(
      () =>
        createStyles(
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

//reads either the implicit-flow access tokens or a PKCE authorization code from the recovery link, then gives those credentials to Supabase to create the password-recovery session.
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

  async function handleReturnToLogin() {
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
          contentContainerStyle={
            styles.scrollContent
          }
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
                : 'Choose New Password'}
            </Text>

            <Text
              style={
                styles.description
              }
            >
              {success
                ? 'Your AgroFlow password has been changed successfully.'
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
                  handleReturnToLogin
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
                  Return to Login
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

function createStyles(
  colors: AppColors
) {
  return StyleSheet.create({
    safeArea: {
      flex: 1,
      backgroundColor:
        colors.background,
    },

    keyboardView: {
      flex: 1,
    },

    scrollContent: {
      flexGrow: 1,
    },

    container: {
      flex: 1,
      minHeight: 650,
      paddingHorizontal: 20,
      paddingTop: 70,
      paddingBottom: 24,
      backgroundColor:
        colors.background,
    },

    brand: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: 48,
    },

    brandMark: {
      width: 13,
      height: 28,
      marginRight: 9,
      backgroundColor:
        colors.primary,
    },

    brandName: {
      fontSize: 22,
      fontWeight: '700',
      color:
        colors.text,
    },

    brandSubtitle: {
      marginTop: 1,
      fontSize: 9,
      color:
        colors.textSecondary,
    },

    title: {
      fontSize: 28,
      fontWeight: '700',
      color:
        colors.text,
    },

    description: {
      marginTop: 6,
      marginBottom: 22,
      maxWidth: 340,
      fontSize: 13,
      lineHeight: 19,
      color:
        colors.textSecondary,
    },

    errorBox: {
      marginBottom: 14,
      paddingHorizontal: 12,
      paddingVertical: 11,
      backgroundColor:
        colors.errorBackground,
      borderWidth: 1,
      borderColor:
        colors.error,
    },

    errorText: {
      fontSize: 11,
      lineHeight: 16,
      color:
        colors.error,
    },

    form: {
      padding: 16,
      backgroundColor:
        colors.surface,
      borderWidth: 1,
      borderColor:
        colors.border,
    },

    inputLabel: {
      marginBottom: 7,
      fontSize: 11,
      fontWeight: '600',
      color:
        colors.text,
    },

    confirmLabel: {
      marginTop: 16,
      marginBottom: 7,
      fontSize: 11,
      fontWeight: '600',
      color:
        colors.text,
    },

    input: {
      height: 46,
      paddingHorizontal: 12,
      backgroundColor:
        colors.background,
      borderWidth: 1,
      borderColor:
        colors.border,
      fontSize: 12,
      color:
        colors.text,
    },

    primaryButton: {
      height: 46,
      marginTop: 18,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor:
        colors.primary,
      borderWidth: 1,
      borderColor:
        colors.primaryDark,
    },

    primaryButtonText: {
      fontSize: 12,
      fontWeight: '700',
      color:
        colors.white,
    },

    disabledButton: {
      opacity: 0.55,
    },

    footer: {
      marginTop: 'auto',
      paddingTop: 30,
      textAlign: 'center',
      fontSize: 9,
      color:
        colors.textSecondary,
    },
  });
}