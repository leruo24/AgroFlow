// A row of stats in equal-width columns, value above label ("2 / Total zones"). The columns
// never run together: each is a third (or a quarter) of the row, and a long value shrinks.
import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '@/context/ThemeContext';
import { Space, TypeScale } from '@/constants/colors';

export type Stat = { label: string; value: string; note?: string };

export function StatsRow({ stats, testID }: { stats: Stat[]; testID?: string }) {
  const { colors } = useTheme();
  const styles = useMemo(() => StyleSheet.create({
    row: { flexDirection: 'row', paddingVertical: Space.lg, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.divider },
    stat: { flex: 1, flexBasis: 0, minWidth: 0, gap: Space.xs, paddingRight: Space.sm },
    value: { color: colors.text, fontSize: 24, fontWeight: '600' },
    label: { color: colors.textSecondary, fontSize: TypeScale.label, lineHeight: 18 },
    note: { color: colors.textSecondary, fontSize: TypeScale.small, lineHeight: 16 },
  }), [colors]);
  return <View style={styles.row} testID={testID}>
    {stats.map(s => <View key={s.label} style={styles.stat} accessible accessibilityLabel={`${s.label}: ${s.value}${s.note ? `, ${s.note}` : ''}`}>
      <Text style={styles.value} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>{s.value}</Text>
      <Text style={styles.label} numberOfLines={2}>{s.label}</Text>
      {s.note ? <Text style={styles.note} numberOfLines={2}>{s.note}</Text> : null}
    </View>)}
  </View>;
}
