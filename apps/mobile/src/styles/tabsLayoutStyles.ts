import { Platform, StyleSheet } from 'react-native';
import { Radius, Type, type AppColors, Space } from '@/constants/colors';

export const FLOATING_TAB_BAR_HEIGHT = 96;
export const FLOATING_TAB_BAR_MARGIN_BOTTOM = Platform.OS === 'ios' ? 8 : 12;

// The tab icon wrapper, the same for all five tabs. No theme dependency, so a plain
// constant instead of a colors(...) factory.
export const tabsLayoutStyles = StyleSheet.create({
  tabIconWrapper: { width: 44, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: 'transparent' },
  tabBarLabel: { fontSize: Type.label, fontWeight: '600', paddingTop: 3, backgroundColor: 'transparent' },
  tabBarItem: { backgroundColor: 'transparent' },
  tabBarIcon: { marginBottom: 1 },
});

export function createTabsLayoutStyles(colors: AppColors) {
  return StyleSheet.create({
    // The bar has a solid surface, a hairline border and a soft shadow.
    // The border goes all the way round: on a rounded floating bar a top-only line is clipped
    // by the corners and looks unfinished. No `overflow: 'hidden'`, which would clip the
    // shadow on iOS.
    tabBar: {
      // Browsers draw the label taller than Android does, so web needs a little more room or the
      // descenders ("g", "y") are cut off.
      height: FLOATING_TAB_BAR_HEIGHT,
      marginHorizontal: Space.lg,
      marginBottom: FLOATING_TAB_BAR_MARGIN_BOTTOM,
      paddingTop: Space.sm,
      paddingBottom: Platform.OS === 'ios' ? 15 : Platform.OS === 'web' ? 10 : 8,
      borderRadius: 20,
      position: 'absolute',
      backgroundColor: colors.tabBarSurface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.divider,
      // react-native-web only supports boxShadow; the phones keep shadow* and elevation.
      ...Platform.select({
        web: { boxShadow: '0px 4px 12px rgba(0, 0, 0, 0.12)' },
        default: {
          shadowColor: colors.black,
          shadowOpacity: 0.12,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: 4 },
          elevation: 8,
        },
      }),
    },
    badge: {
      fontSize: Type.label,
      minWidth: 17,
      height: 17,
      lineHeight: 17,
      backgroundColor: colors.dangerAction,
      color: colors.white,
    },
  });
}
