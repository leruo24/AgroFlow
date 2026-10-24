// The bottom tab navigation for AgroFlow.
import { Tabs } from 'expo-router';

import {//importing icons for the bottom navigation bar
  Bell,//alerts
  Cpu,//kit
  Droplets,//irrigation
  House,//home
  Menu,//more
} from 'lucide-react-native';
import { useMemo, type ComponentType } from 'react';
import {
  ColorValue,
  Platform,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAgroFlow } from '@/context/AgroFlowContext';//gives access to shared agroflow data
import { useI18n } from '@/i18n';
import { Space } from '@/constants/colors';
import { DockSurface, DockIcon } from '@/components/visual/DockSurface';
import { useTheme } from '@/context/ThemeContext';//contains the colors
import {
  createTabsLayoutStyles,
  FLOATING_TAB_BAR_MARGIN_BOTTOM,
  tabsLayoutStyles as styles,
} from '@/styles/tabsLayoutStyles';

type TabIconProps = { size?: number; color?: ColorValue; strokeWidth?: number };

// One shared render function for the 38x38 chip around each tab icon.
function TabIcon(Icon: ComponentType<TabIconProps>) {
  return function RenderTabIcon({ color, size, focused }: { color: ColorValue; size: number; focused: boolean }) {
    return (
      <DockIcon selected={focused}>
        <Icon size={size} color={focused ? '#FFFFFF' : color} strokeWidth={1.8} />
      </DockIcon>
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
  // On a 320 px phone the five labels need the full width: a smaller side margin and label,
  // so "Irrigation" is never cut to "Irrigati...".
  const narrow = useWindowDimensions().width < 360;
  const tabBarStyle = [
    themedStyles.tabBar,
    bottom > 0 && { marginBottom: FLOATING_TAB_BAR_MARGIN_BOTTOM + bottom },
    narrow && { marginHorizontal: Space.sm },
  ];

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
        tabBarActiveTintColor: colors.primaryDark,

        // Inactive icons and labels stay readable on forest green.
        tabBarInactiveTintColor: colors.textMuted,

        tabBarStyle,
        tabBarBackground: () => <DockSurface />,

        tabBarLabelStyle: [styles.tabBarLabel, narrow && { fontSize: 11 }],
        tabBarLabel: ({ children, color }) => <Text style={[styles.tabBarLabel, { color, textAlign: 'center', flexShrink: 1, width: '100%', maxWidth: '100%' }]}>{children}</Text>,
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

      {/* The kit: its status, what is working, and its setup Wi-Fi. */}
      <Tabs.Screen
        name="kit"
        options={{
          title: t('tabs.kit'),
          tabBarIcon: TabIcon(Cpu),
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

      {/* History, Reports, Tank, Forecast, Settings and Help. */}
      <Tabs.Screen
        name="more"
        options={{
          title: t('tabs.more'),
          tabBarIcon: TabIcon(Menu),
        }}
      />

      {/* No longer buttons in the bar (they are under More), but still tab screens, so /history
          and /settings and every link to them open the same screens with the bar underneath. */}
      <Tabs.Screen
        name="history"
        options={{
          title: t('tabs.history'),
          href: null,
        }}
      />

      <Tabs.Screen
        name="settings"
        options={{
          title: t('tabs.settings'),
          href: null,
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
