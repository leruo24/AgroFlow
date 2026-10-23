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

import {
  t,
  useI18n,
} from '@/i18n';

import {
  looksTemporary,
} from '@/lib/signInHelp';
import { useBottomPadding } from '@/hooks/useScreenPadding';

function getLoginErrorMessage(
  error: unknown,
  typedPassword = ''
) {
  if (
    !(error instanceof Error)
  ) {
    return t('signin.failed');
  }

  const message =
    error.message.toLowerCase();

  if (
    message.includes(
      'invalid login credentials'
    )
  ) {
    // Looks like one of our temporary passwords: say how they are typed and that they expire.
    return looksTemporary(typedPassword)
      ? `${t('signin.wrong')} ${t('signin.tempHint')}`
      : t('signin.wrong');
  }

  if (
    message.includes(
      'email not confirmed'
    )
  ) {
    return t('signin.notConfirmed');
  }

  if (
    message.includes(
      'network'
    ) ||
    message.includes(
      'fetch'
    )
  ) {
    return t('signin.noConnection');
  }

  return error.message;
}

export default function LoginScreen() {
  // Re-renders in the farmer's language.
  useI18n();
  // The floating tab bar (if any), the bottom safe area and 16 below the last control.
  const bottomPad = useBottomPadding(false);
  const {
    signIn,
  } = useAuth();

  const {
    colors,
  } = useTheme();
// Styles are memoised so they are only rebuilt when the theme colours change.
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
        t('signin.needEmail')
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
        t('signin.badEmail')
      );

      return;
    }

    if (
      !password.trim()
    ) {
      setError(
        t('signin.needPassword')
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
          caughtError,
          password
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
                  {t('signin.tagline')}
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
                {t('signin.title')}
              </Text>

              <Text
                style={
                  styles.description
                }
              >
                {t('signin.subtitle')}
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
                  {t('signin.email')}
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
                  placeholder={t('login.emailExample')}
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
                    {t('signin.password')}
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
                      {t('signin.forgot')}
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
                    placeholder={t('signin.passwordPlaceholder')}
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
                        ? t('signin.hide')
                        : t('signin.show')}
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
                    ? t('signin.signingIn')
                    : t('signin.button')}
                </Text>
              </TouchableOpacity>
            </View>

            {/* For someone who is not a farmer on AgroFlow yet. */}
            <TouchableOpacity
              accessibilityRole="link"
              onPress={() => router.push('/enquiry')}
              activeOpacity={0.7}
            >
              <Text style={styles.forgotText}>
                {t('signin.askCall')}
              </Text>
            </TouchableOpacity>

            <Text
              style={
                styles.footer
              }
            >
              {t('signin.footer')}
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

