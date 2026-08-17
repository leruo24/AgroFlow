// Settings tab screen 
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { AppColors } from '@/constants/colors';
import type { ThemePreference } from '@/context/ThemeContext';
import { useTheme } from '@/context/ThemeContext';

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
    () => createStyles(colors),
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
          <View style={styles.header}>
            <Text style={styles.title}>Settings</Text>
            <Text style={styles.subtitle}>
              Manage your AgroFlow preferences.
            </Text>
          </View>

          <Text style={styles.sectionTitle}>Appearance</Text>

          <View style={styles.sectionCard}>
            {appearanceOptions.map((option) => {
              const selected =
                themePreference === option.value;

              return (
                <TouchableOpacity
                  key={option.value}
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

function createStyles(colors: AppColors) {
  return StyleSheet.create({
    safeArea: {
      flex: 1,
      backgroundColor: colors.navigation,
    },
    page: {
      flex: 1,
      backgroundColor: colors.background,
    },
    header: {
      marginHorizontal: -18,
      marginBottom: 16,
      paddingHorizontal: 18,
      paddingTop: 4,
      paddingBottom: 6,
      backgroundColor: colors.navigation,
    },
    title: {
      fontSize: 20,
      fontWeight: '700',
      color: colors.navigationText,
    },
    subtitle: {
      marginTop: 3,
      fontSize: 12,
      lineHeight: 17,
      color: colors.white,
    },
    scrollContent: {
      paddingHorizontal: 18,
      paddingBottom: 35,
    },
    sectionTitle: {
      marginTop: 6,
      marginBottom: 10,
      fontSize: 16,
      fontWeight: '700',
      color: colors.text,
    },
    sectionCard: {
      marginBottom: 10,
      overflow: 'hidden',
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    settingRow: {
      minHeight: 54,
      paddingHorizontal: 14,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    selectedRow: {
      backgroundColor: colors.surfaceSecondary,
    },
    settingTitle: {
      fontSize: 14,
      fontWeight: '600',
      color: colors.text,
    },
    currentTheme: {
      marginBottom: 18,
      fontSize: 12,
      color: colors.secondaryDark,
    },
    radio: {
      width: 20,
      height: 20,
      borderRadius: 0,
      borderWidth: 2,
      borderColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    radioSelected: {
      borderColor: colors.primary,
    },
    radioInner: {
      width: 10,
      height: 10,
      borderRadius: 5,
      backgroundColor: colors.primary,
    },
    notificationRow: {
      minHeight: 70,
      paddingHorizontal: 14,
      paddingVertical: 10,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 14,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    notificationText: {
      flex: 1,
    },
    settingDescription: {
      marginTop: 4,
      fontSize: 11,
      lineHeight: 16,
      color: colors.text,
    },
    note: {
      marginTop: 2,
      marginBottom: 18,
      fontSize: 11,
      lineHeight: 16,
      color: colors.textSecondary,
    },
    profileButton: {
      minHeight: 54,
      paddingHorizontal: 14,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      borderWidth: 1,
      borderColor: colors.primaryDark,
      backgroundColor: colors.primary,
    },
    profileText: {
      fontSize: 14,
      fontWeight: '600',
      color: colors.white,
    },
    arrow: {
      fontSize: 22,
      color: colors.white,
    },
  });
}