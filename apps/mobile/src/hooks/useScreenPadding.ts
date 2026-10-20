// Bottom padding for every scroll view, so the last button is never under the floating tab
// bar: tab bar height + its margin + the bottom safe-area inset + 16. Screens outside the tabs
// (no bar) get the inset + 16.
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Space } from '@/constants/colors';
import { FLOATING_TAB_BAR_HEIGHT, FLOATING_TAB_BAR_MARGIN_BOTTOM } from '@/styles/tabsLayoutStyles';

export function bottomPadding(insetBottom: number, withTabBar: boolean): number {
  return (withTabBar ? FLOATING_TAB_BAR_HEIGHT + FLOATING_TAB_BAR_MARGIN_BOTTOM : 0) + insetBottom + Space.lg;
}

export function useBottomPadding(withTabBar = true): number {
  const { bottom } = useSafeAreaInsets();
  return bottomPadding(bottom, withTabBar);
}
