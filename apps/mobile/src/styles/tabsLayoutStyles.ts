import { StyleSheet } from 'react-native';
import { Radius } from '@/constants/colors';

// The tab icon wrapper: identical for all five tabs, previously
// re-declared per Tabs.Screen. No theme dependency, so a plain constant
// rather than a colors(...) factory.
export const tabsLayoutStyles = StyleSheet.create({
  tabIconWrapper: { width: 38, height: 38, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center', backgroundColor: 'transparent' },
});
