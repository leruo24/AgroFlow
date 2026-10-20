import { StyleSheet } from 'react-native';
import { Radius, Spacing, Type, type AppColors, Layout } from '@/constants/colors';
import { sharedLayout } from './shared';

// Styles for the 7-day Forecast screen.
// One row per day, not a grid of cards: the farmer reads top to bottom deciding "water
// tomorrow, or wait?", and seven rows fit in one scroll on any phone. A 7-wide grid would
// hide the furthest days behind horizontal scrolling.
export function createForecastStyles(colors: AppColors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    content: { padding: Layout.gutter, gap: Spacing.three },

    zoneNote: { fontSize: Type.body, lineHeight: 22, color: colors.textSecondary },

    dayRow: {
      ...sharedLayout.inlineRow,
      alignItems: 'flex-start',
      gap: Spacing.three,
      paddingVertical: Spacing.three,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.divider,
    },
    dayRowLast: { borderBottomWidth: 0 },
    // Today is the row the farmer acts on, so it is the one that stands out.
    dayRowToday: {
      backgroundColor: colors.surfaceSecondary,
      borderRadius: Radius.sm,
      paddingHorizontal: Spacing.two,
    },

    // Fixed width so weekdays, icons and temperatures line up down the column.
    dayLabel: { width: 52, gap: Spacing.half },
    weekday: { fontSize: Type.body, fontWeight: '700', color: colors.text },
    dayDate: { fontSize: Type.label, color: colors.textMuted },

    iconCell: { width: 40, alignItems: 'center', paddingTop: Spacing.half },

    dayBody: { flex: 1, gap: Spacing.half },
    temps: { fontSize: Type.body, fontWeight: '600', color: colors.text },
    // Rain is what farmers plan around, so it has its own line.
    rain: { fontSize: Type.caption, color: colors.textSecondary },
    rainWet: { fontSize: Type.caption, fontWeight: '600', color: colors.primaryDark },

    // The engine's sentence, in bold: the numbers above are the evidence, this is the answer.
    advice: { fontSize: Type.caption, fontWeight: '600', color: colors.text, marginTop: Spacing.half },

    empty: {
      gap: Spacing.two,
      padding: Spacing.three,
      borderRadius: Radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    emptyTitle: { fontSize: Type.title, fontWeight: '600', color: colors.text },
    emptyBody: { fontSize: Type.body, lineHeight: 22, color: colors.textSecondary },

    error: { fontSize: Type.body, lineHeight: 22, color: colors.error },

    source: {
      fontSize: Type.label,
      lineHeight: 18,
      color: colors.textMuted,
      marginTop: Spacing.two,
    },
  });
}
