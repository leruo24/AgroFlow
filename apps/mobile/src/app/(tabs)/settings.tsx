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
          <ScreenHeader title="Settings" subtitle="Manage your AgroFlow preferences." />

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

