import { StyleSheet } from 'react-native';
import { Layout, Radius, Space, Spacing, Type, cardStyle, type AppColors } from '@/constants/colors';
import { sharedLayout } from './shared';

// Home's one card per zone, the "I watered" / soil-feel sheet and the Finish setup
// checklist. Same text sizes and hairlines as the insights card, so they look like one family.
export function createTodayStyles(colors: AppColors) {
  return StyleSheet.create({
    // The one card look (constants/colors.ts cardStyle).
    card: cardStyle(colors),
    zoneName: { fontSize: Type.label, fontWeight: '700', color: colors.textSecondary, textTransform: 'uppercase' },
    action: { fontSize: Type.title, lineHeight: 25, fontWeight: '600', color: colors.text },
    actionWater: { color: colors.primaryDark },
    actionKit: { color: colors.error },
    // Advice longer than one run (lib/runLimit.ts).
    overLimit: { fontSize: Type.body, lineHeight: 22, color: colors.warning, fontWeight: '600' },
    // AF-18: what the advice used, small and quiet under the action.
    provenance: { fontSize: Type.caption, lineHeight: 18, color: colors.textSecondary },
    badgeRow: { ...sharedLayout.inlineRow, flexWrap: 'wrap', gap: Spacing.two },
    badge: {
      fontSize: Type.label,
      fontWeight: '700',
      color: colors.primaryDark,
      borderWidth: 1,
      borderColor: colors.primaryDark,
      borderRadius: Radius.full,
      paddingHorizontal: Spacing.two,
      paddingVertical: 2,
      overflow: 'hidden',
    },
    buttons: { ...sharedLayout.inlineRow, flexWrap: 'wrap', gap: Spacing.two },
    button: {
      minHeight: 44,
      paddingHorizontal: Spacing.three,
      justifyContent: 'center',
      borderRadius: Radius.sm,
      backgroundColor: colors.primaryDark,
    },
    buttonText: { fontSize: Type.body, fontWeight: '600', color: colors.white },
    ghost: {
      minHeight: 44,
      paddingHorizontal: Spacing.three,
      justifyContent: 'center',
      borderRadius: Radius.sm,
      borderWidth: 1,
      borderColor: colors.primaryDark,
    },
    ghostText: { fontSize: Type.body, fontWeight: '600', color: colors.primaryDark },
    busy: { opacity: 0.6 },

    // Sheet
    // The sheet's body: the 16 px gutter and room above the bottom edge.
    sheet: { gap: Spacing.three, paddingHorizontal: Layout.gutter, paddingTop: Space.lg },
    // Dry / Moist / Wet: three equal, full-width buttons, one under the other.
    feelChoices: { gap: Space.md },
    feelChoice: { width: '100%', minHeight: 64, justifyContent: 'center', alignItems: 'center', gap: 2, paddingVertical: Space.md, paddingHorizontal: Space.lg, borderRadius: Radius.sm, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
    intro: { fontSize: Type.body, lineHeight: 23, color: colors.textSecondary },
    choices: { ...sharedLayout.inlineRow, flexWrap: 'wrap', gap: Spacing.two },
    choice: {
      minWidth: 72,
      minHeight: 48,
      paddingHorizontal: Spacing.three,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: Radius.sm,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    choiceSelected: { borderColor: colors.primaryDark, backgroundColor: colors.surfaceSecondary },
    choiceText: { fontSize: Type.body, fontWeight: '600', color: colors.text },
    choiceHint: { fontSize: Type.label, color: colors.textSecondary },
    input: {
      minHeight: 48,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: Radius.sm,
      paddingHorizontal: Spacing.three,
      fontSize: Type.body,
      color: colors.text,
    },
    label: { fontSize: Type.body, fontWeight: '600', color: colors.text },
    help: { fontSize: Type.caption, lineHeight: 20, color: colors.textSecondary },
    message: { fontSize: Type.caption, color: colors.success },
    error: { fontSize: Type.caption, color: colors.error },

    // Checklist
    item: {
      gap: Spacing.two,
      paddingVertical: Spacing.three,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.divider,
    },
    itemHead: { ...sharedLayout.inlineRow, justifyContent: 'space-between' },
    done: { fontSize: Type.label, fontWeight: '700', color: colors.success },
    todo: { fontSize: Type.label, fontWeight: '700', color: colors.warning },
  });
}
