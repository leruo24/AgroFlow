// Forgot password: a 6-digit code goes to the Telegram chat linked to the account, then the
// code and a new password change it here (docs/password-reset.md). No Telegram: the field
// officer resets it from the admin console.
import { router } from '@/lib/router';

import { useMemo, useState } from 'react';

import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import { SafeAreaView } from 'react-native-safe-area-context';

import { useTheme } from '@/context/ThemeContext';
import { useI18n } from '@/i18n';
import { MIN_PASSWORD_LENGTH, normaliseResetCode } from '@/lib/signInHelp';
import { requestPasswordReset, resetPasswordWithCode } from '@/services/agroFlowApi';
import { createForgotPasswordStyles } from '@/styles/forgotPasswordStyles';
import { useBottomPadding } from '@/hooks/useScreenPadding';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function ForgotPasswordScreen() {
  // The floating tab bar (if any), the bottom safe area and 16 below the last control.
  const bottomPad = useBottomPadding(false);
  const { colors } = useTheme();
  const { t } = useI18n();
  const styles = useMemo(() => createForgotPasswordStyles(colors), [colors]);

  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const [changing, setChanging] = useState(false);
  // True once a code was asked for. Security: the screen says the same thing whatever the
  // email, so it cannot be used to find out which emails have accounts.
  const [codeSent, setCodeSent] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSendCode() {
    setError('');
    const cleaned = email.trim().toLowerCase();
    if (!EMAIL.test(cleaned)) {
      setError(t('forgot.badEmail'));
      return;
    }
    try {
      setSending(true);
      await requestPasswordReset(cleaned);
      setEmail(cleaned);
      setCodeSent(true);
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : t('forgot.badEmail'));
    } finally {
      setSending(false);
    }
  }

  async function handleChange() {
    setError('');
    const digits = normaliseResetCode(code);
    if (!digits) {
      setError(t('forgot.badCode'));
      return;
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(t('forgot.tooShort'));
      return;
    }
    if (password !== again) {
      setError(t('forgot.mismatch'));
      return;
    }
    try {
      setChanging(true);
      await resetPasswordWithCode(email, digits, password);
      setDone(true);
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : t('forgot.badCode'));
    } finally {
      setChanging(false);
    }
  }

  const back = () => router.replace('/login');

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <KeyboardAvoidingView style={styles.keyboardView} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={[styles.scrollContent, { paddingBottom: bottomPad }]} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <View style={styles.container}>
            <View style={styles.topBar}>
              <TouchableOpacity style={styles.backButton} onPress={back} activeOpacity={0.7} accessibilityRole="button">
                <Text style={styles.backArrow}>‹</Text>
                <Text style={styles.backText}>{t('forgot.back')}</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.brand}>
              <View style={styles.brandMark} />
              <View>
                <Text style={styles.brandName}>AgroFlow</Text>
                <Text style={styles.brandSubtitle}>Smart Irrigation</Text>
              </View>
            </View>

            <View style={styles.heading}>
              <Text style={styles.title} accessibilityRole="header">{t('forgot.title')}</Text>
              <Text style={styles.description}>{done ? t('forgot.done') : t('forgot.intro')}</Text>
            </View>

            {error ? (
              <View style={styles.errorBox} accessibilityLiveRegion="polite">
                <Text style={styles.errorText} testID="forgot-error">{error}</Text>
              </View>
            ) : null}

            {done ? (
              <TouchableOpacity style={styles.primaryButton} onPress={back} activeOpacity={0.75} testID="forgot-to-login">
                <Text style={styles.primaryButtonText}>{t('forgot.back')}</Text>
              </TouchableOpacity>
            ) : (
              <View style={styles.form}>
                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>{t('forgot.email')}</Text>
                  <TextInput
                    value={email}
                    onChangeText={value => { setEmail(value); if (error) setError(''); }}
                    placeholder="farmer@example.com"
                    placeholderTextColor={colors.textMuted}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoComplete="email"
                    textContentType="emailAddress"
                    autoCorrect={false}
                    testID="forgot-email"
                    style={styles.input}
                  />
                </View>

                <TouchableOpacity
                  style={[codeSent ? styles.secondaryButton : styles.primaryButton, sending && styles.disabledButton]}
                  onPress={handleSendCode}
                  disabled={sending}
                  activeOpacity={0.75}
                  testID="forgot-send"
                >
                  <Text style={codeSent ? styles.secondaryButtonText : styles.primaryButtonText}>
                    {sending ? t('forgot.sending') : codeSent ? t('forgot.resend') : t('forgot.send')}
                  </Text>
                </TouchableOpacity>

                {codeSent ? (
                  <>
                    <View style={styles.successBox}>
                      <Text style={styles.successLabel} testID="forgot-sent">{t('forgot.sent')}</Text>
                    </View>

                    <View style={styles.inputGroup}>
                      <Text style={styles.inputLabel}>{t('forgot.code')}</Text>
                      <TextInput
                        value={code}
                        onChangeText={setCode}
                        placeholder="123 456"
                        placeholderTextColor={colors.textMuted}
                        keyboardType="number-pad"
                        autoComplete="one-time-code"
                        textContentType="oneTimeCode"
                        maxLength={7}
                        testID="forgot-code"
                        style={styles.input}
                      />
                    </View>
                    <View style={styles.inputGroup}>
                      <Text style={styles.inputLabel}>{t('forgot.newPassword')}</Text>
                      <TextInput
                        value={password}
                        onChangeText={setPassword}
                        secureTextEntry
                        autoCapitalize="none"
                        autoComplete="new-password"
                        textContentType="newPassword"
                        testID="forgot-password"
                        style={styles.input}
                      />
                    </View>
                    <View style={styles.inputGroup}>
                      <Text style={styles.inputLabel}>{t('forgot.again')}</Text>
                      <TextInput
                        value={again}
                        onChangeText={setAgain}
                        secureTextEntry
                        autoCapitalize="none"
                        testID="forgot-again"
                        style={styles.input}
                      />
                    </View>

                    <TouchableOpacity
                      style={[styles.primaryButton, changing && styles.disabledButton]}
                      onPress={handleChange}
                      disabled={changing}
                      activeOpacity={0.75}
                      testID="forgot-change"
                    >
                      <Text style={styles.primaryButtonText}>{changing ? t('forgot.changing') : t('forgot.change')}</Text>
                    </TouchableOpacity>
                  </>
                ) : null}
              </View>
            )}

            {!done ? (
              <View style={styles.infoBox}>
                <Text style={styles.infoText}>{t('forgot.noTelegram')}</Text>
              </View>
            ) : null}

            <Text style={styles.footer}>AgroFlow Smart Irrigation System</Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
