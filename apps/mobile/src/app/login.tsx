import { router } from '@/lib/router';

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

import {
  useAuth,
} from '@/context/AuthContext';

import {
  useTheme,
} from '@/context/ThemeContext';

import {
  createLoginStyles,
} from '@/styles/loginStyles';

function getLoginErrorMessage(
  error: unknown
) {
  if (
    !(error instanceof Error)
  ) {
    return 'Unable to sign in. Please try again.';
  }

  const message =
    error.message.toLowerCase();

  if (
    message.includes(
      'invalid login credentials'
    )
  ) {
    return 'Incorrect email address or password.';
  }

  if (
    message.includes(
      'email not confirmed'
    )
  ) {
    return 'Your email is not confirmed. Please contact your AgroFlow administrator.';
  }

  if (
    message.includes(
      'network'
    ) ||
    message.includes(
      'fetch'
    )
  ) {
    return 'Unable to connect. Check your internet connection and try again.';
  }

  return error.message;
}

export default function LoginScreen() {
  const {
    signIn,
  } = useAuth();

  const {
    colors,
  } = useTheme();
//styles are created using the useMemo hook to ensure that they are only recalculated when the colors object changes. This optimizes performance by preventing unnecessary re-renders and style recalculations when the theme colors remain the same.
  const styles =
    useMemo(
      () =>
        createLoginStyles(
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
    password,
    setPassword,
  ] =
    useState('');

  const [
    showPassword,
    setShowPassword,
  ] =
    useState(false);

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

  async function handleLogin() {
    setError('');

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

      return;
    }

    const emailIsValid =//email validation using a regular expression to check if the cleaned email input matches the standard email format. If the email is not valid, an error message is set to inform the user.
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
        cleanedEmail
      );

    if (
      !emailIsValid
    ) {
      setError(
        'Please enter a valid email address.'
      );

      return;
    }

    if (
      !password.trim()
    ) {
      setError(
        'Please enter your password.'
      );

      return;
    }

    try {//authentication process by calling the signIn function from the AuthContext with the cleaned email and password. If the sign-in is successful, the user is authenticated and redirected to the appropriate screen. If an error occurs during sign-in, an error message is displayed to inform the user.
      setLoading(//try is attempt authentication, if it fails, catch will handle the error and display a message to the user. Finally, loading state is set to false to indicate that the authentication process has completed.
        true
      );

      await signIn(
        cleanedEmail,
        password
      );
    } catch (
      caughtError: unknown
    ) {
      setError(
        getLoginErrorMessage(
          caughtError
        )
      );
    } finally {
      setLoading(
        false
      );
    }
  }

  function handleForgotPassword() {
    router.push(
      '/forgot-password'
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
                Sign In
              </Text>

              <Text
                style={
                  styles.description
                }
              >
                Enter your AgroFlow account details.
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
                  returnKeyType="next"
                  style={
                    styles.input
                  }
                />
              </View>

              <View
                style={
                  styles.inputGroup
                }
              >
                <View
                  style={
                    styles.passwordLabelRow
                  }
                >
                  <Text
                    style={
                      styles.inputLabel
                    }
                  >
                    Password
                  </Text>

                  <TouchableOpacity
                    onPress={
                      handleForgotPassword
                    }
                    activeOpacity={
                      0.7
                    }
                  >
                    <Text
                      style={
                        styles.forgotText
                      }
                    >
                      Forgot password?
                    </Text>
                  </TouchableOpacity>
                </View>

                <View
                  style={
                    styles.passwordInput
                  }
                >
                  <TextInput
                    value={
                      password
                    }
                    onChangeText={
                      (
                        value
                      ) => {
                        setPassword(
                          value
                        );

                        if (
                          error
                        ) {
                          setError('');
                        }
                      }
                    }
                    placeholder="Enter your password"
                    placeholderTextColor={
                      colors.textMuted
                    }
                    secureTextEntry={
                      !showPassword
                    }
                    autoCapitalize="none"
                    autoComplete="current-password"
                    textContentType="password"
                    autoCorrect={
                      false
                    }
                    returnKeyType="done"
                    onSubmitEditing={
                      handleLogin
                    }
                    style={
                      styles.passwordTextInput
                    }
                  />

                  <TouchableOpacity
                    style={
                      styles.showButton
                    }
                    onPress={() =>
                      setShowPassword(
                        (
                          current
                        ) =>
                          !current
                      )
                    }
                    activeOpacity={
                      0.7
                    }
                  >
                    <Text
                      style={
                        styles.showButtonText
                      }
                    >
                      {showPassword
                        ? 'Hide'
                        : 'Show'}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>

              <TouchableOpacity
                style={[
                  styles.loginButton,

                  loading &&
                    styles.loginButtonDisabled,
                ]}
                activeOpacity={
                  0.75
                }
                disabled={
                  loading
                }
                onPress={
                  handleLogin
                }
              >
                <Text
                  style={
                    styles.loginButtonText
                  }
                >
                  {loading
                    ? 'Signing In...'
                    : 'Sign In'}
                </Text>
              </TouchableOpacity>
            </View>

            {/* Item 6c: for someone who is not a farmer on AgroFlow yet. */}
            <TouchableOpacity
              accessibilityRole="link"
              onPress={() => router.push('/enquiry')}
              activeOpacity={0.7}
            >
              <Text style={styles.forgotText}>
                Not a farmer on AgroFlow yet? Ask for a call
              </Text>
            </TouchableOpacity>

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

