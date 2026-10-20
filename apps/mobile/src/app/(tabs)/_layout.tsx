// The bottom tab navigation for AgroFlow.
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
  Platform,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAgroFlow } from '@/context/AgroFlowContext';//gives access to shared agroflow data
import { useI18n } from '@/i18n';
import { useTheme } from '@/context/ThemeContext';//contains the colors
import {
  createTabsLayoutStyles,
  FLOATING_TAB_BAR_MARGIN_BOTTOM,
  tabsLayoutStyles as styles,
} from '@/styles/tabsLayoutStyles';

type TabIconProps = { size?: number; color?: ColorValue; strokeWidth?: number };

// One shared render function for the 38x38 chip around each tab icon.
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
  const { t } = useI18n();
  const { colors } = useTheme();
  const { alerts } = useAgroFlow();
  const themedStyles = useMemo(() => createTabsLayoutStyles(colors), [colors]);
  // From an iPhone Home Screen the web app runs edge to edge (viewport-fit=cover), so the
  // floating bar sits above the home indicator. The native apps already allow for it.
  const { bottom } = useSafeAreaInsets();
  const tabBarStyle = Platform.OS === 'web' && bottom > 0
    ? [themedStyles.tabBar, { marginBottom: FLOATING_TAB_BAR_MARGIN_BOTTOM + bottom }]
    : themedStyles.tabBar;

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

        // Inactive icons and labels stay readable on forest green.
        tabBarInactiveTintColor: colors.textMuted,

        tabBarStyle,

        tabBarLabelStyle: styles.tabBarLabel,
        tabBarItemStyle: styles.tabBarItem,
        tabBarIconStyle: styles.tabBarIcon,
      }}
    >
      <Tabs.Screen
        name="index"//home tab connects to index.tsx
        options={{
          title: t('tabs.home'),
          tabBarIcon: TabIcon(House),
        }}
      />

      <Tabs.Screen
        name="irrigation"
        options={{
          title: t('tabs.irrigation'),
          tabBarIcon: TabIcon(Droplets),
        }}
      />

      <Tabs.Screen
        name="alerts"
        options={{
          title: t('tabs.alerts'),
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
          title: t('tabs.history'),
          tabBarIcon: TabIcon(History),
        }}
      />

      <Tabs.Screen
        name="settings"
        options={{
          title: t('tabs.settings'),
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
