// The one card: every list item (zones, alerts, history, reports) and grouped block uses it, so
// padding (16), corner radius, border and the gap between cards are the same everywhere.
// Cards in a list are spaced by their parent (CardList), not by margins on each card.
import { useMemo, type ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '@/context/ThemeContext';
import { Layout, cardStyle } from '@/constants/colors';

export function Card({ children, style, testID, tone }: {
  children: ReactNode; style?: StyleProp<ViewStyle>; testID?: string; tone?: 'warning' | 'error';
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => StyleSheet.create({
    card: cardStyle(colors),
    warning: { borderColor: colors.warning },
    error: { borderColor: colors.error },
  }), [colors]);
  return <View style={[styles.card, tone && styles[tone], style]} testID={testID}>{children}</View>;
}

// A list of cards with the standard 12 between them. The section heading above carries the
// 12 down to the first card.
export function CardList({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[{ gap: Layout.cardGap }, style]}>{children}</View>;
}
