import { StyleSheet } from 'react-native';
import { Radius, Spacing, Type, type AppColors } from '@/constants/colors';
import { sharedLayout } from './shared';

// Styles for the FAO-56 engine's farmer-facing components: the insights card,
// the growth bar, the reset button and the calibration sheet.
//
// One factory taking colours, matching every other style module here. Hierarchy
// comes from the named type steps and hairline dividers rather than from boxes,
// which is the direction the rest of these screens went in.
export function createZoneInsightsStyles(colors: AppColors) {
  return StyleSheet.create({
    // ---- Insights card ----
    card: { paddingVertical: Spacing.three, gap: Spacing.two },
    heading: { ...sharedLayout.inlineRow, justifyContent: 'space-between' },
    headingLeft: { ...sharedLayout.inlineRow },
    title: { fontSize: Type.title, fontWeight: '600', color: colors.text },
    count: { fontSize: Type.caption, color: colors.textMuted },

    row: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: Spacing.three,
      paddingVertical: Spacing.three,
      minHeight: 48,
    },
    rowDivider: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.divider,
    },

    // A 3px bar on the leading edge carries severity. The icon changes with it,
    // so urgency never rests on colour alone.
    severityBar: { width: 3, alignSelf: 'stretch', borderRadius: 2 },
    severityActNow: { backgroundColor: colors.error },
    severityHeadsUp: { backgroundColor: colors.warning },
    severityInfo: { backgroundColor: colors.primaryDark },

    rowBody: { flex: 1, gap: Spacing.one },
    message: { fontSize: Type.body, lineHeight: 23, color: colors.text },
    dismissHint: { fontSize: Type.label, color: colors.textMuted },

    empty: { fontSize: Type.body, lineHeight: 23, color: colors.textSecondary },

    // ---- Confidence badge and the one next step (item 2) ----
    confidence: { gap: Spacing.one, paddingBottom: Spacing.two },
    confidenceBadge: {
      alignSelf: 'flex-start',
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
    confidenceReason: { fontSize: Type.caption, lineHeight: 20, color: colors.textSecondary },
    improve: {
      marginTop: Spacing.two,
      padding: Spacing.three,
      borderRadius: Radius.md,
      backgroundColor: colors.surfaceSecondary,
      gap: Spacing.one,
    },
    improveTitle: { fontSize: Type.label, fontWeight: '700', color: colors.text },
    improveText: { fontSize: Type.body, lineHeight: 23, color: colors.text },

    // ---- Growth bar ----
    growthCard: { paddingVertical: Spacing.three, gap: Spacing.two },
    growthHeading: { ...sharedLayout.inlineRow, justifyContent: 'space-between' },
    growthStage: { fontSize: Type.title, fontWeight: '600', color: colors.text },
    growthDay: { fontSize: Type.caption, color: colors.textSecondary },
    track: {
      height: 8,
      borderRadius: Radius.sm,
      backgroundColor: colors.surfaceSecondary,
      overflow: 'hidden',
    },
    fill: { height: 8, borderRadius: Radius.sm, backgroundColor: colors.primaryDark },
    growthCrop: { fontSize: Type.caption, color: colors.textMuted },

    // ---- Reset button ----
    resetButton: {
      ...sharedLayout.inlineRow,
      justifyContent: 'center',
      minHeight: 48,
      paddingHorizontal: Spacing.three,
      borderRadius: Radius.sm,
      borderWidth: 1,
      borderColor: colors.primaryDark,
    },
    resetButtonBusy: { opacity: 0.6 },
    resetButtonText: { fontSize: Type.body, fontWeight: '600', color: colors.primaryDark },
    resetResult: { fontSize: Type.caption, color: colors.textSecondary, marginTop: Spacing.two },
    resetError: { fontSize: Type.caption, color: colors.error, marginTop: Spacing.two },

    // ---- Calibration sheet ----
    sheet: { gap: Spacing.three },
    sheetTitle: { fontSize: Type.title, fontWeight: '600', color: colors.text },
    sheetIntro: { fontSize: Type.body, lineHeight: 23, color: colors.textSecondary },
    step: {
      gap: Spacing.two,
      paddingVertical: Spacing.three,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.divider,
    },
    stepLabel: { fontSize: Type.body, fontWeight: '600', color: colors.text },
    stepHelp: { fontSize: Type.caption, lineHeight: 20, color: colors.textSecondary },
    stepButton: {
      ...sharedLayout.inlineRow,
      justifyContent: 'center',
      minHeight: 48,
      borderRadius: Radius.sm,
      backgroundColor: colors.primaryDark,
    },
    stepButtonBusy: { opacity: 0.6 },
    stepButtonText: { fontSize: Type.body, fontWeight: '600', color: colors.white },
    sheetMessage: { fontSize: Type.caption, color: colors.success },
    sheetError: { fontSize: Type.caption, color: colors.error },
  });
}
