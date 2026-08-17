// Defines the bottom tab navigation structure for AgroFlow.
import { Tabs } from 'expo-router';

import {//importing icons for the bottom navigation bar
  Bell,//alerts
  Droplets,//irrigation
  History,
  House,//home
  Settings,
} from 'lucide-react-native';
import { useMemo } from 'react';
import {//tells the app if its running on android or IOS
  Platform,
  View,
} from 'react-native';

import { useAgroFlow } from '@/context/AgroFlowContext';//gives access to shared agroflow data
import { useTheme } from '@/context/ThemeContext';//contains the colors

export default function TabsLayout() {//creates layout component
  const { colors } = useTheme();
  const { alerts } = useAgroFlow();

  const unreadAlerts = alerts.filter(//gets unread alerts count
    (alert) => !alert.read
  ).length;

  const tabBarStyle = useMemo(
    () => ({
      height: Platform.OS === 'ios' ? 78 : 68,
      paddingTop: 7,
      paddingBottom: Platform.OS === 'ios' ? 18 : 8,
      borderTopWidth: 0,
      backgroundColor: colors.navigation,
      elevation: 0,//android shadow
      shadowOpacity: 0,//ios shadow
    }),
    [colors]
  );

  return (
    <Tabs
      screenOptions={{
        headerShown: false,//hiding auto header
        tabBarHideOnKeyboard: true,

        // Paints the complete tab area, including the safe-area section.
        tabBarBackground: () => (
          <View
            style={{
              flex: 1,
              backgroundColor: colors.navigation,
            }}
          />
        ),

        // Aqua identifies the selected tab against the forest-green bar.
        tabBarActiveTintColor: colors.primary,

        // Inactive icons and labels remain readable on forest green.
        tabBarInactiveTintColor: colors.navigationText,

        tabBarStyle,

        tabBarLabelStyle: {
          fontSize: 10,
          fontWeight: '600',
          paddingTop: 3,
          backgroundColor: 'transparent',
        },

        tabBarItemStyle: {
          backgroundColor: 'transparent',
        },

        tabBarIconStyle: {
          marginBottom: 1,
        },
      }}
    >
      <Tabs.Screen
        name="index"//home tab connects to index.tsx
        options={{
          title: 'Home',
          tabBarIcon: ({ color, size }) => (
            <House
              size={size}
              color={color}
              strokeWidth={1.8}
            />
          ),
        }}
      />

      <Tabs.Screen
        name="irrigation"
        options={{
          title: 'Irrigation',
          tabBarIcon: ({ color, size }) => (
            <Droplets
              size={size}
              color={color}
              strokeWidth={1.8}
            />
          ),
        }}
      />

      <Tabs.Screen
        name="alerts"
        options={{
          title: 'Alerts',
          tabBarBadge://display unread alerts
            unreadAlerts > 0
              ? unreadAlerts
              : undefined,
          tabBarBadgeStyle: {
            fontSize: 9,
            minWidth: 17,
            height: 17,
            lineHeight: 17,
            backgroundColor: colors.error,
            color: colors.white,
          },
          tabBarIcon: ({ color, size }) => (
            <Bell
              size={size}
              color={color}
              strokeWidth={1.8}
            />
          ),
        }}
      />

      <Tabs.Screen
        name="history"
        options={{
          title: 'History',
          tabBarIcon: ({ color, size }) => (
            <History
              size={size}
              color={color}
              strokeWidth={1.8}
            />
          ),
        }}
      />

      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ color, size }) => (
            <Settings
              size={size}
              color={color}
              strokeWidth={1.8}
            />
          ),
        }}
      />
    </Tabs>
  );
}