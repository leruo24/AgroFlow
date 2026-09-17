import { Platform, StyleSheet } from 'react-native';
import { Radius, Type, type AppColors } from '@/constants/colors';

// The tab icon wrapper: identical for all five tabs, previously
// re-declared per Tabs.Screen. No theme dependency, so a plain constant
// rather than a colors(...) factory.
export const tabsLayoutStyles = StyleSheet.create({
  tabIconWrapper: { width: 38, height: 38, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center', backgroundColor: 'transparent' },
  blurBackground: { flex: 1 },
  blurLayer: { ...StyleSheet.absoluteFill },
  tabBarLabel: { fontSize: Type.label, fontWeight: '600', paddingTop: 3, backgroundColor: 'transparent' },
  tabBarItem: { backgroundColor: 'transparent' },
  tabBarIcon: { marginBottom: 1 },
});

export function createTabsLayoutStyles(colors: AppColors) {
  return StyleSheet.create({
    tabBar: {
      height: Platform.OS === 'ios' ? 82 : 72,
      marginHorizontal: 16,
      marginBottom: Platform.OS === 'ios' ? 8 : 12,
      paddingTop: 8,
      paddingBottom: Platform.OS === 'ios' ? 15 : 8,
      borderRadius: Radius.md,
      position: 'absolute',
      overflow: 'hidden',
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.divider,
      backgroundColor: 'transparent',
      elevation: 0,
      shadowOpacity: 0,
    },
    badge: {
      fontSize: Type.label,
      minWidth: 17,
      height: 17,
      lineHeight: 17,
      backgroundColor: colors.error,
      color: colors.white,
    },
    frostedOverlay: { ...StyleSheet.absoluteFill, backgroundColor: colors.frostedSurface },
    frostedFallback: { flex: 1, backgroundColor: colors.frostedFallback },
  });
}
