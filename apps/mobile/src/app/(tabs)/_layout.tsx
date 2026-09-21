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
import {
  ColorValue,
  View,
} from 'react-native';

import { useAgroFlow } from '@/context/AgroFlowContext';//gives access to shared agroflow data
import { useTheme } from '@/context/ThemeContext';//contains the colors
import { createTabsLayoutStyles, tabsLayoutStyles as styles } from '@/styles/tabsLayoutStyles';

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
  const themedStyles = useMemo(() => createTabsLayoutStyles(colors), [colors]);

  const unreadAlerts = alerts.filter(//gets unread alerts count
    (alert) => !alert.read
  ).length;

  return (
    <Tabs
      backBehavior="history"
      screenOptions={{
        headerShown: false,//hiding auto header
        tabBarHideOnKeyboard: true,

        // Aqua identifies the selected tab against the forest-green bar.
        tabBarActiveTintColor: colors.secondaryDark,

        // Inactive icons and labels remain readable on forest green.
        tabBarInactiveTintColor: colors.textMuted,

        tabBarStyle: themedStyles.tabBar,

        tabBarLabelStyle: styles.tabBarLabel,
        tabBarItemStyle: styles.tabBarItem,
        tabBarIconStyle: styles.tabBarIcon,
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
          tabBarBadgeStyle: themedStyles.badge,
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
