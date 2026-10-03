// Settings tab screen
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
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
import { fetchTelegramLinkStatus } from '@/services/agroFlowApi';

const NOTIFICATION_PREFERENCES_KEY =
  'agroflow_notification_preferences';

type NotificationPreferences = {
  irrigation: boolean;
  moisture: boolean;
  weather: boolean;
  device: boolean;
};

const appearanceOptions: {
  title: string;
  value: ThemePreference;
}[] = [
  { title: 'Light', value: 'light' },
  { title: 'Dark', value: 'dark' },
  { title: 'System Default', value: 'system' },
];

const notificationOptions: {
  key: keyof NotificationPreferences;
  title: string;
  description: string;
}[] = [
  {
    key: 'irrigation',
    title: 'Irrigation',
    description: 'Start, stop and schedule updates',
  },
  {
    key: 'moisture',
    title: 'Moisture Alerts',
    description: 'Warnings when soil moisture needs attention',
  },
  {
    key: 'weather',
    title: 'Weather Alerts',
    description: 'Rain and weather-related irrigation updates',
  },
  {
    key: 'device',
    title: 'Device Alerts',
    description: 'Sensor, relay and water pump warnings',
  },
];

export default function SettingsScreen() {
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

  const [notificationPreferences, setNotificationPreferences] =
    useState<NotificationPreferences>({
      irrigation: true,
      moisture: true,
      weather: true,
      device: true,
    });

  const [preferencesLoaded, setPreferencesLoaded] =
    useState(false);

  // Whether this farmer's Telegram is linked.
  //
  // Read, never changed, from here. The linking itself - the deep link, the
  // alerts switch, disconnecting - already lives in TelegramSection on the
  // Profile screen, and duplicating it would give two places that could
  // disagree about the same account. This row reports the state and sends
  // the farmer there.
  //
  // null means "not known yet", which shows no status rather than guessing
  // "Not connected" and telling a connected farmer they are not.
  const [telegramLinked, setTelegramLinked] =
    useState<boolean | null>(null);

  // In-app help preferences, stored on this device by useAppPreferences.
  // Deliberately separate from the notification preferences above: these are
  // display choices, those are about messages being sent.
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
        // Offline, signed out, or Telegram not configured on the server.
        // The row then shows no status at all and still navigates - a
        // settings page must not fail because one row could not load.
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
        contentContainerStyle={styles.scrollContent}
      >
          <ScreenHeader title="Settings" subtitle="Manage your AgroFlow preferences." help="settings" />

          <Text style={styles.sectionTitle}>Appearance</Text>

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
                    {option.title}
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
            Currently using {resolvedTheme} mode
          </Text>

          <Text style={styles.sectionTitle}>Notifications</Text>

          <View style={styles.sectionCard}>
            {notificationOptions.map((option) => (
              <View
                key={option.key}
                style={styles.notificationRow}
              >
                <View style={styles.notificationText}>
                  <Text style={styles.settingTitle}>
                    {option.title}
                  </Text>
                  <Text style={styles.settingDescription}>
                    {option.description}
                  </Text>
                </View>

                <Switch
                  accessibilityLabel={option.title}
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
            Notification preferences are currently saved on this device.
          </Text>

          <Text style={styles.sectionTitle}>Help</Text>

          <View style={styles.sectionCard}>
            <View style={styles.notificationRow}>
              <View style={styles.notificationText}>
                <Text style={styles.settingTitle}>
                  Show page help
                </Text>
                <Text style={styles.settingDescription}>
                  Shows a &quot;?&quot; button on each page that explains what it does.
                </Text>
              </View>

              <Switch
                accessibilityLabel="Show page help"
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
                  Raindrop helper
                </Text>
                <Text style={styles.settingDescription}>
                  A friendly raindrop that greets you and points out the one thing
                  that needs you most.
                </Text>
              </View>

              <Switch
                accessibilityLabel="Raindrop helper"
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
            Help settings are saved on this device.
          </Text>

          <Text style={styles.sectionTitle}>Account</Text>

          <TouchableOpacity
            style={styles.profileButton}
            onPress={() => router.push('/request')}
            activeOpacity={0.75}
          >
            <Text style={styles.profileText}>Farm Requests</Text>
            <Text style={styles.arrow}>›</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.profileButton}
            onPress={() => router.push('/reports')}
            activeOpacity={0.75}
            accessibilityRole="button"
            accessibilityLabel="Reports"
          >
            <Text style={styles.profileText}>Reports</Text>
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
                ? 'Connect Telegram'
                : telegramLinked
                  ? 'Connect Telegram. Connected.'
                  : 'Connect Telegram. Not connected.'
            }
          >
            <Text style={styles.profileText}>Connect Telegram</Text>

            <View style={styles.rowTrailing}>
              {telegramLinked !== null && (
                <Text
                  style={
                    telegramLinked
                      ? styles.statusConnected
                      : styles.statusNotConnected
                  }
                >
                  {telegramLinked ? 'Connected' : 'Not connected'}
                </Text>
              )}

              <Text style={styles.arrow}>›</Text>
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.profileButton}
            onPress={() => router.push('/profile')}
            activeOpacity={0.75}
          >
            <Text style={styles.profileText}>Profile</Text>
            <Text style={styles.arrow}>›</Text>
          </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

