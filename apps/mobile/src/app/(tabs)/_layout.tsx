import { Radius, Type } from '@/constants/colors';
// Defines the bottom tab navigation structure for AgroFlow.
import { Tabs } from 'expo-router';

import {//importing icons for the bottom navigation bar
  Bell,//alerts
  Droplets,//irrigation
  History,
  House,//home
  Settings,
} from 'lucide-react-native';
import { useMemo, type ComponentType } from 'react';
import {//tells the app if its running on android or IOS
  ColorValue,
  Platform,
  View,
} from 'react-native';

import { useAgroFlow } from '@/context/AgroFlowContext';//gives access to shared agroflow data
import { useTheme } from '@/context/ThemeContext';//contains the colors
import { tabsLayoutStyles as styles } from '@/styles/tabsLayoutStyles';

type TabIconProps = { size?: number; color?: ColorValue; strokeWidth?: number };

// The five tab icons were each wrapped in an identical 38x38 chip View -
// one shared render function instead of five copies of the same JSX.
function TabIcon(Icon: ComponentType<TabIconProps>) {
  return function RenderTabIcon({ color, size }: { color: ColorValue; size: number; focused: boolean }) {
    return (
      <View style={styles.tabIconWrapper}>
        <Icon size={size} color={color} strokeWidth={1.8} />
      </View>
    );
  };
}

export default function TabsLayout() {//creates layout component
  const { colors } = useTheme();
  const { alerts } = useAgroFlow();

  const unreadAlerts = alerts.filter(//gets unread alerts count
    (alert) => !alert.read
  ).length;

  const tabBarStyle = useMemo(
    () => ({
      height: Platform.OS === 'ios' ? 82 : 72,
      marginHorizontal: 16,
      marginBottom: Platform.OS === 'ios' ? 8 : 12,
      paddingTop: 8,
      paddingBottom: Platform.OS === 'ios' ? 15 : 8,
      borderRadius: Radius.md,
      position: 'absolute' as const,
      overflow: 'hidden' as const,
      borderTopWidth: 1,
      borderTopColor: colors.divider,
      backgroundColor: colors.surface,
      elevation: 0,//android shadow
      shadowOpacity: 0,//ios shadow
    }),
    [colors]
  );

  return (
    <Tabs
      backBehavior="history"
      screenOptions={{
        headerShown: false,//hiding auto header
        tabBarHideOnKeyboard: true,

        // Paints the complete tab area, including the safe-area section.
        tabBarBackground: () => (
          <View
            style={{
              flex: 1,
              backgroundColor: colors.surface,
            }}
          />
        ),

        // Aqua identifies the selected tab against the forest-green bar.
        tabBarActiveTintColor: colors.secondaryDark,

        // Inactive icons and labels remain readable on forest green.
        tabBarInactiveTintColor: colors.textMuted,

        tabBarStyle,

        tabBarLabelStyle: {
          fontSize: Type.label,
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
          tabBarIcon: TabIcon(House),
        }}
      />

      <Tabs.Screen
        name="irrigation"
        options={{
          title: 'Irrigation',
          tabBarIcon: TabIcon(Droplets),
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
            fontSize: Type.label,
            minWidth: 17,
            height: 17,
            lineHeight: 17,
            backgroundColor: colors.error,
            color: colors.white,
          },
          tabBarIcon: TabIcon(Bell),
        }}
      />

      <Tabs.Screen
        name="history"
        options={{
          title: 'History',
          tabBarIcon: TabIcon(History),
        }}
      />

      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: TabIcon(Settings),
        }}
      />

      {/* Profile lives inside the tab navigator (reached via the account
          avatar, not a tab button) purely so the real floating tab bar
          above keeps rendering underneath it - href: null keeps it out of
          the tab bar itself while it stays a normal, routable tab screen. */}
      <Tabs.Screen
        name="profile"
        options={{
          href: null,
        }}
      />
    </Tabs>
  );
}
