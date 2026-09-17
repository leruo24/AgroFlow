//authentication controller that manages user login, logout, and profile updates. It uses React's context API to provide authentication state and functions to the rest of the application. The AuthProvider component wraps the app and maintains the current user's authentication state, including their access token and profile information. It also provides functions for signing in, signing out, and updating the user's profile. The authentication state is persisted using AsyncStorage or SecureStore, depending on the platform, allowing the app to retain user session data across sessions.
import {
  router,
} from 'expo-router';

import {
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

import * as Linking from 'expo-linking';

import {
  useTheme,
} from '@/context/ThemeContext';

import {
  supabase,
} from '@/lib/supabase';

import {
  createForgotPasswordStyles,
} from '@/styles/forgotPasswordStyles';

export default function ForgotPasswordScreen() {
  const {
    colors,
  } = useTheme();

  const styles =//styles are created using the useMemo hook to ensure that they are only recalculated when the colors object changes. This optimizes performance by preventing unnecessary re-renders and style recalculations when the theme colors remain the same.
    useMemo(
      () =>
        createForgotPasswordStyles(
          colors
        ),
      [
        colors,
      ]
    );

  const [
    email,
    setEmail,
  ] =
    useState('');

  const [
    error,
    setError,
  ] =
    useState('');

  const [
    loading,
    setLoading,
  ] =
    useState(false);
//react state variable that indicates whether the password reset request has been submitted. When the user submits their email address for password recovery, this state is set to true, triggering a change in the UI to show a confirmation message and options to return to login or try another email address.
  const [
    submitted,
    setSubmitted,
  ] =
    useState(false);

  function validateEmail() {
    const cleanedEmail =
      email
        .trim()
        .toLowerCase();

    if (
      !cleanedEmail
    ) {
      setError(
        'Please enter your email address.'
      );

      return false;
    }

    const emailIsValid =
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
        cleanedEmail
      );

    if (
      !emailIsValid
    ) {
      setError(
        'Please enter a valid email address.'
      );

      return false;
    }

    return true;
  }

  async function handleResetPassword() {
    setError('');

    if (
      !validateEmail()
    ) {
      return;
    }

    const cleanedEmail =
      email
        .trim()
        .toLowerCase();

    try {
      setLoading(
        true
      );

      const redirectTo =
        Linking.createURL(
          '/update-password'
        );

      console.log(
        'Password recovery redirect URL:',
        redirectTo
      );

      const {
        error: resetError,
      } =
        await supabase.auth
          .resetPasswordForEmail(
            cleanedEmail,
            {
              redirectTo,
            }
          );

      if (
        resetError
      ) {
        throw resetError;
      }

      setEmail(
        cleanedEmail
      );

      setSubmitted(//react state variable that indicates whether the password reset request has been submitted. When the user submits their email address for password recovery, this state is set to true, triggering a change in the UI to show a confirmation message and options to return to login or try another email address.
        true
      );
    } catch (
      error: unknown
    ) {
      console.log(
        'Password reset request error:',
        error
      );

      setError(
        error instanceof Error
          ? error.message
          : 'Unable to send password recovery instructions.'
      );
    } finally {
      setLoading(
        false
      );
    }
  }

  function handleBackToLogin() {
    router.replace(
      '/login'
    );
  }

  function handleTryAnotherEmail() {
    setSubmitted(
      false
    );

    setError('');
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
          Platform.OS ===
          'ios'
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
                styles.topBar
              }
            >
              <TouchableOpacity
                style={
                  styles.backButton
                }
                onPress={
                  handleBackToLogin
                }
                activeOpacity={
                  0.7
                }
              >
                <Text
                  style={
                    styles.backArrow
                  }
                >
                  ‹
                </Text>

                <Text
                  style={
                    styles.backText
                  }
                >
                  Login
                </Text>
              </TouchableOpacity>
            </View>

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

            {!submitted ? (
              <>
                <View
                  style={
                    styles.heading
                  }
                >
                  <Text
                    style={
                      styles.title
                    }
                  >
                    Forgot Password
                  </Text>

                  <Text
                    style={
                      styles.description
                    }
                  >
                    Enter the email address linked to your AgroFlow account.
                  </Text>
                </View>

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

                <View
                  style={
                    styles.form
                  }
                >
                  <View
                    style={
                      styles.inputGroup
                    }
                  >
                    <Text
                      style={
                        styles.inputLabel
                      }
                    >
                      Email Address
                    </Text>

                    <TextInput
                      value={
                        email
                      }
                      onChangeText={
                        (
                          value
                        ) => {
                          setEmail(
                            value
                          );

                          if (
                            error
                          ) {
                            setError('');
                          }
                        }
                      }
                      placeholder="farmer@example.com"
                      placeholderTextColor={
                        colors.textMuted
                      }
                      keyboardType="email-address"
                      autoCapitalize="none"
                      autoComplete="email"
                      textContentType="emailAddress"
                      autoCorrect={
                        false
                      }
                      returnKeyType="send"
                      onSubmitEditing={
                        handleResetPassword
                      }
                      style={
                        styles.input
                      }
                    />
                  </View>

                  <TouchableOpacity
                    style={[
                      styles.primaryButton,

                      loading &&
                        styles.disabledButton,
                    ]}
                    onPress={
                      handleResetPassword
                    }
                    disabled={
                      loading
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
                      {loading
                        ? 'Sending...'
                        : 'Send Reset Instructions'}
                    </Text>
                  </TouchableOpacity>
                </View>

                <View
                  style={
                    styles.infoBox
                  }
                >
                  <Text
                    style={
                      styles.infoTitle
                    }
                  >
                    What happens next?
                  </Text>

                  <Text
                    style={
                      styles.infoText
                    }
                  >
                    If an account exists for this email address, password recovery instructions will be sent to it.
                  </Text>
                </View>
              </>
            ) : (
              <>
                <View
                  style={
                    styles.heading
                  }
                >
                  <Text
                    style={
                      styles.title
                    }
                  >
                    Check Your Email
                  </Text>

                  <Text
                    style={
                      styles.description
                    }
                  >
                    If an AgroFlow account exists for the email below, recovery instructions will be sent there.
                  </Text>
                </View>

                <View
                  style={
                    styles.successBox
                  }
                >
                  <Text
                    style={
                      styles.successLabel
                    }
                  >
                    Reset request sent
                  </Text>

                  <Text
                    style={
                      styles.successEmail
                    }
                    numberOfLines={
                      1
                    }
                  >
                    {
                      email.trim()
                    }
                  </Text>
                </View>

                <TouchableOpacity
                  style={
                    styles.primaryButton
                  }
                  onPress={
                    handleBackToLogin
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

                <TouchableOpacity
                  style={
                    styles.secondaryButton
                  }
                  onPress={
                    handleTryAnotherEmail
                  }
                  activeOpacity={
                    0.7
                  }
                >
                  <Text
                    style={
                      styles.secondaryButtonText
                    }
                  >
                    Try Another Email Address
                  </Text>
                </TouchableOpacity>
              </>
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

