// Settings tab screen
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from '@/lib/router';
import { useEffect, useMemo, useState } from 'react';
import {
  ScrollView,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ScreenHeader } from '@/components/ScreenHeader';
import type { ThemePreference } from '@/context/ThemeContext';
import { useTheme } from '@/context/ThemeContext';
import { createSettingsStyles } from '@/styles/settingsStyles';
import { HelpButton } from '@/components/HelpButton';
import { useAppPreferences } from '@/hooks/useAppPreferences';
import { disconnectTelegram, fetchTelegramLinkStatus } from '@/services/agroFlowApi';
import { AppAlert as Alert } from '@/components/AppAlert';
import { LANGUAGES, useI18n, type TranslationKey } from '@/i18n';
import { useBottomPadding } from '@/hooks/useScreenPadding';

const NOTIFICATION_PREFERENCES_KEY =
  'agroflow_notification_preferences';

type NotificationPreferences = {
  irrigation: boolean;
  moisture: boolean;
  weather: boolean;
  device: boolean;
};

const appearanceOptions: {
  title: TranslationKey;
  value: ThemePreference;
}[] = [
  { title: 'settings.light', value: 'light' },
  { title: 'settings.dark', value: 'dark' },
  { title: 'settings.system', value: 'system' },
];

const notificationOptions: {
  key: keyof NotificationPreferences;
  title: TranslationKey;
  description: TranslationKey;
}[] = [
  { key: 'irrigation', title: 'settings.notifIrrigation', description: 'settings.notifIrrigationBody' },
  { key: 'moisture', title: 'settings.notifMoisture', description: 'settings.notifMoistureBody' },
  { key: 'weather', title: 'settings.notifWeather', description: 'settings.notifWeatherBody' },
  { key: 'device', title: 'settings.notifDevice', description: 'settings.notifDeviceBody' },
];

export default function SettingsScreen() {
  // The floating tab bar (if any), the bottom safe area and 16 below the last control.
  const bottomPad = useBottomPadding(true);
  const {
    themePreference,
    resolvedTheme,
    setThemePreference,
    colors,
  } = useTheme();

  const styles = useMemo(
    () => createSettingsStyles(colors),
    [colors]
  );

  const { t, lang, setLanguage } = useI18n();
  const [unlinking, setUnlinking] = useState(false);
  const [telegramMessage, setTelegramMessage] = useState<string | null>(null);

  const [notificationPreferences, setNotificationPreferences] =
    useState<NotificationPreferences>({
      irrigation: true,
      moisture: true,
      weather: true,
      device: true,
    });

  const [preferencesLoaded, setPreferencesLoaded] =
    useState(false);

  // Whether this farmer's Telegram is linked. Only read here: linking, the alerts switch
  // and disconnecting are in TelegramSection on the Profile screen, and this row sends the
  // farmer there. null means "not known yet", so we show no status instead of guessing
  // "Not connected".
  const [telegramLinked, setTelegramLinked] =
    useState<boolean | null>(null);

  // In-app help preferences, stored on this device by useAppPreferences. Separate from the
  // notification preferences above: these are display choices.
  const {
    preferences: appPreferences,
    setPreference: setAppPreference,
    ready: appPreferencesReady,
  } = useAppPreferences();

  useEffect(() => {
    async function loadPreferences() {
      try {
        const stored = await AsyncStorage.getItem(
          NOTIFICATION_PREFERENCES_KEY
        );

        if (stored) {
          const parsed = JSON.parse(
            stored
          ) as Partial<NotificationPreferences>;

          setNotificationPreferences({
            irrigation: parsed.irrigation ?? true,
            moisture: parsed.moisture ?? true,
            weather: parsed.weather ?? true,
            device: parsed.device ?? true,
          });
        }
      } catch (error) {
        console.log(
          'Could not load notification preferences:',
          error
        );
      } finally {
        setPreferencesLoaded(true);
      }
    }

    loadPreferences();
  }, []);

  useEffect(() => {
    let active = true;

    void (async () => {
      try {
        const status =
          await fetchTelegramLinkStatus();

        if (active) {
          setTelegramLinked(status.linked);
        }
      } catch {
        // Offline, signed out, or Telegram not set up on the server. The row shows no status and
        // still navigates; one row failing must not break the settings page.
        if (active) setTelegramLinked(null);
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!preferencesLoaded) {
      return;
    }

    AsyncStorage.setItem(
      NOTIFICATION_PREFERENCES_KEY,
      JSON.stringify(notificationPreferences)
    ).catch((error) => {
      console.log(
        'Could not save notification preferences:',
        error
      );
    });
  }, [notificationPreferences, preferencesLoaded]);

  // Unlink Telegram (lost or changed phone): asks first, then clears the link on the server,
  // which also cancels any unused code. Connecting again is on the Profile screen.
  function confirmUnlinkTelegram() {
    Alert.alert(
      t('settings.unlinkTitle'),
      t('settings.unlinkBody'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('settings.unlinkConfirm'),
          style: 'destructive',
          onPress: () => {
            setUnlinking(true);
            setTelegramMessage(null);
            disconnectTelegram()
              .then(() => {
                setTelegramLinked(false);
                setTelegramMessage(t('settings.unlinked'));
              })
              .catch((error: unknown) => {
                setTelegramMessage(error instanceof Error && error.message ? error.message : t('settings.unlinkFailed'));
              })
              .finally(() => setUnlinking(false));
          },
        },
      ]
    );
  }

  function updateNotificationPreference(
    key: keyof NotificationPreferences,
    value: boolean
  ) {
    setNotificationPreferences((current) => ({
      ...current,
      [key]: value,
    }));
  }

  return (
    <SafeAreaView
      style={styles.safeArea}
      edges={['top']}
    >
      <ScrollView
        style={styles.page}
        showsVerticalScrollIndicator={false}
        stickyHeaderIndices={[]}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: bottomPad }]}
      >
          <ScreenHeader title={t('settings.title')} subtitle={t('settings.subtitle')} help="settings" />

          <Text style={styles.sectionTitle}>{t('settings.language')}</Text>

          <View style={styles.sectionCard}>
            {LANGUAGES.map((option) => {
              const selected = lang === option.value;
              return (
                <TouchableOpacity
                  key={option.value}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: selected }}
                  accessibilityLabel={option.beta ? `${option.name} ${t('settings.beta')}` : option.name}
                  testID={`language-${option.value}`}
                  style={[styles.settingRow, selected && styles.selectedRow]}
                  onPress={() => { void setLanguage(option.value); }}
                  activeOpacity={0.75}
                >
                  <Text style={styles.settingTitle}>
                    {option.name}{option.beta ? ` ${t('settings.beta')}` : ''}
                  </Text>
                  <View style={[styles.radio, selected && styles.radioSelected]}>
                    {selected ? <View style={styles.radioInner} /> : null}
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={styles.note}>{t('settings.languageNote')}</Text>

          <Text style={styles.sectionTitle}>{t('settings.appearance')}</Text>

          <View style={styles.sectionCard}>
            {appearanceOptions.map((option) => {
              const selected =
                themePreference === option.value;

              return (
                <TouchableOpacity
                  key={option.value}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: selected }}
                  style={[
                    styles.settingRow,
                    selected && styles.selectedRow,
                  ]}
                  onPress={() =>
                    setThemePreference(option.value)
                  }
                  activeOpacity={0.75}
                >
                  <Text style={styles.settingTitle}>
                    {t(option.title)}
                  </Text>

                  <View
                    style={[
                      styles.radio,
                      selected && styles.radioSelected,
                    ]}
                  >
                    {selected ? (
                      <View style={styles.radioInner} />
                    ) : null}
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={styles.currentTheme}>
            {t('settings.currentTheme', { mode: resolvedTheme === 'dark' ? t('settings.themeDark') : t('settings.themeLight') })}
          </Text>

          <Text style={styles.sectionTitle}>{t('settings.notifications')}</Text>

          <View style={styles.sectionCard}>
            {notificationOptions.map((option) => (
              <View
                key={option.key}
                style={styles.notificationRow}
              >
                <View style={styles.notificationText}>
                  <Text style={styles.settingTitle}>
                    {t(option.title)}
                  </Text>
                  <Text style={styles.settingDescription}>
                    {t(option.description)}
                  </Text>
                </View>

                <Switch
                  accessibilityLabel={t(option.title)}
                  disabled={!preferencesLoaded}
                  value={notificationPreferences[option.key]}
                  onValueChange={(value) =>
                    updateNotificationPreference(
                      option.key,
                      value
                    )
                  }
                  trackColor={{
                    false: colors.border,
                    true: colors.primary,
                  }}
                  thumbColor={colors.white}
                />
              </View>
            ))}
          </View>

          <Text style={styles.note}>
            {t('settings.notifNote')}
          </Text>

          <Text style={styles.sectionTitle}>{t('settings.help')}</Text>

          <View style={styles.sectionCard}>
            <View style={styles.notificationRow}>
              <View style={styles.notificationText}>
                <Text style={styles.settingTitle}>
                  {t('settings.pageHelp')}
                </Text>
                <Text style={styles.settingDescription}>
                  {t('settings.pageHelpBody')}
                </Text>
              </View>

              <Switch
                accessibilityLabel={t('settings.pageHelp')}
                disabled={!appPreferencesReady}
                value={appPreferences.showPageHelp}
                onValueChange={(value) =>
                  setAppPreference('showPageHelp', value)
                }
                trackColor={{
                  false: colors.border,
                  true: colors.primary,
                }}
                thumbColor={colors.white}
              />
            </View>

            <View style={styles.notificationRow}>
              <View style={styles.notificationText}>
                <Text style={styles.settingTitle}>
                  {t('settings.raindrop')}
                </Text>
                <Text style={styles.settingDescription}>
                  {t('settings.raindropBody')}
                </Text>
              </View>

              <Switch
                accessibilityLabel={t('settings.raindrop')}
                disabled={!appPreferencesReady}
                value={appPreferences.showRaindropHelper}
                onValueChange={(value) =>
                  setAppPreference('showRaindropHelper', value)
                }
                trackColor={{
                  false: colors.border,
                  true: colors.primary,
                }}
                thumbColor={colors.white}
              />
            </View>
          </View>

          <Text style={styles.note}>
            {t('settings.helpNote')}
          </Text>

          <Text style={styles.sectionTitle}>{t('settings.account')}</Text>

          <TouchableOpacity
            style={styles.profileButton}
            onPress={() => router.push('/request')}
            activeOpacity={0.75}
          >
            <Text style={styles.profileText}>{t('settings.farmRequests')}</Text>
            <Text style={styles.arrow}>›</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.profileButton}
            onPress={() => router.push('/reports')}
            activeOpacity={0.75}
            accessibilityRole="button"
            accessibilityLabel={t('settings.reports')}
          >
            <Text style={styles.profileText}>{t('settings.reports')}</Text>
            <Text style={styles.arrow}>›</Text>
          </TouchableOpacity>

          {/* Telegram is how AgroFlow reaches a farmer when the app is
              shut - sign-in details, dangerous weather, a kit that has
              stopped working - so whether it is connected belongs where a
              farmer looks for it, not only on the Profile screen. */}
          <TouchableOpacity
            style={styles.profileButton}
            onPress={() => router.push('/profile')}
            activeOpacity={0.75}
            accessibilityRole="button"
            accessibilityLabel={
              telegramLinked === null
                ? t('settings.connectTelegram')
                : `${t('settings.connectTelegram')}. ${telegramLinked ? t('common.connected') : t('common.notConnected')}.`
            }
          >
            <Text style={styles.profileText}>{t('settings.connectTelegram')}</Text>

            <View style={styles.rowTrailing}>
              {telegramLinked !== null && (
                <Text
                  style={
                    telegramLinked
                      ? styles.statusConnected
                      : styles.statusNotConnected
                  }
                >
                  {telegramLinked ? t('common.connected') : t('common.notConnected')}
                </Text>
              )}

              <Text style={styles.arrow}>›</Text>
            </View>
          </TouchableOpacity>

          {telegramLinked ? (
            <TouchableOpacity
              style={styles.profileButton}
              onPress={confirmUnlinkTelegram}
              disabled={unlinking}
              activeOpacity={0.75}
              accessibilityRole="button"
              accessibilityLabel={t('settings.unlinkTelegram')}
              testID="unlink-telegram"
            >
              <Text style={styles.dangerText}>{unlinking ? t('common.saving') : t('settings.unlinkTelegram')}</Text>
              <Text style={styles.arrow}>›</Text>
            </TouchableOpacity>
          ) : null}

          {telegramMessage ? (
            <Text style={styles.note} accessibilityLiveRegion="polite">{telegramMessage}</Text>
          ) : null}

          {/* Every step of the setup wizard again, from the start (app/setup.tsx). */}
          <TouchableOpacity
            style={styles.profileButton}
            onPress={() => router.push('/setup?redo=1' as never)}
            activeOpacity={0.75}
            accessibilityRole="button"
            testID="redo-setup"
          >
            <Text style={styles.profileText}>{t('settings.redoSetup')}</Text>
            <Text style={styles.arrow}>›</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.profileButton}
            onPress={() => router.push('/profile')}
            activeOpacity={0.75}
          >
            <Text style={styles.profileText}>{t('settings.profile')}</Text>
            <Text style={styles.arrow}>›</Text>
          </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

