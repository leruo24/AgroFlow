// A label/value grid in two real columns (Soil moisture / Temperature / Water today / Last
// watering). Each cell is exactly half the row, so values line up at 320-430 px, and a value is
// one line: it shrinks a little rather than wrap in the middle of a number.
import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '@/context/ThemeContext';
import { Space, TypeScale } from '@/constants/colors';

export type InfoItem = { label: string; value: string; note?: string; muted?: boolean };

export function InfoGrid({ items, testID }: { items: InfoItem[]; testID?: string }) {
  const { colors } = useTheme();
  const styles = useMemo(() => StyleSheet.create({
    grid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: Space.md },
    cell: { width: '50%', paddingRight: Space.sm, gap: Space.xs },
    label: { color: colors.textSecondary, fontSize: TypeScale.label, lineHeight: 18 },
    value: { color: colors.text, fontSize: TypeScale.body, fontWeight: '600', lineHeight: 22 },
    muted: { color: colors.textSecondary, fontWeight: '400' },
    note: { color: colors.textSecondary, fontSize: TypeScale.small },
  }), [colors]);
  return <View style={styles.grid} testID={testID}>
    {items.map(item => <View key={item.label} style={styles.cell} accessible accessibilityLabel={`${item.label}: ${item.value}`}>
      <Text style={styles.label} numberOfLines={2}>{item.label}</Text>
      <Text style={[styles.value, item.muted && styles.muted]} numberOfLines={item.muted ? 2 : 1} adjustsFontSizeToFit={!item.muted} minimumFontScale={0.8}>{item.value}</Text>
      {item.note ? <Text style={styles.note} numberOfLines={2}>{item.note}</Text> : null}
    </View>)}
  </View>;
}
