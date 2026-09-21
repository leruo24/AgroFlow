import { Platform, StyleSheet } from 'react-native';
import { Radius, Type, type AppColors } from '@/constants/colors';

// The tab icon wrapper: identical for all five tabs, previously
// re-declared per Tabs.Screen. No theme dependency, so a plain constant
// rather than a colors(...) factory.
export const tabsLayoutStyles = StyleSheet.create({
  tabIconWrapper: { width: 38, height: 38, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center', backgroundColor: 'transparent' },
  tabBarLabel: { fontSize: Type.label, fontWeight: '600', paddingTop: 3, backgroundColor: 'transparent' },
  tabBarItem: { backgroundColor: 'transparent' },
  tabBarIcon: { marginBottom: 1 },
});

export function createTabsLayoutStyles(colors: AppColors) {
  return StyleSheet.create({
    // The bar used to be transparent, with an expo-blur layer supplied via
    // tabBarBackground painting the rounded surface behind it. With blur gone
    // the bar paints itself: a solid token surface, a hairline border and a
    // soft shadow to lift it off the canvas.
    //
    // The border runs the whole way round rather than only along the top. On a
    // rounded, inset, floating bar a top-only hairline is clipped by the corner
    // radius and reads as an unfinished line; a full hairline reads as chrome.
    // `overflow: 'hidden'` is also gone - it existed to clip the blur layer to
    // the corner radius, and it would clip the new shadow on iOS.
    tabBar: {
      height: Platform.OS === 'ios' ? 82 : 72,
      marginHorizontal: 16,
      marginBottom: Platform.OS === 'ios' ? 8 : 12,
      paddingTop: 8,
      paddingBottom: Platform.OS === 'ios' ? 15 : 8,
      borderRadius: Radius.md,
      position: 'absolute',
      backgroundColor: colors.tabBarSurface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.divider,
      shadowColor: colors.black,
      shadowOpacity: 0.12,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 4 },
      elevation: 8,
    },
    badge: {
      fontSize: Type.label,
      minWidth: 17,
      height: 17,
      lineHeight: 17,
      backgroundColor: colors.error,
      color: colors.white,
    },
  });
}
