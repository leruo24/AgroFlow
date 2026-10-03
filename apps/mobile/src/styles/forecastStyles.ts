import { StyleSheet } from 'react-native';
import { Radius, Spacing, Type, type AppColors } from '@/constants/colors';
import { sharedLayout } from './shared';

// Styles for the 7-day Forecast screen.
//
// One row per day, not a grid of cards. A farmer reads this top to bottom
// deciding "do I water tomorrow, or wait?", and a vertical list of seven rows
// answers that in one scroll on any phone. A 7-wide grid would need
// horizontal scrolling on a small screen, which hides exactly the days that
// are furthest away and therefore most worth planning around.
export function createForecastStyles(colors: AppColors) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    content: { padding: Spacing.three, gap: Spacing.three, paddingBottom: Spacing.six },

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
    // Today is the row the farmer acts on now, so it is the one that is
    // allowed to stand out.
    dayRowToday: {
      backgroundColor: colors.surfaceSecondary,
      borderRadius: Radius.sm,
      paddingHorizontal: Spacing.two,
    },

    // Fixed width so every weekday, icon and temperature line up down the
    // column - a ragged left edge makes seven rows much harder to scan.
    dayLabel: { width: 52, gap: Spacing.half },
    weekday: { fontSize: Type.body, fontWeight: '700', color: colors.text },
    dayDate: { fontSize: Type.label, color: colors.textMuted },

    iconCell: { width: 40, alignItems: 'center', paddingTop: Spacing.half },

    dayBody: { flex: 1, gap: Spacing.half },
    temps: { fontSize: Type.body, fontWeight: '600', color: colors.text },
    // Rain is the number farmers actually plan around, so it keeps its own
    // line rather than being appended to the temperatures.
    rain: { fontSize: Type.caption, color: colors.textSecondary },
    rainWet: { fontSize: Type.caption, fontWeight: '600', color: colors.primaryDark },

    // The engine's sentence. Given weight, because it is the reason this
    // screen exists - the numbers above it are the evidence, this is the
    // answer.
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
