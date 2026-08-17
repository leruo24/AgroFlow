import Constants from 'expo-constants';
import { Platform } from 'react-native';

export const AGROFLOW_NOTIFICATION_CHANNEL =
  'agroflow-alerts';

export function isRunningInExpoGo() {
  return (
    Constants.executionEnvironment ===
    'storeClient'
  );
}

export async function configureNotifications() {
  if (isRunningInExpoGo()) {
    return false;
  }

  const Notifications =
    await import('expo-notifications');

  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(
      AGROFLOW_NOTIFICATION_CHANNEL,
      {
        name: 'AgroFlow Alerts',
        importance:
          Notifications.AndroidImportance.HIGH,
        sound: 'default',
        vibrationPattern: [
          0,
          250,
          250,
          250,
        ],
      }
    );
  }

  const currentPermissions =
    await Notifications.getPermissionsAsync();

  if (
    currentPermissions.status ===
    'granted'
  ) {
    return true;
  }

  const requestedPermissions =
    await Notifications.requestPermissionsAsync();

  return (
    requestedPermissions.status ===
    'granted'
  );
}

export async function sendTestNotification() {
  if (isRunningInExpoGo()) {
    throw new Error(
      'DEVELOPMENT_BUILD_REQUIRED'
    );
  }

  const Notifications =
    await import('expo-notifications');

  const hasPermission =
    await configureNotifications();

  if (!hasPermission) {
    throw new Error(
      'NOTIFICATION_PERMISSION_REQUIRED'
    );
  }

  await Notifications.scheduleNotificationAsync({
    content: {
      title: 'AgroFlow Alert',
      body: 'Notifications and sound are working.',
      sound: 'default',
      data: {
        type: 'test',
      },
    },
    trigger:
      Platform.OS === 'android'
        ? {
            type:
              Notifications
                .SchedulableTriggerInputTypes
                .TIME_INTERVAL,
            seconds: 1,
            channelId:
              AGROFLOW_NOTIFICATION_CHANNEL,
          }
        : {
            type:
              Notifications
                .SchedulableTriggerInputTypes
                .TIME_INTERVAL,
            seconds: 1,
          },
  });
}