import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { StyleSheet, View } from 'react-native';
import { useTheme } from '@/context/ThemeContext';
import { useId, type ReactNode } from 'react';

export function DockIcon({ selected, children }: { selected: boolean; children: ReactNode }) {
  return <View style={{ width: 44, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' }}>
    {selected && <DockSurface selected />}
    {/* Positioned art otherwise paints above an inline SVG on react-native-web. */}
    <View testID="dock-icon-foreground" style={{ zIndex: 1 }}>{children}</View>
  </View>;
}

// Existing SVG dependency: opaque fallback, no blur or native module required.
export function DockSurface({ selected = false }: { selected?: boolean }) {
  const { isDark, colors } = useTheme();
  // SVG IDs share the document on web; the selected chip must not resolve to
  // the dock's pale background gradient (which makes its white icon disappear).
  const gradientId = 'dock-' + useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const stops = selected
    ? ['#176B45', '#104B38', '#104B38']
    : isDark ? ['#1B2C22', '#1B2C22', '#203D2A'] : ['#EFF5EC', '#FFFFFF', '#F7F8F4'];
  return <View testID="dock-surface" nativeID={gradientId} pointerEvents="none" accessible={false} accessibilityElementsHidden
    importantForAccessibility="no-hide-descendants"
    style={[StyleSheet.absoluteFill, { overflow: 'hidden', borderRadius: selected ? 12 : 20, backgroundColor: selected ? colors.action : colors.tabBarSurface }]}>
    <Svg width="100%" height="100%" aria-hidden>
      <Defs><LinearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
        <Stop offset="0" stopColor={stops[0]} /><Stop offset="0.5" stopColor={stops[1]} /><Stop offset="1" stopColor={stops[2]} />
      </LinearGradient></Defs>
      <Rect width="100%" height="100%" fill={`url(#${gradientId})`} />
    </Svg>
  </View>;
}
